# ดีไซน์ระบบคลีนข้อความมังงะแบบไฮบริดของ SuperK

- **วันที่:** 2026-07-27
- **สถานะ:** อนุมัติดีไซน์แล้ว
- **เป้าหมาย:** ระบบอัปโหลดไฟล์ผ่านเว็บของ SuperK
- **ข้อจำกัดด้านการประมวลผล:** ทำงานในเครื่องเท่านั้น ไม่ใช้ API แบบเสียเงิน และออกแบบให้ใช้ CPU เป็นหลักบน AMD Ryzen 5 5600G พร้อม RAM 31 GB
- **เป้าหมายด้านความเร็ว:** เวลามัธยฐาน 20–30 วินาทีต่อหน้า โดยให้ความสำคัญกับคุณภาพมากกว่าการบังคับตัดเวลา

## 1. ปัญหา

ปัจจุบัน SuperK สร้างพื้นที่คลีนขนาดกว้างจากกรอบข้อความของ OCR หรือ Vision Model แล้วลบข้อความด้วยการวัดความสว่าง, OpenCV inpainting หรือวาดพื้นสีขาวทับ ส่งผลให้เกิดปื้นสี่เหลี่ยมหรือปื้นสี ลบรายละเอียดภาพใกล้เคียง และทำงานได้ไม่ดีกับข้อความลอย ตัวอักษรมีเส้นขอบ ตัวอักษรสี และข้อความที่วางทับตัวละคร

ระบบใหม่ต้องลบเฉพาะรูปร่างของตัวอักษรต้นฉบับ ไม่ใช่ลบพื้นที่ทั้งกรอบข้อความ สำหรับพื้นบอลลูนที่เรียบควรใช้วิธีสร้างพื้นหลังแบบกำหนดผลได้แน่นอน และใช้โมเดล inpainting เฉพาะบริเวณที่เป็นงานวาดหรือพื้นหลังมีรายละเอียด

## 2. เป้าหมาย

- สร้างชั้นภาพคลีนโดยไม่วาดสี่เหลี่ยมสีขาวหรือปื้นสีทับภาพต้นฉบับ
- สร้าง text mask ระดับพิกเซลโดยไม่ขึ้นอยู่กับความแม่นยำของกรอบจาก Gemini
- รักษาเส้นขอบบอลลูน เส้นตัวละคร screentone gradient และพิกเซลรอบข้าง
- ทำงานในเครื่องโดยไม่ใช้ API เสียเงินหรือบริการที่มีค่าใช้จ่ายต่อเนื่อง
- ประมวลผลหน้าทั่วไปภายใน 20–30 วินาทีบน CPU เป้าหมาย
- ตรวจสอบ แก้ไข ประมวลผลซ้ำ undo และ cache แยกเป็นราย region ได้
- แยกข้อความแปลออกจากภาพคลีนจนกว่าจะ export
- ตรวจหาข้อความต้นฉบับที่ยังหลงเหลือ และซ่อมซ้ำเฉพาะบริเวณนั้น

## 3. สิ่งที่ไม่อยู่ในขอบเขต

- เปลี่ยนโมเดลแปลภาษาหรือ prompt แปลภาษาที่มีอยู่
- ใช้ Generative Image Model แปลหรือวาดภาพทั้งหน้าใหม่
- รับประกันว่าสามารถลบ SFX ที่มีรูปแบบซับซ้อนมากได้อัตโนมัติทุกกรณี
- นำ pipeline ใหม่ไปใช้กับ Chrome Extension ในการพัฒนารอบแรก
- ให้บริการ GPU ผ่านระบบออนไลน์

## 4. แนวทางที่เลือก

ใช้ pipeline แบบไฮบริดที่เลือกวิธีซ่อมเป็นราย region:

1. ตรวจจับข้อความและสร้าง segmentation mask ระดับพิกเซล
2. ปรับ mask ตามความหนาของเส้นตัวอักษรและเส้นงานวาดใกล้เคียง
3. รวมส่วนประกอบของ mask ที่อยู่ใกล้กันเป็น repair region
4. จำแนกแต่ละ region เป็นพื้นเรียบ พื้น gradient หรือบริเวณงานวาด
5. ใช้วิธีคลีนที่กระทบภาพน้อยที่สุดสำหรับ region นั้น
6. ผสานพิกเซลที่ซ่อมแล้วกลับผ่าน refined mask
7. ตรวจข้อความตกค้างและความเสียหายต่อภาพ
8. ซ่อมซ้ำหรือแจ้งให้ตรวจด้วยมือเฉพาะ region ที่ไม่มั่นใจ

