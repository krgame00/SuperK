# Clean-Then-Translate Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Translate and Translate All clean each page before translation, reuse clean results, report workflow phases and page failures, and provide Original/Clean/Translated viewing.

**Architecture:** `useCleaning` exposes an explicit page operation returning a hydrated clean result. `WorkspacePage` supplies that operation to `useTranslation` through `preparePageForTranslation`; translation reads pixels from the returned clean URL but keeps the original URL as cache/session identity. One workspace-layer state replaces the overlapping original/clean flags.

**Tech Stack:** Next.js 16.2.10 App Router, React 19.2.4, TypeScript 5, Vitest 4.1.10, Testing Library, Tailwind CSS 4.

## Global Constraints

- Work only in `.worktrees/superk-hybrid-cleaning` on `codex/superk-hybrid-cleaning`.
- Before code edits, read `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`.
- Keep all new state and browser APIs below the existing `"use client"` boundary.
- Process one page at a time: clean, translate, then continue.
- Never translate original pixels when cleaning fails.
- Reuse clean results by original page URL.
- Keep translation/session caches keyed by original page URL.
- Preserve detector, SFX policy, cleaner, Gemini prompt, model/key, retry, and timeout behavior.
- Preserve manual Clean, Mask Editor, Force Clean, and Protect.
- Do not add scroll-triggered translation, parallel pages, or dependencies.
- Use `กำลังคลีนหน้า X/Y` and `กำลังแปลหน้า X/Y`.
- Use TDD and commit after each task.

## File Map

- `hooks/useCleaning.ts`: explicit page cleaning and result return.
- `tests/cleaning/useCleaning.test.tsx`: cleaning contract tests.
- `hooks/useTranslation.ts`: preparation orchestration, phase, failure summary, invalidation.
- `tests/translation/useTranslation.test.tsx`: single/batch workflow tests.
- `components/cleaning/CleaningToolbar.tsx`: primary result-layer selector.
- `tests/cleaning/CleaningToolbar.test.tsx`: layer availability tests.
- `src/app/page.tsx`: connect cleaning to translation and unify view state.
- `src/app/globals.css`: overlay visibility for non-translated layers.
- `tests/workflow/WorkspacePage.test.tsx`: hook wiring integration test.

---

### Task 1: Explicit Page Cleaning

**Files:**
- Modify: `hooks/useCleaning.ts`
- Modify: `tests/cleaning/useCleaning.test.tsx`

**Interfaces:**
- Produces: `cleanPage(pageUrl: string, source: Blob): Promise<PageCleaningResult>`
- Changes: `retryRegion(...): Promise<PageCleaningResult | undefined>`
- Preserves: `cleanCurrentPage(source: Blob): Promise<void>`

- [ ] **Step 1: Write failing contract tests**

Add the type import and tests:

```tsx
import type { PageCleaningResult } from "@/hooks/useCleaning";

test("cleanPage returns and reuses a result by original URL", async () => {
  vi.mocked(createCleaningJob).mockResolvedValue(succeededJob);
  vi.mocked(getCleaningResult).mockResolvedValue(cleaningResult);
  const { result } = renderHook(() =>
    useCleaning({ pages: ["blob:one"], currentPage: 0 }),
  );
  let first!: PageCleaningResult;
  let second!: PageCleaningResult;
  await act(async () => {
    first = await result.current.cleanPage(
      "blob:one",
      new Blob(["png"], { type: "image/png" }),
    );
    second = await result.current.cleanPage(
      "blob:one",
      new Blob(["png"], { type: "image/png" }),
    );
  });
  expect(first.cleanUrl).toBe("blob:clean");
  expect(second).toBe(first);
  expect(createCleaningJob).toHaveBeenCalledOnce();
});

test("cleanPage can finish a non-current batch page", async () => {
  vi.mocked(createCleaningJob).mockResolvedValue(queuedJob);
  vi.mocked(getCleaningJob)
    .mockResolvedValueOnce(runningJob)
    .mockResolvedValueOnce(succeededJob);
  vi.mocked(getCleaningResult).mockResolvedValue(cleaningResult);
  const { result } = renderHook(() =>
    useCleaning({ pages: ["blob:one", "blob:two"], currentPage: 0 }),
  );
  let cleaning!: Promise<PageCleaningResult>;
  act(() => {
    cleaning = result.current.cleanPage(
      "blob:two",
      new Blob(["png"], { type: "image/png" }),
    );
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
    await cleaning;
  });
  expect(result.current.resultsByPage.get("blob:two")?.jobId).toBe("job-1");
});

test("cleanPage records and rethrows a cleaning failure", async () => {
  vi.mocked(createCleaningJob).mockRejectedValue(
    new CleaningClientError(503, "offline", "start it"),
  );
  const { result } = renderHook(() =>
    useCleaning({ pages: ["blob:one"], currentPage: 0 }),
  );
  await act(async () => {
    await expect(
      result.current.cleanPage(
        "blob:one",
        new Blob(["png"], { type: "image/png" }),
      ),
    ).rejects.toThrow("offline");
  });
  expect(result.current.error?.recovery).toBe("start-local-service");
});
```

