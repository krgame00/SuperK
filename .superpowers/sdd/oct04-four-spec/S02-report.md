# S02 progress — 2026-10-04

Status: IN PROGRESS; pure evidence implemented, safe renderer integration pending root ownership handoff. No commit, full suite, provider requests or server restart.

## Ownership / interfaces

- Root approved optional `SourceSizeEvidence.writingMode`/`rotation`, policy `original-body-direction-v2`, optional `SourceSizing.space: SourceTextSpaceEvidence`.
- Agent owns `lib/sourceTextSize.ts`, `lib/sourceTextSizeClient.ts`, new `lib/sourceTextSpace.ts`, new focused tests only. Root/G01 owns hook/overlay/page; those are untouched.
- `detectClosedSourceTextSpace(sample, localSeedRect, {sourceRevision, regionKey}, localExclusionRects)` takes original pixels and returns `policyVersion/sourceRevision/regionKey/quality/reason/rect?`. Returned rect is local sample coordinates. Flood rejects crop/image edge leaks, other OCR text sharing the component and nonwhite artwork within the proposed strip. Inscribed strip has border clearance. OCR seed is used to locate known text, never used as a balloon boundary.
- `constrainSourceLayoutHeight(existingRect, requestedHeight, evidence?, explicitUserSpace?)` preserves x/y/width and existing height, permits only contained growth, returns `overflow`. Unknown/stale-policy boundaries retain existing height. Explicit user space will require S03 ownership metadata integration.

## Tests observed

- New `tests/unit/sourceTextSizeComplex.test.ts`: RED vertical and 90-degree rotation unreliable; GREEN after component column grouping and known-angle original pixel deskew. RED absent direction metadata vertical; GREEN after fallback column inference from actual component positions.
- Existing horizontal tests remain passing (including horizontal fixture incorrectly labeled vertical, which remains uncertain).
- New `tests/unit/sourceTextSpace.test.ts`: missing-module initial run, then API stubs yielded expected assertion RED for reliable enclosure and explicit-user height. GREEN closed white rectangle, edge gap, other OCR region, unknown boundary and explicit space limit.
- Latest: `node node_modules/vitest/vitest.mjs run --root . tests/unit/sourceTextSizeComplex.test.ts tests/unit/sourceTextSize.test.ts tests/unit/sourceTextSpace.test.ts` => 3 files / 16 tests PASS at 12:16:45.

## Remaining

1. Preparation integration complete: bounded original crop margin128..384, <=2million pixels; page-coordinate returned rect; cache includes sorted neighboring OCR keys so adding another region invalidates previously reliable shared space. New preparation test observed RED missing space then GREEN persistence/cache/neighbor invalidation.
2. Browser evidence implemented in new independently owned complex fixture. Further safe renderer browser acceptance pending integration.
3. Root serialized overlay integration: preserve matched size, whole-word wrapping, unknown space retains height and position (no initial auto recenter/grow), reliable/explicit space limits growth; visible overflow and native diacritics. Side/corner contracts remain. Integration acceptance is required before claiming S02 complete.
4. Focused type/lint checks and independent review after integrated changes.

## Limits

Separated regular high-contrast bodies may match (dialogue/captions/regular SFX); irregular, colored/effect-contaminated, blurred, clipped or ambiguous artwork evidence remains fallback. Inferred rotated angle is not claimed. Original analysis is preparation only. No universal accuracy claim.

## Verification update 12:21

