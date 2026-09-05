# Page Viewer Zoom — Design Brief

**Status:** Proposed — awaiting confirmation before implementation planning

## 1. Feature Summary

เพิ่มระบบซูมสำหรับตรวจรายละเอียดภาพมังงะใน workspace โดยคงภาพเป็นจุดเด่นและไม่เพิ่มแผงควบคุมขนาดใหญ่ รองรับการตรวจ Original, Clean, Translated และ Mask ณ ตำแหน่งเดียวกัน ทั้งเดสก์ท็อป ทัชแพด และมือถือ

ความสำเร็จหมายถึงผู้ใช้ขยายอ่านข้อความหรือเช็กขอบ mask ได้อย่างแม่นยำ แพนไปยังจุดที่ต้องการได้โดยไม่หลงตำแหน่ง และกลับสู่ภาพพอดีหน้าจอได้ในคำสั่งเดียว

## 2. Primary User Action

ซูมเข้าหาจุดที่ชี้หรือสัมผัส ตรวจรายละเอียด แล้วแพนภายในหน้าโดยไม่รบกวนการเปลี่ยนหน้า การเลื่อนอ่าน หรือการสลับ layer

## 3. Design Direction

- **Color strategy:** Restrained ตาม `DESIGN.md`; ใช้ magenta เฉพาะสถานะ active/focus และไม่ใช้สีตกแต่งใหม่
- **Theme scene:** ผู้ทำ scanlation ตรวจเส้นขอบตัวหนังสือและ mask บนจอมืดเป็นเวลานาน โดยต้องจดจ่อกับพิกเซลของภาพมากกว่า chrome ของเครื่องมือ
- **Anchors:** Figma canvas สำหรับ cursor-anchored zoom/pan, Google Photos สำหรับ Fit/Actual-size ที่เข้าใจทันที และ Torii Translate สำหรับ workspace ที่ให้ภาพเด่นกว่า controls
- controls ใช้ vocabulary, typography, radius และ focus ring เดิมของโปรเจกต์
- ไม่สร้าง visual-direction probes เพราะเป็นการเพิ่ม interaction ขนาดเล็กบน surface และ design system ที่กำหนดไว้แล้ว ไม่ใช่การออกแบบ surface ใหม่

## 4. Scope

- **Fidelity:** production-ready
- **Breadth:** `PageViewer` ทั้งโหมด `single` และ `scroll`
- **Interactivity:** shipped-quality controls, mouse, trackpad, keyboard และ touch gestures
- **Persistence:** จำ viewport ขณะสลับ Original/Clean/Translated/Mask ของหน้าเดิม แต่กลับ Fit เมื่อเปลี่ยนหน้า
- **Excluded:** ไม่ซูมผล export, ไม่เปลี่ยน resolution ต้นฉบับ, ไม่เพิ่ม minimap ในรุ่นแรก และไม่ผูก zoom เข้ากับ Mask Editor ในงานนี้

## 5. Layout Strategy

### Single-page mode

- ภาพอยู่ใน viewport ที่ clip/scroll ได้โดยไม่ทำให้ทั้งหน้าเว็บเกิด horizontal overflow
- toolbar ขนาดกะทัดรัดลอยมุมขวาล่างของ viewer อยู่เหนือ filmstrip และไม่ทับ page badge ตรงกลาง
- controls เรียง `Zoom out`, ค่าเปอร์เซ็นต์/เมนู, `Zoom in`, `Fit` โดย icon และ hit target สม่ำเสมอกับ toolbar เดิม
- ซ่อน label ยาวบนหน้าจอแคบ แต่คง accessible name และ tooltip

### Continuous-scroll mode

- ใช้เพียง `Fit width` และ `Actual size (100%)`
- `Fit width` เป็นค่าเริ่มต้นเพื่อรักษาพฤติกรรมอ่านต่อเนื่องเดิม
- `Actual size` เปลี่ยนขนาด layout จริงและสั่ง virtualizer วัดความสูงใหม่ ห้ามใช้ transform ที่ทำให้ตำแหน่งหน้าถัดไปคลาดเคลื่อน
- controls ติดอยู่ในตำแหน่งเดิมขณะเลื่อน แต่ไม่บังเนื้อหาและ filmstrip

## 6. Key States

- **Fit:** ภาพพอดีกับพื้นที่ viewer; ค่าเปอร์เซ็นต์คำนวณจากขนาดจริง ไม่สมมติว่า Fit เท่ากับ 100%
- **Actual size:** แสดง 1 image pixel ต่อ 1 CSS pixel (`100%`)
- **Custom zoom:** `25%–400%`; ปุ่มเพิ่ม/ลดและ gesture ใช้ scale steps เดียวกัน
- **Panning:** เปิดเมื่อภาพใหญ่กว่า viewport อย่างน้อยหนึ่งแกน; cursor เปลี่ยน `grab`/`grabbing`
- **Loading/broken image:** controls disabled จนรู้ natural dimensions; broken-image UI เดิมยังใช้งานได้
- **Page change:** reset เป็น Fit และวางภาพกึ่งกลาง
- **Layer change:** รักษา scale และ focal position เพื่อเทียบ before/after ตรงจุดเดิม
- **Layout change:** single → scroll ใช้ Fit width; scroll → single ใช้ Fit
- **Viewport resize/orientation change:** คำนวณ Fit ใหม่โดยรักษาจุดกึ่งกลางของภาพเมื่อทำได้
- **Min/max:** ปุ่มและ gesture clamp ที่ 25%/400%; ไม่มี overshoot
- **Reduced motion:** ไม่มี animated zoom/pan; เปลี่ยนสถานะทันที

