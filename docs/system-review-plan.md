# แผนงานแก้ไขจากการรีวิวระบบ (System Review Plan) — ฉบับปรับปรุงสำหรับ Local Single-User

- **วันที่รีวิว:** 2026-09-06 (อัปเดตตัด Over-engineering และเสริมจุดตาย Local Storage/Export/Network)
- **บริบทการใช้งาน:** โปรเจกต์นี้รันบนเครื่อง Local (Windows 11) สำหรับผู้ใช้งานคนเดียว (Single User) ผ่าน Node.js + Python venv โดยตรง
- **ขอบเขต:** Frontend (`src/app`, `components/`, `hooks/`, `lib/`), Python ML backend (`ocr-service/`), การประหยัดพื้นที่ดิสก์/หน่วยความจำในเครื่อง และการรักษาโควต้า API
- **วิธีใช้:** ทำงานตาม Phase จากบนลงล่าง ติ๊ก `- [ ]` เมื่อเสร็จแต่ละข้อ

---

## สรุปผู้บริหาร (Executive Summary)

**จุดแข็ง:** โครงสร้าง ML backend แยกชั้นดี (Protocol-based stages, pydantic Settings), เทสครอบคลุม ~270 vitest + ~107 pytest, เอกสารครบ, ประวัติ git สะอาด (ไม่เคยมี key หลุดเข้า commit)

**ทิศทางการปรับปรุง (Pragmatic Local Approach):**
ตัดงานประเภท **Over-engineering** สำหรับระบบคลาวด์/มัลติยูสเซอร์ออก (ไม่เขียน Rate Limiter ซับซ้อนในโค้ด, ไม่แตะ Docker/Compose เพราะรันบน Windows ตรงๆ, และไม่ฉีก Refactor โครงสร้างใหญ่ที่ไม่ใช่บั๊ก) 

**มุ่งเน้นเฉพาะจุดตายที่กระทบคนใช้งานบนเครื่องคอมพิวเตอร์จริง:**
1. **แก้บั๊ก UX และ Export คามือ (Phase 1):** Find & Replace ลบคำแปล, Auto-retry โยนผลทิ้ง, ฟอนต์ Canvas ไม่เปลี่ยน, **Offscreen export timeout ส่งออกภาพที่ยังไม่แปลเงียบๆ**, เซฟแล้วชื่อหน้าเพี้ยน
2. **ความปลอดภัยและออฟไลน์ (Phase 2):** อุดช่องโหว่ PDF RCE, ย้าย API key เข้า Header, โหลด PDF worker ในเครื่อง, **Bind Loopback `127.0.0.1` กันคนใน Wi-Fi/LAN แอบยิงกินโควต้า**
3. **ดิสก์รั่ว & Backend Robustness (Phase 3):** ล้างแคช `.cache/jobs` (457MB+) พร้อมแก้ assertion เทสคู่กัน, ใส่ Pixel-dimension guard, เคลียร์โมเดลส่วนเกิน 204MB
4. **ประสิทธิภาพ & พื้นที่จัดเก็บบนเครื่อง (Phase 4):** แก้ Auto-save deep-clone ทุกวินาที, **ล้าง Orphan Assets ขยะค้างใน IndexedDB ของเบราว์เซอร์**, ทำ Thumbnail แถบ Filmstrip
5. **ความสมบูรณ์ของไฟล์ส่งออก (Phase 5):** **XML Escaping ใน ComicInfo.xml** เพื่อไม่ให้ไฟล์ CBZ เสียหาย

---

## Phase 1 — บั๊กฟังก์ชันและ Export ที่ผู้ใช้เจอตรงๆ (ทำทันที ⭐⭐⭐)

> **สถานะ: ✅ เสร็จสิ้นทั้ง 7 ข้อ (2026-09-06)** — ตรวจรับผ่าน: `npx tsc --noEmit` (0 errors), vitest ชุดเต็ม **317 tests / 67 ไฟล์ ผ่าน 100%** (รวมเทสใหม่ `tests/translation/useTranslation.replaceBubbleText.test.tsx` 4 เคส), eslint ไม่มี error ใหม่เกิดขึ้น
> **หมายเหตุการแก้:** 1.1 ทำผ่านเมธอดใหม่ `replaceBubbleText()` ใน `useTranslation.ts` (แก้ข้อความใน cache ตรง + re-render ภาพพื้นหลัง แทนการ invalidate) และแก้บั๊กแฝง `regex.test()` ที่ stateful กับ flag `/g`; 1.7 timeout ปรับตามขนาดภาพ (สูงสุด 30 วิ) และเมื่อล้มเหลวจะ**ยกเลิก export พร้อมแจ้งเลขหน้า** แทนการใส่ภาพดิบเงียบๆ