- `node node_modules/vitest/vitest.mjs run --root . tests/translation/sourceSpacePreparation.test.ts tests/translation/sourceSizePreparation.test.ts tests/unit/sourceTextSizeComplex.test.ts tests/unit/sourceTextSize.test.ts tests/unit/sourceTextSpace.test.ts` => 5 files / 19 tests PASS.
- `node node_modules/typescript/bin/tsc --noEmit --pretty false` exit0; focused eslint on6 owned source/tests exit0.
- New `tests/browser/source-size-complex.ts`, `.html`, `scripts/verify-source-size-complex.mjs`; readonly reuse of existing Electron launcher. Separate Vite port4181, no application restart. Sandbox GPU launch failed as in S01; escalated hidden Electron passed.
- `$env:SOURCE_SIZE_OUTPUT='.superpowers/sdd/oct04-four-spec/S02-browser-result.json'; node scripts/verify-source-size-complex.mjs` => exit0 / ok:true. Nine reliable cases: inferred upright vertical, explicit90°, explicit30° at zoom0.44/1/1.5. Independent unrotated source body22px, recovered source22px, calibrated output22px, every error0px. Zoom is presentation scale and all values are original-coordinate raster metrics.
- Colored outlined SFX over brown artwork => fallback `ambiguous-background-or-effects`; all unbounded white source fixtures have unreliable layout space. This browser run tests evidence/calibration, not yet overlay layout/word preservation/export acceptance.
- Final cache RED: changing `sourceRotation` with unchanged pixels/font/text reused stale source evidence. Added optional `SourceSizing.sourceInputKey` (original transcript/writingMode/sourceRotation identity), now changes trigger preparation. Focused 5 files/19 tests PASS at12:22:56; complete owned-file eslint exit0. Typecheck exit0.
- Parent requested moved translated-neighbor safety: added optional fifth `currentNeighbors: PixelRect[]` to `constrainSourceLayoutHeight`. Renderer supplies current page-coordinate layouts; helper limits downward growth to neighbor top when horizontal ranges intersect. Never reads pixels or changes base font, width or position. New moved-neighbor test RED (height60 instead25), then GREEN (5 space tests).

## Integration section — renderer completion 13:40

Status: INTEGRATION COMPLETE. The previous agent's partial `lib/translationOverlay.ts` diff was assessed and RETAINED (all four hunks correct); one latent-crash fix applied on top. Safe-layout renderer integration is verified RED->GREEN at the user seam and with a real-font Electron run. No git add/commit, no full suite, no provider calls, no server restart.

### Kept vs changed in the inherited partial diff

Kept unchanged (assessment: all four hunks correct and required):
- `lib/translationOverlay.ts:999` — initial `fitTextInAdaptiveBubble` is skipped for matched-auto bubbles so the original OCR box is never autoexpanded or recentered before the constrained path (fallback/manual sizing keeps the legacy adaptive behavior).
- `lib/translationOverlay.ts:1080` — font recalibration merges `{ ...autoSizing, ...resolveSourceFontSize(...) }` so `space` and `sourceInputKey` survive a family/text/font-load recalibration.
- `lib/translationOverlay.ts:1112-1131` — matched-auto layout calls `constrainSourceLayoutHeight(existingRect, Math.max(fixedLayout.requiredHeightPx, savedManualMinimum), evidence, undefined, neighbors)`; neighbors are built from every other non-deleted bubble's `layoutAdjustment`, scaled from its recorded `iw/ih` to the current page, with conservatively rotated axis-aligned bounds (`|w·cos|+|h·sin|`) around the unchanged center; space evidence is used only when `sourceRevision`+`regionKey` match the size evidence (the helper additionally checks `quality==='reliable'` + policy). `constrained.height` overrides `currentBh` (never below existing height) and its overflow is OR-ed into `fixedLayout.overflow`.
- `lib/translationOverlay.ts:1224` — `lineH = fontSize * 1.30` for every fixed-layout render: overflowing frames render at true line height instead of silently compressing lines (keeps Thai diacritics visible; squeeze previously also applied to non-matched width-managed frames — the 93 tracked `translationOverlay.test.ts` cases still pass).

