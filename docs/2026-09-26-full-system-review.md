# รายงานรีวิวระบบฉบับเต็ม (Full System Review) — 2026-09-26

- **คอมมิทอ้างอิง:** `bcd4cb3` (snapshot ที่ใช้รีวิว; working tree สะอาด ณ ตอนนั้น) — ก่อนลงมือแก้ต้องตรวจ HEAD, diff ที่ค้าง และ line numbers ใหม่; ณ ตอนปรับแผน HEAD คือ `f8de9f6` และมีการแก้ `hooks/usePageZoom.ts` กับ test ที่ยังไม่ commit
- **บริบท:** แอป Local Single-User บน Windows 11 — Next.js 16 (React 19) + Python sidecar (FastAPI) + Electron 44 shell + Chrome extension
- **ขอบเขตการรีวิว:** `src/app`, `lib/`, `hooks/`, `components/`, `electron/`, `ocr-service/app`, `chrome-extension/`, `scripts/`
- **วิธีการ:** รีวิวเชิงลึกขนานกัน 5 ส่วน พร้อมตรวจสถานะ build/test จริง — ข้อที่เขียนว่า **✅ ยืนยันแล้ว** คือข้อที่ผู้รีวิวเดิมระบุว่าตรวจซ้ำด้วยตนเอง, ข้อที่เขียนว่า **🔍 หลักฐานจากโค้ด** คือข้อสรุปจากการไล่โค้ดที่ต้อง reproduce หรือหาหลักฐานหักล้างก่อนแก้ ผล test ด้านล่างเป็น baseline ณ commit อ้างอิง ไม่ใช่ผลตรวจรับของการแก้ในอนาคต

---

## สรุปสถานะระบบ (ตรวจจริง ณ วันที่รีวิว)

| รายการ | ผลลัพธ์ |
|---|---|
| `npx tsc --noEmit` | ✅ 0 errors |
| vitest (JS suite) | ✅ **929 passed** / 1 skipped (145 ไฟล์) |
| pytest (sidecar suite) | ✅ **186 passed** / 3 skipped |
| ESLint | ✅ 0 errors, 46 warnings (unused-vars ส่วนใหญ่อยู่ในไฟล์ test) |

**จุดแข็งที่ยืนยันได้:** ส่วนแกนกลาง mask authorization / region recovery / translation scoping ถูกต้องตาม CONTEXT.md ทุกข้อ (มี test รองรับ), test coverage ของ sidecar หนาแน่นผิดปกติในกลุ่ม safety-critical, Electron window config ปลอดภัยตามมาตรฐาน, error taxonomy ของฝั่ง Gemini รวมศูนย์และ client เคารพจริง

**สรุปจำนวน findings ทั้งหมด:**

| ระดับ | จำนวน | ความหมาย |
|---|---|---|
| 🔴 P1 | **19** | พัง workflow หลัก / ช่องโหว่จริง / state พังถาวร |
| 🟡 P2 | **52** | บั๊กจริงแต่กระทบเป็นกรณี / ลดคุณภาพ / resource รั่ว |
| ⚪ P3 | **17** | ความเสี่ยงแฝง / dead code / ควรรู้ไว้ |
| ⚪ หมายเหตุ | 1 | dead studio stack (de-scoped แล้วตามแผนเดิม) |

---

# ส่วน A — API layer + Gemini server libs

`src/app/api/**`, `lib/server/**`, `lib/translation/*` (server-side), `lib/projectStore.ts`

> ⚠️ **ข้อกำหนดด้านสถาปัตยกรรม (Production Live Baseline Note):**
> อ้างอิงตาม `docs/AI-WORKING-NOTES.md` และกฎเหล็กของโปรเจกต์: **Production live path ของการแปลถูกล็อคไว้ที่ Fixed Route (`requestGemini`)** ซึ่งเสถียรและผ่านการยืนยันใช้งานจริงแล้ว
> ส่วนระบบ Dynamic Catalog (`geminiCatalog.ts`, `geminiTranslationRouter.ts`, `executeGeminiTranslation`) มีสถานะเป็น **EXPERIMENTAL** ดังนั้นข้อ **A1** และ **A2** แม้จะเป็นข้อบกพร่องจริงในโครงสร้าง Dynamic Catalog แต่ **ไม่ได้กระทบเส้นทางแปลจริงของผู้ใช้ในปัจจุบัน** จึงถูกปรับลดความเร่งด่วนในคิวหลักไปอยู่ในหมวด Experimental Backlog เพื่อไม่ให้เสียแรงงานและเสี่ยงเกิด Regression บน production route

## A1. 🔴 P1 (EXPERIMENTAL / Live Path ไม่ได้รับผลกระทบ) — Recovery-trial state leak: model ที่โดน overload ถูก wedge ถาวร ✅ ยืนยันแล้ว

- **ตำแหน่ง:** `lib/server/geminiCatalog.ts:462-468, 728-732` + `lib/server/geminiTranslationRouter.ts:152-157, 193-200` + `src/app/api/translate/route.ts:308-323`
- **อาการ:** `beforeRoute` เรียก `claimRecoveryTrial` (ตั้ง `halfOpenInFlight = true`) แต่มีเพียง `recordFailure` / `recordSuccess` เท่านั้นที่เคลียร์ กรณี `validateSuccess` คืน `false` (เช่น 200 แต่ `finishReason: "SAFETY"`, มี `blockReason`, หรือ JSON พัง) จะไม่มีทั้ง `recordSuccess` และ `recordFailure` ทำงาน:

  ```ts
  if (options.validateSuccess?.(result.data) !== false) {
    await geminiCatalogManager.recordSuccess(...)
  }
  ```

  `routesForModel` จะคืน `[]` ตลอด (`if (overload.halfOpenInFlight) return []`) และ overload state ไม่มี TTL → model นั้นถูก exclude จาก routing **ถาวรจนกว่าจะ restart server** กรณีเดียวกันเกิดเมื่อ post-claim budget check ใน `geminiRequest.ts:372-382` throw โดยไม่เรียก `onRouteFailure`
- **ทางแก้:** เรียก `releaseRecoveryTrial` (มี method อยู่แล้วที่ `geminiCatalog.ts:470` แต่ไม่ถูกเรียกใน path นี้) เมื่อ `validateSuccess === false` และเมื่อ route loop throw หลัง claim

## A2. 🔴 P1 (EXPERIMENTAL / Live Path ไม่ได้รับผลกระทบ) — Persist ของ Gemini state ไม่มี serialization/error handling — persist ล้มเหลวเปลี่ยนการแปลที่สำเร็จเป็น 500 🔍 หลักฐานจากโค้ด

- **ตำแหน่ง:** `lib/server/geminiCatalog.ts:893-903, 475-503, 505-532, 875-891` + `geminiTranslationRouter.ts:194` + `geminiRequest.ts:533`
- **อาการ:** `persist()` เป็น `await writeFile(...)` เปล่าๆ ไม่มี mutex ไม่มี try/catch และ `recordSuccess`/`recordFailure` ปล่อย error ทะลุ โดย `executeGeminiTranslation` ไป `await recordSuccess` **หลัง** route สำเร็จแล้ว → EPERM/EBUSY ที่ `superk-gemini-state.json` ( antivirus/OneDrive เป็นสาเหตุที่พบบ่อยบน Windows) ทำให้:
  1. การแปลที่จ่ายโควต้าไปแล้วกลายเป็น 500 ผ่าน catch-all ที่ `translate/route.ts:402-408`
  2. abort fallback loop กลางทาง (`const directive = await onRouteFailure?.(route, error)`)
  3. 2 request พร้อมกัน persist พร้อมกัน → JSON เสียหาย แล้วถูก "recover" ด้วยการล้าง route-health state ทิ้งเงียบๆ
  4. `ensureLoaded` ตั้ง `this.loaded = true` **ก่อน** `await readFile` → concurrent `getCatalog` ทำงานกับ map ว่างแล้ว persist ทับ pool ที่เคยบันทึกไว้
- **ทางแก้:** serialize persist ผ่าน queued promise, wrap record/persist ให้ state error ไม่มีทาง abort request path, ให้ `getCatalog` await load promise เดียวกัน

## A3. 🔴 P1 — Pairing token อ่านได้ผ่าน DNS rebinding (origin==host match) 🔍 หลักฐานจากโค้ด

- **ตำแหน่ง:** `src/app/api/extension/pair/route.ts:41`
- **อาการ:**

  ```ts
  if (host && (originUrl.host === host || originUrl.hostname === hostName)) {
    return true;
  }
  ```

  เว็บภายนอกที่ DNS ชี้มา 127.0.0.1 ทำให้ browser ส่ง `Host: attacker.com:3000` + `Origin: http://attacker.com:3000` → เงื่อนไข `originUrl.host === host` ผ่าน; หาก Origin ไม่มี port เงื่อนไข `originUrl.hostname === hostName` ก็ผ่านได้ เมื่อ browser มองว่า same-origin จึง**อ่าน `{ pairingToken }` ได้โดยไม่มี CORS ขวาง** แล้วใช้ token เรียก `/api/extension/settings` (อ่าน `hasServerKey`, `modelCatalog`, overwrite key/`ocrServiceUrl` ของผู้ใช้ได้)
- **ทางแก้:** เลิกยอมรับ same-host แบบทั่วไป **ทั้ง** `originUrl.host === host` และ `originUrl.hostname === hostName`; ให้ `/pair` ยอมรับเฉพาะ origin ของหน้าแอปบน loopback scheme/host/port ที่กำหนดจาก listener จริง ไม่ตัดเพียง clause เดียว เส้นทางเปิดใช้งานใน repo ผูก loopback อยู่แล้วและ extension ใช้การคัดลอก token จากหน้า Settings ไป popup จึงไม่มีเหตุให้ extension origin เรียก `/pair` หรือคงข้อยกเว้น remote self-hosted ใน route นี้ ทดสอบ request ผ่าน browser/HTTP ที่ `Host` และ `Origin` เป็นโดเมนโจมตีเดียวกันหลัง DNS ชี้เข้า loopback พร้อมยืนยันว่าหน้าแอปยังแสดง token สำหรับจับคู่ได้

## A4. 🔴 P1 — Path traversal ใน clean proxy: segment `..` ทะลุ scoping ✅ ยืนยันแล้ว

