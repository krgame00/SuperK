# Monochrome Manga Text Style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เมื่อระบบยืนยันว่าหน้ามังงะเป็นภาพขาวดำ ให้ข้อความแปลอัตโนมัติใช้สไตล์ที่ใกล้ต้นฉบับมังงะมากขึ้น: ฟองสว่างใช้ข้อความดำ ไม่มีเงา; ฟองมืดใช้ข้อความขาว ไม่มีเงา; พื้นหลังยากให้ช่วยด้วย outline/readability โดยยังไม่ใส่เงาอัตโนมัติ และหน้าสียังคงพฤติกรรม Uniform Shadow เดิม

**Architecture:** เพิ่ม page-level monochrome classifier จากภาพต้นฉบับ แล้วส่งผล `isMonochromePage` ลงใน style profile ของแต่ละ bubble ระหว่าง color-profile enrichment. ตัว resolver เป็นแหล่งตัดสิน style เดียว: Manual ยังชนะทุกอย่าง, SFX/overlay subtitle ใช้ policy เดิม, dialogue/narration บนหน้าขาวดำใช้ monochrome rule; renderer ทั้ง Web/Export/Extension เพียง render style ที่ resolver/metadata กำหนดโดยไม่เดาใหม่เอง

**Tech Stack:** Next.js, React, TypeScript, Canvas 2D, Vitest, Chrome Extension MV3

## Global Constraints

- ใช้เฉพาะภาพต้นฉบับ pre-clean เป็นหลักฐานว่าหน้าเป็นขาวดำ ห้ามใช้ clean image ที่อาจถูกทำให้ขาว/เทาโดย pipeline
- classifier ต้องเป็น page-level ไม่ใช่ตัดสินจาก bubble เดียว เพื่อไม่ให้ฟองขาวบนหน้าสีถูกจัดเป็น monochrome
- Monochrome Auto มีผลกับ `dialogue` และ `narration` เป็นหลัก; `sfx` และ `overlay_subtitle` คง policy เดิมในรอบนี้
- Manual ownership มีอำนาจสูงสุด; ห้าม monochrome rule เปลี่ยนสี/เงาที่ผู้ใช้ตั้งเอง
- หน้า color/unknown ต้องรักษา ADR 0015 Uniform translated text shadow เดิมทุกประการ
- monochrome light bubble: `textColor=#000000`, automatic `shadow=undefined`
- monochrome dark bubble: `textColor=#ffffff`, automatic `shadow=undefined`
- monochrome mixed/low-contrast: ใช้ outline strengthening / readable fallback โดย `shadow=undefined`; background plate ยังคงอนุญาตเฉพาะ overlay subtitle ตาม policy เดิม
- ห้ามลบ source `shadow`/`glow` metadata; มันยังเป็น evidence แต่ไม่เป็น rendering authority
- ต้องมี parity: Workspace Preview = Export = Chrome Extension Server/Direct
- repository มี dirty work จำนวนมาก: ห้าม `git add -A`, `git clean`, reset ทั้ง tree หรือ commit ไฟล์อื่นปน

---

## File Structure / Responsibilities

- Create: `lib/colorMatching/monochromePage.ts` — pure page-level classifier และ threshold constants
- Modify: `lib/colorMatching/types.ts` — เพิ่ม metadata `isMonochromePage` และ confidence/diagnostic fields ที่จำเป็น
- Modify: `hooks/useTranslation.ts` — classify ภาพต้นฉบับหนึ่งครั้งต่อหน้า แล้ว attach metadata ให้ bubble profiles
- Modify: `lib/colorMatching/resolveTextStyle.ts` — monochrome style decision และ shadow exception
- Modify: `lib/translationOverlay.ts` — renderer ใช้ resolved `shadow=undefined` โดยไม่เติม Standard Shadow กลับเอง
- Modify: `chrome-extension/background.js` — ส่ง page monochrome metadata ไป content script
- Modify: `chrome-extension/content.js` — ใช้ monochrome metadata เพื่อไม่เติม Standard Shadow ใน Auto; Manual Off/Standard ยังเดิม
- Create: `docs/adr/0016-monochrome-manga-text-style.md` — narrow supersession ของ ADR 0015 สำหรับ confirmed monochrome dialogue/narration
- Test: `tests/colorMatching/monochromePage.test.ts`
- Test: `tests/colorMatching/monochromeTextStyle.test.ts`
- Test: `tests/cleaning/translationOverlay.test.ts`
- Test: `tests/chrome-extension/adaptiveBubbleOverlay.test.ts`
- Test: `tests/chrome-extension/runtime.test.ts`