- [ ] **Step 2: Verify the tests fail**

Run:

```powershell
npm test -- tests/cleaning/useCleaning.test.tsx
```

Expected: FAIL because `cleanPage` is absent.

- [ ] **Step 3: Return the hydrated job result**

Change `finishJob` and `runJob`:

```ts
const finishJob = useCallback(
  async (
    job: CleaningJob,
    token: number,
    pageUrl: string,
  ): Promise<PageCleaningResult> => {
    const result = await getCleaningResult(job.jobId);
    const hydrated = await hydrateResult(result);
    if (token !== tokenRef.current) {
      revokeResult(hydrated);
      throw new PollingCancelled();
    }
    replaceResult(pageUrl, hydrated);
    await saveCleaningResultMetadata({
      pageUrl,
      sourceHash: result.sourceHash,
      jobId: result.jobId,
      regions: result.regions,
      updatedAt: Date.now(),
    });
    setProgressState(undefined);
    return hydrated;
  },
  [hydrateResult, replaceResult, revokeResult],
);

const runJob = useCallback(
  async (
    initial: CleaningJob,
    token: number,
    pageUrl: string,
  ): Promise<PageCleaningResult> => {
    const terminal = await waitForJob(initial, token, pageUrl);
    return finishJob(terminal, token, pageUrl);
  },
  [finishJob, waitForJob],
);
```

In `waitForJob` and `finishJob`, cancellation checks compare only the request
token. A non-current batch page must not be cancelled because it differs from
`pageUrlRef.current`.

- [ ] **Step 4: Implement `cleanPage` and retain manual cancellation**

Add:

```ts
const cancelOnPageChangeRef = useRef(false);

useEffect(() => {
  pageUrlRef.current = currentPageUrl;
  if (cancelOnPageChangeRef.current) tokenRef.current += 1;
}, [currentPageUrl]);

const cleanPage = useCallback(
  async (
    pageUrl: string,
    source: Blob,
  ): Promise<PageCleaningResult> => {
    const cached = resultsRef.current.get(pageUrl);
    if (cached) return cached;
    const token = tokenRef.current + 1;
    tokenRef.current = token;
    setError(undefined);
    try {
      const job = await createCleaningJob(source);
      return await runJob(job, token, pageUrl);
    } catch (caught) {
      handleFailure(caught);
      throw caught;
    }
  },
  [handleFailure, runJob],
);

const cleanCurrentPage = useCallback(
  async (source: Blob): Promise<void> => {
    const pageUrl = pageUrlRef.current;
    if (!pageUrl || resultsRef.current.has(pageUrl)) return;
    cancelOnPageChangeRef.current = true;
    try {
      await cleanPage(pageUrl, source);
    } catch {
      // CleaningToolbar renders the structured hook error.
    } finally {
      cancelOnPageChangeRef.current = false;
    }
  },
  [cleanPage],
);
```

Return `cleanPage`. Make `retryRegion` return the successful `runJob` result and
`undefined` when no current result exists; retain its structured error state.

- [ ] **Step 5: Run tests**

```powershell
npm test -- tests/cleaning/useCleaning.test.tsx
```

Expected: all tests PASS, including existing page-change cancellation.

- [ ] **Step 6: Commit**

```powershell
git add hooks/useCleaning.ts tests/cleaning/useCleaning.test.tsx
git commit -m "feat(cleaning): expose page preparation"
```

---

### Task 2: Translation Orchestration

