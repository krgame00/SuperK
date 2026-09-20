# SuperK System Health Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** แก้จุดเสี่ยงที่ตรวจพบจาก System Health Check โดยเน้นความถูกต้องและความปลอดภัยของงานผู้ใช้ก่อน ได้แก่ source persistence, revision-safe render cache, Chrome Extension Direct routing parity, pairing/network exposure และ end-to-end acceptance โดยไม่ถอยหลังระบบแปล, cleaning, export, color matching หรือ Uniform translated text shadow ที่ใช้งานได้แล้ว

**Architecture:** ให้ข้อมูลต้นฉบับที่ต้องอยู่ข้าม reload/restart มี durable representation เป็นแหล่งจริง, ให้ render cache เป็น derived data ที่ผูกกับ revision/signature เสมอ, ให้ Chrome Extension Direct Mode ใช้ routing policy เดียวกับ Server Mode สำหรับการแปลจริง, และจำกัด pairing/network surface ให้ local-by-default ส่วน dynamic model discovery ให้คงไว้เป็น catalog/diagnostic เท่านั้น

**Tech Stack:** Next.js, React, TypeScript, IndexedDB, Vitest, Chrome Extension MV3, Gemini API, JSZip, PDF.js, Docker Compose

---

## 0. ข้อกำหนดก่อนลงมือ

แผนนี้มาจากผลตรวจระบบวันที่ 17 กันยายน 2026 และมี reproduction ยืนยันแล้ว 3 จุด:

1. session ที่บันทึก `blob:` URL ของต้นฉบับจะไม่สามารถเปิด source เดิมได้หลัง Blob store หายจาก memory
2. translated-render cache สามารถคืนภาพเก่าได้แม้ caller ขอคนละ revision/signature
3. request ที่ไม่มี `Origin` สามารถขอ pairing token จาก host ที่ไม่ใช่ loopback แล้วใช้แก้ settings ได้

ก่อนแก้ทุก Task:

- อ่าน `.agents/AGENTS.md` และ `docs/AI-WORKING-NOTES.md`
- ห้าม `git reset --hard`, `git clean`, restore ทั้ง tree หรือ `git add -A`
- repository มีงานค้างหลายชุด ให้แก้เฉพาะไฟล์ใน Task นั้นและตรวจ diff แบบ narrow
- ห้ามเปลี่ยน fixed Gemini hierarchy ฝั่ง Server โดยไม่มี requirement ใหม่
- ห้ามถอยหลัง color/outline policy และ `docs/adr/0015-uniform-translated-text-shadow.md`
- Desktop/Electron อยู่นอกขอบเขตงานนี้
- ห้ามประกาศว่า provider จริง “แก้แล้ว” จาก unit tests อย่างเดียว ต้องมี real integration check ก่อน

ลำดับทำงานบังคับ: **P0 Source Persistence → P1 Render Revision Safety → P2 Direct Routing Parity → P3 Pairing/Network Hardening → P4 End-to-End Acceptance**

---

## Task 1 — P0: ทำ source image ให้คืนงานข้าม reload/restart ได้จริง

**เหตุผล:** นี่คือความเสี่ยงสูงสุด เพราะกระทบงานต้นฉบับของผู้ใช้โดยตรง ปัจจุบัน image/ZIP/CBZ/PDF import เก็บ Blob ใน `pageBlobStore` แล้วเอา runtime `blob:` URL ไปเป็น `page.url`; `saveProjectSession()` จึงบันทึก URL ที่หมดอายุหลัง reload/restart

**Files:**

- Create: `lib/imageDataUrl.ts`
- Modify: `src/app/page.tsx`
- Modify: `lib/projectStore.ts`
- Test: `tests/cleaning/projectStore.test.ts`
- Test: `tests/workflow/WorkspacePage.test.tsx` หรือสร้าง `tests/workflow/projectRestoreSourcePersistence.test.tsx` ถ้า seam เดิมไม่เหมาะ

### Step 1: เขียน failing tests สำหรับ durable source ก่อน

เพิ่ม test ระดับ persistence ให้พิสูจน์ว่า source ของ session ไม่พึ่ง runtime Blob URL:

```ts
it("restores a durable source after the runtime blob store is gone", async () => {
  const source = "data:image/png;base64,c291cmNl";

  await saveProjectSession({
    pages: [{ url: source, name: "page-1.png" }],
    currentPage: 0,
    bubbleCache: new Map(),
    translatedImageCache: new Map(),
  });

  const restored = await loadProjectSession();
  expect(restored?.pages[0].url).toBe(source);
  expect(restored?.pages[0].url.startsWith("blob:")).toBe(false);
});
```

เพิ่ม legacy guard test สำหรับ saved session ที่มี `blob:` URL แต่ไม่มี source asset ที่กู้ได้ โดย expectation ต้องเป็นการแจ้งว่า source ไม่พร้อม ไม่ใช่แกล้งคืนงานว่าใช้ได้

### Step 2: รัน test ให้เห็น RED

Run:

```bash
npx vitest run tests/cleaning/projectStore.test.ts
```

Expected: test ใหม่ที่บังคับ durable source/legacy detection ต้อง fail ก่อน implementation

### Step 3: สร้าง utility แปลง Blob → Data URL ที่ใช้ร่วมกัน

`lib/imageDataUrl.ts` ควรมี utility ฝั่ง browser ที่รับ `Blob` และคืน `Promise<string>` แบบ `data:<mime>;base64,...` พร้อม error ชัดเจนเมื่ออ่านไม่ได้

ตัวอย่าง contract:

```ts
export async function blobToDataUrl(blob: Blob): Promise<string> {
  // FileReader-based conversion; reject on read error/abort.
}
```

ถ้า `lib/projectStore.ts` มี helper private ทำงานซ้ำ ให้ย้ายมาใช้ utility กลางแทนการคัดลอก implementation สองชุด

### Step 4: เปลี่ยน import pipeline ให้ durable URL เป็น authoritative page URL

ใน `src/app/page.tsx` เปลี่ยน 3 เส้นทาง:

- ZIP/CBZ image
- PDF page render
- direct image upload

จาก:

```ts
pageBlobStore.set(pageId, blob, mimeType);
const objectUrl = pageBlobStore.getOrCreateObjectUrl(pageId) || "";
newPages.push({ id: pageId, url: objectUrl, name });
```

เป็นแนวทาง:

```ts
const durableUrl = await blobToDataUrl(blob);
pageBlobStore.set(pageId, blob, mimeType); // optional memory optimization only
newPages.push({ id: pageId, url: durableUrl, name });
```

หลักสำคัญคือ `page.url` และ cache key ที่บันทึก session ต้องเป็น durable URL; `pageBlobStore` จะเก็บไว้เป็น optional optimization ได้ แต่ห้ามเป็นแหล่งจริงเพียงแห่งเดียว

### Step 5: ป้องกัน legacy broken Blob sessions

ใน `loadProjectSession()` ตรวจ `data.pages` ก่อนคืนค่า:

- `data:` และ `http(s):` ถือเป็น recoverable ตาม contract เดิม
- `blob:` จาก session เก่า ถ้าไม่มี backing source ที่กู้ได้ ห้ามบอก UI ว่า “ระบบจำรูปภาพเดิมไว้”
- คืน metadata/warning ที่ UI ใช้แสดงว่า “ต้องนำเข้าต้นฉบับใหม่” หรือ filter session ไม่ให้ restore แบบหลอกว่าพร้อมใช้งาน
- bubble edits/translation metadata ที่ยังมีอยู่ต้องไม่ถูกลบอัตโนมัติ เผื่อผู้ใช้ re-import source แล้วทำงานต่อ

### Step 6: เพิ่ม high-level restore test

ทดสอบอย่างน้อย:

1. import source ที่มี durable URL
2. autosave
3. จำลอง runtime source cache หาย
4. restore session
5. source URL ยังใช้งานได้
6. bubble cache และ translated cache ยัง map กับหน้าเดิม

### Step 7: รัน targeted tests

```bash
npx vitest run tests/cleaning/projectStore.test.ts tests/workflow/WorkspacePage.test.tsx
npx tsc --noEmit
```

Expected: PASS

### Step 8: ตรวจ regression สำคัญ

