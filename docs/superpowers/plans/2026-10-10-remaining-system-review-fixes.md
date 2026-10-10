# Remaining System Review Fixes (Phase 3 & Phase 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the remaining items from the Full System Review (Phase 3: Python `ocr-service` Memory/Speed ROI Slicing & Pipeline/Job Hardening; Phase 4: Chrome Extension Storage Quota, Monochrome Readability Parity & Local API Security Hardening).

**Architecture:**
1. **Phase 3 (Python `ocr-service` Memory, Speed & Reliability)**:
   - Replace per-component full-page `H × W` allocations (`labels == component_id`, full-page `cv2.distanceTransform`, full-page `cv2.dilate`, and storing 200+ full-page arrays in `component_masks`) in `ocr-service/app/mask_refiner.py` with padded bounding-box (`stats[component_id]`) ROI slicing and `PixelRect`-based region grouping (`_group_component_rects`).
   - Crop `original`, `repaired`, and `mask` to the non-zero mask bounding box (`pad = max(0, feather_radius) + 2`) inside `ocr-service/app/compositor.py` before running `cv2.distanceTransform` and 3-channel `float32` alpha blending, producing bit-for-bit identical output with >90% lower RAM per region.
   - Enable per-region full-resolution crop retry (`fallback_cleaner.clean(retry_base, retry_mask, item.region)`) in `ocr-service/app/pipeline.py` (`_run_batched`) when `item.damage_accepted and residual > 0.18` even when `adaptive_roi_enabled` is `False`, remove the unreachable duplicate `elif np.count_nonzero(seed) > 0:` branch in `ocr-service/app/detector.py`, and harden `ocr-service/app/jobs.py` (`job_id` hex validation, locked `_pipeline()` initialization, and `FAILED` job eviction).
2. **Phase 4 (Chrome Extension Storage Quota, Monochrome Contrast & Local API Security)**:
   - Add `"unlimitedStorage"` to `chrome-extension/manifest.json` and prune duplicate Base64 fields (`sourceImage`, `cleanUrl`) + enforce a 20-page LRU cap on `superk_trans_*` entries in `chrome-extension/content.js` and `chrome-extension/background.js`.
   - Fix the `0..1` vs `0..255` `backgroundLuminance` mismatch and port high-contrast monochrome outline rules (`#000000` fill + `#FFFFFF` outline on dark/gray backgrounds, `#FFFFFF` fill + `#000000` outline when `bgLum <= 65`) into `chrome-extension/content.js`, plus wake up `checkPublishedUpdates` on tab `visibilitychange` / `focus`.
   - Enforce `requireLocalRequest(req)` across `/api/translate`, `/api/translate-text`, `/api/translate/models`, `/api/translate/validate-key`, and `/api/translation-review`, wire `userApiKey` + `getSyncedExtensionSettings()` + canonical `FIXED_IMAGE_MODELS` order into `/api/translate-text`, and add `x-superk-pairing-token` to `Access-Control-Allow-Headers` in `/api/extension/settings`.

**Tech Stack:** Python 3.11+ (`opencv-python`, `numpy`, `pytest`), TypeScript / Next.js 16 App Router (`vitest`), Manifest V3 Chrome Extension (Vanilla JS).

---

## Status Summary of System Review Phases

| Phase | Scope | Status | Commit |
| :--- | :--- | :--- | :--- |
| **Phase 1** | Gemini Routing Baseline (`requestGemini()`), `FIXED_IMAGE_MODELS` Priority, User Key Precedence, Extension Bridge & Glossary Sync, Key Redaction | **VERIFIED WORKING** | `a4ff6f7` |
| **Phase 2** | Frontend Base64 `JSON.stringify` Elimination (`834x` faster), Cleaned-Background `repairWholeBook`, Dirty-Page Autosave for Batch Organize/B&W, `compactOverlayPageKey` Collision Fix, `dataUrlToBlob` (`22x` faster) | **VERIFIED WORKING** | `fd133a4` |
| **UI Follow-ups** | `CleaningToolbar` Dropdown Unclipping, Oval Bubble Width-Handle (`↔`) Unfreezing, Tiny Bubble Handle Fan-Out & Top-Edge Scale (`⤡`) Clamping | **VERIFIED WORKING** | `b6b4617`, `840e0d6`, `804455c` |
| **Phase 3 (This Plan)** | Python `ocr-service` ROI Slicing (`mask_refiner.py`, `compositor.py`), Residual Crop Retry (`pipeline.py`), Detector Cleanup & JobStore Hardening (`detector.py`, `jobs.py`) | **PLANNED (Awaiting Execution)** | — |
| **Phase 4 (This Plan)** | Chrome Extension Quota (`manifest.json`, `content.js` LRU + Pruning), Monochrome Contrast & Visibility Sync (`content.js`, `background.js`), Local API Security (`requireLocalRequest` & `/api/translate-text` key sync) | **PLANNED (Awaiting Execution)** | — |

---

## Phase 3: Python `ocr-service` Memory, Speed & Reliability

### Task 3.1: Bounding-Box ROI Slicing in `ocr-service/app/mask_refiner.py` (`[HIGH-5a]`)

