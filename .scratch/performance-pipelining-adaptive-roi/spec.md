# Prepared-Page Pipelining and Adaptive Cleaning Scope Specification

**Status:** implemented-awaiting-benchmark
**Triage:** benchmark corpus and Python pytest environment remain blocked

## Verification evidence (2026-09-10)

- TypeScript typecheck passes with `node node_modules/typescript/bin/tsc --noEmit --incremental false`.
- Full frontend regression passes: 94 Vitest files, 460 tests.
- Adaptive scope and pipeline deterministic test functions pass through the bundled Python runtime; `py_compile` passes for changed Python modules.
- The 30-page benchmark corpus is still unavailable, and the bundled runtime does not include `pytest`; performance and full Python-suite gates remain intentionally unclaimed.

## Problem Statement

Batch manga translation currently spends too much wall-clock time waiting for local page preparation and cloud translation in strict sequence. A page is cleaned locally, then sent for Gemini translation, and only after that page completes does the next page begin its local preparation. This leaves local compute idle while the application waits on network/API latency and makes large batches feel substantially slower than necessary.

Local cleaning is also more expensive than necessary on many pages. LamaLarge can be invoked over a full page even when the authorized text-removal mask occupies only a small, localized portion of the artwork. On CPU fallback systems this can turn cleaning into a dominant per-page cost. The application therefore needs to reduce both idle time between pipeline stages and the amount of image area sent through expensive neural inpainting, while preserving the existing mask authorization, residual verification, protected-artwork rules, cancellation semantics, and Gemini quota behavior.

The optimization must remain quality-first. It must not increase Gemini request concurrency, must not let prefetch advance translation order, must not use stale cleaned assets after a source or mask revision, and must not hide failed cleaning behind a speed optimization. The system also needs progress and ETA semantics that remain truthful once different pages can be at different pipeline stages concurrently.

## Solution

Introduce two coordinated performance mechanisms: bounded Prepared-page prefetch and Adaptive cleaning scope.

Prepared-page prefetch allows local preparation of page N+1 while page N is being translated, with at most one prepared page ahead of the Batch progress frontier. Gemini remains strictly ordered and single-request-at-a-time. A successful prefetched clean result is promoted into the existing clean-page asset/cache and may be reused later when its Prepared-page identity still matches.

Adaptive cleaning scope chooses whether a page should be cleaned through localized ROI inpainting or full-page inpainting. The choice is deterministic and based on normalized page-relative evidence such as mask coverage, spatial spread, cluster count, and aggregate ROI area. Nearby regions may be merged when that lowers inference work without creating an oversized crop. Quality verification remains authoritative: a prepared-page revision may escalate from normal/merged ROI to expanded ROI and finally to full-page LamaLarge, with no more than three quality attempts.

If all allowed cleaning attempts fail verification, the page becomes Page awaiting review and is withheld from automatic translation while unrelated pages may continue. Cancellation stops cloud work and prevents new local preparation from starting, while already-running local inference may finish safely and be retained only as a reusable prepared asset.

Progress is reported from the Batch progress frontier, with prefetch shown as secondary status. ETA is withheld until enough end-to-end samples exist, then uses a rolling window that excludes warm-up, quota waits, and user-review waits. The optimization is enabled by default only after benchmark gates prove a meaningful wall-clock improvement without quality or memory regressions, and an internal diagnostic fallback remains available to restore sequential/full-page behavior during regression investigation.

## User Stories

