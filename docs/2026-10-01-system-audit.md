# ตรวจระบบ SuperK — 2026-10-01

## ขอบเขตและสถานะอ้างอิง

- ตรวจที่ `main`, HEAD `710c7fe`; working tree สะอาดก่อนเริ่ม
- ตรวจเส้นทางนำเข้า → คลีน → แปล → แก้ข้อความ → บันทึก/กู้คืน → ส่งออก รวม API, Chrome extension, Python sidecar, Launcher และ Electron shell
- ใช้ source trace, ชุดทดสอบเดิม, production build และ probe แยกเพื่อพิสูจน์เงื่อนไขผิดพลาด ไม่เรียก Gemini จริงและไม่รันคำสั่งปิดโปรเซส
- `.env.local` ของ checkout นี้ตั้ง `SUPERK_GEMINI_IMAGE_ROUTER=fixed`; ไม่ได้ตั้ง relay ครบคู่ ตรวจเฉพาะสถานะการตั้งค่า ไม่แสดง credential
- โค้ดค่าเริ่มต้นหากไม่ตั้ง flag ใช้ dynamic router ดังนั้นปัญหา dynamic ด้านล่างยังสำคัญต่อการเปิดใช้ค่าเริ่มต้น แต่ไม่ใช่เส้นทาง image translation ปัจจุบันของเครื่องนี้
- รายงานเก่า 2026-09-26 ใช้เป็นรายการตรวจเทียบเท่านั้น จำนวนปัญหาในรายงานเก่าไม่ใช่จำนวนปัญหาที่ยังคงอยู่วันนี้

## ผลตรวจที่รันจริง

| ชุดตรวจ | ผล |
|---|---|
| TypeScript `tsc --noEmit` | ผ่าน ก่อน production build |
| ESLint ทั้ง workspace | 0 errors, 50 warnings; รวม scratch/test/vendor และ hook warnings |
| Vitest ทั้งชุด `--maxWorkers 4` | 160 files passed, 1 skipped; 1,074 tests passed, 1 skipped; **exit 1 เพราะ unhandled rejection 1 รายการ** |
| เทสต์กู้ข้อมูลที่เกิด error แยกไฟล์ | 2 assertions ผ่าน แต่ exit 1 ด้วย error เดิม |
| Python `pytest tests -q -m 'not model'` | 193 passed, 3 deselected; 1 dependency deprecation warning |
| Ruff `check app scripts tests` | **ไม่ผ่าน: I001 จำนวน 3 จุด** |
| Next production build | ผ่าน compile, TypeScript และ generate static pages; sandbox attempt แรกติด EPERM บน generated output แล้ว retry ด้วยสิทธิ์ filesystem ปกติผ่าน |
| Probe เฉพาะ audit + mock control | 8 probes + 2 control tests ผ่าน; เป็นการยืนยันพฤติกรรมผิดปัจจุบัน ไม่ใช่ regression tests ที่รับรองว่าแก้แล้ว |

เทสต์ที่ skip คือ CBZ corpus test ซึ่งต้องมี corpus ภายนอก ส่วนเทสต์ Python ที่ต้องมีโมเดลถูกตัดออกด้วย `-m 'not model'` จึงไม่ได้รับรองคุณภาพคลีนจากโมเดลจริง

## ปัญหาที่ต้องแก้

### 1. P1 — Fixed Gemini timeout ไม่ครอบคลุมการอ่าน response body

**ตำแหน่ง:** `lib/server/geminiRequest.ts:293`, `:330`, `:335`; ผู้เรียก fixed image path ที่ `src/app/api/translate/route.ts:326`

**กลไก:** timer ถูก clear ใน finally ของ `fetch` เมื่อได้ headers ก่อน `response.json()` เสร็จ หาก upstream ส่ง headers แล้ว body หยุดส่ง การแปลยังค้างต่อได้ แม้เกิน attempt timeout และ total budget

**หลักฐาน:** probe ตั้ง attempt 20 ms / total 40 ms, ให้ headers ตอบทันทีแต่ body ยังไม่จบ; หลังจำลอง 100 ms promise ยัง pending และ upstream signal ยังไม่ abort ต้อง resolve body เองจึงจบ

**แก้ขั้นต่ำ:** ให้ deadline ครอบคลุม fetch และ body decode ทั้งหมด และคุมด้วย promise deadline เมื่อ transport ไม่ตอบสนองต่อ abort เทียบกับกลไกใน `requestGeminiRoutes`; เพิ่มกรณี headers เร็ว/body ช้าเป็น regression test

