# AI Working Notes — SuperK / Manga Translator

## Smart Desktop Launcher & One-Click App Bootstrapper — 2026-09-24

VERIFIED WORKING in automated test suites and real Windows Desktop runtime: Users can now double-click "SuperK Manga Translator" directly from their Windows Desktop to immediately open a clean, frameless App window (`--app=http://127.0.0.1:3000`). If local services (Python OCR `:8765` and Next.js `:3000`) are offline, the launcher bootstraps them silently in the background, waits for HTTP health verification, and opens the app without crashing or closing. Stale shortcuts (`start - Shortcut.lnk`) have been cleaned up.

Root cause of "ทำไมกดที่ดาวโหลดไว้เดสทอปแล้วมันปิดเอง" (Desktop shortcut closes itself when clicked):
1. **PWA Dependency on Offline Local Server**:
   - The desktop shortcut was a Chrome PWA shortcut (`chrome_proxy.exe --app-id=hbblfifohofgngfbjbiimbbcimepbdcb`).
   - When the user clicked it while the Next.js server (`:3000`) was stopped, Chrome failed to connect (`ERR_CONNECTION_REFUSED`) and immediately closed the app window.
2. **Batch Script Flashing & Premature Exit**:
   - `start - Shortcut.lnk` executed `start.bat`, which handed off execution to VBScript and ended with `exit /b 0`, causing a black CMD window to flash for 0.1 seconds and disappear, giving the illusion of a crashed program.