Changed by this agent:
- `lib/translationOverlay.ts:1125-1126` — TS18048: `space.regionKey` was read after only an optional-chain comparison (`space?.sourceRevision === ...`), which crashes when `space` is undefined and the compared revision is undefined too; now `space && space.sourceRevision === ... && space.regionKey === ...`. Identical semantics, no narrowing hole. (The inherited diff postdated the 12:22 tsc run and had never been type-checked.)

### Exact changes with file:line

- `lib/translationOverlay.ts:2` (inherited) — import `constrainSourceLayoutHeight` from `./sourceTextSpace`.
- `lib/translationOverlay.ts:999,1080,1112-1131,1224` (inherited, kept) — see above.
- `lib/translationOverlay.ts:1125` (new) — undefined-narrowing fix described above.
- `tests/cleaning/sourceLayoutOverlay.test.ts:107-144` (new tests) — deterministic wrap seam (24 whole 52px `extraordinary` words in a 100px-wide oval frame = exactly 24 lines, requiredHeightPx = ceil(24·20·1.30/0.88) = 710px at 20px matched size) plus two tests:
  - `:120` "first matched render keeps the original box and grows only inside the closed space" — no saved layout: left/top/width stay exactly 10%/10%/10%, height = 55% (710px requested, closed space rect ends at y=650, contained growth stops at 550px), `layoutOverflow=true`, every drawn font `bold 20px sans-serif`.
  - `:130` "moved translated neighbors cap contained growth using conservative rotated bounds" — a 45deg-rotated neighbor's conservative AABB rises from y=441.42 to exactly y=400, capping growth at 30% (vs 34.14% for the same neighbor unrotated and 55% with no neighbor); overflow signalled; matched font preserved.
- `tests/browser/source-size-complex.ts:39-145` (extended fixture) — four real-overlay acceptance cases appended to the retained evidence cases:
  - `overlay-unknown-space` (`:68`): unbounded white balloon (space unreliable), 12-word translation: frame retains the OCR box exactly (38%/5%/24%/73.5%), `layoutOverflow=true`, canvas font px === `sourceSizing.baseFontSizePx`.
  - `overlay-closed-space` (`:88`): 4px black border closes the balloon (space rect `{x:113,y:6,width:75,height:288}`), 6-word translation: x/y/width preserved, height grows 73.5% -> 93% and the grown frame bottom stays inside the inscribed space (15+279 <= 294), matched font preserved.
  - `overlay-export` (`:129`): overlay canvas raster shows exactly 6 whole-word line bands at median spacing 52px = 1.30 x 40.74px (no silent squeeze), and the exported JPEG embeds the text (+2364 dark pixels vs the original image inside the frame strips outside the source E column).
  - `overlay-reopen-zoom-0.44` (`:135`): JSON-persisted bubble re-applied at 0.44 presentation zoom reproduces the identical layout (38%/5%/24%/93%), identical calibrated font px, translation text preserved.
- `scripts/verify-source-size-complex.mjs` — unchanged (reused launcher); the fixture now returns `overlayRows` alongside the retained `rows`.

### RED/GREEN commands and outputs

- New seam tests, integration temporarily disabled (`if (matchedAuto && false)` single-edit on the inherited hunk, reverted immediately after):
  `node node_modules/vitest/vitest.mjs run --root . tests/cleaning/sourceLayoutOverlay.test.ts` =>
  `3 failed | 6 passed`: "expected 71 to be close to 55" (unconstrained height 710px instead of the 550px space cap), "expected 71 to be close to 30" (neighbor bound not applied), plus the pre-existing unknown-space test failing on the grown height. RED proven for both new tests.
