# Overlay drag performance

User reports stutter during text movement and corner scaling. Preserve the approved font/width/ratio behavior and Undo/Redo.

## Reproduction ledger

- Source trace: wrapper movement synchronously calls renderBubble on every pointermove. Corner scale, move handle and rotation do the same; only width batches via animation frames. Each render measures wrapping and resets/redraws the text canvas, then reads chrome geometry.
- Deterministic burst: 40 move events repaint 160 glyph lines; 40 corner events repaint 120 lines before a frame. Equivalent existing width batching test passes, disproving the claim all drag paths already coalesce.
- Ranked contributors: unnecessary glyph layout/paint on movement; unbounded scale rendering per event; repeated geometry read after style writes; style/color sampling on release (not continuously); React/autosave (not called on ordinary pointermove, ruled out for the burst).

## Fix

Position-only movement and rotation reuse the text bitmap and update frame/overflow/chrome. Corner and other handle previews coalesce onto the latest pointer event each animation frame. Pointerup flushes final coordinates before releasing capture; cancellation cancels pending previews and restores the original frame. Preserve width no-op semantics, fixed font, ratio and export parity. Cleanup must cancel pending callbacks when the overlay is replaced.

Verification: burst paint-count regressions, final-release and cancellation tests, current overlay/width/scale/Undo/export tests, TypeScript and independent review. These deterministic tests measure redundant work; user/browser validation is still needed to assess perceived smoothness on their hardware.

## Implementation ledger

- Move preview now reuses its bitmap and coalesces geometry/chrome positioning by frame; the 40-event burst draws zero new glyph lines before release.
- Corner previews now coalesce alongside width. A queued release flushes exact final coordinates, and cancel/overlay cleanup discard callbacks. The burst test now draws once per preview frame rather than 40 times.
- Independent review identified stale persisted height after edge movement and snapping on a no-op rotation click. Both reproduced with failing tests and fixed: settle layout before save; apply the release only after real movement or a changed release position.
- Wrapper release now captures the latest coordinates; cancel restores the opening geometry. Starting geometry is captured immutably for Undo, verified after a subsequent cancelled drag.
- Current overlay suite: 83 tests passed. Broader overlay/export suite: 154 tests in 12 files passed. TypeScript and ESLint passed. Independent reviewer reran 83 overlay tests and approved with no remaining P1/P2 findings.
- Runtime updated after saved-work confirmation: production build and asset sync succeeded; hidden web PID 36840, build `3FI2Jbx70WH2pYW_2vjfu`. Web HTML matches that build; web and OCR health returned 200. Perceived smoothness on the user's browser remains to be checked.