- **ตำแหน่ง:** `src/app/api/clean/[...path]/route.ts:46-51`
- **อาการ:** `encodeURIComponent("..") === ".."` → request `/api/clean/v1/%2e%2e/admin` ได้ target `http://127.0.0.1:8765/v1/../admin` ซึ่ง `new URL` normalize เป็น `/admin` — proxy หลุดจากขอบเขต `/v1/*` และไม่มี allowlist segment แรก (ปัจจุบัน endpoint ไฟล์ของ sidecar มี whitelist ชื่อไฟล์อยู่ที่ `ocr-service/app/api.py:188-196` จึงยังไม่ลุกลาม แต่ proxy นี้คือ security boundary ที่ประกาศไว้)
- **ทางแก้:** reject segment `.`/`..` → 400, require `path[0] === "v1"`, แล้วตรวจ pathname หลัง `new URL(...)` ว่ายังอยู่ใต้ `/v1/` ก่อน fetch ทดสอบผ่าน HTTP route จริงด้วย encoded dot-segments และ path ที่ไม่ขึ้นต้น `/v1/`; direct invocation ที่สร้าง `context.params` เองไม่พอพิสูจน์พฤติกรรมของ router

## A5. 🟡 P2 — `glossary[].note` ที่ไม่ใช่ string ทำ prompt build crash (500 จาก input ที่ไม่ร้ายแรง) 🔍

- **ตำแหน่ง:** `lib/translation/glossary.ts:26` ผ่าน `src/app/api/translate/route.ts:169`
- **อาการ:** filter ตรวจเฉพาะ `source`/`target`; `entry.note?.trim()` throw เมื่อ client ส่ง `{"note":1}` (number ไม่ใช่ nullish) → 500 แทนการข้าม entry
- **ทางแก้:** `typeof entry.note === "string" ? entry.note.trim() : undefined`

## A6. 🟡 P2 — JSON พัง / shape ผิดได้ 500 แทน 400 ใน translate routes 🔍

- **ตำแหน่ง:** `src/app/api/translate/route.ts:169, 402-408`; `src/app/api/translate-text/route.ts:24, 139-142`
- **อาการ:** `await req.json()` ที่ JSON invalid หรือ destructuring `null`/array throw แล้วโดน generic catch คืน 500 ขณะที่ sibling routes (`translate/models:15-24`, `validate-key:13-24`) ทำ 400 ถูกต้อง — ไม่สม่ำเสมอ
- **ทางแก้:** parse + shape-check ต้นทางแล้วคืน 400

## A7. 🟡 P2 — NDJSON stream: disconnect race เสี่ยง unhandled rejection (server ตาย) + cancel ไม่ยิง abort ไปที่ Gemini 🔍

- **ตำแหน่ง:** `src/app/api/translate/route.ts:98-139`
- **อาการ:** ถ้า client หลุดช่วงระหว่าง runtime ปิด controller กับ `cancel()` รัน, `controller.enqueue` throw ใน `try`, `catch` เรียก `send()` ซ้ำซึ่ง throw อีก และ IIFE ที่ถูก `void` reject ไร้ handler — ภายใต้ Node default `--unhandled-rejections=throw` **โปรเซส Next ตายทั้งตัว** และ `cancel()` แค่พลิก flag: request Gemini ที่ใช้เวลา 60-90 วิ ยังวิ่งต่อ (เปลืองโควต้า/เสีย route health)
- **ทางแก้:** wrap `send`/`close` ด้วย try/catch ใน IIFE + thread `AbortController` เข้าไปถึง `requestGeminiRoutes`

## A8. 🟡 P2 — `system/shutdown` ใช้ prefix matching กับ Host check 🔍

- **ตำแหน่ง:** `src/app/api/system/shutdown/route.ts:11-13`
- **อาการ:** `host.startsWith("127.0.0.1")` รับ `Host: 127.0.0.1.evil.com` ด้วย (Origin check ยังกันอยู่เมื่อมี Origin จึงเป็น defense-in-depth เท่านั้น) — ควรเป็น `host === ... || host.startsWith("127.0.0.1:")`

## A9. 🟡 P2 — `getCatalog` ไม่มี in-flight dedup: N หน้าพร้อมกัน = N รอบ discovery ต่อ key 🔍

- **ตำแหน่ง:** `lib/server/geminiCatalog.ts:331-348`
- **อาการ:** cache หมดอายุแล้วทุก request ที่พร้อมกันวิ่ง `discover()` (ListModels แบบ paginated ต่อ 1 key, สูงสุด 50) → thundering herd + persist churn ซ้ำ
- **ทางแก้:** memoize in-flight discovery promise ต่อ pool id

## A10. 🟡 P2 — `/api/translate-text` เป็น dead endpoint ที่ bypass สถาปัตยกรรม route-health ทั้งหมด 🔍

- **ตำแหน่ง:** `src/app/api/translate-text/route.ts` (ทั้งไฟล์) — ไม่มี caller ใน `src/`, `lib/`, `components/`, `hooks/`, `electron/`, `chrome-extension/`
- **อาการ:** duplicate ladder ของ fixed-model เก่า (hard-coded list ที่ 82-92, `.split(",")` key parsing ที่ 38-41) ไม่แตะ `geminiCatalogManager` (ไม่มี route health/compatibility/overload cooldown) และคืน `error.message` โดยไม่ redact — จะ drift เงียบๆ
- **ทางแก้:** ลบ หรือ wire เข้า `executeGeminiTranslation`

## A11. 🟡 P2 — Origin enforcement ไม่สม่ำเสมอทั่ว API surface 🔍

- **ตำแหน่ง:** `src/app/api/extension/*` มี `isOriginAllowed` ครบ แต่ `clean/[...path]`, `translate`, `translate-text`, `translate/models`, `validate-key` ไม่มีเลย
- **อาการ:** response ข้าม origin อ่านไม่ได้ (ไม่มี ACAO) แต่เว็บภายนอกยิง no-cors POST (multipart เป็น simple content type) เพื่อขับเคลื่อน cleaner หรือเผาโควต้า Gemini ได้ — ช่องทางเดียวกับที่ extension routes เขียนกันไว้
- **ทางแก้:** shared origin guard (loopback + extension schemes) กับทุก local route

## A12. 🟡 P2 — In-memory maps โตไม่จำกัด; ข้อความ "expired" ไม่เป็นความจริง 🔍

- **ตำแหน่ง:** `src/app/api/extension/workspace/append/route.ts:16-19, 121` (handoffs ไม่มี eviction); `src/app/api/extension/publish-back/route.ts:16-18` (`publishedMap` ไม่เคยเคลียร์ต่อ epoch)
- **ทางแก้:** รวมงานนี้กับ ER1 เป็นรากปัญหาเดียวกัน: handoff ใช้ TTL/cap ตามอายุการใช้งานจริง ส่วน `publishedMap` ต้องกำหนดการเก็บ latest snapshot ต่อหน้าและสัญญา resync ก่อนตั้ง TTL/cap เพื่อไม่ให้ extension ที่ออฟไลน์นานพลาด update

## A13. 🟡 P2 — `saveProjectSession`: data URL ที่พัง 1 รายการทำ autosave พังถาวรทั้ง session; transaction timeout รายงานสำเร็จลวง 🔍

- **ตำแหน่ง:** `lib/projectStore.ts:299, 352-355, 775-811`
- **อาการ:** `dataUrlToBytes(imageValue)` ที่บรรทัด 299 เรียก `atob` ไม่มี guard (ต่างจาก path source-page ที่ 222-231 มี try/catch) → cache เสีย 1 ชิ้นทำให้ autosave พังจนจบ session; `transactionDone` **resolve (สำเร็จ)** เมื่อ transaction เกิน 4000 ms — blob หลาย MB ของ manga เกินบ่อย แล้ว abort ภายหลัง (เช่น QuotaExceeded) โดนกลืนเงียบ และ UI เชื่อว่าเซฟแล้ว
- **ทางแก้:** try/catch ต่อหน้ารอบ decode + มอง timeout เป็นความล้มเหลว/ต้อง recheck ไม่ใช่ resolve

## A14. 🟡 P2 — Key redaction มีเฉพาะ Gemini path แต่ OpenAI-compatible path ไม่มี 🔍

- **ตำแหน่ง:** `src/app/api/translate/route.ts:329-334` เทียบกับ `512-522`
- **อาการ:** Gemini path sort key pool ด้วยความยาวแล้ว replaceAll เป็น `[REDACTED]` ก่อน echo `error.message`; `handleOpenAICompatible` คืน `error.message` ดิบ (`requestOpenAICompatible` ใน `lib/server/geminiRequest.ts:679-684` embed transport error ดิบด้วย) — วันนี้ upstream ไม่ echo credential แต่ความไม่สมมาตรนี้คือระเบิดเวลาถ้ามี relay ที่ echo auth
- **ทางแก้:** รัน redaction helper เดียวกันบน OpenAI-compatible message

---

# ส่วน B — Client core (`lib/` + `hooks/`)

## B1. 🔴 P1 — Bubble ที่ลบแล้วยังถูก composite ลงภาพ export ✅ ยืนยันแล้ว

- **ตำแหน่ง:** `lib/translationOverlay.ts:221-257` (+ `1062-1082`, callers ที่ `src/app/page.tsx:1011, 1396, 1415`)
- **อาการ:** `deleteBubbleWithUndo` แค่ `wrapper.style.display = "none"` — canvas ของ bubble ยังมี pixel เก่าอยู่ใน DOM; `downloadTranslatedImage` iterate ทุก wrapper แบบไม่กรอง:

  ```ts
  const wrappers = container.querySelectorAll(".tl-canvas > div");
  wrappers.forEach((wrapperEl) => { ... ctx.drawImage(bCanvas, ...) ... });
  ```

  export หน้าเดียวและ branch "current page" ของ `getExportDataUrl` อ่าน live DOM → ผู้ใช้ลบ bubble แล้ว export = ได้ bubble ที่ลบกลับมาในไฟล์เงียบๆ
- **ทางแก้:** skip wrapper ที่ `style.display === "none"` (หรือ `data-deleted` marker)

## B2. 🔴 P1 — Overlay paint ไม่มีลำดับ: bubble ของหน้าเก่าชนะ race ตอนสลับหน้า 🔍

- **ตำแหน่ง:** `lib/translationOverlay.ts:1761-1766` + `hooks/useTranslation.ts:496-523, 866-879`
- **อาการ:** `applyTranslationOverlay` ไม่มี cancellation token — paint ถูกเลื่อนไปหลัง font promise:

  ```ts
  document.fonts.load(`1em ${resolveCanvasFontFamily(...)}`).then(() => {
    if (img.complete && img.naturalWidth) paint(); else img.onload = paint;
  });
  ```

  `renderAndCacheTranslation` เช็ค `activePageRef.current === pageUrl` แบบ sync แล้วเรียก `void applyTranslationOverlay(...)` ของหน้าก่อน — ถ้าผู้ใช้สลับหน้าระหว่าง guard กับ `paint()` ที่ถูกเลื่อน paint ของหน้าเก่ารันท้ายสุด (แต่ละ `paint()` ลบ `.tl-canvas` ก่อน → last paint wins) และ drag/save closures บันทึก adjustment ใต้ `pageKey` เก่า
