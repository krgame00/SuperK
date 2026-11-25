# UI Fix Checklist Execution Plan — 2026-11-25

## Scope
Execute the outstanding items in `C:\\Users\\PC\\Downloads\\fix-checklist.md` against the existing Working Tree. Preserve all pre-existing modifications and the untracked `hooks/useDismissable.ts`. Do not reset, clean, commit, or push.

## Existing WIP to preserve
The current Working Tree already contains partial fixes for P0-1..P0-4, P1-1..P1-5, P1-7..P1-9, and P2-2. Verify each relevant path and test before treating it as complete.

## Execution status

- BLOCKED: workspace mutation tools returned INTERNAL_ERROR during write_file, edit_file, and apply_patch attempts.
- BLOCKED: process_start and shell returned MCP SSE errors; no tests, lint, typecheck, or build could be verified.
- No existing source or test files were intentionally modified in this execution. The existing dirty Working Tree remains preserved.

## Tasks
- [ ] P0-5: distinguish explicit user/quota/unmount/normal-completion aborts from unexpected request AbortErrors; unexpected interruption must produce per-page and batch failure state and diagnostics.
- [ ] P1-3/P1-4: complete menu viewport handling and consistent Escape/outside dismissal on all affected menus, popovers, and dialogs.
- [ ] P1-6: make StudioToolbar layout respond to reading layout; leaving scroll-reading must restore the horizontal/normal placement.
- [ ] P2-1: establish and apply a small semantic z-index scale to the canvas, page dock, side panels, popovers, modals, and toast layer.
- [ ] P2-2: persist successful translation ladder metadata per page and expose it in the review surface, not only in a transient toast/log.
- [ ] P2-3: expose meaningful per-page status on all thumbnails (translated, failed, or not yet translated), retaining the selected-page indicator and accessible labels.
- [ ] Add regression tests for changed behavior and update `docs/AI-WORKING-NOTES.md` with exact implementation and verification outcomes.
- [ ] Run focused tests, typecheck, lint, and production build; record any tool/environment failures without claiming unrun checks passed.

## Verification gates
- Re-read current source and scoped diff before every edit.
- Add regression tests before production changes (TDD).
- Do not remove or alter unrelated pre-existing changes.
- No completion claim without fresh command output. If the process runner remains unavailable, report the verification gap explicitly.
