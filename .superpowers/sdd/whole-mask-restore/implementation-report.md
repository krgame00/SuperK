# Task 1 implementation report

Status: DONE. No commits, provider requests, process restarts, or dependency changes.

## Scope and preservation

Only `components/cleaning/MaskEditor.tsx` and `tests/cleaning/MaskEditor.test.tsx` were changed, plus this requested report. Existing dirty edits were retained. Incremental comparison against `.superpowers/sdd/whole-mask-restore/MaskEditor.before.tsx` and `MaskEditor.test.before.tsx`: component 103 insertions / 11 deletions; tests 135 insertions / 3 deletions.

Read the approved design and Task 1 plan, the TDD skill, and installed `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md` before implementation. Existing client directive and component boundary retained.

## Changes and decisions

- Added primary `กู้ภาพเดิมทั้งจุด` action independent of brush mode, applied mask, proposal pixels, or strokes. It encodes blue recovery pixels throughout the selected rectangle through the existing authorized grayscale encoder and invokes exactly one `protect` request.
- Capture selected id, rectangle, cleaner, image dimensions, and source key before awaiting. Encoder limits white pixels to the selected rectangle and image bounds.
- Button is disabled until selected image/mask dimensions are loaded, while submitting, or when no region exists. A synchronous submitting ref prevents duplicate/reentrant submission; pending selection/navigation, brush, fill/clear, radius, cleaner, and Undo controls are locked. Canvas shortcuts cannot mutate drafts while pending.
- On truthy acknowledgement, replace only the restored region's local snapshot with cleared data, reset its stroke base, keep selection, and show cleaned comparison. The cleared snapshot prevents stale applied/proposal assets from reviving old edits during propagation or navigation. Backend persistence provides the actual cleaned image; local clearing does not fabricate changed image pixels.
- Respect returned `recoveredRegionId`, invalidate both original and remapped keys, and announce remapping.
- Guard every MaskEditor stroke/fill/clear Undo and Redo callback with its captured region key and generation. Successful restoration increments only affected generations; unrelated shared undo history is retained. No persisted restoration Undo action is added.
- Falsy acknowledgement and thrown/encoding failures retain current image data, snapshots and history, announce failure, and release the pending lock for retry.
- Rename brush tool to `กู้เฉพาะส่วน` and update its existing test queries.
- Use the typed-array ImageData constructor already used by this component; repository test ImageData polyfill supports that overload. Browser behavior is equivalent to the width/height constructor from the plan example.

## TDD evidence

RED command:

`& 'C:\Program Files\nodejs\node.exe' node_modules/vitest/vitest.mjs run tests/cleaning/MaskEditor.test.tsx -t 'whole region'`

Observed exit 1: six new cases failed, 32 skipped. Every failure was `Unable to find an accessible element with the role "button" and name "กู้ภาพเดิมทั้งจุด"`, before production edits.

New coverage: full rectangle with existing applied pixels; empty mask with clipping at image bounds; no stroke or selection-only requests; every grayscale pixel/channel checked for white inside and black outside; one protect call; pending controls/shortcut/pointer/duplicate locks; falsy and thrown failure retention/retry; cleaned comparison; cleared draft across navigation; old stroke/fill/clear Undo/Redo cannot revive draft; unrelated history survives; recovered region id and notice.

GREEN / regression command (final rerun after remap coverage):

`& 'C:\Program Files\nodejs\node.exe' node_modules/vitest/vitest.mjs run tests/cleaning/MaskEditor.test.tsx tests/cleaning/maskEdits.test.ts tests/workflow/WorkspacePage.test.tsx`

Exit 0: **3 files passed, 88 tests passed**, duration 10.11 s. Test environment emitted Node experimental localStorage warning and jsdom `HTMLCanvasElement.toDataURL` not-implemented notice; no test failures.

Static validation after final edits:

`& 'C:\Program Files\nodejs\node.exe' node_modules/typescript/bin/tsc --noEmit`

Exit 0, no diagnostics.

`& 'C:\Program Files\nodejs\node.exe' node_modules/eslint/bin/eslint.js components/cleaning/MaskEditor.tsx tests/cleaning/MaskEditor.test.tsx`

Exit 0, no diagnostics.

## Self review / handoff

Inspected all `undoManager.push` sites: only the guarded helper now pushes MaskEditor callbacks. Verified existing generic submit and one-click clean also use the synchronous pending ref. No global undo clear was introduced. Incremental diff preserves existing code paths and API signatures. Independent review and Task 2 runtime update remain the root agent's next steps.
