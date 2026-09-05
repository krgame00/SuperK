# Walkthrough: Workspace Canvas Layout & Viewing Area Expansion

**Date:** 2026-09-05  
**Feature:** Workspace Canvas Layout Expansion, Floating Toolbar & Focus Mode  
**Scope:** `src/app/page.tsx`, `components/workspace/PageViewer.tsx`, `components/workspace/PageZoomToolbar.tsx`, `components/workspace/PageFilmstrip.tsx`, `components/cleaning/CleaningToolbar.tsx`

---

## 📌 บทสรุปผู้บริหาร / Executive Summary (สไตล์ 9arm)

เดิมทีเวลาเราเปิดเว็บแต่งมังงะขึ้นมาบนจอคอม 1080p หรือ 2K ภาพมังงะกลับดูเล็กจิ๋ว และมีแถบขอบดำด้านซ้ายขวากว้างมาก ทั้งๆ ที่จอเรากว้างเป็นกิโล  
**ต้นตอของปัญหา (Root Cause):**  
มังงะเป็นภาพแนวตั้ง ($1 : 1.4$) เมื่อเราใช้ระบบคำนวณแบบ **Fit to Viewport** ถ้าพื้นที่แนวตั้ง (Height) โดนบวมด้วยขอบบน ขอบล่าง หรือ Toolbar แค่นิดเดียว ความกว้างของภาพจะโดนหดเล็กลงตามสัดส่วนคณิตศาสตร์ทันที!  
ในเวอร์ชันเดิม มีทั้ง Header ($56\text{px}$), Container Padding ($48\text{px}$), CleaningToolbar ใน flex flow ($50\text{px}$), และ Bottom Clearance ปลายจอ ($112\text{px}$) รวมแล้วพื้นที่แนวตั้งหายไปฟรีๆ กว่า **$266\text{px}$** ทำให้ Fit Scale หดเหลือไม่ถึง $45\%$

**สิ่งที่เรายกเครื่องใหม่:**  
เปลี่ยนสถาปัตยกรรม Layout จาก Document Flow ธรรมดา ให้กลายเป็น **Modern Editor Canvas (สไตล์ Figma / Photoshop)** ดึงพื้นที่เต็ม Viewport, ทำให้ Cleaning Toolbar ลอยตัวอยู่เหนือกราฟิกแบบ Floating, คืนพื้นที่ทันทีที่พับ Filmstrip, และเพิ่ม **Focus Mode** เต็มตา $100\text{dvh}$ ด้วยคีย์ลัด `F`

---

## 🛠️ รายละเอียดสิ่งที่ปรับปรุงเชิงเทคนิค (Technical Implementation)

### 1. Viewport-based Flex Layout (`src/app/page.tsx`)
- เปลี่ยน `<main>` จากเดิมที่ใช้ `min-h-[60vh]` และ `mb-24 sm:mb-28` มาเป็น:
  ```tsx
  <main
    className={`w-full flex flex-col items-center overflow-hidden transition-all duration-300 ${
      isFocusMode
        ? "h-[100dvh] mt-0"
        : pages.length > 0
          ? "h-[calc(100dvh-3.5rem)] mt-14"
          : "flex-1 min-h-[calc(100dvh-3.5rem)] mt-14"
    }`}
  >
  ```
- ตัว Container ด้านในใช้ `h-full flex-1 min-h-0 relative` ทำให้ `ResizeObserver` ใน `usePageZoom` คำนวณความสูงที่มีอยู่จริงได้เต็มเม็ดเต็มหน่วย

### 2. Floating CleaningToolbar บน Desktop
- บน Desktop ปรับให้ลอยตัวอยู่ด้านบนกึ่งกลาง Canvas:
  ```tsx
  <div className="w-full md:absolute md:top-2.5 md:left-1/2 md:-translate-x-1/2 md:z-30 flex justify-center pointer-events-none px-2 py-1 md:py-0">
    <div className="pointer-events-auto max-w-full">
      <CleaningToolbar ... />
    </div>
  </div>
  ```
- มี `pointer-events-none` ที่ Container ด้านนอก เพื่อให้คลิกหรือลาก Pan/Zoom ทะลุผ่านพื้นที่ว่างรอบ Toolbar ได้โดยตรง และมี `pointer-events-auto` บนตัว Toolbar เอง
- บน Mobile (`< md`) ยังคงแสดงผลใน Flex Flow ปกติ เพื่อไม่ให้ทับเนื้อหาบนจอมือถือขนาดเล็ก

### 3. ปลดล็อกข้อจำกัดขนาดของ Viewport (`components/workspace/PageViewer.tsx`)
- ถอดคลาสจำกัดความกว้างเดิม `max-w-full sm:max-w-3xl md:max-w-4xl lg:max-w-5xl xl:max-w-6xl` ออกจาก `viewportRef`
- เปลี่ยนจาก `min-h-[60vh]` มาเป็น `w-full h-full flex-1 min-h-0` ทำให้ Viewport ขยายได้เต็มพื้นที่ 100% ของ Container ไม่ว่าจะเปิดบนจอ Ultra-wide, 2K หรือ 4K

### 4. Dynamic Filmstrip Clearance (`components/workspace/PageFilmstrip.tsx`)
- Main Container คำนวณระยะเว้นด้านล่างตามสถานะของ Filmstrip:
  - **เมื่อเปิด Filmstrip:** เว้นระยะเท่าความสูง Thumbnails (`pb-20 sm:pb-22` ~ $80\text{px}$)
  - **เมื่อพับเก็บ (Collapsed):** เว้นระยะเพียงความสูงของปุ่มเปิดคืน (`pb-7` = $28\text{px}$) ส่งผลให้ภาพมังงะขยายใหญ่ขึ้นทันทีโดยอัตโนมัติ
  - **เมื่ออยู่ใน Focus Mode:** เว้นระยะ $0\text{px}$ (`p-0`)

