# Four-spec ticket breakdown proposal

Status: approved and published

The user approved all fifteen slices and their blocking edges on 2026-10-04 under to-tickets. Each ticket is published as ready-for-agent in the configured local tracker, one file per ticket. Parent specs remain unchanged; production implementation has not started.

## Approved slices

### 1. P01 — วัดสาเหตุกระตุกในหน้าที่มีข้อความเยอะ

Feature: dense-page-text-interaction
Blocked by: None (can start immediately)

ได้ฉากเบราว์เซอร์ 10/50/100 จุดและค่าก่อนแก้ แยกช่วงลากกับช่วงปล่อยมือ

- Record reference browser/hardware, dimensions, zoom and reproducible gestures for move, corner scale and width reflow.
- Capture p50/p95/max frame durations, missed frames and input-to-preview latency at 44%/100% zoom, including long multiline text and outlines/shadows.
- Trace remaining costs without assuming the previously fixed per-pointer repaint issue still exists; identify concrete evidenced optimization targets.
- Use actual editing/rendering behavior with synthetic fixtures; no real provider calls.

### 2. P02 — ย้ายและขยายมุมให้ลื่นโดยไม่เด้ง

Feature: dense-page-text-interaction
Blocked by: 1

ย้ายด้วยภาพเดิม ขยายมุมด้วยภาพชั่วคราว วาดคมและบันทึกค่าตรงเมื่อปล่อย

- Implement measured optimizations for movement/corner previews, not an unrelated renderer rewrite.
- Reuse glyph bitmaps for movement/rotation and proportional corner preview; final crisp text preserves previewed anchor, size, position and line structure.
- Latest pointer release commits exactly once; cancellation/no-op/page changes cannot leave stale callbacks or cross-page writes; Undo/Redo and persistence remain correct.
- Keep controls aligned and unaffected points stable; compare the same dense-scene timings before/after and bound resource/cache lifetime.

### 3. S01 — ข้อความใหม่มีขนาดใกล้ตัวอักษรต้นฉบับ

Feature: source-matched-text-size
Blocked by: None (can start immediately)

วัดอักษรจริงจากต้นฉบับ เทียบฟอนต์ที่โหลดแล้ว และบันทึกขนาดอัตโนมัติพร้อมระดับความเชื่อถือ

- Use original glyph/line evidence and loaded-font visible body metrics; do not substitute OCR block height, cleaning-mask dimensions, outlines, shadows or artwork for letter size.
- New translated points use persisted automatic base size, independent of view zoom; original/region/policy identity and measurement quality are retained.
- Reliable controlled visible-height fixtures stay within 10% allowing subpixel differences below one source-image pixel; include Thai diacritics and Latin fonts.
- Reliably small originals retain size with advisory readability warnings; unreliable evidence has a labeled existing-sizing fallback.
- Font/source/region/text revisions invalidate only the relevant metrics and rendered assets; source analysis is absent from live pointer paths.

### 4. S02 — คำแปลยาวและต้นฉบับยากยังจัดขนาดอย่างปลอดภัย

Feature: source-matched-text-size
Blocked by: 3

รองรับข้อความแนวตั้ง หมุน และ SFX ตามหลักฐาน คงฟอนต์เมื่อข้อความยาวและแจ้งล้น

- Attempt vertical/rotated text, captions, SFX and text over artwork using writing-direction-aware evidence; unreliable/blurred/missing evidence never claims a match.
- Preserve source-matched letter size and complete-word wrapping for longer translation; grow height only inside reliable original text-space boundaries or explicit user space.
- Unknown boundaries retain existing layout space with visible overflow; no silent shrinking, width expansion or overlap with artwork/other text.
- Retain tight selection-frame versus layout-area semantics, side fixed-size live reflow and proportional corner behavior; native diacritics stay visible.

### 5. S03 — ปรับขนาดงานเก่าโดยไม่ทับค่าที่ตั้งเอง