---

### Task 1: Page-level Monochrome Classifier

**Files:**
- Create: `lib/colorMatching/monochromePage.ts`
- Test: `tests/colorMatching/monochromePage.test.ts`

**Interfaces:**
- Produces:
```ts
export interface MonochromePageAnalysis {
  isMonochrome: boolean;
  confidence: number;
  chromaticPixelRatio: number;
  strongChromaticPixelRatio: number;
  sampledPixelCount: number;
}

export function analyzeMonochromePage(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): MonochromePageAnalysis;
```

- [ ] **Step 1: Write failing classifier tests**

สร้าง fixture แบบ deterministic:

```ts
it("classifies a neutral grayscale manga page as monochrome", () => {
  const page = makePage([
    [255,255,255], [220,220,220], [120,120,120], [20,20,20],
  ]);
  const result = analyzeMonochromePage(page.rgba, page.width, page.height);
  expect(result.isMonochrome).toBe(true);
  expect(result.confidence).toBeGreaterThanOrEqual(0.9);
});

it("rejects a page with meaningful colored artwork", () => {
  const page = makeMostlyGrayPageWithColorPatch([220, 45, 70], 0.08);
  expect(analyzeMonochromePage(page.rgba, page.width, page.height).isMonochrome).toBe(false);
});

it("tolerates scanner noise and JPEG channel drift", () => {
  const page = makeNearGrayNoisePage({ maxChannelDelta: 8 });
  expect(analyzeMonochromePage(page.rgba, page.width, page.height).isMonochrome).toBe(true);
});
```

- [ ] **Step 2: Run RED**

Run:
```bash
npx vitest run tests/colorMatching/monochromePage.test.ts
```
Expected: FAIL because classifier does not exist.

- [ ] **Step 3: Implement deterministic classifier**

ใช้ subsampling เพื่อไม่อ่านทุก pixel ในภาพใหญ่ เช่น grid stride ที่จำกัด sample ประมาณ 20k pixels.

ต่อ pixel:
```ts
const max = Math.max(r, g, b);
const min = Math.min(r, g, b);
const chroma = max - min;
const saturation = max > 0 ? chroma / max : 0;

const chromatic = chroma >= 18 && saturation >= 0.08;
const strongChromatic = chroma >= 35 && saturation >= 0.18;
```

เกณฑ์เริ่มต้น:
```ts
const isMonochrome =
  chromaticPixelRatio <= 0.02 &&
  strongChromaticPixelRatio <= 0.005;
```

confidence:
```ts
const confidence = clamp01(
  1 - Math.max(chromaticPixelRatio / 0.02, strongChromaticPixelRatio / 0.005) * 0.5,
);
```

ห้ามนับ transparent pixel และให้ ignore alpha ต่ำกว่า 32.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run tests/colorMatching/monochromePage.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit Task 1 only**

```bash
git add lib/colorMatching/monochromePage.ts tests/colorMatching/monochromePage.test.ts
git commit -m "feat: detect monochrome manga pages"
```

**Acceptance:** หน้าขาวดำจริง, gray scan, JPEG drift ผ่าน; หน้าที่มีสีจริง 5–10% ไม่ถูก classify เป็น monochrome.

---

### Task 2: Carry Monochrome Evidence Through Text Style Profiles

**Files:**
- Modify: `lib/colorMatching/types.ts`
- Modify: `hooks/useTranslation.ts`
- Test: `tests/translation/useTranslation.test.tsx` หรือ test enrichment seam ที่ใกล้ที่สุด

**Interfaces:**
- Consumes: `analyzeMonochromePage(...)`
- Produces on `TextStyleProfile`:
```ts
isMonochromePage?: boolean;
monochromeConfidence?: number;
```

