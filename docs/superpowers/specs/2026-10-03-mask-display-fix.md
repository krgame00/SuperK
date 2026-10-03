# Mask display fix — 2026-10-03

## Symptom and cause

The mask editor showed cyan region bounds but no red removal pixels on already-cleaned review regions. Its initial asset selection used `textRole === "review"` to select `proposalMaskUrl`, even when the region had already been cleaned. In all-text mode, review role indicates uncertainty, not that cleaning was skipped: applied `mask.png` contains removed pixels while `review-mask.png` can be empty.

Read-only inspection of three completed local OCR jobs confirmed multiple review/clean regions with positive applied pixels and zero proposal pixels (e.g. 55,980 and 36,158 applied pixels). Assets were read without submitting new cleaning or provider requests.

## Fix

`components/cleaning/MaskEditor.tsx` loads the applied mask first. It falls back to the proposal once only if the selected review region has no applied pixels and there is no cached edited snapshot. Existing unsaved strokes and region scoping remain authoritative. This also supports manually cleaned regions whose role/action metadata does not describe whether applied pixels exist.

## Reproduction and verification

- Synthetic regression with nonempty applied mask and empty proposal reproduced invisible red pixels before the fix.
- A preserved review region with an empty applied mask and positive proposal checks the opposite path.
- Both new tests failed before the fix and passed afterward.
- MaskEditor, maskEdits and WorkspacePage: 3 files / 81 tests passed.
- TypeScript passed; changed-file ESLint passed without errors or warnings; diff whitespace check passed.
- No provider requests, source-image changes or cleaning algorithm changes.

Earlier editor fixtures used the same mocked pixels for every mask URL, which could not expose selection of the wrong asset. The new fixtures distinguish applied and proposal masks.

Independent review passed (35 focused tests). Production build passed; assets synced; served build A3RjXmc1WR9spmy0Dc-c8 verified in HTTP 200 HTML. OCR health HTTP 200. Web PID 13232. OCR service remained running. No commit or push.