**ผลต่อเครื่องนี้:** อยู่ใน fixed image path ที่ตั้งใช้งานอยู่ รวมถึง fixed text endpoint

### 2. P2 — Cancel ยังไม่ทำงานถูกต้องครบทุก router

**ตำแหน่ง:** `lib/server/geminiRequest.ts:317`; `src/app/api/translate/route.ts:336`; `lib/server/geminiTranslationRouter.ts:18`, `:143`

**Fixed:** external abort เข้า catch เดียวกับ transport failure → markKeyCooldown → กรณีคีย์/โมเดลเดียวจบด้วย `GEMINI_TIMEOUT` แทน `REQUEST_ABORTED` ทำให้การยกเลิกของผู้ใช้ลดสถานะคีย์ที่ยังปกติ

**Dynamic:** route ไม่ส่ง signal เข้า `executeGeminiTranslation`; options และการเรียก `requestGeminiRoutes` ใน router ไม่มี external signal จึงยกเลิก discovery/translation ตาม client ไม่ได้

**หลักฐาน:** fixed probe abort ระหว่าง fetch ได้ timeout และคีย์เข้า cooldown; dynamic probe ส่ง signal ที่ abort แล้วแต่ยังเรียก upstream 1 ครั้งด้วย signal ที่ไม่ abort ตรวจ wiring ใน route ยืนยันว่าค่าไม่ได้ถูกส่งต่อ

**แก้ขั้นต่ำ:** แยก external abort ก่อนจัด transport failure และ cooldown; ส่ง signal ครบจาก route → discovery → dynamic request; ถอด abort listeners หลัง attempt สิ้นสุด

### 3. P1 เมื่อใช้ dynamic — Recovery trial ทำให้โมเดลค้างถูกกันออก

**ตำแหน่ง:** `lib/server/geminiTranslationRouter.ts:152`, `:193`; `lib/server/geminiCatalog.ts:462`, `:729`

**กลไก:** claim ตั้ง `halfOpenInFlight=true`; HTTP 200 ที่ validateSuccess ไม่ผ่าน เช่น JSON ไม่ถูกต้อง/ไม่มีข้อความ ถูก return โดยไม่ record success/failure หรือ release trial ทำให้โมเดลไม่มี route ต่อไป

**หลักฐาน:** probe ใช้ `GeminiCatalogManager` จริงกับ discovery จำลอง → record overload → พ้น cooldown → recovery ตอบ 200 แต่ validate ไม่ผ่าน; planRoutes ยัง throw แม้เวลาผ่านอีกนาน และกลับมี route ทันทีหลัง release trial

**แก้ขั้นต่ำ:** คืน trial ในทุก terminal path รวม validation rejection, cancellation, exception และ budget expiration หลัง claim; แยกการ reject workflow success ออกจาก transport success อย่างชัดเจน

**ผลต่อเครื่องนี้:** ไม่อยู่ใน fixed image path ปัจจุบัน; ต้องแก้ก่อนเปิด dynamic หรือใช้ config ค่าเริ่มต้น

### 4. P1 เมื่อใช้ dynamic — บันทึก route state ไม่ได้ทำให้คำแปลที่สำเร็จกลายเป็น error

**ตำแหน่ง:** `lib/server/geminiTranslationRouter.ts:194`; `lib/server/geminiCatalog.ts:502`, `:893`

**กลไก:** recordSuccess รอ persist หลังได้คำแปลแล้ว; mkdir/writeFile error โยนขึ้นไปให้ API ตอบ error แม้ upstream สำเร็จแล้ว การแปลซ้ำจึงมีโอกาสใช้โควต้าอีกโดยไม่จำเป็น

**หลักฐาน:** จำลอง upstream 200 แล้ว recordSuccess reject ด้วย persistence error; router reject แทนคืนคำแปล ตรวจ implementation ยืนยันว่า persist ไม่แยก failure ออกจาก request outcome

**แก้ขั้นต่ำ:** ให้ health-state persistence เป็น best effort พร้อมแจ้ง diagnostics และ serialize writes; ไม่ทิ้งคำแปลที่สำเร็จเพราะ cache file เขียนไม่ได้

**ผลต่อเครื่องนี้:** ไม่อยู่ใน fixed image path ปัจจุบัน

### 5. P2 — Fast restore ของผลคลีนไม่คืนธง awaitingReview

**ตำแหน่ง:** `lib/projectStore.ts:10`; `hooks/useCleaning.ts:373`, `:703`; `src/app/page.tsx:359`; `hooks/useTranslation.ts:1602`

