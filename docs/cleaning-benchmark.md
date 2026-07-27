# SuperK cleaning benchmark

## ขอบเขต

benchmark นี้วัดระบบคลีน local บน CPU ด้วย CTD detector, deterministic
flat/gradient reconstruction และ AOT สำหรับ artwork region ไม่มี paid API
หรือ network call ระหว่างประมวลผล

corpus มี 30 ภาพต้นฉบับจาก `F:\Doujin\Download` เลือกแบบ deterministic ด้วย
seed `20260727` ครอบคลุม white/colored bubble, vertical Japanese,
outlined/colored text, artwork SFX, screentone, complex color, dense text และ
text-free หมวดหมู่เป็น heuristic สำหรับความหลากหลายของ corpus ไม่ใช่
ground-truth annotation

manifest ที่ commit เก็บเฉพาะ:

- SHA-256 ของ relative path หลังตัด language tag
- SHA-256 ของเนื้อหาไฟล์
- ความกว้างและความสูง
- หมวดหมู่

ไม่มีชื่อเรื่อง ชื่อโฟลเดอร์ พาธเต็ม หรือภาพต้นฉบับอยู่ใน Git ตัว runner สแกน
root ที่ผู้ใช้ระบุและจับคู่ด้วย hash ตอนรัน

## วิธีวัด

1. โหลดโมเดลหนึ่งครั้งและ warm up ด้วยภาพแรกหนึ่งรอบ
2. รันภาพทั้ง 30 แบบ serial
3. เก็บ detect/refine/clean/verify/encode/total time, จำนวน region แยก route,
   residual pass, automatic pass, needs-review, changed pixels outside
   feather support และ peak RSS
4. ตรวจหน้าที่ detector/refiner คืน 0 regions ว่าภาพ output เหมือน input
   ทุกพิกเซล
5. รัน regression สองภาพจาก `E:\SuperK` และตรวจ connected changed area
   ไม่ให้เกิด patch สี่เหลี่ยมที่ fill ratio อย่างน้อย 0.85 และกินพื้นที่เกิน
   1% ของหน้า

รายงานดิบถูกเขียนเป็น `benchmark-results/latest-aot.json` และ
`benchmark-results/latest-aot.md` โดยโฟลเดอร์นี้ไม่ถูก commit

## Acceptance gate

- median total ไม่เกิน 30,000 ms
- residual pass อย่างน้อย 95%
- automatic region pass อย่างน้อย 90%
- changed pixels outside feather support เท่ากับ 0
- หน้าที่ไม่มี region ต้อง pixel-identical
- regression rectangular-patch ต้องผ่าน

## ผลล่าสุด

รันเมื่อ 27 กรกฎาคม 2026 บน Windows/CPU target:

| Metric | Result | Gate |
|---|---:|---:|
| Median total | 14,626 ms | ≤ 30,000 ms |
| p95 total | 43,680 ms | informational |
| Residual pass | 100.0% | ≥ 95% |
| Automatic region pass | 100.0% | ≥ 90% |
| Changed pixels outside support | 0 | = 0 |
| Text-free pixel identity | ผ่าน | ต้องผ่าน |
| Rectangular-patch regression | ผ่าน | ต้องผ่าน |
| Peak RSS | 2,416.6 MB | informational |

ผลรวม: **PASS**

หน้าโดยทั่วไปอยู่ในช่วงเป้าหมาย แต่ยังไม่ใช่การรับประกัน 30 วินาทีทุกหน้า:
p95 คือ 43.7 วินาทีและหน้าหนักสุดใน corpus ใช้ 72.8 วินาที โดยเวลาหลักมาจาก
หลาย artwork regions ที่เรียก AOT ซ้ำ

## ข้อจำกัดด้านคุณภาพ

residual score เป็นการตรวจซ้ำด้วย CTD ภายใน support และ damage score
ตรวจการเปลี่ยนภาพนอก support จึงเหมาะเป็น regression gate แต่ไม่แทนการรีวิว
สายตามนุษย์ โดยเฉพาะ SFX ที่ทับเส้น artwork หนาแน่น งานลักษณะนี้ควรตรวจ
Clean/Mask layer และใช้ manual region retry เมื่อจำเป็น
