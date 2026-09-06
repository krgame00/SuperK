# แผนงานแก้ไขรอบที่ 2 (Re-Review Plan) — ตรวจซ้ำหลัง apply แผนหลัก

- **วันที่รีวิว:** 2026-09-07 (รีวิวซ้ำ commit `45ec59d` ด้วย fresh eyes 3 ด้าน: frontend / ocr-service / security-ops)
- **บริบท:** แผนหลัก `docs/system-review-plan.md` (Phase 1–6) apply ครบแล้ว — รอบนี้ตรวจ 2 อย่าง: (1) fix ลงจริงไหม (2) การแก้แนะนำบั๊กใหม่หรือไม่
- **ผลการตรวจรับรอบที่แล้ว:** ✅ ทุก fix ที่อ้างว่าทำ **ลงจริงทั้งหมด** (ตรวจจากโค้ดปัจจุบัน ไม่ใช่ diff) — vitest 332 / pytest 134 / tsc / lint / ruff เขียวหมด, secrets ใน git history สะอาด
- **วิธีใช้:** ทำตาม Phase R1 → R2 → R3 ติ๊ก `- [x]` เมื่อเสร็จ

---

## สรุปผู้บริหาร

การแก้ครั้งใหญ่ (71 ไฟล์) ทำงานถูกต้องตามที่ออกแบบ **แต่แนะนำบั๊กใหม่ 3 จุดระดับ HIGH** — ทั้งหมดเป็นผลข้างเคียงของ dirty-save / LRU-GC / watchdog ที่เพิ่งเพิ่มเข้ามา แก้ได้ใน ~20 บรรทัดรวมกัน + เทส watchdog 1 ตัว ส่วนที่เหลือเป็น Medium/Low และของที่ de-scope ไว้เดิม (ไม่เสื่อมสภาพเพิ่ม)

---

## Phase R1 — บั๊กใหม่ระดับ HIGH จากการแก้รอบที่แล้ว (ทำทันที ⭐⭐⭐)

### R1.1 Dirty-set wipe race — save ทับหน้าที่เพิ่งแก้
- **ที่:** `hooks/useTranslation.ts` `performSave` (~352)
- **อาการ:** หน้าที่ถูก mark dirty **ระหว่าง** save กำลัง commit (เกิดบ่อยตอน translate-all) จะโดน `dirtyPagesRef.current = new Set()` เคลียร์ทั้งที่ยังไม่ได้เขียนลงดิสก์ → ภาพแปลของหน้านั้นหายจาก session (catch-up save รอบถัดไปเห็น dirty ว่าง เขียนไม่มีอะไร)
- **วิธีแก้:** snapshot dirty set **ตอนเริ่ม save** (ก่อน await) แล้วตอนสำเร็จค่อยลบเฉพาะสมาชิกใน snapshot ออกจาก set จริง:
  ```ts
  const snapshot = dirtyPagesRef.current;        // null = full save
  await saveProjectSession(..., { dirtyPageUrls: snapshot ?? undefined });
  // สำเร็จ:
  dirtyPagesRef.current = snapshot
    ? new Set([...dirtyPagesRef.current ?? []].filter(u => !snapshot.has(u)))
    : new Set();
  ```
- **ตรวจรับ:** เทสจำลอง mark dirty ระหว่าง save ค้าง (mock saveProjectSession เป็น promise ที่เรียก markPageDirty ก่อน resolve) → save ถัดไปต้องรวมหน้านั้น

### R1.2 LRU eviction ถาวรบนดิสก์ — เล่มเกิน 40 หน้าเสียภาพแปลเก่า
- **ที่:** `lib/projectStore.ts` `saveProjectSession` GC (~242–248) + `hooks/useTranslation.ts` LRU cap 40
- **อาการ:** GC ลบ asset ทุกตัวที่ไม่อยู่ใน `translatedImageCache` (LRU 40 หน้า) → เล่มยาว: autosave แต่ละครั้ง**ทำลายภาพแปลที่ persist ไว้ของหน้าเก่า** reload มาโหลดได้ ≤40 หน้า, โหมด scroll แสดงหน้าเก่าเป็นยังไม่แปล, `hasCurrentTranslation` เด้ง false
- **วิธีแก้:** referenced set ต้อง derive จาก **bubbleCache keys ∪ translatedImageCache keys** (หน้าที่ถูก evict ยังมี bubbles อยู่ = มีสิทธิ์คง asset ไว้):
  - `referencedAssetIds` รวม asset id ของ bubbleCache-only keys ด้วย (ไม่ rewrite blob — ข้าม put)
  - `translatedAssetIds` ใน session record ต้องรวมทุก referenced key เพื่อให้ restore โหลดกลับมาครบ (refill LRU อัตโนมัติหลัง restore)
  - GC ยังลบเฉพาะ `translated_` ที่ไม่อยู่ใน union
