# Task 1 brief — Whole region restoration

Source: docs/superpowers/plans/2026-10-03-restore-whole-mask-region.md (Task 1, verbatim)

**Files:** Modify `components/cleaning/MaskEditor.tsx`, `tests/cleaning/MaskEditor.test.tsx`.

**Interfaces:** Consumes `onRetry(regionId: string, mask: Blob, cleaner: CleanerOverride, action: ManualRegionAction): Promise<unknown>`; invokes action `protect`. Produces one new primary button with no API changes.

- [ ] Write failing tests: without any stroke, click กู้ภาพเดิมทั้งจุด; assert exactly one protect call. Inspect the grayscale ImageData put into the encoding canvas: every pixel inside rect is 255, every pixel outside is 0. Repeat with empty display mask and a rectangle clipped at image bounds. Assert pending navigation and duplicate submission disabled. Assert failed onRetry retains draft and allows retry. Assert successful restore displays cleaned view and visiting another region then returning does not resurrect draft; old brush undo cannot resurrect it.
- [ ] Run RED: `& 'C:\Program Files\nodejs\node.exe' node_modules/vitest/vitest.mjs run tests/cleaning/MaskEditor.test.tsx -t 'whole region'`. Expected missing button failures.
- [ ] Add a handler using the existing encoder. Build an ImageData with blue recovery pixels covering the rectangle, independently of existing red pixels:

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

- [ ] Add primary button; change brush label and existing brush test queries to กู้เฉพาะส่วน.
- [ ] GREEN and regression: run `tests/cleaning/MaskEditor.test.tsx tests/cleaning/maskEdits.test.ts tests/workflow/WorkspacePage.test.tsx`.
- [ ] Run TypeScript and changed-file ESLint; independent review against incremental diff, then address findings and recheck affected tests.
- [ ] Update this plan with verification evidence. Do not commit all existing dirty files or push; user has authorized implementation and runtime update, not a new code push.

## Global constraints (verbatim from plan)

- Read installed Next use-client documentation before editing the client component.
- Preserve existing uncommitted work. Only MaskEditor, its tests and this feature's documentation are in scope.
- No provider requests or new dependencies.
- User approved the design at `docs/superpowers/specs/2026-10-03-restore-whole-mask-region-design.md` and authorized implementation.
- Keep brush restoration under the label กู้เฉพาะส่วน. Whole restoration uses กู้ภาพเดิมทั้งจุด.
- No removal pixels outside the selected rectangle. Backend protect persists restoration; brush Undo must not resurrect pre-restoration drafts.

## Binding acceptance criteria (from the approved design doc)

1. เลือก #5 แล้วกดกู้ครั้งเดียวโดยไม่มี pointer stroke ส่ง protect ด้วย mask เต็มกรอบ
2. ไม่มีพิกเซลที่เลือกภายนอกกรอบ รวมกรอบใกล้ขอบภาพ
3. กู้ได้ทั้ง applied mask ที่มีสีแดงและ mask ที่ว่าง ไม่มีเงื่อนไขให้วาดก่อน
4. สำเร็จแล้วเห็นภาพจริงที่กู้ รอย draft เก่าไม่กลับมาเมื่อสลับกรอบหรือเปิดใหม่
5. ล้มเหลวแล้วไม่รายงานสำเร็จ ไม่ล้าง draft และกดลองใหม่ได้
6. เครื่องมือแปรงกู้เฉพาะส่วนและการคลีนจุดอื่นยังทำงานตามเดิม
