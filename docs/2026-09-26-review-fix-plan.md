# แผนแก้ไขจากรายงานรีวิว (Review Fix Plan) — 2026-09-26 (ฉบับปรับตามคิวของผู้ใช้)

- **ที่มา:** `docs/2026-09-26-full-system-review.md` **ฉบับที่ผู้ใช้ปรับปรุงเอง** — ส่วน **"ข้อตกลงจากการทบทวนแผน (grill-with-docs)"** และ **"ลำดับลงมือและเกณฑ์ตรวจรับที่แนะนำ"** ในรายงานคือคิวและเกณฑ์ทางการ แผนนี้เป็น checklist ปฏิบัติที่ align กับคิวนั้น (ปรับล่าสุด: ถอน D1/D2/A1/A2 ออกจากคิวหลัก, เพิ่ม B2/B10/C12 ตาม P1-ข/P1-ค)
- **กติกาที่ผูกกับทุกข้อ (จากรายงาน):**
  1. ข้อที่เป็น 🔍 ต้อง **reproduce หรือหาหลักฐานหักล้างกับ HEAD ที่จะลงมือก่อนแก้** — พิสูจน์ไม่ได้ให้พักไว้และปรับระดับตามหลักฐาน ในคิวหลัก 16 ข้อ มีเพียง B1, A4, E1 ที่ ✅ ยืนยันแล้ว ที่เหลือ 13 ข้อต้องพิสูจน์ก่อนเสมอ
  2. Threat model = เว็บภายนอก + renderer ของแอปเท่านั้น; โปรแกรมอื่นที่ผู้ใช้ติดตั้งใน Windows ได้รับความไว้วางใจ (Local Single-User)
  3. **กฎเหล็ก:** production live path ล็อคที่ Fixed Route (`requestGemini`) — ทุกชุดที่แตะ `src/app/api/translate*` ต้องระวังไม่ให้กระทบ `requestGemini`
  4. Line numbers อ้างจาก commit `bcd4cb3`; ณ ตอนปรับแผน HEAD คือ `f8de9f6` + มี diff ค้าง (`hooks/usePageZoom.ts` wheel-pan feature กำลังพัฒนา + test ประกอบ — เป็นงานแยกของผู้ใช้ ไม่อยู่ในแผนนี้; หมายเหตุ: B19 ยังเปิดอยู่ใน diff นั้นเพราะเส้นทาง zoom ยังคูณจาก closure scale)
- **ประตูคุณภาพต่อชุด:** `npx tsc --noEmit` + `npx vitest run` ผ่าน (+ `ocr-service/venv/Scripts/python.exe -m pytest tests -q` เมื่อแตะ ocr-service) + **ทดสอบ flow ผู้ใช้จริงของชุดนั้น** + `npm run lint` คง 0 errors; baseline 929 vitest / 186 pytest ใช้เทียบ regression เท่านั้น
- **การ commit:** 1 ชุดที่ผ่านเกณฑ์ = 1 commit — นำแต่ละชุดมาใช้ได้ทันที ไม่รอครบทุกข้อ (ตามข้อตกลงในรายงาน)

---

## ชุดที่ 1 — Web Quick Wins (แก้แคบ กระทบ UX รายวันสูงสุด — ตามรายงาน)

### 1.1 [B1] 🔴 Bubble ที่ลบแล้วต้องไม่ลง export ✅ ยืนยันแล้ว
- **ที่:** `lib/translationOverlay.ts` — `downloadTranslatedImage` (~:221) + `deleteBubbleWithUndo` (~:1062)
- **แก้:** `deleteBubbleWithUndo` mark wrapper (เช่น `data-deleted`); ทุกจุด composite/export ที่ใช้ compositor เดียวกันข้าม wrapper ที่ mark หรือ `style.display === "none"`
- **เกณฑ์ตรวจรับ (ตามรายงาน):** bubble ที่ซ่อนถูกตัดจาก export **ทุก format ที่ใช้ compositor เดียวกัน**; undo แล้วกลับมา

