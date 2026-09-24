# Live Queue Concurrent Review Retry & Auto-Proceed on Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to confirm and translate pages flagged as "Awaiting Review" immediately while a batch translation is running concurrently, and provide an auto-proceed option so batch translation doesn't halt for review.

**Architecture:** 
1. In `hooks/useTranslation.ts`, add `autoProceedOnReview` setting (default `true`). When enabled, `awaitingReview` pages are not blocked with error 422, but are instead translated directly and tagged non-intrusively.
2. In `retryFailureGroup()`, detect if `isTranslatingAll` is currently running. If running, do not bail out; immediately dismiss the page from `batchFailures`, mark the page URL as approved in `userApprovedReviewPagesRef`, and dispatch concurrent background translation for the approved page(s).
3. Connect `autoProceedOnReview` to `SettingsModal.tsx` and workspace controls with persistence in `localStorage`.

**Tech Stack:** React, Next.js, TypeScript, Vitest, Testing Library.

## Global Constraints
- Current Gemini translation routing baseline (`requestGemini`) is strictly preserved; do not alter live API routing paths.
- All existing tests in `tests/translation/` and `tests/workspace/` must continue to pass.
- Concurrent retries must respect cancellation signals and not duplicate in-flight requests.
- Always update `docs/AI-WORKING-NOTES.md` with verification evidence.

---

### Task 1: Auto-Proceed on Review in `useTranslation`

**Files:**
- Modify: `hooks/useTranslation.ts`
- Test: `tests/translation/useTranslation.test.tsx`

**Interfaces:**
- Produces: `autoProceedOnReview: boolean`, `setAutoProceedOnReview: (value: boolean) => void`, `reviewFlaggedPages: Set<string>` exported from `useTranslation`.

- [ ] **Step 1: Write the failing tests**

Add test cases in `tests/translation/useTranslation.test.tsx`:
1. `autoProceedOnReview: true` allows batch translation to proceed with `awaitingReview: true` pages directly to `/api/translate` without halting or creating `batchFailures`.
2. `autoProceedOnReview: false` preserves the review-halting behavior, creating a `CLEANING_REVIEW_REQUIRED` failure item.

```tsx
test("autoProceedOnReview: true translates awaitingReview pages automatically without error", async () => {
  vi.useFakeTimers();
  const pages = ["blob:one"];
  const preparePageForTranslation = vi.fn(async (url: string) => ({
    recognitionUrl: url,
    backgroundUrl: `${url}-clean`,
    awaitingReview: true,
  }));

  let apiCalls = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (pages.includes(url)) return imageResponse();
    if (url === "/api/translate") {
      apiCalls += 1;
      return successResponse();
    }
    throw new Error(`unexpected fetch: ${url}`);
  });

  const { result } = renderHook(() =>
    useTranslation({
      currentPage: 0,
      pages,
      viewMode: "single",
      preparePageForTranslation,
    }),
  );

  act(() => {
    result.current.setAutoProceedOnReview(true);
  });

  let batch!: Promise<void>;
  act(() => {
    batch = result.current.handleTranslateAll();
  });
  await act(async () => {
    await vi.runAllTimersAsync();
    await batch;
  });

  expect(apiCalls).toBe(1);
  expect(result.current.batchFailures).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/translation/useTranslation.test.tsx -t "autoProceedOnReview: true"`
Expected: FAIL (property `setAutoProceedOnReview` not defined or 422 error still thrown).

- [ ] **Step 3: Implement minimal code for `autoProceedOnReview`**