- **ทางแก้:** generation token (per container/hook) ส่งเข้า `applyTranslationOverlay` และให้ `paint()` ยอมแพ้ถ้า generation ใหม่วาดไปแล้ว

## B3. 🔴 P1 — Restore ด้วย metadata ที่ไม่มี width/height ทำหน้ากลายเป็น "clean-only" เงียบๆ 🔍

- **ตำแหน่ง:** `hooks/useCleaning.ts:694-695` + `lib/cleaning/textAuthorization.ts:18-19`
- **อาการ:** fast-path restore สร้าง result ด้วย `width: metadata.width ?? 0, height: metadata.height ?? 0` (type ประกาศ `width?: number` ที่ `lib/projectStore.ts:27-28`) ตอนแปล `translationScope` หารศูนย์ → `NaN` boxes → `withinTranslationScope` คืน `false` ทุก bubble → หน้าถูก cache เป็น background-only พร้อม "ไม่พบประโยคที่ต้องแปล" (server hydration path มี `assertMatchingImageDimensions` กันที่ `useCleaning.ts:276-280` แต่ fast path ข้าม)
- **ทางแก้:** ข้าม fast-path restore เมื่อ `metadata.width`/`height` ไม่มีหรือ ≤ 0 (หรือ validate dimension ของ decoded bitmap แบบ `hydrateResult`)

## B4. 🟡 P2 — `document.fonts.load(...).then(...)` ไม่มี `.catch` → render ค้าง + unhandled rejection 🔍

- **ตำแหน่ง:** `lib/translationOverlay.ts:1761-1766`; ผลกระทบที่ `hooks/useTranslation.ts:840-843`
- **อาการ:** font-family string ที่ invalid (มาจาก user-editable `textStyle`) ทำ promise reject → overlay ไม่วาด, `onComplete` ไม่ยิง, watchdog 30 วิ fail หน้า ("สร้างภาพคำแปลไม่สำเร็จ") พร้อม unhandled rejection; เกี่ยว: retry loop `if (!iw || !ih) { setTimeout(paint, 100); return; }` ที่ 561 วนไม่มีที่สิ้นสุดสำหรับภาพที่ decode ไม่ได้
- **ทางแก้:** `.catch(() => paint())` + cap retry loop

## B5. 🟡 P2 — Unhandled rejection ทำ session restore ตายทั้งชุด 🔍

- **ตำแหน่ง:** `hooks/useCleaning.ts:651-652`
- **อาการ:** `await loadCleaningResultsMetadata()` เป็น statement แรกของ IIFE ที่ถูก `void` และอยู่**นอก** per-page try — IndexedDB open fail = restore ทั้งหมด reject ไร้ handler
- **ทางแก้:** wrap try/catch

## B6. 🟡 P2 — Side effects ใน `setDoc` updater 🔍

- **ตำแหน่ง:** `hooks/useTextLayers.ts:65-86, 95-116, 124-145`
- **อาการ:** `undoManager.push(...)` และ `onDocumentChange?.(next)` อยู่ใน `setDoc((prev) => ...)` — updater ต้อง pure; StrictMode invoke ซ้ำ = undo entry ซ้ำ + notification ซ้ำตอน render
- **ทางแก้:** คำนวณ command result นอก updater แล้ว `setDoc` ด้วย pure function

## B7. 🟡 P2 — Regex ภาษาไทยกว้างเกิน ทำคำที่ถูกต้องเสียหาย 🔍

- **ตำแหน่ง:** `lib/thaiSpellcheck.ts:12-13` (และ identity rules ที่ 48-49)
- **อาการ:** `[/คระ/g, "ค่ะ"]` และ `[/คร่า/g, "ค่า"]` match substring: `อักขระ` → `อักขค่ะ`, `คระหนัก` → `ค่ะหนัก`, `คร่าว` → `ค่าว` — รันกับทุก bubble ผ่าน `normalizeThaiText`
- **ทางแก้:** anchor ด้วยบริบท word-boundary (ตำแหน่ง particle / ช่องว่าง / เครื่องหมายคำพูด)

## B8. 🟡 P2 — Resource eviction เรียก `revokeObjectURL` ของหน้าที่กำลังแสดง 🔍

- **ตำแหน่ง:** `lib/lifecycle/workspaceResourceManager.ts:196-207` + `lib/lifecycle/resourceBudget.ts:139-147`
- **อาการ:** `evictToFit` วนจนกว่าจะต่ำกว่า budget — เมื่อ cold หมดจะกิน warm ต่อ → ภายใต้ memory pressure URL ของ `<img src=blob:...>` หน้าปัจจุบันถูก revoke กลางแสดงผล (จอดำ); เกี่ยว: object URL ของ cold pages จาก `updateNavigation` ถูก revoke เฉพาะตอน budget eviction ไม่ตอน warm-set reconciliation
- **ทางแก้:** hard floor ให้ warm items ใน `evictToFit` + revoke cold URL ตอน warm-set reconciliation

## B9. 🟡 P2 — Readability gate ใช้ luminance แบบ bucket-weighted ไม่ใช่ pixel-weighted 🔍

- **ตำแหน่ง:** `lib/colorMatching/sampleTextColors.ts:365-373` (ผลต่อ `resolveTextStyle.ts:302-317`)
- **อาการ:** `bgLuminanceSamples` สร้างจาก perimeter **buckets** ที่ถูก sort ตาม count — bucket สีผิดเล็กๆ นับเท่า dominant background ทำให้ p15/p85 / `isMixed` / `hasWeakRegion` trigger จาก noise ไม่ใช่พื้นที่จริง
- **ทางแก้:** accumulate per-pixel luminance หรือ weight ตาม count

## B10. 🟡 P2 — Canvas churn ต่อ render ใน text fitting 🔍

- **ตำแหน่ง:** `lib/translationOverlay.ts:383-399` (สร้าง canvas ใน loop ลด font-size) และ `:307`
- **อาการ:** `fitTextForBubble` สร้าง `createElement("canvas")` + context ใหม่ทุก iteration และ `wrapTextForBubble` (อีก canvas) ต่อ iteration — หลักสิบ canvas ต่อ bubble ต่อ render คูณทุก `b.render()` ใน textStyle effect
- **ทางแก้:** hoist measuring canvas ระดับ module มา reuse

## B11. 🟡 P2 — `saveBlob` revoke object URL พร้อมกันหลัง `click()` 🔍

- **ตำแหน่ง:** `lib/export/saveLocation.ts:415-421`
- **อาการ:** `link.click(); URL.revokeObjectURL(url);` — revoke ก่อน browser เริ่ม fetch อาจ abort download (แล้วแต่ engine)
- **ทางแก้:** deferred revoke (`setTimeout(...)`)

## B12. ⚪ P3 — `activeRequestRef` เป็น slot เดียว 🔍

- **ตำแหน่ง:** `hooks/useCleaning.ts:184-186, 464, 559, 619` + page-change effect ที่ 203-220
- **อาการ:** operation ที่ 2 ทับ slot ทำให้ page-change bump token ของ**หน้าเก่า**แทน request ที่ active จริง → background re-clean อาจรอดจาก cancellation ที่ตั้งใจไว้

## B13. ⚪ P3 — Quota-break ทิ้ง floating prefetch 🔍

- **ตำแหน่ง:** `hooks/useTranslation.ts:1621-1624, 1807`
- **อาการ:** `prepareSafely(nextIndex)` ที่เริ่มไว้ไม่มีใครเก็บ — `break` (quota) ปล่อย preparation วิ่งต่อเบื้องหลังหลัง batch รายงานเสร็จแล้ว

## B14. ⚪ P3 — `executeConcurrentRetry` ติด label stage ผิด + dead state 🔍

- **ตำแหน่ง:** `hooks/useTranslation.ts:1918-1925, 1102-1104`
- **อาการ:** preparation failure ถูก label `stage: "translation"` (บิดเบี้ยว failure groups); `inFlightConcurrentPagesRef` เขียนแต่ไม่เคยอ่าน; delay 1 วิ + cooldown 2 วิ ไม่ abort-aware

## B15. ⚪ P3 — Undo entries จับ detached DOM 🔍

- **ตำแหน่ง:** `lib/translationOverlay.ts:971-985, 1067-1081, 1191-1203`
- **อาการ:** closure ครอบ `wrapper`/`renderBubble` — หลัง remount, undo/redo แก้ node ที่หลุดแล้วเงียบๆ และ pin ไว้ใน `undoManager` (50 entries); `duplicate` (:1419) ไม่ undo ได้ + id จาก `${Date.now()}` ชนกันได้ใน ms เดียว

## B16. ⚪ P3 — `overlayCleanups` prune เฉพาะตอน apply overlay ใหม่ 🔍

- **ตำแหน่ง:** `lib/translationOverlay.ts:129-138, 522`
- **อาการ:** document-level `pointerdown`/`keydown`/`resize`/`scroll(capture)` listeners ของ container ที่ถูกลบยังติดอยู่ พร้อม strong refs

## B17. ⚪ P3 — ขอบเขต LRU เป็น advisory เมื่อทุก entry ถูก protect 🔍

- **ตำแหน่ง:** `lib/lruMap.ts:88-93`
- **อาการ:** `findEvictable` คืน `undefined` → `set` break ทั้งที่ map เกิน `maxEntries`/`maxWeight` — โอเคกับดีไซน์ "protected" แต่ caller ควรรู้ว่า bound เป็น soft

## B18. ⚪ P3 — Erase-brush ทิ้ง marker RGB ใต้ `alpha=0` 🔍

- **ตำแหน่ง:** `lib/cleaning/maskEdits.ts:75-78`
- **อาการ:** เขียน `255,70,90` แม้ erase mode — วันนี้ไม่มีผล (encode ใช้ alpha + premultiplication) แต่ consumer ในอนาคตที่อ่าน `max(R,G,B)` จะถือว่า pixel ที่ลบแล้วเป็น authorized
- **ทางแก้:** zero RGB เมื่อ `mode !== "paint"`

## B19. ⚪ P3 — `usePageZoom.handleWheel` คำนวณจาก closure `zoomState.scale` 🔍

- **ตำแหน่ง:** `hooks/usePageZoom.ts:282`
- **อาการ:** wheel หลาย event ที่ batch เข้ามาพร้อมกันคูณจาก scale เก่าเหมือนกัน → accelerator ไม่สม่ำเสมอ; ควร derive ใน `setZoomState` updater (แบบ `zoomTo`)

---

# ส่วน C — Python sidecar (`ocr-service/app/`)

> Loopback binding ตรวจแล้ว: uvicorn รัน `--host 127.0.0.1 --port 8765` ทั้งจาก `electron/sidecar.js` และ `run.ps1` — ไม่มี `0.0.0.0`

## C1. 🔴 P1 — Retry cleaner `lama-large` ถูก API รับแต่ job พังทุกครั้ง 🔍

