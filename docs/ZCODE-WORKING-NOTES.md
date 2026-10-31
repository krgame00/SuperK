# ZCode Working Notes — SuperK / Manga Translator

บันทึกประวัติการทำงานของ ZCode ทุก session เรียงจาก **ใหม่ไปเก่า** (ไฟล์นี้แยกจาก `docs/AI-WORKING-NOTES.md` ซึ่งห้ามแตะตามกฎเดิม — ไฟล์นี้คือฉบับของ ZCode)

กติกา: จบ session ไหนให้เพิ่ม entry ใหม่ **ด้านบนสุด** ของรายการ โดยระบุสิ่งที่ทำ หลักฐาน/ผลตรวจ สถานะ commit และลิงก์เอกสารละเอียดถ้ามี

---

## ย้าย repo Downloads → F:\Projects + ตัดตอนที่มา desktop.ini + เคลียร์ startup — 2026-10-31

- **ที่มา:** สืบอาการ "เปิดโปรแกรมช้าตอนเปิดเครื่องใหม่" → ตัวการคือ (1) ~18 startup apps (game launchers/emulator/3 cloud syncs) (2) **Google Drive File Stream mirror โฟลเดอร์ Downloads** ที่ repo เคยอยู่ — พิสูจน์จาก mirror_sqlite.db + screenshot Preferences (backup 7 โฟลเดอร์ รวม Downloads/J:\) — เขียน desktop.ini ทิ้งทั้ง repo (รอบนี้ 11,399 ไฟล์ + รอบก่อน 1,656 ไฟล์ใน .next/.git) และเคยทำ `npm run dev` พัง (เคส Turbopack RocksDB)
- **ย้าย repo ไป `F:\Projects\manga-translator`:** robocopy /MOVE 6,184 ไฟล์ / 994 MB **FAILED=0** (24 วินาที) — git history + งาน uncommitted ทั้งสองชุด (extractGlyphInk + outsideProtectedAreas) เดินทางครบ (ยืนยันด้วย git status) — ลบ desktop.ini คาสโก้ก่อนย้าย — ลบต้นทางใน Downloads จนว่าง (เหลือโฟลเดอร์เปล่าที่ session ถือ handle อยู่ รอลบหลัง session/reboot)
- **Rebuild ปลายทาง:** `npm ci` 716 packages OK — **ocr-service venv ใหม่บน Python 3.12 (uv)** เพราะ requirements.lock + requirements-lama.lock ถูก pip-compile ด้วย 3.12 และ numpy==2.5.1 ต้องการ ≥3.12 (venv เก่า 3.11 ล้าหลัง lock อยู่แล้ว = drift เดิมของโปรเจกต์); ต้องติดตั้ง **ทั้งสอง lock** (lama lock เป็น superset มี torch 2.13.0 — anime_lama/hybrid_inpainter lazy-import torch; และ `uv sync` อย่างเดียวไม่พอเพราะ pyproject ไม่ประกาศ deps)
- **Smoke test ผ่านทั้งคู่:** frontend :3000 → HTTP 200 ใน ~6 วิ, OCR :8765 `/health` → `{"status":"ok"}` ใน ~12 วิ (เริ่ม uvicorn ด้วย env `SUPERK_CACHE_DIR=F:\manga-cache\...` ตาม run.ps1 เพื่อกัน orphan cache) — **และผ่าน full suite ที่ปลายทาง: pytest 253 passed + 3 skipped (21 วิ), vitest 2,019 passed + 2 skipped / 245 ไฟล์ (134 วิ) — 0 fail ทุกชั้น รวม timing-flake ตัวเดิม**
- **GoogleDriveFS ปิดถาวร** (kill แล้ว + autostart ปิด = ไม่กลับมาเอง); backup ที่เหลือบน Drive (VDOHEN 130 GB / J:\ / SuperK E:\) รอผู้ใช้ตัดสินใจต่อ
- **ค้าง:** reboot (autostart cleanup มีผล), โฟลเดอร์เปล่าเก่าใน Downloads รอลบ, prod standalone build หายไปกับ .next เดิม → ต้อง `npm run build` ก่อนใช้ prod mode (launcher `npm run dev` ใช้ได้ทันที), C: เหลือ 25 GB, Fast Startup reduced ยังไม่ได้ทำ
- **Commit status:** ไม่มีการแก้โค้ดใน repo — ทุกอย่างเป็น system-level; งาน uncommitted เดิมยังอยู่ครบรอผู้ใช้ทดสอบและอนุมัติ commit ตามแผนเดิม

