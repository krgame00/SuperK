# System test report, 2026-10-28

## Goal

ตรวจว่าระบบ SuperK manga-translator ทำงานได้จริงทั้ง automated checks และ flow ผู้ใช้บนแอปจริง และระบุ defect หรือความเสี่ยงที่พบพร้อมหลักฐาน.

## Scope

ทดสอบบน commit `47a5777` (fix cleaning RemnantReviewPanel) รอบแรก และ commit `c2bd381` (safe cleaning mode default) รอบสอง. Working tree มีไฟล์ที่ process อื่นแก้ระหว่างทดสอบ ไม่ใช่ของผม.

อยู่ในขอบเขต:

- Unit และ integration tests
- TypeScript typecheck
- ESLint
- Production build
- Home page, upload, local clean, Gemini translation, session restore, export review gate
- Production runtime (`npm start`)
- Export จริงลงดิสก์: JPG, PDF, ZIP, PNG ต้นฉบับ, Layered PSD pack
- Mask editor: AI ตรวจ/เทียบ Mask, นำ Mask AI มาใช้, คลีนเฉพาะจุด
- Remnant review: ตรวจจุดข้อความตกค้างบนภาพคลีน
- Settings: รีเฟรชโมเดล, Glossary เพิ่ม/สกัด/ส่งออก/นำเข้า, pairing token
- Extension API: pair, settings, workspace append, publish-back (เฉพาะ HTTP contract)
- Error handling ของ clean, translate, review, sidecar
- Performance trace และ navigation timing

ไม่อยู่ในขอบเขต:

- Chrome extension end to end (ทดสอบเฉพาะ API contract ไม่ได้ติดตั้งส่วนเสริมจริง)
- หน้ามังงะจริงจากผู้ใช้ (ใช้ภาพสังเคราะห์)
- การล้างแคชหรือ purge job เพราะเป็น destructive action ต่อข้อมูลจริง

## Environment

| รายการ | ค่า |
| :--- | :--- |
| OS | Windows, `DESKTOP-EGC63LS` |
| Node | ตาม environment ของเครื่อง |
| Next.js | 16.3.6 (Turbopack) |
| Frontend | `next dev -H 127.0.0.1` port 3000 |
| Sidecar | uvicorn port 8765 |
| Browser | OpenCode browser (Chromium 152, viewport 320x640) |
| Test image | `synthetic_manga_page.png`, 800x1200, สร้างด้วย PIL, มีข้อความญี่ปุ่น 3 กลุ่ม |

## Automated results

| Check | Command | Result |
| :--- | :--- | :--- |
| Tests | `npm test` | 239 files passed, 1 skipped. 1968 tests passed, 1 skipped. 94.53s |
| Typecheck | `npx tsc --noEmit` | ผ่าน ไม่มี output |
| Lint | `npm run lint` | 0 error, 94 warning |
| Build | `npm run build` | ผ่าน. Compiled 2.7s, TypeScript 7.2s, 19 routes, standalone sync สำเร็จ |

หลักฐาน build:

```
✓ Compiled successfully in 2.7s
✓ Generating static pages using 11 workers (19/19) in 486ms
[Assets] Synced public -> .next/standalone/public
[Env] Injected loadEnvConfig into .next/standalone/server.js
```

## Browser flow results

| Step | ผล | หลักฐาน |
| :--- | :--- | :--- |
| Home page | ผ่าน | HTTP 200, console error 0, ภาพ `01-home.jpeg` |
| Sidecar health | ผ่าน | `GET /health` = `{"status":"ok"}` |
| Upload PNG | ผ่าน | workspace เปิด, "หน้า 1 / 1", thumbnail ขึ้น |
| Local clean | ผ่าน | `POST /api/clean/v1/jobs` 202, polling 200, ดึง `clean.png`, `mask.png`, `review-mask.png`, `protected-mask.png` 200 ทั้งหมด |
| Clean result | ผ่าน | ข้อความหาย, พื้นหลังถูก inpaint, ภาพ `02-cleaned.jpeg` |
| Translate | ผ่าน | `POST /api/translate` 200 สองครั้ง (2.3s, 1.66s), `POST /api/translation-review` 200 (0.9s) |
| Rendered Thai | ผ่าน | ข้อความไทยขึ้นบน canvas, ภาพ `03-translated.jpeg` |
| Session autosave | ผ่าน | reload แล้วมีปุ่ม "คืนค่างานเดิม" |
| Session restore | ผ่าน | toast "ดึงค่างานเดิมกลับมาเรียบร้อย!", หน้าและคำแปลกลับมา |
| Export review gate | ผ่าน | dialog "รายงานก่อนส่งออก", หน้า 1 ถูกกันเพราะยังไม่ยืนยัน, ภาพ `04-export-gate.jpeg` |
| Confirm page | ผ่าน | banner หาย, ระบบขึ้น "ข้อความล้นพื้นที่หน้า" |
| Production runtime | ผ่าน | `npm start` ตอบ 200, console error 0 |