### 1.1 Find & Replace ทำลายคำแปลแทนที่จะแก้ ✅
- **ที่:** `src/app/page.tsx` `handleFindReplace` (~บรรทัด 468–529)
- **อาการ:** กด replace แล้ว bubble ที่แก้แล้วหายวับ ทั้งโหมด "หน้านี้" และ "ทุกหน้า" + toast แจ้งจำนวนผิด
- **สาเหตุ:** `setActiveBubbles(...)` ถูก queue ก่อน แล้ว `invalidatePageTranslation()` (`hooks/useTranslation.ts` ~1157) ไปเรียก `setActiveBubbles([])` ทีหลัง → ผลลัพธ์หลังชนะ และ cache ถูกลบทิ้ง
- **วิธีแก้:** ทำ replace + อัปเดต cache เป็น atomic update เดียว (อัปเดต bubble ใน cache ตรงๆ โดยไม่ invalidate)
- **ตรวจรับ:** เทส Find & Replace ทั้งสองโหมด — bubble ที่แก้คงอยู่, cache ไม่ถูกลบ, สลับหน้ากลับมาแล้วยังเห็นคำที่แก้

### 1.2 ผลแปลจาก auto-retry ถูกทิ้ง ✅
- **ที่:** `hooks/useTranslation.ts` `performTranslation` (~798 กับ ~851)
- **อาการ:** หน้าที่แปลได้ 0 bubble แล้วเข้า auto-retry (contrast enhancement ~800–849) ผลรอบ retry ไม่ถูกใช้ → หน้านั้นเงียบๆ กลายเป็น clean-only
- **สาเหตุ:** retry บันทึกผลลง `parsed` แต่ `pageBubbles` คำนวณจาก response แรก และ `deduplicateBubbleSFX(pageBubbles, 3)` (~851) ยังใช้ array เปล่าของรอบแรก
- **วิธีแก้:** recompute `pageBubbles` จากผล retry (`parsed.bubbles`) ก่อนส่งเข้า dedupe
- **ตรวจรับ:** เทสเคส "response แรก 0 bubble, retry ได้ bubble" — ต้องได้ bubble จากรอบ retry ออกมาแสดงผลจริง

### 1.3 Error ที่ retry ไม่ได้ถูก retry 3 รอบ ✅
- **ที่:** `hooks/useTranslation.ts` ~1047 (และ `lib/translation/requestError.ts` ~142)
- **อาการ:** auth fail (401) / safety block / malformed request เสียเวลา 3–6 วิ × 3 รอบต่อหน้าใน batch
- **สาเหตุ:** `getTranslationRetryDelay(err, retries) ?? (retries === 0 ? 3000 : 6000)` ทำให้ `retryDelay` เป็น null ไม่ได้ → guard `if (retryDelay === null) break;` (~1053) เป็น dead code
- **วิธีแก้:** เช็ค `null` ก่อน apply fallback delay:
  ```ts
  const retryDelay = getTranslationRetryDelay(err, retries);
  if (retryDelay === null) {
    setTranslationResult(`แปลไม่สำเร็จ: ${errMsg}`);
    break;
  }
  ```
- **ตรวจรับ:** mock 401/403 → หยุดทันที 1 error ไม่มี retry ให้เสียเวลารอ

### 1.4 Font ที่เลือกไม่เคยถูกใช้จริงใน bubble ✅
- **ที่:** `lib/translationOverlay.ts` (~430, 615, 1261) + `layout.tsx` + `components/workspace/SettingsModal.tsx` (~181–183)
- **อาการ:** ข้อความใน bubble วาดด้วย sans-serif fallback แทน font ที่เลือกใน Settings เกือบทุกเคส
- **สาเหตุ:** layout โหลด font ผ่าน `next/font` (ชื่อ family ถูก hash) แต่ canvas ใช้ `ctx.font = "bold 16px Itim"` ตรงๆ ซึ่งไม่มี `@font-face` ชื่อนั้นอยู่; font "Mitr"/"Chakra Petch" ใน Settings ไม่เคยถูกโหลดเลย
- **วิธีแก้:** register ชื่อ static ผ่าน `@font-face` ใน `globals.css` (ชี้ไฟล์ font เดียวกัน) หรือ resolve CSS font family สำหรับ canvas + โหลด font ที่ประกาศใน Settings ให้ครบ
- **ตรวจรับ:** เลือก font ใดๆ ใน Settings → ข้อความใน bubble ต้อง render ด้วย font นั้นจริง

