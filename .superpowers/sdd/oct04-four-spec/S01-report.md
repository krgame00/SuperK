# S01 resumed implementation report

Status: DONE for S01, ready for root review and staging. No commit/staging performed. Hook and overlay are frozen. G01 files are untouched.

## Evidence and root causes

- Existing focused baseline: `node node_modules/vitest/vitest.mjs run --root . tests/unit/sourceTextSize.test.ts tests/cleaning/sourceSizeOverlay.test.ts tests/translation/sourceSizePreparation.test.ts tests/translation/useTranslation.sourceSize.test.tsx tests/translation/useTranslation.test.tsx tests/translation/useTranslation.outlineRestore.test.tsx` => 6 files / 62 tests PASS at 11:41:51.
- Browser RED using `node scripts/verify-source-size.mjs` under escalated hidden Electron: original 8px E string had only two connected dark stem components per row; remaining E shapes fragmented into horizontal bars due to antialiasing below the dark<80 threshold. Temporary component/row diagnostic probe captured this in error output and was removed. Conservative source policy unchanged. Controlled source fixture now draws each E at x=28.5+35*n to establish connected small bodies, and must retain an explicit fragmented-source fallback case.
- Browser RED at 8px serif: reliable source dark body6, actual output7. Original 100px linear actualBoundingBox conversion does not account for small raster hinting. Criterion stays <=10% or strictly <1px, unchanged.
- Browser RED at 10px Thai Tahoma with combining marks: source7, actual output4. Added bounded glyph-only raster calibration in sourceTextSize.ts. It samples whole Intl.Segmenter graphemes (up to8 distinct) on a256x256 canvas, up to12 probes. It is invoked only during source preparation / font or text revision. No original image reads occur in render or pointer paths.
- Calibration correctly falls back where tiny Thai raster steps cannot hit source7 within tolerance (6 or8 pixels). Current browser rerun returns to source8/body6, which can potentially hit a reliable Thai6 output. Still pending result.
- Stale layout target RED: added sourceSizeOverlay test with stale auto base5 also in layoutAdjustment.targetFontSize; it rendered legacy-floor8 rather than existing sizing fallback. Fix removes matching derived size from bubble, active adjustment and legacy adjustment upon invalidation. Fresh focused run: 5 of6 files / 62 of63 tests PASS; remaining hook integration test canvas mock must simulate font raster probes.
- Notice idempotency confirmed by source: updateBubbleFrame resets wrapper.title to base overflow text/empty and aria-label to base before each append; no growing notice string.

## Current files

lib/sourceTextSize.ts, lib/sourceTextSizeClient.ts, hooks/useTranslation.ts, lib/translationOverlay.ts; tests/unit/sourceTextSize.test.ts; tests/cleaning/sourceSizeOverlay.test.ts; tests/translation/sourceSizePreparation.test.ts; tests/translation/useTranslation.sourceSize.test.tsx; source-size browser fixture/runner; existing useTranslation.test.tsx and outlineRestore test mocks (outlineRestore G01 pageTargetCache addition must not enter S01 staging).

## Launch/environment

Electron sandbox launch fails GPU subprocess DLL startup (-1073741515); escalated launch works. Isolated userData .scratch/source-size-electron-profile and disabled hardware acceleration; Vite watcher ignores .scratch/.superpowers to avoid locked Cookies EBUSY. Temporary Vite port4179; no live3000 restart and no real provider calls. `npm` shim is broken (missing roaming npm-cli.js); run vitest via node directly. Browser JSON is written by SOURCE_SIZE_OUTPUT env, not positional args.

## Final verification

- Focused command above: **6 files / 63 tests PASS**, 2026-10-04 11:54:48, duration3.53s. Hook fixture now models separate source reads and font-only raster probes. Source preparation refreshes only automatic points when original pixel digest, region, font or translated text changes; unchanged evidence retains object identity, and legacy23px point stays untouched. Source-change test was observed RED before the refresh fix. Saved-layout region invalidation test was observed RED before derived adjustment cleanup.
- `node node_modules/typescript/bin/tsc --noEmit --pretty false`: exit0, no output.
- `node node_modules/eslint/bin/eslint.js lib/sourceTextSize.ts lib/sourceTextSizeClient.ts tests/unit/sourceTextSize.test.ts tests/cleaning/sourceSizeOverlay.test.ts tests/translation/sourceSizePreparation.test.ts tests/translation/useTranslation.sourceSize.test.tsx tests/browser/source-size.ts tests/browser/source-size-electron.cjs scripts/verify-source-size.mjs`: exit0, no output. Earlier new CJS path require lint failure fixed with the existing eslint annotation convention.
- Escalated PowerShell browser command: `$env:SOURCE_SIZE_OUTPUT='.superpowers/sdd/oct04-four-spec/S01-browser-result.json'; node scripts/verify-source-size.mjs`: **exit0, ok:true, 30 matched rows and2 explicit uncertain cases**. Latin sans/serif source nominal7/8/16/30; Tahoma Thai combining vowels/tone marks source nominal16/30; zoom0.44/1/1.5. Largest visible-body error: **1px/12px =8.33%**, all remaining cases exact. Strict criterion unchanged: <=10% or strictly<1 source pixel.
- Real tiny Latin sourcebody5 -> actual outputbody5, base6.944px sans and7.463px serif: both bypass8px and14px legacy floors, with readability warning. Every row preserves rendered bitmap after JSON save/reopen and identical visible/offscreen export.
- Explicit uncertainty: fragmented antialiased source retains conservative source fallback; reliable sourcebody6 with tiny Tahoma marks has an actual font-raster gap (4px below approx8.5px and8px above), so it is labeled fallback with font.loaded=true and font.reliable=false. Diagnostic probes removed.

## Final calibration mechanism and limits

The initial100px visible glyph metric gives a bounded candidate range. Up to12 font-only raster probes (up to8 unique whole graphemes,256x256 temporary canvas) find a matching height or a candidate within10%. Persisting matchedFontSizePx preserves the selected actual raster candidate; a second linear rescaling was observed RED (Thai target12 ->13px probe then erroneous10px output) and removed. Font/text revision can recalibrate once; movement and rotation update the existing frame/bitmap and never invoke source analysis or calibration.

The first source policy deliberately supports regular high-contrast separated horizontal letter bodies. Blank, blurred, colored outlined, clipped, irregular/artwork, vertical and rotated evidence falls back. Tiny antialias fragmentation and loaded-font raster gaps are documented uncertainty. This S01 slice does not claim reliable measurement for every font or source, or complete S02/S03 complex layout/manual/reading-extension delivery. Reading extension parity remains the later S03 concern; S01 verifies saved size plus visible/offscreen export.

No full suite run here; root owns the final combined suite.

## Staging boundary

Stage the S01 modules, hook/overlay integrations, S01 focused tests, scripts/verify-source-size.mjs and3 source-size browser files. Existing useTranslation test mocks preserve real canvasSampler exports while mocking sampleBubbleRegion so new normalization/preparation can work. `tests/translation/useTranslation.outlineRestore.test.tsx` contains this S01 partial canvasSampler mock hunk AND unrelated G01 `pageTargetCache` initial-state addition; stage only S01 mock. Do not stage projectStore, SettingsModal, languagePolicy, pageEligibility or their tests. Browser JSON/report are review evidence according to root's tracker conventions. No commit created by this agent.