```bash
npx vitest run tests/translation/useTranslation.monotonicAutosave.test.tsx tests/translation/useTranslation.restoreEdits.test.tsx tests/translation/useTranslation.restoreEdge.test.tsx tests/extension/workspaceAppend.test.ts
```

Expected: PASS

### Step 9: Commit เฉพาะไฟล์ P0

```bash
git add lib/imageDataUrl.ts src/app/page.tsx lib/projectStore.ts tests/cleaning/projectStore.test.ts tests/workflow/WorkspacePage.test.tsx
git commit -m "fix: persist durable page sources"
```

ถ้าสร้าง test file ใหม่ ให้ add ชื่อจริงแทนไฟล์ที่ไม่ได้แก้ ห้าม add งานอื่นใน dirty tree

**P0 ผ่านเมื่อ:** import → autosave → reload/restart simulation → restore แล้วยังเปิด source ได้ทุกหน้า โดย session ใหม่ไม่มี `blob:` URL เป็น authoritative source

---

## Task 2 — P1: ทำ translated-render cache ให้ revision-safe จริงทุกชั้น

**เหตุผล:** export มี dirty gate ป้องกันเคสหลักแล้ว แต่ lifecycle layer ยังสามารถคืน in-memory render เก่าโดยไม่ตรวจ `expectedSignature` และ eviction spill ใช้ signature คงที่ `"default"`

**Files:**

- Modify: `lib/lifecycle/workspaceResourceManager.ts`
- Modify: `lib/lifecycle/sessionSpillCache.ts` ถ้า contract ต้องรองรับ typed render entry
- Modify: `src/app/page.tsx`
- Modify: `hooks/useTranslation.ts`
- Test: `tests/lifecycle/resourcePlateauBenchmark.test.ts`
- Test: `tests/lifecycle/sessionSpillCache.test.ts`
- Test: `tests/export/exportRenderFreshness.test.ts`
- Test: `tests/translation/useTranslation.canvasMutationExport.test.tsx`

### Step 1: เขียน failing cache identity tests

เพิ่มกรณี:

```ts
it("does not restore an in-memory render from another revision", () => {
  manager.registerRenderedImage("p1", "rev-1", "data:old", 100);
  expect(manager.restoreRenderedImage("p1", "rev-2")).toBeNull();
});
```

และ:

```ts
it("restores the render when the signature matches", () => {
  manager.registerRenderedImage("p1", "rev-2", "data:new", 100);
  expect(manager.restoreRenderedImage("p1", "rev-2")).toBe("data:new");
});
```

ทำ test เดียวกันสำหรับ spilled cache หลัง eviction

### Step 2: รันให้ RED

```bash
npx vitest run tests/lifecycle/resourcePlateauBenchmark.test.ts tests/lifecycle/sessionSpillCache.test.ts
```

Expected: mismatch test fail กับ implementation ปัจจุบัน

### Step 3: เพิ่ม explicit rendered-image contract

ให้ lifecycle layer เก็บอย่างน้อย:

```ts
interface RenderedImageCacheEntry {
  signature: string;
  dataUrl: string;
}
```

เพิ่ม API เฉพาะแทนการใช้ generic `registerResource(..., "translated-render", ...)` แบบไม่มี identity:

```ts
registerRenderedImage(pageId, signature, dataUrl, sizeBytes)
restoreRenderedImage(pageId, expectedSignature)
```

กฎ:

- in-memory entry ต้อง signature ตรงก่อนคืน
- spilled entry ต้อง signature ตรงก่อนคืน
- eviction ต้อง spill ด้วย signature จริงของ entry ห้ามใช้ `"default"`
- restore จาก spill แล้ว rehydrate เข้า memory พร้อม signature เดิม

### Step 4: ให้ caller สร้าง signature จาก authoritative page revision

ใน `hooks/useTranslation.ts` ใช้ revision mechanism ที่มีอยู่ (`pageRevisionsRef`) เป็นฐานสร้าง render signature เช่น `page-v${revision}` และ expose accessor ให้ `src/app/page.tsx`

ทุก mutation ที่มีผลต่อ rendered image ต้องทำให้ signature เปลี่ยน ได้แก่:

- แก้ translated text
- ย้าย/resize bubble
- เปลี่ยน style ที่มีผลกับ render
- manual bubble edit
- cleaning/background ที่ทำให้ translated composite เปลี่ยน

ถ้าพบ mutation ใดไม่ได้เรียก `markPageDirty()` หรือ equivalent ให้เพิ่ม regression test ก่อนแก้

### Step 5: เปลี่ยน export registration/restore path

ใน `src/app/page.tsx`:

- current page render → register พร้อม current signature
- offscreen render → register พร้อม current signature
- spilled restore → ขอด้วย current signature
- คง `dirtyExportPagesRef` gate เดิมเป็น first-line protection

ห้ามลดความเข้มของ `shouldReuseCachedTranslatedRender()` และ `shouldReuseSpilledTranslatedRender()`

### Step 6: รัน targeted tests

```bash
npx vitest run tests/lifecycle/resourcePlateauBenchmark.test.ts tests/lifecycle/sessionSpillCache.test.ts tests/export/exportRenderFreshness.test.ts tests/translation/useTranslation.canvasMutationExport.test.tsx
npx tsc --noEmit
```

Expected: PASS

### Step 7: เพิ่ม regression จาก reproduction เดิม

กรณีเดิม:

```text
register old render at rev-1 → request rev-2 → must return null, never old image
```

ควรกลายเป็น permanent test ไม่ใช่ scratch reproduction อย่างเดียว

### Step 8: Commit เฉพาะ P1

```bash
git add lib/lifecycle/workspaceResourceManager.ts lib/lifecycle/sessionSpillCache.ts hooks/useTranslation.ts src/app/page.tsx tests/lifecycle/resourcePlateauBenchmark.test.ts tests/lifecycle/sessionSpillCache.test.ts tests/export/exportRenderFreshness.test.ts tests/translation/useTranslation.canvasMutationExport.test.tsx
git commit -m "fix: make rendered cache revision safe"
```

**P1 ผ่านเมื่อ:** render เก่าคนละ signature คืนไม่ได้ทั้ง memory และ spill และ export หลัง edit ใช้ข้อมูลล่าสุดเสมอ

---

## Task 3 — P2: ทำ Chrome Extension Direct Mode ใช้ routing policy เดียวกับ Server Mode

**เหตุผล:** Direct Mode ปัจจุบันใช้ dynamic discovery เป็น authoritative routing ทำให้ `Auto` เลือกโมเดลต่างจาก Server Mode และ timeout/fallback semantics ต่างกัน

**Files:**

- Modify: `chrome-extension/server.js`
- Modify: `chrome-extension/background.js`
- Test: `tests/chrome-extension/runtime.test.ts`
- Test: `tests/chrome-extension/settingsSync.test.ts` ถ้า catalog contract ถูกแตะ
- Reference only: `docs/AI-WORKING-NOTES.md`
- Reference only: `lib/server/geminiRequest.ts`

### Step 1: เขียน failing Direct routing tests

Auto Mode ต้องเริ่มด้วยลำดับเดียวกับ Server:

```text
gemini-3.5-flash-lite
gemini-3.8-flash
gemini-3.7-flash
gemini-3.6-flash
gemini-3-flash
gemini-3.5-flash
gemini-3.1-flash-lite
```

Test expectations:

- Direct Auto ไม่เรียก `/v1beta/models` เพื่อเลือก route ก่อนแปล
- request แรกใช้ `gemini-3.5-flash-lite`
- 429/โมเดล unavailable/retryable failure เดิน fallback ต่อ
- manual model preference ใช้เฉพาะโมเดลที่ผู้ใช้เลือก โดยหมุน key ได้
- MIME type ของรูปยังถูกต้อง

### Step 2: รันให้ RED

```bash
npx vitest run tests/chrome-extension/runtime.test.ts
```

Expected: test ที่ยืนยัน no-discovery/fixed-first-model fail กับ Direct implementation เดิม

### Step 3: แยก catalog discovery ออกจาก execution routing

ใน `chrome-extension/server.js`:

- คง `discoverGeminiRoutes()` สำหรับ model catalog / diagnostics / UI เท่านั้น
- เพิ่ม fixed Auto model constant ให้ตรงกับ `docs/AI-WORKING-NOTES.md`
- เพิ่ม helper สร้าง execution routes จาก 1–5 user keys
- de-duplicate keys เหมือนเดิม

ห้ามให้ catalog discovery เปลี่ยนลำดับ production translation อัตโนมัติ

### Step 4: ทำ timeout budget ให้สอดคล้อง Server

Direct image translation:

- per-attempt timeout สูงสุด `60_000 ms`
- total request budget `180_000 ms`
- ก่อนแต่ละ attempt คำนวณ remaining budget
- timeout ของ attempt ต้องไม่เกิน remaining budget
- เมื่อ budget หมดให้จบด้วย error ที่บอก timeout/fallback exhaustion ชัดเจน

### Step 5: กำหนด retry/fallback classification

ควร fallback ต่อเมื่อเป็นอย่างน้อย:

- HTTP 429 quota/rate limit
- model unavailable / not found ในกรณี model route ใช้ไม่ได้กับ key นั้น
- retryable 5xx
- network/attempt timeout ที่ยังเหลือ total budget

Safety/content block ต้องไม่ถูกบิดเป็น quota error และต้อง surface เป็นประเภทเดิมให้ผู้ใช้เข้าใจ

### Step 6: รัน extension tests

```bash
npx vitest run tests/chrome-extension/runtime.test.ts tests/chrome-extension/settingsSync.test.ts tests/chrome-extension/popup.test.ts tests/chrome-extension/content.test.ts
```

Expected: PASS

### Step 7: Real Direct smoke test

ใช้ API key ของผู้ใช้ผ่าน UI/extension storage ตามปกติ ห้ามพิมพ์ key ลง log/commit

ทดสอบอย่างน้อย:

1. รูป safe 1 หน้า
2. Auto Direct Mode
3. manual model preference 1 ครั้ง
4. quota/fallback ถ้าจำลองได้โดยไม่ทำ key เสีย
5. เปรียบเทียบ Server Mode กับ Direct Mode ว่า routing semantics เหมือนกัน

ห้ามประกาศ provider behavior fixed ถ้ายังทำเฉพาะ mocked tests

### Step 8: Commit เฉพาะ P2

```bash
git add chrome-extension/server.js chrome-extension/background.js tests/chrome-extension/runtime.test.ts tests/chrome-extension/settingsSync.test.ts
git commit -m "fix: align direct Gemini routing with server"
```

**P2 ผ่านเมื่อ:** Server Auto และ Direct Auto ใช้ model order / timeout budget / fallback policy เดียวกัน และ dynamic discovery ไม่เป็น execution authority

---

## Task 4 — P3: ปิดช่อง pairing no-Origin และทำ network exposure เป็น local-by-default

**เหตุผล:** ปัจจุบัน `/api/extension/pair` อนุญาต request ที่ไม่มี `Origin` โดยทันที และ Docker publish ports ทุก interface จึงเพิ่มความเสี่ยงบน LAN

**Files:**

- Modify: `src/app/api/extension/pair/route.ts`
- Modify: `docker-compose.yml`
- Test: Create `tests/extension/pairingSecurity.test.ts`
- Test: `tests/extension/settingsSecurity.test.ts`
- Verify: `components/workspace/SettingsModal.tsx`
- Verify: `src/app/page.tsx`

### Step 1: เขียน security tests ก่อน

อย่างน้อย 5 กรณี:

```text
no Origin + host server:3000       → 403
no Origin + 127.0.0.1:3000         → 200
foreign Origin                     → 403
loopback Origin                    → 200
missing/wrong pairing token settings → 401
```

เพิ่ม same-host case ที่เว็บ SuperK เรียก pairing จาก origin ตัวเองแล้วต้องยังใช้งานได้

### Step 2: รันให้ RED

```bash
npx vitest run tests/extension/pairingSecurity.test.ts tests/extension/settingsSecurity.test.ts
```

Expected: no-Origin non-loopback test fail กับ implementation เดิม

### Step 3: ทำ loopback/same-host validation ให้ชัดเจน

สร้าง helper ที่ normalize hostname:

```ts
function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}
```

Policy:

- ถ้ามี `Origin`: อนุญาต loopback origin หรือ exact same host เท่านั้น
- ถ้าไม่มี `Origin`: อนุญาตเฉพาะเมื่อ request URL hostname และ `Host` header เป็น loopback
- ห้ามตีความ “ไม่มี Origin” ว่าเป็น local โดยอัตโนมัติ
- settings endpoint ยังต้อง pairing token เช่นเดิม
- ห้ามส่ง Gemini key กลับ response

### Step 4: เปลี่ยน Docker default binding เป็น loopback

จาก:

```yaml
- "3000:3000"
- "8765:8765"
```

เป็น:

```yaml
- "127.0.0.1:3000:3000"
- "127.0.0.1:8765:8765"
```

LAN deployment ให้เป็นงาน opt-in แยกในอนาคตพร้อม authentication/TLS; ห้ามเปิด LAN เป็น default ในแผนนี้

### Step 5: ตรวจ app pairing callers

ยืนยัน `fetch("/api/extension/pair")` ใน workspace และ Settings Modal ยังได้ token เมื่อเว็บรันที่ loopback ตาม flow ปกติ

### Step 6: Verify Docker config

```bash
docker compose config
```

Expected: published host IP เป็น `127.0.0.1` ทั้ง frontend/backend

ถ้าเครื่องไม่มี Docker ให้บันทึกว่า command นี้ไม่ได้รัน แต่อย่าประกาศ Docker verification ผ่าน

### Step 7: รัน security/extension regression

```bash
npx vitest run tests/extension/pairingSecurity.test.ts tests/extension/settingsSecurity.test.ts tests/extension/settingsBridge.test.ts tests/chrome-extension/settingsSync.test.ts
npx tsc --noEmit
```

Expected: PASS

### Step 8: Commit เฉพาะ P3

```bash
git add src/app/api/extension/pair/route.ts docker-compose.yml tests/extension/pairingSecurity.test.ts tests/extension/settingsSecurity.test.ts
git commit -m "fix: restrict extension pairing to local hosts"
```

**P3 ผ่านเมื่อ:** non-loopback no-Origin request ขอ token ไม่ได้, local app/extension flow ยังใช้ได้, และ Docker default ไม่ expose ports ทั้ง LAN

---

## Task 5 — P4: เพิ่ม End-to-End Acceptance Test สำหรับ workflow จริง

**เหตุผล:** จุดที่ตรวจพบหลายจุดเกิดตรงรอยต่อระหว่าง module แม้ unit tests ทั้งหมดผ่าน จึงต้องมี acceptance seam ที่ครอบทั้ง workflow

**Files:**

- Create: `tests/workflow/systemHealthAcceptance.test.tsx` หรือใช้ high-level workflow test เดิมถ้าครอบครบ
- Modify only if needed: test helpers/fixtures ที่มีอยู่แล้ว
- No production modification unless test finds a real defect; ถ้าพบ ให้เปิดเป็น separate fix task พร้อม failing test ก่อน

### Step 1: สร้าง browser workflow acceptance scenario

สถานการณ์หลัก:

```text
Import source
→ Clean
→ Translate
→ Edit translated text
→ Move/resize bubble
→ Navigate to another page
→ Autosave
→ Simulate reload/restart
→ Restore saved session
→ Export image/ZIP
```

Assertions ภายนอกที่ต้องเห็น:

- source เปิดได้หลัง restore
- bubble ล่าสุดยังอยู่ตำแหน่งและข้อความล่าสุด
- translated render เก่าไม่ถูกนำกลับมาใช้หลัง edit
- export ใช้ latest bubble/style state
- cleaning metadata ของหน้าที่เกี่ยวข้องไม่สลับข้ามหน้า
- ไม่มี silent fallback เป็น raw/untranslated page เมื่อ translated export render ล้มเหลว

### Step 2: เพิ่ม Extension acceptance แยก Server/Direct

ทดสอบ contract ระดับ harness:

- Server Mode ส่ง `/api/translate`
- Direct Mode ใช้ fixed known-good route policy
- ทั้งสองส่ง `TRANSLATION_SUCCESS` รูปแบบ bubble contract เดียวกัน
- text style / Uniform Shadow semantics ของ overlay เดิมไม่ถอยหลัง