## Second round: subsystem tests

รอบสองทดสอบบน origin `http://localhost:3000` แยกจาก session ผู้ใช้ที่ผูกกับ `127.0.0.1` เพื่อไม่แตะข้อมูลจริง. ใช้ภาพสังเคราะห์ 800x1200 หน้าเดียว.

### Export จริงลงดิสก์

| รูปแบบ | ไฟล์ที่ได้ | ขนาด | ผลตรวจ |
| :--- | :--- | :--- | :--- |
| JPG | `SuperK_Page_001_synthetic_manga_page.jpg` | 54,174 bytes | เปิดได้ เป็น JPEG |
| PDF | `SuperK_synthetic_manga_page.pdf` | 59,097 bytes | 1 หน้า, 1067x1600, header `%PDF-1.3` |
| ZIP | `SuperK_synthetic_manga_page.zip` | 54,352 bytes | 1 entry, JPEG 54,174 bytes, magic `ffd8ffe0` |
| PNG ต้นฉบับ | `SuperK_Page_001_synthetic_manga_page.png` | 50,538 bytes | ขนาดเท่าต้นฉบับ, ภาพยังเป็นข้อความญี่ปุ่นครบ, ไม่มี dialog review gate |
| Layered pack | `SuperK_Layered_Photoshop_Pack.zip` | 106,559 bytes | `page_001_original.png` 50,538, `page_001_inpainted.png` 71,343, `layers.json` 2,018,018, `build_layered_page_001.jsx` 1,785 |

ข้อสังเกต: export แบบ `original` ข้าม review gate ตามดีไซน์ของ `lib/export/reviewGate.ts` (หน้า `exportSource: "original"` ถูกข้าม) และไฟล์ที่ได้มีขนาดตรงกับต้นฉบับทุก byte.

### Mask editor

| ขั้น | ผล | หลักฐาน |
| :--- | :--- | :--- |
| เปิดโหมด Mask | ผ่าน | ปุ่ม "ปิดแก้ Mask" ปรากฏ, ไม่มี console error |
| AI ตรวจ/เทียบ Mask | ผ่าน | `POST /api/clean/v1/detect/bubbles` 200, toast "AI พบจุดที่ Mask เดิมล้ำเส้นกรอบหรือพื้นหลังเกินจำเป็น -967 px (สีฟ้า)" |
| นำ Mask AI มาใช้ | ผ่าน | toast "นำ Mask ที่ AI แนะนำมาใช้แล้ว" |
| คลีนเฉพาะจุด | ผ่าน | สร้าง job ใหม่ `77317df3498044e789d43809943f230e`, ดึง `clean.png`, `mask.png`, `review-mask.png`, `protected-mask.png` 200 |

### Remnant review

`clean.png` ของ job `6e4f3f9d60aa41aaaa37fee46fdeadde` ยังเหลือข้อความ 2 จุด และ panel ตรวจจับได้ตรงทั้งคู่:

| จุด | ตำแหน่ง | ขนาด | ความมั่นใจ | หลักฐาน |
| :--- | :--- | :--- | :--- | :--- |
| 1 | x665 y704 | 40x222 | 95% | ความมืดต้นฉบับ/หลังคลีน 219/219, หมึกเหลือ 1,851 px |
| 2 | x113 y822 | 258x108 | 95% | ความมืดต้นฉบับ/หลังคลีน 231/231, หมึกเหลือ 4,051 px |

ทั้งสองจุดเป็นข้อความนารเรชันและ SFX ที่คลีนไม่หมด แต่ตัวตรวจ remnant ทำงานถูกต้อง.

### Settings utilities

| รายการ | ผล | หลักฐาน |
| :--- | :--- | :--- |
| รีเฟรชรายการโมเดล | ผ่าน | `POST /api/translate/models` 200, 161-360 ms, แสดง "Credentials 10/10 valid · 7 เลือกได้ จาก 34 โมเดล" |
| เพิ่ม Glossary | ผ่าน | เพิ่ม `ルフィ → ลูฟี่` แล้วนับ "1 คำ", ปุ่มส่งออกเปลี่ยนจาก disabled เป็น enabled |
| สกัดคำศัพท์ | ผ่าน | toast "ไม่พบชื่อเฉพาะหรือคำศัพท์ซ้ำใหม่ๆ จากหน้าที่แปลแล้ว" ไม่เพิ่มรายการมั่ว |
| ส่งออก Glossary | ผ่าน | `superk-glossary-2026-10-28.json` 70 bytes, เนื้อหา `[{"source":"ルフィ","target":"ลูฟี่"}]` |
| นำเข้า Glossary | ผ่าน | นำเข้า 2 รายการ `ナミ → นามิ`, `ゾロ → โซโล` แล้วแสดง 2 คำ |
| Pairing token | ผ่าน | dialog แสดง token ขึ้นต้น `06554b8a` โดยไม่ต้องเรียก API เอง |