**Files:**
- Modify: `hooks/useTranslation.ts`
- Create: `tests/translation/useTranslation.test.tsx`

**Interfaces:**
- Consumes: `preparePageForTranslation(pageUrl: string, pageIndex: number): Promise<string>`
- Produces: `workflowPhase: "cleaning" | "translating" | null`
- Produces: batch status `"cleaning" | "translating" | "waiting" | "cooldown"`
- Produces: `batchFailures: BatchPageFailure[]`
- Produces: `invalidatePageTranslation(pageUrl: string): void`
- Changes: `handleTranslate(): Promise<boolean>`

- [ ] **Step 1: Write failing single-page tests**

Create the test file:

```tsx
import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

import { useTranslation } from "@/hooks/useTranslation";

vi.mock("@/lib/translationOverlay", () => ({
  applyTranslationOverlay: vi.fn(),
}));
vi.mock("@/lib/projectStore", () => ({
  saveProjectSession: vi.fn(),
  loadProjectSession: vi.fn(),
  clearProjectSession: vi.fn(),
}));

const successResponse = () =>
  new Response(
    JSON.stringify({
      text: JSON.stringify({
        bubbles: [{ box: [10, 20, 40, 80], t: "สวัสดี" }],
      }),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

test("prepares clean pixels before translating and caches by original URL", async () => {
  const order: string[] = [];
  const preparePageForTranslation = vi.fn(async () => {
    order.push("clean");
    return "blob:clean";
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url === "blob:clean") {
      order.push("load-clean");
      return new Response(new Blob(["clean"], { type: "image/png" }));
    }
    if (url === "/api/translate") {
      order.push("translate");
      return successResponse();
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  const { result } = renderHook(() =>
    useTranslation({
      currentPage: 0,
      pages: ["blob:original"],
      viewMode: "single",
      preparePageForTranslation,
    }),
  );
  await act(async () => {
    expect(await result.current.handleTranslate()).toBe(true);
  });
  expect(order).toEqual(["clean", "load-clean", "translate"]);
  expect(result.current.bubbleCacheRef.current.has("blob:original")).toBe(true);
  expect(result.current.bubbleCacheRef.current.has("blob:clean")).toBe(false);
});

test("cleaning failure prevents every translation fetch", async () => {
  const preparePageForTranslation = vi
    .fn()
    .mockRejectedValue(new Error("clean failed"));
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  const { result } = renderHook(() =>
    useTranslation({
      currentPage: 0,
      pages: ["blob:original"],
      viewMode: "single",
      preparePageForTranslation,
    }),
  );
  await act(async () => {
    expect(await result.current.handleTranslate()).toBe(false);
  });
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(result.current.translationResult).toContain("clean failed");
});
```

- [ ] **Step 2: Verify the tests fail**

```powershell
npm test -- tests/translation/useTranslation.test.tsx
```

Expected: FAIL because the preparation prop and boolean result are absent.

- [ ] **Step 3: Separate pixel URL and cache identity**

Add:

```ts
export type TranslationWorkflowPhase = "cleaning" | "translating";

export interface BatchPageFailure {
  pageIndex: number;
  pageUrl: string;
  stage: "cleaning" | "translation";
  message: string;
}

interface UseTranslationProps {
  currentPage: number;
  pages: string[];
  viewMode: "single" | "scroll";
  preparePageForTranslation: (
    pageUrl: string,
    pageIndex: number,
  ) => Promise<string>;
}
```

Change the internal signature to:

```ts
const performTranslation = async (
  preparedUrl: string,
  pageUrl: string,
  pageIndex: number,
  forceNsfwBypass = false,
  isAutoRetry = false,
): Promise<boolean> => {
  const resImg = await fetch(preparedUrl);
  // Use preparedUrl for Image.src in slicing and enhanced retry.
  // Use pageUrl for active-page comparisons and both caches.
};
```

Replace all pixel reads inside `performTranslation` with `preparedUrl`. Keep
`pageUrl` in `activePageRef`, `bubbleCacheRef`, and
`translatedImageCacheRef`.

- [ ] **Step 4: Implement the single-page workflow**