Fixes applied:
- `SuperK-Launcher.vbs`:
  - Self-healing port readiness check (`CheckUrl("http://127.0.0.1:3000")` and `CheckUrl("http://127.0.0.1:8765/health")`).
  - Silently spawns `uvicorn` and `npm run dev` if offline, with polling wait (up to 30s) until ready.
  - Detects Chromium installations (Chrome, Edge, Brave) and launches with `--app=http://127.0.0.1:3000` (or system default browser fallback).
  - Configures drive `F:\` cache directories automatically if present.
- `scripts/create-desktop-shortcut.mjs`:
  - Automates creation of `C:\Users\PC\Desktop\SuperK Manga Translator.lnk` targeting `SuperK-Launcher.vbs` via `wscript.exe` with `public/app-icon.ico`.
  - Cleans up legacy/stale `start - Shortcut.lnk`.
- `start.bat`:
  - Updated to delegate cleanly to `SuperK-Launcher.vbs`.
- `tests/scripts/desktopLauncher.test.ts`:
  - Automated tests validating launcher existence, port check targets, and shortcut configurations.

Verification evidence:
- TypeScript check: `npx tsc --noEmit` — **0 errors**.
- Launcher test suite: `npx vitest run tests/scripts` — **1 file / 3 tests passed**.
- Translation test suite: `npx vitest run tests/translation` — **30 files / 177 tests passed**.
- Workspace test suite: `npx vitest run tests/workspace` — **11 files / 48 tests passed**.
- Unit test suite: `npx vitest run tests/unit` — **11 files / 76 tests passed**.
- Desktop Shortcut: Verified TargetPath `C:\Windows\System32\wscript.exe`, Arguments `"C:\Users\PC\Downloads\manga-translator\SuperK-Launcher.vbs"`, Icon `public/app-icon.ico`.

## Live Queue Concurrent Review Retry & Auto-Proceed on Review — 2026-09-24

VERIFIED WORKING in automated tests and system integration: Users can now confirm and translate pages flagged as "Awaiting Review" immediately via "🔄 ยืนยันและดำเนินการแปลต่อ" without being locked out while a batch translation is currently running in the background. In addition, an "Auto-proceed on Review" toggle allows batch translation to proceed automatically without halting for review.

Root cause of "เราทำให้กดแปลตรงนี้พร้อมกับที่กำลังแปลพร้อมกันเลยได้ไหม" (Unable to click translate in failure modal while batch is translating):
1. **Hard Lock Guard in `handleTranslateAll`**:
   - `retryFailureGroup()` called `handleTranslateAll(pageIndices)` upon user clicking "🔄 ยืนยันและดำเนินการแปลต่อ".
   - `handleTranslateAll` checked `if (translationOperationLockRef.current || isTranslating || isTranslatingAll) return;`.
   - Because the batch was actively translating the subsequent pages, `isTranslatingAll` was `true`, causing the retry attempt to silently return without doing anything.
2. **Review Halting in Batch Pipeline**:
   - Encountering `preparedPage.awaitingReview && !isTargetedRetry` threw a `CleaningClientError(422)`, prematurely halting translation of that page into `batchFailures` under `CLEANING_REVIEW_REQUIRED`.

Fixes applied:
- `hooks/useTranslation.ts`:
  - Added `executeConcurrentRetry` to `retryFailureGroup` and `retryFailedPages`: when `isTranslatingAll` is active, immediately clears retried pages from `batchFailures`, marks them in `userApprovedReviewPagesRef`, and runs concurrent background translation without locking conflicts.
  - Added `autoProceedOnReview` preference and setter (persisted in `localStorage` under `superk:auto-proceed-review`) and exported `reviewFlaggedPages`. When enabled, pages with `awaitingReview` are not halted with 422 error, but proceed straight to translation.
- `components/workspace/SettingsModal.tsx`:
  - Added `autoProceedOnReview` toggle switch with accessible role and label "เปิด/ปิดการแปลต่อเนื่องอัตโนมัติ" under Translation options.
- `src/app/page.tsx`:
  - Connected `autoProceedOnReview` and `setAutoProceedOnReview` from `useTranslation` into `SettingsModal`.
- Tests:
  - `tests/translation/useTranslation.test.tsx`: Added tests verifying `autoProceedOnReview: true` auto-translates without error and `retryFailureGroup` executes concurrently while `isTranslatingAll: true`.
  - `tests/workspace/SettingsModalAutoProceed.test.tsx`: Added integration test for settings toggle.

Verification evidence:
- TypeScript check: `npx tsc --noEmit` — **0 errors**.
- Translation test suite: `npx vitest run tests/translation` — **30 files / 177 tests passed**.
- Workspace test suite: `npx vitest run tests/workspace` — **11 files / 48 tests passed**.
- Unit test suite: `npx vitest run tests/unit` — **11 files / 76 tests passed**.
- Integration test suite: `tests/workflow/WorkspacePage.test.tsx` — **12/12 passed**.

## Clothing & Artwork Text Protection (Preventing Inpaint Erasure on Apparel/Illustrations) — 2026-09-24

VERIFIED WORKING in real user manga workload and automated test suites: Text printed on clothing (e.g. Japanese kanji on shirts/sweaters like "元天才"), signs, and embedded artwork illustrations is now strictly PRESERVED by default under `SFX_POLICY` / `LOW_CONFIDENCE` review, preventing the inpainting cleaner from wiping out non-dialogue artwork elements into flat fabric. Genuine speech balloons and boxed narration cards continue to be cleaned and translated as expected.

Root cause of "มันยังลบตัวหนังสือบนเสื้อผ้าหรือที่อื่นที่ไม่ข้อความอยู่" (Erasing text on clothing / illustrations):
1. **Bounding Box Crop-Rectangle Artifact in `_backing_shape_scores`**:
   - `_backing_shape_scores()` in `ocr-service/app/text_eligibility.py` thresholds `gray < 180` to find dark balloons/enclosures.
   - For characters wearing dark clothing (sweaters, hoodies, t-shirts), the dark fabric fills the entire cropped search window (`shape_padding = 35%` on all sides).
   - The contour of the dark fabric touched all four window borders: `x=0, y=0, width=156, height=120` (filling 96.6% of the crop).
   - Because `cv2.approxPolyDP` was run on this boundary, it approximated the 4 corners of the cropped search window as a 4-vertex polygon (`vertices <= 4`).
   - `_backing_shape_scores` erroneously set `rectangular_backing = 0.92`, mistaking the rectangular cropped frame itself for a bounded manga narration caption card!
2. **Narration Classifier Priority & Overly Broad Uniformity**:
   - In `classify_eligibility()`, the narration check evaluated before SFX/artwork text.
   - Any region with `backing_uniformity >= 0.55` (typical of smooth solid-colored fabric) was automatically tagged `TextRole.NARRATION` with `action = AutomaticAction.CLEAN`, completely bypassing SFX checks even when surrounded by artwork edges (`artwork_edge_density >= 0.35`).
3. **SFX Uniformity Gate Block**:
   - In `_sfx_decision()`, the constraint `and features.backing_uniformity < 0.55` disqualified text printed on solid/smooth fabric from being recognized as SFX, despite being illustrated artwork text.

Fixes applied:
- `ocr-service/app/text_eligibility.py`:
  - `_backing_shape_scores()`: Added bounded crop check. If a contour spans all 4 borders of the crop window or covers `>= 85%` of the crop area, it is identified as continuous background/clothing rather than an isolated balloon/caption box and is discarded.
  - `classify_eligibility()`:
    - Bounded rectangular caption boxes (`features.rectangular_backing >= STORY_BACKING_THRESHOLD`) remain cleanable narration.
    - If text lacks a rectangular box and has artwork edges (`has_sfx_features and features.margin_fraction < 0.50`), it is routed to `_sfx_decision()` (default `AutomaticAction.PRESERVE`) instead of being misclassified as narration.
    - Borderless narration now requires clean uniform space (e.g. margin or absence of artwork edges).
  - `_sfx_decision()`: Removed `features.backing_uniformity < 0.55` restriction so illustrated text on smooth fabrics is preserved with `SFX_POLICY`.
- `ocr-service/tests/test_text_eligibility.py`:
  - Added `test_clothing_text_with_artwork_edges_is_preserved()` verifying that uniform-backed text with artwork edges is preserved.
  - Added `test_dark_clothing_spanning_crop_is_not_treated_as_enclosure()` verifying that crop-spanning dark regions do not yield false rectangular/enclosure scores.
- Service restart: Reloaded `ocr-service` on port 8765.

Verification evidence:
- Python OCR test suite: `ocr-service\venv\Scripts\pytest.exe ocr-service\tests` — **182 passed, 3 skipped** (100% pass rate).
- Targeted eligibility test suite: `test_text_eligibility.py` — **24/24 passed**.
- Real user workload verification:
  - Submitted user's real scan (`media_1790181445179.png`) to live OCR backend job (`d753cd0516ef4d34938395c94e5a6030`).
  - Region on chest (`rect=(120, 219, 92x56)`): shifted from `(narration, clean, confidence 0.92)` -> `(review, preserve, confidence 0.38)`.
  - Visual output verification (`debug_clean_result_verified.png`): "元天才" text on sweater was 100% preserved and untouched, while yellow speech balloons at the top were cleanly wiped and ready for translation.
- Frontend test suite: `npx vitest run tests/cleaning` — **11 files / 91 passed**.
- TypeScript typecheck: `npx tsc --noEmit` — **0 errors**.

## Mobile & Small-Screen Tools Menu Accessibility (`WorkspaceAdvancedTools`) — 2026-09-23

VERIFIED WORKING in automated tests and system integration: The "เครื่องมือ" (Advanced Tools) dropdown and full toolset are now accessible on small screens, laptops with display scaling, tablets, and mobile viewports.

Root cause of "ตอนนี้จอเล็กไม่มีเครื่องมือให้เลือก" (On small screen there are no tools to choose from):
1. **Desktop-Only Header Guard**: The desktop controls container (`data-workspace-header-desktop`) was conditioned on `hidden lg:flex`. Any viewport width `< 1024px` completely hid desktop controls, including the `<WorkspaceAdvancedTools>` component (`[ 🔧 เครื่องมือ ▾ ]`).
2. **Missing Tools in Mobile Header & Drawer**:
   - `data-workspace-header-mobile` only rendered `WorkspacePrimaryAction` and the hamburger button `[ ☰ ]`. The "เครื่องมือ" button was entirely omitted.
   - Inside the mobile hamburger drawer, `WorkspaceAdvancedTools` actions (`แปลหน้านี้ใหม่`, `คลีนข้อความใหม่`, `แก้ Mask`, `ลองใหม่ N หน้าที่พลาด`) were also missing.
3. **Export Trigger Breakpoint Mismatch**: In `handlePrimaryAction()`, when `primaryAction.kind === "export"`, the condition `window.innerWidth < 768` triggered mobile menu, but between 768px and 1024px it attempted to trigger `exportTriggerRef.current?.click()` on the hidden desktop export button.

Fixes applied:
- `src/app/page.tsx`:
  - Rendered `<WorkspaceAdvancedTools>` directly inside `data-workspace-header-mobile` when `pages.length > 0`, ensuring the `[ 🔧 เครื่องมือ ▾ ]` button is always visible on small screens.
  - Added a dedicated `🛠️ เครื่องมือ` section and `แปลหน้านี้ใหม่` button in the mobile drawer (`isMobileMenuOpen`) for touch-friendly full access.
  - Updated `handlePrimaryAction()` export trigger check to `window.innerWidth < 1024` matching the responsive breakpoint.
- `tests/workflow/WorkspacePage.test.tsx`:
  - Added integration test `renders tools menu on mobile header and inside mobile drawer when pages are present` verifying both top bar tools and drawer tools.

Verification evidence:
- TypeScript check: `npx tsc --noEmit` — 0 errors.
- Vitest workspace/workflow/unit suites: **26 test files / 157 tests passed**.
- Vitest WorkspacePage suite: `tests/workflow/WorkspacePage.test.tsx` — **12/12 passed**.

## Session Restore Cleaned Image Persistence (IndexedDB Blob Store) — 2026-09-23

VERIFIED WORKING in automated tests and system integration: Restoring saved sessions ("📂 คืนค่างานเดิม") now fully restores cleaned manga artwork alongside translated speech bubbles.

Root causes of "มีแต่คำแปล การคลีนไม่กลับมา" (Translated bubbles present, but cleaned background missing):
1. **Volatile Backend Job Lifecycle**: Previously, `saveCleaningResultMetadata()` only stored Python `jobId` in IndexedDB. Upon server restart or temporary folder eviction in the Python cleaner service (`http://127.0.0.1:8765`), fetching `/api/clean/jobs/{jobId}/result` failed with HTTP 404, causing cleaning restore to fail silently.
2. **PageViewer Fallback Fall-Through**: In single-page mode (`components/workspace/PageViewer.tsx`), when `currentCleaningResult` was missing from active hook state, the viewer fell back to `currentPageItem.url` (raw original scan) while `applyTranslationOverlay` rendered translated Thai text on top of the original text.
3. **Workspace Layer Default**: On session restore, `workspaceLayer` remained set to `"original"`, keeping the cleaned layer hidden unless manually toggled.