### 5. Dedicated Focus Mode & Shortcut `F`
- รองรับการกดปุ่ม **`F`** บนคีย์บอร์ด หรือคลิกไอคอน **Focus Mode** ที่แถบ Zoom Toolbar
- มีการตรวจสอบ Guard ไม่ให้ Trigger หากกำลังพิมพ์อยู่ใน `<input>`, `<textarea>`, ContentEditable หรือ Dialog
- เมื่อเข้าสู่โหมดโฟกัส:
  - Header ด้านบนจะเลื่อนซ่อนขึ้นไป (`-translate-y-full`)
  - Filmstrip ด้านล่างจะสไลด์ลงนอกจอ (`translate-y-[150%] opacity-0 pointer-events-none`)
  - แสดงปุ่ม **"ออกจากโหมดโฟกัส Esc"** แบบลอยตัวที่มุมขวาบน
  - ออกจากโหมดโฟกัสได้ผ่านปุ่ม `Esc`, ปุ่ม `F`, หรือการคลิกปุ่มบนหน้าจอ

### 6. Navigation Arrows Proximity
- ปรับระยะปุ่มลูกศรเปลี่ยนหน้า (Prev / Next) ให้ชิดขอบ Viewport ที่ระยะ `left-3 sm:left-6` และ `right-3 sm:right-6` พร้อมดีไซน์ Glassmorphism โปร่งแสง
- ช่วยให้คลิกเปลี่ยนหน้าได้สะดวกในระยะสายตา โดยไม่บังเนื้อหากลางภาพมังงะ

---

## 🖼️ ภาพบันทึกผลการทดสอบจริง (Visual Screenshots)

### 1. โหมดปกติ (Normal Mode Workspace)
ภาพขยายใหญ่ขึ้นอย่างเห็นได้ชัด Toolbar ลอยตัวอยู่ด้านบน และ Filmstrip อยู่ด้านล่างอย่างเป็นระเบียบ:
![Normal Mode Workspace](../assets/workspace-canvas-normal-mode.png)

### 2. โหมดโฟกัสเต็มหน้าจอ (Focus Mode - Press F)
UI ส่วนเกินทั้งหมดถูกซ่อนอย่างเรียบหรู มังงะขยายเต็มความสูงหน้าจอแบบ $100\text{dvh}$:
![Focus Mode Workspace](../assets/workspace-canvas-focus-mode.png)

---

## 📂 ตารางไฟล์ที่มีการแก้ไข (Files Modified)

| ไฟล์ | การเปลี่ยนแปลงหลัก |
| :--- | :--- |
| `src/app/page.tsx` | Viewport-based layout (`h-[calc(100dvh-3.5rem)]`), Floating Toolbar wrapper, Dynamic bottom padding, State & Key listener สำหรับ Focus Mode |
| `components/workspace/PageViewer.tsx` | ปลดล็อก `max-w-6xl` ให้ขยายเต็ม 100%, ปรับสไตล์ปุ่มลูกศร Prev/Next, เชื่อมโยง `isFocusMode` |
| `components/workspace/PageZoomToolbar.tsx` | เพิ่มปุ่ม Focus Mode (ไอคอน `Expand` / `Minimize2`), รองรับทั้ง Single และ Scroll mode |
| `components/workspace/PageFilmstrip.tsx` | เพิ่ม Prop `isFocusMode` ให้สไลด์ซ่อนตัวลงด้านล่างแบบไร้รอยต่อ |
| `components/cleaning/CleaningToolbar.tsx` | เพิ่ม Prop `className`, ปรับความสูง Compact และดีไซน์ Glassmorphism |
| `components/editing/KeyboardShortcutsDialog.tsx` | เพิ่มคู่มือคีย์ลัด `F` (โหมดโฟกัส) ในหน้าต่าง Shortcuts |
| `tests/workspace/PageFilmstripFocus.test.tsx` | **[NEW]** Unit test ตรวจสอบพฤติกรรมของ Filmstrip เมื่ออยู่ใน Focus Mode |
| `tests/workspace/PageZoomToolbar.test.tsx` | Unit test ตรวจสอบปุ่มและการทำงานของ Focus Mode Toggle |

---

## 🧪 ผลการทดสอบเชิงระบบ (Verification Summary)

1. **Vitest Unit & Integration Tests:**
   - คำสั่ง: `npm test`
   - ผลลัพธ์: **ผ่านครบทุกไฟล์ 63 / 63 ไฟล์ (302 / 302 Tests passed)** ไม่มีข้อผิดพลาด
2. **TypeScript Compilation:**
   - คำสั่ง: `npx tsc --noEmit`
   - ผลลัพธ์: **0 Errors (Exit code 0)** ปลอดภัย Type-safe 100%
3. **ESLint Code Standards:**
   - คำสั่ง: `npm run lint`
   - ผลลัพธ์: **0 Errors (Exit code 0)** โค้ดสะอาดตามมาตรฐานโปรเจกต์
4. **Interactive Browser Automation:**
   - ทดสอบจำลองการใช้งานบนเบราว์เซอร์จริง ผ่านทุก Flow ทั้งการโหลดภาพ, การขยายสเกลอัตโนมัติ, การสลับ Focus Mode ด้วยปุ่ม `F`, และการกด `Esc` คืนค่า
