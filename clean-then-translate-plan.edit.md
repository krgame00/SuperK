# Clean-Then-Translate Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make both translation commands prepare a clean page first, reuse clean results, expose cleaning/translation phases, isolate batch failures, and preserve manual cleaning controls.

**Architecture:** Keep `useCleaning` and `useTranslation` independent. `WorkspacePage` supplies an async page-preparation callback that returns clean pixels while `useTranslation` keeps original page URLs as cache identities; the translation hook owns phase, retry, cancellation, and batch failure state. A unified workspace layer controls Original, Clean, Translated, and advanced Mask display.

**Tech Stack:** Next.js 16.2.10 App Router, React 19.2.4 client hooks, TypeScript 5, Vitest 4.1.10, Testing Library, Tailwind CSS 4.

## Global Constraints

- Use the existing worktree and branch `codex/superk-hybrid-cleaning`.
- Follow `AGENTS.md`; before code edits, read `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`.
- Use client hooks and browser APIs only below the existing `"use client"` boundary.
- Run one page at a time: clean page, translate page, then continue.
- Never fall back to translating original pixels after a cleaning failure.
- Reuse valid cleaning results keyed by the original page URL.
- Keep translation bubbles, rendered-image caches, session data, and navigation keyed by the original page URL.
- Preserve detector, SFX policy, cleaner, Gemini prompt, model, API-key, retry, and timeout behavior.
- Keep manual Clean, Mask Editor, Force Clean, and Protect controls.
- Do not add scroll-triggered automatic translation or parallel page processing.
- Use Thai status copy `กำลังคลีนหน้า X/Y` and `กำลังแปลหน้า X/Y`.
- Implement with failing tests first and commit after every task.

---

## File Map

- Modify `hooks/useCleaning.ts`: add explicit page cleaning that returns a hydrated result and can run for a non-current page.
- Modify `tests/cleaning/useCleaning.test.tsx`: cover cached reuse, non-current pages, error propagation, and retry result return.
- Modify `hooks/useTranslation.ts`: accept a clean-image preparation callback, separate pixel URL from cache identity, expose workflow phase/failures, and invalidate stale translations.
- Create `tests/translation/useTranslation.test.tsx`: cover single and batch orchestration, failure isolation, cache identity, retry reuse, and cancellation.
- Modify `components/cleaning/CleaningToolbar.tsx`: make Original/Clean/Translated the primary layer selector and keep Mask advanced.
- Modify `tests/cleaning/CleaningToolbar.test.tsx`: cover translated-layer availability and advanced Mask.
- Modify `src/app/page.tsx`: wire hooks together, replace `showOriginal` with one workspace layer, select Translated after success, and invalidate translations after manual re-cleaning.
- Modify `src/app/globals.css`: hide translation overlays for every layer except Translated.
- Create `tests/workflow/WorkspacePage.test.tsx`: integration coverage for clean-before-translate wiring and layer selection.

---

### Task 1: Explicit Page Cleaning Contract

**Files:**
- Modify: `hooks/useCleaning.ts:40-335`
- Test: `tests/cleaning/useCleaning.test.tsx`

**Interfaces:**
- Produces: `cleanPage(pageUrl: string, source: Blob): Promise<PageCleaningResult>`
- Produces: `retryRegion(...): Promise<PageCleaningResult | undefined>`
- Preserves: `cleanCurrentPage(source: Blob): Promise<void>`
- Preserves: `resultsByPage: Map<string, PageCleaningResult>`

- [ ] **Step 1: Add failing tests for explicit, cached, and non-current page cleaning**

Append tests that call the new API directly:

```tsx
test("cleanPage returns a hydrated result and reuses it by original URL", async () => {
  vi.mocked(createCleaningJob).mockResolvedValue(succeededJob);
  vi.mocked(getCleaningResult).mockResolvedValue(cleaningResult);
  const { result } = renderHook(() =>
    useCleaning({ pages: ["blob:one"], currentPage: 0 }),
  );
  let first!: Awaited<ReturnType<typeof result.current.cleanPage>>;
  await act(async () => {
    first = await result.current.cleanPage(
      "blob:one",
      new Blob(["png"], { type: "image/png" }),
    );
  });
  let second!: Awaited<ReturnType<typeof result.current.cleanPage>>;
  await act(async () => {
    second = await result.current.cleanPage(
      "blob:one",
      new Blob(["png"], { type: "image/png" }),
    );
  });
  expect(first.cleanUrl).toBe("blob:clean");
  expect(second).toBe(first);
  expect(createCleaningJob).toHaveBeenCalledOnce();
});

test("cleanPage completes for a page that is not currently selected", async () => {
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

test("cleanPage records and rethrows service failures", async () => {
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

- [ ] **Step 2: Run the focused tests and verify the new API is missing**

Run:

```powershell
npm test -- tests/cleaning/useCleaning.test.tsx
```

Expected: FAIL because `cleanPage` is not returned by `useCleaning`.

- [ ] **Step 3: Return hydrated results from the internal job pipeline**

Change the internal signatures and return values:

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

Remove the `pageUrl !== pageUrlRef.current` cancellation checks from
`waitForJob` and `finishJob`; explicit batch cleaning must not depend on the
visible page.

- [ ] **Step 4: Add `cleanPage` and preserve manual page-change cancellation**

Track whether the active request belongs to the manual current-page command:

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
    cancelOnPageChangeRef.current = false;
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
      // The manual toolbar reads the structured hook error.
    } finally {
      cancelOnPageChangeRef.current = false;
    }
  },
  [cleanPage],
);
```

Return `cleanPage` from the hook. Update `retryRegion` and `finishJob` call sites
so a successful retry returns the replacement `PageCleaningResult`; preserve
`undefined` for missing page/result and preserve the existing manual error UI.

- [ ] **Step 5: Run cleaning tests**

Run:

```powershell
npm test -- tests/cleaning/useCleaning.test.tsx
```

Expected: all tests PASS, including the existing page-change cancellation test.

- [ ] **Step 6: Commit the cleaning contract**

```powershell
git add hooks/useCleaning.ts tests/cleaning/useCleaning.test.tsx
git commit -m "feat(cleaning): expose page preparation"
```

---

### Task 2: Translation Workflow Coordinator

**Files:**
- Modify: `hooks/useTranslation.ts:15-600`
- Create: `tests/translation/useTranslation.test.tsx`

**Interfaces:**
- Consumes: `preparePageForTranslation(pageUrl: string, pageIndex: number): Promise<string>`
- Produces: `workflowPhase: "cleaning" | "translating" | null`
- Produces: `translateAllProgress.status: "cleaning" | "translating" | "waiting" | "cooldown"`
- Produces: `batchFailures: Array<{ pageIndex: number; pageUrl: string; stage: "cleaning" | "translation"; message: string }>`
- Produces: `invalidatePageTranslation(pageUrl: string): void`
- Produces: `handleTranslate(): Promise<boolean>`
- Preserves: translation API payload, model/key selection, NSFW slicing, retries, and original-URL cache keys.

- [ ] **Step 1: Create failing single-page orchestration tests**

Mock the overlay and project store, then verify preparation order and identity:

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