In `hooks/useTranslation.ts`:
1. Add state:
```ts
const [autoProceedOnReview, setAutoProceedOnReviewState] = useState<boolean>(() => {
  if (typeof localStorage !== "undefined") {
    const saved = localStorage.getItem("superk:auto-proceed-review");
    if (saved !== null) return saved !== "false";
  }
  return true;
});
const [reviewFlaggedPages, setReviewFlaggedPages] = useState<Set<string>>(new Set());

const setAutoProceedOnReview = useCallback((value: boolean) => {
  setAutoProceedOnReviewState(value);
  if (typeof localStorage !== "undefined") {
    localStorage.setItem("superk:auto-proceed-review", String(value));
  }
}, []);
```
2. In `handleTranslateAll` loop:
```ts
const isApprovedByUser = userApprovedReviewPagesRef.current.has(pageUrl);
if (preparedPage.awaitingReview && !isTargetedRetry && !isApprovedByUser && !autoProceedOnReview) {
  throw new CleaningClientError(
    422,
    "Page awaiting review after local cleaning verification.",
    "Review or explicitly retry this page before translation.",
  );
}
if (preparedPage.awaitingReview) {
  setReviewFlaggedPages((prev) => new Set(prev).add(pageUrl));
}
```
3. Export `autoProceedOnReview`, `setAutoProceedOnReview`, `reviewFlaggedPages` in return object.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/translation/useTranslation.test.tsx -t "autoProceedOnReview"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add hooks/useTranslation.ts tests/translation/useTranslation.test.tsx
git commit -m "feat: add autoProceedOnReview support to useTranslation"
```

---

### Task 2: Live Queue & Concurrent Retry in `useTranslation`

**Files:**
- Modify: `hooks/useTranslation.ts`
- Test: `tests/translation/useTranslation.test.tsx`

**Interfaces:**
- Consumes: `retryFailureGroup(failureGroupId, options)`
- Handles: execution when `isTranslatingAll === true` without being locked out.

- [ ] **Step 1: Write the failing test**

In `tests/translation/useTranslation.test.tsx`:
Add a test simulating a running batch where `isTranslatingAll` is true, and `retryFailureGroup` is called during the batch:

```tsx
test("allows retrying a review failure group concurrently while batch translation is running", async () => {
  vi.useFakeTimers();
  const pages = ["blob:first-needs-review", "blob:second-long-running"];
  const preparePageForTranslation = vi.fn(async (url: string) => ({
    recognitionUrl: url,
    backgroundUrl: `${url}-clean`,
    awaitingReview: url === "blob:first-needs-review",
  }));

  let resolveSecondPageTranslate: (() => void) | null = null;
  let apiCalls = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (pages.includes(url)) return imageResponse();
    if (url === "/api/translate") {
      apiCalls += 1;
      if (apiCalls === 1) {
        // First api call is for blob:second-long-running
        return new Promise((resolve) => {
          resolveSecondPageTranslate = () => resolve(successResponse());
        });
      }
      return successResponse();
    }
    throw new Error(`unexpected fetch: ${url}`);
  });

  const { result } = renderHook(() =>
    useTranslation({
      currentPage: 0,
      pages,
      viewMode: "single",
      preparePageForTranslation,
    }),
  );

  act(() => {
    result.current.setAutoProceedOnReview(false);
  });

  // Start batch
  let batchPromise!: Promise<void>;
  act(() => {
    batchPromise = result.current.handleTranslateAll();
  });

  // Advance timer so page 0 fails with awaitingReview and page 1 begins translating
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });

  expect(result.current.isTranslatingAll).toBe(true);
  expect(result.current.failureGroups).toHaveLength(1);
  const failureGroupId = result.current.failureGroups[0].id;

  // Retry the review failure group while isTranslatingAll is STILL true
  let retryPromise!: Promise<void>;
  await act(async () => {
    retryPromise = result.current.retryFailureGroup(failureGroupId);
  });

  // Failure group should immediately be cleared from batchFailures
  expect(result.current.batchFailures).toHaveLength(0);

  // Complete the retry and second page
  await act(async () => {
    if (resolveSecondPageTranslate) resolveSecondPageTranslate();
    await vi.runAllTimersAsync();
    await retryPromise;
    await batchPromise;
  });

  expect(apiCalls).toBe(2);
  expect(result.current.batchFailures).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/translation/useTranslation.test.tsx -t "concurrently while batch translation is running"`
Expected: FAIL (`retryFailureGroup` returns without doing anything because `isTranslatingAll` is true).

- [ ] **Step 3: Implement concurrent retry handler in `useTranslation.ts`**

In `hooks/useTranslation.ts`:
1. Add `userApprovedReviewPagesRef = useRef<Set<string>>(new Set())` and `inFlightConcurrentPagesRef = useRef<Set<number>>(new Set())`.
2. In `retryFailureGroup`:
   - If `isTranslatingAll` is true:
     - Filter out target page indices.
     - For each target page:
       - Add pageUrl to `userApprovedReviewPagesRef.current`.
       - Add index to `inFlightConcurrentPagesRef.current`.
     - Remove those pages from `batchFailures` immediately.
     - Launch concurrent translation for those pages using `performTranslation` and cached/prepared page assets:
       ```ts
       const translateApprovedPagesConcurrently = async (targetIndices: number[], opts?: { forceNsfw?: boolean }) => {
         for (const idx of targetIndices) {
           const pUrl = pages[idx];
           try {
             const preparation = await prepareSafely(idx);
             if (!preparation.ok) throw preparation.error;
             await performTranslation(
               preparation.value,
               pUrl,
               idx,
               opts?.forceNsfw === true || nsfwBypassMode,
               false,
               translationAbortRef.current?.signal,
             );
           } catch (err) {
             // If concurrent retry failed, add back to failures
             const diag = classifyTranslationError(err);
             setBatchFailures((prev) => [...prev.filter((f) => f.pageIndex !== idx), {
               failureGroupId: `${failureOperationId}:${diag.code}`,
               pageIndex: idx,
               pageUrl: pUrl,
               stage: "translation",
               message: err instanceof Error ? err.message : "แปลไม่สำเร็จ",
               diagnostic: diag,
             }]);
           } finally {
             inFlightConcurrentPagesRef.current.delete(idx);
           }
         }
       };
       ```
   - If `isTranslatingAll` is false:
     - Run existing `handleTranslateAllRef.current(pageIndices, options)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/translation/useTranslation.test.tsx -t "concurrently while batch translation is running"`
Expected: PASS

- [ ] **Step 5: Run all translation tests**

Run: `npx vitest run tests/translation/useTranslation.test.tsx`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add hooks/useTranslation.ts tests/translation/useTranslation.test.tsx
git commit -m "feat: enable live concurrent review retry while batch translation runs"
```