### Step 3: รัน targeted acceptance

```bash
npx vitest run tests/workflow/systemHealthAcceptance.test.tsx tests/chrome-extension/runtime.test.ts tests/cleaning/translationOverlay.test.ts tests/colorMatching/uniformTranslatedTextShadow.test.ts
```

Expected: PASS

### Step 4: รัน TypeScript และ full suite

```bash
npx tsc --noEmit
npx vitest run
```

Expected: 0 failed tests

อย่ายึดจำนวน test เดิม `134 files / 798 tests` เป็นค่าคงที่ เพราะหลังเพิ่ม regression tests จำนวนต้องเพิ่ม; เกณฑ์คือทุก test ที่ค้นพบผ่าน

### Step 5: Build verification

```bash
npm run build
```

Expected: exit code 0

ถ้า build พึ่ง environment/service ภายนอก ให้แยก failure ที่เกิดจาก environment ออกจาก compile/runtime defect และบันทึกหลักฐาน

### Step 6: Manual real-use smoke test

ใช้ representative project จริง 2–3 หน้า:

1. รูปธรรมดาที่เคยแปลได้
2. หน้าที่มี text style/outline สี
3. หน้าที่เคยมี cleaning หรือ safety/fallback edge ถ้ามีสิทธิ์ทดสอบ

ทำ:

```text
import → clean → translate → edit → save → reload browser → restore → export
```

ตรวจผลด้วยตาและเปิดไฟล์ export จริง

### Step 7: Real Gemini validation

ทดสอบ Server Mode และ Direct Mode ด้วย key จริงโดยไม่บันทึก key ลงไฟล์/log:

- model ที่ถูกเรียกจริง
- fallback behavior เมื่อมี retryable failure ถ้าจำลองได้
- timeout ไม่ค้างเกิน policy
- error safety/provider แสดงเป็นหมวดที่ถูกต้อง

### Step 8: Commit acceptance tests

```bash
git add tests/workflow/systemHealthAcceptance.test.tsx
git commit -m "test: cover system health workflow seams"
```

**P4 ผ่านเมื่อ:** automated acceptance + type-check + full test suite + build + manual real workflow ผ่าน และ provider validation มีหลักฐานแยกจาก mocked tests

---

## Task 6 — P5: ตรวจ minor translation-path consistency โดยไม่แตะ production ถ้าไม่มี consumer

**เหตุผล:** audit พบ `/api/translate-text` ใช้ key/routing contract ไม่เท่ากับ image route แต่ยังไม่มีหลักฐานว่าเป็น main runtime path จึงไม่ควรแก้โดยเดา

**Files:**

- Inspect: `src/app/api/translate-text/route.ts`
- Inspect: consumers จาก `search_text("/api/translate-text")`
- Test: `tests/translation/routes.test.ts`
- Test: `tests/translation/dynamicRoutingRoutes.test.ts`

### Step 1: ยืนยัน consumer ก่อน

ค้น runtime callers ที่ไม่ใช่ tests/docs:

```bash
rg "/api/translate-text|translateText" src hooks components chrome-extension lib
```

### Step 2: ตัดสินตามหลักฐาน

- ถ้าไม่มี production consumer: บันทึกว่าเป็น dormant/legacy path และไม่แก้ใน remediation นี้
- ถ้ามี production consumer: ทำ separate spec ก่อนแก้ key precedence/model routing เพื่อไม่ทำให้ image route baseline เสีย

### Step 3: Regression only

```bash
npx vitest run tests/translation/routes.test.ts tests/translation/dynamicRoutingRoutes.test.ts
```

Expected: PASS

**P5 ผ่านเมื่อ:** รู้ชัดว่า route นี้ active หรือ dormant และไม่มีการเปลี่ยน production behavior โดยไม่มี consumer evidence

---

## Final Verification Checklist

หลังทำทุก Task ให้ตรวจตามลำดับนี้:

```bash
npx tsc --noEmit
npx vitest run
npm run build
git status --short
git diff --check
```