ตัวเลือกแรกสำหรับ detector คือ `comic-text-detector` ที่ export เป็น ONNX และทำงานด้วย ONNX Runtime บน CPU ส่วนตัวเลือกแรกสำหรับซ่อมงานวาดคือ checkpoint ของ LaMa ที่ปรับสำหรับมังงะ/อนิเมะ (`lama-manga`) โดยเก็บ AOT inpainting ไว้เป็นตัวเลือกสำหรับ benchmark ไม่ติดตั้งใช้งานพร้อมกันโดยไม่จำเป็น

## 5. สถาปัตยกรรม

### 5.1 เว็บแอปพลิเคชัน

แอป Next.js ที่มีอยู่ยังรับผิดชอบงานต่อไปนี้:

- อัปโหลดรูปภาพและเอกสาร
- เปลี่ยนหน้าภาพ
- เริ่มและติดตาม cleaning job
- แสดงชั้น Original, Clean และ Mask
- แก้ mask และสั่งซ่อม region ใหม่ด้วยมือ
- แก้คำแปลและจัดวางข้อความ
- Export ผลลัพธ์

`lib/translationOverlay.ts` ต้องหยุดสร้าง cleaning mask หรือวาดพื้นหลังสำรองเอง หลังการเปลี่ยนแปลงไฟล์นี้จะวางข้อความแปลลงบนภาพคลีนที่ได้รับจาก local service เท่านั้น

### 5.2 Local vision service

ใช้ไดเรกทอรี `ocr-service` ที่มีอยู่เป็น local vision service โดยโค้ด production ใหม่อยู่ภายใต้ `ocr-service/app/` และต้องไม่ commit virtual environment เข้า repository

โมดูลที่เสนอ:

- `api.py`: FastAPI endpoints, validation, วงจรชีวิตของ job และ health check
- `pipeline.py`: ควบคุมลำดับการคลีนหนึ่งหน้า
- `detector.py`: ตรวจจับและทำ segmentation ข้อความผ่าน ONNX
- `mask_refiner.py`: กรอง component, ขยาย mask ตามความหนาของเส้น และป้องกันเส้นสำคัญ
- `region_router.py`: จำแนกเป็น Flat, Gradient หรือ Artwork
- `cleaners/flat.py`: สร้างพื้นสีท้องถิ่นแบบ robust
- `cleaners/opencv.py`: สร้างและเลือกผล OpenCV inpainting
- `cleaners/lama.py`: รัน manga LaMa เฉพาะ crop
- `compositor.py`: ผสาน region ด้วย feathered mask
- `verifier.py`: ตรวจข้อความตกค้างและความเสียหายข้างเคียง
- `cache.py`: Cache job และผลโมเดลตามเนื้อหา
- `schemas.py`: ชนิดข้อมูล request, result, region และ diagnostics

แต่ละโมดูลมีหน้าที่เดียวและสื่อสารกันผ่าน image array, mask และ region record ที่มีชนิดข้อมูลชัดเจน โค้ดที่ขึ้นอยู่กับโมเดลต้องอยู่หลัง interface ของ detector และ cleaner เพื่อให้เปรียบเทียบหรือเปลี่ยน checkpoint ได้โดยไม่กระทบสัญญาระหว่าง service กับเว็บ

### 5.3 Job API

งานคลีนทำแบบ asynchronous เพื่อไม่ให้ Next.js request ต้องรอหน้าเดียวเป็นเวลานาน

- `GET /v1/health`
  - รายงานความพร้อมของ service, โมเดล, runtime provider และ version
- `POST /v1/jobs`
  - รับภาพหนึ่งภาพพร้อมค่าตั้งการคลีน
  - คืน `job_id`, source hash และสถานะเริ่มต้น
- `GET /v1/jobs/{job_id}`
  - คืนสถานะ ขั้นตอน เวลาที่ใช้ ความคืบหน้าแต่ละ region คำเตือน และข้อผิดพลาด
- `GET /v1/jobs/{job_id}/result`
  - คืนภาพคลีน combined mask, region metadata, timing และ verification report