1. As a manga translator, I want the next page to be prepared while the current page is being translated, so that local compute time overlaps cloud latency instead of extending the batch serially.
2. As a manga translator, I want Gemini requests to remain one-at-a-time and in page order, so that performance improvements do not increase quota pressure or reorder translation results.
3. As a manga translator, I want the system to prepare no more than one page ahead, so that speed improvements do not cause uncontrolled CPU or memory growth.
4. As a manga translator, I want a prepared next page to begin translation immediately when its turn arrives, so that the system does not repeat local cleaning that already finished successfully.
5. As a manga translator, I want prepared clean results to survive cancellation when they are already complete, so that cancelled work is not needlessly recomputed later.
6. As a manga translator, I want valid prepared clean results to survive application restart, so that expensive local preparation can be reused across sessions.
7. As a manga translator, I want prepared results reused only when the source image revision still matches, so that an edited or replaced page never receives stale cleaning.
8. As a manga translator, I want prepared results invalidated when the text-removal mask changes, so that manual mask corrections are always honored.
9. As a manga translator, I want prepared results invalidated when the cleaning policy or model revision changes, so that cached output cannot bypass a newer cleaning contract.
10. As a manga translator, I want glossary, target-language, or translation-only setting changes to leave valid clean assets reusable, so that translation edits do not trigger unnecessary image processing.
11. As a manga translator, I want local cleaning to focus on localized text areas when that is safe, so that a small speech bubble does not require full-page neural inpainting.
12. As a manga translator, I want the application to preserve context around each ROI, so that LamaLarge still has enough nearby artwork to reconstruct the removed text naturally.
13. As a manga translator, I want nearby or overlapping text regions merged when appropriate, so that the application avoids multiple expensive inference calls for one local cluster.
14. As a manga translator, I want distant text regions kept separate when separate ROI work is cheaper than a very large merged crop, so that Adaptive cleaning scope remains efficient.
15. As a manga translator, I want the application to switch back to full-page cleaning when ROI coverage becomes too large or too spatially distributed, so that optimization does not become slower or lower quality than the existing path.
16. As a manga translator, I want ROI/full-page routing to use page-relative metrics rather than fixed pixel thresholds, so that behavior remains consistent across different manga resolutions.
17. As a manga translator, I want Adaptive cleaning scope to preserve the same authorized text-removal mask, so that performance optimization never broadens what the cleaner is allowed to erase.
18. As a manga translator, I want protected artwork and protected masks to remain unchanged, so that faster cleaning cannot damage logos, credits, UI, artwork, or user-protected regions.
19. As a manga translator, I want pages with no eligible text-removal mask to remain pixel-identical, so that the performance path cannot introduce gratuitous image changes.
20. As a manga translator, I want a normal ROI attempt verified using the existing quality guard, so that localized cleaning must meet the same acceptance standard as the current pipeline.
21. As a manga translator, I want a failed normal ROI attempt to receive one bounded expanded-ROI attempt, so that the cleaner can gain more visual context before falling back to full-page work.
22. As a manga translator, I want a failed expanded ROI to fall back to one full-page LamaLarge attempt, so that quality remains the final priority when ROI is insufficient.
23. As a manga translator, I want no more than three quality attempts for one prepared-page revision, so that difficult pages cannot enter an unbounded neural retry loop.
24. As a manga translator, I want a page that still fails after full-page verification to become Page awaiting review, so that a bad clean result is not silently treated as ready.
25. As a manga translator, I want Page awaiting review to be withheld from automatic translation, so that Gemini does not translate an image whose local preparation is known to be unacceptable.
26. As a manga translator, I want unrelated pages to continue when one page becomes Page awaiting review, so that one difficult page does not waste the rest of a large batch.
27. As a manga translator, I want a prefetch failure isolated to the prefetched page, so that a successfully translated previous page is never discarded.
28. As a manga translator, I want cancellation to stop cloud translation immediately, so that no further Gemini quota is consumed after I cancel.
29. As a manga translator, I want cancellation to prevent any new prefetch from starting, so that local work does not continue expanding after I have stopped the batch.
30. As a manga translator, I want already-running local neural inference to finish safely instead of being force-killed mid-operation, so that model/runtime state is not corrupted.
31. As a manga translator, I want a late successful local result after cancellation retained only as a reusable prepared asset, so that it cannot silently advance a cancelled batch.
32. As a manga translator, I want progress to report the earliest page not yet fully ready for me, so that the progress percentage represents useful completion rather than the furthest page that merely started.
33. As a manga translator, I want prefetch shown as secondary status, so that I can see that the next page is being prepared without confusing it with the page currently being translated.
34. As a manga translator, I want ETA to say that it is still being estimated before enough pages finish, so that model warm-up or one unusually slow first page does not produce a misleading long estimate.
35. As a manga translator, I want ETA calculated from recent completed pages, so that the estimate adapts to the actual throughput of the current batch.
36. As a manga translator, I want one-time model warm-up excluded from projected per-page ETA, so that startup overhead is not multiplied across every remaining page.
37. As a manga translator, I want quota cooldown time excluded from processing ETA, so that an upstream wait is not presented as local processing speed.
38. As a manga translator, I want user-review wait time excluded from processing ETA, so that the estimate represents machine work rather than time waiting for my decision.
39. As a maintainer, I want Prepared-page prefetch to use the existing clean-page asset/cache as its durable result store, so that the optimization does not introduce a second large cache with separate eviction rules.
40. As a maintainer, I want only one N+1 preparation task to exist in flight, so that concurrency and cancellation behavior remain bounded and testable.
41. As a maintainer, I want Prepared-page identity to be deterministic and content-aware, so that cache hit/miss behavior can be reproduced in tests.
42. As a maintainer, I want Adaptive cleaning scope thresholds to be internal and deterministic, so that behavior is benchmark-calibrated rather than dependent on arbitrary user tuning.
43. As a maintainer, I want ROI routing metrics recorded in benchmark output, so that performance changes can be explained rather than inferred from total timing alone.
44. As a maintainer, I want the number of LamaLarge inference calls observable in benchmark evidence, so that route changes cannot hide extra neural work.
45. As a maintainer, I want the implementation benchmarked against a fresh pre-optimization baseline on the same machine and inputs, so that claimed speedups are comparable.
46. As a maintainer, I want batch wall-clock improvement measured in addition to per-page cleaning time, so that pipelining benefit is captured even when individual translation latency is unchanged.
47. As a maintainer, I want ROI pages compared against their own full-page baseline, so that Adaptive cleaning scope is judged against the work it replaces.
48. As a maintainer, I want peak memory tracked during the optimized batch, so that a speed improvement cannot ship with unacceptable memory growth.
49. As a maintainer, I want existing residual, protected-mask, no-mask identity, and visual-review gates preserved, so that performance work cannot lower cleaning safety.
50. As a maintainer, I want an internal diagnostic fallback to sequential/full-page behavior, so that production regressions can be isolated without exposing architecture knobs to normal users.
51. As a reviewer, I want targeted regression cases for single ROI, merged ROI, distributed ROI, full-page fallback, mask revision invalidation, cancellation, and bounded escalation, so that the new decision paths are exercised directly.
52. As a reviewer, I want the feature enabled by default only after the accepted performance and quality gates pass, so that an optimization is not shipped solely because its unit tests are green.