### 1.5 ปุ่ม Duplicate bubble ซ้อนเลเยอร์ + listener leak ✅
- **ที่:** `lib/translationOverlay.ts` (~1138–1143, paint 413–418, document listeners 1237–1249)
- **อาการ:** กด Duplicate ทีไร ทุก bubble ถูก stack ซ้ำเป็นชั้นใหม่ทับเดิม + document-level `pointerdown`/`keydown` ถูก attach เพิ่มเรื่อยๆ
- **สาเหตุ:** duplicate เรียก `paint()` ซ้ำ แต่ `paint` append `.tl-canvas` ใหม่โดยไม่ลบตัวเก่า
- **วิธีแก้:** ลบ `.tl-canvas` เดิมก่อน repaint ทุกครั้ง (หรือ reuse container) และ bind document listeners ครั้งเดียวพร้อม cleanup
- **ตรวจรับ:** กด Duplicate 5 ครั้ง → DOM มี `.tl-canvas` ชุดเดียว, event listeners ไม่ทับถม

### 1.6 Session save เขียนทับชื่อหน้าเป็น "Page" ✅
- **ที่:** `hooks/useTranslation.ts` `performSave` (~290)
- **อาการ:** restore session แล้ว export ได้ชื่อไฟล์ `SuperK_Page_001_Page.png` และ ComicInfo เสียชื่อเดิม
- **สาเหตุ:** `performSave` รับ `pages` เป็น URL string แล้ว map เป็น `{ url: p, name: "Page" }`
- **วิธีแก้:** เก็บและคงชื่อหน้าเดิม `{url, name}[]` ไว้เสมอ
- **ตรวจรับ:** save → restore → export ชื่อไฟล์ต้องคงเดิมตามไฟล์ต้นฉบับทุกหน้า

### 1.7 Offscreen export watchdog ส่งออกภาพยังไม่แปลเงียบๆ (อันตรายต่อผลงาน) ✅
- **ที่:** `src/app/page.tsx` `handleDownloadAll` (~บรรทัด 552–592)
- **อาการ:** ตอน export มังงะเล่มยาว ถ้าหน้าไหน render ช้าเกิน 4 วินาที ระบบจะ timeout แล้วแอบใส่ **ภาพดิบที่ยังไม่ได้แปล** ลงในไฟล์ ZIP/PDF เงียบ ๆ ทำให้ผู้ใช้ได้ไฟล์ที่แปลไม่ครบโดยไม่รู้ตัว
- **สาเหตุ:** Safety timeout สั่ง `resolve(pageUrl)` ตรง ๆ เมื่อหมดเวลา 4 วินาที
- **วิธีแก้:** ปรับให้เพิ่มเวลา timeout ตามขนาดภาพ หรือแจ้งเตือน Error ชัดเจน (Reject/Retry) แทนการแอบส่งภาพต้นฉบับเปล่า ๆ ออกไป
- **ตรวจรับ:** ทดสอบ render ภาพขนาดใหญ่หน่วงเกิน 4 วิ → ระบบต้องไม่ส่งภาพภาษาต้นฉบับดิบเข้า ZIP เงียบ ๆ

---

## Phase 2 — ความปลอดภัยและออฟไลน์ที่จำเป็นสำหรับเครื่อง Local ⭐⭐

> **สถานะ: ✅ เสร็จสิ้น (2026-09-06)** — pdfjs-dist → **6.3.289** (≥ 6.2.108 ปิด GHSA-hq66-cqwq-w95j), Gemini key ย้ายเข้า header `x-goog-api-key` (server + probe script + เทส), pdf.js worker ในเครื่อง (`scripts/copy-pdf-worker.mjs` รันทุก postinstall → `public/pdf.worker.min.mjs` เวอร์ชันตรงกัน), `.dockerignore` ทั้ง root + `ocr-service/`, dev/start bind `127.0.0.1`, และลบข้อความ "5 req/min" ปลอมออกจาก SettingsModal แล้ว
> **ตรวจรับ:** tsc 0 errors, vitest 317 tests ผ่าน 100%, lint กลับมาเท่า baseline | **รอผู้ใช้ทดสอบ manual:** เปิดไฟล์ PDF มังงะในแอป 1 รอบ