- `POST /v1/jobs/{job_id}/regions/{region_id}/retry`
  - รับ mask ที่แก้แล้วและ cleaner override ถ้ามี
  - ประมวลผลซ้ำเฉพาะ region ที่เลือก

Next.js API layer จะทำหน้าที่ proxy endpoint เหล่านี้ เพื่อไม่ให้ browser ต้องเชื่อมต่อข้าม origin ไปยังพอร์ต localhost โดยตรง

## 6. ลำดับการไหลของข้อมูล

1. เว็บคำนวณ hash และอัปโหลดหน้าต้นฉบับ
2. Local service ปรับ orientation และรูปแบบสีโดยรักษาขนาดภาพต้นฉบับ
3. Detector สร้าง text block, line polygon, confidence และ pixel mask
4. กรอบจาก OCR หรือ Gemini ใช้ช่วยกำหนดพื้นที่ค้นหาได้ แต่ห้ามใช้เป็น deletion mask โดยตรง
5. Mask refiner กรอง noise วัดความหนาเส้น ขยายรูปตัวอักษร และป้องกันไม่ให้ mask ข้ามเส้นสำคัญ
6. รวม component ที่ใกล้กันเป็น repair region
7. Router กำหนด cleaner และ confidence ให้ทุก region
8. Cleaner ซ่อมเฉพาะพิกเซลที่อยู่ใน mask และใช้ context crop เมื่อจำเป็น
9. Compositor ผสานผลซ่อมลงบนภาพต้นฉบับ
10. Verifier ตรวจหาร่องรอยตัวอักษรและการเปลี่ยนแปลงที่ไม่ควรเกิด
11. หากไม่ผ่านการตรวจ ให้ซ่อมซ้ำเฉพาะ region ได้หนึ่งรอบ หากยังไม่ผ่านให้เก็บพิกเซลต้นฉบับและตั้งสถานะรอตรวจ
12. Service คืนภาพคลีนพร้อม diagnostics
13. SuperK วางข้อความแปลเป็นชั้นที่แก้ไขได้แยกจากภาพ

## 7. การสร้างและปรับ Mask

### 7.1 ผลลัพธ์จาก Detector

Detector ต้องคืน probability mask ระดับพิกเซลพร้อมกับ text box การมีเพียง bounding box ไม่เพียงพอสำหรับการลบข้อความ

### 7.2 การกรอง Component

กรอง connected component ด้วยข้อมูลต่อไปนี้:

- Confidence ของ detector
- พื้นที่ต่ำสุดและสูงสุดเทียบกับขนาดหน้า
- ความสม่ำเสมอของความหนาเส้น
- ระยะห่างจาก text line หรือ OCR box
- หลักฐานด้านรูปร่างที่สอดคล้องกับตัวอักษร

ขั้นตอนนี้แทน threshold ความสว่างแบบ global ที่ระบบเดิมใช้ ซึ่งเลือกแสงสะท้อนบนผิว เสื้อสีขาว เส้นผม และพื้นบอลลูนผิดเป็นข้อความ

### 7.3 การขยาย Mask ตามความหนาของเส้น

ขยาย binary mask ตามค่าความหนาของเส้นตัวอักษร โดยทั่วไปประมาณ 2–4 พิกเซลที่ความละเอียดต้นฉบับ การขยายต้องตามรูปร่างตัวอักษรและห้ามกลายเป็นสี่เหลี่ยมทึบเต็มกรอบข้อความ

ตัวอักษรที่มี outline หรือ shadow จะได้รับ mask วงนอกเพิ่มเติมจากการวิเคราะห์สีและความต่อเนื่องของขอบในบริเวณนั้น ค่าการขยาย mask ต้องถูกบันทึกแยกแต่ละ region เพื่อให้ทำซ้ำหรือ retry ได้

### 7.4 เส้นที่ต้องป้องกัน

เส้นเด่นที่เป็นขอบบอลลูน ขอบ panel หรือ line art ของตัวละครจะถูกตั้งเป็น protected edge การขยาย mask ต้องหยุดที่ขอบดังกล่าว เว้นแต่ detector มีหลักฐานตัวอักษร confidence สูงอยู่ทั้งสองฝั่ง

### 7.5 การรวม Region