### Extension API contract

ทดสอบด้วย token จาก `GET /api/extension/pair` (loopback, ไม่มี Origin) และยิงผ่าน `fetch` จาก Node.

| เคส | สถานะ | ผล |
| :--- | :--- | :--- |
| `GET /pair` ไม่มี Origin | 200, 71 ms | คืน pairingToken |
| `GET /pair` Origin `https://evil.example` | 403 | Forbidden origin |
| `GET /pair` Host ปลอม | 403 | Forbidden origin |
| `GET /settings` ไม่มี token | 401 | Unauthorized |
| `GET /settings` token ผิด | 401 | Unauthorized |
| `GET /settings` token ถูก | 200, 11 ms | `geminiApiKey` ถูก redact เป็น `""` |
| `OPTIONS /settings` chrome-extension | 204 | `Access-Control-Allow-Origin` สะท้อน origin |
| `OPTIONS /settings` evil origin | 403 | Forbidden origin |
| `POST /settings` token ถูก | 200 | บันทึก glossary ได้ |
| `POST /settings` JSON เสีย | 400 | Failed to parse body |
| `POST /workspace/append` ไม่มี token | 401 | Unauthorized |
| `POST /workspace/append` ไม่มี pageUrl | 400 | pageUrl required |
| `POST /workspace/append` sourceRevision ผิดรูป | 400 | Invalid original source revision |
| `POST /workspace/append` ถูกต้อง | 200, 13 ms | handoffId + editUrl |
| `GET /workspace/append` ไม่มี id | 400 | Handoff ID required |
| `GET /workspace/append` id ไม่มีจริง | 404 | not found or expired |
| `GET /workspace/append` id ที่เก็บไว้ | 200 | คืน payload ครบ |
| `POST /publish-back` ไม่มี token | 401 | Unauthorized |
| `POST /publish-back` payload ว่าง | 400 | pageUrl required |
| `POST /publish-back` evidence ไม่ครบ | 409 | blocked, reasons `target-...` |
| `GET /publish-back` list | 200 | `{epoch, epochChanged:false, updates:[]}` |
| `GET /publish-back` pageUrl ไม่มีจริง | 404 | not found |
| `OPTIONS /publish-back` chrome-extension | 204 | ผ่าน |

สรุป: auth และ origin guard ทำงานครบทุกเส้นทางที่ทดสอบ ไม่พบช่อง bypass.

### Error handling และ sidecar

| เคส | สถานะ | ข้อความ |
| :--- | :--- | :--- |
| clean job ไม่มีจริง | 404, 81 ms | `Job not found.` |
| clean asset ของ job ไม่มีจริง | 404, 20 ms | `Job not found.` |
| สร้าง clean job ด้วย body ว่าง | 422, 23 ms | `body.image Field required` |
| translate body ว่าง | 400, 14 ms | `Missing image data` |
| translate JSON เสีย | 400, 12 ms | `INVALID_REQUEST` |
| translation-review body ว่าง | 400, 18 ms | `Invalid review payload` |
| translate models body ว่าง | 200, 19 ms | ใช้ cache, 10/10 keys valid |
| sidecar `/health` | 200, 5 ms | `{"status":"ok"}` |

### Performance

วัดด้วย Chromium trace 5.73 วินาที ขณะ reload หน้า workspace (dev mode, viewport 320x640).

| ตัวชี้วัด | ค่า |
| :--- | :--- |
| TTFB | 120 ms |
| First paint / FCP | 272 ms |
| DOMContentLoaded | 299 ms |
| Load | 543 ms |
| Transfer ตอน reload | 8 KB (cache) |
| DOM nodes (home) | 110 |
| JS heap (home) | 24 MB |
| Restore session | 138 ms ถึง "หน้า 1 / 1" |
| DOM nodes หลัง restore | 405 |
| JS heap หลัง restore | 34 MB |
| Trace events | 6,149 |
| Long task | 1 ครั้ง, blocking 240.19 ms |
| RunTask สูงสุด | 290.19 ms |
| FunctionCall สูงสุด | 289.59 ms |
| Background parse รวม | 146.4 ms |
| Paint รวม | 6.5 ms |
| Layout รวม | 4.5 ms |

ข้อจำกัด: เป็น dev build ไม่ใช่ production และ trace นี้ไม่คำนวณ LCP, INP, CLS หรือ Lighthouse score.

## Third round: editing, navigation, project files

รอบสามทดสอบบน `http://localhost:3000` เช่นเดิม viewport 514x654. ใช้ session ที่มี 2 ถึง 3 หน้า ซึ่งหน้าส่วนหนึ่งมี byte ของภาพซ้ำกัน (handoff กับ synthetic เป็นภาพเดียวกัน) เพื่อทดสอบเคสภาพซ้ำ.