Feature: source-matched-text-size
Blocked by: 4

สั่งปรับจุด/หน้า/เล่ม กลับเป็น Auto ได้ พร้อม Undo และขนาดตรงกันตอนเปิดใหม่ ส่งออก และส่วนขยาย

- Explicit current-point/page/book actions exclude manual-sized points by default; return-to-Auto requires explicit selection and opening old work never resizes it silently.
- Corner/direct/global size changes remain user choices; movement/rotation/width reflow do not accidentally change sizing ownership.
- Undo/Redo restores size, ownership, evidence and affected geometry; legacy locked font sizes are not mislabeled as original measurements.
- Preview, saved reload, every export rendering choice and extension publication consume the same resolved size and invalidate stale raster caches.
- Verify size at 44%, 100% and an additional zoom; preserve unrelated translation/style/layout edits.

### 6. P03 — รักษาความลื่นเมื่อจัดบรรทัดและใช้ขนาดอัตโนมัติ

Feature: dense-page-text-interaction
Blocked by: 2, 5

ลากข้างจัดบรรทัดทันที ปล่อยมือไม่ค้าง และวัดหน้าข้อความเยอะซ้ำพร้อมระบบขนาดใหม่

- Width gestures preserve visible font size, complete words and live reflow; profile and remove evidenced duplicate layout/measurement costs without losing final correctness.
- Source-size analysis/provider calls/full-book checks stay outside gestures; saving and crisp settling do not overwrite the final preview or cancellation.
- Repeat 10/50/100-point move/scale/reflow scenes with source sizing enabled, long selected text, edge cases and repeated gestures.
- Report actual timings against the 60 Hz reference target and remaining limitations; verify bounded memory/cache behavior and saved/output parity.

### 7. G01 — เลือกภาษาและตรวจอักษรคำแปลแบบเข้มงวด

Feature: multilingual-translation-guard
Blocked by: None (can start immediately)

เลือกภาษาปลายทาง บันทึกภาษาของหน้า และซ่อนจุดคำแปลที่ผิดอักษรพร้อมเลือกแก้ได้

- Enumerate canonical supported language IDs, exact aliases, writing-system variants and allowed Unicode scripts with data-driven valid/invalid fixtures; unsupported/ambiguous targets are blocked, not guessed.
- Expose target selection in the workspace; persist per-page target/policy identity and shared output-eligibility state that later output/background tickets can consume.
- Thai rejects every excluded Unicode letter/linguistic mark, including Latin names/SFX/glossary terms and supplementary/embedded letters; normalize permitted numerals without arbitrary stripping.
- Preserve target-specific joiners/marks and restrict Thai normalization to Thai output; safe punctuation/symbols remain supported.
- Withhold only invalid translated lettering, retain point selection/editor diagnostics and show offending characters; old review approval cannot override local failure.
- Changing next-job language preserves existing page results/labels; an actual page-target/text change invalidates relevant verification.

### 8. G02 — ตรวจบริบทและแก้ภาษาปนเฉพาะจุดหนึ่งรอบ

Feature: multilingual-translation-guard
Blocked by: 7

ตรวจคำแปลเทียบต้นฉบับ แก้เฉพาะจุดเสียหนึ่งรอบ และปฏิเสธคำแนะนำ AI ที่ยังปนภาษา

- Use source-backed contextual review for same-script language mismatch, omissions, added meaning, names/pronouns and unnatural wording; names/SFX/glossary obey strict target output.
- Review/correction paths handle malformed/missing/duplicate IDs, unavailable source, network failure, timeout and cancellation without implicit approval or invented replacement.
- One additional logical automatic point-repair round per page/run preserves unaffected text/style/geometry; source-based replacements are validated once with no stacked whole-image script retry.
- Cover normal and slice/OCR workflows and dense pages exceeding individual request limits; chunk safely or expose explicit unverified state for every active point.
- Reject contaminated provider suggestions locally; clean editorial suggestions require explicit acceptance and provider approval cannot override script failure.
- Record unresolved findings with point IDs/characters and verification snapshots; deleted points are excluded.