จากนั้นตรวจเฉพาะไฟล์ที่แก้ในแต่ละ Task ด้วย `git diff -- <paths...>` เพื่อให้แน่ใจว่าไม่ได้รวมงานเก่าของ repository เข้ามา

### Acceptance Matrix

| Area | เกณฑ์ผ่าน |
|---|---|
| Source persistence | ปิด/reload แล้วคืนต้นฉบับได้; session ใหม่ไม่พึ่ง `blob:` URL |
| Autosave | monotonic save behavior เดิมยังผ่าน |
| Cleaning | clean/mask metadata ไม่สลับหน้าและไม่หายหลัง flow ปกติ |
| Translation Server | fixed known-good hierarchy, user-key precedence, 60s/180s policy ไม่ถอยหลัง |
| Translation Direct | Auto ใช้ routing policy เดียวกับ Server, discovery ไม่ authoritative |
| Render cache | signature mismatch คืน null ทั้ง memory/spill |
| Export | edited/moved text เป็นเวอร์ชันล่าสุด; fail loud เมื่อ render ไม่สำเร็จ |
| Color/Outline/Shadow | confidence-gated source outline + Uniform translated text shadow ยังผ่าน regressions |
| Extension pairing | no-Origin non-loopback ถูกปฏิเสธ |
| Network default | Docker bind loopback by default |
| Full validation | type-check + all tests + build + manual restore/export smoke test ผ่าน |

---

## Rollback Strategy

Rollback ให้ทำเป็นราย Task เท่านั้น:

- P0: คืนเฉพาะ import source representation/persistence contract; ห้ามล้าง saved sessions โดยไม่สำรอง metadata
- P1: คืน dedicated render cache API แบบ scoped แต่ห้ามคืน `"default"` signature path โดยไม่ยอมรับ stale-render risk อย่างชัดเจน
- P2: สามารถกลับ Direct execution ไป baseline ก่อนหน้าได้โดยไม่แตะ Server hierarchy; catalog discovery codeต้องคงแยกจาก execution
- P3: ถ้า local pairing ใช้ไม่ได้ ให้แก้ hostname/origin normalization ไม่ใช่เปิด `!origin => true` กลับมา และห้ามเปิด Docker `0.0.0.0` เป็น default เพื่อแก้ workaround
- P4/P5: test-only changes rollback ได้โดยไม่แตะ runtime

ทุก rollback ต้อง preserve งาน color/outline/shadow, cleaning, export fixes และ production changes อื่นที่ไม่เกี่ยวข้อง

---

## Out of Scope

- Desktop/Electron installer หรือ desktop lifecycle
- เปลี่ยน Gemini Server hierarchy ที่ใช้งานได้อยู่
- เปลี่ยน NSFW 3×2 slicing policy
- เปลี่ยน source color/outline confidence policy
- เปลี่ยน Uniform translated text shadow contract จาก ADR 0015
- redesign UI/UX ที่ไม่เกี่ยวกับ warning ของ legacy broken session
- เปิด SuperK เป็น public/LAN service แบบเต็มรูปแบบ
- OAuth/account system ใหม่
- retrain OCR/inpainting model
- performance optimization รอบใหม่ก่อน correctness fixes ข้างต้นผ่าน

---

## Recommended Execution Order Summary

**P0 — Source Persistence** ป้องกันงานผู้ใช้เปิดต่อไม่ได้หลัง restart  
**P1 — Revision-safe Render Cache** ป้องกัน export/preview คืนภาพคนละ revision  
**P2 — Direct Routing Parity** ลดความต่างระหว่าง Web/Extension และทำ fallback คาดเดาได้  
**P3 — Pairing + Local Network Hardening** ปิดช่อง no-Origin และ LAN exposure เริ่มต้น  
**P4 — End-to-End Acceptance** ล็อก behavior ทั้งระบบไม่ให้ regression กลับมา  
**P5 — translate-text Audit** ตรวจ minor path ตาม consumer evidence เท่านั้น

เมื่อ P0–P4 ผ่านแล้วจึงค่อยพิจารณางาน performance/lifecycle optimization รอบถัดไป เพื่อไม่เอาความเร็วแลกกับ durability หรือ correctness อีก
