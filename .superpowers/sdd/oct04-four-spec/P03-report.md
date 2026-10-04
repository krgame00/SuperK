# P03 width reflow and dense-page performance — DONE_WITH_CONCERNS

Branch `codex/translation-completeness`; based on the approved P03 brief. No real user manga, provider calls, application service restarts, or live deployment were used.

## Changes

- `lib/translationOverlay.ts` now passes each width gesture's fixed-font layout into the draw path. Reuse is allowed only when normalized text, width, effective font size, font family, oval mode, minimum height, available height, and locale all still match. A mismatch falls back to fresh layout. This preserves complete-word wrapping, locked font size, live line wrapping, auto-size bounds, and overflow handling.
- Width release uses the already drawn exact layout instead of laying it out a second time. Pointerup also skips reapplying the last pointer coordinate when its preview already ran. It still applies and draws a newer pending release coordinate.
- Snapshot renders now measure selection bounds only when the snapshot cannot supply them. The width-preview test confirms an edited width refreshes the snapshot at the committed frame width. No-op corner release drops its per-gesture snapshot reference.
- The one-frame preview cache is local to the current pointer handler and is not retained; persisted layout snapshots remain bounded by the existing 400-line cap. No source-pixel analysis, provider request, or book-level calculation was added inside the pointer gesture.
- `tests/browser/dense-page-baseline.ts` includes a synthetic matched Auto source-size point in every benchmark scene, along with dense neighbors and long Thai text. The synthetic evidence drives the same matched-auto renderer branch without loading user work or running OCR.
- The hidden Electron fixture explicitly selects software raster because the GPU process fails to start in this session. Visible GPU behavior still requires G06 browser acceptance.

## Regression test and verification

Added the measurement-count regression to `tests/cleaning/translationOverlay.test.ts`.

- RED: `node node_modules/vitest/vitest.mjs run --root . tests/cleaning/translationOverlay.test.ts -t "width preview lays out the text once"` failed as expected: preview made 212 measureText calls, exceeding the one-layout bound of 156.
- GREEN: same command passed after the layout was forwarded.
- Focused integration command: `node node_modules/vitest/vitest.mjs run --root . tests/cleaning/translationOverlay.test.ts tests/cleaning/translationOverlayCornerDrag.test.ts tests/cleaning/sourceLayoutOverlay.test.ts tests/cleaning/sourceSizeOverlay.test.ts tests/workspace/SavedTextSizeControls.test.tsx tests/cleaning/useCleaning.remnantReview.test.tsx tests/cleaning/RemnantReviewPanel.test.tsx tests/cleaning/projectStore.savedSize.test.ts tests/translation/qualityReview.imageEvidence.test.ts tests/extension/workspaceHandoff.test.ts tests/extension/workspaceAppend.test.ts tests/extension/strictPublication.test.ts tests/chrome-extension/strictReader.test.ts tests/chrome-extension/strictEvidence.test.ts` — **14 files / 183 tests passed**.
- The 36-scene baseline and diagnostic runner both completed before and after with source sizing enabled. `node scripts/summarize-dense-page-baseline.mjs --name p03-before` and `node scripts/summarize-dense-page-baseline.mjs --name p03` generated separate before/after reports. Original P01/P02 evidence remains untouched.
- `node node_modules/typescript/bin/tsc --noEmit --pretty false` — exit 0.
- Scoped ESLint across the changed renderer, fixture, hook, UI, extension and regression-test files — exit 0. Four existing warnings remain in `src/app/page.tsx`; extension classic scripts are ignored by the repository lint rules.

## Measurements

Windows Electron 44 / Chromium 152, hidden 1800×2600 window, software raster, synthetic page fixture. Each run covers 1000×1400 and 1600×2400 pages, 10/50/100 points, 44%/100% zoom and move/corner-scale/width gestures. Width rows use live wrapping and matched Auto sizing on the selected long-Thai point. One pass per scene; these are not compositor or input-to-photon measurements.

| Width-only metric across 12 scenes | Before | After |
|---|---:|---:|
| Median per-scene frame p95 | 50.1 ms | 33.4 ms |
| Worst per-scene frame p95 | 66.6 ms | 50.0 ms |
| Median per-scene input-to-preview p95 | 48.3 ms | 28.3 ms |
| Missed 60 Hz slots, total | 578 | 176 |

For the dense 1600×2400 / 100-point / 44% width scene, diagnostic measureText calls fell from **553,794 to 295,437** (46.7% fewer); measured measureText time fell from 487.5 to 256.2 ms. Diagnostic instrumentation adds overhead; use the separate plain run for frame timings. The after dense scene still missed 36 frame slots, and no claim of 60 Hz on every input is made.

Move and scale were not changed by this ticket, but their paired offscreen timings varied upward in the post run (100-point dense/44% p95: move 16.8→33.5 ms, scale 16.8→33.4 ms). This is unexplained run-to-run variance and prevents a claim that this harness proves no timing regression outside width; G06 must validate the visible browser path on the user's graphics setup.

Compact evidence: `P01-p03-before-baseline.json`, `P01-p03-before-diagnostic.json`, `P01-p03-before-metrics.md`, `P01-p03-before-trace-summary.json`; after: `P01-p03-baseline.json`, `P01-p03-diagnostic.json`, `P01-p03-metrics.md`, `P01-p03-trace-summary.json`. The 118 MB raw traces remain in ignored `.scratch/P03-before-diagnostic-trace.json` and `.scratch/P03-after-diagnostic-trace.json`.
