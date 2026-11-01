# ZCode Working Notes — SuperK / Manga Translator

บันทึกประวัติการทำงานของ ZCode ทุก session เรียงจาก **ใหม่ไปเก่า** (ไฟล์นี้แยกจาก `docs/AI-WORKING-NOTES.md` ซึ่งห้ามแตะตามกฎเดิม — ไฟล์นี้คือฉบับของ ZCode)

กติกา: จบ session ไหนให้เพิ่ม entry ใหม่ **ด้านบนสุด** ของรายการ โดยระบุสิ่งที่ทำ หลักฐาน/ผลตรวจ สถานะ commit และลิงก์เอกสารละเอียดถ้ามี

---

## สลับ launcher เป็น production mode + แก้ venv พังจากการย้าย + Defender exclusion — 2026-11-01

- **ที่มา:** user รายงาน "ใช้งานแล้วช้ามาก" หลังรีบูตเครื่อง (uptime แค่ 3 นาทีตอนเช็ก) — วินิจฉัยซ้อน 3 ชั้น: (1) `SuperK-Launcher.vbs` รัน `npm run dev` = Turbopack compile สดทีละ route (2) หลังรีบูต Defender สแกน node_modules ใหม่ทั้งกอง (3) **ไม่เคยมี production build เลย** (.next มีแค่โฟลเดอร์ dev)
- **แก้ทั้ง 4 จุด (ผู้ใช้เลือกผ่าน AskUserQuestion):** (1) `npm run build` สำเร็จ — compile 19.9s + TS check ผ่าน + sync standalone 182 MB (2) **เขียน `SuperK-Launcher.vbs` ใหม่ให้ delegate ไป `scripts/start-production.ps1`** (build-if-stale เอง + รอ health + เปิด browser; dev mode ยังสั่ง `npm run dev` เองได้ตามเดิม) (3) **แก้ `start-production.ps1` (user WIP) จุดเดียว: สลับลำดับให้ใช้ `.venv` ก่อน `venv`** — สาเหตุ: venv เก่า (Python 3.11.15) ถูกสร้างบน path C:\Users\PC\Downloads\... เดิมแล้วถูก robocopy ย้ายมา F: → venv ไม่รองรับการย้าย (exe shim ฝัง absolute path เก่าซึ่งโฟลเดอร์ถูกลบไปแล้ว) → uvicorn ตายทันทีแบบเงียบ (ocr-error.log ว่างเปล่า), ส่วน `.venv` = Python 3.12.14 สร้างที่ F: โดยตรง deps ครบ (uvicorn 0.51.0 / numpy 2.5.1 / torch 2.13.0+cpu — ทดสอบ import ผ่าน) (4) **Defender exclusion** `F:\Projects\manga-translator` + `F:\manga-cache` (ผู้ใช้อนุมัติ + กด UAC เอง — ตรวจผ่าน Get-MpPreference)
- **ผลวัดจริงหลังแก้:** หน้าเว็บ `/` HTTP 200 ที่ **~3 ms** (ครั้งแรก cold ก็ 3.9 ms), OCR `/health` 200 ที่ ~3 ms `{"status":"ok"}` — services รันค้างไว้ให้ผู้ใช้ทดสอบต่อ
- **ค้าง/เสนอต่อ:** (1) ลบ `ocr-service/venv` เก่าที่พัง (Python 3.11 + shim เสีย — เสนอผู้ใช้แล้ว ยังไม่ลบ) (2) โฟลเดอร์เปล่า `C:\Users\PC\Downloads\manga-translator` ยังลบไม่ได้เพราะ session ถือ cwd — ลบได้หลัง session จบ (3) Fast Startup reduced ยังไม่ได้ทำ
- **Commit status:** `SuperK-Launcher.vbs` (tracked) แก้แล้วยังไม่ commit; `start-production.ps1` = user WIP (ห้าม stage ตามกฎเดิม) — ไม่มีการ push ใด ๆ

### ต่อ: popup "A SuperK service exited during startup" ที่ผู้ใช้ถ่ายส่ง — 2026-11-01