| ฟีเจอร์ | ผล | หลักฐาน |
| :--- | :--- | :--- |
| Extension handoff | ผ่าน | `/?handoff=hnd_8ioug0hu_mvronvh8` ถึง toast ใน 843 ms, query ถูกเคลียร์, ได้หน้า 2/2 |
| เพิ่มหน้าด้วย upload | ผ่าน | toast "นำเข้าสำเร็จ 1 หน้า", thumbnail เพิ่มจาก 1 เป็น 2 |
| Drag reorder | ผ่าน | ใช้ synthetic `DragEvent` (dragstart, dragover, drop) สลับหน้า 1/2 สำเร็จ. `browser.drag` แบบ native ไม่ trigger HTML5 DnD |
| Session restore | ผ่าน | autosave นับ "2 หน้า" และ "3 หน้า" ตรงกับที่ restore, thumbnail ครบและลำดับคงที่ |
| ลบหน้า | ผ่าน | 3 หน้า เหลือ 2 หน้า, หน้าปัจจุบันยังเป็น 2, ไม่มี confirm |
| Find/Replace | ผ่าน | Ctrl+F เปิด dialog, แทน "สวัสดี" ด้วย "ทดสอบแทนที่", ข้อความเปลี่ยนเป็น "ทดสอบแทนที่ชาวโลก ..." |
| Undo/Redo ข้อความ | ผ่าน | Ctrl+Z คืนเป็น "สวัสดีชาวโลก ...", Ctrl+Shift+Z กลับเป็น "ทดสอบแทนที่ ...", ปุ่ม Undo/Redo disabled ตรงสถานะ |
| Mask undo (ปุ่ม) | ผ่าน | canvas 800x1200 signature เปลี่ยนเมื่อ "ล้างกรอบนี้" (len 38,650 เป็น 31,446) แล้วกลับเท่าเดิมเมื่อกด Undo Mask |
| Mask undo (คีย์) | ผ่านบางเงื่อนไข | Ctrl+Z ใช้ได้เมื่อ focus อยู่ที่ canvas, ไม่ทำงานเมื่อ focus ค้างที่ปุ่ม "ล้างกรอบนี้" |
| Shortcut help | ผ่าน | `?` เปิด dialog "คีย์ลัด (Shortcuts)", Esc ปิด |
| Space toggle | ผ่าน | aria ปุ่มเปลี่ยนจาก "สลับไปแสดงคำแปล" เป็น "สลับไปดูภาพต้นฉบับ" |
| Arrow navigation | ผ่าน | ArrowLeft ไปหน้า 1, ArrowRight กลับหน้า 2 (ต้องไม่ focus ที่ bubble) |
| Focus mode | ผ่าน | `F` เข้าโหมด, แสดง "แสดงแถบบน B / ออกจากโหมดโฟกัส Esc", Esc ออกได้ |
| Review: ใช้คำแปลที่เกลา | ผ่าน | "ใช้คำแปลที่เกลาทั้งหมด" เปลี่ยนข้อความเป็นข้อเสนอ AI "สวัสดีชาวโลก\nนี่คือการทดสอบ\nการแปลมังงะ", dialog ปิด |
| Review: อนุมัติหน้า | ผ่าน | ปุ่ม "ยืนยันภาพปัจจุบันเพื่อส่งออก" ทำให้ banner เตือนหาย |
| Export gate ตัวเลือกใหม่ | ผ่าน | มีปุ่มต่อหน้า "อนุมัติหน้านี้", "ส่งออกเป็นต้นฉบับ", "ตัดหน้านี้ออก", "ไปที่หน้านี้" และปุ่มระดับเล่ม "อนุมัติจุดค้างทุกหน้า", "ยืนยันทุกหน้าและดำเนินการ Export" |
| Export หลังอนุมัติทั้งหมด | ผ่าน | ZIP 52,976 bytes, 2 entries WEBP 26,322 bytes ทั้งคู่ magic `52494646` |
| Export ต้นฉบับหน้าเดียว | ผ่าน | `SuperK_Page_002_synthetic_manga_page.webp` 28,432 bytes |
| Strip ภาพยาว | ผ่าน | `SuperK_handoff_synthetic_LongStrip.jpg` 201,210 bytes, 1200x3600 |
| PDF หลายหน้า | ผ่าน | 126,124 bytes, 2 หน้า 1067x1600, header `%PDF-1.3` |
| CBZ | ผ่าน | 84,072 bytes, 3 WEBP + `ComicInfo.xml` 462 bytes |
| บันทึกโปรเจกต์ | ผ่าน | `SuperK_handoff_synthetic.superk.json` 892,920 bytes |
| เปิดโปรเจกต์ | ผ่าน | toast "📂 เปิดโปรเจกต์สำเร็จ (2 หน้า)!" |
| Logs dialog | ผ่าน | เปิดได้, แสดง "รวมทั้งหมด 0 รายการ", กรอง Error/Warn/Info ได้ |
| Export trigger ที่ viewport แคบ | ผ่าน | ปุ่มหลักอยู่ใน `hidden lg:flex` (zero-size ที่ 514px) ต้องใช้ hamburger menu จึงเข้าถึงได้ |