**Files:**
- Modify: `ocr-service/app/mask_refiner.py:87-115, 182-211, 347-404`
- Test: `ocr-service/tests/test_mask_refiner.py`

- [ ] **Step 1: Write the failing test in `ocr-service/tests/test_mask_refiner.py`**
  Verify that `_refine_seed_mask` and `complete_glyph_mask` produce bit-for-bit identical masks and `MaskRegion` rects on multi-component synthetic manga pages while `_group_component_rects` groups component `PixelRect`s without retaining full-page component masks.
- [ ] **Step 2: Run `pytest ocr-service/tests/test_mask_refiner.py` to verify RED**
- [ ] **Step 3: Implement ROI-sliced component refinement in `ocr-service/app/mask_refiner.py`**
  - In `complete_glyph_mask`: slice `sub_seed = (labels[y1:y2, x1:x2] == comp_idx).astype(np.uint8) * 255` directly instead of allocating a full-page `comp_mask` per component.
  - In `_refine_seed_mask`: for each `component_id`, extract `(bx, by, bw, bh)` from `stats[component_id]`, pad by `pad = 6` (`x1 = max(0, bx - pad)`, `y1 = max(0, by - pad)`, `x2 = min(w, bx + bw + pad)`, `y2 = min(h, by + bh + pad)`), run `_estimate_stroke_radius` and `constrained_dilate` on `sub_comp` (`(labels[y1:y2, x1:x2] == component_id).astype(np.uint8) * 255`), accumulate into `combined[y1:y2, x1:x2]`, record the offset `PixelRect` in `rects[component_id]`, and group regions via `_group_component_rects(rects, radii, seed_bin.shape)`.
- [ ] **Step 4: Run `pytest ocr-service/tests/test_mask_refiner.py` to verify GREEN**

---

### Task 3.2: Region-Cropped Float32 Blending in `ocr-service/app/compositor.py` (`[HIGH-5b]`)

**Files:**
- Modify: `ocr-service/app/compositor.py:8-42`
- Test: `ocr-service/tests/test_compositor.py`

- [ ] **Step 1: Write the failing/benchmark equivalence test in `ocr-service/tests/test_compositor.py`**
  Assert that `compose(original, repaired, mask, feather_radius=4)` on a large canvas with a localized region mask produces the exact same pixel values and support mask as full-array blending while only operating on the padded bounding box.
- [ ] **Step 2: Implement ROI cropping inside `compose()` in `ocr-service/app/compositor.py`**
  - Find the bounding rect `(bx, by, bw, bh)` of `binary > 0` via `cv2.findNonZero(binary)`.
  - Compute `pad = max(0, int(feather_radius)) + 2` and slice `x1 = max(0, bx - pad)`, `y1 = max(0, by - pad)`, `x2 = min(w, bx + bw + pad)`, `y2 = min(h, by + bh + pad)`.
  - Run `cv2.dilate`, `cv2.distanceTransform`, and `float32` blending exclusively on the `[y1:y2, x1:x2]` crop, then write the blended crop into `result = original.copy()` and `full_support = np.zeros_like(mask)`.
- [ ] **Step 3: Run `pytest ocr-service/tests/test_compositor.py` to verify GREEN**

---

### Task 3.3: Residual Crop Retry in `ocr-service/app/pipeline.py`, Dead-Branch Cleanup in `detector.py` & Job Hardening in `jobs.py` (`[M1, M5, L3]`)

**Files:**
- Modify: `ocr-service/app/pipeline.py:540-605`
- Modify: `ocr-service/app/detector.py:594-610`
- Modify: `ocr-service/app/jobs.py:227-269, 327-360, 485-535`
- Test: `ocr-service/tests/test_pipeline.py`, `ocr-service/tests/test_jobs.py`

- [ ] **Step 1: Write failing tests in `ocr-service/tests/test_pipeline.py` and `ocr-service/tests/test_jobs.py`**
  - Test that `_run_batched` retries a high-residual region (`residual > 0.18`) at crop resolution even when `SUPERK_ENABLE_ADAPTIVE_ROI_V2` is not set.
  - Test that `JobStore.get()` and `JobStore.delete_job()` reject path-traversal `job_id` values (`"../escape"`, `"..\\escape"`).
- [ ] **Step 2: Implement fixes in `pipeline.py`, `detector.py`, and `jobs.py`**
  - In `ocr-service/app/pipeline.py:540`: allow per-region crop retry when `item.damage_accepted and residual > 0.18` regardless of `adaptive_roi_enabled`, guarding `adaptive_scope.clusters` access when `adaptive_scope is None`.
  - In `ocr-service/app/detector.py:604-608`: remove the unreachable duplicate `elif np.count_nonzero(seed) > 0:` branch.
  - In `ocr-service/app/jobs.py`: validate `job_id` against `^[0-9a-f]{32}$` before filesystem access, guard `_pipeline()` initialization under `self._jobs_lock`, and track active worker count so timed-out threads still in ONNX inference prevent premature `unload_models()`.
- [ ] **Step 3: Run `pytest ocr-service/tests/` to verify GREEN**

