# ZCode Working Notes — SuperK / Manga Translator

<!-- session-index:auto:start -->
## 📇 ดัชนีแชตอัตโนมัติ (Stop hook — ห้ามแก้มือ)

อัปเดตอัตโนมัติจากฐานข้อมูล ZCode ทุกครั้งที่ AI ตอบจบรอบ (ใหม่→เก่า, สูงสุด 120 รายการ) — แชตไหนหายจาก UI ให้ยก session id ในรายการนี้ให้ AI เพื่อกู้คืนเนื้อหาเต็มจากฐานข้อมูล

- 11 พ.ย. 00:39 · `f7ef473c` · "แชตผมหายอะ" · ✅ · ↳ "โอเค"
- 11 พ.ย. 00:38 · `08404601` · "ติดตั้งโปรเจกต์ rea จาก GitHub" · ✅ · ↳ "โอเค"
- 7 พ.ย. 00:15 · `d62433fd` · "เปิด Fast Startup แก้ Windows Defender สแกน 4.8GB ทุกครั้ง" · ✅ · ↳ "ok"
- 4 พ.ย. 01:39 · `f7c2c32c` · "แก้ระบบแปลจับข้อความไม่หมด (pstack-poteto-mode)" · ✅ · ↳ "com push"
- 31 ต.ค. 00:22 · `dd65c0e3` · "GLM-5.3-Flash Empty Response Error" · ✅ · ↳ "เป็นไงบ้าง"
- 31 ต.ค. 00:21 · `c53b6e6f` · "มันแปลได้ไม่ครบ เราจะแก้ได้ยังไงหรอ กดแปลใหม่อีกรอบก็แล้ว" · ✅ · ↳ "next.js มีอัพเดตไหม"
- 30 ต.ค. 23:25 · `6dc85d7a` · "มันแปลได้ไม่ครบ เราจะแก้ได้ยังไงหรอ กดแปลใหม่อีกรอบก็แล้ว" · ⚠️ · ↳ "มันแปลได้ไม่ครบ เราจะแก้ได้ยังไงหรอ กดแปลใหม่อีกรอบก็แล้ว"
- 29 ต.ค. 23:33 · `a2b81cc1` · "แปลแล้วมีข้อความเดิมซ้ำกัน เราจะแก้ยังไง" · ⚠️ · ↳ "The model returned no content (often caused by captcha not completed, an expired token, or plan issues). Send again and captcha verificatio…"
- 29 ต.ค. 23:32 · `4ff45742` · "เทสๆ" · ⚠️ · ↳ "เราช่วยไปดูงานคลีนและช่วยปรับให้มันไม่ไปจับเส้นตัวละครได้ไหม เอางานล่าสุดที่ผมทำค้างไว้นะ Worked for 1m 18s Thought · a few seconds รับทราบ…"
- 27 ต.ค. 22:55 · `461c0b5e` · "[$pstack-poteto-mode](C:\\Users\\PC\\.zcode\\skills\\psta..." · ⚠️ · ↳ "[$pstack-poteto-mode](C:\\Users\\PC\\.zcode\\skills\\pstack-poteto-mode\\SKILL.md)"
- 27 ต.ค. 22:49 · `f8d5072f` · "[$pstack-poteto-mode](C:\\Users\\PC\\.zcode\\skills\\psta..." · ⚠️ · ↳ "[$pstack-poteto-mode](C:\\Users\\PC\\.zcode\\skills\\pstack-poteto-mode\\SKILL.md)"
- 3 ต.ค. 01:20 · `b3119b06` · "ช่วยรีวิวระบบของผมทั้งหมดหน่อย" · — · ↳ "ทำไหมแปลแล้วมีข้อความซ้อน เราจะแก้ยังไง"
- 7 ก.ย. 02:00 · `bccfc281` · "รีวิวระบบหของผมหน่อย" · — · ↳ "เขียนแผนงานมา"
<!-- session-index:auto:end -->

บันทึกประวัติการทำงานของ ZCode ทุก session เรียงจาก **ใหม่ไปเก่า** (ไฟล์นี้แยกจาก `docs/AI-WORKING-NOTES.md` ซึ่งห้ามแตะตามกฎเดิม — ไฟล์นี้คือฉบับของ ZCode)

กติกา: จบ session ไหนให้เพิ่ม entry ใหม่ **ด้านบนสุด** ของรายการ โดยระบุสิ่งที่ทำ หลักฐาน/ผลตรวจ สถานะ commit และลิงก์เอกสารละเอียดถ้ามี

---

## Screentone fast-path 3 เฟส ตามพิมพ์เขียววิศวกรรมย้อนกลับ (poteto-mode, gate ตัวเลขทุกเฟส) — 2026-11-11

### Status: ครบ 3 เฟส CI เขียว (98a2d12 + 7a992dd + 3d001fd, run 42866258198) — รอผู้ใช้พิสูจน์หน้าจริง

- **ที่มา:** ผู้ใช้ส่งพิมพ์เขียว (Downloads/พิมพ์เขียววิศวกรรมย้อนกลับ_ระบบฟื้นฟูเม็ดสกรีนโทน...md) ให้รีวิว → รีวิวแล้วเสนอทำเป็น 3 เฟส gate ด้วยตัวเลขจริง → ผู้ใช้ไล่อนุมัติทีละเฟส
- **Phase 1 detector (98a2d12):** `app/screentone.py` — Hanning+FFT+fftshift+กด DC+พีกคู่สมมาตร; เกณฑ์ σ>60 + prominence>55 (คั่นกลาง noise ceiling 8.14 / halftone floor 379.4); ฟื้น P คลาด ≤0.78% มุม ≤0.26° บน synthetic; ภาพจริง 80 patch (public/comparison) flag 17/35 บน clean_page_38 ด้วยลายเซ็น P=15.06px θ=180° ซ้ำเป๊ะ
- **Phase 2 synthesis (7a992dd):** `app/screentone_synth.py` — คลื่น §3.1 + ค้น phase จากวงแหวน (สิ่งที่พิมพ์เขียวขาด) + density §3.2 + feather §3.3 บนช่อง LAB L; ผลลัพธ์ re-detect ได้ (P คลาด 2.90% มุม 0.50°), phase หาย้อนคลาด 0.25px, seam error เนียนกว่า zero-phase 5.2 เท่า, density delta 0.542 gray
- **Phase 3 wiring (3d001fd):** เกตใน `tier_router.py` กิ่ง TIER_3_NEURAL — region ที่ยืนยันโทนใช้ "screentone_fast" (~7.2ms รวมทุกขั้น เทียบ neural 200-800ms ตาม claim เอกสาร) tier คง label เดิม, ไม่แตะ enum/route, mask ชิดขอบ (ring ว่าง) ตกกลับ Tier 3 เดิม; fixture เทสต์เดิม 2 ตัวที่ใช้ grid period-4/3 ถูก detector จับตามสัญญา จึงแก้ fixture เป็น noise ไม่มีคาบ (ยึดเจตนาเดิมของเทสต์)
- **หลักฐาน:** suite เต็ม ocr-service 301 passed + ruff สะอาด + CI เขียวทั้งสอง job; ทุกเฟส delegate ให้ poteto-agent แล้วผู้คุมรีวิว+รันยืนยันเอง
- **ข้อจำกัดรู้ตัว:** 1) seam step 56.61/60 ตัวจำกัดคือ bin quantization ของ FFT — ถ้าหน้าจริงเห็นรอยต่อ ให้เพิ่ม phase_search_steps หรือ refine มุม sub-bin 2) DC radius ตามเอกสารมองไม่เห็นโทนหยาบ P≳16px (ภาพจริงเจอ P=15.06 ใกล้ขอบ) 3) ยังไม่ได้พิสูจน์บนหน้าจริงทั้งเล่ม — rebuild ผ่าน launcher แล้วทดสอบรอบคลีนจริงคือขั้นยืนยันสุดท้าย 4) เอกสารอ้าง latency neural 200-800ms กับ fast 18-45ms เป็นตัวเลขผู้เขียนเอกสาร ยังไม่ได้วัดในระบบจริง (วัดได้เฉพาะ synth ~6.7ms บน fixture 100²)

---

## แก้ระบบ mask เสนอลบ SFX/โน้ตดนตรี (ภาพ #1 #4 #10 ของผู้ใช้) — 2026-11-10

### Status: แก้แล้ว CI เขียว (f46d50e + ece4dda, run 42664955088) — รอพิสูจน์หน้าจริงจากผู้ใช้

- **อาการ:** MaskEditor เสนอ mask แดงทับโน้ตดนตรีในบับเบิล (#1) และตัว SFX บนพื้นหลัง/สกรีนโทน (#4 #10) — ต่อเนื่องกับงานค้าง solid-artwork ใน notes
- **Root cause (สืบสายด้วย Explore agent):** 1) `text_eligibility.py` ตรวจ SFX **หลัง** สาย caption (rectangular/uniform backing) ทำให้ SFX บนการ์ดสี่เหลี่ยม/แผงสกรีนโทนถูกจัด NARRATION → CLEAN 2) mask head เก็บหมึกทึบใน region DIALOGUE ทั้งหมด รวมสัญลักษณ์ (โน้ต) — ไม่มีชั้นแยกศิลป์ทึบเลย (textRole "sfx" มีใน types แต่ไม่มีใครใช้; sfxPolicy.ts อ่านเฉพาะสายแปล)
- **Fix 1 — จัดลำดับ SFX (f46d50e):** เช็ค SFX ก่อนสาย caption เมื่อ `rectangular_backing < SFX_RECTANGLE_CEILING (0.85)`; การ์ดแน่น ≥ 0.85 ยังชนะเป็น NARRATION ตามเดิม (ทดสอบ enclosed_backing คุมไว้) label SFX คงเกณฑ์เดิม (≥0.90 + enclosure <0.5) เพราะ textRole "sfx" ถูกใช้กันข้อความออกจาก scope การแปล — ติดป้ายรวดเร็วเกินจะเสียการแปลของข้อความจริงบนเสื้อผ้า (ทริปนี้เจอจากทบทวนข้ามระบบ ย้อนการเปลี่ยน label ของตัวเองใน ece4dda)
- **Fix 2 — แยกสัญลักษณ์ทึบ (f46d50e):** โมดูลใหม่ `ocr-service/app/solid_symbols.py` peel ก้อนทึบ (area ≥120, ฝั่งสั้น ≥12px, fill ≥0.72, รูว่าง ≤2%, และ **ไม่เกินครึ่งของหมึกทั้ง region**) ออกจาก mask ของ region CLEAN ไปไว้ใน protected — ไม่ถูก inpaint ทุกโหมด รวม all-text; pixel จาก rescue (`rescued_mask` เพิ่มใน RefinedMask) ถูกยกเว้นเสมอ กันท่อ rescue โดน peel กิน
- **หลักฐาน:** เทสต์ใหม่ 8 ตัว (solid_symbols) + 3 ตัว (eligibility) ทำแดงก่อนแก้; suite เต็ม ocr-service 275 passed + ruff สะอาด; CI ทั้งสอง job เขียว
- **ข้อจำกัดตรง ๆ:** ยังไม่ได้พิสูจน์บนหน้าจริงของผู้ใช้ (เข้าถึงภาพเล่มจริงไม่ได้) — โน้ตที่ใหญ่เกินครึ่งของหมึก region จะยังหลุด (หายเป็น "ไม่จับ" ไม่ใช่ "จับเกิน") ให้ผู้ใช้ทดสอบรอบคลีนจริงแล้วรายงานกลับ; งานค้าง client-side solid-artwork triage (แก้ fixture 5 จุดก่อน) ยังรอตามแผนเดิมในไฟล์นี้