## Implementation Decisions

### 1. Batch orchestration ownership

- The existing batch translation orchestration remains the owner of page order, retry/cancellation semantics, translation concurrency, progress, and transition of prepared pages into translation.
- Gemini translation remains strictly serial. The optimization does not introduce concurrent cloud translation requests.
- While page N is actively translating, the orchestrator may start local preparation for page N+1 only.
- The prefetch window is fixed at one page for the first release. Page N+2 cannot start local preparation until the Batch progress frontier advances and it becomes the new N+1 candidate.
- A prepared result may be consumed immediately when its normal translation turn arrives; otherwise the orchestrator follows the existing local preparation path.
- Prefetch is an optimization only. It must not alter page ordering, group-targeted retry semantics, quota cooldown semantics, or cloud request payload behavior.

### 2. Prepared-page identity and reuse

- Prepared-page identity is content-aware and contains enough revision information to distinguish source image, authorized text-removal mask, and cleaning policy/model state.
- A prepared result is reusable only when all identity components still match at consumption time.
- Translation-only settings such as glossary or target-language changes do not invalidate local cleaning because they do not change the prepared image.
- Successful prepared results are promoted into the existing clean-page asset/cache mechanism. No second durable image cache is introduced for prefetch.
- A cache entry missing because of normal cache eviction is treated as a miss and recomputed; it is not a user-visible failure.
- A source, mask, or cleaning-policy revision occurring while prefetch is in flight invalidates that result for the newer revision. A completed stale result must not replace or override a newer prepared-page identity.

### 3. Adaptive cleaning scope policy

- Adaptive cleaning scope is deterministic and quality-first.
- The scope decision uses normalized, page-relative metrics rather than raw pixel dimensions. The policy considers at least mask coverage, spatial spread, cluster count, and aggregate ROI area.
- Eligible text-removal regions that overlap or are sufficiently near one another may be merged into a shared ROI when doing so reduces total inference work while retaining adequate context.
- ROI crops include contextual padding around the authorized mask. Padding may expand the model input but must not expand the authorized area in which final output pixels may be committed.
- The policy rejects ROI when aggregate/merged ROI area becomes inefficient relative to the full page or when spatial distribution makes localized processing unsuitable.
- Thresholds are internal policy constants calibrated by benchmark evidence. They are not user-facing controls in the first release.
- A page with no eligible mask bypasses neural inpainting and must remain pixel-identical.

### 4. Bounded quality escalation

