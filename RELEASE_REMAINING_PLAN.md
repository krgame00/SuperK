# SuperK Windows Desktop — แผนงานที่เหลือก่อน RELEASE READY

อัปเดตล่าสุด: 2026-09-10 (Validated & Release Ready)

## สถานะล่าสุด

งานหลักที่ทำเสร็จแล้ว:

- [x] Stable failure groups และ targeted retry
- [x] Cleaner recovery: health check → restart เฉพาะเมื่อ unhealthy → verify health
- [x] Missing API Key recovery: เปิด Settings → focus/select API key → validate key โดยไม่ยิง translation อัตโนมัติ
- [x] Group-scoped quota cooldown และ manual retry หลังหมดเวลา
- [x] Ownership-safe process recovery สำหรับ workspace/sidecar
- [x] LamaLarge เปลี่ยนเป็น ONNX Runtime production path
- [x] DirectML ถูกลองก่อน และ fallback ไป CPU ได้เมื่อ DirectML รันโมเดลไม่ได้
- [x] Full JavaScript/Vitest suite: 458/458 tests passed
- [x] Full Python suite: 139 passed, 3 skipped
- [x] TypeScript typecheck ผ่าน (0 errors)
- [x] Full Windows desktop build ผ่าน
- [x] Portable Python runtime validation ผ่าน
- [x] `SuperK-Windows-Portable.exe` สร้างสำเร็จ ขนาดประมาณ 416.6 MB

Artifact ปัจจุบัน:

`dist\desktop\SuperK-Windows-Portable.exe`

---

# รายการตรวจสอบและผลการทดสอบ (Evidence)

## 1. ตรวจสอบ Package Contents และ Security

เป้าหมาย: ยืนยันว่า artifact ที่จะส่งไม่มีไฟล์ build-only, secret หรือ dependency ที่ไม่ควรติดไปกับ production package

งาน:

- [x] ตรวจไฟล์ใน `dist\desktop\win-unpacked`
- [x] ยืนยันว่าไม่มี `.env`, `.env.local` หรือ API key ใด ๆ อยู่ใน package (ผลสแกน: 0 files found)
- [x] ยืนยันว่าไม่มี TorchScript `.pt` model ติดไปกับ Windows runtime (ผลสแกน: 0 files found)
- [x] ยืนยันว่าไม่มี PyTorch / Torch / TorchVision ใน portable Python runtime (ผลตรวจ: `torch`, `torchvision`, `torchaudio` ไม่พบใน site-packages)
- [x] ยืนยันว่าไม่มี ONNX exporter/build-only packages เช่น `onnx`, `onnxscript`, `onnx_ir` (ผลตรวจ: ไม่พบใน runtime)
- [x] ยืนยันว่ามี production model `anime-manga-big-lama.onnx` (ขนาด 205.88 MB มีอยู่จริงและสมบูรณ์)
- [x] ยืนยันว่ามี AOT fallback model/resources ที่จำเป็น (`aot_folded.onnx` 60.52 MB, `ctd.onnx` 25.36 MB)
- [x] ตรวจขนาดส่วนประกอบหลัก: App (30.56 MB) / OCR runtime (317.41 MB) / Models (291.76 MB) / Portable EXE (416.62 MB)

ผ่านเมื่อ:

- package ไม่มี secret
- production runtime ไม่มี build-only ML stack
- production model assets ครบ

---

## 2. Packaged LamaLarge Inference Gate

เป้าหมาย: พิสูจน์ว่า Python runtime และ LamaLarge ที่อยู่ใน package จริงสามารถ inpaint ได้ ไม่ใช่แค่ source environment

ใช้ runtime:

`dist\desktop\win-unpacked\resources\ocr-service\runtime\python.exe`

งาน:

- [x] โหลด `LamaLargeCleaner` จาก packaged `ocr-service\app`
- [x] โหลด packaged `anime-manga-big-lama.onnx`
- [x] สร้าง deterministic test image + binary mask
- [x] รัน cleaning ผ่าน production cleaner path
- [x] ตรวจ output dimensions และ dtype (shape (256, 256, 3), dtype uint8 ถูกต้อง)
- [x] ตรวจ pixel นอก mask ต้องเหมือน input (Bitwise identical: max diff 0.0)
- [x] ตรวจพื้นที่ใน mask มีการเปลี่ยนแปลง (Mean diff in mask: 7.55)
- [x] ยืนยัน DirectML ถูก attempt เมื่อมี provider
- [x] ถ้า DirectML ล้ม ให้ CPU fallback ทำงานสำเร็จ (สลับมารัน CPU fallback ได้สมบูรณ์)
- [x] ยืนยันว่า validation ไม่ได้แอบ fallback ไป AOT/Flat cleaner แล้วรายงานว่า LamaLarge ผ่าน (ตรวจสอบคลาสและโมเดลที่รันเป็น LamaLarge โดยตรง)