หมายเหตุวิธีทดสอบ: การเปิดโปรเจกต์ใช้การ patch `document.createElement` เพื่อให้ file input ที่แอปสร้างแบบ dynamic ปรากฏใน DOM แล้วอัปโหลดไฟล์จริงผ่าน input นั้น. ไม่ได้แก้โค้ดแอปและไม่ได้ใช้ API ลัด.

## Findings

### F1. `npm run build` ขณะ dev server รันอยู่ทำให้ `.next` เสียหาย (High, ยืนยันแล้ว)

ระหว่างทดสอบ ผมรัน `npm run build` ขณะ `next dev` ทำงานบน port 3000. Build ล้มที่:

```
Error: EBUSY: resource busy or locked, rmdir '...\.next\standalone'
```

หลัง build ล้ม หน้าเว็บยังโหลด HTML ได้ แต่ asset ทุกตัวตอบ 500. ตัวอย่างที่ยืนยัน:

```
GET /_next/static/chunks/turbopack-12ec_4wqsfuwc.js -> 500 Internal Server Error
GET /_next/static/chunks/2nh_gf3a-0d4k.css            -> 500 Internal Server Error
GET /icon-512.png                                     -> 500 Internal Server Error
```

สาเหตุคือ build เขียนทับ `.next` ที่ dev server ใช้อยู่. แก้โดย kill process แล้ว start dev ใหม่. หลัง restart console error กลับเป็น 0.

ผลกระทบ: นักพัฒนาที่รัน build มือระหว่าง dev จะเจอหน้าเว็บพังโดยไม่รู้สาเหตุ. Launcher มี logic หยุด server ก่อน build อยู่แล้ว (`scripts/start-production.ps1` บรรทัด 97-100) แต่ `npm run build` ตรงๆ ไม่มี guard.

ข้อเสนอ: เพิ่ม script ที่ตรวจ port 3000 ก่อน build แล้วหยุดหรือเตือน. อย่างน้อยเพิ่มข้อความใน README.

### F2. `npm start` ไม่ใช่ production entry ที่ถูกต้อง (Low, ยืนยันแล้ว)

`npm start` ทำงานได้และตอบ 200 แต่ Next ขึ้นเตือน:

```
⚠ "next start" does not work with "output: standalone" configuration.
  Use "node .next/standalone/server.js" instead.
```

Launcher ใช้ standalone ถูกต้องแล้ว (`scripts/start-production.ps1` บรรทัด 36 และ 123). ปัญหาคือ `package.json` script `start` ชี้ทางผิดและทำให้เข้าใจผิด.

ข้อเสนอ: เปลี่ยน `start` เป็น `node .next/standalone/server.js` หรือเปลี่ยนชื่อเป็น `start:legacy`.

### F3. Lint warnings กระจุกที่ export orchestrator (Low, ยืนยันแล้ว)

94 warnings, 0 error. กลุ่มใหญ่สุด:

- `hooks/useExportOrchestrator.ts` ประมาณ 20 จุด เป็น `react-hooks/exhaustive-deps` โดยเฉพาะ `exportSnapshotRef`, `pendingReviewIndicesRef`, `allowUnreviewedExportRef`
- `hooks/useCleaningOrchestrator.ts` มี unused exports 8 ตัว
- `hooks/useWorkspaceController.ts` บรรทัด 3 unused import `useEffect`
- `lib/textBoxWidthLayout.ts` และ `lib/translationOverlay.ts` มี unused parameter `enableHyphenation`

ยังไม่พบอาการ runtime ใน session นี้. ความเสี่ยงคือ stale closure ใน export path ซึ่งเป็น path ที่เกี่ยวกับการันตีว่าหน้าถูกตรวจก่อนส่งออก.

ข้อเสนอ: จัดการ `useExportOrchestrator` ก่อน เพราะเกี่ยวกับ safety gate. ที่เหลือเก็บกวาดภายหลัง.

### F4. ตัวอักษรแปลเล็กกว่าต้นฉบับมาก (Observation, ยังไม่ยืนยัน)

จาก `03-translated.jpeg` ข้อความไทยในบับเบิลมีขนาดประมาณ 25-35% ของความสูง glyph ต้นฉบับ. ตัวเลขนี้ประมาณจาก screenshot ไม่ได้วัด pixel จริง.

ระบบขึ้นเตือน "ข้อความล้นพื้นที่หน้า" สองครั้งหลังยืนยันหน้า แสดงว่า overflow detection ทำงาน. จึงอาจเป็นพฤติกรรม shrink-to-fit ตามดีไซน์ ไม่ใช่ bug.

ต้องยืนยันบนหน้ามังงะจริงก่อนสรุป.

