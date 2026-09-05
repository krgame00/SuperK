# Safe, Complete Glyph Cleaning Implementation Plan

**Goal:** ลบข้อความสีชมพูที่ยังเหลืออยู่ในภาพตัวอย่าง โดยเก็บกติกาความปลอดภัยเดิมไว้: mask ห้ามกินเส้นตัวละคร, การขยายเชิงพื้นที่ไม่เกิน 1 px และพิกเซลนอก mask สุดท้ายต้องไม่เปลี่ยน

**Observed regression:** ในภาพ `codex-clipboard-5cb1a9f1-3532-4cd7-a9c5-dbbadbe85710.png` ข้อความกึ่งกลางหน้า (`THIS TIME, ... LITTLE GANGS.`) ยังเหลือเกือบทั้งก้อน ขณะที่ข้อความบริเวณอื่นถูกลบแล้ว ภาพหน้าจอใช้เป็นหลักฐานเชิงภาพเท่านั้น; regression แบบพิกเซลต้องรันจากภาพต้นฉบับและ assets ของ job (`source`, `mask`, `clean`) ที่ความละเอียดจริง

**Root cause to verify first:** `CompositeResidualProbe` ตรวจ residual เฉพาะพิกเซลที่อยู่ใน `source_mask` เดิม และ retry ใน `CleaningPipeline` ใช้ mask เดิมซ้ำ ดังนั้น glyph ที่ detector ไม่ใส่ใน mask ตั้งแต่แรกจะทั้งไม่ถูกลบและไม่ถูกนับเป็น residual ปัญหานี้ไม่ควรแก้ด้วยการเพิ่ม global dilation เพราะจะย้อนกลับไปลบเส้นตัวละคร

**Architecture:** แยก `text evidence envelope` ออกจาก `deletion mask`. Envelope มาจาก CTD block/Paddle polygon และใช้กำหนดพื้นที่ค้นหาเท่านั้น จากนั้นเติมส่วน glyph ที่ขาดด้วย component ที่เชื่อมโยงกับ seed และมีสี/ความสว่างสอดคล้องกันภายใน envelope ตรวจ residual ทั่ว envelope หลังคลีน และ retry เฉพาะ residual component ที่ยืนยันแล้ว การขยาย deletion mask ขั้นสุดท้ายยังคงไม่เกิน 1 px และ compositor ยังเปลี่ยนภาพได้เฉพาะ support ของ mask เท่านั้น

**Non-goals:** ไม่ลด threshold ทั้งหน้า, ไม่คืน full raw CTD mask, ไม่ใช้ OCR rectangle เป็น deletion mask, ไม่เปลี่ยน region `review` ให้คลีนอัตโนมัติ และไม่เพิ่ม feather/dilation เพื่อซ่อนข้อความที่เหลือ

## Acceptance Gates

- ข้อความกึ่งกลางในภาพ regression ต้องไม่เหลือ glyph ที่มองเห็นได้ และ detector residual score ภายใน evidence envelope ต้องไม่เกิน `0.18`
- deletion mask ต้องครอบคลุมเฉพาะ glyph/outline ที่ยืนยันแล้ว ไม่ใช่สี่เหลี่ยม OCR
- mask growth หลัง glyph completion ต้องไม่เกิน 1 px
- changed pixels outside final support = `0`
- changed pixels inside protected mask = `0`
- protected character-edge crossings = `0`
- text-free page ต้อง pixel-identical
- regression เดิมสำหรับเส้นตัวละคร, skin marks และ uncorroborated CTD line ต้องผ่านทั้งหมด
- coverage gate ต้องผ่านทั้งภาพสี, ขาวดำ, สกรีนโทน และข้อความกลับสี; ห้ามสรุปจากเคสข้อความสีชมพูเพียงเคสเดียว
- ทุกกลุ่มภาพต้องมีทั้งกรณีข้อความถูกลบครบและกรณีเส้นภาพใกล้ข้อความไม่ถูกแตะ
- หาก residual ยังไม่ผ่านหลัง retry หนึ่งครั้ง ให้ preserve ผลก่อน retry และตั้ง `needs_review`; ห้ามขยายพื้นที่ต่อเอง

---

## Task 1: Capture a reproducible failure and expose the blind spot

**Files:**

- Modify: `ocr-service/app/residual_probe.py`
- Create: `ocr-service/tests/test_residual_probe.py`
- Modify: `ocr-service/tests/test_pipeline.py`
- Create: `ocr-service/benchmarks/regressions/safe-complete-glyph.json`