- **ตรวจรับ:** เทส: save เล่ม 3 หน้า → save ใหม่โดย imageCache มีแค่หน้า 1 แต่ bubbleCache มีครบ 3 → `loadProjectSession()` ต้องได้ asset ครบ 3 หน้า; ลบหน้าออกจาก bubbleCache ด้วย → asset ถูก GC

### R1.3 Timed-out job ฟื้นเป็น SUCCEEDED หลัง restart
- **ที่:** `ocr-service/app/jobs.py` `_complete` (~439–475) — status guard อยู่**หลัง** `_write_assets` + เขียน result.json
- **อาการ:** job ที่ watchdog ตัด แต่ pipeline จบทีหลัง ยังเขียนไฟล์ครบ → หลัง restart `_restore_job_from_disk` เห็น result.json ครบ → restore เป็น SUCCEEDED (ฝืนเงื่อนไข "discarding result") + ดิสก์เปลือง
- **วิธีแก้:** ย้าย guard ขึ้น**บนสุดของ `_complete`** (ก่อนเขียนอะไรลงดิสก์): `with job.lock: if job.status is not RUNNING: return` และตัดการอ่าน `job.source_bytes` นอก lock ที่เหลืออยู่
- **ตรวจรับ:** เทสใหม่: blocking pipeline + `job_timeout_seconds=0.05` → job FAILED, **ไม่มี** result.json บนดิสก์, และ store ใหม่ (จำลอง restart) `get()` ได้ None

---

## Phase R2 — แก้ตาม (Medium ⭐⭐)

### R2.1 Overlay document listeners leak ตอนสลับหน้า
- **ที่:** `lib/translationOverlay.ts` (~1289–1301) — `_cleanupListeners` ถูกเรียกเฉพาะเมื่อ paint() เคลียร์ใน container เดิม แต่ `#pageContainer` remount ต่อหน้า (`key={currentPage}`)
- **อาการ:** ทุกครั้งที่เปิดหน้าที่มี overlay จะทิ้ง document-level `pointerdown`/`keydown` ค้างพร้อม DOM เก่า (คนละจุดกับบั๊ก duplicate ที่แก้แล้ว)
- **วิธีแก้ (registry ต่อ container):** module-level `Map<Element, () => void>` ใน translationOverlay — ก่อน attach ใหม่ ให้เรียก cleanup ของ entry ที่ element **ไม่ isConnected แล้ว** และลบออกจาก map; paint ของ container เดิมยังเรียก cleanup ตัวเองตามปกติ → listener คงอยู่เท่าจำนวน overlay ที่มองเห็นจริง
- **ตรวจรับ:** จำลอง apply 2 หน้า + ลบ container หน้าเก่า (remove()) → apply หน้าใหม่ ต้องเหลือ document listeners ชุดเดียว

### R2.2 chrome-extension ยังใส่ key ใน URL
- **ที่:** `chrome-extension/background.js:148`
- `- [x]` เปลี่ยน `?key=` → header `x-goog-api-key` (one-liner เดียวกับที่ทำฝั่ง server ใน Phase 2.2)

### R2.3 npm audit (build-time chain)
- `- [x]` รัน `npm audit fix` (ไม่ใช้ --force) เคลียร์ brace-expansion / js-yaml; เหลือ `serialize-javascript` ผ่าน next-pwa ซึ่งต้อง downgrade next-pwa — พิจารณาเฉพาะถ้ายอมรับ (build-time only)
- **ตรวจรับ:** `npm audit` เหลือเฉพาะข้อที่ตั้งใจข้าม + เทสผ่าน

### R2.4 บันทึกไว้: Docker เสียจาก bind fix (เมื่อไรจะใช้ Docker ค่อยแก้)
- `Dockerfile` รัน `npm start` ซึ่งตอนนี้ bind `127.0.0.1` ใน container → port mapping ไม่ทำงาน + `ocr-service/Dockerfile:22` CMD ยังผิด (`app.main:app` → ต้องเป็น `app.api:app`)
- `- [x]` (เลื่อนได้) แก้ CMD: frontend `["npx", "next", "start", "-H", "0.0.0.0"]` + backend `app.api:app` — ทำพร้อมกันทั้งคู่ตอนจะกลับมาใช้ Docker จริง