### ต่อ (วันเดียวกัน): อัปเกรดตัวตรวจ mask ทั้งสองฝั่ง — เคสตัวหนังสือสีบนพื้นเข้ม (UNCOMMITTED)

- **อาการ:** ฟอง "DO I LOOK LIKE..." (ตัวม่วงบนพื้นเขียวเข้ม) — AI Mask ใน MaskEditor จับได้ 638 px (0.81%); ระบบหลักฝั่ง server ก็จับน้อยตั้งแต่แรกเหมือนกัน
- **สาเหตุ client** (`lib/cleaning/maskUtils.ts`): `extractGlyphInk` ใช้ threshold ตายตัว 155/200 — ม่วง (luma ~123) กับพื้นเข้ม (~50) ต่างถูกนับเป็น "ดำ" ทั้งคู่ → ก้อนเดียว → โดนตัวกรอง "ก้อนยักษ์ ≥35%" ทิ้ง เหลือแต่จุดไฮไลต์
- **แก้ client:** Otsu threshold ต่อ crop + border rule (คลาสที่ครอบขอบ crop = พื้น) + chroma fallback (ต่างสีแต่ luma ใกล้กัน) — TDD: เทสแดง 3 ตัวก่อน (ม่วงบนเข้ม / สีต่าง-luma / dense 67%) แล้วแก้, พบและแก้บั๊ก **Otsu plateau** (variance คงที่ตลอดช่วงระหว่างคลาส → threshold ตกบนค่าคลาสเอง + `<` เข้ม → คลาสว่าง; แก้เป็น `<=`) — vitest maskUtils 13/13, tsc 0, eslint 0, **full vitest 2,023+1skip**
- **สาเหตุ server** (`ocr-service/app/mask_refiner.py`): seed จาก probability map ตัดที่ 0.35 ตายตัว — ข้อความสไตล์ soft-contrast มักพีค 0.15–0.30 → seed โหรงเหรง → LaMa ลบน้อย
- **แก้ server (user เลือก Otsu + full-rect fallback):** (1) `_adaptive_seed_threshold` — Otsu บน probability ใน envelope, ใช้เมื่อมวลข้อความพีคต่ำกว่า 0.35 เท่านั้น (floor 0.15, separation ≥0.08, strong-contrast ได้ mask เดิมเป๊ะ — assert array equal) (2) `_rescue_low_coverage_regions` — evidence region ที่ text_supported แต่ mask ครอบคลุม <1% → fill ทั้ง rect โดย clip ด้วย envelope + protected edges — TDD เทสแดง 2 ตัวก่อน → pytest **256+3skip** (ไม่มี regression ทั้ง suite), ruff clean
- **สถานะ:** OCR backend รีสตาร์ทด้วยโค้ดใหม่ (/health 200) — งาน uncommitted ตอนนี้ 3 ชุด: extractGlyphInk + outsideProtectedAreas + mask-smartness (รอผู้ใช้ทดสอบ → commit ตามอนุมัติ)

---

## ⚠️ ข้อจำกัดถาวร: AI อ่านภาพ 18+ ของโปรเจกต์นี้ไม่ได้

ใช่ — ตัวที่ล้มคือ **content filter ฝั่ง provider (GLM) ไม่ใช่บั๊กของโปรเจกต์** เปิดภาพเต็มหน้าจาก job dir (เช่น `F:/manga-cache/ocr-jobs/jobs/*/source.png` เป็นเนื้อหา 18+) ด้วย Read tool แล้ว provider คืน `empty_model_response` (เกิดแล้ว 2 ครั้ง วันที่ 2026-10-29) — retry ไม่ช่วย

วิธีทำงานแทนที่ ZCode ใช้ (บันทึกใน project memory แล้ว ทุก session ต้องใช้วิธีนี้):

1. **วิเคราะห์ mask/ภาพด้วยตัวเลข** — numpy: mask coverage, จุดที่หลุดนอก region, connected-component shape metrics (area, bbox, fill ratio)
2. **ASCII rendering** — threshold crop เป็นกริด `#`/`.` แล้วพิมพ์ทาง terminal (~96 คอลัมน์ สูงครึ่งหนึ่งของสัดส่วนจริง) แถวตัวอักษรและเส้นโค้งอ่านออกเป็นข้อความได้จริง
3. **ตาผู้ใช้เป็น final visual check** เสมอ — AI ไม่กลองดูภาพเต็มหน้าเองเด็ดขาด