### 1.2 [C1] 🔴 Retry cleaner `lama-large` ต้องใช้ได้จริง 🔍 พิสูจน์ก่อน
- **ที่:** `ocr-service/app/pipeline.py:879-888` (เทียบ `ocr-service/app/api.py:50`)
- **พิสูจน์:** POST retry เลือก `lama-large` จริง → เห็น `RuntimeError: cleaner is unavailable`
- **แก้:** เพิ่ม `"lama-large": "lama-large"` ใน mapping
- **เกณฑ์ตรวจรับ:** retry ด้วย `lama-large` ทำงานเมื่อ model พร้อม หรือคืน error ที่ตรงเหตุ — ไม่รับแล้ว fail เงียบๆ

### 1.3 [U1] 🔴 Global shortcuts ไม่ทะลุ modal 🔍 พิสูจน์ก่อน
- **ที่:** `src/app/page.tsx:767-831` (เทียบ focus-mode handler ~:170-180)
- **พิสูจน์:** เปิด MaskEditor แล้วกด Arrow/T/Ctrl+F → เห็นหน้าเปลี่ยน/งานวิ่งใต้ dialog
- **แก้:** guard ชุดเดียวกับ focus-mode: skip เมื่อ `isContentEditable` หรือ `closest('[role="dialog"]')`
- **เกณฑ์ตรวจรับ:** เปิด MaskEditor แล้ว Arrow/T/Ctrl+F ไม่เปลี่ยนหน้า/งานใต้ dialog; ปิด dialog แล้ว shortcut ปกติ

### 1.4 [U2] 🔴 Space ชิง button activation 🔍 พิสูจน์ก่อน
- **ที่:** `src/app/page.tsx:822-826`
- **พิสูจน์:** โฟกัสปุ่มใดก็ได้ กด Space → เห็น toggle ภาพแทนการกดปุ่ม
- **แก้:** skip เมื่อ `closest('button, a, [role="button"]')` และเมื่อ dialog เปิด
- **เกณฑ์ตรวจรับ:** Space ที่ปุ่ม/ลิงก์ที่โฟกัสยัง activate องค์ประกอบนั้น ไม่ toggle ภาพ

### 1.5 [U3] 🔴 Space ใน MaskEditor = pan เท่านั้น 🔍 พิสูจน์ก่อน
- **ที่:** `components/cleaning/MaskEditor.tsx:454-458` (canvas keydown), :404-406 (dialog handler), tip ~:882
- **พิสูจน์:** คลิก canvas ให้โฟกัส กด Space ค้าง → เห็น brush stamp ซ้ำจาก auto-repeat และ pan ไม่ทำงาน
- **แก้:** ย้ายการตั้ง pan flag ขึ้น dialog-level handler จุดเดียว; canvas ไม่ stamp จากคีย์ (ป้าย mask ด้วยเมาส์เท่านั้น); ลบ `stopPropagation` ที่กั้น dialog; tip ตรงความจริง
- **เกณฑ์ตรวจรับ:** Space+ลาก pan ได้เมื่อ canvas โฟกัส และไม่เพิ่ม pixel ใน mask; การ paint ที่ตั้งใจยังทำได้

---

## ชุดที่ 2 — P1-ก: ขอบเขตความปลอดภัย (ทำ A3 ก่อน ER1 ตามรายงาน)

### 2.1 [A3] 🔴 ปิดช่อง DNS rebinding ของ pair route 🔍 พิสูจน์ก่อน
- **ที่:** `src/app/api/extension/pair/route.ts:41`
- **พิสูจน์:** request ผ่าน browser/HTTP จริงโดย `Host` และ `Origin` เป็นโดเมนโจมตีเดียวกันหลัง DNS ชี้เข้า loopback → อ่าน token ได้
- **แก้ (ตามทางแก้ที่ผู้ใช้ปรับในรายงาน):** เลิกยอมรับ same-host **ทั้ง** `originUrl.host === host` และ `originUrl.hostname === hostName`; `/pair` ยอมรับเฉพาะ origin ของหน้าแอปบน loopback scheme/host/port ที่กำหนดจาก listener จริง — extension ไม่จำเป็นต้องเรียก `/pair` (ใช้การคัดลอก token จากหน้า Settings ตาม flow ปัจจุบัน)
- **เกณฑ์ตรวจรับ:** rebinding แบบเดียวกับตอนพิสูจน์อ่าน token ไม่ได้; หน้าแอปบน loopback ยังแสดง token ได้; extension ที่จับคู่ด้วยมือยังใช้ token ได้