- **ตำแหน่ง:** `ocr-service/app/pipeline.py:879-888` เทียบ `ocr-service/app/api.py:50`
- **อาการ:** `RETRY_CLEANERS` รับ `lama-large` แต่ mapping ใน `retry_region` ลืม:

  ```python
  cleaner_key = {
      "auto": record.route.value,
      "flat": CleanerRoute.FLAT.value,
      "opencv": CleanerRoute.GRADIENT.value,
      "aot": "aot",
      "anime-lama": "anime-lama",
  }.get(cleaner)   # "lama-large" → None → self.cleaners.get("") → None
  ```

  → `RuntimeError: cleaner is unavailable` → job failed (test retry ทดสอบแค่ `opencv` ที่ `tests/test_api.py:266`)
- **ทางแก้:** เพิ่ม `"lama-large": "lama-large"` หรือ validate form field จาก mapping keys โดยตรง

## C2. 🟡 P2 — กลืน exception ตอนโหลด LamaLarge — คุณภาพตกเงียบๆ ไม่มี log 🔍

- **ตำแหน่ง:** `ocr-service/app/api.py:329-333`
- **อาการ:** `except Exception: lama_large = None` — model เสีย/โหลดไม่ได้ = ทุก route (รวม ARTWORK ซึ่งเป็นจุดประสงค์หลักของ lama-large ตาม `region_router.py:38-48`) ตกไปใช้ Flat/Gradient/AOT เงียบๆ ไม่มี diagnostic
- **ทางแก้:** `LOGGER.exception(...)` ใน except

## C3. 🟡 P2 — Dead `elif` ใน detector high-edge-density path 🔍

- **ตำแหน่ง:** `ocr-service/app/detector.py:596-608`
- **อาการ:** `elif np.count_nonzero(seed) > 0:` ทดสอบ**เงื่อนไขเดียวกัน**กับ `if` ที่เพิ่ง false → fallback "ใช้ raw local probability เมื่อ seed โตไม่ได้" ไม่มีวันรัน (branch คู่ที่ 635-639 ของ non-artwork path reachable) — พฤติกรรม conservative แต่โค้ดไม่ทำตามที่ดูเหมือน

## C4. 🟡 P2 — PaddleOCR overlap dedupe เป็น dead code: `matched` เป็น False เสมอ 🔍

- **ตำแหน่ง:** `ocr-service/app/detector.py:697-709`
- **อาการ:** loop overlap ตั้ง `ev.source = EvidenceSource.BOTH` แล้ว**ตั้ง `matched = False` ทับ** (708) → `if not matched and ...` เป็นจริงเสมอ — duplicate Paddle region ถูก append ทั้งที่ overlap สมบูรณ์ ขัดกับ comment เจตนา "recognition confirms its own polygon"
- **ทางแก้:** ตั้ง `matched = True` เมื่อ overlap แล้ว skip, หรือลบตัวแปรกับ comment ที่หลอก

## C5. 🟡 P2 — `_pipeline()` build ไม่ sync — double model load + leak เมื่อ `max_workers > 1` 🔍

- **ตำแหน่ง:** `ocr-service/app/jobs.py:477-480`
- **อาการ:** check-then-act race — worker 2 ตัว build pipeline พร้อมกัน (CTD ONNX + Big-LaMa + Paddle = GBs RAM/VRAM), assignment ที่สอง drop reference แรก (GC ค่อยเก็บ) และทั้งคู่ download/verify model ผ่าน `ModelStore.ensure` พร้อมกันลง `.part` ไฟล์เดียวกัน (`model_store.py:65-76`); test ที่ `test_jobs.py:239` รัน `max_workers=2` อยู่แล้ว
- **ทางแก้:** build ใต้ `self._jobs_lock` (double-checked)

## C6. 🟡 P2 — `shutdown()` unload models ก่อน drain worker pool 🔍

- **ตำแหน่ง:** `ocr-service/app/jobs.py:262-268`
- **อาการ:** `unload_models(force=True)` ก่อน `executor.shutdown(wait=True, cancel_futures=False)` — job ที่กำลังรันอาจกำลังใช้ pipeline ที่โดนรื้อ; วันนี้ยังไม่มี `unload()` จริงใน cleaner แต่ implementation แรก (เช่น ปล่อย ORT session) จะดึง state ออกใต้ job ที่ยังวิ่ง
- **ทางแก้:** `executor.shutdown(..., cancel_futures=True)` ก่อน แล้วค่อย unload

## C7. 🟡 P2 — `_jobs` ไม่เคย shed FAILED entries; source bytes กองระหว่าง queued 🔍

- **ตำแหน่ง:** `ocr-service/app/jobs.py:319-329, 159-179`
- **อาการ:** sweep เอาเฉพาะ `SUCCEEDED`; `_fail()` evict bytes แต่ทิ้ง `JobState` ตลอดกาล; `submit()` เก็บ upload เต็ม (สูงสุด 80 MB ต่อ `max_upload_mb`) โดยไม่มี queue-depth limit — worker ช่วง busy, N upload เร็วๆ = N×80 MB ค้าง RAM
- **ทางแก้:** pop FAILED ใน sweep (หลัง grace period) + cap accepted-queue bytes (503 เมื่อเกิน)

## C8. 🟡 P2 — Blocking disk I/O บน event loop ใน async `retry_region` 🔍

- **ตำแหน่ง:** `ocr-service/app/api.py:215-249` + `ocr-service/app/jobs.py:189-191`
- **อาการ:** `_job_or_404` → `_restore_job_from_disk` อ่าน/parse/validate result เต็มๆ แบบ sync บน event loop (ที่ `create_job` ใช้ `asyncio.to_thread` อย่างถูกต้อง — inconsistent); และ `store.submit_retry` raise `KeyError(parent_id)` ที่ทะลุเป็น 500 แทน 404 ถ้า parent โดน sweep ระหว่าง check กับ submit
- **ทางแก้:** wrap `submit_retry` ด้วย `asyncio.to_thread` + แปล KeyError/RuntimeError เป็น 404/409

## C9. 🟡 P2 — Windows: `rmtree(ignore_errors=True)` ลบครึ่ง dir ขณะ asset กำลังถูก serve 🔍

- **ตำแหน่ง:** `ocr-service/app/jobs.py:314, 360` + `ocr-service/app/api.py:188-209`
- **อาการ:** `get_asset` ปล่อย `job.lock` ก่อนคืน `FileResponse` (เปิดไฟล์ lazy ตอน stream); sweep/purge รัน `rmtree(ignore_errors=True)` ขนาน — บน Windows ไฟล์ที่เปิด handle อยู่ถูก lock แต่ไฟล์**อื่นใน dir ถูกลบหมด** → half-deleted dir, `get_asset` ตามมา 404 และ `FileResponse` 500 กลาง stream; ลบไม่สำเร็จยังถูกนับเป็นลบสำเร็จ
- **ทางแก้:** mark "being served" หรือ defer ลบ dir ที่แก้ไฟล์ล่าสุดใน N วิ + นับ rmtree ที่ fail เป็น not-removed

## C10. 🟡 P2 — `_refine_seed_mask` allocate array เต็มหน้าต่อ connected component 🔍

- **ตำแหน่ง:** `ocr-service/app/mask_refiner.py:190-202`
- **อาการ:** ต่อ component: `np.where(labels == id, 255, 0).astype(np.uint8)` + constrained_dilate — หน้า glyph หนาแน่นร้อย components ที่เพดาน 64 MP ทำ memory spike ร้อย MB–GB transient ใน worker (แข่งกับ LAMA ที่ต้องใช้ RAM ตอนเดียวกัน)
- **ทางแก้:** crop ต่อ component ตาม bounding box จาก `stats` แล้ว paste กลับ

## C11. 🟡 P2 — Flood-fill trick ของ `complete_glyph_mask` พังเมื่อ candidate แตะมุมบนซ้ายของ crop 🔍

- **ตำแหน่ง:** `ocr-service/app/mask_refiner.py:143-148`
- **อาการ:** ถ้า `closed[0, 0] == 255`, `floodFill` ที่ seed `(0,0)` ไปเติม foreground เอง → `255 - flood` ไม่ใช่ holes อีกต่อไป — hole filling ถูกข้ามเงียบๆ สำหรับ component นั้น
- **ทางแก้:** flood จาก background pixel ที่การันตี หรือ pad 1 พิกเซลก่อน flood

## C12. 🟡 P2 — `GradientCleaner` รัน `cv2.inpaint` เต็มหน้า 6 รอบต่อ region 🔍

- **ตำแหน่ง:** `ocr-service/app/cleaners/flat.py:60-74`
- **อาการ:** `candidates = [cv2.inpaint(image_rgb, binary, radius, method) for radius in (2,3,5) for method in (TELEA, NS)]` ทำงานกับภาพ**ทั้งหน้า**ไม่ใช่ region crop → หน้า 30 regions = 180 full-page inpaint (O(H×W) ต่อรอบ) — และนี่คือ fallback เมื่อ Big-LaMa ใช้ไม่ได้ (`api.py:346-351`) คือตอนที่ performance สำคัญที่สุด
- **ทางแก้:** crop ตาม region bounds + context (แบบที่ `AotCleaner`/`LamaLargeCleaner` ทำผ่าน `_context_bounds`)

## C13. 🟡 P2 — Screentone noise ไม่ reproducible จาก salted `hash()` 🔍

- **ตำแหน่ง:** `ocr-service/app/cleaners/flat.py:39`
- **อาการ:** `np.random.default_rng(hash(region.id) & 0xFFFFFFFF)` — string hashing มี salt ต่อ process (`PYTHONHASHSEED`) → หน้าเดียวกันคนละ session ได้ pixel ต่างกัน ทำลายการเทียบ cross-run หรือ content-cache
- **ทางแก้:** stable digest เช่น `int.from_bytes(hashlib.sha256(region.id.encode()).digest()[:4], "little")`

## C14. 🟡 P2 — PaddleOCR constructor fail รุ่นใหม่ไม่โดน catch 🔍

- **ตำแหน่ง:** `ocr-service/app/detector.py:469-475`
- **อาการ:** catch เฉพาะ `(ImportError, RuntimeError, OSError)` — PaddleOCR 3.x ลบ `use_gpu`/`use_angle_cls`/`show_log` และ raise `TypeError` (ไม่อยู่ใน tuple) → `HybridTextDetector.from_model_store` raise → pipeline factory fail → **ทุก job คืน "Image cleaning failed"** จนกว่าจะ downgrade paddleocr (ซึ่งเป็น optional install ไม่ pin ใน requirements)
- **ทางแก้:** catch `Exception` (fail = ไม่มี Paddle support) + log warning

## C15. ⚪ P3 — `.part` ค้างเมื่อ download error 🔍

