# แผนย้อนกลับ 4 ชุดงานและคืนเส้นทางแปลเดิม

วันที่: 16 กันยายน 2026  
สถานะ: แผนงานเท่านั้น — ยังไม่ได้ย้อนโค้ด

## เป้าหมายและขอบเขต

คืนพฤติกรรมก่อนเปลี่ยนทั้ง 4 ชุด ได้แก่ pairing/settings, publication sync, translation timeout และ resource lifecycle โดยให้การนำเข้า คลีน แปล แก้ไข บันทึก และ export กลับมาทำงานร่วมกันได้ เก็บงานอื่นที่ไม่เกี่ยวข้องไว้ เช่น การจับสี ขอบข้อความ MaskEditor และการแก้ Docker จากการรีวิวรอบแรก

การคืนเส้นทางเลือกโมเดลเดิมเป็นงานประกอบเพื่อให้ตรงกับคำขอเริ่มต้นที่ต้องการกลับไปใช้ระบบแปลเดิม ต้องระบุแยกจาก timeout เพราะ dynamic model routing มีอยู่ก่อนแผน 4 ชุด การย้อนเฉพาะ 4 ชุดไม่ทำให้ลำดับเลือกโมเดลกลับเอง

ภาพข้อผิดพลาดแสดง `promptFeedback.blockReason = OTHER` ยังไม่พิสูจน์ว่าทั้ง 4 ชุดเป็นต้นเหตุ และไม่ยืนยันว่าเป็นเนื้อหา 18+ การย้อนโค้ดถือเป็นการคืนพฤติกรรม ไม่ใช่หลักฐานว่า provider จะยอมแปลทั้ง 9 หน้า ห้ามประกาศว่าแก้สำเร็จจาก unit tests เพียงอย่างเดียว

## 0. เก็บสถานะก่อนลงมือ

- [ ] สำรอง tracked diff, staged diff และไฟล์ untracked ที่เกี่ยวข้อง รวมไฟล์ทดสอบ ไม่ใช้ patch อย่างเดียวแทนการสำรองไฟล์ใหม่
- [ ] เก็บรายการไฟล์และ checksum ของ snapshot ก่อนย้อน เพื่อคืนสภาพปัจจุบันได้
- [ ] บันทึก configuration เฉพาะชื่อค่าที่มีผล: model preference, preview flag, provider/base URL, timeout และแหล่ง key โดยไม่คัดลอกคีย์ลงรายงานหรือ Git
- [ ] เก็บผล baseline ของ type-check และ tests พร้อมผลแปลตัวอย่างที่ผู้ใช้ระบุ เก็บ model จริงและ error code แบบตัดข้อมูลลับออก
- [ ] ใช้ HEAD `d1f7d8274b79ecfb8ff1f47599a2161711e88a86` เป็นแหล่งเปรียบเทียบเท่านั้น ไม่ถือว่าเป็น snapshot ก่อนเริ่มทั้ง 4 ชุดโดยอัตโนมัติ
- [ ] ใช้ไฟล์ใน `scratch/translation-rollback-backup/` เป็นข้อมูลประกอบ: สำรองเฉพาะ image/text API route หลังมีการเปลี่ยนแล้ว ไม่ใช่ backup ทั้งระบบและไม่ใช่เวอร์ชันเดิมที่พิสูจน์ว่าแปลผ่าน
- [ ] ย้อนเป็นรายส่วนของไฟล์ ห้ามใช้ `git reset --hard`, `git clean` หรือ restore ทั้ง working tree เพราะมีงานอื่นปะปนอยู่

**ผ่านเมื่อ:** มี backup ที่คืนได้จริง และมีรายการชัดเจนว่าแต่ละส่วนจะย้อนจากอะไรไปอะไร ไม่ต้องขออนุมัติซ้ำสำหรับการย้อนในขอบเขตที่ผู้ใช้เลือกแล้ว หากหา baseline ไม่พบให้เก็บไฟล์นั้นไว้และระบุสิ่งที่ขาด แทนการเดาลบงาน

## 1. รักษางานปัจจุบันและย้อน resource lifecycle ก่อน