---

## Phase R3 — Low / สุขอนามัย (ทำเป็นชุดเดียวจบ ⭐)

- `- [x]` **R3.1** ข้อความ "⏹ กำลังยกเลิก..." ไม่เคยเคลียร์ (`useTranslation.ts` batch early-return ~1249 ข้าม setTimeout reset) — เคลียร์ใน finally หรือตั้ง timeout
- `- [x]` **R3.2** export re-render ใน `getExportDataUrl` (`page.tsx` ~629) ไม่ `markPageDirty` — ให้สอดคล้องกับ renderAndCacheTranslation (สำคัญขึ้นหลังแก้ R1.2)
- `- [x]` **R3.3** Find & Replace ตีความ `$&`/`$1` ในข้อความค้นหา (`page.tsx:502`) — เปลี่ยน `text.replace(regex, replace)` เป็น `text.replace(regex, () => replace)`
- `- [x]` **R3.4** retry-mask upload ไม่มี pixel guard (`ocr-service/app/api.py` retry_region) — ส่ง `max_pixels` เหมือน create_job
- `- [x]` **R3.5** sweep ยังรันบน event loop (`api.py` create_job → submit → _maybe_sweep + lifespan) — ห่อ `asyncio.to_thread`
- `- [x]` **R3.6** `delete_job` rmtree นอก lock → ให้ rmtree ภายใต้ `job.lock` กันแย่งกับ `_run_retry` ที่อ่าน parent assets
- `- [x]` **R3.7** `settings.job_timeout_minutes` `gt=0` ห้ามปิด watchdog แต่ JobStore รองรับ `<=0` — คลายเป็น `ge=0` + document ว่า 0 = ปิด
- `- [x]` **R3.8** `lib/export/saveLocation.ts` localStorage ไม่มี try/catch (cookies blocked → throw) — ครอบด้วย try/catch คืน false
- `- [x]` **R3.9** CI: ลบ `--ignore=tests/test_api.py` ออกจาก `.github/workflows/ci.yml:37` (ชุดเทส hermetic แล้ว — ทำให้เทส purge/delete/pixel-guard รันใน CI จริง)
- `- [x]` **R3.10** เพิ่มเทส watchdog: timeout → FAILED + ไม่มี result.json (ครอบ R1.3 ด้วย)
- `- [x]` **R3.11** (info) duplicate bubble ยังไม่ persist ข้ามหน้า (`translationOverlay.ts:1190` push เข้า paint-local `real` เท่านั้น) — ถ้าจะแก้ ให้ sync clone กลับเข้า bubbleCache ผ่าน callback

---

## สิ่งที่ตรวจแล้ว — ไม่ใช่บั๊ก (บันทึกไว้กัน re-litigate)

- `performSaveRef` indirection ถูกต้อง ไม่มี loop/stale closure
- StrictMode double-mount ปลอดภัยกับ effect ใหม่ทุกตัว (thumbnail/cleanup/abort)
- sweep ไม่มี race กับ job ที่กำลังเขียนบน Windows จริง (temp dir นำหน้า `.`, mtime สด, `replace` atomic)
- `tlContainer` appendChild ซ้ำเป็นการย้าย node ไม่ใช่ stack
- LRU `has`+`get` ใน `getExportDataUrl` refresh recency ถูกต้อง
- pixel guard ใช้ lazy header check ก่อน decode — ถูกต้องสำหรับ PNG/JPEG/WEBP

## ของที่ยังเปิดตาม de-scope (สถานะเดิม ไม่เสื่อมสภาพ)

keydown ยิงข้าม modal • focus trap ไม่ wrap • O(n²) preload • `viewMode` hardcode "single" • rate limiter dead code (bind 127.0.0.1 เป็น mitigation) • heuristic scaling รอ benchmark ภาพ hi-res

## เกณฑ์ตรวจรับรวม (ท้ายแต่ละ Phase)

1. `npx tsc --noEmit` (0 errors) + `npm test` ผ่าน 100% + `npm run lint` เท่า baseline
2. `cd ocr-service && venv/Scripts/python.exe -m pytest tests -q -m "not model"` ผ่าน (รวมเทส watchdog ใหม่)
3. Manual: translate เล่ม >40 หน้า → ปิดเบราว์เซอร์ → เปิดใหม่ restore → ภาพแปลต้องครบทุกหน้า (ครอบ R1.2)
