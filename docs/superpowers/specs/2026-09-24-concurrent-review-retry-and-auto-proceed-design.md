# Design Spec: Live Queue Concurrent Review Retry & Auto-Proceed on Review

## 1. Overview & Context

When batch translating manga pages, the local Python cleaner service (`ocr-service`) performs inpainting verification. If complex artwork, illustrated text, or SFX regions are detected, it marks `awaitingReview: true`.

Currently:
1. In `hooks/useTranslation.ts`, encountering `preparedPage.awaitingReview && !isTargetedRetry` throws a `CleaningClientError(422, "Page awaiting review...")`, halting translation of that specific page and logging it to `batchFailures` under `CLEANING_REVIEW_REQUIRED`.
2. The batch loop continues processing the remaining pages.
3. The user sees the failure notification and opens `TranslationDiagnosticModal` (displaying "⚠️ หน้ารอการตรวจสอบคุณภาพการลบคำพูด (Awaiting Review)" and a button "🔄 ยืนยันและดำเนินการแปลต่อ").
4. However, clicking "🔄 ยืนยันและดำเนินการแปลต่อ" invokes `retryFailureGroup()` which calls `handleTranslateAll(pageIndices)`.
5. Because `handleTranslateAll` has a hard lock guard:
   ```ts
   if (translationOperationLockRef.current || isTranslating || isTranslatingAll) return;
   ```
   The user's confirmation is silently dropped! The user is prevented from retrying or proceeding with the flagged page while the rest of the batch is translating.

This specification details two complementary improvements:
1. **Live Queue & Concurrent Review Retry**: Unlocking "🔄 ยืนยันและดำเนินการแปลต่อ" so that when batch translation is actively running, clicking confirm dispatches translation for the approved page(s) immediately without being blocked by `isTranslatingAll`.
2. **Auto-Proceed on Review Preference**: Providing a user-toggleable setting (`autoProceedOnReview`, default `true`) to allow batch translation to proceed automatically past `awaitingReview` pages without halting or creating failure items, while still noting review recommendations non-intrusively.

---

## 2. Architecture & Data Flow

### 2.1 Live Queue & Concurrent Retry Dispatch
When `retryFailureGroup(failureGroupId, options)` is invoked from `TranslationDiagnosticModal` or the failure banner:
- Check if `isTranslatingAll` is active.
- **If `isTranslatingAll === true` (Active Batch Running):**
  1. Identify affected `pageIndices` in the failure group.
  2. Register these pages in `userApprovedReviewPagesRef.current` (`Set<string>` of approved page URLs).
  3. Immediately remove them from `batchFailures` (and dismiss/clear corresponding failure group from modal/banner).
  4. Dispatch translation for these pages concurrently via a dedicated background execution path (`translateApprovedPagesConcurrently(pageIndices, options)`):
     - Uses the prepared clean page from memory cache or prepares it safely.
     - Because `userApprovedReviewPagesRef` contains the page, `awaitingReview` is bypassed.
     - Calls `performTranslation(...)` directly.
     - Caches translation bubbles and marks page completed in `completedPagesRef`.
     - Updates UI if the page is currently active.
     - If translation fails, safely re-adds the page to `batchFailures` with updated diagnostic.
- **If `isTranslatingAll === false` (Idle):**
  - Keeps the existing flow: calls `handleTranslateAll(pageIndices, options)` as a targeted retry.

### 2.2 Auto-Proceed on Review Configuration
- Add `autoProceedOnReview: boolean` state and setter in `useTranslation.ts` (default `true`, persisted in `localStorage` under `superk:auto-proceed-review`).
- Expose `autoProceedOnReview` and `setAutoProceedOnReview` in `useTranslation` return values and `SettingsModal`.
- In the batch translation loop:
  ```ts
  const isApprovedByUser = userApprovedReviewPagesRef.current.has(pageUrl);
  if (preparedPage.awaitingReview && !isTargetedRetry && !isApprovedByUser && !autoProceedOnReview) {
    throw new CleaningClientError(
      422,
      "Page awaiting review after local cleaning verification.",
      "Review or explicitly retry this page before translation.",
    );
  }
  ```
- When `autoProceedOnReview === true` (or page is approved):
  - Do NOT throw 422 error.
  - The pipeline continues smoothly to Gemini translation.
  - Record the page in `reviewFlaggedPages` (`Set<string>`) to render a subtle indicator (e.g. ⚠️ badge) in the thumbnail strip without failing the batch.

---

## 3. UI/UX Changes

1. **`TranslationDiagnosticModal.tsx`**:
   - The button "🔄 ยืนยันและดำเนินการแปลต่อ" remains active and shows immediate feedback when clicked (closes modal, clears the error from list, and triggers translation in background).
2. **`SettingsModal.tsx`**:
   - Add a toggle switch in the Translation / Cleaning settings section:
     - Label: "แปลต่อเนื่องอัตโนมัติแม้พบจุดที่ควรตรวจสอบ (Auto-proceed on Review)"
     - Description: "ดำเนินการแปลทุกหน้าอย่างต่อเนื่องแม้ระบบลบข้อความจะแนะนำให้ตรวจสอบ SFX หรือฉากหลังซับซ้อน"
3. **Workspace Thumbnail Strip**:
   - For pages in `reviewFlaggedPages`, display a subtle amber review dot/badge on the thumbnail so the user can easily review those pages at their convenience.

---

## 4. Error Handling & Edge Cases

1. **Rate Limits (429 / Cooldown)**:
   - If a concurrent retry encounters Gemini quota limits, it respects existing `quotaCooldownByGroup` and switches keys/models per production rules (`requestGemini` key pool).
2. **Cancellation**:
   - If the user cancels the batch (`cancelTranslateAll`), any active concurrent retries check `translationAbortRef.current.signal` and cancel cleanly.
3. **Duplicate Translation Requests**:
   - Debounce and track pages currently being concurrently translated (`inFlightConcurrentPagesRef: Set<number>`) so clicking confirm twice will not send duplicate API requests.

---

## 5. Verification Plan

1. **Unit & Integration Tests**:
   - `tests/translation/useTranslation.test.tsx`:
     - Test retrying a failure group while `isTranslatingAll` is true: verify page translates and completes concurrently without throwing or getting dropped.
     - Test `autoProceedOnReview: true`: batch processes `awaitingReview` page into translation without error.
     - Test `autoProceedOnReview: false`: batch halts `awaitingReview` page into `batchFailures` as `CLEANING_REVIEW_REQUIRED`.
   - `tests/unit/TranslationDiagnosticModal.test.tsx`:
     - Verify button click triggers `onRetryFailureGroup` and closes modal cleanly.
   - `tests/workspace/SettingsModal.test.tsx`:
     - Verify toggle changes and persists `autoProceedOnReview`.
2. **Full Regression Check**:
   - Run `npx vitest run tests/translation`
   - Run `npx vitest run tests/workspace`
   - Run `npx tsc --noEmit`