Fixes applied:
- `lib/projectStore.ts`:
  - Extended `StoredCleaningResult` with binary asset IDs: `cleanAssetId`, `maskAssetId`, `reviewMaskAssetId`, `protectedMaskAssetId`, plus dimensions and timings.
  - Added `saveCleaningAssets()` to persist binary Blobs (`cleanBlob`, `maskBlob`, etc.) directly into IndexedDB (`assets` object store) keyed deterministically by page URL (`clean_${encodeURIComponent(pageUrl)}`).
  - Added `loadCleaningResultAssets()` to retrieve persisted Blobs.
  - Hardened `loadAsset()` to prevent jsdom/Node prototype mismatches from re-wrapping valid Blobs into `[object Object]`.
- `hooks/useCleaning.ts`:
  - Extended `PageCleaningResult` with binary Blobs (`cleanBlob`, `maskBlob`, `reviewMaskBlob`, `protectedMaskBlob`).
  - Updated `finishJob()` to persist Blobs to IndexedDB and record asset IDs in metadata.
  - Implemented an IndexedDB **Fast Path** in the restore `useEffect`: checks `loadCleaningResultAssets(metadata)` first; if Blobs exist locally, creates object URLs and restores the clean result immediately without network calls to the Python backend.
- `components/workspace/PageViewer.tsx`:
  - Added fallback check to `cleaningResultsByPage.get(currentPageItem.url)?.cleanUrl` in single-page mode so the cleaned background renders reliably even during state hydration.