เห็นรายละเอียดการใช้จริงได้ที่ [docs/2026-10-30-ink-mask-glyph-filter-fix.md](2026-10-30-ink-mask-glyph-filter-fix.md) หมวด "บทเรียนเสริม"

---

## Fix คำแปลหลุด (แปลได้ไม่ครบ): เชื่อผลตรวจ LLM นอกเขต detector + recovery ใช้ retry prompt — 2026-10-31

### Status: แก้เสร็จ ผ่าน full suite (vitest 2,009) + tsc + eslint 0 errors — **รอผู้ใช้ทดสอบหน้าจริง**

อาการ (รายงานพร้อม screenshot): หน้าแปลแล้วเหลือข้อความอังกฤษไม่ถูกแปล กด "แปลใหม่" หลายรอบก็ผลเหมือนเดิม และขึ้น "⚠️ ยังขาดคำแปล N จุด"

**Root cause (ตรวจจากโค้ด):** pipeline เป็น deterministic ทั้งสาย —

1. เขต "ข้อความอยู่ตรงไหน" ผูกกับ region ที่ detector ฝั่ง clean เจอเท่านั้น (`translationScope()` ใน `lib/cleaning/textAuthorization.ts`)
2. filter หลัง LLM แปล (`hooks/useTranslation.ts` ทั้ง path ปกติและ NSFW-slice) ทิ้ง bubble ที่โมเดลเจอเองถ้าไม่ทับ region ที่ detector เจอ ≥30% แบบเงียบ ๆ
3. recovery pass (`recoverDetectedOmissions`) ก็ทำงานเฉพาะ region ที่ detector เจอด้วย (`findMissingTranslationRegions` วนตาม `scope.allowed`) และส่ง /api/translate แบบปกติ (ไม่มี retry prompt) → region ที่ detector มองข้ามหรือ crop ที่โมเดลอ่านไม่ออก = ไม่มีทางถูกเติม กดแปลซ้ำกี่ครั้งก็เหมือนเดิม

**Fix (แนวทาง "เชื่อผลตรวจของ LLM" ตามที่ผู้ใช้เลือก):**

- เพิ่ม `outsideProtectedAreas()` ใน `textAuthorization.ts` — เชื่อ bubble ที่โมเดลเจอเองแม้นอก `scope.allowed` แต่ **ยังบล็อกโซน `excluded` (preserve/SFX-ignore) ตามเดิม** และต้องเป็น valid box
- filter ทั้ง 2 จุดใน `useTranslation.ts` (path ปกติ + NSFW-slice) กลายเป็น `isSfxBubble || withinTranslationScope || outsideProtectedAreas`
- recovery crop call ส่ง `isRetry: true` → ได้ prompt บังคับมองหาข้อความยาก ๆ (faint/stylized/small) + server หมุน model pool ให้
- เพิ่ม unit test `outsideProtectedAreas` ใน `tests/translation/textAuthorization.test.ts` (รวม 3 tests ในไฟล์)

**ผลตรวจ:** vitest เต็ม **2,009 passed / 0 failed** (98s) · `tsc --noEmit` สะอาด · eslint ไฟล์ที่แก้ 0 errors (warnings เดิม)

**ข้อจำกัดที่ต้องบอกผู้ใช้:** ถ้าข้อความที่หลุดโดน detector จัดเป็น SFX แล้วตั้ง policy "ละเว้น SFX" อยู่ ยังถูกยกเว้นตาม policy อยู่ (by design) — เปลี่ยน SFX policy เป็น "แปล" แล้วแปลใหม่ / แก้ยังไม่ commit รวมกับ ink-mask fix รอผู้ใช้ยืนยันพร้อมกัน

---

## Live browser UI test: fix ink-mask รันจริงในเบราว์เซอร์ (DOM-driven, ไม่ใช้ screenshot) — 2026-10-30

### Status: PASS ทุก flow — fix ใช้งานได้จริงใน UI, console สะอาด

