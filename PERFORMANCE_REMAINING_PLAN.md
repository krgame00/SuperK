# Performance Optimization — Remaining Work Plan

Updated: 2026-09-10

Feature: **Clean/Translate Pipelining + Adaptive ROI**

Source spec: `.scratch/performance-pipelining-adaptive-roi/spec.md`

Tickets: `.scratch/performance-pipelining-adaptive-roi/issues/01-06`

ADR: `docs/adr/0005-bounded-prefetch-and-adaptive-cleaning-scope.md`

## Current implementation state

The main architecture has already been started in production code:

- Adaptive ROI decision logic exists in `ocr-service/app/adaptive_scope.py`.
- LamaLarge has a localized `clean_roi()` execution path.
- Production cleaning pipeline has begun switching from unconditional full-page LamaLarge to Adaptive ROI/full-page routing.
- Bounded quality escalation and `awaiting_review` plumbing have been started.
- Prepared-page identity/cache metadata has been started across the cleaning client, project store and `useCleaning`.
- N+1 prepared-page prefetch has been started in `handleTranslateAll()` while Gemini remains serial.
- Rolling ETA / prefetch-status work has been started.
- Internal fallback switches have been introduced for adaptive cleaning and legacy sequential behavior.
- Focused Adaptive ROI Python tests previously passed 8/8.

The work is **not release-ready yet** because verification and several integration details remain unfinished.

---

## 1. Fix the current TypeScript compile failure

### Current failure

`tests/export/reviewGate.test.ts` still creates a `PageCleaningResult` fixture without the new prepared-result metadata, currently failing with:

```text
Property 'maskFingerprint' is missing in type ... but required in type 'PageCleaningResult'.
```

### Work

- Decide whether `maskFingerprint` should remain required in the public `PageCleaningResult` contract or be optional for compatibility with older/restored fixtures.
- Prefer compatibility where a missing fingerprint means "cannot prove reusable identity" rather than crashing.
- Update old test fixtures only when the field is semantically required.
- Re-run TypeScript typecheck until clean.

### Gate

```text
npx tsc --noEmit
```

Must exit `0`.

---

## 2. Finish Ticket 01 — Prepared-page Identity & Reusable Clean Asset

### Required behavior

Prepared cleaning output may be reused only when its identity still matches:

```text
source image revision
+ text-removal mask revision
+ cleaning policy / model revision
```

Translation-only settings such as target language and glossary must **not** invalidate cleaning.

### Remaining implementation checks

- Finalize the identity fields saved in `StoredCleaningResult`.
- Ensure `pipelineVersion` is persisted and checked on restore.
- Ensure source fingerprint is checked before returning an in-memory cached result.
- Ensure mask fingerprint is checked when restoring from IndexedDB/service disk assets.
- Ensure a missing/old metadata field safely causes recomputation rather than stale reuse.
- Ensure a user re-clean/retry replaces the previous prepared identity.
- Ensure cache survives app restart when all identity components still match.

### Tests

Add/finish regression tests for:

- same source + same mask + same pipeline → reuse
- same page URL but changed source → recompute
- changed mask → invalidate
- changed pipeline version → invalidate
- glossary/target language change → reuse clean result
- legacy metadata without identity → recompute safely
- restart restore with matching identity → reuse

---

## 3. Finish Ticket 03 — Quality-first Adaptive ROI Cleaning

### Required behavior

Use normalized page metrics, not fixed pixel thresholds:

- mask coverage
- spatial spread
- cluster count
- total ROI area ratio

### Routing

```text
Localized / compact mask
→ merged ROI LamaLarge

Distributed / high-area mask
→ full-page LamaLarge
```

### Remaining implementation checks

- Verify clustered ROIs never include unauthorized text-removal pixels.
- Verify context padding is sufficient without changing protected pixels.
- Verify overlapping/nearby bubbles merge deterministically.
- Verify widely separated bubbles do not accidentally merge into a giant ROI.
- Verify large combined ROI automatically falls back to full-page.
- Verify no-mask page remains pixel-identical and performs no LamaLarge inference.
- Add route telemetry consistently to `timings_ms` or equivalent result metadata.

### Required telemetry

At minimum record:

```text
adaptive scope route
ROI cluster count
LamaLarge inference count
clean_ms
verification_ms
```

---

## 4. Finish Ticket 04 — Bounded ROI Escalation & Page Awaiting Review

### Required quality path

Maximum three preparation attempts per prepared-page revision:

```text
1. Normal / merged ROI
        ↓ verification fail
2. Expanded ROI
        ↓ verification fail
3. Full-page LamaLarge
        ↓ verification fail
Page awaiting review
```

No fourth automatic retry and no recursive retry loop.

### Remaining implementation checks