- `src/app/page.tsx`:
  - Updated "📂 คืนค่างานเดิม" handler to automatically set `setWorkspaceLayer("translated")` when restoring a session containing translations.

Verification evidence:
- TypeScript check: `npx tsc --noEmit` — 0 errors.
- Cleaning test suite: `vitest run tests/cleaning` — **11 files / 91 tests passed** (including new `saves and loads cleaning image assets and metadata from IndexedDB` and `restores cleaning result directly from IndexedDB assets without contacting cleaning service`).
- Workspace test suite: `vitest run tests/workspace` — **10 files / 46 tests passed**.
- Translation test suite: `vitest run tests/translation` — **30 files / 175 tests passed**.

## Gemini fixed routing ("แบบเดิม") with full 8-key pool & latency fix — 2026-09-23

VERIFIED WORKING in real manga workload: Restored classic fixed `requestGemini` baseline with all 8 user keys, fixed key-rotation bug on HTTP 503, prioritized fast keys, and reduced translation latency from 164s down to 36.9s.

Root cause of high translation latency (164s):
1. **Global Peak Hours at Google**: At ~22:50 TH (15:50 UTC), Google AI Studio servers experienced peak traffic:
   - `gemini-3.8-flash`: HTTP 503 (High Demand)
   - `gemini-3.7-flash`: HTTP 503 (High Demand)
   - `gemini-3.6-flash`: HTTP 503 after hanging for 27.5s
2. **Per-Key Latency Disparity**: Real probe showed Key 1 (`AIzaSyDS...`) took 101.9s due to project congestion, whereas Key 2 (`AIzaSyBL...`) completed in 21.4s!
3. **Key-Loop Bug on 503**: In `requestGemini()`, receiving HTTP 503 executed `break keyLoop` instead of advancing to `keyOffset += 1`. This prematurely abandoned `gemini-3.5-flash-lite` on all remaining 7 keys, cascading down into models experiencing 503 and timeouts (accumulating 164s total wait).

Fixes applied:
- `lib/server/geminiRequest.ts`: Added `response.status === 500 || response.status === 503` to `keyLoop` key-advancing logic so other keys in the pool are attempted before abandoning the model.
- `.env.local`: Reordered `GEMINI_API_KEY` to place the fastest key (`AIzaSyBL...`, 21s) first.
- Server restarted and verified.

Verification evidence:
- Latency benchmark on real manga page (`compare_page_34.jpg`): Dropped from **164.0s** to **36.9s** (**4.4x faster**), returning **HTTP 200** with **10 translated bubbles**.
- TypeScript `tsc --noEmit` & Vitest `tests/translation`: **30 files / 175 tests passed**.


## Extended image format support (415 fix) — 2026-09-22

VERIFIED WORKING in automated tests: OCR cleaning backend now accepts GIF, AVIF, BMP, TIFF, MPO, JFIF, and legacy MIME aliases (`image/jpg`, `image/pjpeg`, `image/x-png`, `image/x-ms-bmp`) in addition to the original PNG/JPEG/WEBP. Frontend cleaning client (`lib/cleaning/client.ts`) MIME fallback mapping extended to match.

Root cause: user's manga scans included non-standard image formats (e.g. AVIF, BMP, TIFF) that PIL can decode to RGB without issue, but the OCR API's `SUPPORTED_MEDIA_TYPES` whitelist and the frontend's MIME fallback logic rejected them with HTTP 415 before they ever reached the image decoder. This caused 26-page batch failures where the cleaning pipeline refused to start.

Files changed:
- `ocr-service/app/api.py` — expanded `SUPPORTED_MEDIA_TYPES` and `SUPPORTED_FORMATS`
- `lib/cleaning/client.ts` — expanded extension→MIME fallback mapping
- `ocr-service/tests/test_api.py` — added `test_upload_accepts_gif` and parametrized `test_upload_accepts_extended_formats`

Verification evidence:
- Python backend: `pytest tests/test_api.py` — **22/22 passed** (including new format tests)
- Frontend: `vitest run tests/cleaning/client.test.ts` — **4/4 passed**
- TypeScript: `npx tsc --noEmit` — **passed**
- OCR backend restarted with updated code, health check OK
- Real-workload verification: pending user retest


## SFX default policy → PRESERVE — 2026-09-22

VERIFIED WORKING in automated tests: SFX-classified text regions (artwork text, clothing text, sound effects drawn on artwork) are now PRESERVE by default with `SFX_POLICY` protection reason. They are detected and labeled as `TextRole.SFX` but **not** automatically cleaned or translated. Users can still override with `force-clean` per-region if desired.

This prevents the system from removing text drawn on clothing, signs, or artwork backgrounds that should remain as part of the original illustration — like Japanese characters on T-shirts.

Files changed:
- `ocr-service/app/text_eligibility.py` — `_sfx_decision()` now returns `PRESERVE` + `SFX_POLICY` instead of `CLEAN`
- `ocr-service/tests/test_text_eligibility.py` — updated 3 tests to expect new SFX behavior

Verification evidence:
- Text eligibility + pipeline tests: **30/30 passed**
- Full OCR backend suite: **180 passed, 3 skipped**
- Real-workload verification: pending user retest


## Monochrome pure-black policy — 2026-09-22

