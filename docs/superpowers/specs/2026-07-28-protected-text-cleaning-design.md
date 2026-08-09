# Protected, Context-Aware Text Cleaning Design

## Objective

ปรับระบบคลีนให้ลบข้อความที่ต้องแปลได้ทั้งข้อความในบับเบิล,
narration/caption ที่ไม่มีบับเบิล และ SFX บน artwork โดยห้ามเปลี่ยนเครดิต,
watermark, QR code, โลโก้ และองค์ประกอบ UI

ระบบต้องเลือกความปลอดภัยก่อน: region ที่จัดประเภทไม่ได้ชัดเจนจะถูกเก็บไว้และ
แสดงเป็น `needs_review` แทนการลบอัตโนมัติ

## Classification model

เพิ่มการตัดสินใจสองระดับก่อนส่ง region เข้า cleaner

### Page role

- `comic`: หน้าการ์ตูนที่มี panel/artwork และข้อความสำหรับแปล
- `credits`: หน้าเครดิต โปรโมต ช่องทางติดต่อ หรือ QR
- `ui`: screenshot ของเว็บไซต์ แอป หรือ social profile
- `unknown`: หลักฐานไม่พอ

หน้า `credits`, `ui` และ `unknown` ไม่ถูกคลีนอัตโนมัติทั้งหน้า

### Text role

- `dialogue`: ข้อความใน speech/thought bubble
- `narration`: caption หรือข้อความบรรยายบนพื้นเรียบ/กรอบข้อความ
- `sfx`: ข้อความวาดทับ artwork
- `protected`: เครดิต watermark QR โลโก้ หรือ UI
- `review`: หลักฐานก้ำกึ่ง

กฎการทำงาน:

| Page role | Text role | Default action |
|---|---|---|
| `comic` | `dialogue` | clean |
| `comic` | `narration` | clean เมื่อ confidence ≥ 0.82 |
| `comic` | `sfx` | clean เมื่อ confidence ≥ 0.90 |
| any | `protected` | preserve |
| any | `review` | preserve และแสดงให้ตรวจ |
| `credits`, `ui`, `unknown` | any | preserve |

ผู้ใช้สามารถเปิด Mask Editor แล้วสั่ง force-clean region ที่ถูก preserve ได้
แต่ automatic retry ห้ามขยาย mask เข้า protected support

## Evidence and protection

`PageRoleClassifier` ใช้ feature ที่ทำงาน local:

- panel/line-art density และ distribution
- text-region coverage และตำแหน่ง
- QR polygon
- horizontal UI bands และ repeated navigation-like shapes
- จำนวน region ที่กระจุกใน header/footer

`ProtectedRegionDetector` รวม:

- `cv2.QRCodeDetector` และขยาย polygon 8 source pixels
- repeated corner/header/footer components ที่ปรากฏตำแหน่งเดิมหลายหน้า
- compact logo-like components ใน page margin
- text regions ของหน้าที่ถูกจัดเป็น credits/UI

`TextRoleClassifier` ใช้:

- bubble enclosure และความสม่ำเสมอของพื้นหลัง
- rectangular caption backing
- artwork edge density รอบ glyph
- ตำแหน่งเทียบ margin/protected regions
- ขนาด แนว และการรวมกลุ่มของ text components

OCR/AI bounding boxes ใช้เป็นหลักฐานประกอบประเภทได้ แต่ห้ามใช้เป็น deletion
mask โดยตรง deletion mask ยังคงมาจาก refined CTD pixel mask เท่านั้น

ก่อน compositing:

```text
eligible_mask = refined_text_mask AND NOT protected_mask
```

ต้องตรวจ invariant ว่า output ทุกพิกเซลภายใน `protected_mask` เหมือน source
ทุกช่องสี หากไม่เหมือนให้ reject region และคืน source pixels

## Pipeline and API changes

เพิ่มผลลัพธ์ต่อ region:

- `page_role`
- `text_role`
- `eligibility_confidence`
- `automatic_action`: `clean` หรือ `preserve`
- `protection_reasons`

pipeline ทำตามลำดับ:

1. ตรวจ CTD และ refine pixel mask
2. สร้าง page context
3. ตรวจ protected regions
4. จัด text role และ eligibility
5. ส่งเฉพาะ eligible mask เข้า router/cleaner
6. ตรวจ residual, outside-support damage และ protected-pixel identity
7. คืน preserved/review regions ให้ UI

หน้าเว็บแสดง Mask สามสี:

- แดง: จะคลีน
- เหลือง: ต้องตรวจ
- ฟ้า: protected

Mask Editor มีคำสั่ง `Force clean`, `Protect` และ `Reset to automatic`
ต่อ region โดยการ force-clean ต้องเป็นการกระทำชัดเจนจากผู้ใช้

## Corpus correction

manifest เดิมไม่ใช่ชุดต้นฉบับล้วน เพราะพบหน้าแปลไทย หน้าเครดิต และ social UI
ปะปนอยู่ จึงต้องสร้าง corpus ใหม่:

- ตัดทุก path ที่มี `[English]`, `[Chinese]`, `[Thai]`, `ภาษาไทย`,
  `[中国語版]` ก่อนสุ่ม ไม่ใช่เพียงตัด tag ก่อน hash
- สร้าง contact sheet ภายในเครื่องเพื่อรีวิว 30 หน้า
- ผู้รีวิวระบุด้วย hash เท่านั้นว่า `original_comic`, `credits`, `ui`,
  `translated` หรือ `reject`
- benchmark หลักต้องมี `original_comic` 30 หน้าไม่ซ้ำ
- ชุด protected regression แยกอย่างน้อย 10 หน้า ครอบคลุม QR, watermark,
  credits และ UI
- Git เก็บเฉพาะ hash, dimensions, categories และ review label

## Acceptance

Automatic gates:

- median warm total ≤ 30,000 ms
- residual pass ≥ 95%
- automatic eligible-region pass ≥ 90%
- changed pixels outside feather support = 0
- changed pixels inside protected mask = 0
- credit/UI pages pixel-identical = 100%
- text-free pages pixel-identical = 100%
- rectangular-patch regressions pass

Visual gate:

- รีวิว `Original | Clean | Eligible Mask | Protected Mask | Difference`
  อย่างน้อย 12 หน้า
- ต้องมี dialogue 3, narration ไม่มีบับเบิล 3, SFX 3 และ protected-heavy 3
- dialogue/narration ต้องไม่มี glyph residue ที่เห็นได้ชัด
- artwork line damage, watermark/QR/credit deletion ต้องเป็นศูนย์
- visual reviewer ต้องระบุ `pass` ต่อหน้า; คะแนนอัตโนมัติไม่สามารถแทน gate นี้

## Error handling

- page classifier ล้มเหลว: ใช้ `unknown` และ preserve
- QR detector ล้มเหลว: ไม่ทำให้ job ล้ม แต่บันทึก warning และให้ margin
  candidates เป็น review
- protected invariant ล้มเหลว: restore source pixels และตั้ง region
  `needs_review`
- corpus review ไม่ครบ 30 original pages: benchmark หยุดก่อนโหลดโมเดล

## Scope

รวมในรอบนี้: classification, protection, mask semantics, corpus correction,
benchmark และ UI review controls

ไม่รวม: cloud OCR, paid API, การรับประกันลบ watermark, หรือการลบข้อความทุก
region โดยอัตโนมัติ