```ts
const [workflowPhase, setWorkflowPhase] =
  useState<TranslationWorkflowPhase | null>(null);

const handleTranslate = async (): Promise<boolean> => {
  if (pages.length === 0) return false;
  const pageUrl = pages[currentPage];
  setIsTranslating(true);
  try {
    setWorkflowPhase("cleaning");
    setTranslationResult(`กำลังคลีนหน้า ${currentPage + 1}/${pages.length}`);
    const preparedUrl = await preparePageForTranslation(pageUrl, currentPage);
    setWorkflowPhase("translating");
    setTranslationResult(`กำลังแปลหน้า ${currentPage + 1}/${pages.length}`);
    return await performTranslation(preparedUrl, pageUrl, currentPage);
  } catch (error) {
    const message = error instanceof Error ? error.message : "ดำเนินการไม่สำเร็จ";
    setTranslationResult(`❌ Error: ${message}`);
    return false;
  } finally {
    setWorkflowPhase(null);
    setIsTranslating(false);
    setTimeout(() => setTranslationResult(null), 4000);
  }
};
```

- [ ] **Step 5: Add failing batch tests**

```tsx
test("batch skips a cleaning failure and continues", async () => {
  vi.useFakeTimers();
  const preparePageForTranslation = vi.fn(async (url: string) => {
    if (url === "blob:two") throw new Error("clean failed");
    return `blob:clean-${url.split(":")[1]}`;
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.startsWith("blob:clean-")) {
      return new Response(new Blob(["clean"], { type: "image/png" }));
    }
    if (url === "/api/translate") return successResponse();
    throw new Error(`unexpected fetch: ${url}`);
  });
  const { result } = renderHook(() =>
    useTranslation({
      currentPage: 0,
      pages: ["blob:one", "blob:two", "blob:three"],
      viewMode: "single",
      preparePageForTranslation,
    }),
  );
  let batch!: Promise<void>;
  act(() => {
    batch = result.current.handleTranslateAll();
  });
  await act(async () => {
    await vi.runAllTimersAsync();
    await batch;
  });
  expect(preparePageForTranslation).toHaveBeenCalledTimes(3);
  expect(result.current.batchFailures).toEqual([
    expect.objectContaining({ pageIndex: 1, stage: "cleaning" }),
  ]);
  expect(result.current.bubbleCacheRef.current.has("blob:three")).toBe(true);
  vi.useRealTimers();
});

test("translation retry reuses one prepared page", async () => {
  vi.useFakeTimers();
  const preparePageForTranslation = vi.fn().mockResolvedValue("blob:clean");
  let apiCalls = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url === "blob:clean") {
      return new Response(new Blob(["clean"], { type: "image/png" }));
    }
    if (url === "/api/translate") {
      apiCalls += 1;
      if (apiCalls === 1) {
        return new Response(
          JSON.stringify({
            error: "Gemini timeout",
            code: "GEMINI_TIMEOUT",
            retryable: true,
          }),
          { status: 504, headers: { "Content-Type": "application/json" } },
        );
      }
      return successResponse();
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  const { result } = renderHook(() =>
    useTranslation({
      currentPage: 0,
      pages: ["blob:one"],
      viewMode: "single",
      preparePageForTranslation,
    }),
  );
  let batch!: Promise<void>;
  act(() => {
    batch = result.current.handleTranslateAll();
  });
  await act(async () => {
    await vi.runAllTimersAsync();
    await batch;
  });
  expect(preparePageForTranslation).toHaveBeenCalledOnce();
  expect(apiCalls).toBe(2);
  vi.useRealTimers();
});
```

- [ ] **Step 6: Implement batch preparation and failure collection**

Expand `translateAllProgress.status` with `"cleaning"`. Initialize a local and
state failure list:

```ts
const [batchFailures, setBatchFailures] = useState<BatchPageFailure[]>([]);
const failures: BatchPageFailure[] = [];
```

For every untranslated page, prepare before the existing retry loop:

```ts
setTranslateAllProgress({
  current: i + 1,
  total: pages.length,
  status: "cleaning",
  message: `กำลังคลีนหน้า ${i + 1}/${pages.length}`,
  startTime: batchStartTime,
});

let preparedUrl: string;
try {
  preparedUrl = await preparePageForTranslation(pageUrl, i);
} catch (error) {
  failures.push({
    pageIndex: i,
    pageUrl,
    stage: "cleaning",
    message: error instanceof Error ? error.message : "คลีนไม่สำเร็จ",
  });
  setBatchFailures([...failures]);
  continue;
}

setTranslateAllProgress({
  current: i + 1,
  total: pages.length,
  status: "translating",
  message: `กำลังแปลหน้า ${i + 1}/${pages.length}`,
  startTime: batchStartTime,
});
```