Current user decision supersedes earlier monochrome exceptions below: every automatic text category (dialogue, narration, SFX, overlay subtitle), including Readable and Source-faithful modes, uses black fill with no outline, shadow, glow, gradient or background plate on confirmed monochrome pages (confidence >= 0.85). Manual styles remain authoritative; color and unconfirmed pages keep their existing behavior. Web preview/export share the resolver; Extension direct/server/restored overlays use the same policy. Black text may be difficult to read on dark artwork; there is no automatic contrast outline under this explicit policy.

Verification: previous behavior failed 9 updated regression cases. Focused color/Extension/overlay/export suite passed 45 files / 334 tests before expanding Extension category coverage; TypeScript passed. No manual browser verification performed.


## Text editing follow-up — 2026-09-21

VERIFIED WORKING in automated tests: leaving the entire live editor via keyboard commits once without stealing focus; saved empty bubbles retain selectable geometry after overlay reconstruction. Internal focus changes do not commit. Explicit save/cancel and deleted-bubble filtering remain intact.

Evidence: two failing regressions reproduced before the fix; final full suite 139 files / 839 tests passed; TypeScript and scoped whitespace check passed. Real-browser interaction has not been manually verified. See `docs/postmortems/2026-09-21-text-editor-focus-and-empty-text.md`.

> **Purpose:** This file records approaches that were actually tried in this repository, what worked in the user's real workflow, what regressed, and what is intentionally paused. Future AI agents should read this before changing translation, Gemini routing, masking, or desktop packaging behavior.
>
> **Last updated:** 2026-09-21

## Current product direction

- **Primary target: Web App.** Continue treating the web version as the main product.
- **Windows Desktop / Electron / NSIS installer: PAUSED.** The desktop build was successfully produced, but the user explicitly decided to park the desktop-program direction for now. Do not spend time on Electron, portable Python runtime, or installer work unless the user explicitly asks to resume it.
- Do not delete paused desktop code just because it is not the active direction. Preserve it for possible future reuse.

## Gemini translation — current known-good baseline

### VERIFIED WORKING: fixed `requestGemini` routing for image translation

The user reported that translation stopped working after the dynamic Gemini catalog/router was placed on the live translation path. We reproduced the routing difference, restored the previous fixed-routing behavior, and the user then confirmed that translation worked again.

Current image translation path:

`hooks/useTranslation.ts` → `POST /api/translate` → `requestGemini()`

Auto uses a fixed model hierarchy and rotates API keys through `requestGemini` instead of planning routes through `GeminiCatalogManager`.

Current Auto order in `src/app/api/translate/route.ts`:

1. `gemini-3.5-flash-lite`
2. `gemini-3.8-flash`
3. `gemini-3.7-flash`
4. `gemini-3.6-flash`
5. `gemini-3-flash`
6. `gemini-3.5-flash`
7. `gemini-3.1-flash-lite`

Retry mode puts the higher-precision models first, but still uses the same fixed/direct routing mechanism.

API keys remain comma-separated internally. A user-supplied key string takes precedence over `GEMINI_API_KEY`; otherwise the server key(s) are used. The two-key fixed-routing path is covered by regression tests.

### VERIFIED WORKING: fixed routing for text translation

`POST /api/translate-text` also uses `requestGemini()` with the fixed current-model list rather than `executeGeminiTranslation()`.

### VERIFIED WORKING: direct API-key validation probe

`POST /api/translate/validate-key` currently validates through `requestGemini()` with `gemini-3.8-flash` rather than validating through dynamic `models.list` discovery.

### Verification evidence after rollback

- TypeScript: `npx tsc --noEmit` — passed.
- Focused translation/request tests — **22/22 passed**.
- Full `tests/translation` suite — **29 files / 142 tests passed**.
- Most important evidence: **the user tested the real translation workflow after rollback and confirmed it works again.**

## Gemini dynamic discovery/router — experimental, not the live translation baseline

The dynamic implementation still exists in the repository, including:

- `lib/server/geminiCatalog.ts`
- `lib/server/geminiTranslationRouter.ts`
- `/api/translate/models`
- dynamic catalog-related Settings/Extension code and tests

This work successfully demonstrated several things in isolation: `models.list` discovery, multi-key union catalog, model→key mapping, compatibility learning, cooldowns, last-known-good state, and real API discovery across multiple keys.

However, **do not re-enable `executeGeminiTranslation()` on the main image/text translation path by default.** After that architecture was enabled, the user's real manga workload stopped translating reliably. The observed UI reported four affected pages and a Google Safety Filter failure. We did **not** prove that dynamic discovery itself caused Google's safety decision, so do not write a false RCA claiming that. What is proven operationally is:

- Dynamic-routing version was active when the real workload failed.
- Fixed-routing version was restored.
- The same user workflow worked again after rollback.

Therefore the fixed route is the current production baseline.

### If dynamic routing is revisited later

Do it behind a feature flag or isolated branch first. Before replacing the fixed route, require all of the following:

- same real image workload passes end-to-end;
- Auto translation succeeds repeatedly, not just text-only probes;
- Safety-filter behavior is compared before/after with the same images;
- timeout/fallback behavior is measured;
- user-key and server-key behavior is verified;
- fixed routing remains an immediate rollback path.

Do not treat passing mocked catalog tests as sufficient evidence for replacing the known-good image path.

## Important model-routing caveats