- Each prepared-page revision has at most three quality attempts.
- The first attempt uses normal or merged ROI when Adaptive cleaning scope selects ROI; when the initial policy selects full-page, unnecessary ROI attempts are skipped.
- A failed ROI verification may escalate once to an expanded/context-enlarged ROI.
- A failed expanded ROI may escalate once to full-page LamaLarge.
- Full-page verification failure ends automatic preparation for that revision. The page becomes Page awaiting review.
- The existing residual/verification guard remains the authority for escalation and pass/fail decisions; performance routing cannot override it.
- Pixel writes remain constrained to the authorized cleaning support, and protected regions retain existing protection rules at every escalation level.

### 5. Failure and cancellation semantics

- Failure of prefetched page N+1 does not invalidate a completed or in-progress successful translation of page N.
- A preparation failure prevents automatic translation of that page until the page reaches a valid prepared state or the user explicitly resolves/retries it through the supported review workflow.
- Cancellation stops current/queued cloud translation work and immediately prevents creation of new local prefetch work.
- Local neural inference already executing when cancellation occurs is not force-interrupted. Its result may finish normally.
- A successful late local result may be promoted to the reusable clean asset if its Prepared-page identity is still current, but it cannot advance the cancelled batch, trigger translation, or trigger another prefetch.
- A failed late result remains isolated and cannot restart the cancelled batch.

### 6. Progress and ETA semantics

- Primary batch progress is derived from the Batch progress frontier: the earliest page in the selected batch that is not fully ready for the user.
- A prefetched later page does not advance the primary progress percentage merely because preparation started or completed.
- Prefetch state is exposed separately as secondary status so the UI can indicate that the next page is being prepared concurrently.
- ETA is not shown as a numeric remaining duration until at least two pages complete end-to-end.
- Once enough samples exist, ETA uses a rolling window of the five most recently completed end-to-end page durations.
- One-time model/runtime warm-up, quota cooldown waits, and Page awaiting review/user-wait periods are excluded from projected processing throughput.
- ETA must remain monotonic only where justified by the recent throughput samples; correctness is preferred over cosmetic smoothness.

### 7. Observability and benchmark data

- Cleaning timing remains observable by stage and is extended where needed to identify Adaptive cleaning scope route, ROI/full-page decision, escalation count, and neural inference count.
- Batch-level wall-clock timing is measured separately from per-page local cleaning timing so that pipelining benefit is visible.
- Peak process memory remains part of benchmark evidence because bounded prefetch can increase overlapping working sets even when concurrency is limited to one page ahead.
- Performance metrics are diagnostic evidence and must not change cleaning correctness decisions at runtime.

### 8. Rollout and diagnostic fallback

- The optimized path is not considered production-default solely because functional tests pass.
- A fresh baseline is recorded from the current pre-optimization behavior using the same benchmark corpus, machine, runtime, and inputs used to evaluate the optimized implementation.
- After performance and quality gates pass, bounded prefetch and Adaptive cleaning scope become the default behavior.
- An internal diagnostic kill switch can restore sequential batch orchestration and full-page cleaning for regression investigation.
- The kill switch is not exposed as a normal Settings control in the first release.

## Testing Decisions

Tests should assert external behavior at the highest practical seam and avoid coupling to private helpers or exact internal algorithms. Helper-level tests may support difficult mathematical/geometry cases, but they do not replace the accepted feature seams.

### 1. Workspace batch orchestration seam

- Drive batch translation through the existing translation workflow with controllable local preparation and Gemini boundaries.
- Verify that while translation for page N is pending, local preparation for page N+1 may start.
- Verify that no preparation for N+2 begins before the frontier advances.
- Verify that Gemini never has more than one in-flight translation request and that request order remains page order.
- Verify that a prefetched result is consumed without repeating local preparation when its Prepared-page identity still matches.
- Verify source-image, mask, and cleaning-policy revision changes invalidate stale prepared results before consumption.
- Verify translation-only setting changes do not invalidate a valid prepared clean asset.
- Verify cancellation stops new cloud work and new prefetch, while a late local completion does not advance the cancelled batch.
- Verify a prefetched page failure is isolated and does not roll back an already successful previous page.
- Verify primary progress follows the Batch progress frontier and prefetch appears only as secondary preparation state.
- Verify ETA remains in estimating state before two completed pages, then uses recent completed-page samples while excluding warm-up, quota waits, and review waits.
- Prior art is the existing translation-hook batch, cancellation, operation-lock, atomic-cache, and diagnostic workflow test family.

### 2. Production cleaning pipeline seam

