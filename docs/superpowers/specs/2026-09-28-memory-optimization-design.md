# Memory Optimization Design — SuperK Manga Translator

**Date:** 2026-09-28  
**Status:** Approved by User  
**Goal:** Reduce memory footprint and prevent resource exhaustion when running SuperK for long sessions with large manga chapters (50–100+ pages).

---

## 1. Problem Statement & Forensic Evidence

During continuous usage and large manga imports (e.g. 73 pages):
1. **Frontend Browser RAM Spikes (4–7 GB+)**:
   - `components/workspace/PageViewer.tsx` currently runs a brute-force `pages.forEach` on mount and every page change to preload natural dimensions for all pages in parallel.
   - For 73 pages at 1700×2400 to 3500×2400, decoding 73 full-resolution bitmaps simultaneously consumes >1.2 GB of GPU/renderer bitmap RAM in Chrome/Brave.
   - Every single-page switch triggers `PageViewer` re-renders and holds onto preloaded `Image` references.
2. **Python Cleaner Sidecar Memory Holding (~620 MB - 1 GB+)**:
   - `ocr-service` loads PyTorch and the LaMa inpainting model. After processing batch jobs, PyTorch memory pools and Python heap remain allocated in the process working set even during long idle periods.
3. **Dev Server Overhead**:
   - Running in development mode (`npm run dev` with Turbopack) continuously maintains HMR WebSockets, file watchers, unminified ASTs, and sourcemaps in memory.

---

## 2. Proposed Architectural Solution

### Component A: Frontend Windowed Image Virtualization (`components/workspace/PageViewer.tsx`)
- **Sliding Window Preloading**:
  - Instead of preloading all `pages.length` images at once, calculate a sliding window:
    `windowStart = Math.max(0, currentPage - 2)`
    `windowEnd = Math.min(pages.length - 1, currentPage + 2)`
  - Only preload dimensions for unmeasured pages within `[windowStart, windowEnd]`.
  - When the user navigates, the window slides naturally, providing zero-latency transitions for adjacent pages while preventing memory explosion on 50–100+ page books (93% reduction in simultaneous decodes).
- **Async Decoding**:
  - Add `decoding="async"` to viewer images so image decoding is offloaded from the UI main thread.
- **Resource Cleanup**:
  - Properly clean up pending preloader event listeners if the window shifts before an image finishes loading.

### Component B: Backend Python Sidecar Idle Auto-Trim (`ocr-service/app/api.py` & `jobs.py`)
- **Background Periodic Trim**:
  - Add a lightweight background task or lifespan handler in FastAPI.
  - When the job queue is idle for > 60 seconds, invoke `_trim_process_memory()`:
    1. Python `gc.collect()`
    2. PyTorch `torch.cuda.empty_cache()` (if CUDA is present)
    3. Windows OS `ctypes.windll.psapi.EmptyWorkingSet()` to flush inactive pages back to the Windows memory manager.

### Component C: Production Deployment Guidance
- Document the optimal production run command (`npm run build && npm run start`) for real-world usage to eliminate Turbopack dev-server memory accumulation and HMR watcher overhead.

---

## 3. Testing & Verification Plan

1. **Unit & Component Tests**:
   - Write tests in `tests/workspace/PageViewerMemory.test.tsx` verifying:
     - Dimension preloading only touches pages in the sliding window (`currentPage ± 2`).
     - Navigating past the window slides the preloaded set smoothly.
     - Unmounted preloaders do not cause state leaks.
2. **Regression Tests**:
   - Ensure existing tests in `tests/workspace/PageViewerZoom.test.tsx`, `tests/workspace/PageViewerScroll.test.tsx`, and `tests/unit/pageViewer.test.tsx` continue to pass.
3. **Type Check**:
   - `npx tsc --noEmit` must pass with 0 errors.