- Ensure attempt 2 truly expands ROI/context rather than simply repeating the same mask/crop.
- Ensure attempt 3 uses full-image context.
- Ensure accepted output from each stage is committed only inside authorized support.
- Ensure failed attempts restore original pixels before the next attempt.
- Ensure `awaiting_review` is propagated from Python schema → API → TypeScript client → workspace orchestration.
- Page awaiting review must **not** be sent to Gemini automatically.
- A review-required page must not stop unrelated pages from continuing.
- Explicit user retry must still be possible.

### Tests

- ROI passes first attempt → exactly 1 attempt.
- ROI fails, expanded passes → exactly 2 attempts.
- ROI + expanded fail, full-page passes → exactly 3 attempts.
- all three fail → `awaiting_review=true`.
- no automatic attempt 4.
- protected/outside-support pixels unchanged across all paths.

---

## 5. Finish Ticket 02 — Bounded N+1 Clean/Translate Pipelining

### Target orchestration

```text
Translate page N
        +
Prepare/Clean page N+1
```

Constraints:

- maximum one prefetched page
- no N+2 prefetch
- Gemini requests remain serial
- page order remains stable
- no extra cloud requests caused by prefetch

### Remaining implementation checks

- Prefetch begins only after current page is prepared and translation starts.
- When current translation completes, reuse the completed N+1 prepared promise/result immediately.
- If N+1 prefetch fails, record only N+1 cleaning failure and continue other pages where safe.
- Targeted retry must preserve exact target pages.
- Pages already translated remain skipped unless explicitly targeted.
- Do not allow two cleaning preparations for the same page in one batch.
- Clean result completed after cancel may stay reusable, but must not advance the cancelled batch.

### Cancellation semantics

On Cancel:

- abort in-flight Gemini request immediately
- stop starting new prefetch work
- local inference already running may finish safely
- late local result may be cached
- cancelled batch must never resume itself from that late result

### Tests

Use deferred promises at the workspace orchestration seam to prove:

- Translate N overlaps with Clean N+1.
- Gemini request N+1 does not start before N finishes.
- only one prefetch exists at any time.
- Cancel stops future preparation/translation.
- late prepared result after Cancel does not move batch frontier.

---

## 6. Finish Ticket 05 — Truthful Batch Progress & Rolling ETA

### Primary progress rule

The progress position must follow the **Batch progress frontier** — the earliest page not yet fully ready for the user — not the highest page that merely started work.

### UI example

```text
กำลังแปลหน้า 20/36
กำลังเตรียมหน้า 21 ล่วงหน้า
เหลือประมาณ 14 นาที
```

### ETA rules

- Before 2 end-to-end completed samples: show `กำลังประเมินเวลาที่เหลือ...`
- After that: use rolling window of the latest 5 completed pages.
- Exclude first-page model warm-up from long-term projection.
- Exclude API quota waiting time.
- Exclude explicit retry backoff waiting time.
- Exclude user-review waiting time.
- Never use the prefetched page number to artificially advance the main percentage.

### Remaining work

- Finalize `translateAllProgress` shape and TypeScript types.
- Add optional `prefetchMessage`/secondary state without breaking existing UI/tests.
- Track completed page processing duration separately from excluded waits.
- Ensure skipped already-completed pages do not distort ETA.
- Ensure targeted retry ETA is based on target set size, not the full book.

### Tests

- first sample: no numeric ETA
- two+ samples: ETA appears
- rolling window capped to latest 5
- quota wait excluded
- retry delay excluded
- prefetch N+1 does not advance primary progress
- targeted retry uses correct total

---

## 7. Finish Ticket 06 — Performance Metrics, Kill Switch & Release Gate

### Internal fallback switches

Confirm both fallback paths work without exposing advanced architecture controls to normal users:

```text
Adaptive ROI OFF → legacy/full-page cleaning path
Prepared-page prefetch OFF → sequential clean → translate path
```

The fallback must be internal/diagnostic only.

Until the benchmark and quality gates are accepted, the optimized paths remain
disabled by default. Internal release opt-ins are `SUPERK_ENABLE_ADAPTIVE_ROI`
for the OCR service and `superk:enable-performance-pipeline` for the desktop
prefetch path; the switches above remain diagnostic fallbacks.

### Benchmark instrumentation

Record at least:

- batch wall-clock
- median page duration
- p95 page duration
- cleaning time
- Adaptive ROI/full-page route
- ROI cluster count
- escalation attempt count
- LamaLarge inference count
- peak RSS
- residual/automatic pass rate
- changed pixels outside authorized support
- protected-mask changes
- no-mask pixel identity
- Page awaiting review incidence

### Performance acceptance criteria

Against a fresh pre-optimization baseline on the same machine/runtime/input:

- batch median wall-clock improvement: **≥ 25%**
- pages using ROI: cleaning-time improvement: **≥ 30%** versus full-page baseline
- peak memory growth: **≤ ~25%**
- quality/safety gates: **no regression**

### Current benchmark blocker

The committed 30-page benchmark manifest references source images previously resolved under:

