# แผนงานแก้ไขรอบที่ 3 (Round-3 Review Plan) — หลัง re-review fix + push

- **วันที่รีวิว:** 2026-09-07 (รีวิวซ้ำ commit `3329143` — fresh eyes 3 ด้าน + ตรวจ CI บน GitHub จริง)
- **ผลการตรวจรับรอบที่แล้ว:** ✅ fix รอบที่ 2 (R1–R3) **ลงจริงและถูกต้องทั้งหมด** — ไม่มีบั๊กใหม่ระดับ HIGH; secrets สแกน pattern ทั้ง history ศูนย์ hit
- **การค้นพบสำคัญสุดของรอบนี้:** 🔴 **CI บน GitHub แดง** — `npm run lint` exit 1 จาก 6 errors ที่**มีอยู่ก่อนการรีวิวทั้งสองรอบ** (ยืนยันแล้วว่าไม่มีบรรทัดไหนโดน commit `45ec59d`/`3329143` แตะ) — Backend job ✓ ผ่าน (รวม test_api.py ที่เพิ่งเปิด)
- **วิธีใช้:** ทำตาม Phase C1 → C2 → C3 ติ๊ก `- [ ]` เมื่อเสร็จ

---

## สรุปผู้บริหาร

งานรอบที่แล้วแน่นขึ้นทั้งด้าน persistence และ backend (agent ยืนยัน watchdog transition เป็น atomic, ไม่มี deadlock, เทส CI-portable) — จุดเปิดที่เหลือคือ **CI แดงจาก lint errors เดิม** (ต้องแก้เพื่อให้ทุก commit ถัดไปมีสัญญาณสุขภาพจริง) และ **residual ของ dirty-save/LRU อีก 3 จุด** ที่เล็กกว่ารอบที่แล้วแต่ยังสร้างกรณี "ภาพหาย/สถานะเพี้ยน" ได้ในเล่มยาว

---

## Phase C1 — ทำให้ CI เขียว (แก้ 6 lint errors เดิม) ⭐⭐⭐

### C1.1 `hooks/usePageZoom.ts:54` — อ่าน ref ใน useState initializer
- **ที่:** `useState(() => ({ width: containerRef.current?.clientWidth || 800, ... }))`
- **วิธีแก้:** เริ่มด้วยค่าคงที่ `{ width: 800, height: 1000 }` แล้วให้ ResizeObserver effect ที่มีอยู่ set ขนาดจริงทันทีในรอบแรก (observer callback ยิงทันทีที่ observe)
- **ตรวจรับ:** lint error หาย + zoom fit ยังถูกต้องตอน mount

### C1.2 `hooks/useTranslation.ts:311,317` — เขียน ref ระหว่าง render
- **ที่:** `pagesRef.current = pages;` และ `currentPageRef.current = currentPage;`
- **วิธีแก้:** ย้ายเข้า `useEffect` (ทำแบบเดียวกับ `pageNamesRef` ที่แก้ไปแล้ว — ทั้งสอง ref ถูกอ่านเฉพาะใน callback/async จึงปลอดภัยกับ 1-render lag)
- **ตรวจรับ:** lint หาย + เทส batch/abort ผ่าน (refs ถูกใช้หลัง commit เสมอ)

### C1.3 `hooks/useTranslation.ts:400` — setState-in-effect ของ autosave
- **ที่:** effect ตั้ง debounce เรียก `setSaveStatus("saving")` ก่อน timer
- **วิธีแก้:** ลบ `setSaveStatus("saving")` ออกจาก effect — `performSave` ตั้ง "saving" เองตอนเริ่มทำงานจริง (ระหว่าง debounce ≤1 วิ สถานะคงสถานะเดิม ซึ่งสื่อสารถูกต้องกว่า)
- **ตรวจรับ:** lint หาย + ปุ่ม "ลองใหม่"/badge ยังทำงานถูก