**หลักฐานจาก source trace:** client decode `awaiting_review` ได้ แต่ metadata schema/การบันทึกไม่มี field นี้ และ fast path ที่ประกอบ PageCleaningResult จาก local blobs ไม่คืน awaitingReview; ตัวเตรียมแปลอ่าน `result.awaitingReview === true` จึงเห็น false หลัง restore

**ผล:** หน้าเดิมที่ cleaning verification ขอให้ตรวจอาจไม่ถูกพักก่อน batch translation หลัง reload/นำงานเดิมกลับมา หาก reusable prepared result ถูกใช้ ส่วน export review gate ที่ตรวจ regions เป็นอีกกลไกหนึ่ง จึงไม่ได้สรุปว่า export approval ถูก bypass ทั้งหมด

**แก้ขั้นต่ำ:** persist/restore awaitingReview; สำหรับงานเก่าที่ไม่มี field ให้คำนวณตาม predicate ของ pipeline (`needs_review` และ automaticAction `clean`) ไม่ถือว่า false โดยอัตโนมัติ

**สถานะ:** trace ยืนยัน field loss; ยังไม่ได้ทำ browser reload reproduction

### 6. P2 — Clean proxy รับ cross-origin POST โดยไม่มี origin/auth guard

**ตำแหน่ง:** `src/app/api/clean/[...path]/route.ts:16`, `:29`; เทียบกับ pairing guards ใน extension routes

**หลักฐาน:** direct-handler probe ใส่ external Origin กับ multipart content type และไม่มี token ยัง forward ไป upstream; source ไม่มี origin check

**ผล:** เมื่อ browser/network policy อนุญาตให้เว็บอื่นเข้าถึง loopback ได้ สามารถส่ง simple multipart POST ให้เครื่องทำ cleaning job โดย server ไม่ตรวจสิทธิ์ response อาจอ่านไม่ได้แต่ side effect เกิดได้

**แก้ขั้นต่ำ:** guard ก่อนอ่าน body สำหรับ origin ของแอปและ extension ที่ใช้จริง; จัดการ request ไม่มี Origin ตามสัญญา local clients อย่าพึ่ง CORS เป็น authorization

**สถานะ:** ยืนยัน handler acceptance; ไม่ได้พิสูจน์การโจมตีผ่าน browser จริงและ Local Network Access policy

### 7. P2 — Stop script ปิด process ตามพอร์ตโดยไม่ตรวจว่าเป็นของ SuperK

**ตำแหน่ง:** `stop.bat:15`; caller `src/app/api/system/shutdown/route.ts:70`

**หลักฐานจาก source trace:** ดึง OwningProcess ของทุก listener บน 3000/8765 แล้ว Stop-Process -Force ไม่มี process ownership check

**ผล:** ถ้ามีแอปอื่นครอบครองพอร์ตนั้น การกดปิด SuperK อาจปิดแอปอื่นด้วย

**แก้ขั้นต่ำ:** ใช้ ownership/PID identity ที่โปรเจกต์มีอยู่ (`electron/processOwnership.js`) ให้เหมาะกับ Launcher และตรวจ command/executable/start time ก่อนปิด process; กรณีไม่ใช่ของระบบให้หยุดพร้อมแจ้ง ไม่ kill

**สถานะ:** ตรวจโค้ดเท่านั้น ไม่เรียก stop script

### 8. P1 ต่อชุดตรวจ — Test restore mock ทำให้ CI ไม่ผ่านทั้งที่ assertions เขียว

**ตำแหน่ง:** `tests/cleaning/useCleaning.restoreRace.test.tsx:46`, `:134`, `:142`; error surface `hooks/useCleaning.ts:661`

**กลไก:** mockRejectedValueOnce ครอบคลุมแค่การเรียกครั้งแรก; rerender เปลี่ยนจำนวนหน้าทำให้ restore เรียกอีกครั้งโดย mock ไม่มี default จึง await ได้ undefined แล้ว iterate พัง Production `loadCleaningResultsMetadata` คืน Map หรือ empty Map จึงไม่ใช่หลักฐานว่า IndexedDB failure ทำให้ production hook พังแบบเดียวกัน

**หลักฐาน:** full suite และ isolated test ได้ unhandled rejection เดียวกัน; control copy ของเทสต์เพิ่ม default `mockResolvedValue(new Map())` ใน beforeEach แล้ว 2 tests ผ่านโดยไม่มี unhandled errors

**แก้ขั้นต่ำ:** กำหนด default mock และตรวจทั้ง failed-first/second-call กับ repeat restore; ต้องให้ process exit 0 ไม่ดูแค่จำนวน passed tests

### 9. P2 ต่อชุดตรวจ — Ruff gate ไม่ผ่าน 3 จุด