- [ ] **Step 1: Add failing enrichment test**

ทดสอบว่าภาพ grayscale หนึ่งหน้า ถูก analyze เพียงครั้งเดียว แล้ว bubble profiles ทุกอันได้:
```ts
expect(bubble.styleProfile).toMatchObject({
  isMonochromePage: true,
  monochromeConfidence: expect.any(Number),
});
```

และภาพ color ต้องได้ `isMonochromePage:false`.

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/translation/useTranslation.test.tsx
```

- [ ] **Step 3: Add fields in `TextStyleProfile`**

```ts
/** Page-level evidence derived from the original pre-clean source image. */
isMonochromePage?: boolean;
monochromeConfidence?: number;
```

- [ ] **Step 4: Classify original page once in `enrichBubblesWithColorProfiles`**

เพิ่ม helper อ่าน full source image ลง small canvas เช่น max dimension 512 แล้วเรียก `analyzeMonochromePage`.

Pseudo-flow:
```ts
const pageAnalysis = analyzeImageElementMonochrome(img);
for (const b of bubbles) {
  const profile = extractTextColors(sample);
  profile.isMonochromePage = pageAnalysis.isMonochrome;
  profile.monochromeConfidence = pageAnalysis.confidence;
  ...
}
```

ห้าม classify จาก cleaned page หรือแต่ละ bubble.

- [ ] **Step 5: Run GREEN + color sampling regressions**

```bash
npx vitest run tests/translation/useTranslation.test.tsx tests/colorMatching/sampleTextColors.test.ts tests/colorMatching/reproWhiteBubble.test.ts
npx tsc --noEmit
```

- [ ] **Step 6: Commit Task 2 only**

```bash
git add lib/colorMatching/types.ts hooks/useTranslation.ts tests/translation/useTranslation.test.tsx
git commit -m "feat: attach monochrome page evidence to text styles"
```

**Acceptance:** monochrome state เป็น page evidence เดียวกันทุก bubble และ source color detector เดิมยังทำงานเหมือนเดิม.

---

### Task 3: Monochrome Resolver Policy — Black/White, No Automatic Shadow

**Files:**
- Modify: `lib/colorMatching/resolveTextStyle.ts`
- Create: `tests/colorMatching/monochromeTextStyle.test.ts`
- Modify: `tests/colorMatching/uniformTranslatedTextShadow.test.ts`

**Interfaces:**
- Consumes `profile.isMonochromePage` and background evidence
- Produces normal `ResolvedTextStyle`; no new renderer-specific contract

- [ ] **Step 1: Write failing style matrix tests**

Required matrix:

```ts
// white/light balloon
expect(resolve(monoProfile({ backgroundLuminance: 245 }))).toMatchObject({
  textColor: "#000000",
  shadow: undefined,
});

// black bubble / dark art
expect(resolve(monoProfile({ backgroundLuminance: 20 }))).toMatchObject({
  textColor: "#ffffff",
  shadow: undefined,
});

// color page remains ADR 0015
expect(resolve(colorProfile())).toMatchObject({
  shadow: STANDARD_TRANSLATED_TEXT_SHADOW,
});
```

เพิ่ม tests:
- narration บนพื้นสว่าง → black/no shadow
- mixed grayscale samples → readable outline but no shadow
- SFX admitted → existing source/ADR behavior unchanged
- overlay subtitle → existing readable policy unchanged
- Manual Standard → Standard Shadow แม้หน้า monochrome
- Manual Off → no shadow
- source-faithful dialogue on monochrome page → preserve admitted fill/outline แต่ automatic shadow off

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/colorMatching/monochromeTextStyle.test.ts tests/colorMatching/uniformTranslatedTextShadow.test.ts
```

- [ ] **Step 3: Add resolver helper**

```ts
function shouldUseMonochromeMangaStyle(
  profile: TextStyleProfile,
  category: TextStyleCategory,
): boolean {
  return profile.isMonochromePage === true &&
    (profile.monochromeConfidence ?? 0) >= 0.85 &&
    (category === "dialogue" || category === "narration");
}
```