### C1.4 `src/app/page.tsx:78` — setState-in-effect ของ focus mode
- **ที่:** effect reset `setIsFocusToolbarVisible(false)` เมื่อ `isFocusMode` เปลี่ยน
- **วิธีแก้:** ใช้ documented "adjust state during render" pattern:
  ```ts
  const [prevFocusMode, setPrevFocusMode] = useState(isFocusMode);
  if (prevFocusMode !== isFocusMode) {
    setPrevFocusMode(isFocusMode);
    if (isFocusMode) setIsFocusToolbarVisible(false);
  }
  ```
- **ตรวจรับ:** เข้า/ออก focus mode แล้ว toolbar ซ่อนตามเดิม

### C1.5 `tests/cleaning/projectStore.test.ts:106` — `any`
- **วิธีแก้:** แทน type ที่เหมาะสม (เช่น `StoredAsset` หรือ `{ blob?: unknown; mimeType?: string }`)
- **ตรวจรับ:** `npx eslint .` = **0 errors** → commit + push แล้ว CI job Frontend เขียว

---

## Phase C2 — Residual จากรอบที่แล้ว (⭐⭐)

### C2.1 Dirty-race ส่วนที่เหลือ — snapshot เป็นสำเนา + แยก pending marks
- **ที่:** `hooks/useTranslation.ts` `performSave` (~341) + `markPageDirty` (~255)
- **สิ่งที่ยังโหล่:** (ก) partial-save ใช้ snapshot แบบ alias (Set เดียวกัน) → หน้าที่ re-dirty ระหว่าง commit โดน filter ทิ้ง (ข) full-save ระหว่าง commit window `markPageDirty` เป็น no-op และ success reset เป็น `new Set()` → หน้าที่ mutate ระหว่างนั้นหาย
- **วิธีแก้ (รวมทั้งสองกรณี):** ตอนเริ่ม save — snapshot เป็นสำเนา + reassign ทันที:
  ```ts
  const dirtySnapshot = dirtyPagesRef.current ? new Set(dirtyPagesRef.current) : null;
  dirtyPagesRef.current = new Set(); // pending ต่อจากนี้ = เฉพาะ mark ระหว่าง save
  await saveProjectSession(..., { dirtyPageUrls: dirtySnapshot ?? undefined });
  // สำเร็จ: คง dirtyPagesRef.current ไว้ตามเดิม (มีเฉพาะ mark ระหว่าง save)
  // ล้มเหลว: merge กลับ dirtyPagesRef.current = new Set([...current, ...(dirtySnapshot ?? [])])
  ```
- **ตรวจรับ:** ขยายเทสเคส mark-dirty-mid-save ให้ครอบทั้ง partial และ full save

### C2.2 Restore เล่มยาว >40 หน้า — memory + สถานะแยกกัน
- **ที่:** `hooks/useTranslation.ts` `restoreSavedSession` (~421) + `lib/projectStore.ts` `loadProjectSession`
- **อาการ:** restore แปลง asset ทุกหน้าเป็น data URL + `translatedImages` state ถือเต็ม (memory) ขณะ LRU มี 40 → หน้าเกิน 40: `hasCurrentTranslation` เด้ง false หลัง state snap กลับ แต่ `completedPagesRef` ทำให้ translate-all skip → ผู้ใช้แก้ไม่ได้ตรงๆ
- **วิธีแก้ 2 ชั้น:**
  1. `translatedImages` state สร้างจาก LRU หลัง refill (align กับ memory cap) แทน full map
  2. **On-demand re-render:** ใน effect ตอนสลับหน้า — ถ้า `completedPagesRef.current.has(key)` แต่ไม่มีภาพใน LRU → เรียก `renderAndCacheTranslation` เบื้องหลัง (มี bubbles อยู่แล้ว ไม่เสียโควต้า API) → หน้านั้นกลับมา "แปลแล้ว" ภายในไม่กี่ร้อย ms
- **ตรวจรับ:** restore เล่ม 60 หน้า → เลื่อนดูหน้า 1–60 ทุกหน้าต้องกลับมาแสดงสถานะแปลแล้ว; memory ภาพใน state ≤ cap

