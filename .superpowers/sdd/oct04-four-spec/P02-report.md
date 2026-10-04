# P02 report — smooth move/corner gestures via proportional bitmap previews — DONE

Branch `codex/translation-completeness`, base HEAD `af12f8c`. No git add/commit/push (controller commits). No provider calls, no server restarts, no full suite. Requirements: `.scratch/dense-page-text-interaction/issues/02-smooth-transform-gestures.md` per `P02-brief.md` decisions; baseline evidence `P01-report.md`.

## What was implemented

**1. Bounded proportional-layout snapshot (`lib/translationOverlay.ts`)**
- `:152-201` — new exported `BubbleProportionalLayout` (text + canvas fontFamily identity, float `fontSizePx`/`lineHeightPx`, wrapped `lines`, `frameWidthPx/HeightPx`, tight `selectionX/Y/Width/Height`, capture-time `bubbleMult`/`globalMult`, `overflow`), bound `LAYOUT_SNAPSHOT_MAX_LINES = 400`, and `isUsableLayoutSnapshot` identity/shape guard. Field `layoutSnapshot?` added to `TranslatedBubble` (`:113`) and `OverlayAdjustment` (`:141`).
- `:984-987` — on bubble setup the snapshot is adopted from `adj`/`legacyAdj` so localStorage-only restores get reopen parity.
- `:1006` — `saveAdjustment` persists the snapshot inside `OverlayAdjustment` (bubble object + compacted localStorage copy).
- `:1383-1419` — every full draw captures the snapshot (frame, float font, lines, selection, multipliers, overflow); empty-text renders delete it (`:1294`).
- Snapshot-driven renders (`:1171-1192`): when identity holds (text, font family, same multipliers, same frame within 0.5px) the render reuses lines/float font/line height/selection verbatim instead of re-wrapping — this is what makes release, reopen, movement, rotation, Undo and Redo reproduce the committed layout exactly (float font size instead of the old `Math.round` re-derivation). An explicit `snapshotScale` argument (`renderBubble(availableHeight, snapshotScale)`, `:1123`) rescales the captured layout for the corner-release crisp pass. **Invalidation is by identity**: text edits, font edits (A+/A−, global multiplier change) and width edits (frame-size mismatch) fall through to the fresh layout; movement/rotation keep the snapshot valid.
- **S02 constraints preserved**: matched-auto bubbles (`sourceSizing.mode==='auto' && status==='matched'`, `:1176`) are excluded from the snapshot fast path and always re-run the fresh constrained layout — `constrainSourceLayoutHeight`, matched-auto no-recenter (`:1064` skip of `fitTextInAdaptiveBubble`) and the manual floor are untouched; scale-commit heights survive because the constraint never shrinks below the existing/`manualMinHeightPx` height.

**2. Corner drag = captured bitmap + CSS proportional sizing**
- `:2043-2044` — per-handle `scaleDragSnapshot` (layout + cloned selection) and `rInitSnapshot`.
- `:2076-2091` — pointerdown captures the initial rendered lines/font/selection **once** (`b.layoutSnapshot` + `textSelection` clone); `rInitSnapshot` is captured for all handle kinds.
- `:2232-2262` — `applyPointerMove` scale branch: same scale math as before, then a bitmap preview — scaled selection from the snapshot (`selection × k`), geometry-only `pinScaleAnchor()`, page-bounds revert restoring the previous scale (selection rescaled, no canvas work), and a **single** `updateBubbleFrame()` per input. The canvas backing store is never resized or redrawn during the drag; the bitmap is rescaled by the wrapper's proportional CSS size (`width/height:100%`).
- `:2045-2051` — `pinScaleAnchor` is now pure geometry; callers issue the single frame update.
- Fallback: bubbles without a snapshot (e.g. script-blocked or empty text) keep the old per-move `renderBubble` path (`:2263-2278`).
- `:2318-2399` — pointerup: flush applies the latest pointer (bitmap), no-op restores the snapshot selection; the commit renders crisply **once** via `renderBubble(undefined, currentBw / rInitBw)` (`:2356`), re-pins (`:2362-2365`), clears the drag snapshot and saves. Undo/Redo closures restore geometry + font + `b.layoutSnapshot` (`rInitSnapshot` / `finalSnapshot`, `:2372-2421`) so redo reproduces the float-font committed state bit-exactly.
- `:2424-2448` — pointercancel restores geometry, font, `b.layoutSnapshot`, the captured selection, and clears the drag snapshot.
- `:1383-1396` — the release render pins against the **scaled snapshot selection** (not a fresh measurement, whose padding is additive rather than proportional) so previewed anchor/frame are preserved exactly; the capture echoes those bounds, keeping persisted snapshots deterministic across re-renders.
- Corner commit already stores manual sizing (`b.targetFontSize` float from `rDragTargetFs`, `manualMinHeightPx = final height`) — unchanged, now additionally backed by the persisted snapshot. **S03 coordination**: renderer still passes `explicitUserSpace: undefined`; S03's metadata integration is untouched.
- Keyboard arrow resize (`:1917-1946`) and A+/A− font buttons (`:1846-1870`) also capture/restore `layoutSnapshot` in their Undo/Redo closures for the same float-parity reason.

