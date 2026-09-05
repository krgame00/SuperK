# SuperK cleaning benchmark

## ขอบเขต

benchmark นี้วัดระบบคลีน local บน CPU ด้วย CTD detector, deterministic
flat/gradient reconstruction และ AOT สำหรับ artwork region ไม่มี paid API
หรือ network call ระหว่างประมวลผล

corpus หลักมี 30 ภาพต้นฉบับจาก `F:\Doujin\Download` ที่ผ่านการรีวิวด้วยคนและ
ติด label `original_comic` ก่อนเลือกแบบ deterministic ด้วย seed `20260727`
ระบบตัดพาธที่มี `[English]`, `[Chinese]`, `[Thai]`, `ภาษาไทย` หรือ
`[中国語版]` ออกก่อนเปิดและวิเคราะห์ภาพ corpus ครอบคลุม white/colored bubble, vertical Japanese,
outlined/colored text, artwork SFX, screentone, complex color, dense text และ
text-free หมวดหมู่เป็น heuristic สำหรับความหลากหลายของ corpus ไม่ใช่
ground-truth annotation

มี protected corpus แยกอีก 10 ภาพสำหรับ credits, QR, UI, watermark และ logo
เพื่อไม่ให้คะแนนการคลีนข้อความทั่วไปกลบ regression ด้านการปกป้องข้อความ
สำคัญ

manifest ที่ commit เก็บเฉพาะ:

- SHA-256 ของ relative path
- SHA-256 ของเนื้อหาไฟล์
- ความกว้างและความสูง
- หมวดหมู่
- review label

ไม่มีชื่อเรื่อง ชื่อโฟลเดอร์ พาธเต็ม หรือภาพต้นฉบับอยู่ใน Git ตัว runner สแกน
root ที่ผู้ใช้ระบุและจับคู่ด้วย hash ตอนรัน

## วิธีวัด

1. โหลดโมเดลหนึ่งครั้งและ warm up ด้วยภาพแรกหนึ่งรอบ
2. รันภาพทั้ง 30 แบบ serial
3. เก็บ detect/refine/clean/verify/encode/total time, จำนวน region แยก route,
   residual pass, automatic pass, needs-review, changed pixels outside
   feather support และ peak RSS
4. ตรวจหน้าที่ detector/refiner คืน 0 regions ว่าภาพ output เหมือน input
   ทุกพิกเซล
5. รัน protected corpus และตรวจว่าไม่มีพิกเซลเปลี่ยนใน protected mask รวมถึง
   หน้า credits/UI ต้อง pixel-identical
6. รัน regression สองภาพจาก `E:\SuperK` และตรวจ connected changed area
   ไม่ให้เกิด patch สี่เหลี่ยมที่ fill ratio อย่างน้อย 0.85 และกินพื้นที่เกิน
   1% ของหน้า
7. สร้าง comparison artifact แบบ Original/Clean/Eligible/Protected/Diff×5
   แล้วรีวิวด้วยคนอย่างน้อย 12 ภาพ: dialogue, narration, SFX และ
   protected-heavy อย่างละ 3 ภาพ

รายงานดิบถูกเขียนเป็น `benchmark-results/latest-aot.json` และ
`benchmark-results/latest-aot.md` โดยโฟลเดอร์นี้ไม่ถูก commit

## Acceptance gate

- median total ไม่เกิน 30,000 ms
- residual pass อย่างน้อย 95%
- automatic region pass อย่างน้อย 90%
- changed pixels outside feather support เท่ากับ 0
- changed pixels inside protected mask เท่ากับ 0
- หน้า credits/UI ใน protected corpus ต้อง pixel-identical
- หน้าที่ไม่มี region ต้อง pixel-identical
- regression rectangular-patch ต้องผ่าน
- visual review ต้องผ่านอย่างน้อย 12 ภาพและครบ 4 หมวด หมวดละ 3 ภาพ

## ผลล่าสุด

รันเมื่อ 28 กรกฎาคม 2026 บน Windows/CPU target:

| Metric | Result | Gate |
|---|---:|---:|
| Median total | 7,950 ms | ≤ 30,000 ms |
| p95 total | 15,366 ms | informational |
| Residual pass | 100.0% | ≥ 95% |
| Automatic region pass | 100.0% | ≥ 90% |
| Changed pixels outside support | 0 | = 0 |
| Changed pixels inside protected | 0 | = 0 |
| Credits/UI pixel identity | ผ่าน | ต้องผ่าน |
| Text-free pixel identity | ผ่าน | ต้องผ่าน |
| Rectangular-patch regression | ผ่าน | ต้องผ่าน |
| Visual review | 12/12 ผ่าน | ต้องผ่าน |
| Needs review | 73.3% | informational |
| Peak RSS | 1,052.1 MB | informational |

ผลรวม: **PASS**

ทั้ง median และ p95 อยู่ต่ำกว่าเป้าหมาย 20–30 วินาทีต่อหน้าใน corpus นี้
แต่ยังไม่ใช่การรับประกันทุกเครื่องหรือทุกความละเอียด เวลาจะสูงขึ้นตามจำนวน
artwork regions ที่เรียก AOT และกำลัง CPU

## การอัปเดต Pipeline 2.0.0-safe-glyph (กันยายน 2026)

แก้ปัญหา Blind Spot ในกรณีข้อความฟอนต์ตกแต่ง/มี Outline สีขาว (Outlined Glyph) ที่ detector เดิมจับได้เฉพาะแกนกลางตัวหนังสือ แต่ขอบนอกตกหล่น ทำให้ probe เดิมตรวจไม่เจอเพราะตรวจเฉพาะใน `source_mask`:

1. **Evidence Envelope Search Boundary**: นำ `TextEvidenceRegion` มากั้นขอบเขตค้นหาแบบไม่แตะต้องเส้นภาพตัวละคร (`protected_edges`)
2. **Glyph Component Completion**: ประกอบ fill + outline ตามสีและเชื่อมโยง component แทนการใช้ dilation ใหญ่ โดยจำกัด spatial dilation ไว้ที่ $\le 1$ px
3. **Envelope-wide Residual Probe & Confirmed Retry**: ขยายการตรวจ residual ทั่ว evidence envelope และอนุญาตให้ retry เฉพาะ component ที่ยืนยันว่าเป็นตัวหนังสือเท่านั้น
4. **Acceptance Invariants**:
   - Changed pixels outside support = 0
   - Changed pixels inside protected artwork mask = 0
   - Real regression job `42c1b526d9414e0d89f3dec236eb6367` (Region 2 residual: `0.217` -> `0.0000`, clean damage $\le 0.0144$)

## ข้อจำกัดด้านคุณภาพ

residual score เป็นการตรวจซ้ำด้วย CTD ภายใน envelope และ damage score
ตรวจการเปลี่ยนภาพนอก support จึงเหมาะเป็น regression gate แต่ไม่แทนการรีวิว
สายตามนุษย์ ระบบตั้งใจ preserve region ที่ความมั่นใจไม่ถึงเกณฑ์ โดยผลล่าสุด
ส่ง 73.3% ของ region ไป review เพื่อไม่ให้ลบเครดิต UI watermark หรือเส้นภาพ
โดยพลการ โดยเฉพาะ SFX ที่ทับเส้น artwork หนาแน่นควรตรวจ Clean/Mask/Protected
layer และใช้ manual region retry เมื่อจำเป็น