รวม component ด้วยสมาชิกของบรรทัด ระยะห่าง ทิศทาง และพื้นหลังร่วมกัน บริเวณงานวาดที่อยู่ใกล้กันอาจใช้ context crop เดียวกันเพื่อลดเวลา inference แต่ final blend mask ของแต่ละ region ยังแยกจากกัน

## 8. การเลือกวิธีซ่อมแต่ละ Region

Router คำนวณ feature จากวงแหวนรอบ mask:

- ความแปรปรวนของสีแบบ robust ใน Lab color space
- ขนาดและทิศทางของ gradient
- ความหนาแน่นและความต่อเนื่องของ edge
- Local entropy และ texture energy
- ระยะจากขอบบอลลูนและขอบ panel
- สัดส่วนพื้นที่ที่มี line art

จากนั้นกำหนดหนึ่งในสามเส้นทาง:

### 8.1 `FLAT`

ใช้กับพื้นบอลลูนสีขาว สีอื่น หรือพื้นที่เกือบเรียบ

- ประเมินพื้นหลังจาก median หรือกลุ่มสีในวงแหวนรอบ mask
- สร้าง gradient อ่อนเมื่อใช้สีเดียวไม่เพียงพอ
- ผสานขอบด้วย edge-aware feather ขนาดแคบ
- ไม่เรียกใช้ neural inpainting

### 8.2 `GRADIENT`

ใช้กับ gradient, screentone และ texture ระดับเบา

- รัน OpenCV Telea หลาย candidate ด้วย radius หลายค่าในขอบเขตจำกัด
- ให้คะแนนจากความต่อเนื่องของขอบ ความสอดคล้องของ texture และความชัดของรอยต่อ
- เลือก candidate ที่ดีที่สุดแทนการใช้ radius เดียวกับทุกภาพ

### 8.3 `ARTWORK`

ใช้กับข้อความบนตัวละคร เสื้อผ้า ฉากที่มีรายละเอียด หรือ SFX หนาแน่น

- เพิ่ม context รอบ mask 64–128 พิกเซลต้นฉบับ
- Resize เฉพาะเมื่อจำเป็น โดยรักษา aspect ratio และ mapping พิกัดอย่างถูกต้อง
- รัน `lama-manga` บน crop ขนาด 512–768 พิกเซล
- รวม artwork region ใกล้กันเมื่อการใช้ context ร่วมช่วยลดเวลา inference
- ผสานผลกลับผ่าน refined mask และ feather ring เท่านั้น

## 9. กลยุทธ์ด้านประสิทธิภาพ

เป้าหมาย 20–30 วินาทีเป็นค่ามัธยฐานด้านคุณภาพ ไม่ใช่ hard timeout ที่ยอมทำลายผลลัพธ์เพื่อให้ทันเวลา

งบเวลาที่คาดไว้สำหรับหน้าทั่วไปบน CPU:

- Decode และ normalization: ต่ำกว่า 1 วินาที
- ONNX detection และ segmentation: 4–8 วินาที
- Mask refinement และ routing: 1–3 วินาที
- Flat และ gradient cleaning: 1–4 วินาที
- Artwork crop แบบ batch: 8–16 วินาที
- Verification และ encoding: 2–4 วินาที

Pipeline หลีกเลี่ยง neural inpainting ทั้งหน้า โดยรวม artwork crop ที่อยู่ใกล้กันและ cache ผล detector, mask และ cleaner ตาม source hash, model version และค่าตั้ง การ retry region ต้องไม่รัน detector หรือ cleaner ของ region อื่นใหม่

หน้าที่มีข้อความบนงานวาดหนาแน่นผิดปกติอาจใช้เวลาเกิน 30 วินาที UI จะแสดงขั้นตอนปัจจุบันและเวลาที่ใช้แทนการยกเลิก quality pass

## 10. การตรวจสอบและความปลอดภัยของภาพ

### 10.1 ข้อความตกค้าง

Verifier ใช้ข้อมูลร่วมกันดังนี้:

- Detector probability ที่ยังเหลือในพื้นที่ข้อความเดิม
- หลักฐานจาก OCR เมื่อ OCR รองรับภาษาต้นฉบับ
- Connected component ที่มีรูปร่างเหมือนเส้นตัวอักษรภายในพื้นที่ซ่อม