**3. Double `updateBubbleFrame` removed**
- The pre-draw `updateBubbleFrame()` inside `renderBubble` (old line 1187, evidenced in P01) is gone; every path ends with exactly one frame update after draw/capture (empty-text early return keeps its own, `:1295`). The move path was already single-update and is untouched.

**4. Lazy wrapper bounds in chrome**
- `:2773-2780` — `positionChromeControls` reads the stage rect first and only calls `wrapper.getBoundingClientRect()` when stage dimensions are zero (fallback path unchanged); the normal rotated-bounds derivation is preserved.

## Tests (TDD)

New focused file `tests/cleaning/translationOverlayCornerDrag.test.ts` (8 tests) with font-aware measure counting, its own storage-write counter, viewport-wrapped fixtures, and `selectionSouthWest` anchor math.

- RED command: `node node_modules/vitest/vitest.mjs run --root . tests/cleaning/translationOverlayCornerDrag.test.ts`
  Output: `Tests 5 failed | 3 passed (8)` — zero-glyph/measure drag (got 8 extra renders), single crisp release (2 renders' worth of lines), float font `bold <fs×1.25>px` (got rounded), snapshot fields (undefined), invalidation (undefined). The 3 passing were pre-existing-behavior guards (cancel restore, no-op click, cleanup).
- GREEN (same command): `Tests 8 passed (8)`.
- Updated the coalescing test that required preview glyph draws — `tests/cleaning/translationOverlay.test.ts:1664-1690` now asserts zero glyph draws during the coalesced bitmap preview, wrapper growth via CSS, and one crisp render on release.
- Focused suites (final):
  - `node node_modules/vitest/vitest.mjs run --root . tests/cleaning/translationOverlayCornerDrag.test.ts tests/cleaning/translationOverlay.test.ts tests/cleaning/sourceLayoutOverlay.test.ts tests/cleaning/sourceSizeOverlay.test.ts` → `Test Files 4 passed`, `Tests 115 passed` (93 tracked overlay regressions + S02's 9 + size 5 + new 8).
  - Plus `tests/unit/translationOverlayAdjust.test.ts tests/unit/translationOverlayAdjustments.test.ts tests/unit/ovalTextFitting.test.ts tests/unit/snapRotationToRightAngle.test.ts tests/unit/textFitting.test.ts tests/cleaning/projectStore.test.ts` → 70 passed; `tests/colorMatching/layoutCommitAdaptiveRecalculation.test.ts tests/colorMatching/autoMatchColors.test.ts tests/export/readabilityGeometry.test.ts tests/export/reviewGate.test.ts` → 26 passed.
- `node node_modules/typescript/bin/tsc --noEmit --pretty false` → exit 0.
- `node node_modules/eslint/bin/eslint.js lib/translationOverlay.ts tests/cleaning/translationOverlayCornerDrag.test.ts tests/cleaning/translationOverlay.test.ts tests/browser/dense-page-baseline.ts` → exit 0.

## Named browser comparison

Electron launcher worked in this environment (no escalation needed; one transient write failure on the first diagnostic attempt, clean retry, exit 0 both modes). Commands:

- `node scripts/verify-dense-page-baseline.mjs --name p02` → exit 0, `Baseline: true 36 scenes` → `P01-p02-baseline.json`
- `node scripts/verify-dense-page-baseline.mjs --name p02 --diagnostic` → exit 0, 36 scenes + trace → `P01-p02-diagnostic.json`
- `node scripts/summarize-dense-page-baseline.mjs --name p02` → exit 0 → `P01-p02-metrics.md`, `P01-p02-trace-summary.json`

All original `P01-*` artifacts preserved. Raw trace `P01-p02-diagnostic-trace.json` (~122MB) left local, uncommitted, per P01 precedent.

**Fixture extension (allowed by the brief for the gesture seam):** `tests/browser/dense-page-baseline.ts:53` now passes `targetLanguage 'th'` to `applyTranslationOverlay`. Without it the harness scene was silently broken by the later script-policy commits (G-series): with no target language every harness bubble is script-`blocked`, renders zero text, captures no snapshot, and the corner seam under test never engages (evidence: first p02 diagnostic run showed constant 53,706 measures with 0 fills — layout-before-blocked-return only). P01's baseline predates those commits, so its "627 fills" scene required the language argument to exist again.

**Corner (scale) drag, dense scenes, P01 → P02** (60 frame-paced inputs each):

| Metric | P01 | P02 |
|---|---|---|
| measureText during drag | 54,333 (~60ms) | **0** |
| fillText/strokeText during drag | 627 / 627 | **0 / 0** |
| getBoundingClientRect during drag | 664 (~405ms) | **243** (~140-200ms) |
| frame p95 / max (1600×2400/100/0.44) | 33.5 / 50.0ms | **16.8 / 16.8ms** |
| missed 60Hz slots (same scene) | 21 | **0** (1 in the 100%/1-zoom scene) |
| input→preview latency p95 | 30.2-34.4ms | **18.8-20.0ms** |
| release handler | 12.7-15.9ms | **5.0-6.6ms** |
| release renders (fillText calls) | 22 (two renders) | **10 (exactly one crisp render)** |
| preview→settled wrapper css drift | 0 | **0** (left/top/width/height exact) |

Move remains at p95 16.8ms with 0 missed slots and now also benefits from the lazy chrome reads (304→243 rects). Width (P03's seam) is functionally unchanged — its 553,794 measureText calls remain (now ~476ms vs 645ms due to less chrome interference) — P03 must still implement its reflow reuse.

Per the P01 limits: offscreen software-raster Chromium, frame-opportunity estimates, no compositor presentation telemetry — G06 should still validate the visible-GPU editing path.

## Owned files (touched)

- `lib/translationOverlay.ts` — all changes above.
- `tests/cleaning/translationOverlayCornerDrag.test.ts` — new focused suite.
- `tests/cleaning/translationOverlay.test.ts` — coalescing test updated for bitmap behavior (only that test).
- `tests/browser/dense-page-baseline.ts` — one-line fixture extension (target language), per brief allowance.
- `.superpowers/sdd/oct04-four-spec/P02-report.md`, `P01-p02-baseline.json`, `P01-p02-diagnostic.json`, `P01-p02-metrics.md`, `P01-p02-trace-summary.json`, `P01-p02-diagnostic-trace.json` (local only).

## Limitations / coordination notes

- **P03 (width)**: width-drag reflow still retypesets per input (553,794 measures unchanged). The snapshot validity intentionally treats any frame-width change as a width edit, so width previews cannot reuse the corner bitmap path; P03 should pass a computed layout through the draw path per its own plan. The persisted snapshot fields are available if P03 wants width-commit parity.
- **S03**: corner commit persists manual sizing (float `targetFontSize` + `manualMinHeightPx` + snapshot) and still passes `explicitUserSpace: undefined`; `constrainSourceLayoutHeight` runs on every fresh layout and matched-auto bubbles never take the snapshot path, so S03's space-evidence bounds are unaffected. Snapshot renders bypass re-layout entirely for non-matched bubbles — user-committed geometry is authoritative.
- **Selection fidelity**: snapshot renders echo the captured (scaled) selection instead of re-measuring; selection padding is additive, so after multiple corner commits the dashed selection rect can drift a few px from freshly measured tight bounds. It self-heals on any text/font/width edit. This trade is what makes preview→settled→reopen→undo anchor parity exact.
- Snapshot renders skip `measureTextSelection`'s result and the fixed-layout overflow computation; the overflow flag is carried in the snapshot. Floors-clamped corner commits therefore keep the pre-drag overflow flag (proportional scaling cannot create text overflow; only the 25px/8px floors can, and the flag then refreshes on the next fresh layout).
- External `b.render()` callers (e.g. `hooks/useTranslation.ts:409`) now render through the snapshot path when identity holds — that is the intended parity behavior for text-refresh flows (text edits invalidate by text identity).
- The single remaining pre-existing typecheck failure earlier in the session (`tests/workflow/legacyReviewWorkspace.test.tsx`, another agent's untracked file) was resolved by its owner before my final run; final `tsc --noEmit` is exit 0 over the whole tree.