The existing bounded retry loop calls:

```ts
success = await performTranslation(
  preparedUrl,
  pageUrl,
  i,
  forceNsfw,
);
```

It never calls preparation again. Record an exhausted/non-retryable translation
failure with stage `"translation"` and continue. Keep the existing quota abort
only for a quota state that prevents every later page from progressing.

On completion:

```ts
const failedPages = failures.map(({ pageIndex }) => pageIndex + 1);
setTranslationResult(
  failedPages.length === 0
    ? "✅ แปลทั้งเล่มเสร็จแล้ว"
    : `⚠️ แปลเสร็จ แต่หน้า ${failedPages.join(", ")} ต้องลองใหม่`,
);
```

Add and return:

```ts
const invalidatePageTranslation = useCallback((pageUrl: string) => {
  bubbleCacheRef.current.delete(pageUrl);
  translatedImageCacheRef.current.delete(pageUrl);
  if (activePageRef.current === pageUrl) setActiveBubbles([]);
}, []);
```

Return `workflowPhase`, `batchFailures`, and `invalidatePageTranslation`.
Cancellation checks remain before preparation, before retry, and after cooldown,
so no later page begins after `cancelTranslateAll`.

- [ ] **Step 7: Run tests**

```powershell
npm test -- tests/translation/useTranslation.test.tsx tests/translation/requestError.test.ts
```

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```powershell
git add hooks/useTranslation.ts tests/translation/useTranslation.test.tsx
git commit -m "feat(translation): prepare clean pages"
```

---

### Task 3: Result Layer Selector

**Files:**
- Modify: `components/cleaning/CleaningToolbar.tsx`
- Modify: `tests/cleaning/CleaningToolbar.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Produces: `WorkspaceLayer = "original" | "clean" | "translated" | "mask"`
- Adds: `hasTranslated: boolean`

- [ ] **Step 1: Write failing tests**

```tsx
test("offers original clean and translated as primary layers", () => {
  const onLayerChange = vi.fn();
  render(
    <CleaningToolbar
      hasPage
      hasResult
      hasTranslated
      layer="translated"
      onClean={vi.fn()}
      onEditMask={vi.fn()}
      onLayerChange={onLayerChange}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Original" }));
  fireEvent.click(screen.getByRole("button", { name: "Clean" }));
  fireEvent.click(screen.getByRole("button", { name: "Translated" }));
  expect(onLayerChange.mock.calls).toEqual([
    ["original"],
    ["clean"],
    ["translated"],
  ]);
});

test("disables unavailable derived layers and advanced mask", () => {
  render(
    <CleaningToolbar
      hasPage
      hasResult={false}
      hasTranslated={false}
      layer="original"
      onClean={vi.fn()}
      onEditMask={vi.fn()}
      onLayerChange={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "Clean" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Translated" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Mask" })).toBeDisabled();
});
```

Add `hasTranslated` to the two existing test renders.

- [ ] **Step 2: Verify the tests fail**

```powershell
npm test -- tests/cleaning/CleaningToolbar.test.tsx
```

Expected: FAIL because Translated and `hasTranslated` are absent.

- [ ] **Step 3: Implement the selector**

```ts
export type WorkspaceLayer =
  | "original"
  | "clean"
  | "translated"
  | "mask";

const primaryLayers: Array<{
  value: Exclude<WorkspaceLayer, "mask">;
  label: string;
}> = [
  { value: "original", label: "Original" },
  { value: "clean", label: "Clean" },
  { value: "translated", label: "Translated" },
];
```

Render these three together. Disable Clean without `hasResult`; disable
Translated without `hasTranslated`. Render Mask as a separate advanced button
beside `แก้ Mask`, disabled without a cleaning result. Preserve progress,
offline recovery, `aria-pressed`, and keyboard focus styles.

Replace the old CSS with:

```css
/* Only the Translated workspace layer shows generated text overlays. */
.hide-translation .tl-canvas,
.hide-translation .tl-overlay {
  opacity: 0 !important;
  pointer-events: none !important;
  transition: opacity 0.2s ease;
}
```

- [ ] **Step 4: Run tests**

```powershell
npm test -- tests/cleaning/CleaningToolbar.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add components/cleaning/CleaningToolbar.tsx tests/cleaning/CleaningToolbar.test.tsx src/app/globals.css
git commit -m "feat(ui): add translated workspace layer"
```

---

### Task 4: Workspace Integration

**Files:**
- Modify: `src/app/page.tsx`
- Create: `tests/workflow/WorkspacePage.test.tsx`

**Interfaces:**
- Consumes all interfaces from Tasks 1-3.

- [ ] **Step 1: Write the failing wiring test**

```tsx
import { render } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

