# Ink mask glyph filter fix, 2026-10-30

สรุปการคุย/การแก้ปัญหา "งานคลีนจับเส้นตัวละคร" ทั้งหมดไว้เป็นหลักฐานอ้างอิง เพื่อไม่ต้องไล่วินิจฉัยใหม่

## ปัญหาที่แจ้ง

ผู้ใช้กดปุ่ม **Clean** บน remnant review card แล้ว mask ไปจับเส้นตัวละคร (เส้นผม เส้นโครง ฯลฯ) ทำให้ inpainter ลบเส้นภาพไปด้วย ใช้งานล่าสุด (job ที่ค้าง) คือ `178f83ba81a14f8ea05d1ddf0c519a3f` ที่ `F:\manga-cache\ocr-jobs\jobs\`

## การวินิจฉัย

### 1. Pipeline หลัก (Python) ไม่ใช่ตัวร้าย

ตรวจ `mask.png` ของ job จริง (26,532px ขาว): **อยู่ใน clean rects 100% (0px หลุดนอก region แม้ pad +6px)** และ `mask ∩ review-mask = 0`, `mask ∩ protected-mask = 0` → pipeline เวอร์ชัน `2.3.1-enclosed-backing` ทำงานถูกขอบเขต

สิ่งที่ถูก erase จริงทั้งหน้ามีแค่ 2,403px — region-2 (2,019px) คือการลบตัวอักษรใน bubble ปกติ, region-8 (228px) / region-9 (143px) เป็นเส้นบาง ๆ ปนมา

### 2. ตัวร้ายจริง: `createInkMaskBlob` ใน `lib/cleaning/maskUtils.ts`

โค้ดจาก commit `23e84d5` (stroke-targeted ink mask for remnant inpainting) มี 2 จุดอ่อน:

- **จับทุกพิกเซลเข้ม (luma < 155) ใน candidate rect** — threshold ความมืดอย่างเดียวแยกตัวอักษรกับเส้นตัวละครไม่ได้ เส้นผม/speed line/เส้นโครงที่พาดผ่าน rect ก็เข้มเท่ากันจึงโดนฟาดหมด
- **บน bubble เทา/ดำ ยิ่งรุนแรง**: พื้น bubble เข้มเกิน 155 → ink = ทั้ง crop (region-2: 10,245px จาก 11,934px = 86% ของ crop กลายเป็น mask) → inpaint ลบทั้งก้อนรวมพื้นหลังรอบ bubble
- **fallback ตอนโหลดรูปพลาด = fill ขาวทั้ง rect** → inpainter ลบทุกอย่างใน rect เงียบ ๆ

## วิธีแก้ (ยังไม่ commit)

แก้ที่ `lib/cleaning/maskUtils.ts` + `tests/cleaning/maskUtils.test.ts` เท่านั้น

### `extractGlyphInk()` — pure function ใหม่ (export ไว้เทสต์ได้ไม่ต้องใช้ canvas)

1. **Polarity detection**: ถ้าพิกเซลเข้ม (luma<155) ≥60% ของ crop และพิกเซลสว่าง (luma>200) ≥12% → เป็น knockout text (ตัวอักษรขาวบน bubble ดำ) → ink = พิกเซลสว่างแทน
2. **Connected-component filtering (8-connectivity)** — ทิ้งทุก component ที่ทรงเป็นภาพ ไม่ใช่ตัวอักษร:

| กฎ | เงื่อนไข (ต่อ component) | เหตุผล |
|---|---|---|
| มวลใหญ่ | area ≥ 35% ของ crop | ก้อนผม/พื้นเข้ม ไม่มีทางเป็นตัวอักษร |
| บางเฉียบสุด | fill < 6% | เส้นทแยง/เส้นโค้งบาง ๆ |
| ยาวพาดข้าม | fill < 15% และ (ครอง ≥90% ของแกนใดแกนหนึ่ง หรือ ยาว ≥4 เท่าของอีกแกน) | hatching, เส้นโครงยาว (ตัวอักษร merge เป็นแถวยาวรอดเพราะ fill ≥0.15) |
| แท่งบางแนว ruler | ครอง ≥90% ของแกนหนึ่ง แต่หนา ≤25% ของอีกแกน (ไม่สน fill) | เส้น rule/bar ตรง |

`fill` = area / (bbox กว้าง × bbox สูง) — ตัวอักษรจริง fill ปกติ 0.15–0.6 จึงรอดทุกกฎ

### Fallback เปลี่ยนเป็น "mask ว่าง + console.warn"

ทั้งกรณี `ctx` เป็น null และ catch (โหลดรูป timeout/error): ส่ง mask ว่างแทน fill ทั้ง rect — server มี guard อยู่แล้ว (`ocr-service/app/pipeline.py` retry_region: `authorized mask is empty`) จะ error ชัดเจนให้ผู้ใช้เห็น แทนการลบภาพเงียบ ๆ — **ล้มเหลวแบบมีเสียงดีกว่าทำลายตัวละคร**

## ผลตรวจ

- `tests/cleaning/` ผ่าน **24 ไฟล์ / 392 tests** (เพิ่ม 7 tests ใหม่ให้ `extractGlyphInk`: glyph รอด, เส้นทแยง/มวลใหญ่/rule bar ถูกทิ้ง, แถวอักษรยาวรอด, knockout polarity, crop มืดสนิท → ว่าง)
- `npx tsc --noEmit` สะอาด, `npx eslint` สองไฟล์ที่แก้สะอาด
- **จำลองกฎใหม่บน crop จริงของ job ที่ค้าง** (port กฎเดียวกันเป็น Python เทียบกับ mask เดิม):

| Region | เดิม (threshold เท่านั้น) | ใหม่ (เหลือเป็น mask) | ถูกกรองเป็น artwork |
|---|---|---|---|
| region-1 (เส้นทแยงตัวละคร) | 705px | **0px** | 705px |
| region-2 (bubble เทา + พื้นหลังเข้ม) | 10,245px | **382px** | 9,863px |
| region-8 | 473px | 358px | 115px |
| region-9 | 3,411px | 2,815px | 596px |

## ข้อจำกัด (ตามจริง)

- เส้นหนาสั้น ๆ ที่ทรงคล้าย vertical text ยังรอด (แยกด้วยทรงล้วน ๆ ไม่ได้) — region-8 ยังเหลือ 358px
- Crop มืดจนแยกอะไรไม่ออก → mask ว่าง → server error → กรณีนั้นใช้ **mask editor** ลงแปรงเอง
- Knockout polarity ต้องมีพิกเซลสว่าง ≥12% ของ crop ถ้าข้อความขาวเล็กมากจะไม่ trigger (แต่กฎมวลใหญ่ยังกัน wipe ทั้งก้อนไว้อยู่)

## บทเรียนเสริม: AI อ่านภาพ 18+ ของโปรเจกต์นี้ไม่ได้

เปิดภาพเต็มหน้าจาก job dir (เช่น `source.png`) ด้วย Read tool แล้ว provider คืน `empty_model_response` — content filter ฝั่ง GLM ไม่ใช่บั๊ก วิธีทดแทนที่ใช้ได้ผลทั้งงานนี้:

- วิเคราะห์ด้วย numpy: mask coverage, ตำแหน่งนอก region, connected-component shape metrics
- **ASCII rendering**: threshold crop เป็นกริด `#`/`.` แล้วพิมพ์ออกทาง terminal — แถวตัวอักษรและเส้นโค้งอ่านออกเป็นข้อความ (ใช้ ~96 คอลัมน์, สูงครึ่งหนึ่งของสัดส่วนจริง)
- ให้ตาผู้ใช้เป็น final visual check เสมอ

สคริปต์วิเคราะห์ที่ใช้ครั้งนี้ (`analyze.py`, `analyze2.py`, `render.py`) อยู่ที่ `%TEMP%\superk-qa\` — เป็น temp dir อาจถูกลบ แนวคิดสรุปอยู่ในเอกสารนี้แล้ว

## สถานะ

- ยัง **ไม่ commit** — รอผู้ใช้ทดสอบกด Clean บน remnant ที่มีเส้นตัวละครใกล้ ๆ ในแอปก่อน (dev hot-reload ทันที / prod ต้องผ่าน launcher rebuild)
- `docs/AI-WORKING-NOTES.md` ไม่แตะตามกฎเดิม