หาก residual score สูงกว่า threshold ระบบจะขยาย mask ของ region นั้นและ retry หนึ่งครั้ง

### 10.2 ความเสียหายข้างเคียง

- พิกเซลภายนอก repair mask รวม feather support ต้องเหมือนต้นฉบับแบบ byte ต่อ byte
- วัดความไม่ต่อเนื่องของ gradient ที่ขอบและการเปลี่ยนสีผิดปกติแยกทุก region
- ปฏิเสธผลซ่อมที่มี damage score เกิน threshold
- Region ที่ถูกปฏิเสธต้องเก็บพิกเซลต้นฉบับและตั้งสถานะ `needs_review`

### 10.3 การแยกความล้มเหลว

- หาก detector ล้มเหลว สามารถใช้กรอบ OCR หรือ Gemini เป็น search region แล้วสร้าง local mask ภายในกรอบ
- หาก LaMa ล้มเหลว ให้ fallback ไปยัง OpenCV candidate ที่ดีที่สุดของ region นั้น
- Region เดียวที่ล้มเหลวต้องไม่ทำให้ทั้งหน้าล้ม
- หาก service ล้มเหลว ต้องรักษาภาพต้นฉบับและสถานะข้อความแปลที่แก้ไขไว้
- Error ต้องระบุ stage, region, model, เวลาที่ใช้ และวิธีแก้ที่ผู้ใช้ทำได้

## 11. ประสบการณ์แก้ไขบนเว็บ

หน้า editor แสดงสาม layer ที่เปิดและปิดได้:

- `Original`
- `Clean`
- `Mask`

Mask layer ใช้สีแยก route และแสดง confidence พร้อม verification status เมื่อเลือก region ผู้ใช้สามารถ:

- ระบายเพิ่มหรือลบพื้นที่ mask
- เลือก `Auto`, `Flat`, `OpenCV` หรือ `LaMa`
- Retry เฉพาะ region
- กดค้างเพื่อเปรียบเทียบก่อนและหลัง
- Undo หรือ redo การแก้และการ retry

ภาพคลีนเป็น background layer จริง ส่วนข้อความแปลยังเป็น layer แยกจนกว่าจะ export ตัว renderer บนเว็บห้ามเพิ่ม cleaning canvas สีขาวหรือ background patch หลังข้อความแปล

## 12. Cache และการทำซ้ำผลลัพธ์

Cache key ประกอบด้วย:

- SHA-256 ของ byte ภาพต้นฉบับ
- Identifier ของ detector และ cleaner model
- Hash ของไฟล์โมเดล
- Pipeline version
- ค่าตั้ง mask และ routing

แต่ละผลลัพธ์เก็บข้อมูลต่อไปนี้:

- ภาพคลีน
- Combined mask
- Crop และ mask ของแต่ละ region
- Route และ confidence ของแต่ละ region
- ประวัติการ retry
- Timing
- Verification report

การแก้ด้วยมือสร้าง derived result ใหม่โดยไม่เขียนทับผล automatic เดิม

## 13. ชุดข้อมูล Benchmark

แหล่ง benchmark หลักคือ `F:\Doujin\Download` ซึ่งปัจจุบันมีไฟล์ภาพที่แตกแล้วทั้งหมด 881 ไฟล์ แบ่งเป็น WebP 474 ไฟล์, JPG 334 ไฟล์ และ PNG 73 ไฟล์

Benchmark manifest เลือกหน้าต้นฉบับที่เป็นตัวแทนจำนวน 30 หน้า โดยตัดโฟลเดอร์ที่ระบุว่าแปลแล้ว เช่น `[English]`, `[Chinese]`, `[Thai]`, `ภาษาไทย` หรือ `[中国翻訳]` ออกจากชุดหลัก

ชุดที่เลือกต้องครอบคลุม:

- บอลลูนสีขาวและบอลลูนสี
- ข้อความภาษาญี่ปุ่นแนวตั้ง
- ตัวอักษรมี outline และตัวอักษรสี
- SFX ที่ลอยทับงานวาด
- Screentone ขาวดำ
- พื้นหลังสีที่ซับซ้อน
- หน้าที่มีข้อความหนาแน่น
- หน้าที่ไม่มีข้อความ

Benchmark manifest เก็บ relative identifier, file hash, dimensions และ category label โดยไม่คัดลอกหรือ commit ภาพต้นฉบับเข้า repository