จุดประสงค์: `extractGlyphInk` เป็นโค้ดฝั่ง browser — curl/pytest เทสไม่ถึง (vitest ใช้ canvas mock) จึงเทสผ่าน in-app browser โดยอ่านผลจาก **DOM snapshot/ARIA text ล้วน** (ไม่มีภาพ manga เข้าตา AI — ตามข้อจำกัดถาวรด้านบน) เพราะ IAB อัปโหลดไฟล์ไม่ได้ จึง **สร้างหน้า manga สังเคราะห์ (SFW) ด้วย canvas ในหน้าเว็บ** แล้ว inject ผ่าน file input + DataTransfer: มี bubble ไทยปกติ, แผงดำตัวอักษรขาว (knockout), กล่อง narration, SFX ตัวหนาบนเส้น hatch ทแยง และ line art ตัวละครอย่างง่าย

**ผลตามลำดับ flow จริง (job chain บน F: drive ยืนยันทุก step):**

1. อัปโหลดผ่าน UI → thumbnail ขึ้น, ปุ่ม "คลีนข้อความ" พร้อม
2. กด **"คลีนข้อความ"** → job `f80e1432` (5 regions: 3 clean repaired + 2 needs_review), tab Clean เปิดใช้, **remnant panel ขึ้น "พบจุดสงสัย 3 จุด"** พร้อมปุ่ม 1-click ครบ
3. กด **"คลีนจุดนี้"** บนการ์ด SFX-บน-hatch (x255 y1062, หมึก 6,530px) → chain จริง: confirm-text (`f96272de`: text_confirmed True) → force-clean (`f531142e`: region-5 **repaired**) — client ส่ง glyph mask ถูกต้อง (mask.png ใน rect = 14,818px = dark 6,241px + dilate 2px ตรงตามคำนวณ), ตัวอักษรถูกลบจริง (dark px band ข้อความ 4,508 → 1,960, LaMa reconstruct เส้น hatch กลับมา)
4. กด **"กู้คืนภาพเดิม"** บนการ์ดอื่น (x257 y277) → toast "กู้คืนภาพเดิมเรียบร้อย" + job `af15fdac`: region-2 **status=preserved** ✅
5. **console.error/warn/unhandledrejection = 0 ตัว** ตลอดทุก flow (จับด้วย monkey-patch ก่อนคลิก)
6. **navigator.serviceWorker.getRegistrations() = 0** — PWA self-destruct ทำงานจริงในเบราว์เซอร์

**ข้อสังเกต (ไม่ใช่บั๊ก):** remnant card ไม่ขยับทันทีหลังคลีนสำเร็จ — panel ผูกกับ candidate evidence ของ result เดิม จนกว่าจะ recheck/result revision ใหม่ (UX อาจวดี upgrade ภายหลัง) / ปุ่ม "คลีนจุดนี้" กดซ้ำเมื่อ region ยัง repair ได้เงียบ ๆ (no-op)

**Housekeeping:** ลบหน้าสังเคราะห์ออกจากเวิร์กสเปซแล้ว (กลับสู่สถานะ Drag & Drop ว่าง) — job ทดสอบ UI (5 ตัว) อยู่ใน F: cache ตาม retention sweep ปกติ

---

## Feature: แผง "พื้นที่จัดเก็บ (Storage)" read-only ใน System Logs (poteto-mode Feature playbook) — 2026-10-31

### Status: SHIPPED — 3 commits (8a3337c → ecd3ef2), ผ่านทุก surface

ผู้ใช้ขอ "ให้เห็นทุกอย่าง แบบเก็บแคชไว้ไหน ที่ไหน อย่างไร" — เลือกขอบเขต read-only (ไม่มีปุ่มล้าง)

**ขอบเขต per playbook:** how/architect/interrogate/PR = skip (design ตัดสินแล้วใน plan mode + ไม่ contested + ไม่ขอ push); checkpoint: OCR endpoint เป็น blocking gate → Next route → modal; owner เดียวเพราะ contract เดียวไหล 3 ชั้น

**สิ่งที่สร้าง:**

- `GET /v1/system/storage` (ocr-service/app/api.py): walk job cache (ต่อ job: bytes+mtime), model dirs จาก PADDLE_HOME/TORCH_HOME/HF_HOME + fallback, temp, ตรวจ desktop.ini top-level — + `_dir_stats` helper
- `src/app/api/system/storage/route.ts` (ใหม่): requireLocalRequest guard (origin แปลก = 403 ยืนยันแล้ว), fetch OCR timeout 3s, walk .next/cache+turbopack+dev/standalone+saved_projects, `findDesktopIniFiles` depth-capped, คืน StorageReport
- SystemLogsModal: segment ใหม่ "พื้นที่จัดเก็บ" (HardDrive), การ์ดแบ่งกลุ่ม (OCR cache / โมเดล / build cache / logs / saved_projects / เบราว์เซอร์: storage.estimate + localStorage per-key + RAM blob + ResourceBudget), formatBytes, **amber banner เตือน desktop.ini**

