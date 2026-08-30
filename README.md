# SuperK Manga Translator

เว็บแปลมังงะพร้อมระบบคลีนข้อความแบบ local-first สำหรับ Windows ตัวคลีนใช้
CTD + OpenCV + AOT ONNX บน CPU และไม่เรียก paid API ส่วนการแปลภาษายังคงเป็น
ฟังก์ชันแยกที่ต้องตั้งค่า provider/API key ตามที่หน้าเว็บระบุ

## ติดตั้งระบบคลีน

ต้องมี Python และ Node.js ก่อน จาก PowerShell ที่โฟลเดอร์โปรเจกต์:

```powershell
cd ocr-service
py -3.11 -m venv venv
.\venv\Scripts\python -m pip install --require-hashes -r requirements.lock
.\venv\Scripts\python scripts\install_models.py --baseline
```

ไฟล์โมเดลจะถูกตรวจ SHA-256 ตาม `models/manifest.json` และไม่ถูก commit เข้า
Git ดูแหล่งที่มา ใบอนุญาต และ checksum ได้ใน
`ocr-service/THIRD_PARTY_MODELS.md`

## เปิดใช้งาน

เปิด PowerShell หนึ่งหน้าต่างสำหรับ local cleaning service:

```powershell
.\ocr-service\run.ps1
```

เปิดอีกหน้าต่างสำหรับเว็บ:

```powershell
npm install
npm run dev
```

จากนั้นเปิด `http://localhost:3000` อัปโหลดภาพ/ZIP/CBZ/PDF แล้วใช้ปุ่ม
“คลีนข้อความ” สามารถสลับ Original, Clean และ Mask รวมถึงแก้ mask และ retry
เฉพาะ region ได้

## ทดสอบ

```powershell
cd ocr-service
.\venv\Scripts\pytest tests -v
.\venv\Scripts\ruff check app scripts tests

cd ..
npm test
npx tsc --noEmit
npm run build
```

## Benchmark

corpus manifest เก็บเฉพาะ hash, ขนาดภาพ, หมวดหมู่ และผล human review ไม่เก็บ
ชื่อโดจินหรือพาธจริง ขั้นแรกสร้าง contact sheet แบบ hash-only แล้วใส่ label
`original_comic` ให้ภาพต้นฉบับที่ตรวจแล้ว:

```powershell
cd ocr-service
.\venv\Scripts\python scripts\review_benchmark_corpus.py `
  --root "F:\Doujin\Download" `
  --emit-review-dir benchmark-results\corpus-review `
  --count 160

.\venv\Scripts\python scripts\build_benchmark_manifest.py `
  --root "F:\Doujin\Download" `
  --review-labels benchmarks\review-labels.json `
  --count 30

.\venv\Scripts\python scripts\benchmark.py `
  --root "F:\Doujin\Download" `
  --manifest benchmarks\manifest.json `
  --protected-manifest benchmarks\protected-manifest.json `
  --visual-review benchmarks\visual-review.json `
  --cleaner aot `
  --regression-page "E:\SuperK\SuperK_Page_001_1.webp" `
  --regression-page "E:\SuperK\SuperK_Page_001_2.webp"
```

ผล JSON/Markdown ถูกเขียนใน `ocr-service/benchmark-results/` ซึ่ง Git ignore
ไว้ รอบล่าสุดบน Windows/CPU ผ่าน acceptance: median 7.95 วินาที, p95
15.37 วินาที, pixel ที่เปลี่ยนนอก support/ใน protected เท่ากับ 0 และ visual
review ผ่าน 12/12 รายละเอียดวิธีวัดและข้อจำกัดอยู่ที่
`docs/cleaning-benchmark.md`