- [x] เพิ่ม synthetic fixture ที่มี seed ครอบคลุมเพียงแกนกลางของตัวอักษร แต่มี outline/glyph component อยู่ข้าง mask เดิมภายใน text envelope
- [x] เขียน failing test ยืนยันว่า residual นอก `source_mask` แต่ยังอยู่ใน envelope ต้องถูกตรวจพบ ปัจจุบัน test นี้ต้อง RED เพื่อยืนยันสาเหตุ
- [x] เขียน failing pipeline test ยืนยันว่า retry mask ต้องเพิ่มเฉพาะ residual component ไม่ใช่ใช้ mask เดิมซ้ำ
- [x] เพิ่ม regression manifest แบบ hash-only สำหรับภาพต้นฉบับจริง ห้าม commit ภาพหรือ absolute path; เก็บ screenshot ล่าสุดเป็น reference สำหรับ visual review เท่านั้น
- [x] เพิ่ม debug artifact แบบ opt-in: `evidence-envelope.png`, `initial-mask.png`, `residual-mask.png`, `final-mask.png`, `clean.png` เพื่อแยกให้เห็นว่าข้อความตกหล่นในขั้นใด

**Checkpoint:** ต้องพิสูจน์จาก artifact ว่าข้อความกึ่งกลางตกอยู่นอก initial mask ไม่ใช่ cleaner ล้มเหลวภายใน mask หากหลักฐานไม่ตรง ให้หยุดและแก้สมมติฐานก่อน Task 2

---

## Task 2: Introduce an evidence envelope that cannot delete pixels

**Files:**

- Modify: `ocr-service/app/detector.py`
- Modify: `ocr-service/app/schemas.py`
- Modify: `ocr-service/tests/test_detector.py`
- Modify: `ocr-service/tests/test_schemas.py`

- [x] เพิ่มชนิดข้อมูล `TextEvidenceRegion` ซึ่งเก็บ polygon/rect, แหล่งหลักฐาน (`ctd`, `paddle`, `both`) และ confidence แยกจาก `mask_probability`
- [x] CTD block และ Paddle polygon สร้าง envelope ได้เฉพาะเมื่อผ่าน confidence/policy เดิม; padding ใช้สำหรับการค้นหา candidate แต่ไม่ถูกนำไปคลีนโดยตรง
- [x] จำกัด envelope ตาม polygon/merged text block จริง และห้าม merge ข้ามช่องว่างที่มี protected artwork edge คั่น
- [x] คงกฎเดิมว่า raw CTD line, skin mark หรือ Paddle-only component ที่ไม่มีหลักฐานข้อความเพียงพอไม่ถูก promote เป็น deletion mask
- [x] เพิ่ม test ว่า envelope ที่คร่อมเส้นตัวละครยังไม่ทำให้เส้นนั้นปรากฏใน deletion mask

**Invariant:** `evidence envelope` เป็น search boundary เท่านั้น การมีพิกเซลอยู่ใน envelope ไม่ได้อนุญาตให้ compositor เปลี่ยนพิกเซลนั้น

---

## Task 3: Complete fill and outline as glyph components, not dilation

**Files:**

- Modify: `ocr-service/app/mask_refiner.py`
- Modify: `ocr-service/app/detector.py`
- Modify: `ocr-service/tests/test_mask_refiner.py`
- Modify: `ocr-service/tests/test_detector.py`

- [x] เพิ่ม `complete_glyph_mask(image, seed, envelope, protected_edges)` ก่อนขั้น 1 px dilation
- [x] สร้าง candidate จาก luminance/chroma components ภายใน envelope แล้วรับ component เฉพาะเมื่อเชื่อมกับ seed ภายในระยะ stroke, ซ้อนกับ OCR polygon และผ่าน shape/area limits
- [x] ประเมินสี fill และ outline แยกกันจากพิกเซล seed ที่เชื่อถือได้; component ของ outline ต้องสัมผัส fill/seed และห้ามเลือกสีพื้นหลังจากขอบ envelope
- [x] แบ่ง edge เป็น `text-associated` กับ `hard-art`; อนุญาตให้เติม glyph ผ่าน text-associated edge เท่านั้น ส่วน hard-art ยังบล็อก mask เหมือนเดิม
- [x] ใช้ closing/flood/component reconstruction ภายใน envelope เพื่อเติมรูของ glyph โดยไม่ขยาย support แบบไร้ทิศทาง
- [x] หลัง completion จึงเรียก `constrained_dilate(..., radius=1)` เพียงครั้งเดียว
- [x] เพิ่ม positive tests สำหรับตัวอักษรสีชมพู + outline สีขาว, glyph ที่ seed ขาดช่วง และข้อความหลายบรรทัด
- [x] เพิ่ม negative tests สำหรับผม ขอบหมวก ปืน เสื้อคลุม ผิวหนัง และเส้นภาพที่อยู่ติดข้อความไม่เกิน 1–3 px