### 2.1 Upgrade `pdfjs-dist` ≥ 6.2.108 (ป้องกัน RCE) ✅
- **ความสำคัญ:** ช่องโหว่ **RCE ตอนเปิด PDF พิษภัย** (GHSA-hq66-cqwq-w95j) ซึ่งแอปนี้รับไฟล์ PDF มังงะจากภายนอกมาเปิดอ่าน
- `- [x]` รัน `npm i pdfjs-dist@^6.2.108` + ทดสอบเปิดไฟล์ PDF มังงะ *(อัปเกรดเป็น 6.3.289 + ยืนยันเวอร์ชัน worker ตรงกันแล้ว — ทดสอบเปิดไฟล์จริงรอผู้ใช้ทำ manual)*

### 2.2 ย้าย Gemini key ออกจาก URL query string ✅
- **ที่:** `lib/server/geminiRequest.ts:136`, `scripts/probe-gemini-models.mjs:39`
- **อาการ:** ปัจจุบัน API Key ต่อท้าย URL เป็น `?key=AIza...` ซึ่งติดใน access logs / network inspection
- `- [x]` เปลี่ยนไปส่งผ่าน HTTP Header `x-goog-api-key` แทน

### 2.3 Bundle pdf.js worker ภายในเครื่อง (รองรับ Offline) ✅
- **ที่:** `src/app/page.tsx` ~844
- **อาการ:** โหลด worker จาก `unpkg.com` ตอน runtime → ถ้าเน็ตหลุดหรือเว็บ CDN ล่ม จะเปิดอ่าน PDF ไม่ได้
- `- [x]` ชี้ path ไปที่ worker ภายใน `node_modules` หรือ copy มาไว้ใน `/public` เพื่อให้อ่าน PDF ได้แม้ออฟไลน์ *(ใช้ postinstall copy → `/public/pdf.worker.min.mjs`)*

### 2.4 วาง `.dockerignore` / เช็ค `.gitignore` ป้องกันคีย์รั่ว ✅
- `- [x]` สร้าง `.dockerignore` พื้นฐานกันไฟล์ `.env*` และ `.cache` เผื่อมีการ build image ในอนาคต *(สร้างทั้ง root และ `ocr-service/`)*
- `- [x]` ตรวจทาน `.gitignore` ว่าครอบคลุมไฟล์ config ลับทั้งหมด *(มี `.env*` อยู่แล้ว + เพิ่ม `/.zcode/`)*

### 2.5 ป้องกัน LAN แอบยิง API ด้วยการ Bind `127.0.0.1` (Localhost Only) ⭐ ✅
- **ความสำคัญ:** ปกติ `next dev` และ `next start` จะ bind ทุก network interface (`0.0.0.0`) ทำให้คนอื่นในเครือข่าย Wi-Fi/LAN เดียวกันสามารถเชื่อมต่อเข้า IP เครื่องเรา (`http://192.168.x.x:3000/api/translate`) แล้วยิงกินโควต้า Gemini API ของเราได้
- **วิธีแก้แบบ Zero-Code (ฉลาดและไม่ต้องเขียน Rate Limiter ให้หน่วงเครื่อง):**
  - `- [x]` ใน `package.json`: ปรับสคริปต์เป็น `"dev": "next dev -H 127.0.0.1"` และ `"start": "next start -H 127.0.0.1"`
  - `- [x]` ใน `ocr-service`: ตรวจสอบให้ uvicorn รันบน `--host 127.0.0.1` เท่านั้น *(ยืนยันแล้วว่า `run.ps1:16` bind 127.0.0.1 อยู่แล้ว)*
  - `- [x]` ผลลัพธ์: ปิดกั้นเครือข่ายภายนอก/Wi-Fi ไม่ให้เข้าถึงเซิร์ฟเวอร์ได้ 100% โดยไม่ต้องเขียนโค้ด Rate Limiter เพิ่มเติม

---

## Phase 3 — Backend Robustness & ดิสก์รั่ว (`ocr-service/`) ⭐⭐