**พิสูจน์แล้วบนของจริง:** pytest 26 passed (test ใหม่รวม), tsc สะอาด, curl ทั้งสอง endpoint ตัวเลขตรงกัน (F: cache 6 jobs / 5.4MB / models present), IAB UI แสดงครบทุกการ์ด — **และ amber warning จับ desktop.ini ได้จากของจริง (Drive FS หยอดซ้ำใน turbopack cache หลังลบเมื่อวาน — ลบให้อีกครั้ง)**, vitest tests/cleaning/ 392 passed

**ปัญหาระหว่างทาง:** poteto-agent โดน provider concurrency limit กลางงาน — เขียนไปได้ ~90% ก่อนหยุด; owner รับช่วงต่อตาม playbook fallback แล้ว fix bug เดียว (`time.time()` บน import ที่เป็น function อยู่แล้ว)

**หมายเหตุ working tree:** พบ modification ที่ไม่ใช่ของ ZCode ค้างอยู่ (hooks/useTranslation.ts, lib/cleaning/textAuthorization.ts, tests/translation/textAuthorization.test.ts — ฟีเจอร์ vision-bubbles/textAuthorization) — ไม่แตะ ไม่รวม commit, ให้เจ้าของงานตัดสินใจเอง; fix ink-mask (maskUtils) ยังค้าง uncommitted เช่นเดิม

---

## Live browser รอบสอง: MaskEditor + Export + Recovery gate + เฉลย outage — 2026-10-30

### Status: MaskEditor/Recovery PASS · Export UI ผ่านเกือบสุด (ขั้นเขียนไฟล์ต้องยืนยันใน Chrome จริง) · เจอ root cause ทำลายบ้าน

**1. เฉลยเหตุ service ดับทั้งคู่ระหว่างวัน:** `npm run dev` พังตอน start ด้วย `Failed to open database ... invalid digit found in string` — **`desktop.ini` ของ Google Drive File Stream หลุดอยู่ใน RocksDB dir ของ Turbopack** (`.next/dev/cache/turbopack/v16.3.6-a758ffcf/`, สร้าง 18:49 วันนี้โดย Explorer/DriveFS, parser ของ Turbopack ตายเพราะชื่อไฟล์ไม่ใช่ตัวเลข) — server ตัวเก่าเปิด DB ก่อนไฟล์เกิดจึงรันได้มาตลอด พอมันตายกลางวัน start ใหม่ไม่ได้เลย วิธีแก้: ลบ desktop.ini ตัวเดียว (ปลอดภัย — metadata ตกแต่งโฟลเดอร์, git-ignore แล้วจาก commit `57072f4`) → start ใหม่ผ่านทันที. **ถ้าเกิดซ้ำ: ลบ desktop.ini ใน `.next/dev/cache/turbopack/<ver>/` แล้ว restart** (Drive FS จะสร้างใหม่ได้เรื่อย ๆ)

**2. MaskEditor UI (DOM-driven, หน้าสังเคราะห์):** เปิด editor → จุด 1-3 + brush/dilation/algorithm picker ครบ → **"⚡ คลีนทันที" = "คลีนจุด #1 เรียบร้อย (2783ms)"** → **"กู้ภาพเดิมทั้งจุด" = สำเร็จ** → console error/warn = **0 ตลอด**

**3. Recovery gate:** reload หน้า → "💾 พบงานแปลค้างไว้ล่าสุด (1 หน้า)" → **"📂 คืนค่างานเดิม" ฟื้น page + layer tab state ถูกต้อง** (หมายเหตุ: locator ที่มี emoji prefix ต้องใช้ regex name)