const translatedResponse = new Response(
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
  const calls: string[] = [];
  const preparePageForTranslation = vi.fn(async () => {
    calls.push("clean");
    return "blob:clean";
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url === "blob:clean") {
      calls.push("load-clean");
      return new Response(new Blob(["clean"], { type: "image/png" }));
    }
    if (url === "/api/translate") {
      calls.push("translate");
      return translatedResponse.clone();
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
  expect(calls).toEqual(["clean", "load-clean", "translate"]);
  expect(result.current.bubbleCacheRef.current.has("blob:original")).toBe(true);
  expect(result.current.bubbleCacheRef.current.has("blob:clean")).toBe(false);
});

test("does not call translation when cleaning fails", async () => {
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

- [ ] **Step 2: Run tests and verify the preparation prop is missing**

Run:

```powershell
npm test -- tests/translation/useTranslation.test.tsx
```

Expected: FAIL because `preparePageForTranslation` and the boolean return
contract do not exist.

- [ ] **Step 3: Separate pixel URL from page identity**

Add the prop and workflow types:

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

Change the internal translation signature:

```ts
const performTranslation = async (
  preparedUrl: string,
  pageUrl: string,
  pageIndex: number,
  forceNsfwBypass = false,
  isAutoRetry = false,
): Promise<boolean> => {
  const resImg = await fetch(preparedUrl);
  // Keep pageUrl for activePageRef, bubbleCacheRef, and
  // translatedImageCacheRef. Use preparedUrl for Image.src in slicing
  // and enhanced-image retry paths.
};
```

Replace every pixel read inside `performTranslation` with `preparedUrl`, while
leaving every cache lookup/set and active-page comparison on `pageUrl`.

- [ ] **Step 4: Prepare once before the translation/retry loop**

Implement the single-page sequence:

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

Add tests proving preparation happens once per page, cleaning failure skips the
translation retry loop, and later pages continue:

```tsx
test("batch skips a cleaning failure and continues in page order", async () => {
  vi.useFakeTimers();
  const events: string[] = [];
  const preparePageForTranslation = vi.fn(async (url: string) => {
    events.push(`clean:${url}`);
    if (url === "blob:two") throw new Error("clean failed");
    return `blob:clean-${url.split(":")[1]}`;
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.startsWith("blob:clean-")) {
      events.push(`load:${url}`);
      return new Response(new Blob(["clean"], { type: "image/png" }));
    }
    if (url === "/api/translate") {
      events.push("translate");
      return translatedResponse.clone();
    }
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
  expect(result.current.bubbleCacheRef.current.has("blob:one")).toBe(true);
  expect(result.current.bubbleCacheRef.current.has("blob:two")).toBe(false);
  expect(result.current.bubbleCacheRef.current.has("blob:three")).toBe(true);
  vi.useRealTimers();
});
```

Add a second test whose `/api/translate` first response is a structured retryable
failure and second response succeeds; assert
`preparePageForTranslation` was called once while `/api/translate` was called
twice. Add a cancellation test that cancels during the inter-page cooldown and
asserts preparation was never called for the next page.

- [ ] **Step 6: Implement batch phases, failure collection, and invalidation**

Prepare outside the translation retry loop:

```ts
const [batchFailures, setBatchFailures] = useState<BatchPageFailure[]>([]);

for (let i = 0; i < pages.length; i += 1) {
  if (cancelTranslateAllRef.current) break;
  const pageUrl = pages[i];
  if (translatedImageCacheRef.current.has(pageUrl)) continue;

  let preparedUrl: string;
  setTranslateAllProgress({
    current: i + 1,
    total: pages.length,
    status: "cleaning",
    message: `กำลังคลีนหน้า ${i + 1}/${pages.length}`,
    startTime: batchStartTime,
  });
  try {
    preparedUrl = await preparePageForTranslation(pageUrl, i);
  } catch (error) {
    failures.push({
      pageIndex: i,
      pageUrl,
      stage: "cleaning",
      message: error instanceof Error ? error.message : "คลีนไม่สำเร็จ",
    });
    continue;
  }

  setTranslateAllProgress({
    current: i + 1,
    total: pages.length,
    status: "translating",
    message: `กำลังแปลหน้า ${i + 1}/${pages.length}`,
    startTime: batchStartTime,
  });
  // Existing bounded translation retry loop uses preparedUrl for every attempt.
}
```

Use a local `failures: BatchPageFailure[]` for deterministic accumulation, set
state after every append, and produce final copy containing 1-based failed page
numbers. Preserve the existing quota-specific abort only when its existing
policy says the whole batch cannot make progress.

Add:

```ts
const invalidatePageTranslation = useCallback((pageUrl: string) => {
  bubbleCacheRef.current.delete(pageUrl);
  translatedImageCacheRef.current.delete(pageUrl);
  if (activePageRef.current === pageUrl) setActiveBubbles([]);
}, []);
```

Return `workflowPhase`, `batchFailures`, and `invalidatePageTranslation`.

- [ ] **Step 7: Run translation tests**

Run:

```powershell
npm test -- tests/translation/useTranslation.test.tsx tests/translation/requestError.test.ts
```

Expected: all tests PASS.

- [ ] **Step 8: Commit translation orchestration**

```powershell
git add hooks/useTranslation.ts tests/translation/useTranslation.test.tsx
git commit -m "feat(translation): prepare clean pages"
```

---

### Task 3: Workspace Layer Selector

**Files:**
- Modify: `components/cleaning/CleaningToolbar.tsx:1-100`
- Modify: `tests/cleaning/CleaningToolbar.test.tsx`
- Modify: `src/app/globals.css:45-50`

**Interfaces:**
- Produces: `WorkspaceLayer = "original" | "clean" | "translated" | "mask"`
- Adds prop: `hasTranslated: boolean`
- Preserves: manual clean action, progress, offline recovery, Mask Editor action.

- [ ] **Step 1: Write failing toolbar tests**

Update the existing render and add:

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

test("keeps mask separate and disables unavailable derived layers", () => {
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

- [ ] **Step 2: Run toolbar tests and verify the prop/type failure**

Run:

```powershell
npm test -- tests/cleaning/CleaningToolbar.test.tsx
```

Expected: FAIL because `hasTranslated` and the Translated layer do not exist.

- [ ] **Step 3: Implement primary and advanced layers**

Replace the type and primary layer list:

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

Render the three primary buttons together. Disable Clean without
`hasResult`, disable Translated without `hasTranslated`, and render Mask as a
separate advanced button beside `แก้ Mask`. Keep existing accessible pressed
state and focus styling.

Replace the CSS selector with:

```css
/* Only the Translated workspace layer shows generated text overlays. */
.hide-translation .tl-canvas,
.hide-translation .tl-overlay {
  opacity: 0 !important;
  pointer-events: none !important;
  transition: opacity 0.2s ease;
}
```

- [ ] **Step 4: Run toolbar tests**

Run:

```powershell
npm test -- tests/cleaning/CleaningToolbar.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 5: Commit the layer selector**

```powershell
git add components/cleaning/CleaningToolbar.tsx tests/cleaning/CleaningToolbar.test.tsx src/app/globals.css
git commit -m "feat(ui): add translated workspace layer"
```

---

### Task 4: Wire Clean-Then-Translate into the Workspace

**Files:**
- Modify: `src/app/page.tsx:1-220, 640-920, 1013-1165, 1395-1403`
- Create: `tests/workflow/WorkspacePage.test.tsx`

**Interfaces:**
- Consumes: `cleanPage(pageUrl, source): Promise<PageCleaningResult>`
- Consumes: `preparePageForTranslation(pageUrl, pageIndex): Promise<string>`
- Consumes: `workflowPhase`, `batchFailures`, and `invalidatePageTranslation`
- Consumes: `WorkspaceLayer`

- [ ] **Step 1: Create a failing workspace integration test**

Mock both hooks and assert the translation hook receives a preparation callback:

```tsx
import { act, render } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

import WorkspacePage from "@/app/page";
import { useCleaning } from "@/hooks/useCleaning";
import { useTranslation } from "@/hooks/useTranslation";

vi.mock("@/hooks/useCleaning");
vi.mock("@/hooks/useTranslation");

const cleanPage = vi.fn();
const translateDefaults = {
  targetLang: "Thai",
  setTargetLang: vi.fn(),
  isTranslating: false,
  translationResult: null,
  setTranslationResult: vi.fn(),
  handleTranslate: vi.fn(),
  isTranslatingAll: false,
  translateAllProgress: null,
  handleTranslateAll: vi.fn(),
  cancelTranslateAll: vi.fn(),
  activeBubbles: [],
  setActiveBubbles: vi.fn(),
  translateCrop: vi.fn(),
  nsfwBypassMode: false,
  setNsfwBypassMode: vi.fn(),
  translatedImageCacheRef: { current: new Map() },
  bubbleCacheRef: { current: new Map() },
  textStyleRef: { current: {} },
  userApiKey: "",
  setUserApiKey: vi.fn(),
  modelPreference: "auto",
  setModelPreference: vi.fn(),
  sourceLang: "auto",
  setSourceLang: vi.fn(),
  textStyle: {},
  setTextStyle: vi.fn(),
  restoreSavedSession: vi.fn().mockResolvedValue(null),
  clearSavedSession: vi.fn(),
  workflowPhase: null,
  batchFailures: [],
  invalidatePageTranslation: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useCleaning).mockReturnValue({
    cleanPage,
    cleanCurrentPage: vi.fn(),
    retryRegion: vi.fn(),
    currentResult: undefined,
    progress: undefined,
    error: undefined,
    resultsByPage: new Map(),
    cancelPolling: vi.fn(),
  });
  vi.mocked(useTranslation).mockReturnValue(translateDefaults as never);
});

test("supplies clean-page preparation to translation", async () => {
  render(<WorkspacePage />);
  const props = vi.mocked(useTranslation).mock.calls[0][0];
  expect(props.preparePageForTranslation).toEqual(expect.any(Function));
});
```

Extend this file with a focused toolbar-layer test after the component wiring is
implemented: seed one uploaded page through the existing file input, return a
clean result and translated cache from the hook mocks, click Original, Clean,
and Translated, and assert the main image URL and `.hide-translation` class.

- [ ] **Step 2: Run the integration test and verify the callback is absent**

Run:

```powershell
npm test -- tests/workflow/WorkspacePage.test.tsx
```

Expected: FAIL because `WorkspacePage` does not pass
`preparePageForTranslation`.

- [ ] **Step 3: Wire page preparation**

Import `useCallback` and `WorkspaceLayer`. Destructure `cleanPage`, then define:

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

Pass it into `useTranslation`. Use the returned `workflowPhase` to change the
desktop and mobile button loading copy between `กำลังคลีน...` and
`กำลังแปล...`. Continue using `translateAllProgress.message` in both batch
progress surfaces.

- [ ] **Step 4: Replace overlapping view flags with one layer**

Replace `showOriginal` and `cleaningLayer` with:

```ts
const [workspaceLayer, setWorkspaceLayer] =
  useState<WorkspaceLayer>("original");
```

Use these image rules in single view:

```ts
const originalUrl = pages[currentPage].url;
const cleanUrl = currentCleaningResult?.cleanUrl ?? originalUrl;
const mainImageUrl =
  workspaceLayer === "original" ? originalUrl : cleanUrl;
const hidesTranslation = workspaceLayer !== "translated";
```

Add `hide-translation` to the container when `hidesTranslation`. Show masks only
for `workspaceLayer === "mask"`.

Use these image rules in scroll view:

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

Update Space and eye-button behavior to toggle Original and Translated. Update
download guards and export decisions to check
`workspaceLayer === "translated"` instead of `!showOriginal`.

- [ ] **Step 5: Select Translated after success and invalidate manual repairs**

Wrap the commands:

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
  cleaner?: CleanerOverride,
  action?: ManualRegionAction,
) => {
  const updated = await retryRegion(regionId, mask, cleaner, action);
  if (!updated || !pages[currentPage]) return;
  invalidatePageTranslation(pages[currentPage].url);
  setWorkspaceLayer("clean");
};
```

Use `handleTranslateCurrentPage` for desktop, mobile, and keyboard commands. Pass
`handleRetryRegion` to `MaskEditor`. Set Translated when a batch starts so the
currently visible page shows its result as soon as its overlay is applied.

Pass `hasTranslated` and the unified layer props to `CleaningToolbar`.

- [ ] **Step 6: Show batch failure summary**

After batch completion, keep the hook's Thai summary visible for the existing
toast duration. Include failed page numbers in the message:

```ts
const failedPages = failures.map(({ pageIndex }) => pageIndex + 1);
setTranslationResult(
  failedPages.length === 0
    ? "✅ แปลทั้งเล่มเสร็จแล้ว"
    : `⚠️ แปลเสร็จ แต่หน้า ${failedPages.join(", ")} ต้องลองใหม่`,
);
```

Do not create a new modal. Individual retry remains the normal Translate button
after navigating to a failed page.

- [ ] **Step 7: Run integration and focused regression tests**

Run:

```powershell
npm test -- tests/workflow/WorkspacePage.test.tsx tests/cleaning/CleaningToolbar.test.tsx tests/cleaning/useCleaning.test.tsx tests/translation/useTranslation.test.tsx tests/cleaning/MaskEditor.test.tsx tests/cleaning/translationOverlay.test.ts
```

Expected: all tests PASS.

- [ ] **Step 8: Commit workspace integration**

```powershell
git add src/app/page.tsx tests/workflow/WorkspacePage.test.tsx
git commit -m "feat(workflow): clean before translation"
```

---

### Task 5: Verification and Local Smoke Test

**Files:**
- Verify only; modify implementation/tests only if a failure exposes a defect.

**Interfaces:**
- Verifies the complete clean-then-translate workflow without changing backend
  cleaning or Gemini contracts.

- [ ] **Step 1: Run all frontend tests**

Run:

```powershell
npm test
```

Expected: all Vitest suites PASS.

- [ ] **Step 2: Run TypeScript**

Run:

```powershell
npx tsc --noEmit
```

Expected: exit code 0.

- [ ] **Step 3: Run scoped lint**

Run:

```powershell
npx eslint hooks/useCleaning.ts hooks/useTranslation.ts components/cleaning/CleaningToolbar.tsx src/app/page.tsx tests/cleaning/useCleaning.test.tsx tests/cleaning/CleaningToolbar.test.tsx tests/translation/useTranslation.test.tsx tests/workflow/WorkspacePage.test.tsx
```

Expected: exit code 0 with no new errors.

- [ ] **Step 4: Run the production build**

Run:

```powershell
npm run build
```

Expected: Next.js production build completes successfully.

- [ ] **Step 5: Smoke-test one uncached and one cached page**

With the existing frontend at `http://localhost:3000` and cleaning service at
`http://127.0.0.1:8765`:

1. Upload one source page.
2. Press Translate and observe `กำลังคลีนหน้า 1/1`, then
   `กำลังแปลหน้า 1/1`.
3. Confirm the translated overlay is rendered over clean pixels.
4. Switch Original, Clean, and Translated and confirm each layer.
5. Press Translate again and confirm no second cleaning job is created.
6. Upload a two-page sample, stop the cleaner for page 1, and run Translate All.
7. Confirm page 1 is reported failed and page 2 is attempted after the cleaner
   is restored before its turn, or use a mocked browser test for deterministic
   failure isolation.

Expected: no original-pixel translation after cleaning failure, cached clean
reuse, correct phases, and selectable layers.

- [ ] **Step 6: Review the final diff and commit verification fixes if needed**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors and no uncommitted implementation changes. If a
verification defect required a fix, commit only those files:

```powershell
git add <exact-files-changed-for-the-fix>
git commit -m "fix(workflow): address verification defect"
```