**ตำแหน่ง:** `ocr-service/app/api.py:21`, `ocr-service/tests/test_mask_refiner.py:171`, `ocr-service/tests/test_pipeline.py:8`

**หลักฐาน:** ruff exit 1, I001 สามรายการ; `.github/workflows/ci.yml` รันคำสั่งเดียวกันใน backend job

**แก้ขั้นต่ำ:** จัดลำดับ import ตาม Ruff แล้วรัน gate อีกครั้ง เป็น lint failure ไม่ใช่หลักฐานว่า cleaning output ผิด

### 10. P3 — Invalid JSON shape ใน translate คืน 500 แทน 400

**ตำแหน่ง:** `src/app/api/translate/route.ts:197`

**หลักฐาน:** direct-handler probe POST body `null` ทำ destructuring throw และตอบ 500

**แก้ขั้นต่ำ:** parse และ shape-check object ก่อน destructure; invalid JSON/shape ให้ตอบ 400 พร้อม stable error code

## สิ่งที่ตรวจแล้วแต่ยังมีข้อจำกัด

| ส่วน | สิ่งที่ตรวจ | ขอบเขตที่ยังไม่รับรอง |
|---|---|---|
| Import / memory | ZIP/CBZ/PDF flow, Blob store, resource eviction, corpus persistence tests | นำเข้าทั้งเล่มยังแปลงทุกภาพเป็น Data URL ใน state ควบคู่ Blob; ไม่ได้วัด RAM จริงกับหนังสือใหญ่วันนี้ |
| Cleaning | API upload guards, job lifecycle, watchdog late-result discard, mask authorization, retry, persistence | ไม่รัน 3 model tests/โมเดลจริง จึงไม่รับรองคุณภาพลบตัวอักษร/รักษาภาพ |
| Translation | fixed/dynamic/OpenAI routing, cancellation, timeouts, cooldown/recovery และ payload guards | ไม่มี credentialed provider call; ไม่รับรอง latency หรือ quota จริง |
| Text editing / export | fixed-font width layout, overlay ownership, undo pathways, render freshness, review/readability gates และ export tests | ไม่มี native pointer drag/browser pixel comparison ใหม่ใน audit นี้ |
| Recovery | project/session assets, monotonic autosave, cleaning fast restore | awaitingReview loss ตามข้อ 5; ไม่ได้ทำ reload ด้วยข้อมูลผู้ใช้จริง |
| Chrome extension | pairing/token storage, settings bridge, handoff/publish tests และ manifest | ไม่ติดตั้ง/ทดสอบ MV3 worker บนหน้าเว็บไซต์จริง |
| Launcher / Electron | launch readiness, stop path, server supervisor, process ownership และ desktop tests | ไม่เปิด/ปิดแอปจริง ไม่ build installer; Electron backlog เดิมไม่ถูกนับว่าแก้แล้ว |

## ลำดับแก้ที่เสนอ

1. คืนชุดตรวจให้ผ่านจริง: ข้อ 8 และ 9
2. แก้ fixed router ที่เครื่องนี้ใช้อยู่: ข้อ 1 และ fixed cancellation ในข้อ 2
3. รักษาสถานะ review หลัง restore: ข้อ 5
4. ปรับ local API guard และ stop ownership: ข้อ 6 และ 7
5. ก่อนเปิด dynamic: ข้อ 3, 4 และ dynamic cancellation ในข้อ 2
6. ทำ shape validation ข้อ 10 แล้วตรวจ browser จริงตั้งแต่นำเข้า → คลีน → แปล → ลากกรอบ → reload → export

ใช้กลไก deadline, authorization และ process ownership ที่มีอยู่ก่อนเพิ่ม framework ใหม่ การตรวจนี้ไม่ได้เปลี่ยน production source, ไม่ commit และไม่ push

## ผลการแก้หลังได้รับอนุมัติ — 2026-10-01

ข้อความด้านบนเป็นผลตรวจ baseline `710c7fe` ก่อนแก้ ส่วนนี้บันทึกการแก้บน branch `codex/system-audit-fixes` ผู้ใช้อนุมัติให้ commit และรวมเข้า `main` ในเครื่องหลังตรวจผล โดยยังไม่มีการ push ในรอบนี้

