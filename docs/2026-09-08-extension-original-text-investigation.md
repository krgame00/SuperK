# Investigation: Chrome Extension Original Text Inpainting Bug

**Date:** 2026-09-08  
**Author:** SuperK Core Engineering Team  
**Status:** Under Grilling & Review (`/grill-with-docs`)  
**Scope:** Chrome Extension Inpainting Pipeline & Reading View Overlay  

---

## 1. Problem Statement & Symptom

In the Chrome Extension reading view, when a reader triggers **"🪄 แปลภาพมังงะด้วย SuperK"** on a manga page, the Thai translated speech bubbles render correctly in position, but **the original text (e.g. English dialogue) remains fully visible underneath the Thai text**, causing overlapping text artifacts.

### Visual Evidence
- Target manga page renders Thai dialogue (`"เสียใจด้วยจริงๆ แต่คนที่คุณเคยดูถูก..."`) overlaid on top of original English dialogue (`"TERRIBLY SORRY, BUT THE PERSON..."`).
- No white boxes are present, but the inpainting cleaned background image is completely absent from the DOM (`.superk-clean-image` is not rendered).
- No error badge or retry banner was displayed, indicating the translation flow reported a false `TRANSLATION_SUCCESS`.

---

## 2. Reproduction & Verification

### Test Harness
Running `SuperKServer.inpaintImage()` with a real image against local SuperK (`127.0.0.1:3000`):

```javascript
const res = await SuperKServer.inpaintImage(
  { base64: sampleBase64, mimeType: 'image/png' },
  { serverUrl: 'http://127.0.0.1:3000' }
);
console.log('Job ID:', res.jobId, 'Clean Base64 length:', res.cleanImageBase64.length);
```

### Result
```text
Sending inpaint request...
Success! Job ID: 31d035d562824ba3b585b17a482b11ab Clean Base64 length: 0
```
- Job was successfully created on the FastAPI inpainting service (PID 42224).
- Job successfully detected and cleaned the glyphs.
- **However, `cleanImageBase64` returned with length `0` (empty string).**

---

## 3. Root Cause Analysis

Tracing the execution through `chrome-extension/server.js`:

### Root Cause 1: Asset Path Resolution Mismatch
1. When polling `/api/clean/v1/jobs/{id}/result`, the underlying cleaner service returns:
   ```json
   {
     "job_id": "31d035d562824ba3b585b17a482b11ab",
     "clean_asset": "/v1/jobs/31d035d562824ba3b585b17a482b11ab/assets/clean.png"
   }
   ```
2. The Next.js proxy route is mounted at `/api/clean/[...path]/route.ts`.
3. In `chrome-extension/server.js` (lines 207–210):
   ```javascript
   const assetUrl = cleanAssetPath.startsWith('http')
     ? cleanAssetPath
     : `${base}${cleanAssetPath.startsWith('/') ? '' : '/'}${cleanAssetPath}`;
   const assetRes = await fetch(assetUrl, { signal: AbortSignal.timeout(30000) });
   ```
4. When `base = "http://127.0.0.1:3000"`:
   - `assetUrl` resolves to: `http://127.0.0.1:3000/v1/jobs/.../assets/clean.png`
   - Next.js has no route for `/v1/jobs/...` (it only handles `/api/clean/v1/jobs/...`).
   - The fetch immediately fails with **HTTP 404 Not Found**.

### Root Cause 2: Silent Omission Instead of Fail-Loud
5. In `server.js` (lines 211–214):
   ```javascript
   if (assetRes.ok) {
     const assetBlob = await assetRes.blob();
     cleanImageBase64 = await this.blobToBase64(assetBlob);
   }
   ```
   When `assetRes.ok` is `false` (due to 404), the code does **not throw**. It silently returns `{ jobId, cleanImageBase64: "" }`.
6. In `chrome-extension/content.js` (lines 129–135):
   ```javascript
   if (cleanImageBase64) {
     // renders .superk-clean-image
   }
   ```
   Because `cleanImageBase64` is empty, no cleaned background is rendered, leaving the original artwork and text visible behind the translated text.

### Root Cause 3: Legacy `cleanMode` in Popup UI & Storage
7. In `chrome-extension/popup.html`:
   The `<select id="cleanMode">` only offered:
   - `solid` (ปิดข้อความเดิมด้วยพื้นขาว)
   - `stroke` (วางคำแปลโดยไม่ปิดภาพเดิม)
   It lacked `inpainting` (ลบข้อความต้นฉบับด้วย AI).
8. In `chrome-extension/popup.js` (line 23):
   ```javascript
   if (!['solid', 'stroke'].includes(settings.cleanMode)) settings.cleanMode = 'solid';
   ```
   If a user ever opened the popup and clicked save, `settings.cleanMode` was overwritten to `"solid"` or `"stroke"`, which either rendered white boxes or bypassed inpainting entirely.

---

## 4. Proposed Fixes & Architectural Decisions

1. **Robust Asset URL Resolution in `server.js`:**
   Inspect `cleanAssetPath`:
   - If `base` is the Next.js server (`:3000`) and `cleanAssetPath` begins with `/v1/`, normalize the URL to `${base}/api/clean${cleanAssetPath}`.
   - If calling direct FastAPI (`:8765`), keep `${base}${cleanAssetPath}`.
2. **Strict Invariant Assertion (Fail-Loud):**
   If `cleanMode === "inpainting"`:
   - The asset fetch must assert `assetRes.ok`. If non-200, throw a descriptive error.
   - `cleanImageBase64` must be non-empty. If empty, throw `Error("ไม่ได้รับข้อมูลภาพ cleanImageBase64 จากระบบ Inpainting")`.
   - Never allow a silent fallback to uncleaned text when the user expects inpainting.
3. **Align Popup & Storage Options:**
   - Update `popup.html` to include `<option value="inpainting" selected>ลบข้อความต้นฉบับเนียนกริบ (Inpainting - แนะนำ)</option>`.
   - Update `popup.js` to recognize and default to `inpainting`.
   - In `background.js`, prefer `synced.cleanMode` from SuperK server over stale extension local storage.

---

## 5. Grilling Frontier & Decision Tree

See interactive grilling session in discussion.