`E:\SuperK\SuperK_Page_001_1.webp` และ `E:\SuperK\SuperK_Page_001_2.webp` ยังคงเป็น regression reference สำหรับปัญหาปื้นสีที่เคยพบ แต่ไม่ใช้เป็นข้อมูลหลักของ benchmark

## 14. เกณฑ์การยอมรับ

- ไม่เห็นสี่เหลี่ยมสีขาวหรือปื้นสีจากการคลีน
- อย่างน้อย 95% ของ text region ใน benchmark ต้องไม่พบข้อความต้นฉบับสูงกว่า residual threshold ที่กำหนด
- อย่างน้อย 90% ของ region ผ่านโดยไม่ต้องแก้ mask ด้วยมือ
- เส้นขอบบอลลูนและขอบงานวาดที่ป้องกันไว้ต้องต่อเนื่อง
- พิกเซลภายนอก repair-mask support ต้องเหมือนต้นฉบับแบบ byte ต่อ byte
- หน้าที่ไม่มีข้อความต้องได้ผลเหมือนต้นฉบับทุกพิกเซลหลังผ่าน lossless processing
- เวลามัธยฐานแบบ end-to-end ไม่เกิน 30 วินาทีบนเครื่องเป้าหมายหลังโหลดโมเดลแล้ว
- ผลซ่อมที่ล้มเหลวหรือไม่มั่นใจต้องเก็บ region ต้นฉบับและรายงาน `needs_review`
- Regression page สองหน้าจาก `E:\SuperK` ต้องไม่เกิดปื้นสีกว้างแบบเดิม
- Integration test ต้องครอบคลุม upload, cleaning, layer inspection, region retry, typesetting และ export

## 15. กลยุทธ์การทดสอบ

### Unit test

- การกรอง component
- การประเมินความหนาเส้นและ mask dilation
- พฤติกรรมของ protected edge
- การรวม region และการแปลงพิกัด crop ไปกลับ
- การคำนวณ feature และการจำแนก route
- ความคงที่ของ cache key
- ข้อกำหนดว่าพิกเซลนอก mask support ต้องไม่เปลี่ยน

### Golden test

- Refined mask ที่อนุมัติแล้วสำหรับ crop ตัวแทน
- ผลซ่อม Flat, Gradient และ Artwork ที่อนุมัติแล้ว
- Pixel-diff tolerance จำกัดอยู่เฉพาะ mask และ feather support

### Integration test

- ตั้งแต่อัปโหลดจนได้รับภาพคลีน
- การรายงานความคืบหน้า
- Cache hit
- การ retry ด้วย mask ที่แก้แล้วเฉพาะ region
- Fallback ของ detector, OpenCV และ LaMa
- Translation overlay และ export ที่ใช้ clean image layer

### Performance test

บันทึกเวลาโหลดโมเดลแบบ cold และ warm แยกจากกัน รายงานเวลาของ detector, routing, cleaner, verification, encoding และเวลารวม เกณฑ์ยอมรับใช้ค่ามัธยฐานแบบ warm เพราะโหลดโมเดลเพียงครั้งเดียวต่อ service session

## 16. ข้อจำกัดด้านโมเดลและลิขสิทธิ์

ระบบคลีนต้องใช้งานได้ฟรีและทำงาน offline หลังติดตั้งโมเดลครั้งแรก ก่อนเผยแพร่ SuperK ให้ผู้ใช้อื่นต้องตรวจ license ของ model weight และ dependency ทุกตัว ห้ามนำ GPL component ไปใส่ในการเผยแพร่ที่ใช้ license ไม่สอดคล้องกันโดยไม่ทำตามเงื่อนไขของ GPL

Implementation plan ต้องบันทึก checkpoint ที่เลือก, source URL, checksum, license และการตัดสินใจว่าจะเผยแพร่ไฟล์โมเดลนั้นพร้อมโปรแกรมหรือให้ผู้ใช้ดาวน์โหลดเอง

## 17. แหล่งอ้างอิง

- [comic-text-detector](https://github.com/dmMaze/comic-text-detector)
- [manga-image-translator](https://github.com/zyddnys/manga-image-translator)
- [comic-translate](https://github.com/ogkalu2/comic-translate)
- [IOPaint](https://www.iopaint.com/)