**4. Export UI:** "ส่งออก" = dropdown menu (รูปภาพหน้านี้ / PDF / Strip / ZIP / CBZ / Layered PSD) → "รูปภาพหน้านี้" → readability scan → **modal "ยืนยันก่อนส่งออก" เปิดจริง** พร้อม 7 ตัวเลือก (อนุมัติหน้านี้ / ส่งออกเป็นต้นฉบับ / ไปที่หน้านี้ / ยกเลิก / ส่งออกแม้มีจุดค้าง / อนุมัติจุดค้างทุกหน้า / ยืนยันทุกหน้าและ Export) — gate บล็อก export ก่อนยืนยัน **ทำงานถูกต้อง**. **ยังเปิดรอย้าว:** ขั้นเขียนไฟล์จริงดักไม่เห็นใน IAB (ไม่มี download event / createObjectURL ถูกเรียก) — เป็นข้อจำกัดของ IAB (File System Access/download manager) มากกว่าบั๊กแอป ต้องยืนยันด้วยการกด export จริง 30 วินาทีใน Chrome ของผู้ใช้

**ข้อสังเกตกระบวนการ:** ปุ่ม "ส่งออก" เป็น dropdown — การคลิก evaluate ตรง ๆ แค่ toggle เมนู (ทำให้รอบก่อนหน้าวุ่นวาย); ต่อไปต้องกดผ่าน menuitem เสมอ

---

## Lifecycle e2e: edge cases + concurrency + retry chain + restore + memory — 2026-10-30

### Status: 27/27 PASS (test artifacts cleaned up)

ต่อจาก batch test — ทดสอบ lifecycle การใช้งานจริงที่ยังไม่เคยคลุม (`e2e_lifecycle.py`):

- **Upload edge cases**: grayscale PNG → succeeded; ภาพ 81MP เกินลิมิต 64MP → 413 ถูกปฏิเสธ
- **Concurrency**: ยิง 5 jobs พร้อมกัน → ทุก job succeeded, job id ไม่ซ้ำ, ไม่มี cross-contamination
- **Retry chain เดินทางครบแบบ mask editor จริง**: confirm-text → force-clean รอบ 1 → force-clean รอบ 2 (mask แก้ใหม่) → force-clean ด้วย alias `flat` → protect (กู้ภาพ) → **re-clean หลัง protect (restored-region reclean)** — ทุกขั้น succeeded
- **clean/crop combos**: dilation=4+extend_hints / feather_blend / cleaner=anime-lama → 200 PNG ทุก combo
- **Restore flow (จำลองปิด-เปิดแอป)**: POST `/v1/jobs/restore` พร้อม 5 assets + regions JSON → 200, job queryable, regions ครบ 25/25
- **Memory lifecycle**: flush-memory → model unloaded → job ใหม่ reload model เอง → succeeded
- **Housekeeping**: ลบ test projects ของ ZCode ครบ (`zcode-lifecycle` 19 + `zcode-e2e` 5 + `zcode-batch` 120 = **144 test jobs**), job ที่ลบแล้ว 404 ถูกต้อง; **ไม่ยิง `/v1/jobs/purge` เพราะกวาด job จริงของผู้ใช้ด้วย**

---

## Real-workload batch test: 74 หน้าจริง + พิสูจน์ glyph filter บน region จริง — 2026-10-30

### Status: 100% SUCCESS (84/84 jobs) + fix ไม่มี regression บนข้อความปกติ

ผู้ใช้ขอ: "ไปทดสอบงานจริงต่อ" — ต่อยอดจาก smoke test รอบก่อนด้วยงานจริงเต็มปริมาณ

**Batch ทั้งเล่มบน pipeline จริง (`:8765`, หน้าจริง `scratch/all_75_pages/`, sequential):**

- **safe mode ครบ 74/74 หน้า succeeded** + **all-text mode 10/10 หน้า succeeded** = 84/84 ใน 225s
- Timing ต่อหน้า: median **2.83s**, p95 3.64s, max 4.85s
- รวม 1,266 regions ใน safe mode: **310 clean / 956 preserved**; 3 หน้า flag `awaiting_review` (พฤติกรรม UX ถูกต้อง — รอผู้ใช้ตัดสินใจ); หน้าที่ region เยอะสุด page_004 (25 regions)
- ไม่มี job failed/timeout/stuck stage เลย — เมตริกอยู่ใน `batch_results.json` (temp)

**พิสูจน์ fix ink-mask บนงานจริง (12 region จาก 12 หน้า, force-clean เทียบ mask เก่า vs กฎใหม่บน parent เดียวกัน):**