> **สถานะ: ✅ เสร็จ 3.1–3.5 (2026-09-06)** — pytest **134 tests ผ่าน** (+6 เทสใหม่: sweep/active-guard/delete/purge/pixel-guard), ruff ผ่านทั้งชุด, ฝั่ง frontend ยังเขียว (vitest 317, tsc, lint เท่า baseline)
> **หมายเหตุ:** 3.1 เทสเดิม `test_more_than_15_jobs_not_deleted` ยังผ่านอยู่ (retention เป็นแบบอายุ ไม่ลบงานใหม่) — เพิ่มเทสใหม่ 3 เคสฝั่ง jobs + 3 เคสฝั่ง API แทน | ปุ่ม "ล้างภาพค้างบนเซิร์ฟเวอร์" ใช้ `POST /api/clean/v1/jobs/purge` (proxy รับ POST อยู่แล้ว ไม่ต้องแตะ proxy) | 3.5 ตัดสินใจ**เก็บ PaddleOCR logic ไว้**เพราะเทสครอบคลุมและเป็น inert อยู่แล้วเมื่อไม่ได้ติดตั้ง package (import fail เงียบๆ ตามดีไซน์)

### 3.1 Job/artifact retention — แก้ปัญหา Disk Leak ใน `.cache/jobs` (สำคัญมาก) ✅
- **ที่:** `ocr-service/app/jobs.py` `_write_assets` (375–401)
- **อาการ:** เซฟ 5 PNG + result.json ต่อ 1 หน้า โดยไม่เคยลบ ตอนนี้สะสมแล้ว **149 jobs / 457 MB** ถ้าใช้งานต่อเนื่องจะกินพื้นที่หลายสิบ GB
- `- [x]` เพิ่มระบบล้างอัตโนมัติ (TTL 24 ชม. default — sweep ตอน startup, ทุก submit (throttle 1 ชม.) และตอนกดปุ่ม; config ผ่าน `SUPERK_JOB_RETENTION_HOURS`)
- `- [x]` เพิ่ม endpoint `DELETE /v1/jobs/{id}` + `POST /v1/jobs/purge` และปุ่มล้างแคชใน Settings
- **⚠️ ข้อควรระวังเรื่อง Test:** ใน `ocr-service/tests/test_jobs.py:237` ฟังก์ชัน `test_more_than_15_jobs_not_deleted` มี assertion เดิมที่ระบุว่า "ห้ามลบ job เก่า" อยู่ **ต้องแก้เทสข้อนี้ให้สอดคล้องกับ Retention Policy ใหม่ด้วย** มิฉะนั้น Test Suite จะเฟลทันที! *(ผลจริง: เทสเดิมผ่านเพราะ policy เป็น age-based — เพิ่มเทสใหม่ครอบ sweep/delete แทน)*

### 3.2 Pixel-dimension guard & DecompressionBomb ✅
- **ที่:** `ocr-service/app/api.py:153–176`
- **อาการ:** เช็คแค่ขนาดไฟล์ Byte แต่ไม่เช็คขนาด Pixel รูปภาพขนาดมหึมาที่ถูกบีบอัดมาเล็กอาจระเบิดกิน RAM หลาย GB ตอน Decode
- `- [x]` เพิ่มเพดานตรวจขนาด Pixel สูงสุด (`SUPERK_MAX_IMAGE_MEGAPIXELS`, default 64 MP) ตรวจก่อน decode → 413 + ดักจับ `PIL.Image.DecompressionBombError` → 413

### 3.3 ย้าย Decode ออกจาก Event Loop ✅
- **ที่:** `ocr-service/app/api.py:60`
- `- [x]` ปรับให้ฟังก์ชัน decode ทำงานใน threadpool (`asyncio.to_thread`) ไม่ให้บล็อก event loop ของ FastAPI

### 3.4 Timeout & Watchdog สำหรับงานค้าง ✅
- `- [x]` ใส่ timeout ให้ `urlopen` ใน `ModelStore.ensure` (60 วิ per socket-op)
- `- [x]` เพิ่ม timeout watchdog ต่องานคลีน (`SUPERK_JOB_TIMEOUT_MINUTES`, default 15 นาที — job ถูก mark failed พร้อม guard ไม่ให้ผลล่าช้า复活; note: thread ที่ hang จริงๆ ฆ่าไม่ได้ใน Python แต่ state ไม่แขวนเป็น running ตลอดแล้ว)

### 3.5 เคลียร์ Dead Weight ฝั่งโมเดล (ประหยัดดิสก์ 204 MB) ✅
- `- [x]` `lama_large_512px.ckpt` (ขนาด 204 MB) ในโฟลเดอร์โมเดลไม่ได้ถูกเรียกใช้จริง → **ลบไฟล์ + ลบ .ckpt branch ใน `lama_large.py` + ลบ `lama_large_arch.py` + ลบ entry ออกจาก `manifest.json` + ลบ `--include-lama-large` ออกจาก `install_models.py`**
- `- [x]` PaddleOCR: **เก็บไว้ตามเหตุผลด้านบน** (logic inert + เทสครอบคลุม — ถ้าจะลบจริงต้องทำเป็น refactor แยกพร้อมลบเทส paddle)