import { useCleaning } from "@/hooks/useCleaning";
import { useTranslation } from "@/hooks/useTranslation";
import WorkspacePage from "@/src/app/page";

vi.mock("@/hooks/useCleaning");
vi.mock("@/hooks/useTranslation");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useCleaning).mockReturnValue({
    cleanPage: vi.fn(),
    cleanCurrentPage: vi.fn(),
    retryRegion: vi.fn(),
    cancelPolling: vi.fn(),
    currentResult: undefined,
    progress: undefined,
    error: undefined,
    resultsByPage: new Map(),
  } as never);
  vi.mocked(useTranslation).mockReturnValue({
    targetLang: "Thai",
    setTargetLang: vi.fn(),
    sourceLang: "auto",
    setSourceLang: vi.fn(),
    modelPreference: "auto",
    setModelPreference: vi.fn(),
    textStyle: {
      fontFamily: "Itim, sans-serif",
      textColor: "#000000",
      textOutline: "#FFFFFF",
      fontSizeMultiplier: 1,
    },
    setTextStyle: vi.fn(),
    nsfwBypassMode: false,
    setNsfwBypassMode: vi.fn(),
    isTranslating: false,
    translationResult: null,
    setTranslationResult: vi.fn(),
    showTranslate: false,
    setShowTranslate: vi.fn(),
    handleTranslate: vi.fn(),
    isTranslatingAll: false,
    translateAllProgress: null,
    handleTranslateAll: vi.fn(),
    cancelTranslateAll: vi.fn(),
    translateCrop: vi.fn(),
    activeBubbles: [],
    setActiveBubbles: vi.fn(),
    translatedImageCacheRef: { current: new Map() },
    bubbleCacheRef: { current: new Map() },
    textStyleRef: { current: {} },
    userApiKey: "",
    setUserApiKey: vi.fn(),
    restoreSavedSession: vi.fn().mockResolvedValue(null),
    clearSavedSession: vi.fn(),
    workflowPhase: null,
    batchFailures: [],
    invalidatePageTranslation: vi.fn(),
  } as never);
});

test("supplies clean-page preparation to translation", () => {
  render(<WorkspacePage />);
  const input = vi.mocked(useTranslation).mock.calls[0][0];
  expect(input.preparePageForTranslation).toEqual(expect.any(Function));
});
```

- [ ] **Step 2: Verify the test fails**

```powershell
npm test -- tests/workflow/WorkspacePage.test.tsx
```

Expected: FAIL because the page does not pass preparation.

- [ ] **Step 3: Connect cleaning and translation**

Import `useCallback`, `WorkspaceLayer`, `CleanerOverride`, and
`ManualRegionAction`. Destructure `cleanPage`, then define before
`useTranslation`:

```ts
const preparePageForTranslation = useCallback(
  async (pageUrl: string): Promise<string> => {
    const cached = cleaningResultsByPage.get(pageUrl);
    if (cached) return cached.cleanUrl;
    const response = await fetch(pageUrl);
    if (!response.ok) {
      throw new Error(`โหลดภาพสำหรับคลีนไม่สำเร็จ (HTTP ${response.status})`);
    }
    const result = await cleanPage(pageUrl, await response.blob());
    return result.cleanUrl;
  },
  [cleanPage, cleaningResultsByPage],
);
```

Pass `preparePageForTranslation` to `useTranslation`. Use `workflowPhase` for
single-button copy. Use `translateAllProgress.message` in desktop/mobile batch
cards.

- [ ] **Step 4: Unify workspace layer state**

Replace `showOriginal` and `cleaningLayer` with:

```ts
const [workspaceLayer, setWorkspaceLayer] =
  useState<WorkspaceLayer>("original");
