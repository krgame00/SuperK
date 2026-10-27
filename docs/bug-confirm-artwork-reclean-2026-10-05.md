# Bug Report: แปรงลบทับ region ที่ "ยืนยันลายภาพแล้ว" ไม่มีผล (2026-10-05)

## อาการ

หลังกด **"กู้ภาพเดิมทั้งจุด"** ใน MaskEditor (region ถูก mark เป็น human-confirmed-artwork และภาพต้นฉบับกลับมา) ผู้ใช้ระบายแปรง (สีแดง = ลบ) ทับข้อความที่กู้กลับมา แล้วกด **"ใช้กับจุดนี้"** — ผลลัพธ์: **ไม่มีอะไรเปลี่ยนแปลง** ทั้งไม่ลบข้อความ ไม่มี error ไม่มี status แจ้งเตือน (ผู้ใช้รายงานเอง + ผม re-produce ด้วย browser automation ได้ภาพก่อน-หลังเหมือนกันทุกพิกเซล)

## Repro steps (ยืนยันแล้ว 2 คน = ผู้ใช้ + automation)

1. อัปโหลดหน้าที่มีข้อความ → คลีน → เปิด MaskEditor → กด "กู้ภาพเดิมทั้งจุด" (region กลายเป็นยืนยันลายภาพ + ภาพต้นฉบับกลับมา)
2. ปิด MaskEditor → เปิดใหม่ → ระบายแปรง (สีแดง) ทับข้อความที่กู้กลับมา
3. กด "ใช้กับจุดนี้" → รอ → ภาพไม่เปลี่ยน ไม่มี error

## หลักฐานที่เก็บได้ (browser automation, 2026-10-05)

- ภาพก่อน-หลัง "ใช้กับจุดนี้" เหมือนกันทุกพิกเซล (mask strokes ยังแสดง ข้อความยังอยู่)
- status มีเฉพาะ "ข้อความล้นพื้นที่หน้า" ไม่มี error/คำอธิบาย
- RemnantReviewPanel ยังรายงาน "ยืนยันลายภาพแล้ว 1 จุด"

## จุดในโค้ดที่น่าสงสัย (สำหรับ bug-fix session)

1. `components/cleaning/MaskEditor.tsx:1141` — กลไก `confirm-text`: region ที่ยังไม่เคย confirm จะยิง `onRetry(id, blob, cleaner, "confirm-text")` ก่อน ถ้าคืน falsy → **abort เงียบ** (`if (!confirmed) { ... }`) — region ที่กู้ภาพแล้วอาจทำ confirm-text คืนผลแปลก
2. `hooks/useCleaning.ts:1266-1273` — `priorConfirmedRects`: รวม rect ของ candidate ที่ยืนยันไว้ (ยกเว้น region ปัจจุบัน) และที่ `:1420-1424` **auto-confirm ซ้ำหลัง retry** — อาจยืนยัน candidate ใหม่ทับผลลบที่เพิ่งทำ
3. `hooks/useCleaning.ts:1422` — เงื่อนไข `cand.state !== "human-confirmed-artwork" && priorConfirmedRects.includes(rectKey)` → confirm ทับ — ถ้า candidate ของ region นี้ยังถือสถานะ confirmed จากรอบกู้ภาพ ผลลบใหม่อาจถูก mark ทับเป็น artwork อีกครั้ง
4. สมมติฐานหลัก: หลัง "กู้ภาพเดิมทั้งจุด" ระบบ confirm candidate เป็น artwork → การลบครั้งใหม่ผู้ใช้**ตั้งใจ**ลบ แต่มี state ใดสันนิษฐานว่า "ผู้ใช้ยืนยันไว้แล้ว" จึง block/skip โดยไม่แจ้ง

## ทิศทางแก้ (เสนอ)

ผู้ใช้ระบาย mask ใหม่ทับ confirmed artwork **คือการอนุญาตใหม่ที่ชัดเจน** — flow คลีนเฉพาะจุดควร (a) ล้างสถานะ confirmed ของ candidate ในบริเวณ mask ใหม่ก่อนส่ง และ (b) ถ้าผลลัพธ์ไม่เปลี่ยน ต้องแจ้งสถานะให้ผู้ใช้ทราบ ห้ามเงียบ

## ข้อจำกัดของการสอบสวนรอบนี้

ยังไม่ได้ trace network request/response จริงของ "ใช้กับจุดนี้" (ต้องเปิด DevTools ตอนกด) และยังไม่ได้ตรวจฝั่ง ocr-service ว่ารับ mask แล้วปฏิเสธหรือไม่ — เหมาะเปิดเป็น bug-fix session เฉพาะ (Bug fix playbook: reproduce → trace → fix with runtime evidence)