### 9. G03 — ตรวจงานเก่า แก้ด้วยมือ และสั่งแก้ทั้งเล่ม

Feature: multilingual-translation-guard
Blocked by: 8

งานเก่ายืนยันภาษาครั้งแรก ตรวจเองได้เมื่อ AI ไม่พร้อม และสั่งแก้ทั้งเล่มพร้อมย้อนกลับ

- Legacy projects confirm target once with Thai suggested and retain page targets; opening runs local inspection but no provider requests or text rewrites.
- Manual edits and absent/stale review metadata are locally checked; exact source/text/target/policy snapshots control approval validity.
- When script passes but contextual AI verification is unavailable, allow explicit source-backed human confirmation; detectable script failures cannot be dismissed/accepted past.
- Provide explicit whole-book repair with bounded rounds, cancellation and Undo/Redo retaining pre-repair text and unrelated edits.
- Continue other pages and retain an actionable review list; next-job settings preserve saved page/extension results until explicit retranslation.

### 10. G04 — กั้นส่งออกคำแปลผิดทุกแบบรวมภาพแคช

Feature: multilingual-translation-guard
Blocked by: 9

ภาพเดี่ยว PDF ZIP/CBZ และภาพยาวใช้กติกาเดียวกัน เลือกต้นฉบับหรือข้ามหน้าได้อย่างชัดเจน

- Shared eligibility is evaluated before live canvas, cached raster or fresh offscreen image choice and before single-image/archive/PDF/strip translated export.
- Old accepted/dismissed states and generic page confirmation cannot bypass deterministic script failure or unresolved required review.
- List affected pages and require repair, explicit original-image substitution or explicit exclusion, preserving ordering with no silent omissions or incomplete translated output.
- Revision changes invalidate raster/approval signatures; missing reconstruction/verification evidence gives an actionable blocked/review state instead of trusting stale pixels.
- Expose the same eligibility boundary for background-remnant findings without coupling them to generated-text approval; verify all workspace output bypass attempts.

### 11. G05 — ส่วนขยายและส่งกลับเว็บอ่านตรวจเหมือนเว็บหลัก

Feature: multilingual-translation-guard
Blocked by: 9

ส่วนขยายใช้ตัวเลือกภาษา เกณฑ์ตรวจ และผลยืนยันเดียวกัน ทั้งแปลตรงและรับผลจากเว็บหลัก

- Workspace/extension target selectors use the same canonical supported catalog/variants; server-assisted and direct translation do not bypass unknown-target/script policy.
- Persist target/review identity with extension results and preserve saved reading copies when next-job settings change; explicit retranslation/publication controls updates.
- Direct output, renderer and publish-back validate generated-text eligibility before showing rejected lettering; cached reading output cannot bypass changed verification.
- Reuse bounded point repair and explicit contextual confirmation semantics from the workspace without duplicating divergent language rules.
- Preserve source-image/edit diagnostics and verified layout/style; test extension settings, saved results and publish-back failure cases with mocked providers.

### 12. R01 — ตรวจตัวอักษรต้นฉบับที่เหลือบนภาพคลีน

Feature: source-text-remnant-review
Blocked by: 7

ตรวจพื้นหลังคลีนก่อนวาดคำแปล แสดงตำแหน่งสงสัยและสถานะรอตรวจของหน้า

- Inspect original/clean image pairs and existing text/removal evidence before translated overlays; include full/partial glyph remnants without treating accepted translated letters as remnants.
- Expose review candidates and original/clean comparison at correct page locations; known-clean, suspicious and unavailable evidence states stay distinct.
- Tie findings to original/clean revisions and reuse unchanged evidence; source/mask/background changes invalidate the relevant result.
- Feed findings into the shared page-output eligibility boundary; do not auto-erase pixels or expand mask authorization.
- Use synthetic clean/remnant/hair/hatching/decorative fixtures and record uncertainty/false positives rather than claiming perfect classification.