---

### Task 3: Settings Modal Toggle & Workspace Integration

**Files:**
- Modify: `components/workspace/SettingsModal.tsx`
- Modify: `src/app/page.tsx`
- Test: `tests/workspace/SettingsModalAutoProceed.test.tsx`

**Interfaces:**
- `SettingsModalProps` gains:
  - `autoProceedOnReview?: boolean;`
  - `onAutoProceedOnReviewChange?: (value: boolean) => void;`

- [ ] **Step 1: Write the failing test**

Create `tests/workspace/SettingsModalAutoProceed.test.tsx`:
```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SettingsModal, type SettingsModalProps } from "@/components/workspace/SettingsModal";

const defaultProps: SettingsModalProps = {
  isOpen: true,
  onClose: () => {},
  autoSaveSession: false,
  onAutoSaveSessionChange: () => {},
  autoProceedOnReview: true,
  onAutoProceedOnReviewChange: vi.fn(),
};

describe("SettingsModal Auto-Proceed Toggle", () => {
  it("renders auto-proceed toggle and handles changes", () => {
    const onChange = vi.fn();
    render(<SettingsModal {...defaultProps} onAutoProceedOnReviewChange={onChange} />);

    const toggle = screen.getByLabelText(/แปลต่อเนื่องอัตโนมัติ/i);
    expect(toggle).toBeDefined();
    expect(toggle).toBeChecked();

    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/workspace/SettingsModalAutoProceed.test.tsx`
Expected: FAIL (`แปลต่อเนื่องอัตโนมัติ` label not found).

- [ ] **Step 3: Update `SettingsModal.tsx` and `src/app/page.tsx`**

1. In `components/workspace/SettingsModal.tsx`:
   - Add props `autoProceedOnReview?: boolean` and `onAutoProceedOnReviewChange?: (value: boolean) => void`.
   - Render a toggle under Translation options:
     - Checkbox/switch with label: `แปลต่อเนื่องอัตโนมัติแม้พบจุดที่ควรตรวจสอบ (Auto-proceed on Review)`
     - Subtext: `แปลต่อเนื่องทุกหน้าทันทีแม้ระบบคลีนจะแนะนำให้ตรวจสอบ SFX หรือฉากหลังซับซ้อน`
2. In `src/app/page.tsx`:
   - Destructure `autoProceedOnReview`, `setAutoProceedOnReview`, `reviewFlaggedPages` from `useTranslation()`.
   - Pass `autoProceedOnReview` and `onAutoProceedOnReviewChange={setAutoProceedOnReview}` to `<SettingsModal />`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/workspace/SettingsModalAutoProceed.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/workspace/SettingsModal.tsx src/app/page.tsx tests/workspace/SettingsModalAutoProceed.test.tsx
git commit -m "feat: add autoProceedOnReview toggle to SettingsModal and connect to workspace"
```

---

### Task 4: Full Verification & AI Working Notes Update

**Files:**
- Modify: `docs/AI-WORKING-NOTES.md`

- [ ] **Step 1: Run complete automated test suite**

Run:
```bash
npx vitest run tests/translation
npx vitest run tests/workspace
npx vitest run tests/unit
npx tsc --noEmit
```
Expected: All tests pass, 0 type errors.

- [ ] **Step 2: Update `docs/AI-WORKING-NOTES.md`**

Record the feature entry with:
- Status: `VERIFIED WORKING`
- Summary of concurrent retry and auto-proceed behavior
- Verification evidence (test pass counts, test file names).

- [ ] **Step 3: Commit**

```bash
git add docs/AI-WORKING-NOTES.md
git commit -m "docs: record verification of live queue concurrent retry and auto-proceed"
```