- [ ] **Step 4: Resolve monochrome style after Manual, before generic Auto shadow policy**

Ordering in `resolveBubbleTextStyle`:
1. Manual
2. explicit special category policy where required
3. monochrome dialogue/narration
4. existing color/readable/ADR 0015 flow

For monochrome dialogue/narration:

```ts
const bgLum = profile.backgroundLuminance;
const samples = profile.backgroundLuminanceSamples ?? [];
const mixed = samples.length > 0 && Math.max(...samples) - Math.min(...samples) >= 90;

if (bgLum !== undefined && bgLum >= 155 && !mixed) {
  return {
    ...resolvedBase,
    textColor: "#000000",
    hasOutline: false,
    outlineWidthRatio: 0,
    shadow: undefined,
    glow: undefined,
    readabilityHalo: undefined,
  };
}

if (bgLum !== undefined && bgLum <= 100 && !mixed) {
  return {
    ...resolvedBase,
    textColor: "#ffffff",
    textOutline: "#000000",
    hasOutline: false,
    outlineWidthRatio: 0,
    shadow: undefined,
    glow: undefined,
    readabilityHalo: undefined,
  };
}
```

สำหรับ mixed/unknown background ให้เลือก black/white จาก luminance แล้วเปิด contrasting outline ที่ `0.10–0.14`, แต่ `shadow` ต้องยัง `undefined`.

สำคัญ: ถ้า source admitted มี outline จริงและ confidence สูง สามารถ preserve outline identity ได้; ห้ามบังคับ no-outline ถ้าจะทำให้งาน source-faithful เสีย. กฎ no-outline คือ default สำหรับ plain dialogue on clean background.

- [ ] **Step 5: Update ADR 0015 regression expectation**

แก้ test เดิมที่กล่าวว่า plain white speech balloon ทุกอันต้องมี shadow ให้เพิ่มเงื่อนไขว่า **color/unknown pages** ยังต้องมี Standard Shadow; confirmed monochrome dialogue/narration เป็น exception ตาม ADR ใหม่.

- [ ] **Step 6: Run GREEN**

```bash
npx vitest run tests/colorMatching/monochromeTextStyle.test.ts tests/colorMatching/uniformTranslatedTextShadow.test.ts tests/colorMatching/reproWhiteBubble.test.ts tests/colorMatching/adaptiveReadableRegressionExportParity.test.ts
npx tsc --noEmit
```

- [ ] **Step 7: Commit Task 3 only**

```bash
git add lib/colorMatching/resolveTextStyle.ts tests/colorMatching/monochromeTextStyle.test.ts tests/colorMatching/uniformTranslatedTextShadow.test.ts
git commit -m "feat: use shadowless monochrome manga text style"
```

**Acceptance:** หน้าตัวอย่างที่ผู้ใช้ส่งควรได้ black/no-shadow บนฟองขาว; bubble ดำได้ white/no-shadow; color page ไม่เปลี่ยน.

---

### Task 4: Web Preview / Export Rendering Parity

**Files:**
- Modify only if needed: `lib/translationOverlay.ts`
- Modify: `tests/cleaning/translationOverlay.test.ts`

**Interfaces:**
- Consumes only `ResolvedTextStyle.shadow`
- Renderer must not independently infer monochrome or automatically add a shadow

- [ ] **Step 1: Add failing canvas rendering test**

```ts
it("renders confirmed monochrome dialogue without a canvas shadow", async () => {
  await renderOverlay("ข้อความ", {
    styleProfile: {
      fill: "#000000",
      outline: "#ffffff",
      source: "auto",
      ownershipMode: "auto",
      category: "dialogue",
      isMonochromePage: true,
      monochromeConfidence: 0.98,
      backgroundLuminance: 245,
    },
  });

  expect(shadowBlurs.at(-1) ?? 0).toBe(0);
  expect(shadowOffsetsX.at(-1) ?? 0).toBe(0);
});
```

เพิ่ม paired test color page ยัง render Standard Shadow.

- [ ] **Step 2: Run RED or confirm renderer already honors `undefined`**