### F5. นารเรชันและ SFX ไม่ถูกแปล (Observation, ยังไม่ยืนยัน)

ภาพทดสอบมีข้อความ 3 กลุ่ม. หลังแปล มีเพียงบับเบิลที่ได้คำแปล. กล่องนารเรชันยังว่าง และ SFX แนวตั้ง `ドドド` ยังเป็นต้นฉบับ.

อาจเกิดจาก CTD ไม่ตรวจจับภาพสังเคราะห์ หรือภูมิภาคเหล่านั้นถูกจัดเป็น unconfirmed candidate. ต้องทดสอบหน้าจริง.

### F6. Extension polling 401 ทุกประมาณ 1 วินาที (Info)

Dev server log แสดง:

```
GET /api/extension/publish-back?sinceSeq=3&sinceEpoch=epoch_muvjnn9p_vmlemp 401
```

เกิดซ้ำทุกประมาณ 1 วินาทีตลอดการทดสอบ. มาจาก Chrome extension ที่มี pairing token เก่า ไม่ได้มาจากแท็บที่ผมทดสอบ. ไม่กระทบหน้าเว็บ แต่ทำให้ log รกและกิน request เปล่า.

ข้อเสนอ: ให้ extension หยุด poll หรือ backoff เมื่อได้ 401 ซ้ำ.

### F7. คลีนไม่หมด นารเรชันและ SFX ยังเหลือบนภาพคลีน (Medium, ยืนยันแล้ว)

ภาพคลีนของหน้าทดสอบยังมีข้อความ 2 จุดที่ remnant review ตรวจพบ (ตำแหน่งและตัวเลขอยู่ในหัวข้อ Remnant review). ตัวตรวจทำงานถูกต้อง แต่ผลลัพธ์การคลีนยังไม่สะอาดพอสำหรับหน้านี้.

ผลกระทบ: ผู้ใช้ที่กดอนุมัติภาพจะได้ภาพที่มีข้อความญี่ปุ่นหลงเหลือ และคำแปลไทยอาจทับข้อความเดิม.

ข้อเสนอ: ตรวจ heuristic ของ SFX และกล่องนารเรชันใน cleaning pipeline และเพิ่มเคสทดสอบภาพสังเคราะห์นี้เป็น regression fixture.

### F8. นำเข้า Glossary แทนที่รายการเดิมทั้งชุด (Low, ยืนยันแล้ว)

`SettingsModal.tsx` บรรทัด 1280 เรียก `onGlossaryChange?.(validEntries)` ด้วยรายการจากไฟล์โดยตรง ไม่ได้ merge กับรายการเดิม. ทดสอบจริง: มี 1 คำอยู่แล้ว นำเข้าไฟล์ 2 คำ ผลคือเหลือ 2 คำ.

ผลกระทบ: ผู้ใช้ที่นำเข้าไฟล์อาจทำรายการที่เพิ่มมือไว้หายโดยไม่รู้ตัว.

ข้อเสนอ: ระบุให้ชัดว่า import คือ replace หรือเปลี่ยนเป็น merge พร้อมยืนยันก่อนแทนที่.

### F9. Export ต้นฉบับข้าม review gate โดยไม่แจ้ง (Info, ยืนยันแล้ว)

เมื่อเลือก source เป็น "ต้นฉบับ" แล้วกด export ระบบไม่แสดง dialog review gate และดาวน์โหลดไฟล์ทันที. พฤติกรรมนี้ตรงกับ `lib/export/reviewGate.ts` ที่ข้ามหน้า `exportSource: "original"`.

ความเสี่ยง: ผู้ใช้อาจเข้าใจว่า export ทั้งเล่มผ่านการตรวจแล้ว ทั้งที่บางหน้าเป็นต้นฉบับและยังไม่ได้แปล.

ข้อเสนอ: แสดงสรุปในรายงานก่อนส่งออกว่ีกี่หน้าเป็นต้นฉบับ เพื่อความชัดเจน.

### F10. ดาวน์โหลด Layered pack ซ้ำสองไฟล์จากการสั่งครั้งเดียว (Low, ยังไม่ยืนยัน)

หลังสั่ง export Layered PSD หนึ่งครั้ง มีไฟล์ `SuperK_Layered_Photoshop_Pack.zip` ขนาด 106,559 bytes สองไฟล์ในรายการดาวน์โหลด. ยังไม่สามารถแยกได้ว่าเกิดจาก automation กดซ้ำหรือแอปสร้างดาวน์โหลดสองครั้ง.

ข้อเสนอ: ทดสอบมือบนเบราว์เซอร์ปกติหนึ่งครั้งก่อนสรุปเป็น bug.

### F11. ภาพที่ byte ซ้ำกันทำให้ React key ซ้ำ (Medium, ยืนยันแล้ว)

เมื่อมีสองหน้าที่ใช้ภาพต้นฉบับ byte เดียวกัน (handoff กับ synthetic เป็นไฟล์เดียวกัน) console ขึ้น error ซ้ำ:

```
Encountered two children with the same key, `data:image/png;base64,iVBORw0KGgo...`
```

DOM มี `[data-bubble-id]` 4 โหนดสำหรับ bubble 2 จุด (id ไม่ซ้ำกันแค่ 2 ค่า) และก่อนหน้านี้เคยเห็นหน้า handoff ปรากฏซ้ำ 3 หน้าโดยอธิบายไม่ได้. หลักฐานชี้ว่า key มาจาก data URL ของภาพทั้งก้อน.

ผลกระทบ: React อาจ reuse, omit หรือ remount โหนดผิดหน้า. ใน session นี้ยังไม่ทำให้ข้อมูลเพี้ยน แต่เป็นความเสี่ยงต่อการแก้ข้อความผิดหน้าและต่อการ reorder.

ข้อเสนอ: เปลี่ยน key เป็น id ของหน้า (index หรือ uuid) ไม่ใช่ data URL, และเพิ่ม test ที่มีสองหน้าภาพเหมือนกัน.

### F12. Export gate modal ไม่มี role="dialog" (Low, ยืนยันแล้ว)

dialog "มีหน้าที่ต้องได้รับการยืนยันก่อน Export" ตรวจจับด้วย `[role=dialog]` ไม่เจอ (ได้ 0) แต่เจอด้วย `.fixed.inset-0`. dialog อื่นเช่น Find/Replace, แก้ Mask, Logs มี `role="dialog"` ครบ.

ผลกระทบ: screen reader และ automation อาจไม่รู้ว่ามี modal เปิดอยู่ และ focus trap อาจไม่ทำงานสม่ำเสมอ.

ข้อเสนอ: ใส่ `role="dialog"`, `aria-modal="true"` และ `aria-labelledby` ให้ gate modal.

### F13. Find/Replace ไม่มี feedback หลังแทนที่ (Low, ยืนยันแล้ว)

กด "แทนที่ทั้งหมด" แล้ว dialog ปิด ข้อความเปลี่ยนจริง แต่ไม่มี toast บอกจำนวนที่แทนที่ และไม่มีข้อความว่า 0 รายการเมื่อค้นไม่พบ. ผู้ใช้ต้องเปิดหน้าหรือ review panel ตรวจเอง.

ข้อเสนอ: toast "แทนที่ N จุดใน M หน้า" หรือ "ไม่พบคำที่ค้นหา".

### F14. Ctrl+Z ใน Mask editor ต้อง focus ที่ canvas (Low, ยืนยันแล้ว)

dialog แก้ Mask เขียนว่า "Ctrl+Z เลิกทำ". ทดสอบจริง: กด "ล้างกรอบนี้" แล้วกด Ctrl+Z ทันที (focus ยังอยู่ที่ปุ่ม) ไม่เกิดอะไรขึ้น. เมื่อ focus canvas แล้วกด Ctrl+Z จึงย้อนกลับได้.

ผลกระทบ: ผู้ใช้ที่เพิ่งกดปุ่มแล้วกด Ctrl+Z จะเข้าใจว่า undo ใช้ไม่ได้.

ข้อเสนอ: ให้ handler ของ Mask จับ Ctrl+Z ที่ระดับ dialog ไม่ใช่เฉพาะ canvas หรือคืน focus ให้ canvas หลังกดปุ่มกระทำ.

### F15. ข้อความหลัง "อนุมัติจุดค้างทุกหน้า" สื่อความผิด (Low, ยืนยันแล้ว)

หลังกด "อนุมัติจุดค้างทุกหน้า" รายการหน้าถูกล้างจนว่าง แล้วขึ้นข้อความ:

```
ทุกหน้าที่ได้รับผลกระทบถูกเลือกส่งออกเป็นต้นฉบับหรือตัดออกจากการส่งออกแล้ว
```

แต่สิ่งที่เกิดขึ้นคือ "อนุมัติให้ส่งออกตามภาพและคำแปลปัจจุบัน" ไม่ใช่เปลี่ยนเป็นต้นฉบับหรือตัดหน้าออก. ข้อความนี้เป็น empty state เดียวกับกรณี "ส่งออกเป็นต้นฉบับ/ตัดหน้า" (WorkspaceModalsHost.tsx บรรทัด 607-611).

ข้อเสนอ: แยกข้อความตาม action สุดท้าย หรือใช้ข้อความกลาง ๆ ว่า "ไม่มีจุดค้างที่ต้องยืนยันแล้ว".

### F16. Strip export ใช้ชื่อเมนูว่า ZIP แต่ได้ไฟล์ JPG เมื่อไม่ต้องแบ่งส่วน (Info, ยืนยันแล้ว)

