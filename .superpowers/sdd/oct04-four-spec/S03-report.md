# S03 saved size ownership and parity — integrated

Status: implementation and UI are integrated; G06 owns the real browser/build acceptance pass. No provider calls, live runtime restart, or user key access were performed.

## Owned changes

- `hooks/useTranslation.ts`: explicit `resizeSavedText({scope:'point'|'page'|'book',pageUrl?,pointIndex?,returnToAuto?}):Promise<number>`; default excludes manual and legacy locks; explicit point-only Return Auto; original-pixel preparation outside gestures; revision/cache/page-membership guarded application; atomic Undo/Redo sizing/evidence/layout restoration; invalidates raster cache. `setTextStyle` wraps only global font multiplier changes in manual ownership and Undo, preserving later color edits. Optional stable `pageSourceFingerprints:Map<string,string>` and `PreparedTranslationPage.sourceFingerprint`, `getPageSourceRevision`, used in ordinary/manual/book contextual reviews. Missing source identity blocks human confirmation. Production-stamped `getCurrentRenderedOutput(pageUrl):{url,signature}|undefined` binds source/target/policy/background/style/bubble state and rejects stale or unproven rasters.
- `lib/savedTextSizing.ts`: focused sizing snapshot/restore, legacy/manual ownership detection, explicit reset to Auto. Snapshots preserve geometry, evidence, snapshot, and manual user space without replacing translation/style fields.
- `lib/sourceTextSize.ts`: explicit manual ownership retains existing original evidence; legacy user sizing gets clearly unmeasured fallback evidence rather than a fabricated measurement.
- `lib/sourceTextSizeClient.ts`: optional target set prepares selected points while retaining all page regions as space-analysis neighbors. Manual exclusions remain untouched.
- `lib/translationOverlay.ts`: direct and committed corner sizing becomes manual; Undo restores ownership/evidence. Width/move/rotation preserve sizing mode. Optional `userTextSpace` metadata records legitimate committed user frame geometry separately from OCR/source balloon evidence and participates in bounded growth only at matching original dimensions. Fixed actual fallback null-delete crash uncovered by renderer test.
- `tests/translation/useTranslation.sourceSize.test.tsx`: real public hook sizing, manual/legacy exclusion, Return Auto, Undo/Redo, global ownership/color preservation, stable source identity, cache proof and direct mutation invalidation, neighbor context coverage.
- `tests/cleaning/translationOverlayCornerDrag.test.ts`: actual renderer/gesture manual ownership, legacy unmeasured marker, user space, Undo, plus saved preview/reopen/offscreen parity at .44/1/1.6 zoom.
- `tests/cleaning/projectStore.savedSize.test.ts`: actual IndexedDB roundtrip preserves manual evidence/layout/user space and evicted raster remains absent.
- `tests/translation/useTranslation.legacyReview.test.tsx`: supplies explicit stable original fingerprint fixture for new source identity contract.

## RED → GREEN evidence

1. Public saved sizing action absent (`resizeSavedText is not a function`) → explicit action implemented; ownership, Undo, cache test passes.
2. Global font change left mode auto → setter wrapper marks manual and records exact Undo sizing evidence; later color preserved.
3. Renderer corner ownership test exposed fallback null-delete crash, then manual-mode assertion → guarded cleanup and committed manual ownership pass.
4. Legacy direct sizing lacked manual metadata → unmeasured manualSourceSizing marker passes.
5. Explicit user space absent → committed width/corner metadata and Undo/Redo preservation pass.
6. Stable source revision API absent → fingerprint contract passes independent of page edit revisions.
7. Production cache evidence API absent → exact signature accessor passes; direct text mutation invalidates it without dirty callback.
8. Selected preparation omitted manual neighbor context (`0,0,1000,1000` instead of both regions) → optional target set retaining full context passes.

Persistence and existing-renderer zoom/export tests confirm current behavior through real seams; they were verification coverage, not manufactured failing implementation tests.

## Exact verification commands

`node node_modules/vitest/vitest.mjs run tests/translation/useTranslation.sourceSize.test.tsx tests/translation/useTranslation.legacyReview.test.tsx tests/translation/useTranslation.atomicCache.test.tsx tests/translation/useTranslation.replaceBubbleText.test.tsx tests/cleaning/projectStore.savedSize.test.ts tests/cleaning/translationOverlayCornerDrag.test.ts tests/unit/sourceTextSize.test.ts tests/unit/sourceTextSizeComplex.test.ts`

Final result: **8 files / 47 tests pass** (17:51:19 run). Previous checkpoint was 44; three additional zoom parity cases now included.

`node node_modules/typescript/bin/tsc --noEmit`

Final result: **exit 0**. Earlier failures in concurrent remnant-review fixtures are now resolved by owning slice.

`node node_modules/eslint/bin/eslint.js hooks/useTranslation.ts lib/savedTextSizing.ts lib/sourceTextSize.ts lib/sourceTextSizeClient.ts lib/translationOverlay.ts tests/translation/useTranslation.sourceSize.test.tsx tests/cleaning/translationOverlayCornerDrag.test.ts tests/cleaning/projectStore.savedSize.test.ts tests/translation/useTranslation.legacyReview.test.tsx`

Result: **exit 0; 0 errors, 4 pre-existing hook warnings** (unused scopedRecognitionImage/TextStyleProfile; existing pages.length dependency; performTranslation callback dependency).

`npx` failed because installed npx points to missing roaming npm CLI; all tests ran via direct installed node module CLI.

Relevant installed Next documentation read: `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md`.

## Integration needs and remaining work

- `SavedTextSizeControls` is now mounted in the workspace toolbar. It provides point/page/book resizing and selected-point Return Auto; controls disable without a current page or during another operation.
- Extension handoff now carries the verified reader image URL separately from the locally persisted original image bytes, so the source fingerprint used by the hook survives save/reload and publish-back retains the correct reader target.
- Existing behavior remains: the original pixel identity comes from the stored source, not the edit revision, and unproven cached rasters are regenerated behind the export gate.
- Source-free handwritten translations still require explicit image-backed point review; no generic page approval was added.
- Automated renderer tests cover .44/1/1.6 zoom and ownership restore. Browser acceptance at 44/100 and reload/export is part of G06.