```bash
npx vitest run tests/cleaning/translationOverlay.test.ts
```

ถ้า test ผ่านโดยไม่แก้ production code ให้ **ไม่แก้ `translationOverlay.ts`** (YAGNI).

- [ ] **Step 3: If needed, make shadow application strictly data-driven**

กฎ renderer:
```ts
if (resolved.shadow) {
  // configure ctx.shadow*
} else {
  ctx.shadowColor = "rgba(0,0,0,0)";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}
```

- [ ] **Step 4: Verify export uses same canvas**

```bash
npx vitest run tests/cleaning/translationOverlay.test.ts tests/export/exportRenderFreshness.test.ts tests/translation/useTranslation.canvasMutationExport.test.tsx
```

- [ ] **Step 5: Commit only if source changed**

```bash
git add lib/translationOverlay.ts tests/cleaning/translationOverlay.test.ts
git commit -m "test: lock monochrome preview export parity"
```

**Acceptance:** Workspace และ Export ใช้ black/no-shadow เหมือนกัน ไม่มี renderer layer แอบเติมเงากลับ.

---

### Task 5: Chrome Extension Server/Direct Parity

**Files:**
- Modify: `chrome-extension/background.js`
- Modify: `chrome-extension/content.js`
- Modify: `tests/chrome-extension/runtime.test.ts`
- Modify: `tests/chrome-extension/adaptiveBubbleOverlay.test.ts`

**Interfaces:**
- `TRANSLATION_SUCCESS` adds:
```js
pageStyle: {
  isMonochromePage: boolean,
  monochromeConfidence: number,
}
```
- Bubble `styleProfile` remains authoritative when provided

- [ ] **Step 1: Write failing message contract test**

For both Server and Direct flow, assert success message forwards monochrome evidence supplied by translation result or image analysis helper.

Chrome Extension เป็น plain MV3 scripts และไม่ควร duplicate classifier แบบเดาเองใน content renderer. เพิ่ม helper ใน `chrome-extension/server.js` ที่ทำงานกับ image bytes ก่อนส่ง overlay:

```js
async function analyzeImageStyle(base64, mimeType, bubbles) {
  const blob = base64ToBlob(base64, mimeType);
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(bitmap.width * scale)),
    Math.max(1, Math.round(bitmap.height * scale)),
  );
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  // use the same threshold constants as Task 1, copied as named constants and locked by parity tests
  const pageStyle = classifyMonochromeRgba(rgba, canvas.width, canvas.height);
  return { pageStyle, bubbleBackgroundLuminance: sampleBubbleLuminance(ctx, bubbles, canvas.width, canvas.height) };
}
```

Contract result:
```js
{
  pageStyle: { isMonochromePage, monochromeConfidence },
  bubbleBackgroundLuminance: { [bubbleIndex]: number }
}
```

If `createImageBitmap` / `OffscreenCanvas` is unavailable, return `{isMonochromePage:false, monochromeConfidence:0}` and fall back to ADR 0015 rather than guessing monochrome.

- [ ] **Step 2: Write failing overlay tests**

```ts
expect(monochromeLightBubble.style.color).toBe("rgb(0, 0, 0)");
expect(monochromeLightBubble.style.textShadow).toBe("none");
```

Dark bubble:
```ts
expect(bubble.style.color).toBe("rgb(255, 255, 255)");
expect(bubble.style.textShadow).not.toContain("rgba(30, 30, 30, 0.80)");
```

Color page:
```ts
expect(bubble.style.textShadow).toContain("rgba(30, 30, 30, 0.80)");
```

Manual Standard/Off tests must stay unchanged.

- [ ] **Step 3: Run RED**

```bash
npx vitest run tests/chrome-extension/runtime.test.ts tests/chrome-extension/adaptiveBubbleOverlay.test.ts
```

- [ ] **Step 4: Propagate pageStyle**

`background.js` ต้อง analyze original image หลัง `fetchImageAsBase64()` และก่อนส่ง `TRANSLATION_SUCCESS` ทั้ง Server และ Direct:

```js
const visual = await SuperKServer.analyzeImageStyle(
  image.base64,
  image.mimeType,
  result.bubbles,
);

const enrichedBubbles = result.bubbles.map((bubble, index) => ({
  ...bubble,
  styleProfile: {
    ...(bubble.styleProfile || {}),
    backgroundLuminance: visual.bubbleBackgroundLuminance[index],
    isMonochromePage: visual.pageStyle.isMonochromePage,
    monochromeConfidence: visual.pageStyle.monochromeConfidence,
  },
}));

await send({
  action: "TRANSLATION_SUCCESS",
  bubbles: enrichedBubbles,
  ...,
  pageStyle: visual.pageStyle,
});
```

ใช้ original bytes ที่ดาวน์โหลดมา ไม่ใช้ clean/inpainted image. ถ้า analysis ล้มเหลวให้ fallback เป็น color/unknown (`isMonochromePage:false`) โดยไม่ทำให้ translation flow fail.

- [ ] **Step 5: Content renderer chooses automatic shadow policy**

Do not infer from fill alone. Use bubble metadata enriched in Step 4. The translation prompt already emits `styleCategory`, so category priority is `styleProfile.category` → `b.styleCategory` → `dialogue`:

```js
const category = bubbleProfile.category || b.styleCategory || 'dialogue';
const isMonochromeAuto =
  bubbleProfile.isMonochromePage === true &&
  (bubbleProfile.monochromeConfidence ?? 0) >= 0.85 &&
  !isManual &&
  (category === 'dialogue' || category === 'narration');

const bgLum = bubbleProfile.backgroundLuminance;
let monochromeTextColor = null;
let monochromeNeedsOutline = false;
if (isMonochromeAuto && typeof bgLum === 'number') {
  if (bgLum >= 155) monochromeTextColor = '#000000';
  else if (bgLum <= 100) monochromeTextColor = '#ffffff';
  else monochromeNeedsOutline = true;
}

const bubbleTextColor = monochromeTextColor || bubbleProfile.fill || textColor;
const standardShadow = (shadowOff || isMonochromeAuto)
  ? null
  : '0.08em 0.08em 0.15em rgba(30, 30, 30, 0.80)';
```

For `100 < backgroundLuminance < 155` or a mixed region, use the same contrasting-outline fallback defined in Task 3 and keep `shadow=null`; do not silently choose a different threshold in the Extension. If `backgroundLuminance` is missing, do not force black/white and do not suppress the Standard Shadow: fall back completely to current ADR 0015 behavior. This avoids making text disappear when region analysis is unavailable and keeps Web/Extension parity deterministic.

- [ ] **Step 6: Cached/restored overlays persist `pageStyle`**

Update Chrome local-storage payload so restored overlay gets the same no-shadow behavior after reload.

- [ ] **Step 7: Run GREEN**

```bash
npx vitest run tests/chrome-extension/runtime.test.ts tests/chrome-extension/adaptiveBubbleOverlay.test.ts tests/chrome-extension/content.test.ts tests/chrome-extension/settingsSync.test.ts
```

- [ ] **Step 8: Commit Task 5 only**

```bash
git add chrome-extension/background.js chrome-extension/content.js tests/chrome-extension/runtime.test.ts tests/chrome-extension/adaptiveBubbleOverlay.test.ts
git commit -m "feat: match monochrome styling in extension overlays"
```

**Acceptance:** Server/Direct/cached extension overlays แสดง monochrome dialogue แบบเดียวกับ Web และ color pages ยังมี Standard Shadow.

---

### Task 6: ADR, Regression Matrix, and Release Gate

**Files:**
- Create: `docs/adr/0016-monochrome-manga-text-style.md`
- Modify if needed: `docs/AI-WORKING-NOTES.md`
- Tests: all focused suites below

- [ ] **Step 1: Write ADR 0016**

Decision text must state:

1. confirmed monochrome page is a narrow exception to ADR 0015
2. exception applies automatically only to dialogue/narration
3. light background → black text/no shadow
4. dark background → white text/no shadow
5. mixed background → contrasting outline allowed, no automatic shadow
6. Manual remains authoritative
7. SFX/overlay subtitle remain on existing policy for now
8. color/unknown pages continue ADR 0015 Uniform Shadow
9. page classification comes from original pre-clean source
10. Web/Export/Extension parity is required