- **ตำแหน่ง:** `ocr-service/app/model_store.py:65-76` — unlink เฉพาะ `ChecksumMismatch`; urlopen timeout (60 วิ/socket, ไม่มี total cap) ทิ้ง `.part` ค้าง (วันนี้ harmless เพราะเปิด `"wb"` ใหม่ แต่จับคู่กับ race ใน C5 แล้วแย่)

## C16. ⚪ P3 — Retry jobs hash source คนละ representation 🔍

- **ตำแหน่ง:** `ocr-service/app/jobs.py:614-619` — original hash จาก file bytes, retry/restored hash จาก `output.source_image.tobytes()` → `source_hash` เทียบข้ามชนิด job ไม่ได้
- **ทางแก้:** persist `source_hash` ของ parent ลง derived job

## C17. ⚪ P3 — `job_id` ไม่ถูก validate ก่อนใช้กับ filesystem 🔍

- **ตำแหน่ง:** `ocr-service/app/jobs.py:227-231, 343-352` — join raw path segment ลง `cache_dir`; test `test_get_rejects_path_traversal` ผ่านแบบ**บังเอิญ** (ไม่มี `result.json` นอก dir) ไม่ใช่เพราะมี guard; `delete_job` rmtree fallback unreachable เพราะ `_job_or_404` รันก่อน
- **ทางแก้:** assert `job_id` ตรง `^[0-9a-f]{32}$` ก่อนใช้ path ทุกจุด

## C18. ⚪ P3 — Dead parameters/variables 🔍

- **ตำแหน่ง:** `detector.py:771-795` (`_merge_adjacent_blocks(..., protected_edges)` ไม่เคยถูกเรียกด้วยค่า non-None); `verifier.py:57-65` (`crop`/`crop_mask` คำนวณแล้วไม่ใช้บน `score_envelope` path ที่ production ใช้เสมอ)

---

# ส่วน D — Electron shell + launch scripts (⏸️ PAUSED / DESKTOP BACKLOG)

> ⏸️ **สถานะทางวิศวกรรม: PAUSED ตามคำสั่งผู้ใช้**
> ปัจจุบันโปรเจกต์ได้ปรับมาใช้ `SuperK-Launcher.vbs` รันเข้าเว็บแท้ๆ บน Default Browser (Brave / Chrome) แทนการรัน Electron Shell และผู้ใช้สั่งระงับ (PAUSED) การพัฒนา Desktop Packaging/Installer ไว้ชั่วคราว
> ดังนั้น ข้อ **D1 ถึง D15** ทั้งหมดจึงถูกจัดเข้าสู่ **Paused Desktop Backlog** โดยไม่นำมาอยู่ในคิวการแก้ไขสำหรับ Web App หลัก เพื่อไม่ให้เสียเวลาแก้โค้ดที่ไม่ได้เปิดใช้งานจริง

## D1. 🔴 P1 (PAUSED) — Ownership reclaim ตรวจสอบ process เก่าไม่ได้เลยบน Windows จริง — orphaned children ไม่เคยถูก reclaim ✅ ยืนยันแล้ว

- **ตำแหน่ง:** `electron/processOwnership.js:196` (query ที่ 158-169)
- **อาการ:** PowerShell `Win32_Process.CreationDate` คืน DMTF/CIM format (เช่น `20260926103045.123456+420`) ไม่ใช่ ISO-8601 → `Date.parse` ได้ `NaN` → `verifyOwnership` bail ที่ timestamp check เสมอ → `reclaimStaleOwnedProcesses` จัดทุก child เก่าเป็น `unverified` แล้ว drop record **โดยไม่ terminate** — หลัง crash/force-kill, uvicorn/Next ตัวเก่าวิ่งค้างไม่มีเจ้าของ (และ autoSelectPorts ทำให้ instance ใหม่เงียบๆ ย้ายไป 3001/8766 โดย RAM รั่วต่อไป); unit tests หลอนเพราะ feed ISO string (`tests/desktop/processOwnership.test.ts:65`)
- **ทางแก้:** convert CIM datetime ฝั่ง PowerShell (`[System.Management.ManagementDateTimeConverter]::ToDateTime(...)` หรือ `$p.ConvertToDateTime($p.CreationDate)`) หรือ parse DMTF เอง

## D2. 🔴 P1 (PAUSED) — Export IPC ให้ compromised renderer เขียน/เปิด path ใดก็ได้ — ไม่มี anchor ที่ destination ที่ main เลือก ✅ ยืนยันแล้ว

- **ตำแหน่ง:** `electron/exportHandler.js:42-60, 90-95` (register ที่ `electron/main.js:606-607`, expose ที่ `electron/preload.js:19-24`)
- **อาการ:** `pickExportDirectory` เลือก path ใน main แต่ส่งกลับให้ renderer เก็บ (localStorage, `lib/export/saveLocation.ts:22`) แล้ว handler ใน main**เชื่อ** path ที่ renderer ส่งมาทุกครั้ง — `saveExportFile` ทำ `mkdir` recursive + `writeFile` ที่ `dirPath` ที่ renderer คุมเต็มที่ และ `resolveUniqueDesktopFilename` ปล่อย filename ผ่านไม่ sanitize → filename ที่มี `..\` หนี directory ได้ (renderer ของแอป render ข้อความ OCR จากภาพผู้ใช้ = surface ที่โดน compromise ได้); `desktop:open-export-directory` → `shell.openPath()` บน `.exe` ใดๆ = arbitrary code execution
- **ทางแก้:** ให้ main process เป็นเจ้าของปลายทางที่ผ่าน native picker และข้อมูลจำปลายทางข้ามการเปิดแอป; renderer ส่งเพียงตัวอ้างอิงที่ main ออกให้ แทนการส่ง `dirPath` จาก `localStorage` ไปกำหนด write/open เอง ตรวจ resolved target ให้อยู่ในโฟลเดอร์ที่ main ยืนยันแล้วและ normalize/reject ชื่อไฟล์ที่มี path separator; `desktop:open-export-directory` ต้องเปิดได้เฉพาะโฟลเดอร์ที่ยืนยันไว้ หากปลายทางเดิมหายหรือใช้ไม่ได้ให้เลือกใหม่ก่อนบันทึก ตรวจรับทั้ง restart, path traversal และ path ที่ renderer ปลอม

## D3. 🔴 P1 (PAUSED) — Shutdown route kill process ตาม port ข้ามหลัง Electron; "shutdown" ทิ้ง shell ค้างบน server ตาย 🔍

- **ตำแหน่ง:** `src/app/api/system/shutdown/route.ts:56-71` + `stop.bat`; caller ที่ `components/workspace/SettingsModal.tsx:291`
- **อาการ:** route ยิง `stop.bat` ซึ่ง force-kill ทุกอย่างที่ listen 3000/8765 (`Get-NetTCPConnection ... Stop-Process -Force`) — ไม่มีการประสานกับ `electron/main.js` เลย: ใน desktop mode มัน kill workspace server + sidecar จากใต้ supervisor (`isReady===true, isStopping===false` → ทั้งคู่ emit `unexpected-exit` ที่ main.js:217-229) ผู้ใช้เห็น "service crashed" หลังขอ shutdown เอง แล้ว Electron + window ยังเปิดค้าง; ใน packaged mode `process.cwd()` คือ `resources/app` ที่ไม่มี `stop.bat` → เหลือแค่ `process.exit(0)` ของ server (ผลเดียวกัน); ใน web mode port-kill อาจฆ่าโปรแกรมอื่นที่จับ port นั้น
- **ทางแก้:** desktop mode ควรขอ main process quit (IPC ไป `handleShutdown()` หรือให้ main เป็นเจ้าของ endpoint); `stop.bat` ควร target recorded PIDs ไม่ใช่ port owners

## D4. 🟡 P2 — Stale `exit` handler ล้างอ้างอิง child ตัวใหม่ → orphan ที่ `stop()` ฆ่าไม่ได้ 🔍

- **ตำแหน่ง:** `electron/sidecar.js:134-142` + `electron/workspaceServer.js:231-242`
- **อาการ:** handler ทำ `this.process = null` + `clear()` โดยไม่เช็คว่า child ที่จบคือตัวปัจจุบัน; ใน `recover()` (`sidecar.js:169-178`) `stop()` เสร็จก่อน `start()` spawn ใหม่ — event `exit` ของตัวเก่ามาหลัง spawn ใหม่ได้ (taskkill กับ exit event ไม่มี ordering การันตี) → ล้างอ้างอิง + ownership record ของ child ใหม่ที่แข็งแรง → `stop()` no-op และ uvicorn รอดจาก app quit
- **ทางแก้:** capture child ใน closure (`if (this.process === child) this.process = null`) + บันทึก pid กับ entry เพื่อให้ `clear` เป็น generation-aware

## D5. 🟡 P2 — `cleaner:recover` IPC ไม่ serialized — invoke ซ้อนกัน double-spawn และ "verify" ผิด process 🔍

- **ตำแหน่ง:** `electron/main.js:604` + `electron/sidecar.js:159-193`
- **อาการ:** ไม่มี single-flight guard — recover สองอันซ้อนเห็น `checkHealth()===false` พร้อมกัน ทำ stop/start คู่, ตัวแพ้ bind 8765 ไม่สำเร็จแต่ `pollHealth` ยังคืน true (probe เป็น port-based ไม่ใช่ process-based) — ตัวแพ้ถูก mark "recovered" ขณะ `clear()` ล้าง ownership ของตัวชนะ
- **ทางแก้:** memoize in-flight recover promise

## D6. 🟡 P2 — Main window ไม่มี `setWindowOpenHandler`/`will-navigate` guard 🔍

- **ตำแหน่ง:** `electron/main.js:43-93`
- **อาการ:** `window.open` จาก renderer สร้าง child Electron window ที่ inherit preload เดียวกัน; `will-navigate` ไม่ถูก block → link ใน content นำทาง desktop shell ไปเว็บภายนอกได้
- **ทางแก้:** `setWindowOpenHandler(() => ({ action: "deny" }))` (หรือ route ไป `shell.openExternal`) + block cross-origin `will-navigate`

## D7. 🟡 P2 — `desktop:service-crashed` ส่งไป renderer ที่รับไม่ได้ 🔍

- **ตำแหน่ง:** `electron/main.js:210` เทียบ `electron/preload.js` (ทั้งไฟล์)
- **อาการ:** preload ไม่ expose listener ช่องนี้เลย (grep ทั้ง repo พบแค่จุด send) → sidecar/workspace crash มองไม่เห็นจาก UI
- **ทางแก้:** expose `onServiceCrashed` แล้ว render toast/ทาง recovery

## D8. 🟡 P2 — Health check ของ workspace รับ 3xx/4xx ใดๆ เป็น "healthy" 🔍

- **ตำแหน่ง:** `electron/workspaceServer.js:260`
- **อาการ:** `if (res && (res.ok || (res.status >= 300 && res.status < 500)))` — server แปลกปลอมที่แย่ง port ช่วง TOCTOU ของ `portGuard.js:33-55` ตอบ 404 ก็ผ่าน gate และ Electron โหลด app คนอื่น
- **ทางแก้:** probe known SuperK endpoint แล้ว require 200 (sidecar supervisor ทำแบบนี้ถูกต้องแล้วด้วย `/health`)

## D9. 🟡 P2 — Cache fallback ชี้ไป install directory ที่เขียนไม่ได้ 🔍

- **ตำแหน่ง:** `electron/cacheRouting.js:30-44`
- **อาการ:** เมื่อไดรฟ์ `F:\` หายใน packaged install, `cacheRoot = appRoot/cache` ที่ `process.resourcesPath` (เช่น `C:\Program Files\SuperK\resources`) — `mkdirSync` fail ถูกกลืน → `TORCH_HOME`/`HF_HOME` ชี้ที่เขียนไม่ได้เงียบๆ แล้ว model download fail ตอน runtime
- **ทางแก้:** default cache root เป็น `app.getPath("userData")` เมื่อ packaged

## D10. 🟡 P2 — Window bounds ไม่ flush ตอน quit; tray health URL hardcode 8765 🔍

- **ตำแหน่ง:** `electron/windowState.js:76-78, 124`
- **อาการ:** `saveState` debounce 500 ms — quit ในหน้าต่างเวลานั้นเสีย bounds สุดท้าย (`close` handler ที่ main.js:356-412 ไม่ flush); tray "Service Health" เปิด `http://127.0.0.1:8765/health` เสมอ ผิดเมื่อ packaged auto-port เลือก port อื่น (`main.js:272-285`)
- **ทางแก้:** flush sync ตอน `close`/`before-quit` + ส่ง live sidecar URL เข้า `createTrayManager`