---

## Phase 4: Chrome Extension Quota, Monochrome Readability & Local API Security

### Task 4.1: Chrome Extension `"unlimitedStorage"`, Payload Pruning & LRU Cache Eviction (`[HIGH-6]`)

**Files:**
- Modify: `chrome-extension/manifest.json:6-11`
- Modify: `chrome-extension/content.js:555-570`
- Modify: `chrome-extension/background.js:458-470`
- Test: `tests/chrome-extension/contentOverlayStorage.test.ts` (or existing `tests/chrome-extension/` suite)

- [ ] **Step 1: Write failing test for Extension storage payload pruning & LRU eviction**
  Verify that persisting an overlay via `content.js` strips duplicate `sourceImage` and `cleanUrl` fields from `evidence` (retaining only `cleanImageBase64` + metadata) and evicts oldest `superk_trans_*` keys when exceeding `MAX_CACHED_PAGES = 20`.
- [ ] **Step 2: Run `npx vitest run tests/chrome-extension` to verify RED**
- [ ] **Step 3: Implement `"unlimitedStorage"` + pruned LRU storage helper**
  - Add `"unlimitedStorage"` to `permissions` in `chrome-extension/manifest.json`.
  - In `chrome-extension/content.js`, omit `sourceImage` and `cleanUrl` when saving `[storageKey]` to `chrome.storage.local`, and prune oldest `superk_trans_*` entries beyond 20 pages.
- [ ] **Step 4: Run `npx vitest run tests/chrome-extension` to verify GREEN**

---

### Task 4.2: Chrome Extension Monochrome Dark-Background Readability & Tab Visibility Sync (`[M2, M3]`)

**Files:**
- Modify: `chrome-extension/content.js:10-56, 294-298, 423-452`
- Modify: `chrome-extension/background.js:180-203`
- Test: `tests/chrome-extension/`

- [ ] **Step 1: Write failing tests for Extension `0..255` luminance & monochrome dark-background outline + visibility wake-up**
  - Test that `backgroundLuminance` on `0..255` scale (`bgLum = 30`) selects dark canvas fill `#171717` and high-contrast outline (`#FFFFFF` fill with `#000000` outline or `#000000` fill with `#FFFFFF` outline when `bgLum < 170`) on monochrome pages.
  - Test that `SYNC_PUBLISHED_UPDATES` message in `background.js` invokes `checkPublishedUpdates()`.
- [ ] **Step 2: Implement fixes in `chrome-extension/content.js` and `chrome-extension/background.js`**
  - Normalize `bgLum` (`bgLum <= 1 ? bgLum * 255 : bgLum`) in `content.js`.
  - Apply high-contrast monochrome outline when `isMonochromeAuto` is true and background is dark/gray (`bgLum255 < 170` or sample spread `>= 80`), matching `lib/colorMatching/resolveTextStyle.ts`.
  - Dispatch `{ action: 'SYNC_PUBLISHED_UPDATES' }` from `content.js` on `document` `visibilitychange` (when `document.visibilityState === 'visible'`) and handle it in `background.js`.
- [ ] **Step 3: Run `npx vitest run tests/chrome-extension` to verify GREEN**

---

### Task 4.3: Local API Origin Protection (`requireLocalRequest`), `/api/translate-text` Key Sync & Extension CORS Header (`[MEDIUM-3 / M4, H2b, L2]`)

**Files:**
- Modify: `src/app/api/translate/handler.ts:117-123`
- Modify: `src/app/api/translate-text/route.ts:24-45, 84-98`
- Modify: `src/app/api/translate/models/route.ts:15-20`
- Modify: `src/app/api/translate/validate-key/route.ts:11-16`
- Modify: `src/app/api/translation-review/route.ts:69-74`
- Modify: `src/app/api/extension/settings/handler.ts:84-91`
- Test: `tests/api/localRequestProtection.test.ts`

- [ ] **Step 1: Write failing tests in `tests/api/localRequestProtection.test.ts`**
  - Verify that cross-origin `POST` requests with `Origin: https://evil.example.com` to `/api/translate`, `/api/translate-text`, `/api/translate/models`, `/api/translate/validate-key`, and `/api/translation-review` return `403 Forbidden`, while loopback and `chrome-extension://` origins are permitted.
  - Verify that `/api/translate-text` accepts user `apiKey` / `getSyncedExtensionSettings().geminiApiKey` ahead of `process.env.GEMINI_API_KEY` and uses `FIXED_IMAGE_MODELS` priority order (`gemini-3.5-flash-lite` -> `gemini-3.8-flash` -> ...).
  - Verify that `OPTIONS /api/extension/settings` includes `x-superk-pairing-token` in `Access-Control-Allow-Headers`.
- [ ] **Step 2: Run `npx vitest run tests/api/localRequestProtection.test.ts` to verify RED**
- [ ] **Step 3: Implement `requireLocalRequest` guards, `/api/translate-text` key/model sync, and CORS header**
- [ ] **Step 4: Run full Vitest suite + TypeScript check (`npx tsc --noEmit`) and record verification evidence in `docs/AI-WORKING-NOTES.md`**