- **11/12 region: mask เก่า = ใหม่เป๊ะ (saved 0px)** → กฎ `extractGlyphInk` **ไม่ลดประสิทธิภาพการลบข้อความปกติเลย** (zero regression)
- **page_001 region-15**: mask 33,592 → 11,700px (-65%) — มวลเข้มขนาดใหญ่ (artwork/พื้นหลัง) ถูกกรองทิ้ง, erased จริงลด 8,616 → 7,844 = **ประหยัดเนื้อภาพ 772px ที่เดิมโดน inpaint**
- รวม: mask ลด 26% (84,330 → 62,438px), เนื้อภาพที่รอดเพิ่ม 772px ใน sample นี้

**ข้อสรุป:** fix ที่ยังไม่ commit ปลอดภัยต่องานจริงทั้งเล่ม และทำงานได้จริงกับ region ที่มีมวล artwork ปน — พร้อม commit เมื่อผู้ใช้ยืนยัน

---

## Full-system test sweep (ทุก suite + live services + e2e จริง) — 2026-10-30

### Status: ALL GREEN (0 failures ทุกชั้น)

ผู้ใช้ขอ: "ไปทดสอบระบบตอนนี้หน่อยครับ เอาทุกระบบ พวกระบบย่อยและอย่างอื่นด้วย"

**Automated checks (ผ่านหมด):**

- vitest เต็ม: **244 ไฟล์ passed + 1 skipped = 2,007 tests** (97.8s)
- pytest เต็ม (ocr-service): **252 passed, 3 skipped** (45.7s)
- `tsc --noEmit` สะอาด / `eslint .` เต็ม: **0 errors, 72 warnings** (baseline เดิม, exit 0)

**Live services (จริง):** web `:3000` → 200 + title ถูกต้อง; OCR `:8765` → `/health` ok; model lazy-load ทำงาน (first job → `loaded:true`); `/sw.js` = self-destructing SW by design (PWA disabled policy); `extension/settings` 401 = by design (pairing token guard)

**OCR backend e2e บนหน้าจริง (scratch/all_75_pages) — 23/23 PASS:**

- safe job page_001: 17 regions (4 clean), assets 4 ไฟล์ PNG ถูกต้องขนาด 1280x1808, clean.png decode ได้
- retry chain ครบ: confirm-text → force-clean ด้วย **glyph mask** (เลียนแบบ `extractGlyphInk` ฝั่ง client ใหม่ — ยืนยัน contract กับ fix ที่ยังไม่ commit ใช้ได้กับ server จริง) → ทุก derived job succeeded
- protect ด้วย solid rect → region กลายเป็น `preserved` จริงใน result
- `/v1/clean/crop` fast-path (MaskEditor) → 200 PNG / all-text mode page_003 → succeeded + mode บันทึกถูก
- error handling: non-image → 415, unknown job → 404, unknown cleaner → 422

**Frontend API smoke (ผ่าน :3000):** `/api/system/logs` → `ocrHealthy:true`; proxy `/api/clean/*` allowlist ทำงานถูก (`v1/models/status` 200, path นอก scope ถูกปฏิเสธ); `/api/translate` + `validate-key` + `mask-review` + `translate/models` ตอบ 400 ทุกกรณี body ไม่ถูก (validation path)

**ไม่ทดสอบ (มีเหตุผล):** `/api/system/shutdown` (destructive — งด), translation จริงต้องใช้ Gemini key ผู้ใช้ (ครอบคลุมโดย vitest unit tests), live browser UI pass (รอบ 2026-10-29 เพิ่งทำ; UI flows ครอบคลุมโดย vitest 2,000 tests)

**สถานะ working tree:** fix ink-mask glyph filter (`lib/cleaning/maskUtils.ts` + tests) ยังไม่ commit + เอกสาร `docs/2026-10-30-ink-mask-glyph-filter-fix.md` และไฟล์นี้ — รอผู้ใช้ทดสอบและอนุมัติ commit

---

## Fix: clean จับเส้นตัวละคร (ink mask glyph filter) — 2026-10-29 → 2026-10-30

### Status: FIXED, ยังไม่ commit (รอผู้ใช้ทดสอบในแอป)

ผู้ใช้แจ้ง: กดปุ่ม **Clean** บน remnant review card แล้ว mask ไปจับเส้นตัวละคร (ใช้ job ที่ค้าง `178f83ba81a14f8ea05d1ddf0c519a3f` เป็นตัวอย่างจริง)

**การวินิจฉัย:**