### 3.6 ปรับ Heuristics ให้ Scale ตาม Resolution ภาพ — ⏸️ เลื่อนออก (ตัดสินใจเชิงวิศวกรรม)
- **ที่:** `detector.py`, `mask_refiner.py`
- **เหตุผลที่เลื่อน:** ค่าคงที่เหล่านี้ถูก tune จับคู่กับเทส + ภาพ debug ที่ commit มาทั้งชุด การเปลี่ยนเป็น scaling โดยไม่มีชุด benchmark สแกน hi-res (3500px+) จะ validate ไม่ได้ว่า quality ดีขึ้นจริง เสี่ยง regression คุณภาพ mask โดยไม่รู้ตัว
- **ทำเมื่อไหร่:** เก็บภาพสแกน hi-res จริง 5-10 หน้าเป็น benchmark → เปรียบเทียบ mask ก่อน/หลัง (มี `docs/cleaning-benchmark.md` อยู่แล้วใช้ต่อได้) → ค่อย derive scale factor ทีละค่า

---

## Phase 4 — Performance & พื้นที่จัดเก็บบนเครื่อง Local ⭐⭐

> **สถานะ: ✅ เสร็จทั้ง 5 ข้อ (2026-09-06)** — vitest **325 tests ผ่าน** (+8 ใหม่: LRUMap 4, dirty-save/GC 3, abort 1), tsc 0 errors, lint เท่า baseline
> **หมายเหตุการแก้:** 4.1 ตัด `JSON.parse(JSON.stringify())` ทั้งหมด (strip `render` fn ราย bubble แทน) + save แบบ **dirty-pages** (rewrite blob เฉพาะหน้าที่แก้) + แก้ save revision ตกหล่นตอน save ชนกัน (catch-up save) | 4.3 ใช้ `LRUMap` (cap 40 หน้า) กับภาพแปล และแยก `completedPagesRef` ออกจาก image cache เพื่อให้ **translate-all ไม่ re-translate หน้าที่ถูก evict** (ไม่เผาโควต้า API) + filmstrip ใช้ thumbnail 160px | 4.5 overlay adjustments key เป็น page URL — **ตำแหน่ง bubble ที่เคยลากไว้ภายใต้ key แบบ index เดิมจะไม่ถูกอ่านอีก (one-time reset)**

### 4.1 แก้คอขวด Auto-save Deep-Clone ทุก 1 วินาที (แก้ปัญหากระตุก) ✅
- **ที่:** `hooks/useTranslation.ts` ~318–334 และ `lib/projectStore.ts:212`
- **อาการ:** ทุกครั้งที่สลับหน้า มีการเรียก `JSON.parse(JSON.stringify(sessionData))` deep-clone ข้อมูลภาพทั้งเล่ม ถ้ามังงะยาว 50-100 หน้า จะทำให้เบราว์เซอร์กระตุกค้าง
- `- [x]` ปรับบันทึกเฉพาะหน้าที่แก้ไข (dirty pages) แทนการ clone ทั้งเล่ม
- `- [x]` เพิ่ม debounce การบันทึกให้เหมาะสม *(คง debounce 1 วิ เพราะ save ต่อหน้าแล้ว + เพิ่ม catch-up save กัน revision ตกหล่น)*

### 4.2 จัดการ Orphan Assets ขยะค้างใน IndexedDB ของเบราว์เซอร์ ⭐ ✅
- **ที่:** `lib/projectStore.ts` (`deleteAsset` ~151)
- **อาการ:** ทุกครั้งที่มีการคลีนภาพใหม่หรือแปลใหม่ ระบบจะสร้าง `translated_*` asset blob ก้อนใหม่ลงใน IndexedDB เสมอ แต่ไม่เคยเรียก `deleteAsset()` เพื่อลบ asset ก้อนเก่าที่ไม่ได้ใช้แล้วทิ้งเลย ส่งผลให้ **พื้นที่ IndexedDB ในดิสก์เครื่องของเบราว์เซอร์บวมขึ้นเรื่อย ๆ ตามกาลเวลา**
- `- [x]` เพิ่มกลไก Garbage Collection / Eviction ลบ asset เก่าเมื่อมีการเซฟทับหรือ invalidate หน้านั้น ๆ *(GC `translated_*` ทุกครั้งที่ save + `invalidatePageTranslation` ลบ asset ทันที)*
- `- [x]` รองรับปุ่ม "ล้างพื้นที่แคชเบราว์เซอร์" ให้ผู้ใช้กดเคลียร์ได้ *(ปุ่ม "🗃️ ล้างแคชเบราว์เซอร์" ใน SettingsModal → `purgeOrphanAssets()`)*