### 2.2 [A4] 🔴 ปิด path traversal ใน clean proxy ✅ ยืนยันแล้ว
- **ที่:** `src/app/api/clean/[...path]/route.ts:46-51`
- **แก้:** reject segment `.`/`..` → 400 + require `path[0] === "v1"` + **ตรวจ pathname หลัง `new URL(...)` ว่ายังอยู่ใต้ `/v1/` ก่อน fetch** (ตามทางแก้ที่ผู้ใช้ปรับ)
- **เกณฑ์ตรวจรับ:** ทดสอบผ่าน **HTTP route จริง** (encoded dot-segments, path นอก `/v1/`) — direct invocation ที่สร้าง `context.params` เองไม่พิสูจน์พฤติกรรม router; path ปกติยังส่งต่อได้

### 2.3 [ER1] 🔴 Pairing token ให้ publish-back / workspace-append + ผู้เรียกครบ 4 ทาง 🔍 พิสูจน์ก่อน
- **ที่:** `src/app/api/extension/publish-back/route.ts`, `workspace/append/route.ts` (enforce แบบ settings route:121) + ผู้เรียกทั้ง 4: extension POST `/workspace/append`, extension GET `/publish-back` (raw fetch ~`background.js:373`), หน้าแอป GET `/workspace/append?id=...`, หน้าแอป POST `/publish-back`
- **แก้ (ตามทางแก้ที่ผู้ใช้ปรับ):** enforce `verifyPairingToken` ที่ GET/POST ทั้งสอง route; extension ใช้ token ที่เก็บจากการจับคู่ (มีอยู่แล้ว — pattern `server.js:94-96`); หน้าแอปรับ token ผ่าน `/pair` **หลังปิด A3** แล้วส่งใน header (รวม CORS preflight หากจำเป็น); **pruning แยกเป็นสองงาน:** handoff ใช้ TTL/cap ตามอายุการใช้งาน ส่วน `publishedMap` ต้องมีสัญญา resync ก่อน (งานรากเดียวกับ A12 — อย่าใส่ TTL ถ้าไม่มีทาง resync เมื่อ extension ออฟไลน์นาน)
- **เกณฑ์ตรวจรับ:** token ถูก/ผิด/ไม่มีตรวจครบทั้ง 4 ทาง; flow เปิด editor + ส่งผลกลับจริงยังทำงาน; offline เกินช่วงเก็บยัง resync ได้หรือคง snapshot

---

## ชุดที่ 3 — P1-ข (ส่วนที่เหลือ): ผลลัพธ์ผู้ใช้และ State

### 3.1 [B2] 🔴 Overlay paint race ข้ามหน้า 🔍 พิสูจน์ก่อน *(ย้ายเข้าคิวหลักตาม P1-ข)*
- **ที่:** `lib/translationOverlay.ts:1761-1766` + `hooks/useTranslation.ts:496-523, 866-879`
- **พิสูจน์:** เร่งสลับหน้าระหว่าง pending paint → เห็น bubble หน้าเก่าวาดทับหน้าใหม่
- **แก้:** generation token (per container/hook) ส่งเข้า `applyTranslationOverlay` — `paint()` ยอมแพ้ถ้า generation ใหม่วาดไปแล้ว
- **เกณฑ์ตรวจรับ:** สลับหน้า/เริ่ม paint ซ้อนแล้วผลของหน้าเก่าไม่ทับหน้าใหม่

### 3.2 [B3] 🔴 Fast-path restore ต้องมี dimension 🔍 พิสูจน์ก่อน
- **ที่:** `hooks/useCleaning.ts:694-695` (เทียบ guard ที่ :276-280)
- **พิสูจน์:** สร้าง metadata ที่ไม่มี width/height → restore → แปล → เห็น "ไม่พบประโยคที่ต้องแปล" จาก NaN scope
- **แก้:** ข้าม fast path เมื่อ `metadata.width`/`height` ไม่ใช่ positive integer (ตกไป hydration path ที่มี `assertMatchingImageDimensions`)
- **เกณฑ์ตรวจรับ:** ไม่แสดงหน้าผิดเป็น clean-only และแจ้งหรือกู้ตาม fallback ที่กำหนด