| ข้อ | การแก้ | หลักฐาน regression |
|---|---|---|
| 1 | Deadline ครอบคลุม fetch และ decode body; จบตามเวลาแม้ provider ไม่ตอบสนองต่อ abort | `geminiAudit.test.ts`: stalled body / ignored abort ทั้ง fixed และ dynamic |
| 2 | ส่ง signal ผ่าน dynamic discovery/request; ยกเลิก retry sleep และ bookkeeping; ไม่ลงโทษ key เมื่อผู้ใช้ยกเลิก | cancellation tests, route signal test และ safe cooldown assertions |
| 3 | คืน recovery trial ใน terminal paths รวม rejected validation และ exceptions; โอนความรับผิดชอบเมื่อ manager บันทึก outcome เพื่อไม่ปล่อย claim ของคำขอใหม่ | recovery lifecycle และ cancellation-during-persistence tests |
| 4 | แชร์ load promise, ต่อคิว write, จับ cache IO failure ด้วย warning ที่ไม่เผย credential | persistence failure / concurrent load / serialized writes tests |
| 5 | เก็บ `awaitingReview` ใน metadata; งานเก่าคำนวณจาก needs_review + clean; cache reuse ยังรักษาธง | explicit/legacy fast restore และ save metadata tests |
| 6 | ตรวจ Host/URL และ Origin ก่อนอ่าน/ส่ง body ให้ cleaner; อนุญาต loopback และ extension | external multipart ไม่เรียก upstream; valid/opaque/malformed origin tests |
| 7 | ตรวจ executable + entrypoint ของ checkout และ recheck launch identity/start time ก่อน Stop-Process; ข้ามโปรเซสที่พิสูจน์ไม่ได้พร้อม warning | PowerShell ownership cases และ mocked termination; ไม่ปิดโปรเซสจริง |
| 8 | metadata mock มี default Map สำหรับ restore ครั้งถัดไป | isolated restore race test ผ่านโดยไม่มี unhandled rejection |
| 9 | เรียง import สามจุด | Ruff `app scripts tests` ผ่าน |
| 10 | JSON/object/optional field shape validation ก่อน destructuring; คืน 400 INVALID_REQUEST | malformed JSON, null/array/scalar และ optional field tests |

### รีวิวและข้อจำกัด

- ผู้รีวิว Gemini พบ partial discovery cancellation ทำให้ cache ไม่ครบ และ cancellation ระหว่าง persistence ยังคืน success; เพิ่ม regression และแก้ทั้งสองจุดแล้ว
- รีวิวสุดท้ายของผู้ช่วยและรีวิวส่วน local ไม่สำเร็จเพราะบัญชีชน usage limit จึงตรวจ diff และเส้นทาง Launcher/restore/request/shutdown โดย agent หลักแทน ยังไม่ถือว่าได้ independent final approval
- Full Vitest ครั้งแรก (`--maxWorkers 4`) ได้ 1125 passed / 1 failed / 1 skipped; เทสต์ Workspace กด T หลัง restore ไม่เรียก mock แปล เทสต์ไฟล์นี้รันแยกได้ 28/28 ผ่าน โดยไม่ได้แก้ production หรือเพิ่ม timeout เพื่อกลบอาการ Full run ถัดไปที่ worker 2 ตัวผ่านทั้งหมด อาการไม่สม่ำเสมอของเทสต์รอบแรกยังไม่ถือว่าหาสาเหตุแล้ว
- ไม่มีการเรียก AI ด้วย credential จริง, รัน cleaning model, ลากกรอบในเบราว์เซอร์, reload ข้อมูลผู้ใช้จริง หรือปิดแอปจริงในรอบนี้

### Final gates บนโค้ดที่แก้แล้ว

| คำสั่ง | ผล |
|---|---|
| `node node_modules/vitest/vitest.mjs run --root . --maxWorkers 2` | exit 0; 163 files passed, 1 skipped; 1126 tests passed, 1 skipped (external CBZ corpus) |
| `node node_modules/typescript/bin/tsc --noEmit` | exit 0 |
| `node node_modules/eslint/bin/eslint.js .` | exit 0; 0 errors, 50 warnings เดิม |
| `venv/Scripts/python.exe -m pytest tests -q -m 'not model' -p no:cacheprovider` ใน ocr-service | exit 0; 193 passed, 3 deselected; 1 dependency deprecation warning |
| `venv/Scripts/python.exe -m ruff check app scripts tests` ใน ocr-service | exit 0; All checks passed |
| `node node_modules/next/dist/bin/next build` | exit 0; production build และ TypeScript ผ่าน |
| `node scripts/sync-standalone-assets.mjs` | exit 0; standalone assets/environment synced |
| `git diff --check` | exit 0 |

Regression หลังแก้ประเด็นรีวิว: Gemini audit/persistence + ownership + desktop Launcher 30 tests ผ่าน; shutdown route อีก 3 tests ผ่าน โดยไม่มีการปิดระบบจริง
