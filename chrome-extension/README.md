# SuperK Chrome Extension

ส่วนเสริม Chrome สำหรับคลิกขวาที่ภาพมังงะแล้วแปลทับบนหน้าเว็บ ใช้ API `/api/translate` ของระบบ SuperK เดิม หรือใช้ Gemini API Key โดยตรง

## ติดตั้งบนเครื่องนี้

1. เปิด Terminal ที่โฟลเดอร์ `manga-translator` รัน `npm run dev` แล้วเปิดระบบทิ้งไว้
   - ถ้า npm เรียกไม่ขึ้น ใช้ `node node_modules/next/dist/bin/next dev -H 127.0.0.1` แทน
   - ตั้งค่าผู้ให้บริการแปลใน `.env.local` ตามระบบเดิม เช่น `GEMINI_API_KEY` หรือคู่ `SUPERK_TRANSLATE_BASE_URL` / `SUPERK_TRANSLATE_API_KEY`
2. เปิด `chrome://extensions` ใน Chrome แล้วเปิด **Developer mode**
3. กด **Load unpacked** เลือก `C:\Users\PC\Downloads\manga-translator\chrome-extension` (โฟลเดอร์ที่มี `manifest.json`)
4. กดไอคอน SuperK เลือก **ใช้ระบบ SuperK ของฉัน** ใส่ `http://127.0.0.1:3000` ถ้าแอปใช้พอร์ตอื่น ให้เปลี่ยนตามนั้น
5. กด **บันทึกการตั้งค่า** เปิดเว็บมังงะ คลิกขวาที่ภาพ → **แปลภาพมังงะด้วย SuperK**

หลังแก้ไฟล์ส่วนเสริม กด Reload ที่ `chrome://extensions` และรีเฟรชเว็บมังงะที่เปิดค้างอยู่

## การใช้งาน

- ค่าเริ่มต้นแปลเป็นภาษาไทย ใช้โมเดลอัตโนมัติจาก backend
- โหมดระบบ SuperK ใช้คีย์บนเซิร์ฟเวอร์ ไม่ส่ง Gemini Key ที่เก็บในส่วนเสริมไปให้เซิร์ฟเวอร์ และไม่ได้คัดลอกการตั้งค่าใน localStorage ของเว็บหลัก
- ถ้าใช้ backend แบบ OpenAI-compatible โมเดลขึ้นกับการตั้งค่าบนเซิร์ฟเวอร์ ตามพฤติกรรมของ API เดิม
- โหมด **ใช้ Gemini API Key โดยตรง** ไม่ต้องเปิด backend แต่ต้องกรอกคีย์ในส่วนเสริม
- ใน **ตัวเลือกการแปลและแสดงผล** เลือกพื้นขาวปิดข้อความเดิม หรือวางคำแปลโดยไม่ปิดภาพเดิม
- กด **ดูต้นฉบับ** เพื่อซ่อนทั้งคำแปลและพื้นขาว กด ✕ เพื่อปิดผลลัพธ์
- รีเฟรชหน้าแล้วผลลัพธ์จะหาย

## ขอบเขตและข้อมูลที่ส่ง

- รองรับภาพ `<img>` ที่โหลดผ่าน HTTP/HTTPS หรือ data URL ขนาดไม่เกิน 20 MB รวมภาพใน iframe ที่ส่วนเสริมเข้าถึงได้
- ไม่รองรับ canvas, CSS background, blob URL, Chrome Web Store และหน้า `chrome://` เว็บไซต์ที่ป้องกันการโหลดภาพอาจต้องบันทึกภาพแล้วนำเข้าเว็บ SuperK
- ส่วนเสริมขอสิทธิ์ HTTP/HTTPS เพื่อโหลดภาพจากเว็บไซต์/CDN และเรียก backend ที่ตั้งค่าไว้ การแปลเริ่มเมื่อผู้ใช้เลือกเมนูคลิกขวาเท่านั้น
- โหมดเซิร์ฟเวอร์ส่งภาพที่เลือกไปยัง URL ระบบ SuperK และผู้ให้บริการแปลที่ระบบนั้นตั้งค่าไว้ โหมดโดยตรงส่งภาพไปยัง Google Gemini
- การตั้งค่ารวมคีย์โหมดโดยตรงเก็บใน Chrome sync storage ตามพฤติกรรมเดิม ไม่แนบ `.env.local` หรือคีย์เซิร์ฟเวอร์ไปในแพ็กเกจ
- รุ่นนี้ใช้ข้อความทับภาพและพื้นขาว ยังไม่ได้เชื่อม workflow ล้างภาพ OpenCV/LaMa และเครื่องมือแก้ไขทั้งหมดจากเว็บหลัก ตัวเลือก LaMa/Hugging Face เดิมที่ไม่ได้แสดงผลจริงถูกนำออกจากหน้าตั้งค่า
- การทดสอบอัตโนมัติใช้ API จำลอง ไม่ได้ยืนยันคุณภาพคำแปลหรือโควตาคีย์จริง

## แพ็กไฟล์เพื่อย้ายเครื่อง

จากโฟลเดอร์โปรเจกต์ รัน `node scripts/package-chrome-extension.mjs`

ได้ `dist/superk-chrome-extension.zip` แตก ZIP แล้วเลือกโฟลเดอร์ที่แตกด้วย Load unpacked เครื่องปลายทางต้องเข้าถึง backend ที่ตั้งค่าไว้ด้วย ยังไม่ได้เผยแพร่บน Chrome Web Store

## ตรวจสอบ

```powershell
node node_modules/vitest/vitest.mjs run tests/chrome-extension --root .
node node_modules/typescript/bin/tsc --noEmit
```

การเรียก API ข้ามโดเมนใช้ service worker และ host permissions ตาม [เอกสาร Chrome](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests) ไม่ต้องเปิด CORS ของ backend ให้ทุกเว็บไซต์