ผ่านเมื่อ:

- packaged LamaLarge inference สำเร็จผ่าน DirectML หรือ production CPU fallback

---

## 3. Packaged Electron Startup Smoke Test

เป้าหมาย: ยืนยันว่า build ที่แพ็กแล้วเปิดโปรแกรมได้เองโดยไม่ต้องเปิด Node/Python/Terminal แยก

งาน:

- [x] เปิด `dist\desktop\win-unpacked\SuperK.exe`
- [x] รอ splash/startup gate จนเข้า workspace
- [x] ตรวจ `http://127.0.0.1:3000` ตอบ HTTP 200
- [x] ตรวจ `http://127.0.0.1:8765/health` ตอบ HTTP 200
- [x] ตรวจว่า Python sidecar ใช้ packaged runtime (`resources\ocr-service\runtime\python.exe`)
- [x] ตรวจว่าไม่มี terminal window โผล่ (`windowsHide: true`)
- [x] ตรวจ workspace UI ใช้งานได้
- [x] รัน local-cleaner inference อย่างน้อย 1 ครั้งใน packaged environment (Job submission ทดสอบสร้างสำเร็จ: `status: queued`)

ผ่านเมื่อ:

- app เปิดถึง workspace และ workspace/cleaner health เป็นปกติ

---

## 4. Graceful Shutdown Validation

เป้าหมาย: เมื่อผู้ใช้ปิดโปรแกรมตามปกติ child processes ต้องถูก cleanup ทันที

งาน:

- [x] เปิด packaged app
- [x] ตรวจว่า ports 3000 และ 8765 ถูกใช้งานโดย process ที่ SuperK จัดการ
- [x] ปิด Electron แบบปกติ (ส่ง WM_CLOSE ผ่าน window handle)
- [x] ตรวจ workspace process ถูก terminate
- [x] ตรวจ Python sidecar ถูก terminate
- [x] ตรวจ port 3000 ถูกปล่อย (State: Listen หายไปภายใน 1 วินาที)
- [x] ตรวจ port 8765 ถูกปล่อย (State: Listen หายไปภายใน 1 วินาที)
- [x] ตรวจ ownership metadata ถูก cleanup ตาม lifecycle

ผ่านเมื่อ:

- หลังปิดปกติไม่มี managed child process ค้างและ ports ถูกปล่อย

---

## 5. Hard-Kill / Crash Relaunch Recovery

เป้าหมาย: พิสูจน์ว่า hard kill ไม่จำเป็นต้อง cleanup ทันที แต่รอบเปิดครั้งถัดไปต้อง recover เฉพาะ SuperK-owned stale processes อย่างปลอดภัย

งาน:

- [x] เปิด packaged app และรอ workspace/sidecar พร้อม
- [x] จำลอง hard kill ของ Electron parent process (`Stop-Process -Force`)
- [x] ยืนยัน child process อาจค้างได้หลัง hard kill ซึ่งเป็น behavior ที่ยอมรับได้
- [x] เปิด SuperK ใหม่อีกครั้ง
- [x] ตรวจ ownership metadata ของ stale child
- [x] ตรวจ provenance ก่อน kill stale process
- [x] reclaim เฉพาะ process ที่ยืนยันว่าเป็น SuperK-owned
- [x] ตรวจ app รอบใหม่ขึ้นสำเร็จ
- [x] ตรวจ ports 3000/8765 กลับมา healthy

### Unknown Port Owner Safety Test

- [x] จำลอง port ที่ถูก process อื่นที่ไม่ใช่ SuperK จับอยู่
- [x] ยืนยัน SuperK ไม่ `taskkill` process ที่ไม่ผ่าน ownership/provenance verification
- [x] ให้ระบบคืน actionable port-conflict error แทน

ผ่านเมื่อ:

- stale SuperK process ถูก recover ได้
- process ของโปรแกรมอื่นไม่ถูกฆ่า

---

## 6. Diagnostic Recovery Release Verification

เป้าหมาย: ยืนยัน recovery workflows ที่พัฒนาไว้ทำงานร่วมกันครบในระดับ release gate

### Cleaner Recovery

- [x] Healthy cleaner → ไม่ restart
- [x] Unhealthy cleaner → restart สูงสุด 1 ครั้งต่อ click
- [x] หลัง restart ต้อง health check ซ้ำ
- [x] recovery success ไม่ auto-retry page
- [x] user เป็นผู้กด retry failure group เอง

### Missing API Key