---

## ชุดที่ 4 — P1-ค: ทรัพยากรและ Memory

### 4.1 [U4] 🔴 Undo ของ MaskEditor เก็บ stroke ops แทน pixel snapshot 🔍 พิสูจน์ก่อน
- **ที่:** `components/cleaning/MaskEditor.tsx:248-267, 309-325, 328-376` + `lib/undoManager.ts`
- **พิสูจน์:** วัด memory ขณะวาด ~50 strokes → เห็นการกิน RAM ระดับ GB
- **แก้:** base snapshot เดียวตอนเปิด editor + รายการ stroke op (points, mode, radius, regionId); undo/redo โดย **replay ops จาก base** (erase ไม่ invertible จึงไม่ใช้ inverse); commit snapshot ใหม่เมื่อออกจาก editor
- **เกณฑ์ตรวจรับ:** stroke/undo จำนวนมากอยู่ใน RAM bound ที่กำหนด; undo/redo คืน mask ตรงตามเดิม

### 4.2 [B10] 🟡 Canvas churn ใน text fitting 🔍 พิสูจน์ก่อน *(ย้ายเข้าคิวหลักตาม P1-ค)*
- **ที่:** `lib/translationOverlay.ts:383-399` + `:307`
- **พิสูจน์:** profile การสร้าง canvas ต่อ bubble render → เห็น allocation หลักสิบชิ้นต่อ bubble
- **แก้:** hoist measuring canvas/context ระดับ module มา reuse
- **เกณฑ์ตรวจรับ:** จำนวน canvas allocation ต่อ render ลดฮวบโดยผล layout/fitting ไม่เปลี่ยน (golden compare)

### 4.3 [C12] 🟡 GradientCleaner ทำ full-page inpaint 6 รอบต่อ region 🔍 พิสูจน์ก่อน *(ย้ายเข้าคิวหลักตาม P1-ค; แตะ ocr-service → ต้องรัน pytest)*
- **ที่:** `ocr-service/app/cleaners/flat.py:60-74` (fallback เมื่อ Big-LaMa ใช้ไม่ได้: `api.py:346-351`)
- **พิสูจน์:** จับเวลา/นับ `cv2.inpaint` บนหน้า 30 regions → เห็น 180 full-page passes
- **แก้:** crop ตาม region bounds + context ก่อน inpaint (แบบ `AotCleaner`/`LamaLargeCleaner` ผ่าน `_context_bounds`)
- **เกณฑ์ตรวจรับ:** เวลา/จำนวน full-page pass ลดตามจำนวน region; ผลลัพธ์ภาพไม่ถดถอย (golden compare)

### 4.4 [E1] 🔴 เลิก self-destruct 2 นาทีของ reading overlay ✅ ยืนยันแล้ว
- **ที่:** `chrome-extension/content.js:553-556`
- **แก้:** ลบ `setTimeout(cleanup, 120000)`; cleanup เมื่อ URL เปลี่ยน (SPA watcher) / ปิด tab / ผู้ใช้กดปิด; restore คงใช้ `restoreSavedTranslations`
- **เกณฑ์ตรวจรับ:** overlay ยังอยู่เมื่ออ่านเกิน 2 นาที; ล้างเมื่อถึง lifecycle ที่ตั้งใจจริง

### 4.5 [E2] 🔴 ย่อ MutationObserver ลงที่รูป 🔍 พิสูจน์ก่อน
- **ที่:** `chrome-extension/content.js:530-531`
- **พิสูจน์:** วัดจำนวน `updatePosition` เรียก/forced layout บน host page ที่ mutate หนัก ก่อน-หลัง
- **แก้:** เลิก observe `document.body` ทั้ง subtree+attributes; ใช้ `ResizeObserver` บน `img` + observer เฉพาะ attribute `src` ของ img
- **เกณฑ์ตรวจรับ:** mutation จำนวนมากไม่ทำ observer วนทั้ง document/บังคับ layout ซ้ำจนหน่วง — มีกรณีวัดก่อน-หลัง