เมนูเขียน "Strip ภาพยาว (หลายส่วนรวม ZIP)" แต่กับ 2 หน้าได้ `SuperK_handoff_synthetic_LongStrip.jpg` 1200x3600 ไฟล์เดียว ไม่มี ZIP. น่าจะเป็นพฤติกรรมตามดีไซน์เมื่อภาพยาวไม่เกินขีดจำกัดการแบ่ง.

ข้อเสนอ: ระบุในเมนูว่า "ได้ JPG เดียว หรือ ZIP เมื่อแบ่งหลายส่วน".

## Incident during testing

1. รัน `npm test`, `tsc`, `lint`, `build` พร้อมกัน. Build ล้มด้วย EBUSY.
2. พบ asset 500 ทั้งหน้า. ตรวจ log และพบว่า dev server คือ `npm run dev`.
3. Kill dev server, start ใหม่. หน้าเว็บกลับมาปกติ console error 0.
4. ทดสอบ flow ผู้ใช้จนครบ.
5. หยุด dev, รัน build ใหม่สำเร็จ, ทดสอบ `npm start`, แล้วคืน dev server ตามสภาพเดิม.

ไม่มีไฟล์ใน repo ถูกแก้โดยผม. ไม่มี commit ถูกสร้าง. Commit `47a5777` และ `c2bd381` ปรากฏขึ้นระหว่างการทดสอบจาก process อื่น ไม่ใช่จากผม.

ระหว่างรอบสอง dev server ที่รันค้างอยู่จบการทำงานด้วย exit code 255 หลังรันมาหลายชั่วโมง ทำให้ port 3000 ปิด. ผม start `npm run dev` ใหม่แล้วทดสอบต่อได้ปกติ. ไม่พบ error ใน log ก่อนหน้าจบ และยังไม่ทราบสาเหตุที่แน่ชัด.

## Artifacts

- `docs/assets/2026-10-28-system-test/01-home.jpeg`
- `docs/assets/2026-10-28-system-test/02-cleaned.jpeg`
- `docs/assets/2026-10-28-system-test/03-translated.jpeg`
- `docs/assets/2026-10-28-system-test/04-export-gate.jpeg`
- ภาพทดสอบต้นฉบับ `C:\Users\PC\AppData\Local\Temp\opencode\synthetic_manga_page.png`
- Script สร้างภาพ `C:\Users\PC\AppData\Local\Temp\opencode\make_test_page.py`
- ไฟล์ export รอบสอง (temp ของ browser อาจถูกล้าง):
  - `SuperK_Page_001_synthetic_manga_page.jpg` 54,174 bytes
  - `SuperK_synthetic_manga_page.pdf` 59,097 bytes
  - `SuperK_synthetic_manga_page.zip` 54,352 bytes
  - `SuperK_Page_001_synthetic_manga_page.png` 50,538 bytes
  - `SuperK_Layered_Photoshop_Pack.zip` 106,559 bytes
  - `superk-glossary-2026-10-28.json` 70 bytes
- ไฟล์ export รอบสาม (temp ของ browser อาจถูกล้าง):
  - `SuperK_handoff_synthetic.zip` 105,060 bytes (2 หน้า, PNG + JPG)
  - `SuperK_handoff_synthetic.pdf` 126,124 bytes (2 หน้า)
  - `SuperK_handoff_synthetic.cbz` 84,072 bytes (3 WEBP + ComicInfo.xml)
  - `SuperK_handoff_synthetic.zip` 52,976 bytes (หลังอนุมัติจุดค้างทุกหน้า)
  - `SuperK_Page_002_synthetic_manga_page.webp` 28,432 bytes
  - `SuperK_handoff_synthetic_LongStrip.jpg` 201,210 bytes, 1200x3600
  - `SuperK_handoff_synthetic.superk.json` 892,920 bytes
- Trace `trace.json.gz` 183,085 bytes

## Recommended next steps

1. รัน flow เดิมบนหน้ามังงะจริงหนึ่งหน้า เพื่อปิด F4 และ F5.
2. เพิ่ม guard ให้ `npm run build` ไม่รันทับ dev server (F1).
3. แก้ `package.json` script `start` ให้ตรงกับ standalone (F2).
4. ตรวจ `useExportOrchestrator` dependency warnings (F3).
5. ให้ extension backoff เมื่อ publish-back ตอบ 401 (F6).
6. ปรับ cleaning ให้เก็บ SFX และนารเรชันให้หมด แล้วเพิ่ม regression fixture (F7).
7. ตัดสินใจเรื่อง import Glossary ว่าจะ merge หรือ replace (F8).
8. ทดสอบมือเรื่อง Layered pack ดาวน์โหลดซ้ำ (F10).
9. เปลี่ยน React key ของหน้าและ bubble จาก data URL เป็น id (F11).
10. เติม ARIA ให้ export gate modal (F12).
11. เพิ่ม feedback จำนวนจุดที่แทนที่ใน Find/Replace (F13).
12. ผูก Ctrl+Z ของ Mask กับ dialog และแก้ข้อความ empty state หลังอนุมัติ (F14, F15).