**Acceptance for this task:** completed mask ครอบคลุม synthetic glyph อย่างน้อย 98% แต่ overlap กับ annotated artwork edge เท่ากับ 0

---

## Task 4: Detect residuals across the envelope and retry only confirmed pixels

**Files:**

- Modify: `ocr-service/app/residual_probe.py`
- Modify: `ocr-service/app/pipeline.py`
- Modify: `ocr-service/app/verification.py`
- Modify: `ocr-service/tests/test_residual_probe.py`
- Modify: `ocr-service/tests/test_pipeline.py`
- Modify: `ocr-service/tests/test_verification.py`

- [x] เปลี่ยน probe ให้รับ `evidence_envelope`, `initial_mask` และ `protected_edges` แล้วคืนทั้ง `score` และ `residual_mask`
- [x] คำนวณ CTD/component score ทั่ว envelope ไม่ใช่เฉพาะ support เดิม เพื่อให้ตรวจ glyph ที่ detector พลาดได้
- [x] residual component ต้องผ่านหลักฐานเดียวกับ Task 3 และต้องไม่แตะ hard-art/protected mask
- [x] retry mask = `initial_mask | confirmed_residual_mask`; ห้ามใช้ envelope เต็มและห้าม dilate เพิ่มนอกกฎ 1 px
- [x] retry ได้สูงสุดหนึ่งครั้งต่อ region ด้วย fallback cleaner เดิม จากนั้นตรวจ residual และ damage ซ้ำ
- [x] หาก retry ทำให้ protected invariant หรือ damage gate ล้มเหลว ให้คืนภาพก่อน retry และตั้ง region เป็น `needs_review`
- [x] เพิ่ม idempotence test: รัน pipeline ซ้ำบนผล clean แล้ว final mask/ภาพต้องไม่โตต่อเนื่อง
- [x] เพิ่ม test ว่า residual ที่อยู่นอก envelope ไม่ทำให้เกิด page-wide second pass

---

## Task 5: Make cache and job results reflect the new pipeline

**Files:**

- Modify: `ocr-service/app/cache.py`
- Modify: `ocr-service/app/jobs.py`
- Modify: `ocr-service/app/api.py`
- Modify: `ocr-service/tests/test_pipeline.py`
- Modify: `ocr-service/tests/test_api.py`

- [x] bump pipeline/cache version เพื่อไม่โหลด clean result เก่าที่สร้างด้วย mask logic เดิม
- [x] บันทึก pipeline version และ residual outcome ใน job result เพื่อแยก stale result จากผลใหม่ได้ชัดเจน
- [x] เมื่อสั่ง clean ใหม่ ให้แทนที่ object URLs/metadata ของหน้าปัจจุบันด้วย job ใหม่ ไม่แสดงผล cache เก่า
- [x] เพิ่ม API test ว่า version เปลี่ยนแล้ว cache key เปลี่ยน และผลใหม่มี final mask ที่รวม confirmed residual
- [x] ระบุขั้นตอน restart OCR service ก่อน visual QA เพราะ `run.ps1` ไม่ได้เปิด auto-reload

---

## Task 6: Validate the real page and prevent both regressions

**Files:**

- Modify: `ocr-service/scripts/benchmark.py`
- Modify: `docs/cleaning-benchmark.md`
- Modify: `ocr-service/benchmarks/visual-review.json` after human review

- [x] ซ่อมหรือสร้าง Python 3.11 venv ใหม่ก่อนรัน suite; venv ปัจจุบันอ้างถึง Python launcher ที่ถูกลบและยังใช้ยืนยัน pytest ไม่ได้
- [x] รัน unit tests ของ detector/refiner/residual/pipeline/compositor ก่อน แล้วรัน OCR suite ทั้งหมด
- [x] restart service ที่ `127.0.0.1:8765`, ล้างผลหน้าทดสอบเดิม และ clean ภาพต้นฉบับใหม่
- [x] สร้าง comparison sheet: `Original | Initial Mask | Evidence Envelope | Residual Mask | Final Mask | Clean | Diff x5`
- [x] ตรวจภาพล่าสุดสองแกนพร้อมกัน: ข้อความกึ่งกลางหายหมด และเส้นตัวละคร/เครื่องแต่งกายไม่เปลี่ยน
- [x] รัน corpus benchmark เดิมและเพิ่ม metric `residual outside initial mask` เพื่อปิด blind spot ของเกณฑ์เก่า
- [x] อัปเดตเอกสารด้วยตัวเลขจริงเท่านั้น และให้ผู้ใช้ตรวจ comparison sheet ก่อนปิดงาน