### 13. R02 — แก้ mask หรือยืนยันว่าจุดสงสัยเป็นลายภาพ

Feature: source-text-remnant-review
Blocked by: 12

เปิดแก้ mask จากจุดสงสัย ยืนยันลายภาพได้เฉพาะจุด และตรวจซ้ำเมื่อภาพเปลี่ยน

- Navigate a finding directly to its applicable mask region with original/clean comparison; existing normalized mask/removal-authorization bounds remain binding.
- Resolution is a safe mask correction or explicit artwork confirmation for the exact candidate/image revision, never broad future approval.
- Recleaning, mask edits, source replacement and Undo/Redo invalidate/restore only valid revision-bound findings and confirmations.
- Missing originals/failed detection require explicit human image inspection; opening legacy projects never calls providers or silently cleans stored backgrounds.
- Generated-text script failure remains non-overridable by artwork confirmation; translation approval does not resolve an unreviewed background finding.

### 14. R03 — กั้นภาพคลีนที่ยังมีปัญหาทั้งส่งออกและเว็บอ่าน

Feature: source-text-remnant-review
Blocked by: 10, 11, 13

รวมผลตรวจคำแปลกับภาพคลีนก่อนส่งออกหรือส่งกลับส่วนขยาย พร้อมจัดการหน้าที่ติดปัญหา

- Combine strict text and background eligibility across live/cached/offscreen outputs, every workspace export and extension direct/publish-back paths.
- Unperformed/failed/stale image inspection never silently passes; explicit revision-bound human review remains available where agreed.
- Batch continues with affected pages listed; repair/original output/exclusion is explicit with no silent substitutions, omissions or incomplete translated pages.
- Verify saved projects, changed backgrounds, page ordering and independent text/image confirmations; keep inspection out of live text gestures.
- Use controlled image/provider fixtures and document remaining detection limitations.

### 15. G06 — ตรวจรวมทั้งสี่ระบบก่อนเปิดเวอร์ชันใหม่

Feature: multilingual-translation-guard
Blocked by: 6, 14

หลักฐานว่าขนาดตรง ลากลื่น ตรวจภาษาปนและภาพคลีนครบ โดยงานเก่าและส่งออกยังถูกต้อง

- Run combined real-browser scenarios at 44%/100% and additional size zoom with new/saved/mixed-target pages, dense scenes, manual edits, source changes and Undo/Redo.
- Verify reliable source-size error criterion, before/after gesture timings and every translated-output gate including cached images and extension publication.
- Confirm unknown targets and deterministic violations cannot pass; explicit contextual/artwork review, original-page selection and exclusion obey the agreed scope.
- Run meaningful relevant automated suites, TypeScript, changed-file lint and production build; obtain independent code review and resolve actionable findings.
- Record actual evidence/remaining limits without real user provider calls in automated verification; publish runtime only after current saved-work confirmation, then verify web/OCR and served assets.

## Publication conventions

Tickets are published one per file within their feature's issues directory. Local numbering starts at 01 for each feature. Stable references P01–P03, S01–S03, G01–G06 and R01–R03 disambiguate dependencies across features; every blocker includes the feature, ticket title and reference. The global numbers above are presentation order only. Each feature has a ticket map listing its own frontier and dependencies.

Four source specs: source-matched-text-size, dense-page-text-interaction, multilingual-translation-guard and source-text-remnant-review. No parent spec is closed or modified by ticket publication.

Immediate frontier: P01, S01 and G01. Start profiling P01 before changing the measured gesture path; source measurement and target-policy work can proceed independently. Final G06 waits for both P03 and R03, which transitively cover every earlier slice.