```text
F:\Doujin\Download
```

Those 30 source pages were not available during the latest run, producing:

```text
RuntimeError: unable to resolve 30 manifest pages
```

Do **not** fabricate a speedup number.

### Resolution options

Preferred order:

1. Locate the exact original corpus by its manifest hashes if still available locally.
2. If unavailable, restore/copy the exact corpus from its known source location.
3. Only if the original corpus is permanently unavailable, create a new fixed benchmark corpus and record a **new baseline before further tuning**, then use that corpus consistently for before/after measurements.

The performance ticket cannot be marked fully accepted until a valid comparable baseline exists.

---

## 8. Verification pass after implementation

Run focused tests first, then full suites.

### TypeScript

```text
npx tsc --noEmit
```

### Focused frontend/workflow tests

Run at minimum:

```text
tests/cleaning/useCleaning.test.tsx
tests/cleaning/projectStore.test.ts
tests/translation/useTranslation*.test.tsx
tests/export/reviewGate.test.ts
```

### Focused Python tests

Run at minimum:

```text
ocr-service/tests/test_adaptive_scope.py
ocr-service/tests/test_adaptive_pipeline.py
ocr-service/tests/test_pipeline.py
ocr-service/tests/test_api.py
ocr-service/tests/test_schemas.py
ocr-service/tests/test_lama_large_cleaner.py
```

### Full regression

```text
npm test
```

and the complete Python `pytest` suite under `ocr-service`.

All failures introduced by this feature must be fixed before continuing.

---

## 9. Code review

Review the complete diff, especially these risk areas:

- stale prepared-page reuse
- mask/source identity collision
- blob URL lifetime/revocation
- promise/prefetch race after Cancel
- duplicate cleaner job creation
- Gemini accidentally running in parallel
- retry/failure-group target-page correctness
- escalation loops exceeding 3 attempts
- protected/outside-mask pixel modification
- ETA arithmetic with skipped/failed/retried pages
- schema compatibility with persisted old jobs
- benchmark metrics that can double-count pipelined time

Use project diff/change-context tooling and fix findings before ticket closure.

---

## 10. Documentation and ticket closure

After tests pass:

- Update `.scratch/performance-pipelining-adaptive-roi/issues/01-06` with implementation evidence.
- Mark each ticket completed only when its acceptance criteria are actually verified.
- Update `.scratch/performance-pipelining-adaptive-roi/spec.md` with final verification evidence/status if the tracker format supports it.
- Keep `docs/adr/0005-bounded-prefetch-and-adaptive-cleaning-scope.md` as the canonical accepted architecture.
- Update benchmark documentation with real before/after measurements only after a valid corpus run.

---

## 11. Final Git safety check and commit

Before commit:

- inspect `git status`
- inspect full diff
- ensure no `.env` / API key / secret is staged
- ensure ignored ONNX/model/runtime binaries are not accidentally added
- ensure benchmark source images/results that should remain local are not staged
- ensure all intended new source/tests/spec/ticket files are included

Then create one coherent commit for this implementation, for example:

```text
perf: pipeline translation with adaptive ROI cleaning
```

Do not commit while typecheck or regression tests are failing.

---

# Definition of Done

This feature is complete only when all of the following are true:

- [ ] TypeScript typecheck passes.
- [ ] Prepared-page identity safely reuses/invalidate results.
- [ ] Adaptive ROI routes localized pages without quality regression.
- [ ] ROI escalation is bounded to maximum 3 attempts.
- [ ] Failed preparation becomes Page awaiting review and is not auto-translated.
- [ ] Translate N overlaps with Clean N+1, with only one prefetch.
- [ ] Gemini requests remain serial.
- [ ] Cancel semantics are race-safe.
- [ ] Batch progress follows the true frontier.
- [ ] ETA uses rolling completed-page throughput and excludes waits/warm-up.
- [ ] Internal legacy/full-page kill switches work.
- [ ] Focused JS/Python tests pass.
- [ ] Full JS test suite passes.
- [ ] Full Python test suite passes.
- [ ] Code review findings are resolved.
- [ ] Tickets/spec contain final evidence.
- [ ] Valid performance baseline/after comparison is recorded, or the performance gate is explicitly documented as blocked by missing exact corpus rather than falsely passed.
- [ ] Git safety review passes.
- [ ] Final implementation is committed.

## Recommended execution order

```text
1. Fix TypeScript contract / reviewGate fixture
2. Finish Ticket 01 identity/cache
3. Finish Ticket 03 Adaptive ROI
4. Finish Ticket 04 bounded escalation/review
5. Finish Ticket 02 N+1 pipelining
6. Finish Ticket 05 progress/ETA
7. Finish Ticket 06 metrics/kill switches
8. Focused tests
9. Full regressions
10. Resolve benchmark corpus + run performance gate
11. Code review
12. Update tickets/spec/docs
13. Git safety check
14. Commit
```