## D11. ⚪ P3 — `SIDECAR_HEALTH_URL` เป็น dead/misleading export 🔍

- **ตำแหน่ง:** `electron/sidecar.js:26` — constant จาก default port; runtime ใช้ `getHealthUrl()` dynamic; มีแต่ test อ้าง

## D12. ⚪ P3 — `.env` merge ทับ `process.env` (precedence กลับด้าน) 🔍

- **ตำแหน่ง:** `electron/workspaceServer.js:185-193` — กระทบจำกัดเพราะ explicit keys ชนะอยู่แล้ว แต่ inherited vars (เช่น API keys) โดนทับได้

## D13. ⚪ P3 — `start-web.bat` รอแค่ ~4 วิก่อนเปิด browser 🔍

- **อาการ:** cold `npm run dev` = ผู้ใช้เจอ connection error page; `SuperK-Launcher.vbs` ทำถูกต้องกว่า (poll สูงสุด 35 วิ) แต่ services ที่ spawn ผ่าน WMI ไม่ถูก track — เคลียร์ได้ทาง stop.bat port-kill เท่านั้น

## D14. ⚪ P3 — macOS `window-all-closed` dead-end 🔍

- **ตำแหน่ง:** `electron/main.js:689-694, 627-638` — `activate` หลัง shutdown จะไม่ recreate window (irrelevant กับ Windows-only build แต่แฝงไว้)

## D15. ⚪ P3 — Sidecar health timeout 30 วิ อาจแน่นสำหรับ cold GPU/model first launch 🔍

- **ตำแหน่ง:** `electron/sidecar.js:23` — splash retry path เก็บตกได้ แต่ควร bump สำหรับ first run

---

# ส่วน E — Chrome extension + Extension routes + Workspace UI

## E1. 🔴 P1 — Translation overlay ทำลายตัวเองหลัง 2 นาทีขณะผู้ใช้อ่านอยู่ ✅ ยืนยันแล้ว

- **ตำแหน่ง:** `chrome-extension/content.js:553-556`
- **อาการ:**

  ```js
  // Clean up after 2 minutes to prevent memory leaks
  setTimeout(() => { cleanup(); }, 120000);
  ```

  `cleanup()` ลบ overlay container, disconnect observer, ลบ `activeOverlays` entry แบบไม่มีเงื่อนไข — ผู้อ่านที่ใช้เวลา >2 นาที/หน้า เสียคำแปลกลางอ่าน และ `restoreSavedTranslations` รันเฉพาะตอน document load จึงไม่มีอะไร re-render
- **ทางแก้:** ขับเคลื่อน cleanup จาก page lifecycle/SPA navigation watcher แทน fixed timer

## E2. 🔴 P1 — MutationObserver เต็ม document พร้อม callback ที่ force layout 🔍

- **ตำแหน่ง:** `chrome-extension/content.js:530-531`
- **อาการ:** `observer.observe(document.body, { childList: true, subtree: true, attributes: true })` — ทุก mutation ของ host page (SPA mutate ตลอด) เรียก `updatePosition` ซึ่งอ่าน `getBoundingClientRect()` (forced layout) แล้วเขียน style ที่ `overlayContainer` ซึ่งอยู่**ใน** subtree ที่ observe (self-triggering pattern) → layout thrash ต่อ mutation บนเว็บอ่าน manga ที่มีภาพหนาแน่น
- **ทางแก้:** observe เฉพาะ `img`/ancestor ด้วย `attributeFilter`, หรือใช้ `ResizeObserver`/rAF loop

## E3. 🔴 P1 — Loading-scrim `resize` listener รั่ว 🔍

- **ตำแหน่ง:** `chrome-extension/content.js:101-114` (removal path ที่ 51, 129-131, 139-140)
- **อาการ:** `removeExistingLoadingScrim()` ลบ DOM node แต่ไม่มีทาง remove listener — แต่ละครั้งที่แปลรั่ว closure ครอบ `img` ไปจนกว่า resize ถัดไปจะเผลอยิง handler
- **ทางแก้:** ให้ `createLoadingScrim` คืน disposer แล้วเรียกใน `removeExistingLoadingScrim`

## E4. 🟡 P2 — Drag handlers ทับ host-page/sibling handlers 🔍

- **ตำแหน่ง:** `chrome-extension/content.js:657-683`
- **อาการ:** `document.onmouseup = ...` / `document.onmousemove = ...` เป็น property assignment — ทับ handler ของ host site, ถูกทับโดย bubble อื่น (drag ได้ตัวสุดท้าย), และค้างตลอดกาลถ้า overlay โดนลบกลาง drag
- **ทางแก้:** `addEventListener`/`removeEventListener` พร้อม teardown ใน `cleanup()`

## E5. 🟡 P2 — สตริงจาก server/AI ถูก interpolate เข้า CSS และ `img.src` โดยไม่ validate 🔍

- **ตำแหน่ง:** `chrome-extension/content.js:413-414, 422, 168, 201-203`
- **อาการ:** `color: ${bubbleTextColor};` / `font-family: ${fontFamily};` / `text-shadow: ${textShadowValue};` มาจาก translation-server JSON + `/api/extension/settings`; `cleanImageBase64` รับค่าที่ขึ้นต้น `http` ได้เลย — แหล่งแปลที่ถูก MITM/compromise ฉีด CSS อะไรก็ได้ลง host pages (`position:fixed; background:url(//track...)`) หรือชี้ clean-image ไป remote
- **ทางแก้:** validate สีด้วย `/^#[0-9a-f]{3,8}$/i` + whitelist font family ก่อน interpolate

## E6. 🟡 P2 — `contentEditable = "true"` บน bubble ทุกใบ 🔍

- **ตำแหน่ง:** `chrome-extension/content.js:429`
- **อาการ:** overlay ทุกใบ focusable/editable แย่ง typing/keyboard UX ของ host site ทันที และจับคู่กับ E1 (2 นาทีหาย) = editing session ไม่สม่ำเสมอ
- **ทางแก้:** เปิด editable เมื่อ opt-in (เช่น double-click toggle)

## E7. 🟡 P2 — เก็บ base64 เต็มของ clean image ลง `chrome.storage.local` 🔍

- **ตำแหน่ง:** `chrome-extension/content.js:497-509`
- **อาการ:** manifest ไม่มี `unlimitedStorage`; MV3 quota = 10 MB — หน้า inpainted 1 หน้า (base64) บ่อยครั้งเกิน → write fail เงียบๆ (`.catch(() => {})`) และ keys ไม่มี pruning (ลบได้เฉพาะปุ่ม manual ที่ 488-494)
- **ทางแก้:** เช็ค `chrome.runtime.lastError`, downscale ก่อนเก็บ, prune ตาม timestamp

## E8. 🟡 P2 — Fuzzy image matching ผูก overlay ผิด `<img>` ได้ 🔍

- **ตำแหน่ง:** `chrome-extension/content.js:40-46`
- **อาการ:** `img.src.includes(urlFilename)` โดย guard แค่ "ความยาว filename > 5" — เว็บที่ใช้ชื่อ generic (`page.jpg`, `0001.png`) overlay ลงรูปอื่นได้
- **ทางแก้:** require full-path หรือ dimension match เป็น fallback

## E9. 🟡 P2 — MV3 service worker ใช้ `setInterval` polling ซึ่งไม่ reliable 🔍

- **ตำแหน่ง:** `chrome-extension/background.js:460-462` (poll ที่ 354-458)
- **อาการ:** SW ถูก suspend หลัง idle ~30 วิ → module timers ตาย → publish-back sync (poll `/api/extension/publish-back` ทุก 3 วิ) หยุดเงียบๆ เมื่อ Chrome suspend; เมื่อ alive ก็ wake network ทุก 3 วิ
- **ทางแก้:** `chrome.alarms` (ขั้นต่ำ 30 วิ) หรือ long-lived connection ไป local server

## E10. 🟡 P2 — `runtime.onMessage` ไม่ validate sender 🔍

- **ตำแหน่ง:** `chrome-extension/background.js:135-156`
- **อาการ:** `RETRY_TRANSLATE` เชื่อ `message.imageUrl` และ `OPEN_EDITOR` POST `message.payload` ตรงเข้า `/api/extension/workspace/append` โดยไม่เช็ค `sender.id`/`sender.tab` — วันนี้ content script ของ extension เองเท่านั้นที่ส่งได้ (hardening) แต่ handler นี้คือ privileged bridge (fetch + เปิด tab)
- **ทางแก้:** verify `sender.id === chrome.runtime.id`

## E11. 🟡 P2 — Gemini API key + pairing token เก็บใน `chrome.storage.sync` 🔍

- **ตำแหน่ง:** `chrome-extension/popup.js:119-134` + `background.js:29-33`
- **อาการ:** `storage.sync` อัปโหลด secrets ขึ้นบัญชี Google ของผู้ใช้เป็น plaintext และ spread ไปทุกอุปกรณ์ที่ sync — ไม่มีส่วนไหนของ flow ต้องการ cross-device sync
- **ทางแก้:** ใช้ `storage.local`