- The dynamic Settings model catalog may still be present in the UI. **Do not assume the model catalog is the source of truth for Auto translation routing right now.** Auto translation currently uses the fixed list above.
- Manual model selection passes the selected model ID to the fixed route. Models outside the known-good fixed list are not broadly live-verified and may fail even if discovery exposes them.
- Real API experiments previously showed that a model appearing in `models.list` does not guarantee successful `generateContent` for this workload. For example, a discovered model returned 404 when actually invoked, and another model timed out. Treat discovery as availability metadata, not proof of translation compatibility.
- Keep Gemini API keys out of logs, URLs, diagnostics, and committed files.

## Safety Filter / NSFW behavior

- The app has an NSFW/Comic Slicing bypass path in `hooks/useTranslation.ts` that slices the image into a 3×2 grid and translates the six pieces.
- Do not remove or redesign this path while working on model routing unless a reproducible bug specifically points to it.
- A Google Safety Filter response is an upstream content decision. Do not automatically label the API key, model, or local cleaning pipeline as broken without reproducing and tracing the request path.

## Mask / cleaning behavior

### VERIFIED FIXED: deleting a mask must actually stop that area from being cleaned

A prior regression caused removed mask areas to remain cleaned because FORCE_CLEAN started from an already-inpainted image and merged the old mask back in.

The fix in `ocr-service/app/pipeline.py` changed the behavior so the approved/selected mask authorizes the final removal region, removed areas are restored from the source, and an empty approved mask removes nothing.

That fix was covered by backend and frontend regression tests. Do not reintroduce old-mask union behavior without a new explicit requirement.

## Overlay edit persistence — validated 2026-09-20

### VERIFIED WORKING: move/resize/rotation/font-size edits survive page remounts

The web workspace previously split translated-bubble state between two persistence paths: `fontSizeMultiplier` lived on `TranslatedBubble`, while move/resize/rotation geometry lived only in `superk:overlay-adjustments` localStorage. Imported image pages are represented by durable base64 data URLs, and the full page URL was used as the localStorage object key. That made geometry persistence depend on storing a potentially multi-megabyte key; `saveOverlayAdjustments()` silently catches quota failures, so a page remount could fall back to the original OCR box.

Current contract:

- `TranslatedBubble.layoutAdjustment` is the authoritative persisted geometry for move/resize/rotation.
- `TranslatedBubble.fontSizeMultiplier` remains the authoritative per-bubble font-size override.
- `saveAdjustment()` writes geometry back to the bubble before marking the page dirty, so the existing IndexedDB bubble-session autosave carries the edit.
- Page restore prefers `bubble.layoutAdjustment`; localStorage is only a legacy fallback.
- Long page keys (including `data:image/...` URLs) are compacted before fallback localStorage writes, while old raw keys are still readable for compatibility.

Verification evidence:

- TDD regression reproduced the bug before the fix: session-style JSON roundtrip had no geometry, and fallback localStorage contained the full data URL.
- Focused overlay regression: **18/18 passed** after the fix.
- Focused overlay/session/export persistence set: **35/35 passed**.
- Full Vitest suite: **141/141 files, 846/846 tests passed**.
- `npx tsc --noEmit`, scoped ESLint, `git diff --check`, and `npm run build`: passed.

## Desktop build history — successful but paused

The Windows installer pipeline was successfully verified before the desktop direction was paused:

- TypeScript passed.
- Full test suite at that point: **128/128 files, 764/764 tests**.
- Next.js production build passed.
- NSIS installer was generated successfully at `dist/desktop/SuperK-Windows-Setup.exe`.
- Installer was unsigned, so Windows SmartScreen could warn about an unknown publisher.

This is historical verification only. It does not mean desktop packaging should be maintained as the active product path.

## Rules for future AI agents

1. **Preserve a known-good path before replacing it.** For risky routing changes, add a feature flag or a narrow switch first.
2. **Real user workload outranks mock-only success.** A green unit test for Gemini discovery is not enough to replace translation behavior the user has confirmed works.
3. **Do not infer causality from correlation.** Record exactly what failed, what changed, and what recovered; do not invent a root cause that was not proven.
4. **Before changing Gemini routing, compare against this file and the current route implementation.** If the requested change contradicts the known-good baseline, explain the tradeoff and preserve rollback.
5. **Do not reset or discard unrelated dirty work.** This repository frequently contains multiple in-progress workstreams.
6. When a new approach is tested, update this file with one of these states: `VERIFIED WORKING`, `KNOWN REGRESSION`, `EXPERIMENTAL`, `PAUSED`, or `NOT VERIFIED`, plus the exact validation evidence.

## Text color / outline behavior — validated 2026-09-16

### VERIFIED WORKING: confidence-aware source-colored outline

The intended Auto behavior is now:

- When source-color evidence is admitted and confidence is high (>= 0.80), use the detected source accent color directly as the translated text outline.
- Medium-confidence source color may still be strengthened for readability after the evidence gate.
- Rejected/weak candidates (including background contamination or insufficient evidence) must not leak back into the outline color; fall back to a safe dark outline instead.
- Manual styling remains authoritative.

Verification evidence:

- `tests/colorMatching`: **26 files / 194 tests passed**.
- `npx tsc --noEmit`: passed.

This specifically prevents a color sampled from panel/background artwork from being reused as the translated outline after the evidence gate rejected that sample.

## Translated text shadow behavior — validated 2026-09-17

### VERIFIED WORKING: uniform proportional shadow across render surfaces

ADR 0015 is the current rendering contract for translated-text shadow behavior:

- Auto, Auto → Readable fallback, explicit Readable, Source-faithful, and ordinary dialogue all render the same Standard Shadow: `#1e1e1e`, opacity `0.80`, blur ratio `0.15`, offset-X/Y ratio `0.08`, scaled by rendered font size.
- Detected source `shadow`, `glow`, and legacy `readabilityHalo` remain source/profile evidence but do not control automatic final rendering.
- Automatic readability no longer adds a per-bubble halo; readability escalation must not make one region look more shadowed than another.
- Source-colored outline remains independent from the neutral Standard Shadow.
- Manual text defaults to Standard Shadow and may explicitly select `Off`; changing other Manual style properties does not implicitly toggle shadow.
- Legacy project metadata is preserved rather than destructively migrated.
- Web canvas preview/export and Chrome Extension overlays consume equivalent Standard Shadow semantics. Cached Extension overlays are re-rendered through the same current rule.

Verification evidence:

- Focused Uniform Shadow / overlay / Extension regression set: **60/60 passed**, followed by cached/restored Extension + ownership persistence **12/12 passed**.
- Full Vitest suite: **133/133 files, 794/794 tests passed**.
- `npx tsc --noEmit`: passed after the final implementation changes.
- Source-effect sampling coverage remains green, so source shadow/glow evidence extraction was not removed.

### VERIFIED WORKING: authentic monochrome manga text style (ADR 0016)

ADR 0016 introduces a narrow exception to ADR 0015 specifically for confirmed monochrome manga pages:

- Page-level classifier (`analyzeMonochromePage` / `analyzeImageElementMonochrome`) evaluates the pre-clean original source image once per page using deterministic grid subsampling (up to ~20,000 samples).
- When `isMonochromePage === true` and `monochromeConfidence >= 0.85`:
  - Dialogue/narration fill is always crisp black (`#000000`); automatic fill color detection cannot turn it white or colored.
  - White/light speech balloons: no automatic shadow/glow/halo and no outline by default.
  - Dark or strongly mixed grayscale backgrounds: keep black fill and add only a thin white outline (bounded to <= 0.08 of font size) for readability; never switch the fill to white.
  - Manual styling remains the only override above the monochrome policy.
- Manual user styling (`ownershipMode === 'manual'`) retains absolute authority; Manual Standard keeps standard shadow and Manual Off has no shadow.
- Color pages, low-confidence pages, and unconfirmed pages retain ADR 0015 Uniform Shadow.
- Full parity across Web Preview Canvas, Image Export, Extension Server Mode, Extension Direct Mode, and restored Chrome local-storage caches.
- 2026-09-21 verification after the stricter black-fill policy: monochrome classifier/enrichment/shadow/Extension/overlay set **56/56 passed**; `npx tsc --noEmit`, scoped ESLint, and `git diff --check` passed.

## Workspace UI / Settings — validated 2026-09-21

### VERIFIED WORKING: UI V2 responsive controls and Settings model picker

- Desktop header activates at `lg`; compact/mobile controls are used below that breakpoint, secondary branding/save text waits until `xl`, and primary/menu labels do not wrap.
- Settings is widened and card-grouped with live typography preview and debounced color commits so dragging native color controls does not trigger heavy workspace-wide updates on every event.
- Model Preference uses a bounded searchable listbox inside Settings instead of the oversized native select. It only offers catalog entries available on at least one current key and not marked image-incompatible; Auto remains available.
- Expanded filmstrip no longer covers the zoom toolbar/page badge; those controls move above the filmstrip.

Verification evidence:

- UI/Settings focused regression sets passed during implementation (up to **44/44** and **43/43** depending on the focused set).
- Real browser smoke: 931px header had no horizontal overflow; Settings model list stayed inside the 480px panel with internal scrolling; rapid color preview changes remained responsive.
- TypeScript, scoped ESLint, and `git diff --check` passed after the UI work.

### NOT VERIFIED / currently unreliable: `gemini-3.6-flash` for image translation

A live probe through SuperK's actual `/api/translate` image path did not establish `gemini-3.6-flash` as reliable. Repeated attempts timed out or returned `Unable to process input image`. This is not evidence that the model is permanently unavailable; keep it out of any "verified usable" claim until a later health probe succeeds. The Settings picker may still expose it when the live catalog reports availability, but it must be visibly labeled `Experimental / Unstable` with an image-translation stability warning so manual selection remains possible without implying verification.

A broader live probe of the discovered catalog confirmed that discovery alone is not proof of image-translation compatibility. Several models returned 200 successfully, while others failed because of deprecation, modality mismatch, quota, high demand, or timeout. Do not promote catalog discovery metadata to production-routing authority without real image probes.

### VERIFIED WORKING: translate-all stopwatch replaces ETA

- Translate-all progress no longer predicts remaining time from rolling page averages.
- The UI shows a live stopwatch for the current page and a separate total batch elapsed clock.
- Current-page processing time excludes deliberate retry/cooldown waits so model/cleaning performance is not inflated by scheduled waiting.
- Successful completion messages include the actual total elapsed wall-clock time.
- Retry/cancel/quota behavior remains unchanged; only time reporting changed.

Verification evidence:

- Focused translation/workspace regressions cover live elapsed updates and confirm ETA wording is absent.
- Verification: full `tests/translation` plus workspace timing coverage — **31 files / 157 tests passed**; `npx tsc --noEmit` passed; scoped lint of changed surfaces passed with 0 errors after excluding known pre-existing React Compiler debt rules; `git diff --check` passed.

## Health-aware Gemini routing implementation — 2026-09-23

### EXPERIMENTAL: shared image routing and fallback