### 4.3 Memory Eviction & Filmstrip Thumbnail ✅
- `- [x]` แถบ Filmstrip ปรับมาใช้ฟังก์ชัน `generateThumbnail` ใน `lib/thumbnail.ts` (สร้าง thumbnail 160px แบบ sequential ต่อหน้า)
- `- [x]` ทำ LRU cache สำหรับภาพในหน่วยความจำ (`lib/lruMap.ts` + ปรับ skip ของ translate-all ให้ใช้ `completedPagesRef`)

### 4.4 Cancellation จริงด้วย AbortController ✅
- `- [x]` เมื่อผู้ใช้กดปุ่ม "ยกเลิกการแปลทั้งหมด" ส่ง `AbortSignal` ตัด network request ทันที (ครอบคลุม translate main/retry/NSFW slices/recognition fetch + abort ตอน unmount) — cancel ไม่ถูกนับเป็น page failure และไม่โดน retry

### 4.5 Overlay Canvas Cache Key ✅
- `- [x]` ปรับ cache key จาก page index ให้เป็น page URL (ผ่าน param ใหม่ `pageKeyOverride` ของ `applyTranslationOverlay` — ครอบคลุม export path ด้วย ซึ่งเดิม key เป็น `page--1` ทำให้ export ไม่เคยอ่านตำแหน่งที่ปรับไว้)

---

## Phase 5 — Export Safety & ความสะอาดของ Repository ⭐

> **สถานะ: ✅ เสร็จ (2026-09-06)** — vitest **328 tests ผ่าน** (+3 เทส escaping รวม XML round-trip ผ่าน DOMParser), tsc 0 errors, lint เท่า baseline, warning ของ Vite config loader หายแล้ว
> **หมายเหตุ:** `scratch/` (60 ไฟล์, 610KB) พบว่า**ไม่ได้ถูก track ใน git อยู่แล้ว** (gitignored) และมีไฟล์ส่วนตัวปน (LockScreen fix, check_updates.ps1 ฯลฯ) จึง**ไม่ลบข้อมูลบนดิสก์** — repo สะอาดอยู่แล้วจาก gitignore | `clean-then-translate-plan.edit.md` (34KB, tracked) ยังอยู่ — ถ้าต้องการลบ `git rm` ได้ทีหลัง

### 5.1 XML Escaping ใน ComicInfo.xml (ป้องกันไฟล์ CBZ เสียหาย) ⭐ ✅
- **ที่:** `lib/export/exportManager.ts:69–79` (`generateComicInfoXml`)
- **อาการ:** ข้อมูล Title, Series, Translator ถูกฉีดลง XML template ตรง ๆ โดยไม่มีการ escape อักขระพิเศษ (`&`, `<`, `>`, `"`, `'`) หากชื่อมังงะมีตัวอักษรเหล่านี้ เช่น `Tom & Jerry` หรือชื่อมีวงเล็บ จะทำให้ไฟล์ `ComicInfo.xml` กลายเป็น Invalid XML ทันที ส่งผลให้แอปอ่านการ์ตูน (Tachiyomi, Mihon, CDisplayEx) อ่านไฟล์ CBZ นั้นไม่ได้
- `- [x]` ทำฟังก์ชัน `escapeXml()` ครอบทุก field (title/series/number/summary/translator/languageISO) + เทสรองรับรวม XML round-trip

### 5.2 ความสะอาด Repository ✅
- `- [x]` เก็บกวาดภาพ debug ใน `ocr-service/` — **`git rm` debug_*.png / test_*.png 16 ไฟล์** (ตรวจแล้วว่าไม่มีเทส/โค้ดอ้างอิง)
- `- [x]` รวมไฟล์คอนฟิก `vitest.config.mts` และ `vitest.config.ts` ให้เหลือไฟล์เดียว — เก็บเนื้อหา `.ts` (config ที่ใช้จริง) เป็น `vitest.config.mts` + เปลี่ยน `__dirname` → `import.meta.dirname` → **warning configLoader ของ Vite หาย** | `scratch/`: untracked อยู่แล้ว ไม่แตะ (มีไฟล์ส่วนตัวปน)