- ข้อความใน popup ตรงกับ **throw ของรอบแรก 18:42 (venv เก่าพัง)** เป๊ะ — popup ค้างรอกด OK บนจอ; ผู้ใช้กดปิดแล้วทั้งหมด
- run ที่ 18:49:50 (PID 2920) สร้างซ้ำไม่ได้ด้วยสถานะปัจจุบัน — ทดสอบ launcher จริง 2 รอบ (ดักทุก 1 วิ นาน 25 วิ): ผ่านหมด, service แข็งแรงต่อเนื่อง (frontend 200 @ 2.4 ms, OCR ok) — สรุปเบื้องต้น = เหตุชั่วคราวช่วงเครื่องเพิ่งบูต หรือคลิกชนกันเอง; **คำแนะนำผู้ใช้: เจอ popup → กด OK → ดับเบิลคลิก launcher ใหม่ได้ปลอดภัย (idempotent)**
- **บทเรียนวินิจฉัย:** การเช็ก process ด้วย `CommandLine -like "*start-production*"` **self-match กับคำสั่งเช็กเอง** → ต้องประกอบ marker ตอน runtime (`'start-produ'+'ction'`) หรือ filter ด้วย -File จริง ๆ — PID "2920" รอบแรกที่รายงานไปมาจากการเช็กถูกต้อง (CreationDate 18:49:50 ไม่ใช่ self-match) แต่รอบทดสอบแรกของผม (PID 11140/16904) เป็น self-match หลอก
- สาเหตุต้นทางของทั้งหมด: venv เก่า `ocr-service\venv` (Python 3.11, สร้างบน C: เดิม) — **ผู้ใช้อนุมัติลบ 2026-11-01: ตรวจแล้วไม่มี executable ใดรันจากโฟลเดอร์นี้ → ลบแล้ว (+295 MB), `.venv` (3.12.14) คงเดิมใช้งานปกติ, service ทั้งคู่ยังแข็งแรง**

### ต่อ: ทดสอบงานจริง — ZIP 680284 (Blue Archive, ต้นฉบับจีน) — 2026-11-01 ✅ ผ่าน

- ไฟล์: `Downloads\nhentai-680284 - [Ajimu Satori] Muremure Rinsen Rio (Blue Archive) [Chinese].zip` (17 หน้า) — แตก 3 หน้าทดสอบ (1.webp/8.jpg/15.webp) ที่ `F:\manga-cache\temp\realtest-680284`, สคริปต์ที่ `F:\manga-cache\temp\superk-realtest{,2,3}.mjs`
- **OCR 3/3 สำเร็จ:** หน้า 1 = 16 regions (cold 111.1s รวมโหลดโมเดลครั้งแรกหลังรีบูต), หน้า 8 = 1 region (route artwork, page_role ui), หน้า 15 = 4 regions (โดน protect/preserve) — หลังโมเดลโหลดแล้ว 2.9–12.1 วิ/หน้า
- **แปลจริงผ่าน /api/translate (production server, server key pool):** หน้า 1 = **16 bubbles, t-field 279 ตัวอักษรไทยล้วน cjk=0 kana=0 latin=0, attempt=1, 3.9 วิ** — **Chinese echo guard ผ่านงานจริงแล้ว** (original_text จีนถูกอ่านครบ `只是打開一點點的話…` → `t` ไทยสมบูรณ์ `ถ้าเปิดแค่หน่อยเดียว…`, はぁ… → ฮ่า...); หน้า 8/15 = 0 bubbles — สอดคล้องกับ OCR ฝั่งตัวเอง (artwork/protected) = น่าจะหน้าภาพ/SFX, ให้ผู้ใช้ตาตรวจเอง
- **โมเดลที่รับงาน = gemini-3.5-flash-lite ผ่าน attempt แรก** — ก่อนหน้านี้ flash-lite เคย echo จีนจนโดน rotate; หลัง prompt + validateSuccess ใหม่ผ่านสวยและเร็ว 1.8–3.9 วิ/หน้า
- หมายเหตุรูปแบบตอบ: `/api/translate` คืน `{text, meta}` โดย `text` = JSON string ของ `{bubbles:[…]}` (frontend parse เอง) — สคริปต์ทดสอบต้อง JSON.parse ชั้นในก่อนนับ; `meta.model/attemptCount/elapsedMs` ใช้ตรวจได้
- ค้าง: ผู้ใช้ import ZIP เต็มใน UI แล้วตรวจหน้า 8/15 ตา + ทดลอง export; ยังไม่ commit อะไรเพิ่มในรอบนี้ (แก้แค่ SuperK-Launcher.vbs รอ com push)

### ต่อ: แปลทั้งเล่ม 17 หน้า + รายงานภาพ — 2026-11-01