- [ ] **Step 2: Run focused regression matrix**

```bash
npx vitest run \
  tests/colorMatching/monochromePage.test.ts \
  tests/colorMatching/monochromeTextStyle.test.ts \
  tests/colorMatching/uniformTranslatedTextShadow.test.ts \
  tests/colorMatching/reproWhiteBubble.test.ts \
  tests/colorMatching/sampleTextColors.test.ts \
  tests/cleaning/translationOverlay.test.ts \
  tests/chrome-extension/runtime.test.ts \
  tests/chrome-extension/adaptiveBubbleOverlay.test.ts
```
Expected: 0 failed.

- [ ] **Step 3: Typecheck and full suite**

```bash
npx tsc --noEmit
npx vitest run
```
Expected: 0 failed.

- [ ] **Step 4: Manual visual acceptance using representative pages**

Test at least:

```text
A. B/W page, white balloons → black text, no visible drop shadow
B. B/W page, black bubble → white text, no visible drop shadow
C. B/W page, dialogue over gray artwork → readable contrasting outline, no drop shadow
D. Color manga page → existing source-outline + Standard Shadow unchanged
E. Manual shadow Standard → still Standard even on B/W page
F. Manual shadow Off → still Off
```

Compare Workspace Preview and exported PNG side-by-side.

- [ ] **Step 5: Chrome visual acceptance**

Run same B/W page in Server and Direct extension modes and verify no style jump after cached overlay restore.

- [ ] **Step 6: Narrow diff review**

```bash
git diff --check
git status --short
```
Review only paths touched by this feature. Do not stage unrelated dirty files.

- [ ] **Step 7: Final documentation commit**

```bash
git add docs/adr/0016-monochrome-manga-text-style.md docs/AI-WORKING-NOTES.md
git commit -m "docs: define monochrome manga text policy"
```

---

## Final Acceptance Matrix

| Scenario | Expected |
|---|---|
| Confirmed B/W + white balloon + dialogue | black fill, no automatic shadow; no outline unless evidence/readability requires it |
| Confirmed B/W + black bubble + dialogue | white fill, no automatic shadow |
| Confirmed B/W + mixed gray artwork | black/white by contrast + thin contrasting outline; no automatic shadow |
| Confirmed B/W + narration | same monochrome rules |
| Confirmed B/W + SFX | existing SFX/source policy unchanged |
| Confirmed B/W + overlay subtitle | existing overlay readability policy unchanged |
| Color page + Auto | ADR 0015 Standard Shadow unchanged |
| Unknown classifier confidence | treat as color/unknown; ADR 0015 unchanged |
| Manual Standard | Standard Shadow |
| Manual Off | no shadow |
| Source `shadow/glow` metadata | retained, not automatic authority |
| Workspace vs Export | visually equivalent |
| Extension Server vs Direct vs cached restore | equivalent monochrome semantics |

---

## Rollback Strategy

Rollback by task only:

- Classifier can be disabled by never setting `isMonochromePage=true`; this safely falls back to ADR 0015.
- Resolver rollback must not alter source-color/outline confidence logic.
- Renderer rollback must not reintroduce per-bubble source shadow/glow or readabilityHalo.
- Extension rollback can omit `pageStyle`; absence must fall back to current Standard Shadow behavior.
- Never remove Manual `Standard / Off` control.

---

## Out of Scope

- User-facing toggle for monochrome mode
- Custom shadow sliders
- Recoloring SFX automatically to black
- Changing overlay subtitle policy
- OCR/translation model changes
- Cleaning/inpainting behavior changes
- Gemini routing changes
- Performance optimization unrelated to one-time page classification

---

## Recommended Execution Order

`Task 1 classifier → Task 2 metadata propagation → Task 3 resolver policy → Task 4 Web/Export parity → Task 5 Extension parity → Task 6 ADR + full release gate`

Do not start Task 5 before Task 3 contract is stable, because the Extension must mirror the resolved semantics rather than invent a second styling policy.