## ER1. 🔴 P1 — `publish-back` และ `workspace/append` ไม่มี pairing token + state ใน memory ไม่จำกัด 🔍

- **ตำแหน่ง:** `src/app/api/extension/publish-back/route.ts:33-48, 73-107` + `workspace/append/route.ts:22-37, 62-104` (เทียบ `settings/route.ts:121-127` ที่ enforce `verifyPairingToken` ถูกต้อง)
- **อาการ:** publish-back GET คืนทุก published translation (bubbles + clean image data-URL เต็ม) ให้ caller ใดก็ได้ที่ Origin เป็น loopback **หรือไม่มี Origin** (`if (!origin) return true;`); POST ให้ localhost page ใดก็ได้ poison overlays; `publishedMap` และ `handoffs` โตตลอด (ซ้ำกับ A12)
- **ทางแก้:** เพิ่ม `verifyPairingToken` ที่ GET/POST ของทั้งสอง route พร้อมปรับผู้เรียกทั้ง 4 ทางในคราวเดียว: extension POST `/workspace/append` และ GET `/publish-back` ใช้ token ที่เก็บจากการจับคู่; หน้าแอป GET `/workspace/append?id=...` และ POST `/publish-back` รับ token ผ่าน `/pair` หลังปิด A3 แล้วส่งใน header ที่ route รองรับ (รวม CORS preflight หากจำเป็น) ตรวจรับ token ที่ถูก/ผิด/ไม่มีสำหรับแต่ละทาง และ flow เปิด editor กับส่งผลกลับจริง ส่วนการ prune ให้แยก handoff TTL ออกจาก published snapshot; ก่อนลบ snapshot ต้องมีทาง resync เมื่อ extension ออฟไลน์เกินช่วงเก็บ มิฉะนั้นอย่าใช้ TTL ~24 ชม. กับ `publishedMap` (รวมกับ A12)

## ER2. 🟡 P2 — Pairing token รับจาก URL query string 🔍

- **ตำแหน่ง:** `src/app/api/extension/settings/route.ts:109-111`
- **อาการ:** token ใน URL รั่วเข้า server/proxy logs และ history; extension ส่ง header (`Authorization`/`x-superk-pairing-token` ที่ `chrome-extension/server.js:94-97`) อยู่แล้ว → query-param path เป็น dead weight
- **ทางแก้:** ลบ

## ER3. 🟡 P2 — Request ที่ไม่มี Origin ได้ token เมื่อ Host เป็น loopback 🔍

- **ตำแหน่ง:** `src/app/api/extension/pair/route.ts:18-31`
- **อาการ:** local non-browser process (หรือ tool ที่ strip Origin) mint/อ่าน pairing token ได้โดยไม่มี interaction — ยอมรับได้สำหรับ local app เครื่องเดียว แต่ควร require Origin ของ app เองหรือ `chrome-extension://` เพื่อ parity กับ pairing design ที่เหลือ (หมายเหตุ: `verifyPairingToken` เอง timing-safe ถูกต้องที่ `lib/server/pairing.ts:15-25`)

## U1. 🔴 P1 — Global shortcuts ไม่สน modal/ปุ่ม — เปลี่ยนหน้า**ใต้** MaskEditor 🔍

- **ตำแหน่ง:** `src/app/page.tsx:767-831` (เทียบ focus-mode handler ที่ 170-180 ที่ทำถูก)
- **อาการ:** guard เช็คแค่ tag INPUT/TEXTAREA/SELECT ไม่เหมือน focus-mode handler ที่ skip `isContentEditable` + `closest('[role="dialog"]')` — ขณะ MaskEditor modal เปิด, ArrowLeft/ArrowRight เปลี่ยน `currentPage` ใต้ modal, T restart translation, Ctrl+F เปิด Find&Replace; เมื่อหน้าเปลี่ยน `MaskEditor` รับ `regions` ใหม่ (page.tsx:2575-2586) ขณะ `regionId` ยังชี้ region เก่า → `selectedRegion` เป็น undefined (`MaskEditor.tsx:166-167`), `submit()` encode mask กับ zero rect fallback (`MaskEditor.tsx:510`) และเรียก `onRetry` ด้วย stale region id — **editor state machine desync จาก data model**
- **ทางแก้:** ใส่ guard dialog/contentEditable แบบเดียวกับ line 177

## U2. 🔴 P1 — Space ชิง button activation ทั้งแอป 🔍

- **ตำแหน่ง:** `src/app/page.tsx:822-826`
- **อาการ:** `if (e.key === ' ') { e.preventDefault(); toggleOriginalTranslated(); }` — ตอนปุ่มใดโฟกัสอยู่ (guard ไม่ครอบ BUTTON) Space กดปุ่มไม่ได้ กลายเป็น toggle ภาพแทน
- **ทางแก้:** skip เมื่อ `target.closest('button, a, [role="button"]')` และเมื่อ dialog เปิด

## U3. 🔴 P1 — Space ใน MaskEditor ป้าย mask แทนการ pan 🔍

- **ตำแหน่ง:** `components/cleaning/MaskEditor.tsx:454-458` เทียบ `404-406` และ tip บนจอที่ 882
- **อาการ:** canvas keydown จับ Space = `commitBrushAt` + `stopPropagation` → dialog-level handler ไม่เคยได้ตั้ง `isSpacePressedRef` → pan ที่ tip โฆษณา ("Spacebar + ลาก") **ใช้ไม่ได้**ขณะ canvas โฟกัส (ซึ่งเป็นหลังคลิกทุกครั้ง) และ keydown auto-repeat ป้าย brush ซ้ำๆ = **pixel ที่ไม่ได้ตั้งใจถูกใส่ใน removal authorization** — ขัดตรงกับหลัก mask-authorization gate ที่ CONTEXT.md ให้ความสำคัญสูงสุด
- **ทางแก้:** Space ที่ canvas ต้องแค่ตั้ง pan flag; ย้าย keyboard stamping ไปปุ่มอื่นหรือต้อง explicit paint-mode

## U4. 🔴 P1 — Undo stack เก็บ ImageData เต็มหน้า 2 ชุดต่อ stroke → RAM ระดับ GB 🔍

- **ตำแหน่ง:** `components/cleaning/MaskEditor.tsx:248-267, 309-325, 328-376`
- **อาการ:** ทุก stroke push `{before, after}` clone ลง global `undoManager` (เก็บ 50 entries ที่ `lib/undoManager.ts`) — ที่ ~24 MB/หน้า (2000×3000×4) stack เต็ม = ~2.4 GB; `commitBrushAt` (Space/keyboard) push ต่อ**หนึ่ง stamp**
- **ทางแก้:** เก็บ stroke operations (points + mode + radius) แทน pixel snapshot หรือใช้ bounded stack เฉพาะของ mask editor

## U5. 🟡 P2 — `preventDefault()` ใน React `onWheel` เป็น no-op 🔍

- **ตำแหน่ง:** `components/cleaning/MaskEditor.tsx:386-390` + `components/workspace/PageViewer.tsx:321` + `hooks/usePageZoom.ts` `handleWheel`
- **อาการ:** React 17+ attach root wheel listeners แบบ passive — บน React 19.2.4 `preventDefault` throw warning และ browser zoom ทำงานต่อ (Ctrl+wheel ของ PageViewer โดน browser zoom แทน stage zoom)
- **ทางแก้:** attach native non-passive wheel listener ผ่าน ref + useEffect

## U6. 🟡 P2 — Focus trap ทาง Tab ใน SettingsModal ตันปลาย 🔍

- **ตำแหน่ง:** `components/workspace/SettingsModal.tsx:449-457`
- **อาการ:** ถึง element สุดท้ายแล้ว `last.focus()` (ควรเป็น `first.focus()`) — วนกลับไปต้นไม่ได้เลย; `MaskEditor.tsx:421-423` ทำถูกแล้ว
- **ทางแก้:** `first.focus()`

## U7. 🟡 P2 — Effect ใน SettingsModal ยิงซ้ำทุก keystroke 🔍

- **ตำแหน่ง:** `components/workspace/SettingsModal.tsx:207-234`
- **อาการ:** effect mount พึ่ง `loadGeminiCatalog` ซึ่งพึ่ง `userApiKey` → พิมพ์ key ทีละตัว = re-`fetch('/api/extension/pair')` ทุกตัวอักษร + catalog timer ถูก reset — coupling ของสองเรื่องที่ไม่เกี่ยวกัน
- **ทางแก้:** แยก token/catalog loading เป็น effect ของตัวเอง keyed ตาม `isOpen`

## U8. 🟡 P2 — `onRemovePage` ของ PageViewer ไม่ shift `currentPage` 🔍

- **ตำแหน่ง:** `src/app/page.tsx:2417-2429` (filmstrip version ที่ 2550-2562 ทำถูก)
- **อาการ:** ลบ index ก่อนหน้าปัจจุบันไม่ shift — ตอนนี้ reachable แค่ผ่านปุ่ม delete broken-page จึง impact ต่ำ
- **ทางแก้:** ใช้ logic เดียวกับ filmstrip

## U9. ⚪ หมายเหตุ — Studio stack เป็น tested-but-unmounted code 🔍

- **ตำแหน่ง:** `components/editing/TextLayerCanvas.tsx`, `StudioToolbar.tsx`, `OcrAreaTool.tsx`, `WarpPanel.tsx`
- **สถานะ:** ถูกอ้างเฉพาะโดย test ของตัวเอง (`tests/editing/*.test.tsx`) — **ข้อนี้ de-scoped ไว้แล้ว** ตาม `docs/system-review-plan.md` หมวดที่ตัดออก (เก็บไว้เป็นโค้ดสำรอง) จึงไม่นับเป็น finding และไม่เสนอลบ

---

# ข้อตกลงจากการทบทวนแผน (grill-with-docs)

- **ขอบเขตการทบทวน:** ตรวจ P1 ทั้ง 19 ข้อและ P2 ที่ใช้รากปัญหาร่วมกันก่อน; findings ที่เหลือยังอยู่ในรายงานเพื่อจัดคิวภายหลัง
- **หลักฐานก่อนใช้เป็นตัวกั้นงาน:** ข้อที่ยังเป็น 🔍 ต้อง reproduce หรือไล่เส้นทางโค้ดจนหักล้างสมมติฐานได้ก่อน หากยังยืนยันไม่ได้ให้พักไว้เพื่อพิสูจน์และปรับระดับตามหลักฐาน ไม่ถือว่า P1 ที่ยืนยันแล้ว
- **ขอบเขตความปลอดภัย:** ป้องกันเว็บภายนอกและ renderer ของแอปที่อาจถูกโจมตี; ถือว่าโปรแกรมอื่นที่ผู้ใช้ติดตั้งใน Windows ได้รับความไว้วางใจตามบริบท Local Single-User
- **การนำการแก้มาใช้:** นำแต่ละชุดที่ผ่านเกณฑ์ตรวจรับมาใช้ได้ทันที พร้อมแสดงรายการ P1 ที่ยืนยันแล้วและยังค้างให้เห็นชัด ไม่รอแก้ครบทุกข้อในคราวเดียว
- **ปลายทาง export บน desktop:** ให้ Electron main จำ path ที่ผู้ใช้เลือกและยืนยันซ้ำเมื่อเปิดแอป; ถ้าโฟลเดอร์หายหรือใช้ไม่ได้จึงถามใหม่ โดยรักษาพฤติกรรมเลือกครั้งเดียวของ ADR 0009 และปรับ ADR นั้นเมื่อสรุปสัญญา IPC/การย้ายค่าที่จำไว้แล้ว