- ผู้ใช้ขอ "แปลทุกหน้า + ดูผลลัพธ์" — แตก ZIP ครบ 17 หน้า (`F:\manga-cache\temp\realtest-680284`) + PIL ทำ preview JPEG 400px/q55, แปลครบผ่าน `/api/translate` (production, flash-lite, เฉลี่ย ~10 วิ/หน้า)
- **ผล: หน้า 1–7 = บทสนทนาจริง ได้ 46 bubbles รวม, t-field ไม่มีจีน/คานะเลย (echo guard ผ่านทั้งเล่ม); หน้า 8–17 = `{"bubbles":[]}` ทั้งหมด**
- **พิสูจน์ว่าไม่ใช่บั๊ก:** probe หน้า 9/12 ด้วย `modelPreference=gemini-3.8-flash` → attemptCount=4 fallbackCount=3, 78–108 วิ, ยังตอบว่าง = **Gemini ปฏิเสธทั้ง model chain (content policy) — soft-refuse ผ่าน HTTP 200 ซึ่ง validateSuccess รับเป็น "หน้าไม่มีข้อความ"**; หน้า 16 มีแต่ลายน้ำโฆษณา (tag "extraneous ads" ของเล่ม) ซึ่ง probe แยกจับได้ 2 bubbles แบบไม่คงเส้นคงวา
- ทางเลือกที่แอปออกแบบไว้ = **9router path** (`SUPERK_TRANSLATE_BASE_URL` + `SUPERK_TRANSLATE_API_KEY` ใน .env.local — comment ใน handler บอกเอง "no NSFW block") ยังไม่ได้ตั้งค่าให้ผู้ใช้; ไม่มีการแก้โค้ดรอบนี้
- **รายงานภาพผู้ใช้:** `C:\Users\PC\.zcode\v2\visualizations\8d94d...\manga-translate-results.html` (669 KB, fragment ใต้ลิมิต 1 MB) — tabs 17 หน้า, overlay กล่อง bubble จริง (box=[ymin,xmin,ymax,xmax] สเกล 0–1000 → %), tooltip ข้อความเต็ม, ตารางต้นฉบับ↔ไทยใต้ภาพ, สถานะต่อหน้า (แปลแล้ว/ถูก block/ลายน้ำ) — ตัวสร้าง `F:\manga-cache\temp\superk-report-gen.mjs`
- **แก้ไขหลังผู้ใช้ยืนยัน (ground truth):** หน้า 8–17 **ไม่มีข้อความจริง** → `{"bubbles":[]}` คือคำตอบที่ถูกต้องเป๊ะ ไม่ใช่การถูก block — ข้อสรุป "Gemini content policy" ของผมผิด ถอนแล้วทั้ง memory (nsfw-image-vision-limit) และป้ายในรายงาน (regenerate แล้วเป็น "ยืนยันโดยเจ้าของงาน: หน้านี้ไม่มีข้อความ") — สรุปสุดท้าย: **ระบบตอบถูก 17/17 หน้า** (46 bubbles + ว่างตรง 10 หน้า), echo guard ผ่านทั้งเล่ม
- ข้อสังเกตที่ยังใช้ได้: หน้าเปล่า + flash-lite = 1 attempt ~8 วิ; หน้าเปล่า + 3.8-flash = เสีย 4 attempts/78–108 วิ (empties โดน validation ปัด → หมุนโมเดลเปล่าประโยชน์) — เลือก flash-lite สำหรับเล่มแนวนี้; 9router path ไม่จำเป็นสำหรับเล่มนี้
- **รายงานรอบ 2 (ภาพคลีน):** ผู้ใช้ถาม "ทำไมไม่คลีนข้อความให้" — รอบแรกโชว์แต่ต้นฉบับเพราะทดสอบเฉพาะขั้นแปล; รอบนี้รัน OCR clean จริงหน้า 1–7 (LaMa บน CPU): **ต้นทุนแปรผันตามพื้นที่ข้อความ — 24s (เบา) ถึง 330s (หน้า 4 หนักสุด), หน้า 1 รวมโหลดโมเดล 121.7s** — บทเรียนการทำงาน: poll cap 144s ของ batch แรกสั้นไป → ตัดงานกลางคัน (server ทำต่อเองจนจบ) → แก้ด้วย rescue ด้วย jobId จาก log + cap 15 นาที; CPU delta วัดได้ 13.25s/5s = ทำงานจริงไม่ใช่ deadlock; หน้า 8–17 ใช้ภาพเดิมแทน (ไม่มีข้อความ = คลีนแล้วเหมือนเดิม) — fragment ใหม่ 649 KB
### ต่อ: GPU torch + all-text re-clean — 2026-11-01