```

For single view:

```ts
const originalUrl = pages[currentPage].url;
const cleanUrl = currentCleaningResult?.cleanUrl ?? originalUrl;
const mainImageUrl =
  workspaceLayer === "original" ? originalUrl : cleanUrl;
const hidesTranslation = workspaceLayer !== "translated";
```

Use `mainImageUrl` for the image, add `hide-translation` when
`hidesTranslation`, and render mask overlays only for `"mask"`.

For scroll view:

```ts
const translatedUrl = translatedImageCacheRef.current.get(p.url);
const cleanUrl = cleaningResultsByPage.get(p.url)?.cleanUrl ?? p.url;
const imgSrc =
  workspaceLayer === "original"
    ? p.url
    : workspaceLayer === "translated" && translatedUrl
      ? translatedUrl
      : cleanUrl;
```

Space and the eye control toggle Original/Translated. Export and download checks
use `workspaceLayer === "translated"` instead of `!showOriginal`.

- [ ] **Step 5: Select results and invalidate stale translations**

```ts
const handleTranslateCurrentPage = useCallback(async () => {
  const success = await handleTranslate();
  if (success) setWorkspaceLayer("translated");
}, [handleTranslate]);

const handleCleanCurrentPage = async () => {
  const page = pages[currentPage];
  if (!page) return;
  const response = await fetch(page.url);
  if (!response.ok) {
    setTranslationResult(`❌ โหลดภาพไม่สำเร็จ (HTTP ${response.status})`);
    return;
  }
  await cleanCurrentPage(await response.blob());
  invalidatePageTranslation(page.url);
  setWorkspaceLayer("clean");
};

const handleRetryRegion = async (
  regionId: string,
  mask: Blob,
  cleaner: CleanerOverride = "auto",
  action: ManualRegionAction = "automatic",
) => {
  const updated = await retryRegion(regionId, mask, cleaner, action);
  const page = pages[currentPage];
  if (!updated || !page) return;
  invalidatePageTranslation(page.url);
  setWorkspaceLayer("clean");
};
```

Use `handleTranslateCurrentPage` for desktop, mobile, and keyboard. Set
Translated when Translate All starts. Pass `handleRetryRegion` to Mask Editor.
Pass `hasTranslated`, `workspaceLayer`, and `setWorkspaceLayer` to the toolbar.

- [ ] **Step 6: Run focused regression tests**

```powershell
npm test -- tests/workflow/WorkspacePage.test.tsx tests/translation/useTranslation.test.tsx tests/cleaning/useCleaning.test.tsx tests/cleaning/CleaningToolbar.test.tsx tests/cleaning/MaskEditor.test.tsx tests/cleaning/translationOverlay.test.ts
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/app/page.tsx tests/workflow/WorkspacePage.test.tsx
git commit -m "feat(workflow): clean before translation"
```

---

### Task 5: Verification

**Files:**
- Verification only.

- [ ] **Step 1: Run all tests**

```powershell
npm test
```

Expected: all suites PASS.

- [ ] **Step 2: Run types and scoped lint**

```powershell
npx tsc --noEmit
npx eslint hooks/useCleaning.ts hooks/useTranslation.ts components/cleaning/CleaningToolbar.tsx src/app/page.tsx tests/cleaning/useCleaning.test.tsx tests/cleaning/CleaningToolbar.test.tsx tests/translation/useTranslation.test.tsx tests/workflow/WorkspacePage.test.tsx
```

Expected: both commands exit 0 with no new errors.

- [ ] **Step 3: Run production build**

```powershell
npm run build
```

Expected: Next.js production build succeeds.

- [ ] **Step 4: Smoke-test uncached and cached paths**

At `http://localhost:3000` with cleaner `http://127.0.0.1:8765`:

1. Upload one untranslated page.
2. Press Translate.
3. Observe Cleaning, then Translating.
4. Verify translation appears over clean pixels.
5. Switch Original, Clean, and Translated.
6. Translate the same page again and confirm cleaning is not submitted again.
7. Run a two-page batch with a mocked cleaning failure on page 1.
8. Confirm page 2 runs and the final message lists page 1.

- [ ] **Step 5: Final diff check**

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors and no uncommitted implementation files.