---

## Task 7: Prove color and monochrome coverage

**Files:**

- Modify: `ocr-service/tests/test_detector.py`
- Modify: `ocr-service/tests/test_mask_refiner.py`
- Modify: `ocr-service/tests/test_residual_probe.py`
- Modify: `ocr-service/scripts/benchmark.py`
- Modify: `ocr-service/benchmarks/visual-review.json`
- Modify: `docs/cleaning-benchmark.md`

- [ ] เพิ่ม fixture matrix อย่างน้อย 4 กลุ่ม: ภาพสี, ขาวดำ, สกรีนโทน และข้อความกลับสี
- [ ] ภาพสีครอบคลุมข้อความสีสด, สีอ่อน, fill/outline คนละสี และข้อความบนพื้นหลังหลายสี
- [ ] ภาพขาวดำครอบคลุมตัวดำบนพื้นขาว, ตัวขาวบนพื้นดำ และเส้นตัวละครที่มีความเข้มใกล้กับตัวอักษร
- [ ] ภาพสกรีนโทนครอบคลุม dot/line patterns ทั้งด้านในและรอบ glyph เพื่อยืนยันว่า texture ไม่ถูกเลือกเป็นข้อความ
- [ ] ข้อความกลับสีครอบคลุม white-on-black และ mixed polarity ภายใน text block เดียวกัน
- [ ] แต่ละกลุ่มมี positive fixture อย่างน้อย 3 ภาพและ hard-negative อย่างน้อย 3 ภาพ โดย hard-negative ต้องมีเส้นผม ใบหน้า เสื้อผ้า หรือฉากอยู่ห่างข้อความ 1–3 px
- [ ] วัด `glyph recall`, `artwork overlap`, `changed outside support` และ `residual outside initial mask` แยกตามกลุ่ม ห้ามรายงานเฉพาะค่าเฉลี่ยรวม
- [ ] เกณฑ์ต่อกลุ่ม: synthetic glyph recall ≥ 98%, artwork overlap = 0, changed outside support = 0 และ protected pixels changed = 0
- [ ] สร้าง comparison sheet อย่างน้อยกลุ่มละ 2 ภาพในรูปแบบ `Original | Initial Mask | Evidence Envelope | Final Mask | Clean | Diff x5`
- [ ] รัน pipeline สองครั้งกับทุก fixture และยืนยัน idempotence: รอบที่สองต้องไม่เพิ่ม mask หรือเปลี่ยนพิกเซลใหม่
- [ ] บันทึกผล benchmark จริงและข้อจำกัดที่พบใน `docs/cleaning-benchmark.md`; หากกลุ่มใดไม่ผ่าน ให้คงงานนี้เป็น incomplete และไม่ใช้ผลของกลุ่มอื่นกลบ

**Coverage checkpoint:** งานรองรับภาพสีและขาวดำถือว่าเสร็จเมื่อทั้ง 4 กลุ่มผ่าน automated gates และ visual review ไม่ใช่เพียงเมื่อ unit tests ของข้อความสีชมพูผ่าน

Run:

```powershell
cd ocr-service
.\venv\Scripts\ruff check app scripts tests
.\venv\Scripts\pytest tests/test_detector.py tests/test_mask_refiner.py tests/test_residual_probe.py tests/test_pipeline.py tests/test_compositor.py tests/test_verification.py -v
.\venv\Scripts\pytest tests -v
cd ..
npm test
npx tsc --noEmit
npx eslint .
git diff --check
```

## Execution Order

1. Task 1 must reproduce the blind spot before implementation.
2. Tasks 2–3 establish bounded glyph completion without weakening artwork protection.
3. Task 4 closes the residual loop with one region-scoped retry.
4. Task 5 invalidates stale results and exposes the actual pipeline version.
5. Task 6 is the release gate; do not consider the issue fixed until both the incomplete-cleaning and character-line regressions pass visually and automatically.
6. Task 7 extends the release gate across color, monochrome, screentone and inverted-text fixtures; all four groups must pass independently.