- ผู้ใช้ถาม "ทำไมไม่ใช้ GPU / ทำไมยังมีข้อความหลุด" → สองคำตอบ: (1) เครื่องมี **RTX 5050 8GB** แต่ lock resolve torch จาก PyPI = wheel +cpu เสมอ (2) ข้อความหลุด = โหมด `safe` จงใจเว้น region ที่ needs_review ไว้รอ RemnantReviewPanel (หน้า 1: 16 regions = 10 repaired / 3 needs_review / 3 preserved) — โค้ดรองรับ CUDA อยู่แล้ว (jobs.py torch.cuda.is_available)
- **สลับ torch สำเร็จ (ผู้ใช้อนุมัติ):** `uv pip install "torch==2.13.0+cu130" --index-url .../whl/cu130` (cu128 ไม่มีสำหรับ 2.13.0; dry-run ต้องใส่ local version +cu130 ไม่งั้น uv ถือว่า +cpu ที่ลงอยู่ satisfiable) — เห็น RTX 5050, ใช้งานจริง 60-69% util / 4.6-5.3GB VRAM; ต้องหยุด OCR ก่อนสลับ (file lock) แล้ว start-production ใหม่
- **ผลจริงแบบตรงไปตรงมา:** all-text หน้า 1–7 บน GPU = 130–225 วิ/หน้า — เร็วขึ้นจริงเฉพาะหน้าหนัก (330→222s) แต่หน้าเบายัง ~130s = ต้นทุนจมกับ **overhead ต่อ job** (น่าสงสัยว่า reload โมเดลระหว่าง job + ขั้น CPU ฝั่ง mask refine/PNG) — โปรไฟล์ต่อ = opt-in งานหน้า
- **ทางเลือกงาน:** jobs-gpu พัง 2 จุด (p1 fetch failed ตอน server restart พอดี, p2 โดน poll cap 300s) → เก็บตกด้วยการหา jobId จาก `F:\manga-cache\ocr-jobs\jobs\` แล้วยืนยันด้วย **source_hash** match กับ job เดิมของหน้านั้น (b75d6802 ที่เดาแรกผิด — ตัวจริงคือ 4354c0bd)
- รายงานรอบ 3: ภาพคลีน GPU all-text หน้า 1–7 + ไทยวางทับ (635 KB) — regen preview-clean จาก clean-alltext
- ค้างจำ: **reinstall lock จะดัน torch กลับเป็น +cpu** — ต้องรันสลับ cu130 ซ้ำหลัง rebuild venv (บันทึกใน memory แล้ว)

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
- **สถานะ:** OCR backend รีสตาร์ทด้วยโค้ดใหม่ (/health 200) — งาน uncommitted ตอนนี้ 3 ชุด: extractGlyphInk + outsideProtectedAreas + mask-smartness (รอผู้ใช้ทดสอบ → commit ตามอนุมัติ) — **อัปเดตท้ายวัน: ทั้ง 3 ชุดถูก commit (c180dc8 / e120a70 / 3812366) และ push ครบ (origin/main 13 commits)**

### ต่อ: ย้ายโปรเจกอื่นออกจาก Drive scope — 2026-10-31 (user เลือกย้ายทั้งหมดผ่าน AskUserQuestion)

- **PCSpec** (Downloads, git+npm): ย้ายแล้วพบว่า `F:\Projects\PCSpec` **มีสำเนาเก่าจาก 2026-08-29 อยู่แล้ว** → robocopy กลายเป็น merge: copied 15,103 ไฟล์/357 MB (ต่างกัน — ฝั่ง Downloads ใหม่กว่าชนะ), skipped 71,646 ไฟล์/1.86 GB (identical — ค้างที่ต้นทาง ไม่ถูกลบ เพราะ robocopy /MOVE ไม่ลบไฟล์ที่ skip), Extras 12,313 ไฟล์/57 MB ฝั่ง F: ไม่โดนแตะ (รวม PCSpec.zip) — ยืนยันด้วย robocopy /L รอบสอง: **Copied=0 / Mismatch=0 / FAILED=0** = ต้นทางซ้ำซ้อนเต็ม → ลบต้นทาง (รวม node_modules) ปลอดภัย; git state ปลายทางตรงก่อนย้ายเป๊ะ (3 M chatbot files + ?? เดิม, HEAD bba9cc1a, ahead 2/behind 16); npm ci + node-backend postinstall รันปลายทาง
- **Codex** (Documents, git+npm เล็ก): ย้ายสำเร็จ 43 ไฟล์, ต้นทางหาย
- **EP1_AutoRender** (Downloads, 425 MB เครื่องมือ render นิยาย): ย้ายสำเร็จ 98 ไฟล์, ต้นทางหาย
- **กลุ่มอ้างอิง** → `F:\Projects\_reference\`: Study_Frontend_Projects, GPT API, skill-ai (632 MB) — ย้ายสำเร็จทั้งหมด ต้นทางหาย (บทเรียน: robocopy loop ครั้งแรกล้มเหลวเงียบๆ เพราะ grep กลืน error — รันซ้ำด้วย output เต็มจึงเห็น)
- **desktop.ini กวาดเพิ่ม 3,741 ไฟล์** จากต้นไม้ที่ย้ายมา (เหลือ 0 ทุกที่) — สแกนรอบสอง (Desktop/home root/ดิสก์อื่น/ลึก 3 ชั้น) เจอ **video-translator-app** (Downloads — Next.js, git synced กับ origin, งาน uncommitted 5 ไฟล์: page.tsx/audioExtractor/geminiClient/geminiVideoService/translationPipeline) — ย้ายสำเร็จ 459 ไฟล์/1.97 MB + npm ci + git ตรงเดิม + ลบต้นทาง (เหลือแค่ node_modules/.next ที่ตั้งใจไม่ขน) — desktop.ini กวาดเพิ่ม, ต้นทางหายสนิท
- **โปรเจกที่เหลืออยู่นอก scope โดยเลือกไม่ย้าย** (user ตอบเลือกเฉพาะ video-translator-app): C:\Users\PC\Developer\video-use, Desktop\Acheron, D:\Open Design, D:\Vibe Video, E:\dmde — ทั้งหมดอยู่**นอก** Drive backup scope — ผู้ใช้ทราบและเลือกไว้แล้ว — **ต่อมา user ขอย้าย Downloads\OpenCode เพิ่ม → F:\Projects\OpenCode** (206 ไฟล์, ไม่มี git/deps, desktop.ini กวาด, ต้นทางหาย) — **และ Documents\antigravity → F:\Projects\antigravity** (30 ไฟล์, git local-only 2 ตัว: goofy-faraday/modest-lavoisier — ตัวสุดท้ายใน scope Drive, ต้นทางหาย, desktop.ini = 0) — **สรุป: ไม่มีโปรเจก dev เหลือใน scope ของ Google Drive backup แล้วทั้งเครื่อง**

### ต่อ: จัดโฮมรูท C:\Users\PC — 2026-10-31 (user เลือก 3 อย่างผ่าน AskUserQuestion)

- **สำรวจโฮมรูททั้งหมด:** dot-dirs ~40 ตัว = tool configs ล้วน (สแกน .git ซ่อน — ไม่มี repo); โฮมรูทไม่อยู่ใน scope Drive backup → ไม่เร่งด่วน
- **ย้าย vtranslate** (โปรเจก Python — OpenCode มีแค่สำเนา) → F:\Projects\vtranslate (33 ไฟล์, ต้นทางหาย)
- **ย้าย win-ocr-temp** (เวิร์กสเปนทดลอง Windows OCR) → F:\Projects\_reference\win-ocr-temp (38 ไฟล์, ต้นทางหาย)
- **รวมข้อมูล PCSpec** → F:\Projects\PCSpec-data (19 ไฟล์: Advice_Scraper.py, catalog_instructions.md, CSV ทั้ง `_all`/`_50` ทุกหมวด): ย้ายเนื้อหา C:\Users\PC\PCSpec ทั้งโฟลเดอร์ (10 ไฟล์ — dir หาย) + โฮมรูท: ย้าย `_50`/`cpu_list` 9 ไฟล์ + **ลบซ้ำ `_all.csv` 8 ไฟล์ (cmp ยืนยัน identical กับที่ย้ายไปแล้วทุกตัว)** — โฮมรูทเหลือ 0 csv
- **ไม่แตะ** (user ไม่ได้เลือก): `.git_user_backup\` (สำเนา .git ของโปรเจก Streamlit ไม่ระบุชื่อ — มี index.lock ค้าง), สคริปต์ระบบที่โฮมรูท (scan_c.ps1, install.ps1, quality-gate.sh, yt_fetch.py, yt_slice.py, map_chunks.py, sub*.srt, transcript_full.json, rclone logs, ไฟล์ `nul`, `.tmp.driveupload` ใน Downloads)

### ต่อ: จัดไฟล์หลวมที่โฮมรูท — 2026-10-31 (user เลือกครบ 4 กลุ่มผ่าน AskUserQuestion)

- **สคริปต์บำรุงรักษา 22 ไฟล์** (check_*.ps1 ×15, delete_*.ps1 ×2, find_processes, scan_c, install, quality-gate.sh, extract_part1.py) → F:\Projects\_reference\maintenance-scripts
- **งานซับ/YT 8 ไฟล์:** sub.srt, sub2.srt, transcript_full.json, chunk3.txt, yt_fetch.py, yt_slice.py, map_chunks.py → F:\Projects\OpenCode; computer-100-articles.html ("คอม 100 เรื่อง") → F:\Projects\Docs\Content
- **scratch เว็บ 2 ไฟล์** (Untitled-1.html, css.css) → F:\Projects\_reference\scratch
- **ลบ junk 8 ไฟล์:** mumu_boot.txt, rclone_*.log ×3, drive_names_report.json, -1.14/-1.18-windows.xml (ลบต้องใช้ `rm -f -- "./-1.14..."` เพราะ rm ตีเป็น option), nul (Windows reserved name)
- **ไม่แตะ:** NTUSER.DAT*, .gitconfig, .boto, .claude.json, .node_repl_history, skills-lock.json, .git_user_backup
- **ค้าง:** compact_log.txt (log ตัวเดียวที่ไม่ได้อยู่ในลิสต์อนุมัติ — ลบได้เมื่อ user ยืนยัน) — โฮมรูทเหลือแค่ config/ระบบล้วน

### ต่อ: จัดระเบียบ Documents — 2026-10-31 (user เลือก "จัดกลุ่มใน Documents")

- **หลักการ:** app-data ทุกตัวไม่แตะ (Rockstar/Adobe/My Games/เกมทุกตัว/My Pictures-Videos-Music/MuMu/Steam Cloud/RPGXP/XuanZhi9/Arduino sketchbook/WindowsPowerShell/Zoom/Notes)
- **สร้าง `Documents\Docs\`:** `SuperK-Plans\` (14 ไฟล์ — superk-*.md + SuperK-OneOCR/PaddleOCR Plan+Summary + Plans\superk-improvement-plan, Plans\ โฟลเดอร์หาย), `Study\` (English_Practice + AI-Agent-Academy-Tips + Database-Design-Course + GeniusHub-Resources + บทที่ 3.docx + แบบฝึกหัด บทที่ 1.docx/.pdf), `Content\` (YT-Shorts 2 ไฟล์ + transcript.xlsx), `Misc\` (free-tier-tools, แผนงาน_Hermes)
- **ย้ายข้ามไป F:\Projects\PCSpec-data:** forgelabs-pc-builder.drawio + .bkp (diagram ของโปรเจก PCSpec)
- **ลบโฟลเดอร์ว่าง:** New OpenCode Project, temp
- **ค้างที่ root ให้ผู้ใช้เลือกเอง:** ~~Orange.blend/.blend1, Roblox_*.mp4, .RData/.Rhistory~~ **ย้าย/ลบครบแล้วตามที่ user สั่ง "ย้ายไปทั้งหมด"**: Roblox mp4 ×2 → My Videos, Orange.blend/.blend1 → My Videos\3D, .RData/.Rhistory ลบ — **root ของ Documents ตอนนี้เหลือแค่ app-data folders ล้วน** — **ต่อมา user สั่งย้าย Docs ทั้งก้อน → F:\Projects\Docs** (27 ไฟล์ 4 หมวด ย้ายสำเร็จ ต้นทางหาย) — Documents เหลือเฉพาะ app-data ล้วน

### ต่อ: รีวิวข้อเสนอ 4 ข้อ (จาก session อื่น) + Export progress bar + เคลียร์ C — 2026-10-31

- **รีวิว (user ส่งลิสต์มาจาก session อื่น):** (1) ❌ ลด ADAPTIVE_MIN_SEPARATION 0.08→0.006 — วิเคราะห์ผิดตัวแปร: โค้ดเทียบ mean gap (mean_high - mean_low) ไม่ใช่ Otsu variance (gap 0.25 ผ่าน 0.08 สบาย ไม่มีการดีดกลับ); 0.006 = รับ noise; เคส contrast ต่ำมี _rescue_low_coverage_regions รองร้อยแล้ว (2) ✅ ฟีเจอร์ RTL reading + export progress = ของจริง น่าทำ (3) ❌ lint "eslint"→"eslint ." — ทดสอบแล้ว bare npm run lint ทำงานสมบูรณ์ (ESLint 9 flat config lint cwd เอง), 0 errors/72 warnings ตรง baseline (4) ❌ NEXT_TURBOPACK_PERSISTENCE **ไม่มีอยู่จริง** ใน Next 16.3.6 (grep ทั้ง docs+dist) — knob จริงคือ config `turbopackFileSystemCacheForDev: false` (อยู่ใน config-schema.js) ใช้ได้ผ่าน `nextFactory({dev:true, dir, conf})` ใน nextServerChild.mjs — แต่ suite เขียวหมดบน Node 26.0.0 ไม่มีอาการ จดไว้ไม่แก้
- **Export progress bar (user เลือกทำตัวนี้ก่อน) — UNCOMMITTED:** state `exportRenderProgress {completed,total}` ใน useExportOrchestrator + นับในลูป batch ทั้ง 4 (zip/cbz :1049, pdf :975, strip :797, layered :766 — นับเฉพาะหน้า non-excluded) → ส่งผ่าน useWorkspaceController → WorkspaceHeaderHost แสดง "กำลังสร้างภาพหน้า X/Y…" ข้างปุ่ม export เมื่อ isZipping && total>1 (aria-live) — ไม่แตะ 7 จุด finally (UI gate ด้วย isZipping พร้อมกัน) — tsc 0 / eslint 0 / เทสเป้าหมาย 10/10 — RTL reading ยังค้างเป็น feature ถัดไป (ควรมี spec ก่อน)
- **ทดสอบ progress bar แบบ live ผ่าน IAB (สำเร็จ):** สำรองงานจริงของผู้ใช้ (1 หน้า "storage_view_test.png") ลง IndexedDB key `zcode_test_backup_latest_session` ก่อน → ฉีดเซสชันสังเคราะห์ 12 หน้า → export ZIP → **จับข้อความ "กำลังสร้างภาพหน้า 7/12…" กลางไฟล์** = นับต่อหน้าจริงไม่ค้าง; export จบสมบูรณ์; export รอบสองเร็วมากจาก render cache (ข้อความแฟลชสั้น — จุดแข็งของ progress bar อยู่ที่ first export ของเล่มใหม่) — **คืนค่างานเดิมผู้ใช้เรียบร้อย ยืนยันจาก IndexedDB (1 หน้า, backup key ลบ)** — บทเรียน automation: menuitem "ZIP" ซ้ำ 3 ตัวใน DOM (desktop+mobile) → ต้อง dom_cua.get_visible_dom เอา node ที่ inViewport; exporter รอบสองใช้ render cache ทำให้ progress แฟลชเร็ว

### ต่อ: บั๊ก "กดใช้ไม่ได้" (Inspector) — 2026-10-31 ดึก (UNCOMMITTED)

- **อาการ:** กดปุ่ม T+ (เพิ่มข้อความ) → bubble เข้า state (เลเยอร์สลับ Translated) แต่**ไม่แสดงบนผืนผ้าใบ** → Inspector แก้อะไรก็ไม่เห็นผล
- **สาเหตุ:** effect วาด overlay ใน useTranslation.ts (~:695) ใช้ `applyTranslationOverlay` แต่ **deps ไม่มี `activeBubbles`** → เพิ่ม bubble แล้ว effect ไม่ re-run; bubble โผล่เฉพาะตอนสลับหน้า (currentPage เปลี่ยน = effect ยิงใหม่) — พิสูจน์ด้วย automation: ก่อนสลับหน้า `[data-bubble-id]`=0, หลังสลับกลับ=1
- **แก้:** เพิ่ม `activeBubbles` ลง deps ของ effect นั้น (บรรทัดเดียว) — bubble แสดงทันทีที่กด T+, Inspector แก้ขนาดแล้วกล่องโตจริง (ทดสอบ live ผ่าน IAB ครบ: สร้าง → เลือก → ขยาด 24→26 เห็นผล)
- **ผลข้างเคียงที่ต้องรู้:** session เดิมของผู้ใช้ (1 หน้า "storage_view_test.png") รูปต้นฉบับหายจาก asset store อยู่แล้วก่อนการทดสอบ (asset ref ตาย — session นั้นมีแค่รูป ไม่มีข้อมูลแปล 375 bytes) — ตอนนี้ session ใน IAB = เซสชัน QA 4 หน้า + bubble ทดสอบ 2 ตัว (user กด Clear เองได้)
- **Gates:** tsc 0 / eslint 0 errors (4 warnings เดิม) / tests/translation ผ่าน — full suite รอยืนยัน — **UNCOMMITTED รวมกับ export progress bar**

### ต่อ: งานจริงของผู้ใช้ = มังงะจีน → Gemini echo จีนกลับมา — 2026-11-01 เช้า (UNCOMMITTED: prompt fix)

- **อาการจริง:** งานจริง 7 หน้าเป็น**มังงะจีน** (原來如此 ฯลฯ) — แปลทั้งเล่มแล้ว Gemini ตอบ**จีนตัวย่อกลับมา** (ไม่ได้แปล) → G01 script guard flag 6 จุด (จุดค้าง, ปุ่มยืนยันถูกบล็อกตามดีไซน์) — "แปลไม่ได้ ปุ่มใช้ไม่ได้"
- **สาเหตุ:** `buildTranslationPrompt` (src/app/api/translate/handler.ts:100) ห้าม kana/kanji/Cyrillic/Hangul/Latin แต่**ไม่ได้ห้ามตัวจีน explicitly** + ไม่มีคำสั่ง "ต้นฉบับอาจเป็นจีนก็ต้องแปลเป็นไทย ห้าม echo" — Gemini จึง echo ต้นฉบับจีน
- **แก้:** เพิ่มใน thaiTargetDirective: ห้ามตัวจีน (simplified/traditional พร้อมตัวอย่าง 原来/這是/行為/這裡) + "The source page may itself be written in Chinese — never copy, echo, or transliterate it back as Chinese"
- **การ validate:** ฉีดหน้า canvas ตัวจีนจำลอง → PaddleOCR **ไม่จับ**ตัวจีนที่วาด (bubble ว่าง t="") = ข้อจำกัดของหน้าปลอม ไม่ใช่บั๊ก — validation ที่แท้จริง = ผู้ใช้กด "แปลหน้านี้ใหม่"/แปลทั้งเล่ม ในงานจริงหลัง refresh (prompt ใหม่ถูกใช้ทันที ไม่ต้อง restart เซิร์ฟเวอร์)
- **ทดสอบ live อื่นๆ รอบนี้ (ผ่านหมด):** translate-all จริง 4 หน้า QA — progress ใหม่เดินครบ ("กำลังคลีนหน้า 2/4 (33%)" → "กำลังแปลหน้า 3/4 (67%)" + ⏱ ต่อหน้า/รวม + เตรียมล่วงหน้า), Gemini ช้า 58s = latency ผู้ให้บริการไม่ใช่ค้าง, Auto-Retry ตอน OCR ไม่เจอข้อความทำงานเอง
- **ตรวจ API ตรงๆ (เผิญจริง):** เรียก /api/translate ตรงด้วยหน้าจีน + prompt ใหม่ → model = **gemini-3.5-flash-lite** (Auto routing เลือกตัวเบา) ตอบ **bubbles ว่าง** (validateSuccess เก่าผ่านเพราะเช็คแค่ Array.isArray) → **แก้ validateSuccess (handler.ts:420):** (1) bubble ทั้งหมดมี t ว่าง → reject → rotate โมเดลถัดไป (2) target ไทย + คำแปล CJK > Thai (echo จีน) → reject → rotate — "ไม่พบข้อความ" (bubbles=[]) ยังผ่านตามเดิม — รอบทดสอบหลังแก้: 504 เพราะหน้าจีนจำลอง (ตัวอักษรแนวตั้งวาดเอง) ไม่ผ่านโมเดลไหนเลย = ข้อจำกัดหน้าปลอม ไม่ใช่ regression — validation ใหม่ต้อง validate ด้วยหน้าจริงของผู้ใช้
- **สถานะ uncommitted สะสม:** export progress bar + inspector fix (activeBubbles deps) + prompt fix จีน + validateSuccess echo/empty guard — **COMMITTED+PUSHED แล้ว (7a633a8 รวม prompt+echo guard)**; ถ้ายัง echo → ขั้นถัดไป: text-mode two-pass fallback ฝั่ง server

### ต่อ: บั๊ก "เครื่องมือแก้ไขข้อความใช้ไม่ได้" — ตัวการตัวจริง — 2026-11-01 (UNCOMMITTED)

- **Reproduce สำเร็จด้วย automation:** กดปุ่ม "ตัวหนา" ใน Inspector → `Timeout: covered by <div data-testid="remnant-review-findings" class="fixed right-3 z-40 max-w-[420px]">` — **RemnantReviewPanel (แผงตรวจจุดค้าง fixed ขวา z-40) ทับปุ่ม Inspector ทั้งแผง** = กดอะไรก็โดนแผงตรวจกินคลิก (ตรงกับ finding เดิม "RemnantReviewPanel overlaps ยืนยัน button")
- **แก้:** RemnantReviewPanel เพิ่ม effect ฟัง event `superk:bubble-selected` (มีอยู่แล้วในระบบ — CanvasHost ฟังอยู่แล้ว) → มี detail (เลือกกล่อง) → `setIsCollapsed(true)` อัตโนมัติ — แผงย่อเป็น pill "จุดรอตรวจ N จุด" กดกลับเพื่อกางได้
- **ยืนยัน live:** เลือกกล่อง → แผงย่อเอง (เหลือ pill) → ปุ่ม Inspector คลิกผ่าน (ไม่มี covered-by timeout อีก)
- **หมายเหตุ:** ผู้ใช้ใช้งานผ่าน IAB ที่โค้ดใหม่ — อาการ "ใช้ไม่ได้" ที่เหลือหลัง fix นี้ให้เก็บ click-sequence แนบมาด้วย (automation ตรวจ bold ได้ยากเพราะ style อยู่ใน overlay canvas)
- **Gates:** tsc 0 / eslint 0 errors / tests workspace+cleaning ผ่าน — **COMMITTED+PUSHED (5d42447/eb9ed6a/7a633a8/fb5dfee)** — flaky note: translationOverlayCornerDrag + WorkspacePage stopwatch fail ได้ตอน suite โหลด (pass ตอนรันเดี่ยว) — uncommitted เหลือ 0
- **สถานะ uncommitted สะสม:** export progress bar + inspector fix (activeBubbles deps) + prompt fix จีน — **COMMITTED แล้ว (รวมอยู่ใน 4 commits ด้านบน)** รอผู้ใช้ทดสอบงานจริงต่อ
- **เคลียร์ C (user เลือกเฉพาะ updater caches):** ลบ installer/pending ใน 9 โฟลเดอร์ *-updater ใน AppData\Local (+2.4 GB → ว่าง 33.3 GB) — uv cache 3.1 GB user เลือก**ไม่**ลบ (เผื่อ rebuild venv), CapCut/Brave/electron/Discord ใหญ่แต่เป็น app data ให้จัดผ่านแอปเอง

### ต่อ: ย้าย C:\Users\PC\ZCodeProject — 2026-10-31

- ผู้ใช้ชี้ path มา → ตรวจ: เป็น**โปรเจกจริง** (37 MB, git) = **Google-Drive-File-Viewer** (origin github.com/krgame00/Google-Drive-File-Viewer-, synced กับ origin, untracked เฉพาะ gui-test-screenshots 8 ไฟล์) — ชื่อ ZCodeProject ซ้ำกับโฟลเดอร์ติดตั้งแอป ZCode ที่ F:\Projects\ZCodeProject (ZCode.exe — คนละอย่างกันโดยสิ้นเชิง) → user เลือกชื่อใหม่ **Google-Drive-File-Viewer**
- ย้ายสำเร็จ 1,568 ไฟล์/33 MB (0 FAILED, /L verify สะอาด) → `F:\Projects\Google-Drive-File-Viewer`, git state ตรงเดิม, ลบต้นทางแล้ว, desktop.ini = 0 — เหลือโปรเจกใน scope Drive เท่าเดิม (Documents\antigravity ตัวเดียว)

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