### C2.3 Export path listener leak — บรรทัดเดียว
- **ที่:** `lib/translationOverlay.ts` (~1329) — `overlayCleanups.set(container, ...)` ทับตัวเกาโดยไม่ invoke
- **วิธีแก้:** `overlayCleanups.get(container)?.();` ก่อน set (removeEventListener ซ้ำเป็น no-op) + `page.tsx:615` เปลี่ยน `el.remove()` เป็นเรียก `_cleanupListeners` ก่อนลบ
- **ตรวจรับ:** export เล่ม 10 หน้า → document listeners ไม่เพิ่ม (จับด้วย spy addEventListener ในเทส overlay ได้)

---

## Phase C3 — Low / ปรับแต่ง (⭐)

- `- [ ]` **C3.1** Overlay mutation mark dirty แต่ไม่ schedule autosave — ย้าย `setCacheRevision((r) => r + 1)` เข้าไปใน `markPageDirty` เอง (ทุก caller ได้ debounce save อัตโนมัติ; เทส: edit ข้อความใน bubble → รอ debounce → saveProjectSession ถูกเรียก)
- `- [ ]` **C3.2** PWA cache `/api/*` GET (next-pwa default NetworkFirst ไม่สน `no-store`) — ใน `next.config.ts` ใช้ `extendDefaultRuntimeCaching` + NetworkOnly สำหรับ `/api/`
- `- [ ]` **C3.3** Sweep/purge ลบ dir ของ parent ที่ retry กำลังอ่าน (`jobs.py` sweep_completed) — skip dir ที่ถูกอ้างโดย `parent_id` ของ QUEUED/RUNNING retry jobs
- `- [ ]` **C3.4** สร้าง `.env.example` (มี whitelist ใน .dockerignore ไว้แล้ว แต่ไฟล์ไม่มี) — ระบุ `GEMINI_API_KEY`, `SUPERK_TRANSLATE_*`, `SUPERK_CLEANER_URL`, `SUPERK_*` ที่เกี่ยว พร้อม comment
- `- [ ]` **C3.5** `retry_region` เรียก `_job_or_404` ซ้ำ 2 ครั้ง (`api.py:159,169`) — เหลือครั้งเดียว
- `- [ ]` **C3.6** ลบ demo/comparison PNGs ~13 ไฟล์ใน `public/` (`cleaned_user_page_verified.png`, `live_*.png`, `*_comparison.png`) — ตรวจก่อนว่าไม่มีโค้ด/เอกสารอ้างอิง

---

## ของที่ยืนยันแล้วว่าไม่ใช่บั๊ก (รอบ 3)

- Watchdog transition ภายใต้ `job.lock` เดียว — atomic, ไม่มี in-process resurrection
- `to_thread` submit — registration เกิดก่อน response 202 เสมอ
- Temp dir ของ `_write_assets` — ไม่มี orphan ในกรณี watchdog (จบด้วย replace/rmtree + construction cleanup)
- เทส watchdog ผ่านเกณฑ์ determinism สำหรับ CI (Event-blocked pipeline, shutdown-join)
- Union-GC ↔ restore interplay ถูกต้องในระดับดิสก์ (ปัญหาที่เหลือเป็น memory/state ฝั่ง hook — C2.2)

## ของที่ยังเปิดตาม de-scope (สถานะเดิม)

keydown ข้าม modal • focus trap wrap • O(n²) preload • `viewMode` single • rate limiter dead code • serialize-javascript (build-time, ยอมรับ) • heuristic scaling (รอ benchmark)

## เกณฑ์ตรวจรับรวม

1. `npx tsc --noEmit` 0 errors + `npm test` ผ่าน 100% + `npx eslint .` **0 errors**
2. `cd ocr-service && venv/Scripts/python.exe -m pytest tests -q -m "not model"` ผ่าน + ruff ผ่าน
3. `git push` แล้ว CI ทั้งสอง job บน GitHub ต้อง **เขียวทั้งคู่** (ตรวจด้วย `gh run list`)
4. Manual: แก้ข้อความใน bubble → ปิดแท็บทันที → เปิดใหม่ restore ต้องได้ข้อความที่แก้ (ครอบ C3.1)
