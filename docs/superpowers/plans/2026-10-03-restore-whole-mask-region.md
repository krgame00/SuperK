# Whole mask region restore implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Select a region and restore the entire selected rectangle from the original image with one click and no brush strokes.

**Architecture:** MaskEditor encodes a full rectangle as the existing protect action. Reuse the backend source restoration and hook persistence; replace local draft only after successful acknowledgement. The selected rectangle is the authorization boundary.

**Tech Stack:** React, TypeScript, Canvas, Vitest, existing Python OCR sidecar.

## Global constraints

- Read installed Next use-client documentation before editing the client component.
- Preserve existing uncommitted work. Only MaskEditor, its tests and this feature's documentation are in scope.
- No provider requests or new dependencies.
- User approved the design at `docs/superpowers/specs/2026-10-03-restore-whole-mask-region-design.md` and authorized implementation.
- Keep brush restoration under the label กู้เฉพาะส่วน. Whole restoration uses กู้ภาพเดิมทั้งจุด.
- No removal pixels outside the selected rectangle. Backend protect persists restoration; brush Undo must not resurrect pre-restoration drafts.

## Task 1: Whole region restoration

**Files:** Modify `components/cleaning/MaskEditor.tsx`, `tests/cleaning/MaskEditor.test.tsx`.

**Interfaces:** Consumes `onRetry(regionId: string, mask: Blob, cleaner: CleanerOverride, action: ManualRegionAction): Promise<unknown>`; invokes action `protect`. Produces one new primary button with no API changes.

- [x] Write failing tests: without any stroke, click กู้ภาพเดิมทั้งจุด; assert exactly one protect call. Inspect the grayscale ImageData put into the encoding canvas: every pixel inside rect is 255, every pixel outside is 0. Repeat with empty display mask and a rectangle clipped at image bounds. Assert pending navigation and duplicate submission disabled. Assert failed onRetry retains draft and allows retry. Assert successful restore displays cleaned view and visiting another region then returning does not resurrect draft; old brush undo cannot resurrect it.
- [x] Run RED: `& 'C:\Program Files\nodejs\node.exe' node_modules/vitest/vitest.mjs run tests/cleaning/MaskEditor.test.tsx -t 'whole region'`. Expected missing button failures.
- [x] Add a handler using the existing encoder. Build an ImageData with blue recovery pixels covering the rectangle, independently of existing red pixels:

```ts
const selection = new ImageData(current.width, current.height);
for (let y = Math.max(0, rect.y); y < Math.min(selection.height, rect.y + rect.height); y++) {
  for (let x = Math.max(0, rect.x); x < Math.min(selection.width, rect.x + rect.width); x++) {
    const offset = (y * selection.width + x) * 4;
    selection.data[offset + 2] = 255;
    selection.data[offset + 3] = 150;
  }
}
const blob = await encodeAuthorizedMask(selection, rect, true);
const result = await onRetry(selectedRegion.id, blob, cleaner, "protect");
```

Capture region/dimensions before awaiting. Disable navigation and submission while pending, including shortcuts that mutate drafts. On success clear only the selected draft state and reset its stroke base; invalidate stale undo callbacks via a generation guard rather than deleting unrelated global history. Show cleaned comparison and accurate status. On false return or exception retain edits and report failure. Respect recoveredRegionId if the hook remaps. Existing selection-only behavior does not submit requests.

- [x] Add primary button; change brush label and existing brush test queries to กู้เฉพาะส่วน.
- [x] GREEN and regression: run `tests/cleaning/MaskEditor.test.tsx tests/cleaning/maskEdits.test.ts tests/workflow/WorkspacePage.test.tsx`.
- [x] Run TypeScript and changed-file ESLint; independent review against incremental diff, then address findings and recheck affected tests.
- [x] Update this plan with verification evidence. Do not commit all existing dirty files or push; user has authorized implementation and runtime update, not a new code push.

## Task 2: Runtime update

- [x] Verify web process ownership on port 3000, stop only this repo's web. Leave OCR running. Build Next, sync standalone assets and restart hidden web.
- [x] Verify HTTP 200 with the new build ID and OCR health 200. Record results and tell user how to refresh.

## Progress

Design approved; implementation, reviews, and runtime update complete.

Task 1 evidence: implementer report at `.superpowers/sdd/whole-mask-restore/implementation-report.md` — RED: six missing-button failures before production edits; GREEN/regression: MaskEditor + maskEdits + WorkspacePage = 88 tests passed; tsc clean; changed-file eslint clean. Task review (spec + quality): spec ✅, quality Approved; one Important finding was a stale review package, regenerated (`review.diff` now includes the remap test). Final whole-feature review: Ready to merge = Yes, no Critical/Important; reviewer independently re-ran the MaskEditor suite (39/39 pass) and verified the `useCleaning` result-ordering and cleared-snapshot interactions. Deferred minors are logged in `.superpowers/sdd/progress.md` (toDataURL mock, bottom/left clip coverage, stroke-commit before pending flag on next MaskEditor touch, loadedRegionRef pairing comment, post-restore undoability test).

Task 2 evidence (2026-10-03): port 3000 owner verified as this repo's standalone server (pid 13232, `owned=True`), OCR on 8765 untouched (pid 21792). Only the web process was stopped (`Stop-SuperKServiceProcess` returned True; 0 listeners on 3000, OCR still listening). `npm run build` succeeded and synced standalone assets. New hidden web pid 27512; web HTTP 200; served page contains build ID `d1NGIbFfMh53K6YOPnIrk` matching `.next/BUILD_ID`; OCR health 200. No commit/push performed. User refresh: reload the app tab (Ctrl+Shift+R) or reopen the app window.
