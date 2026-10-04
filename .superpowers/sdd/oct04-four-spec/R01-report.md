# R01 report — background remnant evidence preparation (pure slice)

Branch `codex/translation-completeness`, work started from HEAD `77b2279` (controller has since committed other agents' slices on top; my footprint is exactly the two new untracked files below — no existing file was edited, no commit was made).

## New files (exact)

1. `C:\Users\PC\Downloads\manga-translator\lib\cleaning\backgroundRemnantInspection.ts` — the inspection module (types, detector, revision binding, bounded cache, confirmations, eligibility mapping).
2. `C:\Users\PC\Downloads\manga-translator\tests\cleaning\backgroundRemnantInspection.test.ts` — synthetic focused tests (20).

No other file was created, edited, staged, or committed. Existing evidence structures consumed read-only: `PixelRect` (lib/cleaning/types.ts), `BackgroundEligibilityState` type (lib/translation/pageEligibility.ts), `LRUMap` (lib/lruMap.ts). Revision identities are shaped to match `StoredCleaningResult.sourceFingerprint / maskFingerprint / revision` conventions without coupling to them.

## RED

Command:

```
node node_modules/vitest/vitest.mjs run --root . tests/cleaning/backgroundRemnantInspection.test.ts
```

Output (module did not exist yet):

```
Error: Failed to resolve import "@/lib/cleaning/backgroundRemnantInspection" from "tests/cleaning/backgroundRemnantInspection.test.ts"
 Test Files  1 failed (1)
       Tests  no tests
```

## GREEN

Same command after implementing the module:

```
 ✓ tests/cleaning/backgroundRemnantInspection.test.ts (20 tests) 16ms
 Test Files  1 passed (1)
       Tests  20 passed (20)
```

Full-verification commands and results:

```
node node_modules/typescript/bin/tsc --noEmit
# tsc OK (exit 0)

node node_modules/eslint/bin/eslint.js lib/cleaning/backgroundRemnantInspection.ts tests/cleaning/backgroundRemnantInspection.test.ts
# eslint OK (exit 0, 0 problems after removing two unused declarations found in an earlier run)
```

One intermediate RED→GREEN iteration fixed three real defects the tests caught: (a) a wrong expected pixel count in my own partial-remnant fixture (5x10=50, ratio 0.25 — classification was correct), (b) the detection-failure fixture tripping the dimension check before the data-length throw (fixture corrected to equal declared dims), and (c) a genuine design flaw: the cache returned raw results without applying artwork confirmations. Confirmations are now applied per call on top of the cached raw result via the exported pure `applyArtworkConfirmations`, so a cached result can never carry a stale confirmation.

## What the slice does

- Bounded inspection: candidate search is restricted to existing evidence areas — removal regions (`RemnantRemovalRegion`, shaped like `CleaningRegion`) and known text boxes (`RemnantTextEvidence`, `TranslatedBubble.box` 0-1000 convention). Artwork/hair/hatching outside those areas is never scanned and can never be flagged. It never assumes an OCR full-box removal or a style profile as source evidence: a text box without removal authorization yields at most an "unchanged-candidate" review finding, never a "removal failed" claim.
- Classification (deterministic luma-plane heuristic, honestly labeled): surviving ink inside an attempted-cleaning region is `suspected-remnant` (`full-glyph` / `partial-glyph` by surviving-ink ratio); short thin sparse runs (hatching/hair/line art) are downgraded to `uncertain` (`line-like`, confidence <= 0.35); untouched text with no removal authorization is `unchanged-candidate`; explicitly `preserved`/`protected` regions are known-kept and produce no candidates. Every state except `human-confirmed-artwork` is an open review finding — nothing is auto-erased, no mask is expanded, input planes are provably never written (byte-equality test).
- Unverified states never pass as clean: `missing-revisions`, `missing-original`, `missing-clean`, `dimension-mismatch`, `detection-failed` (caught, message recorded), `no-removal-evidence` (no evidence bounds the search) all map to eligibility `unavailable`.
- Exact binding and bounded reuse: `revisionKey = JSON.stringify(["background-remnant-inspection-v1", sourceRevision, backgroundRevision, removalRevision])` (detector version included; exact identity, not a collision-prone hash). `BackgroundInspectionCache` (LRU, default 8 entries, statistics only, no pixel buffers) reuses identical-revision results; any source/mask/background change misses the key and re-inspects.
- Artwork confirmation is scoped to exact candidate id + revisionKey; a changed background revision resurfaces the candidate.

## Proposed optional integration interface (NOT wired — awaiting integration lock)

All exports are additive and backward-compatible; nothing existing changes until G02/S02 adopt them.

Signatures (see the module for full JSDoc):

```ts
lumaPlaneFromRgba(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): GrayscalePlane
inspectBackgroundRemnants(input: BackgroundInspectionInput): BackgroundInspectionResult
applyArtworkConfirmations(result, confirmations): BackgroundInspectionResult
confirmCandidateArtwork(result, candidateId): BackgroundArtworkConfirmation | undefined
backgroundEligibilityState(result): BackgroundEligibilityState   // "approved" | "human-confirmed" | "unresolved" | "unavailable"
class BackgroundInspectionCache { inspect(input): BackgroundInspectionResult; invalidate(revisions): void }
```

Where it would later hook (proposed, for the owning agents):

1. Evidence extraction (a later hook, e.g. alongside `hooks/useCleaning.ts`): decode the page's original asset and the `cleanAssetId` blob to RGBA, convert with `lumaPlaneFromRgba`, and pass `removalRegions` from the stored `CleaningResult.regions` (id/rect/status/textRole) plus `textEvidence` from the page's bubbles (`id` + `box`) — excluding deleted points. The clean plane MUST be the clean background without translated overlays composited; inspection must run before overlay drawing (this is the "composed preview must not create findings from translated pixels" guarantee — enforced by construction here, since only the given planes are read).
2. Revision identity: `sourceRevision = sourceFingerprint`, `backgroundRevision = clean-asset fingerprint (or StoredCleaningResult.revision + maskFingerprint composite)`, `removalRevision = maskFingerprint + authorizationIdentity(regions)` (mirrors `hooks/useCleaning.ts` preparedIdentity). Recompute at the same lifecycle points where prepared identities are already refreshed, including Undo/Redo and source replacement.
3. Eligibility feed: `inspectPageOutputEligibility({ ..., backgroundState: backgroundEligibilityState(result), backgroundRevision })` — G01's boundary already requires background evidence by default; no pageEligibility change needed.
4. Review UI (S02/page): list `result.candidates` (`rect` for page marks, `box` for 0-1000 overlay marking, `evidence.meanLumaOriginal/meanLumaClean` + surviving-pixel counts for original/clean comparison at the same location), one action navigating the mask editor to `candidate.rect`. Explicit "confirm artwork" calls `confirmCandidateArtwork` and persists the returned `BackgroundArtworkConfirmation` with the page. Unverified pages render the `unverifiedReason` as "needs human review", never clean.
5. Runtime: the module is synchronous and provider-free; opening saved work triggers nothing. Keep `cache.inspect` out of live text-drag paths (call it at processing/output boundaries, per spec).
6. If adoption is declined, the module is inert: nothing imports it from app code, so it can be deleted without side effects.

## Honest limitations

- The detector is a deliberately simple luma/ink heuristic, not a text recognizer. It does not read characters; it compares original vs clean ink inside evidence areas. Stylized text matching artwork texture, or hatching coincidentally dense enough, can mislead it in both directions.
- Known blind spots (recorded, not hidden): surviving residue below `removedRatio` (0.12) or 6 px is not flagged; light-on-dark text is supported via a background percentile flip but not separately tuned; inverse-toned or gradient-heavy areas may shift the ink estimate; `maxCandidates` (200) truncates pathological pages — the result is then marked `truncated` and eligibility stays `unresolved`, so truncation never passes a page.
- Color information is reduced to luma; faint colored remnants under the ink threshold are invisible to it. Multi-frame correctness (e.g. screen-tone patterns) is untested with real assets — only synthetic fixtures.
- Planes are consumed as given: if a caller passes a composed preview instead of the clean background, translated glyphs inside evidence areas would surface as candidates. The API contract and integration note above place that responsibility on the hook; this slice cannot verify what it was handed.
- Reuse semantics: the revision identity is the invalidation signal. If a caller mutates pixels without changing `backgroundRevision`, the cache intentionally returns the previous result (exact-identity binding, matching the spec's "reuse valid checks on unchanged assets").
- 20 synthetic tests cover the brief's required fixtures (full/partial remnants, genuinely clean, hatching false-positive pressure, art outside evidence, preserved regions, missing original/clean, detection failure, dimension mismatch, missing/no evidence, unbindable revisions, revision invalidation, LRU bound, confirmation scoping and invalidation, plane immutability, box normalization, RGBA conversion). Real-manga validation has not been performed in this slice.

## R01 actual cleaning/workspace integration — resumed 2026-10-04

Status: owned cleaning/hook/UI integration ready for parent review; page/export wiring belongs to G04. Pure approved slice 0227c88 was preserved; the narrow later preservation correction below intentionally changes its semantics with detector version 2. No providers, service restarts, full suite, index writes or commits were used.

Owned integration files: hooks/useCleaning.ts; lib/cleaning/remnantReview.ts; lib/cleaning/backgroundRemnantInspection.ts; components/cleaning/RemnantReviewPanel.tsx; components/cleaning/MaskEditor.tsx; lib/projectStore.ts; tests/cleaning/{useCleaning.remnantReview,remnantReview,backgroundRemnantInspection,RemnantReviewPanel,MaskEditor,projectStore,useCleaning,useCleaning.restoreRace}.test.{ts,tsx}. Existing dirty MaskEditor/projectStore/confirmation work was retained; unrelated documents and CONTEXT.md were untouched.

Actual behavior:
- Stored cleanBlob is decoded alongside read-only original bytes before translated overlays. No composed raster input or image rewrite exists in this path. Short RGBA and missing/unreadable/mismatched originals or missing mask revisions stay unavailable.
- Opening saved work loads local stored assets only. Removed remote getCleaningResult/hydrate fallback; legacy/missing local assets remain unavailable until an explicit later reclean. Source fingerprints must match original bytes before local restore/recheck.
- getCurrentRemnantReview(pageUrl) provides the synchronous eligibility seam to G04. It checks the exact current cleaning result, original source fingerprint, clean/mask Blob references, mask fingerprint and authorization identity. Replacing results or starting reinspection drops prior approval immediately. A decoder completing after an in-place mask/authorization/blob edit cannot publish its older result. recheckPageRemnants(pageUrl) is local and provider-free.
- Candidate navigation uses existing overlapping removal bounds; original/clean comparison and focusRect mark the same location in MaskEditor. G04 was instructed to open this local UI directly, without resolveMaskRegion's job-recovery/reclean path. The reviewed panel exposes findings, unavailable evidence and inspected-empty findings with a cautious description of detector blind spots.
- Mask preservation/restoring source pixels is not artwork confirmation. Preserved/protected source ink is unchanged-candidate (or uncertain line-like art), requiring exact candidate/revision confirmation. Detector version changed to 2 to invalidate prior semantics. No mask expansion was introduced.
- Candidate artwork confirmations remain revision-scoped, persisted and bounded; source replacement invalidates page confirmations and removed pages discard their review/confirmation state. Generated-text eligibility remains independent.

RED → GREEN evidence observed:
1. Truncated actual canvas RGBA returned an apparently white luma plane: decoder test failed, length/dimension guard fixed it.
2. Missing local saved assets called getCleaningResult: actual hook test failed, remote opening fallback removed.
3. Exact current-review accessor was absent: hook test failed, binding/accessor added.
4. Same URL with replaced original bytes returned unresolved cached evidence: recheck test failed, current bytes are checked against saved source revision.
5. Missing mask identity synthesized unknown-mask and was bindable: seam test failed, removal identity remains empty/unverified.
6. Preserved/protected text had no candidates: pure regression failed, it now remains unresolved; removal permission and artwork confirmation are distinct.
7. Empty inspected UI rendered nothing: panel test failed, an honest inspection status is shown.
8. Mask edit during pending decode rebound old pixels to the newer mask: actual hook test failed, immutable input/binding snapshot and publication checks fixed it.
9. Production fingerprint test distinguishes equal-size equal-type different bytes (existing test-mode size fingerprint retained for older fake-timer fixtures). Original/clean image comparison and bounded navigation public seams pass.

Focused final commands (fresh after last edit):
```
node node_modules/vitest/vitest.mjs run --root . tests/cleaning/backgroundRemnantInspection.test.ts tests/cleaning/remnantReview.test.ts tests/cleaning/useCleaning.remnantReview.test.tsx tests/cleaning/RemnantReviewPanel.test.tsx tests/cleaning/MaskEditor.test.tsx tests/cleaning/projectStore.test.ts tests/cleaning/useCleaning.test.tsx tests/cleaning/useCleaning.restoreRace.test.tsx
# 8 files, 177 tests passed, exit 0
node node_modules/eslint/bin/eslint.js hooks/useCleaning.ts lib/cleaning/remnantReview.ts lib/cleaning/backgroundRemnantInspection.ts components/cleaning/RemnantReviewPanel.tsx components/cleaning/MaskEditor.tsx lib/projectStore.ts tests/cleaning/useCleaning.remnantReview.test.tsx tests/cleaning/remnantReview.test.ts tests/cleaning/RemnantReviewPanel.test.tsx tests/cleaning/MaskEditor.test.tsx tests/cleaning/projectStore.test.ts tests/cleaning/backgroundRemnantInspection.test.ts tests/cleaning/useCleaning.test.tsx tests/cleaning/useCleaning.restoreRace.test.tsx
# exit 0, no diagnostics
node node_modules/typescript/bin/tsc --noEmit --incremental false
# see parent final combined validation; earlier isolated final check passed before simultaneous S03 edits
```

The older useCleaning suite emits jsdom's unsupported canvas-context diagnostics; decode failure is deliberately unavailable. Actual R01 decoder tests use synthetic RGBA through real public decoder/hook seams. Synthetic full/partial glyph, clean, hair/hatching/art, missing evidence, revision/cache/confirmation/Undo-store coverage remains in the pure and integration suites. No real-manga recognition claim is made: faint/colored/small remnants and stylized text may be missed, dense artwork may be flagged. An inspected-empty result means no candidate detected inside known evidence areas, not proof that every source character is absent.

Adjacent whole-mask test timing correction: broad verification exposed the existing draft/Undo test intermittently checking alpha 150 immediately after navigating back, before the async image loader completed. Source trace showed the loader cancels obsolete callbacks and applies the stored cleared snapshot correctly. Replaced setTimeout(0) sleeps with exact public mask-pixel transition assertions (next 150, previous 0); no guessed production fix. Full MaskEditor 42 tests and final combined 177 tests pass. Actual cleaned-image Undo/Redo persistence is not claimed tested; see R02 readiness.

Final TypeScript result: the final `node node_modules/typescript/bin/tsc --noEmit --incremental false` invocation completed with exit 0 and no diagnostics after S03's simultaneous changes settled.

### R01 Important correction — known source evidence (2026-10-04)

Production inspection now receives current known source boxes through the optional public hook seam:

- `PageRemnantTextEvidence = { sourceContext: string; textEvidence: readonly RemnantTextEvidence[] }` (`sourceContext` is the stable original fingerprint, equal to the cleaning result sourceFingerprint).
- `setPageRemnantTextEvidence(pageUrl, evidence?)` synchronously snapshots/clones evidence, cancels obsolete inspection tokens, clears review binding and queues local inspection in a microtask. Equivalent id/box/context content is a no-op and triggers no decoding. Clearing evidence uses undefined.
- `getCurrentRemnantReview(pageUrl, expectedEvidence?)` synchronously rejects missing or mismatched installed/live evidence, empty expected source context, and evidence bound to a different original fingerprint. Output boundaries must supply current expected evidence to avoid setter-effect lag.

The pure revision/cache key includes source-box policy, exact box IDs/geometry and original source context. Artwork confirmations bind that key and cannot clear findings from new boxes. Clean assets and overlay composition are unchanged. Evidence boxes are SOURCE boxes, never render geometry; deleted points are filtered by the page consumer while cleaning regions continue to account for remaining known foreign/source ink under the approved policy. No pixel reads occur in pointer handlers. Page wiring and candidate comparison navigation are owned by G04/root, not this correction's files.

Regression reproduces a genuinely clean authorized rectangle and surviving original glyph ink in a known source box outside it: initially approved before evidence arrives; current expected evidence rejects that approval synchronously; queued local inspection publishes unresolved outside candidate. It also checks unchanged evidence does not decode, changed evidence does not reuse artwork confirmation, an obsolete pending decode cannot overwrite latest evidence, and missing/different source context fails closed.

Verification:
- RED: `node node_modules/vitest/vitest.mjs run tests/cleaning/useCleaning.remnantReview.test.tsx` — exit 1, 1 failed / 12 passed; expected undefined but received approved review before evidence binding.
- GREEN final: `node node_modules/vitest/vitest.mjs run tests/cleaning/useCleaning.remnantReview.test.tsx tests/cleaning/backgroundRemnantInspection.test.ts tests/cleaning/remnantReview.test.ts` — exit 0, 3 files / 58 tests passed (18:07:57, duration 2.25s).
- `node node_modules/typescript/bin/tsc --noEmit` — final exit 0. Earlier concurrent run reported G05 strictParity/strictEvidence errors; owner changes resolved them before final run.
- `node node_modules/eslint/bin/eslint.js hooks/useCleaning.ts lib/cleaning/remnantReview.ts lib/cleaning/backgroundRemnantInspection.ts tests/cleaning/useCleaning.remnantReview.test.tsx tests/cleaning/backgroundRemnantInspection.test.ts` — exit 0, no diagnostics.
- Global `npx` is unavailable (missing roaming npx-cli.js), so verification invokes local CLI entrypoints directly. No full suite, provider/restart commands, index or commits performed.