- ตรวจ mask.png ของ job จริง (26,532px): อยู่ใน clean rects 100% (0px หลุดนอก region) → pipeline หลัก `2.3.1-enclosed-backing` ไม่ใช่ตัวร้าย
- ตัวร้ายคือ `createInkMaskBlob` ใน `lib/cleaning/maskUtils.ts` (จาก commit `23e84d5`): (1) threshold luma<155 เท่านั้น แยกตัวอักษรกับเส้นตัวละครไม่ได้ — บน bubble เทา/ดำ ink = ทั้ง crop (region-2: 10,245/11,934px = 86%), (2) fallback ตอนโหลดรูปพลาด = fill ขาวทั้ง rect → ลบหมดเงียบ ๆ

**สิ่งที่แก้ (ที่ `lib/cleaning/maskUtils.ts` + `tests/cleaning/maskUtils.test.ts`):**

- เพิ่ม `extractGlyphInk()` — pure function: polarity detection (knockout = ขาวบนดำ เมื่อ dark ≥60% และ bright ≥12% ของ crop) + connected-component filtering ทิ้ง component ทรงภาพ: มวลใหญ่ ≥35% ของ crop / fill <6% / fill <15% พร้อม span ≥90% หรือยาว ≥4 เท่า / แท่งบางแนว ruler (span แกนหนึ่ง ≥90% หนา ≤25% อีกแกน) — ตัวอักษรแม้ merge เป็นแถวยาวรอดเพราะ fill สูง
- Fallback ทั้งสองจุด (ctx null / catch) เปลี่ยนเป็น mask ว่าง + console.warn — server มี guard `authorized mask is empty` อยู่แล้ว (pipeline.py retry_region) → ล้มเหลวแบบมีเสียง แทนลบภาพเงียบ ๆ

**ผลตรวจ:** tests/cleaning/ ผ่าน 24 ไฟล์ / 392 tests (เพิ่ม 7 ใหม่), `tsc --noEmit` + eslint สะอาด, จำลองกฎใหม่บน crop จริง: region-1 mask 705→0px, region-2 10,245→382px, region-8 473→358px, region-9 3,411→2,815px

**ข้อจำกัด:** เส้นหนาสั้นทรงคล้าย vertical text ยังรอด / crop มืดแยกไม่ได้ → error → ใช้ mask editor / knockout ต้องมี bright ≥12%

**หมายเหตุสำคัญ:** เปิดภาพเต็มหน้า 18+ จาก job dir ด้วย Read tool แล้ว provider คืน `empty_model_response` (content filter ฝั่ง GLM, เกิด 2 ครั้ง) — วิธีทดแทน: วิเคราะห์เชิงตัวเลข + ASCII rendering (`#`/`.` grid ~96 cols) แล้วให้ตาผู้ใช้ final check (บันทึกใน project memory แล้ว)

**เอกสารละเอียด:** [docs/2026-10-30-ink-mask-glyph-filter-fix.md](2026-10-30-ink-mask-glyph-filter-fix.md)

---

## ย้อนหลัง (backfill จาก git history ก่อนมีไฟล์นี้)

รายละเอียดเต็มอยู่ใน `git log` และ `docs/AI-WORKING-NOTES.md` — สรุปหัวข้อหลักต่อวัน:

- **2026-10-29** — `db793af`, `beeaccb`: บันทึกผลทดสอบ real-workload multi-variation cleaning (frontend UI flow + backend Python pipeline บน `scratch/all_75_pages/`) ลง AI-WORKING-NOTES; ทดสอบครอบคลุม full-page inpainting, MaskEditor fast-path, กู้ภาพเดิมทั้งจุด, `createInkMaskBlob` remnant clean
- **2026-10-28** — ชุดแก้ 15+ commits: stroke-targeted ink mask + remnant review 1-click buttons (`23e84d5`, `ea6096d`), กันผม/ภาพตัวละคร false-positive inpainting (`3b281a6`), safe mode default (`c2bd381`), live SFX policy toggle (`caa4745`), global Ctrl+F (`b43b87c`), stress test 40 หน้า (`09e4f6f`), accessibility fixes (`c6978a9`), glossary import merge + standalone start script (`99da500`), extension 401 backoff (`57072f4`)
- **ก่อนหน้า** — four-spec 15 tickets + G06 + live browser QA เสร็จและ push หมด (suite 236 ไฟล์ / 1,954 tests เขียว + pytest 245+3) — รายละเอียดใน AI-WORKING-NOTES.md