## 7. Interaction Model

### Mouse and trackpad

- `Ctrl/Cmd + wheel` ซูมเข้าหาจุดใต้ cursor และเรียก `preventDefault`; wheel ปกติยังเลื่อนหน้าเว็บ/continuous reader
- ปุ่ม `−`/`+` ซูมรอบจุดกึ่งกลาง viewport
- คลิกค่าเปอร์เซ็นต์เปิดเมนู `Fit`, `50%`, `100%`, `200%`, `400%`
- ลากบนพื้นภาพเพื่อแพนเมื่อซูมเกิน Fit; editable overlay ยังคงรับ pointer interaction ของตนเอง
- middle-mouse drag และ `Space + drag` แพนได้เสมอเมื่อมี overflow
- double-click สลับระหว่าง Fit กับ 100% โดยยึดจุดที่คลิกเป็น focal point

### Keyboard

- `+`/`=` ซูมเข้า, `-` ซูมออก, `0` กลับ Fit, `1` ไป 100%
- shortcut ทำงานเมื่อ focus ไม่ได้อยู่ใน input/textarea/contenteditable
- ลูกศรเลื่อนหน้าเดิมยังทำงานตามเดิมและไม่ชนกับ zoom shortcuts
- ทุกปุ่มเข้าถึงด้วย Tab มี visible focus และประกาศชื่อ/สถานะผ่าน ARIA

### Touch

- pinch-to-zoom ยึดกึ่งกลางระหว่างนิ้วเป็น focal point
- one-finger drag แพนเมื่อซูม; เมื่ออยู่ Fit ยังรักษา swipe เปลี่ยนหน้าปัจจุบัน
- double-tap สลับ Fit กับ 200% ณ จุดสัมผัส
- gesture ต้องแยก tap, pan, pinch และ page-swipe ด้วย movement threshold เพื่อไม่สั่งสอง action พร้อมกัน
- hit target controls อย่างน้อย 44×44 px

### Feedback

- ค่า zoom อัปเดตแบบ real-time และใช้ `aria-live="polite"` เฉพาะหลัง interaction จบเพื่อลดเสียงรบกวนจาก screen reader
- zoom/pan transition 150 ms ease-out เฉพาะปุ่มและ preset; wheel/pinch ตอบสนองทันที
- ไม่มี toast สำหรับ zoom ปกติ เพราะเปอร์เซ็นต์บน toolbar เป็น feedback เพียงพอ

## 8. Content Requirements

- Labels: `ย่อ`, `ขยาย`, `พอดีหน้าจอ`, `ขนาดจริง`, `ระดับการซูม`
- Tooltip/shortcut: `พอดีหน้าจอ (0)`, `ขนาดจริง (1)`, `ซูมเข้า (+)`, `ซูมออก (-)`
- Accessible value: `ระดับการซูม 125 เปอร์เซ็นต์`
- Continuous mode menu: `พอดีความกว้าง` และ `ขนาดจริง (100%)`
- ใช้ icons จาก `lucide-react`; ไม่ต้องสร้าง raster, illustration หรือ icon set ใหม่

## 9. Recommended Implementation References

- `reference/product.md` สำหรับ interaction vocabulary และ state completeness
- `reference/adapt.md` สำหรับ responsive/touch behavior
- `reference/animate.md` สำหรับ zoom transition และ reduced-motion fallback
- `reference/harden.md` สำหรับ gesture conflicts, image loading และ edge cases
- Next.js local docs สำหรับ client component/event handling ก่อนแก้โค้ด

## 10. Acceptance Criteria

- zoom ยึด focal point: พิกเซลใต้ cursor/กึ่งกลาง pinch คลาดไม่เกิน 2 CSS px หลังเปลี่ยน scale
- scale ถูก clamp ที่ 25% และ 400% ทุก input path
- เปลี่ยน layer แล้ว scale/ตำแหน่งเดิมคงอยู่; เปลี่ยนหน้าแล้วกลับ Fit
- wheel ปกติยัง scroll และ `Ctrl/Cmd + wheel` ไม่ทำให้หน้าเว็บ scroll
- ที่ Fit บนมือถือ horizontal swipe ยังเปลี่ยนหน้า; เมื่อซูมแล้ว drag แพนและไม่เปลี่ยนหน้าโดยไม่ตั้งใจ
- Mask layers และ translated overlays ต้อง scale/translate ตรงกับภาพทุกระดับซูม
- continuous mode virtualizer วัดตำแหน่งถูกต้องทั้ง Fit width และ 100% โดยหน้าต่าง ๆ ไม่ซ้อนหรือมีช่องว่างผิดปกติ
- viewer ไม่สร้าง horizontal overflow ให้ `body`
- controls ใช้ keyboard ได้ครบ, focus มองเห็นชัด, accessible names ครบ และรองรับ reduced motion
- ไม่มีการเปลี่ยนแปลงต่อไฟล์ต้นฉบับ, cleaning result หรือ exported image จากการซูม

## 11. Confirmation Gate

เมื่อ brief นี้ได้รับการยืนยัน จึงค่อยแตก implementation plan แบบ TDD ครอบคลุม state model, zoom math, pointer/touch gesture arbitration, viewer integration, continuous-mode remeasurement, accessibility และ browser visual QA