---

## Phase 6 — เลือกโฟลเดอร์ปลายทางตอน Export (ฟีเจอร์ใหม่ — 2026-09-06)

> **สถานะ: ✅ เสร็จ** — vitest **332 tests ผ่าน** (+4 เทส saveLocation), tsc 0 errors, lint เท่า baseline

### 6.1 File System Access API directory picker
- `- [x]` helper `lib/export/saveLocation.ts`: `pickExportDirectory` / `writeBlobToDirectory` / `saveBlob` (fallback download ปกติ + revoke object URL แก้ leak เดิม) / pref helpers (localStorage)
- `- [x]` toggle `ถามตำแหน่งบันทึกทุกครั้งตอน Export` ใน SettingsModal
- `- [x]` ผูกทุกทางออก: ZIP/CBZ/PDF/Webtoon Strip (`handleDownloadAll`) + บันทึกหน้าเดียว (desktop + mobile)
- `- [x]` Fallback: Firefox/Safari/มือถือ หรือผู้ใช้กดปิด dialog → ดาวน์โหลดตามค่าตั้งต้น + toast แจ้งเมื่อเบราว์เซอร์ไม่รองรับ

## ☕ หมวดที่ตัดออก (De-scoped: Over-engineering สำหรับ Local Single-User)

*รายการเหล่านี้ถูกตัดออกจากแผนการลงมือทำ เพื่อไม่ให้เพิ่มความซับซ้อนโดยไม่จำเป็น:*

1. ❌ **In-code Rate Limiter Middleware:**
   - *เหตุผลที่ตัด:* แทนที่จะเขียนโค้ด Rate Limiter ให้ซับซ้อน เราเปลี่ยนไปใช้ **การ Bind Loopback `127.0.0.1` (ตามข้อ 2.5)** ซึ่งกันคนนอกใน Wi-Fi/LAN ได้ 100% ปลอดภัยกว่า และไม่จำกัดการทำงานของตัวผู้ใช้เอง
   - *สิ่งที่ทำแทน:* นำข้อความ "จำกัด 5 ครั้ง/นาที" ออกจากหน้า UI เพื่อไม่ให้สับสน
2. ❌ **Docker / Docker Compose Hardening:**
   - *เหตุผลที่ตัด:* ผู้ใช้รันโปรเจกต์ผ่าน `npm run dev` และ Python venv บน Windows ตรง ๆ ไม่ได้ใช้ Docker ในการทำงานประจำวัน
   - *สิ่งที่ทำแทน:* ข้ามการแก้ Compose และ non-root user ทั้งหมด
3. ❌ **การฉีกแยกไฟล์ `page.tsx` 1,676 บรรทัด:**
   - *เหตุผลที่ตัด:* หน้าจอและ State ปัจจุบันทำงานร่วมกันได้ดี การฉีกไฟล์ใหญ่ขนาดนี้มีความเสี่ยงสูงที่จะเกิด Regression บั๊กใหม่โดยไม่คุ้มค่า
   - *สิ่งที่ทำแทน:* คงโครงสร้างเดิมไว้ และแก้เฉพาะฟังก์ชันที่มีบั๊กจริง
4. ❌ **การลบ Dead Code Studio Stack 1,100+ บรรทัด:**
   - *เหตุผลที่ตัด:* โค้ดของ TextLayer / Studio tools ไม่ได้ถูกเรียกและไม่ได้ทำให้ระบบช้า เก็บไว้เป็นโค้ดสำรองสำหรับอนาคตได้ ไม่จำเป็นต้องเสี่ยงลบทิ้ง

---

## เกณฑ์ตรวจรับ (Verification Plan)

หลังทำแต่ละ Phase:
1. รัน Unit Tests: `npm test -- --run` (313 tests ต้องผ่าน 100%)
2. รัน TypeScript Check: `npx tsc --noEmit` (0 errors)
3. รัน Backend Tests: `cd ocr-service && pytest tests` (128 tests ต้องผ่าน 100%)
4. ทดสอบ Manual Flow: โหลดมังงะ → คลีนภาพ → แปล → ใช้ Find & Replace → บันทึกและ Export ต้องสมบูรณ์ ไร้บั๊กคำแปลหาย และไฟล์ CBZ เปิดใน Reader ได้สมบูรณ์