- The implementation-ready specification is `.scratch/health-aware-gemini-routing/spec.md`, with seven ordered tickets in its `issues/` directory. The working tree already contained shared-router, health, Settings, browser retry, and Extension changes when this implementation pass began; those edits were preserved.
- A new failing route-order test showed that fresh Last-known-good ranking could put a server-owned route before all user-owned routes. Auto now keeps user-owned routes ahead of server fallback routes. A second failing test showed that model-wide skip missed server routes when ownership ordering separated keys for the same model; the runner now skips every remaining route for that model.
- New deadline tests showed that provider fetch and catalog discovery could hang past their abort signal if the underlying promise ignored cancellation. Both now race provider work against explicit deadlines. A budget expiry releases any claimed half-open trial; only clear high demand renews the model cooldown. A generic `502` now receives one same-route retry. Provider and transport error messages redact the active raw key.
- The first full Vitest run reported **3 failures / 868 tests** in older Extension tests that still expected the removed fixed Direct-mode hierarchy. The tests were updated to assert shared-server routing when available and dynamic discovery only for offline Direct mode; the affected files then passed **12/12**. This is test-contract migration, not evidence of a production image translation probe.
- Independent spec and standards reviews found retry timing, recovery ownership, HTTP-success validation, Extension timeout fallback, and Manual recovery gaps; each was addressed with a focused failing test and passing rerun. Auto status now gives a truthful fallback-policy message during the pending request; exact route-switch events are not streamed to the browser.
- Final verification: **140/140 Vitest files and 874/874 tests passed**, `tsc --noEmit` passed, focused ESLint on routing modules/image API/routing tests passed, and `git diff --check` passed. Broad ESLint still reports existing React hook and legacy-test `any` violations.
- **Real manga workload validation remains outstanding.** These deterministic tests prove route policy and local API behavior, but do not establish that the newly discovered models succeed on the user's image workload. Keep the immediate rollback path available until that check succeeds.

### FOLLOW-UP: live progress, credentialed image probe, and rollback — 2026-09-23

- The web workspace now requests an opt-in NDJSON response from `POST /api/translate`. The Gemini runner emits a safe model-switch event only when a different model actually begins an attempt; the hook displays that model while the request is still running. Ordinary JSON clients, including the Extension, retain their existing response contract. The stream carries the final HTTP-equivalent status inside its result event so the browser still raises quota/timeout errors correctly.
- `SUPERK_GEMINI_IMAGE_ROUTER=fixed` immediately selects the prior fixed image request path for rollback. The fixed path now splits comma-separated key pools and de-duplicates user/server credentials before sending them; a live 400 exposed this old multi-key defect. Upstream error text from the rollback path is redacted before reaching the browser.
- Credentialed local API probes using `public/live_full_comparison.png` and the local `.env.local` key pool: new Auto returned HTTP 200 with a JSON bubbles array (5 bubbles) twice, in **46.4s** then **18.2s**; fixed Manual on `gemini-2.5-flash` returned HTTP 200 (5 bubbles, **32.5s**); fixed Auto returned HTTP 200 (7 bubbles, **44.6s**). No safety-filter response occurred for this sample. The first sandboxed probe returned 502 from blocked upstream network access; a network-enabled local server resolved that environment limitation.
- These are real provider calls, but `public/live_full_comparison.png` is a repository sample/comparison image, **not confirmed to be the same four-page workload** the user previously reported failing. End-to-end browser cleaning and overlay rendering with those original pages remains the final operational release gate. Do not promote the router to `VERIFIED WORKING` on the basis of this sample alone.
- A second repository sample, `public/comparison/compare_page_2.jpg`, first reached the 60-second Auto budget and returned `GEMINI_TIMEOUT`. A Manual `gemini-2.5-flash` retry then succeeded (10 bubbles, **19.5s**), and a subsequent Auto run succeeded (22 bubbles, **22.6s**) while streaming two actual model-switch events. This does not establish a deterministic code fault; provider response time and route health varied between requests. The bounded timeout worked as specified, and the progress channel was observed live.
- A third sample, `public/comparison/compare_page_34.jpg`, succeeded through Auto (7 bubbles, **29.8s**). The differing bubble counts on annotated comparison images are not a translation-quality acceptance measure.
- Final continuation verification after the stream correction: full Vitest suite **140 files / 883 tests passed**, TypeScript `--noEmit` passed, and focused ESLint on routing/API/progress parsing tests passed. Broad ESLint still reports the same pre-existing React hook and legacy-test `any` violations.
- A final stream-edge regression showed that a truncated NDJSON response was a generic error rather than a retryable transport failure. It now becomes a structured `NETWORK` error; explicit user cancellation still propagates as cancellation. Focused stream/API/hook tests passed **59/59** after the change.

## Quick status summary

- **Web App:** ACTIVE / primary direction.
- **Fixed Gemini `requestGemini` routing:** VERIFIED WORKING / prior image-translation baseline; retained for rollback and legacy text routing.
- **Shared Gemini catalog/router on live image translation path:** EXPERIMENTAL / structurally tested; requires real manga workload validation before a verified-working claim.
- **Dynamic catalog/discovery infrastructure:** EXPERIMENTAL; now the image routing authority under ADR-0017.
- **NSFW 3×2 slicing:** ACTIVE; do not blame/remove without repro evidence.
- **Mask deletion authorization fix:** VERIFIED WORKING.
- **Windows Desktop/Installer:** PAUSED by user decision.