เหตุผล: การเปลี่ยนจาก Data URL เป็น Blob URL กระทบความคงอยู่ของต้นฉบับ และ cache ใหม่อาจคืนภาพคนละ revision การสลับโค้ดก่อนช่วยเก็บต้นฉบับอาจทำให้กู้ไม่ได้

ไฟล์หลัก:

- `src/app/page.tsx`
- `hooks/useTranslation.ts`, `hooks/useCleaning.ts`
- `lib/projectStore.ts`
- `lib/lifecycle/pageBlobStore.ts`
- `lib/lifecycle/workspaceResourceManager.ts`
- `lib/lifecycle/sessionSpillCache.ts`, `resourceBudget.ts`, `pageLifecycle.ts`

งาน:

- [ ] ก่อน reload/restart ให้สำรอง source Blob ที่ยังเปิดอ่านได้เป็นข้อมูลถาวรหรือไฟล์ พร้อมชื่อหน้า ลำดับหน้า bubbles และงานแก้ไข
- [ ] ถ้า Blob URL หมดอายุและไม่มีต้นฉบับถาวร ให้ระบุหน้าที่ต้องนำเข้าต้นฉบับใหม่ ห้ามถือว่า URL string คือข้อมูลภาพที่กู้คืนได้
- [ ] คืนการนำเข้า image/ZIP/CBZ/PDF เป็น Data URL ตามเส้นทางเดิม
- [ ] ถอดการเรียก resource manager จาก navigation, cleaning, export และ page removal พร้อมคืนเจ้าของ cache ให้ hook เดิม
- [ ] ตัดเส้นทาง `restoreRenderedImage(..., "default")` ออกจาก export เพื่อไม่คืนภาพเก่าข้าม revision
- [ ] คงการ invalidate ภาพเรนเดอร์เก่าที่แก้ใน `saveProjectSession()` จากรอบแรก เพราะไม่ใช่งานเพิ่มใน 4 ชุดและป้องกัน export ผิดภาพ
- [ ] คืนหรือถอด lifecycle modules/tests เฉพาะที่ไม่มี consumer แล้ว ไม่ลบไฟล์อื่นเพียงเพราะอยู่ใน directory เดียวกัน
- [ ] เก็บการแก้ Electron close/tray และ Python model idle ที่มีมาก่อน 4 ชุด เว้นแต่หลักฐาน diff ยืนยันว่าเป็นส่วนที่เพิ่มในชุดนี้

เกณฑ์ผ่าน:

1. นำเข้า → autosave → ปิดและเปิดใหม่ ยังเห็นต้นฉบับทุกหน้าและข้อความที่แก้
2. แก้ข้อความหน้า A → ไปหน้า B → export ทั้งเล่ม ได้ข้อความล่าสุดของ A
3. เรียงหน้า/ลบหน้าแล้ว cache ไม่ข้ามไปใช้ผลของอีกหน้า
4. ทดสอบทั้ง session เดิมที่ใช้ Data URL และ session ที่ย้ายจาก Blob URL

ข้อแลกเปลี่ยนที่ยอมรับ: การใช้ RAM กลับไปตามแนวทางเดิม ยังไม่อ้างว่าหน่วยความจำมี plateau หรือผ่านเป้าหมาย ADR 0013

## 2. ย้อน pairing/settings ให้ใช้งานแบบเดิม

ไฟล์หลัก:

- `lib/server/pairing.ts`, `src/app/api/extension/pair/route.ts`
- `src/app/api/extension/settings/route.ts`
- `src/app/page.tsx`, `components/workspace/SettingsModal.tsx`
- `chrome-extension/popup.html`, `popup.js`, `server.js`, `background.js`
- tests ของ settings bridge/security และ extension settings sync

งาน:

- [ ] ถอดขั้นตอนขอ token, ช่องกรอก/คัดลอก token และเงื่อนไขรอ token ก่อนซิงก์ settings
- [ ] คืน contract การอ่านและอัปเดต settings ที่ workspace และ extension ใช้ได้โดยไม่ต้องจับคู่
- [ ] คงการปกปิด secret ใน response ไม่คืนบั๊กที่เผย server key เป็นผลข้างเคียงของ rollback
- [ ] ตรวจเส้นทาง key ให้ครบ: server mode ใช้ key ฝั่ง server; direct mode ใช้ key ที่ผู้ใช้ตั้งใน extension; หาก workspace ส่ง user key เข้า server ต้องพิสูจน์ว่า translation route ใช้ key นั้นได้โดยไม่ต้องส่งกลับผ่าน settings
- [ ] คง cache settings ที่แยกตาม server URL ซึ่งแก้ก่อนแผน 4 ชุด
- [ ] ถอดไฟล์ pairing หลังไม่มี import/caller เหลือแล้วเท่านั้น
- [ ] สำหรับโหมดเดิมที่ไม่มี pairing ให้จำกัดบริการที่ไม่มี authentication ไว้บน loopback; หากใช้งานผ่าน Docker ให้ publish port บน `127.0.0.1` และคง internal service URL ของ cleaner

เกณฑ์ผ่าน:

1. Workspace และ extension อ่าน/เปลี่ยน settings ได้โดยไม่ต้องใส่ token
2. แปลได้ทั้งกรณี server key และ user-provided key โดยไม่สลับเจ้าของ key โดยไม่ตั้งใจ
3. GET/POST settings ไม่มี secret ใน response และไม่ส่ง key ของ server A ไป server B

## 3. ย้อน publication sync

ไฟล์หลัก:

- `chrome-extension/background.js`
- `src/app/api/extension/publish-back/route.ts`
- `tests/extension/publishBackResilience.test.ts` และ tests ที่เกี่ยวข้อง

งาน:

- [ ] คืนกลไก cursor แบบก่อนเพิ่ม epoch และ persistent per-server cursor
- [ ] ถอด epoch negotiation และการโหลด/บันทึก cursor ที่เพิ่มในชุดนี้ทั้ง client/server ให้เสร็จพร้อมกัน
- [ ] คงการ sort publication ตาม sequence จากการแก้รอบแรก
- [ ] คงการแปลง clean Blob เป็นเนื้อภาพที่ส่งข้ามบริบทได้จากการแก้รอบแรก
- [ ] เลิกอ่าน cursor schema ใหม่; หากต้องล้างให้ล้างเฉพาะ key ของ cursor ห้าม clear extension storage ทั้งหมด
- [ ] ระบุพฤติกรรม reset ที่รองรับในโหมดเดิม: หลัง restart/เปลี่ยน server ต้องเริ่ม cursor ใหม่ หากยังมีข้อจำกัดให้บันทึกตรง ๆ และอย่าอ้างว่าแก้ resilience ครบ

เกณฑ์ผ่าน: ส่ง A → B → A แล้วทั้งสองหน้าอัปเดตครบ ภาพคลีนแสดงถูกต้อง และหลัง reset cursor สามารถรับ publication ของ server รอบใหม่ได้

## 4. ย้อน timeout และคืนเส้นทางเลือกโมเดลเดิม

ไฟล์หลัก:

- `src/app/api/translate/route.ts`, `src/app/api/translate-text/route.ts`
- `lib/server/geminiRequest.ts`, `lib/server/geminiTranslationRouter.ts`, `lib/server/geminiCatalog.ts`
- `hooks/useTranslation.ts`, `components/workspace/SettingsModal.tsx`
- `chrome-extension/server.js`, `background.js`, `popup.js`
- tests ของ routes, dynamic routing, model catalog และ timeout

งาน:

- [ ] ทำแผนผังเส้นทาง image/text/crop/batch และ extension server/direct ก่อนย้อน เพื่อไม่ให้บางหน้าจอยังใช้ router ใหม่
- [ ] คืนการเลือกโมเดลและ key rotation จาก baseline เดิมที่ตรวจสอบได้ ใช้โค้ดเก่าเป็นหลักฐาน ไม่ตั้ง model ID ใหม่จากการคาดเดา
- [ ] คืน timeout image translation เดิมที่พบใน HEAD: 60 วินาทีต่อ attempt และ 180 วินาทีต่อ request; ตรวจค่า text และ client timeout จาก baseline ของแต่ละเส้นทางแยกกัน
- [ ] ถอด shared discovery deadline/การหักเวลา discovery ที่เพิ่มในชุดนี้ และไม่ปล่อยให้ request จำเป็นต้องรอ catalog ใหม่ก่อนแปลในโหมดเดิม
- [ ] คง provider/base URL ที่ผู้ใช้ใช้อยู่ก่อนเปลี่ยน ห้ามสลับ provider เพียงเพราะเห็นคำว่า Safety Filter
- [ ] คืน dropdown/default model ให้สอดคล้องกับ router เดิม และกำหนดการจัดการค่าที่บันทึกจาก UI รุ่นใหม่อย่างชัดเจน
- [ ] ไม่ถอด timeout ทุกชั้น; ยังต้องมีขอบเขตเวลาสูงสุดและการยกเลิกจากผู้ใช้
- [ ] ให้ `OTHER` แสดงเหตุผลที่ provider ส่งมา ไม่สรุปเป็นเนื้อหา 18+ โดยไม่มีหลักฐาน และไม่เปิดโหมด bypass อัตโนมัติ
- [ ] สำรองภาพเดิมและใช้ input เดียวกันเปรียบเทียบก่อน/หลัง หาก provider ยังตอบ block ให้คงเป็น error ไม่แสดงสำเร็จหรือส่งออกหน้าว่างแทน

เกณฑ์ผ่าน:

1. Tests ยืนยัน model order, manual model, key ownership/rotation และ timeout ของโหมดเดิม
2. หน้าเดียว, crop, batch และ cancel ทำงานครบ
3. ทดลองกับหน้าที่ผู้ใช้เคยแปลได้ โดยตรวจ model ที่ใช้จริงและภาพส่งออก ไม่ตรวจเพียง HTTP 200
4. สำหรับ 9 หน้าที่เคยล้มเหลว ให้สรุปรายหน้าว่าผ่าน/ยังถูกปฏิเสธ/ผิดพลาดอื่น แยกผลจริงจากผล mock

## 5. ตรวจรวมและส่งมอบ

- [ ] ตรวจ diff ว่าย้อนครบขอบเขตและไม่แตะงานสีข้อความ/MaskEditor/งานอื่นที่ไม่เกี่ยวข้อง
- [ ] ปรับ tests ให้ทดสอบ contract ที่เลือกคืน ไม่ลบ assertion เพื่อให้ผลเขียวเฉย ๆ
- [ ] รัน `node node_modules/typescript/bin/tsc --noEmit --incremental false`
- [ ] รัน `node node_modules/vitest/vitest.mjs run --root .`
- [ ] รัน Python tests เฉพาะเมื่อมีการเปลี่ยน Python หรือ integration ที่แตะ sidecar
- [ ] ทดสอบจริง: import → clean → translate → edit → reload → export → publish-back
- [ ] ทดสอบในช่องทางใช้งานจริงของผู้ใช้; หากแจก packaged Electron หรือ Docker ให้ทดสอบ artifact นั้นด้วย ไม่ใช้ผล dev server แทน
- [ ] ส่งมอบรายการไฟล์ที่ย้อน ผลทดสอบ ตำแหน่ง backup และข้อจำกัดที่ยังมี โดยไม่รับรองว่าการ rollback ทำให้ provider ยอมรับทุกภาพ

## ลำดับและเงื่อนไขจบงาน

สำรองและกู้ source ที่ยังมีชีวิต → คืน resource lifecycle → คืน settings → คืน sync → คืน translation/timeout → ทดสอบรวม

ปิดงานได้เมื่อย้อนครบทั้ง 4 ชุดพร้อมเส้นทางแปลเดิมที่ระบุไว้, งานที่บันทึกไม่สูญหาย, export ใช้ revision ล่าสุด และมีผลการลองแปลจริงจากผู้ใช้ หากไม่มีภาพสำหรับทดสอบจริง ให้ส่งมอบโค้ดและผล tests พร้อมระบุว่า “ยังไม่ได้ยืนยันกับ 9 หน้าต้นเหตุ” ไม่ถือว่าแก้อาการในภาพสำเร็จแล้ว

หากการย้อนทำให้เกิด regression ใหม่ ให้คืนจาก snapshot ก่อนย้อนเป็นรายส่วน และรักษางานที่ผู้ใช้สร้างระหว่างทดสอบไว้ด้วย ห้ามคืนฐานข้อมูลเก่าทับโดยไม่เก็บข้อมูลใหม่