- After restoring the hunk: same command => `Tests 9 passed (9)`.
- Final focused suite: `node node_modules/vitest/vitest.mjs run --root . tests/cleaning/sourceLayoutOverlay.test.ts tests/cleaning/sourceSizeOverlay.test.ts tests/cleaning/translationOverlay.test.ts tests/unit/sourceTextSpace.test.ts tests/unit/sourceTextSize.test.ts tests/unit/sourceTextSizeComplex.test.ts tests/translation/sourceSpacePreparation.test.ts tests/translation/sourceSizePreparation.test.ts` => `Test Files 8 passed (8)`, `Tests 127 passed (127)` at 13:37:17 (was 5 files/19 tests at 12:16 before integration; includes the 93 tracked overlay regression tests).
- `node node_modules/typescript/bin/tsc --noEmit --pretty false` => exit 0 (was failing TS18048 before the :1125 fix).
- `node node_modules/eslint/bin/eslint.js <10 owned files>` => exit 0.

### Browser acceptance (real fonts, Electron)

- `$env:SOURCE_SIZE_OUTPUT='.superpowers/sdd/oct04-four-spec/S02-browser-result.json'; node scripts/verify-source-size-complex.mjs` (PowerShell form from the brief; run here as Git Bash env prefix) => exit 0, `ok:true`.
- The sandboxed-GPU launcher failure from 12:21 did not reproduce; the hidden `disableHardwareAcceleration` Electron window ran directly.
- Result JSON now carries the 9 retained calibration rows (upright vertical / explicit 90deg / explicit 30deg at zoom 0.44/1/1.5, body error 0, output body 22px) PLUS the 4 `overlayRows` above: unknown space keeps the original box with visible overflow at the matched size; trustworthy closed space grows only contained; export raster keeps 6 unsqueezed 1.30-spaced whole-word lines; reopen at 0.44 zoom is pixel-geometry identical.
- Measured note: calibration matches the OUTPUT text's own body metrics, so lowercase translations calibrate to ~40.7px when the source is a 22px cap-height column — the fixture asserts against the calibrated value, not a hand-picked size.

### Owned files (touched by this agent)

- `lib/translationOverlay.ts` (kept inherited diff; added :1125 narrowing fix)
- `tests/cleaning/sourceLayoutOverlay.test.ts` (appended 2 seam tests + wrap helper; file was already untracked from the inherited work)
- `tests/browser/source-size-complex.ts` (extended with overlay/export/reopen acceptance)
- `.super
powers/sdd/oct04-four-spec/S02-browser-result.json` (refreshed by the acceptance run)
- `lib/sourceTextSpace.ts`, `lib/sourceTextSize.ts`, `lib/sourceTextSizeClient.ts`, `tests/unit/*`, `tests/translation/sourceSpacePreparation.test.ts`, `scripts/verify-source-size-complex.mjs` — retained untouched from the pure slice (verified green).

### Limitations / notes for root

- Neighbors come from `layoutAdjustment` only (per the brief). Bubbles whose layout currently comes only from the legacy localStorage index (`legacyAdj`, bubble-object `layoutAdjustment` unset) are invisible as neighbors until their first interactive `saveAdjustment`; the space evidence still bounds those cases. The bubble object is the authoritative layout per the `compactOverlayPageKey` comment (`lib/translationOverlay.ts:218`), so this matches the brief's contract.
- Overflow frames center the line block; when unknown space retains a much smaller frame, lines beyond the canvas edge are clipped rather than rendered outside the bubble (text is never drawn over artwork; the overflow notice/title/aria signal it). A top-anchored overflow layout could show the first lines instead of the middle ones — cosmetic, left unchanged to avoid redesigning the draw path beyond this ticket.
- User-driven width/corner drags keep their ticket-03 contracts: the width handle's live reflow recomputes `currentBh` before `renderBubble`, whose constrained path then bounds automatic growth and persists it on release; the scale handle's floor (`manualMinHeightPx`) is honored because the constraint never shrinks below existing height.
- Explicit user space (`explicitUserSpace`) is passed as `undefined` from the renderer as agreed; S03 owns that metadata.
- `lineH` truthing at 1.30 for all fixed-layout frames also affects non-matched width-managed overflow (previously squeezed): intentional, diacritics stay visible; no tracked test asserted the squeeze.