### 4.6 [E3] 🔴 Loading scrim ต้องมี disposer 🔍 พิสูจน์ก่อน
- **ที่:** `chrome-extension/content.js:101-114` + remove points (:51, :129-131, :139-140)
- **พิสูจน์:** แปลหลายรอบ นับ resize listener ค้างบน window → เห็นจำนวนเพิ่ม
- **แก้:** `createLoadingScrim` คืน disposer; ทุก remove path เรียก disposer
- **เกณฑ์ตรวจรับ:** เปิด/ปิด scrim ซ้ำแล้วจำนวน resize listener ไม่เพิ่มค้าง

---

## ⏸️ Paused Desktop Backlog — D1–D15 (ไม่ทำในคิว Web App)

ตามสถานะในรายงาน: ผู้ใช้รันผ่าน `SuperK-Launcher.vbs` เข้าเว็บแท้บน Brave/Chrome แทน Electron shell — design ที่คิดไว้แล้วเก็บไว้ที่นี่เพื่อรอวันกลับมา:
- **D1 (CIM datetime):** ให้ PowerShell emit ISO 8601 เอง เช่น `@{n='creationDate';e={$_.CreationDate.ToString('o')}}` — JS ไม่ต้องรู้จัก DMTF, test fixtures (ISO) เดิมยังใช้ได้
- **D2 (export destination):** main process เป็นเจ้าของปลายทางจาก native picker และจำข้ามการเปิดแอป (ยืนยันซ้ำตอนเปิด, ถามใหม่เมื่อโฟลเดอร์หาย); renderer ส่งเพียงตัวอ้างอิงที่ main ออกให้ ไม่ใช่ `dirPath` จาก localStorage; ตรวจ resolved target ในโฟลเดอร์ที่ยืนยันแล้ว + reject path separator ใน filename — รักษาพฤติกรรมเลือกครั้งเดียวของ **ADR 0009** และปรับ ADR เมื่อสรุปสัญญา IPC + การย้ายค่าที่จำไว้
- **D3 (shutdown):** desktop mode ขอ main quit ผ่าน IPC (`handleShutdown()`); `stop.bat` target recorded PIDs ไม่ใช่ port owners
- เกณฑ์ตรวจรับของทั้ง 15 ข้อค้างไว้ในตารางเกณฑ์ตรวจรับของรายงาน

## 🧪 Experimental Backlog — A1, A2, A9, A10

ระงับตามกฎเหล็ก: live translation ล็อคที่ Fixed Route (`requestGemini`); Dynamic Catalog (`geminiCatalog.ts`, `geminiTranslationRouter.ts`, `executeGeminiTranslation`) ยังไม่เป็น production path เกณฑ์ตรวจรับค้างไว้ในรายงาน — ทำเมื่อ catalog กลับมา active เท่านั้น

---

## คิว P2/P3 หลัง P1 หลัก (53 ข้อ — เก็บ ID และระดับเดิมไว้)

- **กลุ่มรากปัญหาร่วมที่รายงานระบุ:** A12 + ER1 (state ชุดเดียว — ทำต่อจาก ER1); A11 + A3 + ER3 (ทบทวน origin policy รวมกัน)
- **ตกลงเจตนาไว้แล้วจาก grill session (พร้อมทำเมื่อถึงคิว):**
  - **B7** thaiSpellcheck — คงเจตนา `คระ→ค่ะ`/`คร่า→ค่า` แต่ require ขอบเขตคำ + regression test (`อักขระ`, `คระหนัก`, `คร่าว` ต้องรอด)
  - **E11** ย้าย secrets ไป `chrome.storage.local` + migration อ่านค่าเดิมจาก sync หนึ่งครั้ง
- **P2 ที่เหลือ (39):** A5–A8, A13, A14, B4–B6, B8, B9, B11, C2–C6, C7–C9, C10, C11, C13, C14, E4–E10, ER2, ER3, U5–U8 — เรียงตาม "ผู้ใช้พบจริง"
- **P3 (12):** B12–B19, C15–C18
- **De-scoped ตามแผนเดิม:** U9 studio stack (เก็บเป็นโค้ดสำรอง — `docs/system-review-plan.md` หมวดที่ตัดออก)