- Drive deterministic image and mask inputs through the production cleaning pipeline rather than calling ROI-selection helpers as the primary acceptance seam.
- Verify a localized mask selects ROI when policy thresholds make ROI beneficial.
- Verify nearby masks may be merged and produce one bounded localized preparation route.
- Verify spatially distributed masks can remain separate where appropriate and that aggregate ROI policy can instead choose full-page when localized work becomes inefficient.
- Verify ROI output only commits changes inside the authorized cleaning support and never changes protected pixels.
- Verify verification failure escalates in the accepted order: normal/merged ROI, expanded ROI, then full-page LamaLarge.
- Verify no prepared-page revision exceeds three quality attempts.
- Verify full-page verification failure produces Page awaiting review and a not-ready-for-automatic-translation result.
- Verify no-mask pages are pixel-identical.
- Verify deterministic policy behavior across equivalent normalized layouts at different resolutions.
- Prior art is the existing local cleaner, LamaLarge, cleaning-pipeline, mask/protection, and regression test suite.

### 3. Performance acceptance gate

- Capture a fresh baseline from the current pre-optimization implementation before enabling the new default.
- Use the existing 30-page reviewed cleaning corpus as the primary release comparison, with the same machine, runtime, model set, and input identities for baseline and optimized runs.
- Retain the protected corpus and existing visual-review requirements.
- Add targeted deterministic regression cases for: one small ROI; several nearby masks that should merge; distributed masks; aggregate ROI exceeding the full-page threshold; in-flight mask revision invalidation; ROI verification failure escalating to expanded ROI and then full-page; cancellation with an in-flight prefetch; and a no-mask page.
- Record batch wall-clock, median and p95 page duration, cleaning time, Adaptive cleaning scope route, LamaLarge inference count, peak RSS, residual/automatic pass rates, changed pixels outside support, protected-mask changes, no-mask identity, and Page awaiting review incidence.
- Acceptance requires batch median wall-clock to improve by at least 25% against the fresh baseline for the accepted benchmark workload.
- Acceptance requires pages routed through ROI to reduce local cleaning time by at least 30% versus those same pages under their full-page baseline.
- Acceptance requires peak memory growth to remain within approximately 25% of the fresh baseline.
- Existing safety/quality gates remain mandatory: residual and automatic pass expectations, zero changed pixels outside authorized support, zero protected-mask changes, text-free identity, rectangular-patch regression, and required human visual review must not regress.
- A performance win that fails any quality/safety gate is a failed release candidate for this feature.

## Out of Scope

- Increasing Gemini translation concurrency above one request at a time.
- Prefetching more than one page ahead in the first release.
- Introducing parallel LamaLarge inference across multiple pages.
- Replacing LamaLarge, AOT, CTD, or the current production ONNX runtime architecture as part of this feature.
- Solving the existing DirectML dynamic-shape compatibility issue beyond the already-supported provider/fallback behavior.
- Exposing raw ROI thresholds, thread counts, model settings, or architecture-level performance controls to normal users.
- Creating a second durable image cache dedicated to prefetch.
- Changing the authorized text-removal mask to make ROI faster.
- Weakening protected-artwork rules, residual verification, or no-mask pixel identity guarantees.
- Automatically translating a Page awaiting review.
- Force-killing an in-progress local neural inference when the user cancels.
- Reworking Gemini prompts, translation quality, terminology/glossary behavior, safety policy, or failure-group quota semantics except where needed to preserve existing behavior under pipelining.
- Replacing the existing benchmark corpus with a new unrelated corpus.
- Guaranteeing a fixed seconds-per-page result on every machine or manga resolution.

## Further Notes

- This specification implements the architecture accepted in ADR 0005, “Bounded Prepared-Page Prefetch and Adaptive Cleaning Scope.”
- Canonical domain terms are Prepared-page prefetch, Adaptive cleaning scope, Prepared-page identity, Batch progress frontier, and Page awaiting review.
- Prepared-page prefetch is deliberately not described as parallel translation. Cloud translation remains ordered and serial.
- Adaptive cleaning scope is deliberately not described as arbitrary cropping. The authorized mask and quality verification contract remain unchanged; only the neural processing scope is optimized.
- The current historical cleaning benchmark is useful prior evidence, but its older AOT/CPU result is not the performance baseline for this feature. A fresh pre-optimization baseline must be captured before implementation changes are used for the final performance comparison.
- The user-confirmed primary test seams are the workspace batch orchestration seam, the production cleaning pipeline seam, and the performance acceptance gate described above.