---

## Fix CI แดง: เบนช์มาร์กวัดเวลาไม่นิ่งบน runner (CI ตายมาตั้งแต่ 6 พ.ย.) — 2026-11-09

### Status: แก้แล้ว CI เขียว (run 42655914303 ผ่านทั้งสอง job)

- **อาการ (ผู้ใช้แจ้งภาพ):** CI / Frontend (tsc + eslint + vitest) Failing — `gh run view --log-failed` เจอจุดเดียว: `tests/unit/workspacePerformanceAndRepair.test.ts:104` assert `optimizedMs < legacyMs / 10` วัดเวลาจริงบน runner ปลอดภัย → ครั้งนี้ได้ 9.2× (289ms vs 2672ms) พังขอบ อีก 2,154 เทสต์ + tsc + eslint ผ่านหมด
- **Root cause:** assertion วัด wall-clock ratio บนเครื่องแชร์ เจตนาของเทสต์ ("ตัด JSON.stringify 42MB ทิ้ง") พิสูจน์ด้วยขนาด payload อยู่แล้ว (42MB → 8KB) เส้นเวลาจึงเป็นเกตที่แกว่งไม่เพิ่มความมั่นใจ
- **Fix (commit `5556264`):** ตัด assertion เวลา ใส่ spy นับ `JSON.stringify` payload-scale (>10k chars) ระหว่างรอบ optimized ต้องได้ 0 ครั้ง — deterministic ทุกเครื่อง เวลาเก็บไว้เป็น log เพื่อคนอ่านเท่านั้น; เทสต์เบนช์มาร์กตัวอื่นในไฟล์ (exportImageBlob) ตรวจ correctness อย่างเดียวอยู่แล้วไม่มีเกตเวลา
- **หลักฐาน:** เทสต์ไฟล์นี้ผ่านซ้ำ 3 รอบ tsc/eslint 0 error push แล้ว CI run 42655914303 เขียว (Frontend 4m58s, Backend 54s) — เป็นการยืนยันบน surface จริง (CI) โดยตรง
- **หมายเหตุรอแก้ (ไม่ด่วน):** annotation เตือน actions/checkout@v4 กับ setup-python@v5 ถูกบังคับรันบน Node 24 เพราะ Node 20 deprecated — อัปเกรด action เวอร์ชันใหม่วันหลัง

---

## ตรวจงาน commit 1f556e5 (split view + compact handles + mask audit + pronoun matrix) — 2026-11-09

### Status: ตรวจแล้ว ผ่าน 3 ใน 4 ช่องทาง runtime + เทสต์คงที่ครบ

- **ที่มา:** ผู้ใช้ขอตรวจ+ทดสอบงานล่าสุด → commit `1f556e5` (22:46) รวมงานค่ำนี้ทั้งหมด (และห่อ fix ปุ่มลูกศร `lg:left-20` ของ session นี้ไปด้วย)
- **คงที่:** vitest 7 ชุด 202/202 ผ่าน (usePageZoom 266 บรรทัดเทสต์ใหม่, translationOverlay, aiMaskInspector, MaskEditorAllButtons, pageViewer, PageZoomToolbar, WorkspacePage) + `tsc --noEmit` 0 error
- **Runtime A — split-view fit ต่อ pane (ผ่าน):** วัดจริง viewport 1150 ภาพ 365×548 ใน pane 558×548 (fit จำกัดด้วยความสูงพอดี) กลับ single view รีฟิต 376×564 ป้ายซูมตามจริง 46%↔47%
- **Runtime B — compact handle outset (ผ่าน):** บับเบิล 47×36 เลือกแล้ว 4 handle อยู่นอกกล่องทั้งหมด (หมุนซ้าย 11px/บน 35px, ขยายขวา 9px/บน 35px, ย้ายใต้ 14px) Scale↔Width ห่างแนวตั้ง 78px ไม่ทับตัวหนังสือ — ภาพหลักฐานบันทึกใน artifacts
- **Runtime C — ปุ่ม AI ตรวจ/เทียบ Mask:** ตรวจได้ระดับ component (ชุด MaskEditorAllButtons เรนเดอร์ MaskEditor จริง ผ่านครบ) ลองปลอมผลคลีนลง IDB เพื่อกดปุ่มจริงแต่แอปทิ้งข้อมูลเพราะ sourceHash ไม่ตรง fingerprint จริงของภาพ จึงยืนยันบน UI จริงไม่ได้ในรอบนี้
- **หมายเหตุ:** handle ที่วัดได้ 18px (element ที่มี title) ต่างจากบันทึกใน AI-WORKING-NOTES ที่อ้าง 30px — น่าจะวัดคนละชั้น (icon กับปุ่มครอบ) ไม่ใช่ฟังก์ชันพัง; :3000 เป็น build 21:41 ยังไม่มี split-view centering ต้อง rebuild ผ่าน launcher อีกรอบ

---

## Fix ปุ่มเปลี่ยนหน้าทับ rail เครื่องมือตอนจอแคบ (ช่วง lg–xl) — 2026-11-09

### Status: แก้แล้ว พิสูจน์บนเบราว์เซอร์จริง (pageViewer tests 4/4)

- **อาการ (ผู้ใช้แจ้งพร้อมภาพ):** ย่อจอเล็กแล้วปุ่มวงกลมลูกศร "<" ทับกลาง rail เครื่องมือซ้ายจอ ปิดปุ่มกลาง rail
- **Root cause (พิสูจน์ด้วย rect จริง):** ปุ่มหน้าก่อนหน้าใน `PageViewer.tsx` ขยับหนี rail ด้วย `xl:left-20` แต่ `StudioToolbar` (`WorkspaceCanvasHost.tsx:1004`) ใช้ `hidden lg:flex` แสดงตั้งแต่ 1024px → ช่วง 1024–1279px ทั้งสองอยู่ `left-3/sm:left-6` กลางแนวตั้ง z-30 เท่ากัน วัดจริงที่ 1150×800: arrow x28–76 ทับ rail x12–68 (`overlap=true`, ปิดปุ่ม "ค้นหาและแทนที่คำ")
- **Fix:** `xl:left-20` → `lg:left-20` (ขยับหนี rail ตั้งแต่ rail มีอยู่) + อัปเดตเทสต์ `tests/unit/pageViewer.test.tsx` จาก `xl:left-20` เป็น `lg:left-20`
- **หลักฐานหลังแก้:** วัดจริง 3 ขนาด — 900px: rail ซ่อน (parent hidden) arrow x28, 1150px: arrow x96 ห่าง rail 28px, 1280px: arrow x96 ไม่ชน (`overlap=false` ทั้งหมด) บน dev server :3001 (production :3000 ยังเป็น build เก่า ต้อง rebuild ก่อน)
- **ยังไม่ commit:** `PageViewer.tsx` มี in-flight edits ร่วมจาก session อื่นปนอยู่ ให้ผู้ใช้เลือกจังหวะ commit เอง

---

## โครงร่างค้าง: auto-triage "งานศิลป์ทึบ" ใน remnant review — ชน fixture language — 2026-11-06