# ลำดับลงมือและเกณฑ์ตรวจรับที่แนะนำ

**P1/P2/P3 บอกผลกระทบ; คิวบอกลำดับลงมือ; ขนาด diff ไม่ได้บอกความเสี่ยงหรือภาระตรวจรับ** ทุกข้อที่เป็น 🔍 ต้อง reproduce หรือหาหลักฐานหักล้างกับ HEAD ที่จะลงมือก่อนแก้ หากพิสูจน์ไม่ได้ให้พักเพื่อพิสูจน์และปรับระดับตามหลักฐาน งาน P1 ทั้ง 19 ข้ออยู่ในคิวทบทวนก่อนเริ่มกวาด P2; แต่ละชุดที่ผ่านเกณฑ์นำมาใช้ได้โดยติดตาม P1 ที่ยังค้าง การแยกคิว P1 ช่วยจัด dependency ไม่ใช่การลดระดับข้อท้ายคิว

| คิว | Findings | เหตุผลและ dependency |
|---|---|---|
| P1-ก: ขอบเขตความปลอดภัย (Web Core) | A3, A4, ER1 | ปิดทางอ่าน token, proxy ข้าม scope ป้องกันการโจมตีข้าม origin บนเครื่อง local; ทำ A3 ก่อน ER1 |
| P1-ข: ผลลัพธ์ผู้ใช้และ State (Web Core) | B1, B2, B3, C1, U1, U2, U3 | **หัวใจหลักของ Web App:** ป้องกันภาพ export ติดกล่องที่ลบ (B1), retry lama-large ไม่แครช (C1), shortcut ไม่เปลี่ยนหน้าใต้ MaskEditor (U1), Space ไม่แย่งปุ่ม (U2), Spacebar ใน MaskEditor เป็น Pan ไม่ป้ายสีเลอะ (U3), restore ขนาดภาพไม่เพี้ยน (B3) |
| P1-ค: ทรัพยากรและ Memory | U4, B10, C12, E1, E2, E3 | ลดการกิน RAM มหาศาล: แก้ MaskEditor undo stack สูบ RAM 2.4GB (U4), text fitting canvas churn (B10), Python full-page inpainting churn (C12), overlay extension lifecycle (E1, E2, E3) |
| ⏸️ Paused: Electron Desktop Backlog | D1, D2, D3, D4, D5, D6, D7, D8, D9, D10, D11, D12, D13, D14, D15 | **ระงับไว้ชั่วคราว:** ผู้ใช้ใช้ `SuperK-Launcher.vbs` รันเข้าเว็บแท้ๆ บน Brave/Chrome แทน Electron |
| 🧪 Deferred: Experimental Gemini Catalog | A1, A2, A9, A10 | **ระงับไว้ชั่วคราว:** Live Translation ถูกล็อคไว้ที่ Fixed Route (`requestGemini`) เป็น production baseline |
| P2/P3 หลัง P1 หลัก | A12+ER1 เป็นงาน state ชุดเดียว; A11/A3/ER3 ทบทวน origin policy ร่วมกัน; ที่เหลือจัดตามผู้ใช้พบจริง | เก็บ ID และระดับเดิมเพื่อไม่ให้จำนวน findings เปลี่ยน; แก้ร่วมกันได้เมื่อรากปัญหาเดียวกัน |

**แพตช์ที่แก้แคบและเห็นผลเร็ว (Web Quick Wins):** B1, C1, U1/U2/U3 มีจุดแก้แคบมากและกระทบ UX รายวันสูงสุด ทำเป็นชุดแรกได้ทันที

## เกณฑ์ตรวจรับ P1 (ระบุ test/การสาธิตอาการก่อนปิดแต่ละข้อ)

| ข้อ | ตรวจรับอย่างน้อย |
|---|---|
| A1 | validation คืน false และ budget check throw หลัง claim แล้ว recovery trial ถูกปล่อย; route กลับมาใช้ได้โดยไม่ restart |
| A2 | write state ล้มเหลวหลัง Gemini สำเร็จแล้วไม่เปลี่ยนผลแปลเป็น 500; concurrent load/persist ไม่ทำ pool หรือไฟล์ state หาย |
| A3 | DNS rebinding ที่ Host/Origin เป็นโดเมนโจมตีเดียวกันอ่าน token ไม่ได้; หน้าแอปบน loopback ยังแสดง token ได้และ extension ที่จับคู่ด้วยมือยังใช้ token ได้ |
| A4 | HTTP request ด้วย encoded `..` และ path นอก `/v1/` ไม่ถูกส่งไป sidecar; path ที่อนุญาตยังส่งต่อได้ |
| B1 | bubble ที่ซ่อนถูกตัดจาก export ทุก format ที่ใช้ compositor เดียวกัน |
| B2 | สลับหน้า/เริ่ม paint ซ้อนแล้วผลของหน้าเก่าไม่ทับหน้าใหม่ |
| B3 | restore เมื่อ metadata ขาด width/height ไม่แสดงหน้าผิดเป็น clean-only และแจ้งหรือกู้ตาม fallback ที่กำหนด |
| C1 | retry ด้วย `lama-large` ทำงานเมื่อ model พร้อม หรือคืน error validation/availability ที่ตรงเหตุ; ไม่รับแล้วทำ job fail เงียบ ๆ |
| D1 | ใช้ CreationDate แบบ DMTF จาก Windows ใน test แล้ว verify/reclaim เฉพาะ process ที่เป็นเจ้าของจริง; process อื่นไม่ถูก kill |
| D2 | renderer ปลอม path/filename/open target แล้วเขียนหรือเปิดนอกปลายทางที่เลือกไม่ได้; จำปลายทางข้าม restart และกรณีโฟลเดอร์หายได้อย่างชัดเจน |
| D3 | ปิดจาก desktop แล้ว shell กับ child จบตามลำดับ; web mode ไม่ kill เจ้าของ port ที่ไม่ใช่ของแอป |
| E1 | overlay ยังอยู่เมื่อผู้ใช้อ่านเกิน 2 นาที และล้างเมื่อถึง lifecycle ที่ตั้งใจจริง |
| E2 | mutation จำนวนมากไม่ทำ observer วนทั้ง document/บังคับ layout ซ้ำจน UI หน่วง; มีกรณีวัดก่อนและหลัง |
| E3 | เปิด/ปิด loading scrim ซ้ำแล้วจำนวน resize listener ไม่เพิ่มค้าง |
| ER1 | GET/POST ของทั้งสอง route ปฏิเสธ token ผิด/ไม่มีและรับ token ถูก; เปิด editor/ส่งผลกลับครบ 4 ผู้เรียก; offline เกินช่วงเก็บแล้วยัง resync ได้หรือยังคง snapshot |
| U1 | เปิด MaskEditor แล้ว Arrow/T/Ctrl+F ไม่เปลี่ยนหน้า/งานใต้ dialog; ปิด dialog แล้ว shortcut ปกติ |
| U2 | Space ที่ปุ่ม/ลิงก์ซึ่งโฟกัสอยู่ยัง activate องค์ประกอบนั้น ไม่ toggle ภาพ |
| U3 | Space+ลาก pan ได้เมื่อ canvas โฟกัสและไม่เพิ่ม pixel ใน mask; การ paint ที่ตั้งใจยังทำได้ |
| U4 | stroke/undo จำนวนมากอยู่ใน RAM bound ที่กำหนด และ undo/redo คืน mask ตรงตามเดิม |

หลังแต่ละชุดให้รัน test เฉพาะ path ที่แก้และ suite ที่เกี่ยวข้อง แล้วทดสอบ flow ผู้ใช้จริงของชุดนั้น; ค่า baseline 929 vitest / 186 pytest ด้านบนใช้เทียบ regression เท่านั้น ไม่ใช่หลักฐานว่าข้อใดแก้แล้ว

---

# สิ่งที่ตรวจแล้ว — ไม่พบปัญหา (Verified Clean)

**ฝั่ง mask/domain core (สำคัญที่สุด):**
- Mask authorization flow เคารพ CONTEXT.md ครบ: `encodeAuthorizedMask` clamp ตาม selected region + ปฏิเสธ empty/overflow mask; `intersectMaskWithRegion` + `findRecoveredRegionId` (IoU ≥ 0.5, center ≤ ¼ min-dimension, margin 0.05 เหนือ runner-up) ตรง spec "Recovered cleaning region"; `withinTranslationScope` enforce translation scope; `scopedRecognitionImage` withhold excluded pixels
- `undoManager.push` ถูกต้องเรื่อง pointer หลัง overflow; `useTranslation` ปล่อย operation lock ใน `finally` ทุก path + abort in-flight fetches on unmount; autosave revision logic race-correct; `useCleaning` revoke object URLs ครบทุก stale-token path

**ฝั่ง sidecar:**
- `compose()` alpha blending ถูกต้อง (alpha zeroed นอก dilated support, restore pixel เดิมนอก support); AOT/LaMa crop-paste ไม่เขียนนอก mask เป็นครั้ง; letterbox round-trip sound; watchdog/late-completion discard กัน result.json คืนชีพ job ที่ timeout ถูกต้อง; protected-pixel invariance มี test หนา

**ฝั่ง Electron:**
- ทั้งสอง window ใช้ `contextIsolation: true`, `nodeIntegration: false`, sandbox default ของ Electron 44; splash preload expose minimal; sidecar health check จริง (`/health` poll พร้อม backoff + throw on timeout); `portGuard` ไม่เคย kill port owners (dialog ใน dev, auto-reselect ใน packaged); startup ordering ถูก (window ถูกสร้างหลัง health gate ผ่านเท่านั้น); `build-desktop.mjs` ระวังเรื่อง env-file exclusion + ONNX probe

**ฝั่ง extension/pairing:**
- Content scripts ถูก invoke โดย host page ไม่ได้; `verifyPairingToken` timing-safe; settings route ไม่ echo API keys กลับ

---

*รายงานนี้รวบรวมจากการรีวิวขนาน 5 ส่วน + การตรวจสถานะ build/test จริง เมื่อ 2026-09-26 — line numbers อ้างจาก working tree ที่ commit `bcd4cb3`*