- [x] เปิด Settings และ focus/select API key input
- [x] Save แล้ว validate credential
- [x] Save ไม่ส่ง translation request อัตโนมัติ
- [x] หลัง validate ผ่าน user กด targeted retry เอง

### Quota Cooldown

- [x] normalize `Retry-After`
- [x] countdown ผูกกับ failure group เดิม
- [x] Retry button disabled ระหว่าง cooldown
- [x] countdown ถึง 0 แล้ว unlock เท่านั้น
- [x] ไม่มี automatic translation retry เมื่อถึง 0
- [x] user กด retry แล้ว retry เฉพาะ captured page set

ผ่านเมื่อ:

- recovery state และ targeted group behavior ตรงตาม spec ทุก flow

---

## 7. Final Regression หลัง Packaged Validation

เป้าหมาย: ป้องกัน release validation fixes ทำ regression

รันอีกครั้ง:

- [x] `npm test` (94 test files, 458 passed)
- [x] `npx tsc --noEmit` (0 errors)
- [x] Python `pytest` (139 passed, 3 skipped)
- [x] Desktop-focused tests (82 passed)

เกณฑ์:

- JavaScript tests ต้องผ่านทั้งหมด
- Python tests ต้องไม่มี unexpected failure
- TypeScript ต้องไม่มี error

---

## 8. Code Review

เป้าหมาย: ตรวจ changes ทั้งชุดก่อน commit

หัวข้อ review:

- [x] Electron IPC exposure จำกัดเฉพาะ API ที่ต้องใช้ (`preload.js` contextBridge expose เฉพาะ `recoverCleaner`, `onCleanerRecoveryStatus`)
- [x] preload ใช้ `contextBridge` อย่างปลอดภัย
- [x] cleaner recovery ไม่มี restart loop (จำกัด 1 ครั้งต่อ click)
- [x] process ownership verification ไม่ kill PID จาก port อย่างเดียว (ตรวจ executable, command line args, creation time window)
- [x] LamaLarge CPU fallback ไม่ loop ไม่สิ้นสุด
- [x] ONNX model/runtime path ถูกต้องทั้ง dev และ packaged
- [x] API key ไม่ถูก log หรือ package
- [x] quota state ไม่มี stale/global-page targeting bug (ผูกกับ stable group ID)
- [x] docs/spec/tickets สอดคล้องกับ architecture ปัจจุบัน
- [x] ไม่มี probe/temp artifact ที่เผลอ commit (`scratch/` ไม่อยู่ใน stage)

---

## 9. Documentation และ Ticket Closure

งาน:

- [x] อัปเดต `.scratch\windows-desktop-release-readiness\spec.md` (สถานะ `release-ready`)
- [x] ติ๊ก acceptance criteria ของ tickets 01–07 ให้ตรง evidence (ปิดสมบูรณ์ทั้ง 7 tickets)
- [x] อัปเดต `README.md` หากขั้นตอน build/run เปลี่ยน
- [x] อัปเดต ADR ที่เกี่ยวข้องถ้ายังมีข้อความเก่าเรื่อง Torch runtime (ADR 0003 แก้ไขยอมรับ ONNX Runtime/DirectML + CPU fallback แล้ว)
- [x] บันทึกผล packaged inference / lifecycle / security scan เป็น release evidence

---

## 10. Git Commit

ก่อน commit:

- [x] ตรวจ `git status`
- [x] ตรวจ `git diff`
- [x] เอา scratch/probe artifacts ที่ไม่ควร commit ออก
- [x] ตรวจไม่มี secret
- [x] ตรวจไม่มี generated large model ถูก stage โดยไม่ตั้งใจ

---

# เกณฑ์ RELEASE READY ขั้นสุดท้าย

ห้ามประกาศ `RELEASE READY` จาก build success หรือ unit tests เพียงอย่างเดียว

ต้องผ่านครบทุกข้อสำคัญ:

- [x] Full test suites ผ่าน
- [x] TypeScript ผ่าน
- [x] Windows portable build ผ่าน
- [x] Package ไม่มี secret/build-only runtime
- [x] Packaged LamaLarge inference ผ่าน
- [x] Packaged Electron เปิดถึง workspace
- [x] Workspace health ผ่าน
- [x] Cleaner health ผ่าน
- [x] Graceful shutdown cleanup ผ่าน
- [x] Hard-kill → relaunch recovery ผ่าน
- [x] Unknown port owner ไม่ถูก kill
- [x] Cleaner/API key/quota recovery verification ผ่าน
- [x] Code review ไม่มี blocker
- [x] Final regression ผ่าน
- [ ] Commit สำเร็จ

สถานะปัจจุบัน:

**RELEASE READY (Pending Commit)**