- **โจทย์:** จุดรีวิวที่เป็นงานศิลป์ชัด ๆ (ก้อนทึบ, เส้นคู่โครงสร้าง, streaks, รูปหัวใจ — ภาพ #7-#10 จากผู้ใช้) ยังถูกโยนเข้าลิสต์ "จุดสงสัย" ให้รีวิวมือ
- **ดีไซน์ที่ลองแล้ว (revert แล้ว — อย่าเริ่มใหม่แบบเดิม):** ใน `backgroundRemnantInspection.ts` เพิ่มผู้เล่น component ของ surviving ink (largest component fill/share) แล้ว triage `fill ≥ 0.6 + share ≥ 0.3 + area ≥ 64` → state human-confirmed-artwork/detail `solid-artwork` — ผล: **เทสต์เดิม 5 ตัวแตก** เพราะ fixture ของชุดทดสอบสร้าง "ข้อความ" เป็น**สี่เหลี่ยมทึบล้วน** (fill 1.0) → เกณฑ์ก้อนทึบจับ fixture "ข้อความ" ของชุดทดสอบเอง
- **แนวทางที่ถูก (session ถัดไป):** (1) อัปเดต fixture 5 จุดให้ text-like จริง (punch holes/counters ให้ fill ~0.3-0.5 ตาม glyph จริง) — แก้ 5 เทสต์: cache-bind, untouched-text, preserved-unresolved, evidence-invalidate (+1) (2) แล้วค่อยใส่ triage เฉพาะสาย preserved/unchanged (ห้ามแตะสาย full/partial-glyph ของ removal region — ของจริงที่คลีนไม่ออกต้องรีวิวเสมอ) (3) persist ผ่าน loop ใน inspectPageRemnants (โครงเดิมที่ revert ไว้: confirm ด้วย rect เมื่อ detail === "solid-artwork")
- **ระหว่างนี้:** ปุ่ม "ยืนยันเป็นลายภาพ" STICKS แล้วหลัง fix respawn (165b0d8/01ab43f) — กดครั้งเดียวต่อจุด ไม่กลับมา

---

## AI Mask assist ยกระดับ: content re-derivation (ทาง A) — 2026-11-06

- **โจทย์ (ผู้ใช้เลือกทาง A):** Local Smart AI เดิม polish เฉพาะวง 8px รอบ mask เดิม — mask ฟ่องจึงฟ่องเดิม (+3,588 px ป้องกันปลายนิ้ว แต่มือ/พื้นหลังยังถูกลบ)
- **แก้ (`160d92e`):** โมดูลใหม่ `lib/cleaning/maskRederive.ts` — `rederiveRegionMaskFromContent` ตั้ง mask ใหม่จากเนื้อหา: **enclosed light region** (บับเบิล/กล่องขาวปิดสนิท) + **dark strokes ในนั้น** + **chroma strokes** (ตัวอักษรมีสี) = text zones; แสงที่แตะขอบ crop = outside paper (unknown — mask เดิมคงอยู่); dark ink ติดกระดาษ (มือ/เส้นขอบ) inherit จากเพื่อนบ้าน 1 รอบ = unmask; MaskEditor รัน re-derive **ก่อน** local audit แล้วโชว์ diff เทียบ mask ของผู้ใช้เอง
- **พิสูจน์:** fixture 3/3 (bubble+lettering คงอยู่, hand-outline unmask, โซน unknown ไม่แตะ — บทเรียน: jsdom ImageData.data ไม่ surface indexed writes → ต้อง build typed array แล้ว wrap ตอนท้าย; และ mutation ผ่าน wrapper ไม่ค้าง) + พิสูจน์บน region-4 จริง (crop 181×245): suggestion เหลือเฉพาะตัวหนังสือทั้งสองก้อน, removed 13,882 px, มือ/เส้นเพดาน/กล้องครบ — ภาพ: scratch/rederive-region4.png
- **การใช้งาน:** ปุ่ม "AI ตรวจ/แก้นีน Mask" เดิมตอนนี้จะ re-derive ก่อน polish (Local Smart AI ยัง polish บน mask ใหม่ที่ถูกต้องแล้ว); ผู้ใช้ปรับ Dilation ขยาย stroke ให้เต็มบับเบิลได้จากสไลเดอร์เดิม; Gemini assist ยังอยู่ครบ
- **เกรดติด:** บับเบิลถูกขอบ crop ตัด = โซน unknown (mask เดิมคงอยู่) — ระวังตอน region rect ตัดกลางบับเบล; ถ้าอยากได้ interior ทั้งบับเบิล ใช้ Dilation slider ขยาย

---

## ปิด respawn hole ทั้ง 4 หลุมที่เหลือ — 2026-11-06

- **หลุม + แก้ (`01ab43f`, ทั้งหมด red→green):** (1) confirmedRects ไม่ persist → เก็บ rect บน confirmation pair เดียว (`{candidateId, revisionKey, rect}`) + `replacePage` re-seed spatial store ตอน restore — reload+reclean ไม่ respawn อีก (2) แก้ bubble list wipe ทั้ง store → `invalidateRevisionsKeepingRects` (การแก้ bubble ไม่เกี่ยวกับการอนุมัติงานศิลป์ตำแหน่ง) (3) unconfirm ทิ้ง id-bound pair ให้ recheck ชุดเดิมชุบชีวิต → `unconfirmRect` รับ confirmation แล้วลบทั้งคู่ (4) กดยืนยันระหว่าง inspect in-flight เงียบ → toast "กำลังตรวจสอบพื้นหลังอยู่..."
- **บั๊กแฝงที่ fix นี้ทำให้เห็น (แก้ด้วย):** `inspectPageRemnants` rebind แก้ `inspection.candidates` ในที่ (object จาก shared cache by reference) → approval ถูกอบใน cache ร่วม → unconfirm ไม่มีทางสำเร็จ + confirmation รั่วข้ามหน้าที่ revision identity เดียวกัน — แก้ด้วยการ rebuild object แทน mutate
- **ข้อจำกัดที่ยังเปิด:** IDB round-trip จริงถูก mock ในเทสต์ (metadata ทั้ง object ถูกเก็บไม่มี whitelist จึงประเมินผ่าน store-level + mocked hook path); fingerprint จริงรันเฉพาะ test-mode
- **ตัวเลข:** cleaning + watchdog + controller suites 435/435, tsc 0 — staged แบบแยก hunk อีกครั้ง (useCleaning.ts มี hunk แปล message ของอีก session ปนอยู่ ไม่รวม)
- **การ deploy:** fix เป็น client bundle — ให้ผู้ใช้ rebuild ผ่าน launcher (รวมกับ fix สะสม: toast, toolbar lg, remnant clean fallback)

---

## Remnant spot "กดแล้วกลับมาอีก" — ตรวจจับและแก้ 2026-11-06

- **อาการ:** ใน RemnantReviewPanel กดปุ่มบน candidate card (จุดเส้นทแยงมุมดำ) แล้วจุดเดิมกลับมาโชว์เหมือนเดิมตลอด (crop ต้นฉบับ/หลังลบ เหมือนกันเป๊ะ)
- **ราก (explorer ยืนยัน + ผม verify ทั้ง 3 จุด):** ปุ่มคลีนจุด → `createInkMaskBlob` → `extractGlyphInk` จัดเส้นบางเป็น artwork (fill < ULTRA_SPARSE_FILL 0.06) ทิ้งหมด → mask ว่าง → service ปฏิเสธ ("authorized mask is empty") → `handleCleanCandidate` **toast สำเร็จทั้งที่ล้มเหลว** → pixel ไม่เปลี่ยน → inspection ครั้งหน้าเจอจุดเดิม → วนไม่รู้จบ (ยืนยันลายภาพไม่เกี่ยว — flow คลีน unconfirm ก่อนเสมอ)
- **แก้ (`165b0d8`):** (1) `createInkMaskBlob` fallback — เมื่อ extraction ว่าง ยกเลิก artwork-rule เฉพาะ caller นี้ (`keepAllComponents`) เพราะเป็นคำตัดสินของผู้ใช้บนจุดที่รีวิวแล้ว (2) ทั้ง clean/restore handler เช็คผล handleRetryRegion แล้ว toast error จริงแทน success ปลอม
- **หลุมอื่นที่ explorer ขุดพบ ยังไม่แก้ (จดไว้ทำรอบหน้า):** rects ของ confirmation ไม่ persist (reload+reclean = respawn ทั้งหน้า), `setPageRemnantTextEvidence` wipe ทั้ง store เมื่อ bubble list เปลี่ยน (id เป็น positional index), unconfirm เหลือ id-bound entry ทำ card กลับเป็นยืนยันเอง, confirm ระหว่าง inspection in-flight เป็น no-op เงียบ ๆ
- **ตัวเลข:** maskUtils 14/14, useWorkspaceController + cleaning 414/414, tsc 0

---

## ปิด residual sweep ใน production ถาวร — ตัวกระดาน "จางครั้งที่สอง" — 2026-11-06

- **อาการต่อ:** หลัง glyph-shape filter (7a5c78b) ผู้ใช้ยังเจอรอยที่มุมกล้องมือถือ + เส้นนิ้ว (ยังโดน 178 px) — component ที่เหลือคือก้อนทึบเล็ก/เส้นโค้งสั้นที่หน้าตาเหมือน glyph จนเกณฑ์รูปร่างแยกไม่ได้
- **ตัดสินใจ:** ตรรกะ "ของเข้มไม่เปลี่ยนแถว ๆ ข้อความ = ข้อความที่พลาด" แยกจากงานศิลป์ manga ไม่เด็ดขาดโดยธรรมชาติ (เส้น → กล้อง → จะมีรอบถัดไป) ขณะที่ recovery แบบ crop + review flow รับชีวิตข้อความพลาดแล้ว → **ปิด sweep ใน production** (`b6af571`: ลบ env จาก service-start.ps1 + run.ps1; โค้ด + เทสต์คงอยู่ เปิดใหม่ได้ผ่าน SUPERK_RESIDUAL_SWEEP=1)
- **บทเรียนการ deploy env:** แก้ service-start.ps1 แล้ว uvicorn เก่ายังจับ flag เดิมสองชั้น — (1) watchdog dot-source ฟังก์ชันไว้ในหน่วยความจำตั้งแต่ตอน spawn (ต้อง restart watchdog ด้วย) (2) launcher ข้าม start ocr เมื่อ port มีเจ้าของ (ต้อง kill uvicorn เอง) — ตรวจสอบเสมอด้วย sweep_runs ใน timings ของ job ใหม่ ไม่ใช่สมมุติว่าโค้ดใหม่ทำงาน
- **พิสูจน์ปลายทาง:** re-clean หน้าเดิม — sweep_runs 0, **unmasked faded px = 0** (จาก 20,105), กล้องมือถือ/เส้นเพดาน/screentone ครบ ภาพเทียบ: scratch/fading-sweep-off.png
- **ผลข้างเคียงที่ยอมรับ:** ข้อความที่ CTD mask head พลาดภายใน region (ที่เคยอาศัย sweep) จะไม่ถูกกวาดอัตโนมัติอีก — ทางลัดคือ re-clean/force-clean จุดนั้นผ่าน review flow หรือ mask editor

---

## "คลีนแล้วส่วนอื่นจางลง" — residual sweep กวาดเส้นโครงสร้าง แก้แล้ว — 2026-11-05

- **อาการ:** คลีนแล้วเส้น/โทนในบริเวณอื่น (นอก mask) จางลง — วัดจาก job จริง (d2ab5801, region-4): pixel เปลี่ยนนอก mask 23,447 px, กระจุกในวง region+24px (18,056 px = 9.25% ของวง), **unmasked dark→lighter 20,105 px** = เส้นเพดาน/ขอบ/screentone ถูก inpaint
- **ราก:** residual sweep กวาด "unchanged dark component ≥40px ใน region rect+pad24 ทั้งหมด" โดยไม่กรองรูปร่าง — เส้นโครงสร้าง (aspect 52.8/11/14.5) กับก้อน screentone (fill 0.11-0.20) โดนหมด
- **แก้ (`7a5c78b`):** กรองเฉพาะ glyph-like ink — bbox aspect < 8 และ fill ≥ 0.25 (เส้นยาว + ก้อนโปร่งถูกข้าม ตัวอักษรแน่นยังโดนกวาด) — RED ก่อน: fixture เส้นตัดโซน + glyph (fixture ต้องพื้นสว่าง — พื้นเข้มสม่ำเสมอทำ component เดียวรวมกันหมด บทเรียน fixture) → GREEN, suite 263 passed
- **พิสูจน์หน้าจริง:** re-clean หน้าเดิมหลัง restart service — sweep_px 29,413 → **729** (เหลือ glyph จริง), unmasked faded **20,105 → 643 (−97%)**
- **หมายเหตุระบบ:** แก้ pipeline เป็น server-side — service restart (ผ่าน watchdog flow) แล้วใช้ได้เลย ไม่ต้อง rebuild bundle; ผู้ใช้กดคลีนหน้านั้นใหม่ก็หายจาง; watchdog ตัวเก่า (00:46) ตายเงียบเองระหว่างวัน (log ไม่มี stand-down) — ต้องติดตามเรื่องความอยู่รอดของ watchdog เองด้วย

---

## DEFECT เปิด: mask โลโก้หน้าปก (white-on-dark) คลุมตัวถังเข้มทั้งก้อน — 2026-11-05

- **อาการ (ผู้ใช้รายงาน):** หน้า 1 ของ 638800 region-12 = บล็อกโลโก้ชื่อเรื่อง 3 อัน (パパのこと/好きになるとか/ありえない — ตัวอักษรขาวบนถังโลโก้สีเข้ม) — re-clean แล้ว mask คลุม**ตัวถังเข้มทั้งก้อน** ไม่ใช่ตัวอักษร → ถ้าคลีนจะลบงานศิลป์ทิ้ง ผู้ใช้แก้ด้วยปุ่ม **Protect** ได้ทันที (คืน pixel + ปกป้องถาวร)
- **หลักฐานที่วัด (job สด 5effecf6 หน้า 1):** region-12 (494,1133,457×342) = **dialogue/clean conf 0.90**, mask density 53%; overlay (scratch/logo-block-overlay.png) แสดง mask เกาะตัวถังเข้ม ตัวอักษรขาวไม่ถูก mask
- **สมมติฐานที่ทดแล้วหักทั้งหมด (อย่าเริ่มใหม่):** (1) light-inside-mask ไม่แยก — dialogue ปกติ 0.62 สูงกว่าโลโก้ 0.27 เพราะ mask บับเบิล dialogue คลุม interior สว่างถูกต้องตามการคลีนบับเบิล (2) เกาะสว่างที่ถูก mask ล้อม — glyph ต่อถึงขอบ region ไม่เป็นเกาะ (share 44%+42% แตะขอบ) (3) ตัวเลข dark=0.31 กับ dialogue 0.18 ใกล้กันเกินตัด
- **รากที่ชี้ได้:** CTD seed เองชี้ตัวถังเข้ม (seed polarity ผิดบนตัวอักษรขาวบนพื้นเข้ม) — แก้ต้อง re-evaluate polarity/seed ใน refine stage ซึ่งกระทบ mask ทุกหน้า (43 jobs baseline ทำงานดี) → **จัด session เฉพาะ ไม่เอา heuristic กึ่งกลางคืน**
- **แก้รอบนี้แล้ว:** guidance ของ confirm-text gate เสนอ Protect เป็นทางเลือกสำหรับโลโก้/ปก (`899d55d`) + ทางแก้ปลวกก่อนหน้า `374c185` (ชี้ปุ่มยืนยัน)
- **ทางแก้ตัวจริงที่เสนอ (session หน้า):** ใน refine stage — เมื่อ seed ชี้ solid blob เข้มและมี stroke-like inverse ข้างใน ให้ทดสอบ hypothesis สลับ polarity เฉพาะจุด (เทียบ text-likeness ของ component ทั้งสองฝั่ง) พร้อม fixture สังเคราะห์ white-on-dark + regression 43-job

---

## "confirm text before approving its removal mask" — บันไดสิทธิ์ทำงานถูกแต่ข้อความไม่บอกทาง — 2026-11-05

- **เหตุการณ์:** ผู้ใช้แก้ mask จุด #2 (หน้า 2/638800 — หน้า credit) แล้วบันทึก → client ยิง FORCE_CLEAN → service ปฏิเสธ (`pipeline.py:917-918`) เพราะ region ยังไม่เคยยืนยันข้อความ — raw ValueError ลอยขึ้น toast ตรง ๆ
- **บันไดสิทธิ์ทำงานถูก design:** อนุมัติ mask ลบได้เฉพาะเมื่อยืนยันข้อความแล้ว (กันลบข้อความที่ยังไม่รีวิว) — ปุ่มจริงคือ **"ยืนยันว่าเป็นข้อความ"** ในหน้าต่างแก้ Mask (granular authorization row)
- **แก้ (`374c185`):** handleFailure แมป `/confirm text before/` เป็นคำแนะนำไทยที่ชี้ปุ่ม + ทางเลือก re-clean — เทสต์แดงก่อน (39/39) ปิดท้าย tsc 0
- **โน้ต:** ข้อความ toast ใหม่จะขึ้นหลัง rebuild ถัดไป (bundle ปัจจุบัน = build 00:46) — ทางแก้ปัญหาตัวจริง (กดปุ่มยืนยัน) ใช้ได้ทันทีไม่ขึ้นกับ bundle
- บริบทหน้า 2: fresh job พิสูจน์แล้วว่า title/tags/credits = protected/preserve, mask ใน rect นั้น 0.0%, pixel ที่ลบ 0.00% — ถ้า re-clean แล้วไม่ต้องแก้ mask ของ region นั้นเลย

---

## OCR ตายเงียบอีกครั้ง + watchdog ไม่ถูกอาวุธ — 2026-11-05

- **อาการ:** popup "เปิด ocr-service\run.ps1 แล้วลองอีกครั้ง" — uvicorn ตายเงียบ (stderr จบที่ sweep telemetry, ใช้งานสุดท้าย 02:23 คืนก่อน, ไม่มี traceback) **และไม่มี watchdog** เพราะ web/ocr ชุดนั้นถูก start แบบ manual (`powershell -Command node server.js`) ไม่ผ่าน vbs
- **แก้:** รัน launcher flow (rebuild + restart ทั้งคู่ — build ใหม่รวม fix completeness ด้วย ผู้ใช้ re-translate หน้า 35 ได้เลย) + spawn watchdog (PID 24560, mutex กันซ้อนยืนยันแล้ว) + smoke clean จริง: POST /v1/jobs → result 200
- **UI:** hint ตอน service ล่มเปลี่ยนจาก `run.ps1` → `SuperK-Launcher.vbs (watchdog จะเฝ้าให้เอง)` (`ea34c13` + test pin `3e3b5ea`) — run.ps1 เองถูกอีก session แก้ venv-first + ใส่ sweep env แล้ว (จาก commit interrogate-findings)
- **กติกาปฏิบัติ:** เริ่มระบบด้วยการดับเบิลคลิก `SuperK-Launcher.vbs` เท่านั้น — การ start node/uvicorn เองจะไม่มี watchdog เฝ้า
- โน้ตอีก session: launcher tests เขียวหมดแล้ว (เขาแก้ browser-on-reuse เอง) — suite เหลือ fail เดียวคือ `routes.test.ts` model rotation ของเขา

---

## "ยังจับไม่หมด" รอบใหม่ (page 35) — root cause 2 ชั้น + recovery ชั้นที่สอง — 2026-11-05

- **ระบุจุดจาก crop ผู้ใช้:** template match (fine scale ถึง 3.0) ระบุหน้า 35 loc (386,45) score 0.812 — ข้อความที่หายคือ **"I'm cum-ming!"** (อ่านเป็น "sorry man" ครั้งแรกผิด — บับเบิลลายมือเหมือนกันสองอัน ตัวที่ match ผิดคือ "I'm cum-ming!" ที่ (388,48) ตัวจริงยืนยันด้วย full-crop 0.812)
- **ชั้นที่ 1 (ผู้ใช้เจอ):** Gemini **ส่ง bubble นี้มาแล้ว** (gem-35 raw bubble #1) แต่ถูก sfx-veto ตัด — region-1 = (0,0,553x794) role=sfx preserve ครองทั้งควอดรันต์ — บั๊กที่ `67dcc1e` แก้แล้ว แต่ export ของผู้ใช้ (1 พ.ย. 01:04) เก่ากว่า fix (4 พ.ย. 00:15) และแอป rebuild 18:32/restart 18:33 คืนนี้ถึงจะมี fix ใน bundle → **ผู้ใช้ต้อง re-translate หน้า 35 ในแอป** (แปลเก่าถูกแคชไว้)
- **ชั้นที่ 2 (แก้ใหม่ `93fd0f0`):** ถ้า Gemini พลาดที่ page-level เอง จะไม่มีทางกู้เลยเพราะ recovery target มาจาก allowed roles เท่านั้น (gap ที่อีก session เขียนไว้) — แก้: region ใน `sfxExcluded` กลายเป็น recovery target **หลัง allowed ทั้งหมด** แบบ tile 1/4 หน้า (equal-division กัน sliver) + admission สองทาง: tile ใช้ candidate-relative containment (`mostlyInsideCrop` overlap/bubbleArea ≥.35) + `outsideProtectedAreas`, allowed ยังใช้ `anchorsToTarget` เดิม, dedupe กันซ้อน, **missing report ยังนับ allowed-only** (preserve ตั้งใจไม่นับเป็นขาด)
- **พิสูจน์ปลายทาง (live API):** fresh full-page 35 → 5 raw → 5 kept ("I'm cumming!" → "ฉันจะแตกแล้ว!" ผ่าน chain จริง) + tile crop `[0,265,265,530]` → Gemini คืน "I'm cum-ming!" → admitted ผ่าน recoverMissingTranslations จริง, หน้า 35 final 5 bubbles / missing 3
- **comment-sicko จับ 4 MUST KILL:** magic 265 ไม่มีที่มา (เหลือ why บรรทัดเดียว), sliver tile ที่ 531 promille ทิ้ง slot, anchorsInsideTile comment เลี่ยงไม่ได้ให้ rename `mostlyInsideCrop`, findMissingTranslationRegions คัดลอก predicate (derive จาก recoveryTargets แทน) — แก้ครบ
- **ตัวเลข:** completeness 19/19, suite 2092 tests / 2089 pass / 1 fail = `routes.test.ts` model rotation ของอีก session (ส่งต่อ) / tsc 0 — launcher tests ของอีก session เขียวหมดแล้ว (เขาแก้เองในช่วงคืนนี้)
- **เครื่องมือที่เพิ่มใน scratch/repro-638800/:** `match_crop.py`/`match_recent.py` (หา page จาก crop ผู้ใช้), `find_page.py` (Paddle ยังไม่ติดตั้งใน venv — service รัน CTD-only อยู่แล้ว เป็นข้อสังเกตแยก), `verify-35.mts` + `crop_targets.py` (replay recovery จริง)

---

## Production watchdog ตามสั่ง (restart-on-death) — 2026-11-04

- **ที่มา:** ผู้ใช้เลือกให้ทำ watchdog เอง (ต่อจาก forensics รอบก่อน) — ดีไซน์: watchdog วงจรสั้น emit action จากชุดปิด {restart-web, restart-ocr, skip-pause, skip-foreign, stand-down, give-up, no-op}, crash-loop = ≥5 restart/10 นาที → marker + popup เดียวแล้วเลิกเฝ้า, ประสานงานผ่านไฟล์ 3 ตัวใน .superk-runtime (pause ระหว่าง launcher stop/build, stop จาก stop-services, log ต่อ lifetime) + mutex Global กัน watchdog ซ้อน
- **โครง:** `scripts/service-start.ps1` (extract primitive เริ่มบริการจาก start-production.ps1 — env เหมือนกันทุก path, restart ไม่ rebuild ไม่เปิด browser) + `scripts/production-watchdog.ps1` + vbs ปล่อย watchdog คู่กับ pipeline + stop-services เขียน watchdog.stop ก่อน kill + pause wiring ใน start-production.ps1 (WIP ของผู้ใช้ — ไม่ commit)
- **จับ P0 ตอนรีวิวตัวเอง:** delegate ลบ `Get-SuperKPortOwner`/`Test-SuperKHealth`/`Open-SuperKBrowser` ทิ้งโดยไม่ย้าย (เทสต์ผ่านเพราะ mock ชื่อให้ = mock-masking) — แก้โดยย้าย Get-SuperKPortOwner ไป service-ownership.ps1, คืนสองตัวที่เหลือใน start-production.ps1 และ **encode บทเรียนเป็นเทสต์**: dot-source สคริปต์จริงไร้ mock แล้ว assert command surface 13 ตัวครบ
- **Live smoke จับบั๊กที่สอง:** param block ประกาศแค่ $ProjectRoot → -IntervalSeconds/-MaxCycles เป็น null (เทสต์ integration ผ่านเพราะ path stop-marker break ก่อน Start-Sleep) — แก้ param block ครบ 5 ตัว สุดท้าย smoke จริงกับบริการที่รันอยู่: 3 วงจร no-op, exit 0, PID บริการก่อน/หลังเท่ากัน (ไม่แตะ)
- **comment-sicko:** รับ KILL ทั้ง venv-fallback ที่ชี้ไปเก่าที่ไม่มีแล้ว (+branch), pid file ไร้ผู้อ่าน (ลบทั้งกลไก), `name` key ตายใน serviceState, parity comments ครึ่งเท็จ (env extraction ร่วมกับ run.ps1 = ค้าง hand-off) และ pin-mutex comment อธิบายบทบาท GC
- **ตัวเลข:** เทสต์ใหม่ 9/9 (รวม live-process stand-down + parse + command surface), suite เต็ม 2076 tests / **2073 pass / 2 fail = launcher reds ตัวเดิมของอีก session** / 1 skip, tsc 0 error, commit `01275b6` (start-production.ps1 ยัง WIP ไม่ commit — ผู้ใช้ commit/push เอง)

---

## Forensics: Next prod ตายเงียบคืนเดียว 2-3 ครั้ง (web-error.log ว่าง) — 2026-11-04

- **หลักฐานที่เก็บได้ (Event Log + WER + processes สด):** node ไม่มี Application Error 1000 / WER report เลย = ไม่ hard-crash, ไม่มี Resource-Exhaustion 2004, Defender ไม่มี detection, ไม่มีเทสต์/สคริปต์ใน repo ที่ kill บริการจริง (launcher tests mock หมด, nextServerHarness reuse prod ถ้าตอบ, stop-services.ps1 ไม่มีใครเรียก) เครื่องโดนแรงกดดัน memory ทั้งคืน: RADAR_PRE_LEAK_64 ชี้ ZenlessZoneZero.exe 00:04 + Kernel live dump 1a8/1b8 ซ้ำ 19:26→23:14 (RAM 31.9GB เหลือว่าง 10.5GB ตอนตรวจ)
- **รูทคอสต์เชิงระบบที่ยืนยันได้: สคริปต์ทำลายหลักฐานเอง** — `Start-Process -RedirectStandardError` truncate ไฟล์ทุกครั้งที่ start ใหม่ ดังนั้น "web-error.log ว่าง" ไม่ใช่หลักฐานว่าตายเงียบ แต่เป็นหลักฐานว่า stderr ของ run ที่ตายถูกลบทิ้งด้วยการ restart และหลัง start จบไม่มี supervisor เฝ้า (อีก session มี red test ระบุ contract แล้วแต่ไม่มี restart-on-death)
- **ตายที่เห็นสดรอบหนึ่ง:** web ที่สคริปต์ปล่อย 00:16:28 หายไปภายใน ~51 วิ (stderr 0 ไบต์) ตัวที่รันอยู่ตอนนี้คือ manual launch 00:17:19 ของอีก session (cmdline relative path) — ตายเองหรือโดนสลับเพื่อ debug แยกไม่ออก
- **สรุป:** ตัว killer ระบุตัวไม่ได้จากหลักฐานที่เหลือ (ถูก truncate ทำลาย) ตัวเลือกที่เหลือคือ node จบเองแบบเงียบ (v8 OOM จาก commit pressure เป็นตัวเชื่อหลักเชิงบริบท — พิมพ์ stderr แล้วโดนลบ) หรือโดน TerminateProcess ภายนอก
- **แก้แล้ว (start-production.ps1 ของผู้ใช้ — WIP ไม่ commit):** หมุน log ต่อ run เป็น `web-<stamp>.log` ฯลฯ ครบ 8 stream (build/assets/ocr/web + error) เก็บ 15 ไฟล์ล่าสุดต่อ stream → การตายครั้งหน้าจะเหลือ stderr ให้อ่าน PARSE_OK + launcher tests เท่าเดิม (แดงเฉพาะ 2 ตัวเดิม)
- **ตัดสินใจค้างให้ผู้ใช้:** (1) จะเอา watchdog restart-on-death ไหม — แนะนำให้อีก session ใส่ใน launcher redesign ที่กำลังทำ (red test มีอยู่แล้ว) จะได้ไม่ชนกัน (2) contract ขัดกันเอง: เทสต์ของอีก session ต้องการ browser เปิดทุกครั้งที่ start สำเร็จ (รวม reuse) แต่ guard `$webWasRunning` ในสคริปต์ผู้ใช้ตั้งใจกัน tab ซ้อน — ต้องเลือกฝ่ายใดฝ่ายหนึ่ง

---

## รีวิว fresh-eyes ทั้งระบบ + แก้ P1 ทั้งสามจุด — 2026-11-04

- **รีวิว (ห้ามใช้ความจำ ตามสั่ง):** explorer 3 ตัว sequential (โควตา agent ขนานได้ 1) — frontend / Python service / tests+ops ที่ HEAD ขณะนั้น `9873ea0`→`691886b` (อีก session commit คู่ขนานตลอด) ผล: P1 ×3, P2/P3 รวม ~20, suite จริง 2065 tests / 2 fail deterministic (launcher tests), tsc 0, eslint 1 error committed (`lib/translationOverlay.ts:89:9`), `vitest.config.ts` untracked เงาทับ `.mts` ทุก run ใช้ config ที่ไม่ได้ commit
- **P1-1 sweep กิน PRESERVE (แก้แล้ว):** `region_cover` ของ residual sweep สร้างจาก `refined.regions` ทั้งชุด → ข้อความ SFX/review/low-confidence ที่ safe mode ตั้งใจเก็บไว้ (และ region ที่เพิ่ง restore หลัง verify ไม่ผ่าน) โดน diff mask จับแล้ว LaMa ลบ แก้: filter จาก `records` — `REPAIRED` เสมอ + `NEEDS_REVIEW` เฉพาะ all-text (all-text commit candidate ทั้งที่ verify fail ที่ `pipeline.py:515, 689-690`) — premise REPAIRED-only ของฉันแตกเทสต์เดิมแล้ว delegate วัดสาเหตุจริงก่อนแก้ RED→GREEN: `2 failed, 32 passed` → `34 passed` / suite 262 pass 3 skip
- **P1-2 optimistic discard ลบผล final (แก้แล้ว):** `complete()` ใช้ `markPageDirty` ซึ่ง bump revision เสมอ → ownership check เป็น false หลัง optimistic สำเร็จทุกครั้ง แล้ว `.then` ลบ cache ถ้า final เสร็จก่อน = ลบผล final spec แรกของฉัน (ทิ้ง revision clause คง `.then`) พิสูจน์ใช้ไม่ได้ (discard tests เดิมแตก 3 — abort/replace เกิดหลัง optimistic จบ) โครงสร้างใหม่: run-scoped `discardOptimisticResidue` + `finally` ของ performTranslation ลบตอน run จบไม่มี final **comment-sicko เจอรู:** abort ระหว่าง paint ค้าง → finally ลบก่อนแล้ว `complete()` เขียน residue คืน ปิดด้วย `signal` param + `signal?.aborted` ใน guard ของ `renderAndCacheTranslation` RED→GREEN: residue ถูกเขียนคืนตามเทสต์ใหม่ → ไฟล์ 11/11 pass
- **P1-3 batch typography ไม่ bump revision (แก้แล้ว):** `useWorkspaceController` เขียน `bubbleCacheRef` โดยไม่ mark → baked render ค้างฟอนต์เก่า (wire มีอยู่แล้วใน orchestrator return แค่ไม่ได้ destructure) mark หลัง write ทั้ง batch-apply และ manual-bubble — หมายเหตุ: markPageDirty ทำ remnant confirmation หลุดต่อหน้าเหมือน `setTextStyle` ทำอยู่แล้ว
- **ตัวเลขปลายทาง (HEAD `38e0310`):** vitest 2065 / 2062 pass / 2 fail = launcher tests ของอีก session (ยืนยันชื่อแล้ว), tsc 0, eslint ไฟล์ที่แตะ 0 errors 5 warnings เดิม, ประสานงาน: ไฟล์ที่แก้ไม่ทับกับ `67dcc1e`/`569907a`/`38e0310` ของอีก session (เช็ค git log ต่อไฟล์ก่อน commit)
- **ส่งต่ออีก session / ค้างตัดสินใจ:** launcher tests 2 ตัว + lint error `translationOverlay.ts:89` เป็นโค้ดเขา, `vitest.config.ts` untracked ค้าง (BOM ด้วย), `lib/server/rateLimiter.ts` untracked แต่ suite เขียวเพราะมัน, Next prod ล่มเอง 2 คืน (web-error.log ว่าง — อีก session เขียนไว้ใน entry ถัดลงไป ยังไม่มีใคร root-cause)

---

## จับข้อความไม่หมด (638800) — root cause 2 กลไก + แก้ scope/recovery/model — 2026-11-04

- **อาการที่ผู้ใช้รายงาน:** ระบบแปลยังจับข้อความไม่หมด (ZIP 638800, ห้ามดูแคช E:\SuperK\SuperK_Translations (41).zip — ทำ fresh repro จาก ZIP ต้นฉบับใน Downloads)
- **วิธีวัด (ไม่เปิดดูภาพ 18+):** harness ใน `scratch/repro-638800/` (run.mts/analyze.mts/experiment.mts/make_crops.mts/replay.mts + crop.py วิ่งด้วย venv python -I) ยิง CTD (`POST /v1/jobs`, mode=safe) คู่กับ `/api/translate` (normal path) ทั้ง 36 หน้า → บันทึกผลไว้ `F:/manga-cache/repro-638800/data/` แล้ว replay filter chain ตัวจริงจาก repo (tsx import โมดูลจริง) — **ข้อค้นพบสำคัญ: ผลจาก /result เป็น snake_case (`text_role`) ต้องผ่าน decoder ของ `lib/cleaning/client.ts` ก่อน ไม่งั้น scope มองไม่เห็น role และวัดคลาด**
- **ตัวเลขที่วัดได้ (รอบเดียว/หน้า, Gemini ไม่ deterministic — ตัวเลขของรันผู้ใช้จริงจะต่างแต่กลไกเดียวกัน):** raw 381 bubbles → filter ทิ้ง **60 (16%) ทั้งหมดเพราะ overlap region ที่ CTD ติดป้าย `sfx` ภายใต้ sfxMode=ignore (default)** — region พวกนั้นคือพื้นที่ artwork ใหญ่ (672×662, 638×815 px) ที่มีบับเบิลบทสนทนาธรรมดาอยู่ข้างใน (Gemini label `dialogue` ถูกทุกตัว) + CTD เจอ region dialogue/narration **33 จุด** ที่ไม่มี bubble ครอบเลย
- **กลไก A (Gemini มองข้าม):** recovery ที่มีอยู่ (`recoverDetectedOmissions` → `recoverMissingTranslations`) เอามา replay ตรง ๆ พบว่ากู้ได้จริงแค่ **~7/315 จุด (2.2%)** เพราะ (1) cap 6 crops/หน้าโดน region `review` 149 จุดกิน slot (dialogue บางจุดตกไปอยู่ลำดับ 7+), (2) admission `covers()` ต้องครอง ≥0.6 ของพื้นที่ target ทั้งหมด แต่ region หลวมกว่ากล่องข้อความ → ตก 117/124 candidates (บางตัว ovT 0.57-0.59 แทบผ่าน), (3) crop ครึ่งหนึ่งเจอข้อความจริง (thai-ratio ~1.0) แต่ถูกปฏิเสธ
- **บั๊กแถมที่เจอ:** model `gemini-3-flash` ใน `FIXED_IMAGE_MODELS` **404 จริงบน API** (comment ในไฟล์ยอมรับเองว่าเคย 404 แต่ยังทิ้งไว้ใน Auto rotation) — เจอสด 2 ครั้งระหว่างยิง crop recovery
- **แก้ (RED ก่อน GREEN, push origin/main):** `2f12ad8` test spec ก่อน → `67dcc1e` fix: `translationScope("ignore")` ย้าย sfx-policy region ไป bucket ใหม่ `sfxExcluded` (เลิก veto bubble — protected ยัง veto เหมือนเดิม) + recovery เรียง target dialogue/narration ก่อน review ผ่าน `allowedRoles` + admission ใหม่ `anchorsToTarget` (≥0.35 ของ target + area ratio ≤8) → `569907a` ลบ gemini-3-flash ออกจาก rotation (+ fixture canonical order ใน localRequestProtection/dynamicRoutingRoutes) — session คู่ขนาน push `38e0310` ต่อท้ายให้
- **ผลตรวจหลังแก้ (ข้อมูลชุดเดิม):** dropped 60 → **0** (kept 381/381), recovery กู้ได้ **7 → 16 จุด**, จำนวน "missing" ที่ UI โชว์สมเหตุสมผลขึ้นเพราะ coverage นับแบบ anchor; suite เต็ม 2054 pass / **5 fail ที่เป็นของเดิม** (desktopLauncher, productionLauncher, useTranslation.sourceSize ×3 — ยืนยันด้วย stash เทียบ baseline; tree ยังมี WIP ค้างที่ไม่ใช่ของฉัน: hooks/useTranslation.ts, ocr-service/app/pipeline.py, test_pipeline.py, sourceSize test), tsc 0, eslint 0 errors
- **ข้อจำกัดที่ค้าง:** ข้อความ dialogue ที่ Gemini ไม่ box เลยและอยู่ "ใน" region sfx จะยังไม่ถูก recover (target มาจาก allowed เท่านั้น); bubble ที่กลับมาแปลบน region ที่ preserve ไว้จะ render ไทยทับอังกฤษเดิม (text-only render, ไม่มี boxFill) — ผู้ใช้ re-clean region นั้นต่อได้ใน UI; Next prod ล่มเอง 2 ครั้งคืนนี้ (web-error.log ว่าง — ยังไม่ทราบสาเหตุ, รีสตาร์ทผ่าน start-production.ps1 แล้วทั้งสองครั้ง ล่าสุด build ใหม่มี fix แล้ว)

---

## เล่ม 638800 (อังกฤษ→ไทย 36 หน้า, ฟอนต์ Itim) + ต้นตอความช้าของการคลีน + สลับ onnxruntime — 2026-11-01

- **งาน:** ผู้ใช้ให้ ZIP 638800 (Arimura Daikon, ต้นฉบับอังกฤษ, 36 หน้า) พร้อมสั่งฟอนต์ Itim — ตรวจแล้ว Itim เป็นค่าเริ่มต้นของแอปอยู่แล้ว (`lib/customFonts.ts`) — แปลครบ 36/36 หน้า: **373 bubbles, t-field ไทยล้วน (latin=0, cjk=0 — คำสั่งห้ามละตินใน t ผ่านทั้งที่ต้นฉบับอังกฤษ), flash-lite attempt=1 ทุกหน้า, เฉลี่ย 5.6 วิ/หน้า**
- **ต้นตอความช้า (ผู้ใช้ถาม "ทำไมช้าขนาดนี้ ควรจะเร็วกว่านี้ไม่ใช่หรอ"):** อ่าน `timings_ms` จาก GET /v1/jobs/{id}/result → detect 1.0s / refine 0.2s / **clean 162s (lama_inference_count=1 = forward pass เดียว full-page!)** / verify 1.4s → ไล่โค้ดพบว่า **Big LaMa รันผ่าน ONNX Runtime (`models/anime-manga-big-lama.onnx` 206 MB) ไม่ใช่ torch** (`cleaners/lama_large.py`: "the shipped Windows runtime intentionally does not require PyTorch") และ **onnxruntime 1.28.0 ที่ลงอยู่เป็นตัว CPU-only** (providers = [Azure, CPU]) ทั้งที่ `ort_utils.py` เตรียมระบบ GPU ไว้ครบ (preferred_providers, เติม CUDA DLL จาก torch/lib, CPU fallback) — สรุป: torch+cu130 ที่สลับก่อนหน้าไม่ใช่ชิ้นส่วนที่ขาด (red herring — torch ไม่ใช่เครื่องยนต์คลีน)
- **สลับ onnxruntime (ผู้ใช้อนุมัติ DirectML ผ่าน AskUserQuestion):** `pip uninstall onnxruntime` + `uv pip install onnxruntime-directml` (1.24.4 — ต้อง uninstall ก่อนเพราะ import name เดียวกัน) → providers มี DmlExecutionProvider → **คลีน 167–330 วิ/หน้า → 3.1–8.6 วิ/หน้า (~45×) — 35 หน้าที่เหลือจบใน ~2 นาที** (หน้า 1–4 โดนคลีนไปก่อนสลับ — โมเดลเดียวกัน ผลลัพธ์เท่ากัน)
- **คำเตือนสภาพแวดล้อม:** lock file จะดึงกลับเป็นตัว CPU ทั้ง torch (+cpu) และ onnxruntime (1.28) เมื่อ rebuild venv — ต้องสลับซ้ำทั้งสอง (บันทึกใน memory แล้ว); ตรวจ provider ด้วย `onnxruntime.get_available_providers()`; กฎ: อ่าน `timings_ms` ก่อนตั้งทฤษฎี
- **รายงาน Itim:** `C:\Users\PC\.zcode\v2\visualizations\8d94d...\manga-translate-638800.html` (1006 KB — ต่ำกว่าลิมิต 1 MB แบบเฉียด) — 36 tabs + overlay กล่องไทยฟอนต์ Itim (Google Fonts link — CSP อนุญาต) + ตารางต้นฉบับ↔ไทย; บทเรียนขนาด fragment: 36 หน้า×373 bubbles ต้องย่อภาพ 260px/q32 (559 KB) + ตัด data-tooltip/sr-only ที่ซ้ำกับตาราง
- **Commit status:** ไม่มีการแก้โค้ด repo รอบนี้ (แก้แค่สภาพแวดล้อม venv: torch cu130 + onnxruntime-directml); ส่วนขยายอนาคต: onnxruntime-gpu + CUDA 12 DLL เร็วกว่า DirectML ได้ แต่เสี่ยง DLL hell

### ต่อ: ผู้ใช้ทดลองในแอปจริงแล้วช้า (~2-3 นาที/หน้า) — ต้นตอ NSFW bypass slicing — 2026-11-01

- ผู้ใช้กดแปลเล่ม 638800 ในแอป → progress bar 6 นาทีแล้วผ่านแค่ 3/36 (6%) + banner "พบปัญหาบางอย่าง" — log ฝั่ง OCR เร็วปกติ (job จบในไม่กี่ poll) = คอขวดอยู่ฝั่ง translate ในแอป
- **ต้นตอ (hooks/useTranslation.ts):** โหมด NSFW bypass ซอยหน้าเป็น 6 ชิ้น (3×2) แล้ว**แปลเรียงลำดับ** = 6 Gemini calls/หน้า + หน่วง 1 วิระหว่างชิ้น; ขั้นเติมคำแปลที่ตกหล่น (recovery) ตัด crop ราย bubble ด้วย **PNG เต็มคุณภาพ** (payload หนัก 1-3 MB) + isRetry rotation ต่อชิ้น
- **แก้ 2 จุด (minimal):** (1) 6 slices ยิง **Promise.all พร้อมกัน** — เก็บผลแล้วรวมตามลำดับชิ้นเดิม (dedupe priority คงเดิม), semantics การ abort (cancel / retryable 429) คงเดิม, ตัด sleep ระหว่างชิ้น (2) recovery crop เปลี่ยน PNG → **JPEG 0.9** (payload -70% สอดคล้อง slice หลักที่ใช้ JPEG 0.8) — tsc 0 / eslint 0 errors / vitest tests/translation+api **541 passed** / build ใหม่ + restart แล้ว (frontend 200 @ 5 ms)
- **ผู้ใช้ต้องทำ:** หยุด run เดิมในแอป → Ctrl+Shift+R → เริ่มแปลใหม่ (โค้ดเก่ายังอยู่ในแท็บเดิม) — คาดหวัง stage ซอย 6 ชิ้นลดจาก ~40-70 วิ → ~8-12 วิ/หน้า
- **Commit status:** hooks/useTranslation.ts แก้แล้ว **ยังไม่ commit** (รอ com push ถัดไป)

### ต่อ: ทำให้ NSFW bypass ไม่กินโทเคน — full-page pre-pass — 2026-11-01 (user ถาม "มีวิธีไหม")

- **ดีไซน์ใหม่:** เปิด bypass แล้วจะ**ลองส่งทั้งหน้า 1 call ก่อน** (ปุ่มสถานะ "กำลังแปลทั้งหน้าก่อน (ประหยัดโทเคน)") — ได้ bubbles > 0 = จบ ใช้ 1 call; ตอบว่าง/parse พัง (soft refusal / miss) เท่านั้นที่ตกไปซอย 6 ชิ้น (parallel แล้ว) — เหตุผล: ทดสอบจริงเล่ม 638800 ผ่านทั้งหน้า 36/36 โดยไม่ต้องซอย
- **ผล token:** เดิม bypass = 6 calls/หน้าทุกหน้า (~6× prompt ใหญ่); ใหม่ = ~1 call/หน้าสำหรับหน้าที่ผ่าน, จ่าย 6 calls เฉพาะหน้าที่โมเดลปฏิเสธ → ประหยัด ~80% ในเล่มทั่วไป; หน้าเปล่าจริง ๆ จะยังซอย (6 calls เปล่า) — ยอมรับได้เพราะไม่รู้ว่าเปล่าก่อนลอง
- **เทส:** 4 เทสเดิมแดงเพราะ assert `toHaveBeenCalledTimes(6)` (สัญญาเดิม bypass = 6 calls) — พฤติกรรมอื่น (malformed → fail โดยไม่ cache) ยังถูกต้อง → อัปเดต assertion เป็น 7 (1 pre-pass + 6 slices, มี comment) ทั้ง imageLateEdges/imageLatency → **541/541 ผ่าน**, tsc 0, build + restart แล้ว
- **start-production.ps1 (WIP) แก้เพิ่ม:** เปิด browser เฉพาะ cold launch (web ไม่ได้รันตอนเริ่ม) — รีสตาร์ทซ้ำไม่เด้งแท็บกองอีก; ยืนยันแล้วว่า restart รอบนี้ไม่มีแท็บใหม่
- **Commit status:** hooks/useTranslation.ts + เทส 2 ไฟล์ + start-production.ps1 (WIP) — รอ com push

### ต่อ: เทส token saver กับภาพจริง (ผู้ใช้สั่ง "ไปทดสอบกับภาพจริงเลย") — 2026-11-01

- เทสด้วยสคริปต์ที่เลียน flow ใหม่เป๊ะ (pre-pass ทั้งหน้า → ซอยเฉพาะเมื่อว่าง; slice geometry 3×2 overlap 15% JPEG 0.8 ตามแอป) บน 4 หน้าจริง: **638800 หน้า 20 = 1 call / 9 bubbles (3.5s), หน้า 36 = 1 call / 10 bubbles (4.1s)** — token saver ทำงาน; **638800 หน้า 2 = pre-pass ตอบว่าง (flash-lite variance — หน้าเดิมเคยให้ 23 bubbles เมื่อ ~1.5 ชม.ก่อน!) → fallback ซอย 6 ชิ้นเก็บได้ 11 bubbles** = ระบบจัดการ soft-miss ได้สวย (พลาดทั้งหน้าไม่ใช่ความล้มเหลวอีกต่อไป); **680284 หน้า 9 (ไม่มีข้อความ) = 7 calls จบเป็น 0 bubbles** (trade-off ที่รับไว้)
- รวม 16 calls เทียบแบบเก่า 24 (4 หน้า×6); บนเล่มเต็ม 36 หน้าที่ผ่านหมด = 36 เทียบ 216 (~83% ประหยัด)
- สคริปต์ `F:\manga-cache\temp\superk-bypass-realtest.mjs` + slices ที่ `bypasstest/{p20,p36}` — บทเรียน: สคริปต์รอบแรกลืมสร้าง slice ให้เล่ม 638800 (ENOENT) — แก้แล้ว rerun

### ต่อ: diagnostic report ของผู้ใช้ เฉลยปริศนา bypass + บทเรียนการรีสตาร์ท — 2026-11-01

- ผู้ใช้ส่ง System Diagnostic Report (50 entries, 44 errors) — ถอดรหัสได้: **มวล "Failed to fetch" (การคลีน) + หน้า 5/36, 6/36, 7/36 Network error ช่วง 22:47 เกิดจากผมหยุด/รีสตาร์ท web+OCR กลางการแปลของผู้ใช้** (ช่วงสลับ DirectML และตอน build หลังแก้ parallel slices) → หน้าที่ตกในช่วงนั้นรวมเป็น failure groups → banner "พบปัญหาบางอย่าง" → หน้าต่าง diagnostic เสนอปุ่ม "เปิด NSFW bypass แล้วลองใหม่" → ผู้ใช้กด → **bypass เปิดค้างทั้ง session = ปริศนาที่ช้าทั้งเล่มเฉลยแล้ว (ไม่ใช่ผู้ใช้ตั้งใจเปิดจาก Settings)**
- **Gemini upstream ก็แสบจริงช่วงนั้น**: 502 "Gemini rejected" / 504 timeout / GEMINI_ROUTE_COOLDOWN (12s) — server จัดการครบ (retryable → หมุนคีย์/โมเดล → งานผ่านหมด) และบางส่วนมาจาก burst เทสของผมเอง (24 calls/5 นาที ตอน 23:08-23:11 ก็โดน 502/504 แต่ retry รอด)
- **สถานะ ณ 23:28+: เขียวหมด** — smoke translate ล่าสุด 23 bubbles / attempt=1 / 6.8s; error สุดท้ายใน log = 23:11 (เทสของผม) เงียบต่อเนื่อง
- **บทเรียนสำคัญ (จำเข้า memory): อย่ารีสตาร์ท service ตอนผู้ใช้กำลังรันงาน — เตือน/ขอให้หยุดก่อนเสมอ** มิฉะนั้นงานผู้ใช้พังกลางทางแล้วผู้ใช้ต้องเดาเองว่าทำไม

### ต่อ: ไล่ mask refinement (ผู้ใช้สั่ง) → residual sweep — 2026-11-02

- **วัดหลักฐานก่อนแก้ (ไม่เปิดดูภาพ):** ยิง detector ใส่ภาพหลังคลีน → เจอ 3-7 regions/หน้า; edge-density ต่อ region = **5/7 เป็นข้อความจริง** (อีก 2 = ลูกโป่งเปล่า false positive) — เศษมีจริง
- **จุดที่ผิดพลาดระหว่างทำ (จำไว้):** (1) confidence 0.93-0.97 ที่เห็นใน result regions คือ **eligibility/route confidence ไม่ใช่ confidence ของ detector blocks** — blocks จริงบนภาพคลีนต่ำกว่า 0.5 ทั้งหมด → gate 0.5 บล็อกหมด (ลดเหลือ 0.35 = พื้นของ detector) (2) CTD **mask head** ให้ prob ต่ำบนภาพคลีนบางส่วน แม้ YOLO จะเจอ → sweep ต้องสร้าง synthetic glyph prob ด้วย **Otsu ต่อ block + polarity ตามขอบ** (เหมือน extractGlyphInk ฝั่ง client) แล้วค่อยส่งเข้า self.refiner (3) `LetterboxTransform` ไม่ได้ import → NameError โดน best-effort catch กลืนเงียบ (จับได้จาก full.calls==1 ในเทส)
- **ของที่ส่งมอบ (TDD, 258 pytest + ruff ผ่าน):** `SUPERK_RESIDUAL_SWEEP=1` (ใน start-production.ps1 แล้ว) → หลัง region loop: detect(clean) → blocks conf≥0.35 → Otsu glyph candidates ต่อ block (ข้าม flat: std<6) → self.refiner ขัดเกลา → residual mask = glyphs & ~(eligible|refined.mask) & ~protected → LaMa 1 call → metrics `residual_sweep_runs/pixels` ใน timings; พร้อม WARNING diagnostics ลง ocr-error.log
- **ผลจริงแบบตรงไปตรงมา:** sweep ยิงได้ (319 px หน้า 20) แต่เศษรวมลดไม่ชัด — เพราะเศษแบ่งเป็น 4 ประเภท (จากการ match rects กับ main-pass records): **(A) detector miss ตั้งแต่ต้น** (overlap 0.00 — blocks ไม่ยอมเกิดบนภาพคลีน แม้ gate 0.35 → sweep มองไม่เห็น) **(B) LaMa ลบไม่หมด** (region-7 residual=0.37 หลัง escalate 3 ครั้ง — คนละศึกกับ sweep) **(C) SFX-policy ปกป้อง** (region-4 — ผู้ใช้สลับ SFX=แปล แก้ได้) **(D) needs_review ตามดีไซน์ safe** (SFX=แปล ก็จัดการ)
- **สรุปให้ผู้ใช้:** ตัวหลักที่แก้ความชอกของผู้ใช้ = สลับ SFX → แปล (all-text) + sweep เป็นเซฟตี้เน็ตชั้นท้าย; (A) แก้ได้ด้วยการลด `confidence_threshold` ของ detector (0.35 → ~0.25) แต่เสี่ยง false positive บนงานศิลป์ — ทำเป็น opt-in ภายหลัง; (B) ต้องปรับคุณภาพ inpainting (เช่น ทำ LaMa ซ้ำเฉพาะ region ที่ residual สูง) — งานหน้า
- **Commit status:** pipeline.py + tests/test_pipeline.py แก้แล้ว **ยังไม่ commit** (รวมกับ useTranslation.ts + เทส + launcher + start-production.ps1 WIP รอ com push)

### ต่อ: คลีนรอบสองจากกล่อง Gemini (ผู้ใช้อนุมัติ "สร้างเลย") — 2026-11-02

- **หลักฐานปิดเคส:** วัดด้วยกล่อง bubble จาก Gemini เทียบภาพหลังคลีน (edge-density ต่อกล่อง) → **19/23 bubbles บนหน้า 2 ยังมีตัวหนังสือค้าง** — CTD detector มองเห็นแค่ ~4-6 จาก 23 = รากของ "คลีนไม่หมด" ที่ detector-based sweep ช่วยไม่ได้
- **ดีไซน์ (ใช้ของเดิมทั้งหมด):** หลังแปลแต่ละหน้าเสร็จ → `runResidueCleanup(pageUrl, coloredBubbles)` (useTranslation) → ผ่าน `onTranslationResidueCleanup` (wiring: controller → useTranslationOrchestrator → useCleaningOrchestrator.handleCleanupResidues) → `useCleaning.cleanupResidues`: luma จาก cleanBlob (createImageBitmap+canvas) → `buildResidueMask` (lib/cleaning/residueMask.ts — extractGlyphInk ต่อ box, รวม ink, ข้าม box ที่ ink < minInkPixels 120) → ถ้า pixels ≥ 200 → mask PNG → **`inpaintCrop()` → POST /v1/clean/crop (endpoint ที่มีอยู่แล้ว — sync inpaint + featherBlend)** → อัปเดต resultsRef (cleanBlob/cleanUrl) → `syncTranslationAfterClean` เรนเดอร์ทับ
- **ทดสอบ:** residueMask.test.ts 4/4 (ink ตรง box, ข้าม noise < minInk, ภาพสะอาด = 0, malformed boxes ไม่ throw) — รวม **tsc 0 / eslint 0 errors / 545 vitest ผ่าน** / build + restart (ไม่เด้งแท็บ ✓)
- **พฤติกรรม:** best-effort — ล้มเหลวกลางทางไม่กระทบการแปล (try/catch ครบ); หน้าที่ไม่มีเศษ (pixels < 200) ข้ามทันทีไม่เปลือง API; งาน LaMa ~1 call ต่อหน้าเฉพาะหน้าที่มีเศษ
- **Commit status:** เพิ่ม lib/cleaning/residueMask.ts + tests/cleaning/residueMask.test.ts (ไฟล์ใหม่) + แก้ 5 hooks — **ยังไม่ commit ทั้งหมด รอ com push**

### ต่อ: parallel page translation (ผู้ใช้เลือกทางเลือก 3) — 2026-11-02

- **ที่มา:** ผู้ใช้รายงาน "30 นาทีได้ 10 หน้า" — พิสูจน์แล้วว่า OCR/คลีนเร็ว (0.5-5.9 วิ/job จาก 50 jobs) คอขวดคือ **Gemini upstream อืด/ปฏิเสธเป็นระลอก** (probe สด: หน้า 2 = 49.7s attempt=2; ปกติ 5.6s attempt=1) — ผู้ใช้เลือกแก้ด้วยการแปลหลายหน้าพร้อมกัน
- **ดีไซน์:** handleTranslateAll รื้อ consumer loop เป็น **worker pool** — `processOnePage(i)` มีเนื้อ per-page เดิมเกือบเป๊ะ (prep gates + performTranslation + retry ≤2 + failure groups + quota abort) — `processWorker` ดึง position ถัดไปจาก indicesToProcess; **PARALLEL_PAGES = parallelPages ?? 1** (default sequential = สัญญาเดิมของเทส) และ **useTranslationOrchestrator ส่ง 2 ให้ production**; ตัด cooldown ระหว่างหน้า; progress แบบรวม (`กำลังแปล N หน้าพร้อมกัน · เสร็จ X/Y`); quota → batchController.abort + quotaAborted flag หยุดทุก worker; cancel/signal เช็คทุกจุดเดิม
- **บั๊กที่จับได้จากเทส (สำคัญ!):** worker แรกของผมใช้ `nextCursor` เป็น page index ตรง ๆ — แต่มันคือ **position ใน indicesToProcess** — full-book (position==index) ไม่เห็นพัง แต่ **targeted retry (indicesToProcess=[1]) ชี้หน้าผิด** — เทส "restores cached edits after cancellation" จับได้ → แก้เป็น `const i = indicesToProcess[position]`
- **ผลตรวจ:** tsc 0 / eslint 0 errors / **542 tests translation+api ผ่านหมด (เพิ่มเทส parallel: 2 หน้า blocked → maxInFlight=2 → ทั้งคู่ cache)** / build + restart แล้ว
- **ผลลัพธ์ที่คาดหวัง:** ตอน upstream อืด — 2 หน้ายิงพร้อมกัน → wall time/เล่มลด ~ครึ่ง; ตอน upstream ปกติ — 10-15 นาที/เล่มเท่าเดิม (คู่แข่งคือ 12-key pool รองรับไหว)
- **Commit status:** hooks/useTranslation.ts (worker pool + parallelPages option) + useTranslationOrchestrator.ts (ส่ง 2) + ไฟล์อื่น ๆ ที่ค้าง — **ยังไม่ commit รอ com push**

### ต่อ: parallelPages 3 + คิวคลีนล่วงหน้า 8 (ผู้ใช้เลือก "ทั้งคู่") — 2026-11-02

- **อธิบายคณิตก่อน:** คลีนล่วงหน้าเพิ่ม ≠ เร็วขึ้น — คลีน (2-5 วิ) วิ่งนำหน้าแปล (20-50 วิ) อยู่แล้วและจอดที่ cap เสมอ; wall time รวม = max(คลีนรวม ~2 นาที, แปลรวม ~15-25 นาที) — ผู้ใช้เลือก "ทั้งคู่" ตามที่เสนอ
- **แก้ 2 ค่า:** `parallelPages: 3` (useTranslationOrchestrator ส่งให้ production) + pump cap `preparationQueue.size < 8` — เช็ก ResourceBudgetManager ก่อน: budget = 6% RAM cap 128MB-1GB (เครื่อง 32GB → ~1GB) — 8-11 หน้าล่วงหน้า ≈ 50-110MB ปลอดภัย ไม่ trigger eviction
- **เทสอัปเดต:** "cleans three future pages serially" → prefetch-cap contract ใหม่ (cleaned [0..5] บนเล่ม 6 หน้า, secondaryMessage มี "5") — **546/546 ผ่าน**, tsc 0, build + restart (ไม่เด้งแท็บ ✓)
- **ผลคาดหวัง:** แปล 3 หน้าพร้อมกัน = throughput ช่วง upstream อืดเพิ่มจาก 2× → 3×; ตอน Gemini ปกติ = เดิม (10-15 นาที/เล่ม); คิวคลีน 8 = สำรองหน้าคลีนแล้วไว้เยอะ ไม่กระทบเวลา
- **Commit status:** รวมทุกงานค้าง — **ยังไม่ commit รอ com push**

### ต่อ: sweep v2 (diff-based) — ผู้ใช้ส่งภาพ "คลีนไม่หมด" แล้ววัดจริง — 2026-11-02

- **ผู้ใช้ถูกตลอด:** วัดด้วย diff-based metric (unchanged ∧ dark ∧ component ≥40px ในกล่อง Gemini) → หน้า 2 มีเศษจริง **40 ก้อน / 20,051 px** — ข้อความจริงหลุดจริง ตามที่ผู้ใช้เห็น
- **ต้นตอแท้ (แทนที่ทฤษฎีเดิม):** detector YOLO เห็นครบ (21/23 regions) แต่ **CTD segmentation head แทบตันกับตัวหนังสืออังกฤษ** → mask_refiner ได้ mask เล็กเกิน → LaMa ลบได้แค่เสี้ยว → 20k px ค้าง และ residual probe (ตาเดียวกัน) ก็ตัน → รายงาน "repaired" ทั้งที่เหลือ; ส่วน "19/23" ที่ผมวัดก่อนหน้าด้วย edge-density = **ปน screentone false positive** (จุด halftone นับเป็นข้อความ) — เครื่องมือวัดเก่าโกหกสองทาง
- **ระหว่างทางเจอ 2 จุดที่ต้องแก้:** (1) sweep รุ่น Otsu-on-clean มองไม่เห็นเศษ (blocks บนภาพคลีน conf ต่ำ + mask head ตัน) → เปลี่ยนเป็น **diff-based**: (|clean−source|≤6) ∧ (source<120) ∧ component≥40px ∧ ~protected ∧ ใน region rect(+pad 24) — ไม่พึ่งโมเดลเลย (2) `LetterboxTransform` ไม่ได้ import → NameError กลืนเงียบอีกครั้ง
- **⚠️ เวอร์ชัน client เดิม (raw extractGlyphInk mask) ทำลายภาพ:** ตัวอย่าง b3 — mask ไปคลุม**พื้นในลูกโป่งสะอาด** แล้ว LaMa เติม tone ใส่ (ยืนยันด้วย crop before/mask/after) — **ผู้ใช้ควร re-clean/re-translate หน้าที่เคยรันผ่านเวอร์ชันนั้น** เพื่อสร้างใหม่จากต้นฉบับ; ตัววัด edge-density ก็เลิกใช้ (โกหกทั้งสองทาง) — เหลือ diff-based metric อย่างเดียว
- **ผลหลัง sweep v2 (หน้า 2):** 40 ก้อน/20,051 px → **18 ก้อน/2,999 px (−85%)**, job รวม 8.2 วิ; เหลือ 3k px = เคส LaMa-hard (ประเภท B — งานต่อยอด)
- **ต่อยอด:** client second-pass ยังมีค่าสำหรับข้อความนอก region rects (ที่ server sweep ไม่คลุม) — เปลี่ยน mask เป็น diff-based แล้ว (buildResidueMask v2: clean vs source luma + component filter) + cleanupResidues ดึง source luma จาก pageUrl เอง
- **สภาพ deploy:** OCR sweep v2 + web client v2 rebuild/restart แล้ว; ตรวจ restart ผ่าน service-ownership (บทเรียน $pid read-only ของ PowerShell — ใช้ $procId)
- **Commit status:** งาน v2 ทั้งหมด **ยังไม่ commit รอ com push** (รวมของค้างเดิมทุกชุด)

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
