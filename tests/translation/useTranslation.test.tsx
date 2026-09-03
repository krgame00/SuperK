import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { useTranslation } from "@/hooks/useTranslation";
import { saveProjectSession } from "@/lib/projectStore";
import { applyTranslationOverlay } from "@/lib/translationOverlay";

vi.mock("@/lib/translationOverlay", () => ({
  applyTranslationOverlay: vi.fn(
    async (
      _bubbles: unknown[],
      _viewMode: "single" | "scroll" | "offscreen",
      _pageIndex: number,
      _setTranslationResult: (message: string | null) => void,
      onComplete?: (dataUrl: string) => void,
      _textStyleRef?: unknown,
      containerOverride?: HTMLElement,
    ) => {
      const preparedSrc = containerOverride
        ?.querySelector("img")
        ?.getAttribute("src");
      onComplete?.(
        containerOverride
          ? `data:offscreen,${preparedSrc}`
          : "data:interactive",
      );
    },
  ),
}));

vi.mock("@/lib/projectStore", () => ({
  saveProjectSession: vi.fn().mockResolvedValue(undefined),
  loadProjectSession: vi.fn().mockResolvedValue(null),
  clearProjectSession: vi.fn().mockResolvedValue(undefined),
}));

const translatedBubble = {
  box: [10, 20, 40, 80],
  t: "สวัสดี",
};

const imageResponse = () =>
  new Response(Buffer.from("clean"), {
    status: 200,
    headers: { "Content-Type": "image/png" },
  });

const successResponse = () =>
  Response.json({
    text: JSON.stringify({
      bubbles: [translatedBubble],
    }),
  });

const storage = (() => {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, String(value));
    },
  } satisfies Storage;
})();

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
  storage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("reads Original pixels and renders translated bubbles onto Clean", async () => {
  const pages = ["blob:original"];
  const order: string[] = [];
  const preparePageForTranslation = vi.fn(async () => {
    order.push("clean");
    return {
      recognitionUrl: "blob:original",
      backgroundUrl: "blob:clean",
    };
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url === "blob:original") {
      order.push("load-original");
      return imageResponse();
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
      pages,
      viewMode: "single",
      preparePageForTranslation,
    }),
  );

  await act(async () => {
    expect(await result.current.handleTranslate()).toBe(true);
  });

  expect(order).toEqual(["clean", "load-original", "translate"]);
  const offscreenCall = vi
    .mocked(applyTranslationOverlay)
    .mock.calls.find((call) => call[1] === "offscreen");
  expect(
    offscreenCall?.[6]?.querySelector("img")?.getAttribute("src"),
  ).toBe("blob:clean");
});
test("keeps translation caches keyed by the original URL", async () => {
  const pages = ["blob:original"];
  const preparePageForTranslation = vi.fn().mockResolvedValue({
    recognitionUrl: "blob:original",
    backgroundUrl: "blob:clean",
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url === "blob:original") return imageResponse();
    if (url === "/api/translate") return successResponse();
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

  await act(async () => {
    await result.current.handleTranslate();
  });

  expect(result.current.bubbleCacheRef.current.has("blob:original")).toBe(true);
  expect(result.current.bubbleCacheRef.current.has("blob:clean")).toBe(false);
  expect(
    result.current.translatedImageCacheRef.current.has("blob:original"),
  ).toBe(true);
  expect(
    result.current.translatedImageCacheRef.current.has("blob:clean"),
  ).toBe(false);
});

test("cleaning failure prevents every translation fetch", async () => {
  const pages = ["blob:original"];
  const preparePageForTranslation = vi
    .fn()
    .mockRejectedValue(new Error("clean failed"));
  const fetchSpy = vi.spyOn(globalThis, "fetch");

  const { result } = renderHook(() =>
    useTranslation({
      currentPage: 0,
      pages,
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

test("batch skips a cleaning failure and continues", async () => {
  vi.useFakeTimers();
  const pages = ["blob:one", "blob:two", "blob:three"];
  const preparePageForTranslation = vi.fn(async (url: string) => {
    if (url === "blob:two") throw new Error("clean failed");
    return {
      recognitionUrl: url,
      backgroundUrl: `blob:clean-${url.split(":")[1]}`,
    };
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (pages.includes(url)) return imageResponse();
    if (url === "/api/translate") return successResponse();
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
});

test("translation retry reuses one prepared URL", async () => {
  vi.useFakeTimers();
  const pages = ["blob:one"];
  const preparePageForTranslation = vi.fn().mockResolvedValue({
    recognitionUrl: "blob:one",
    backgroundUrl: "blob:clean",
  });
  let apiCalls = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url === "blob:one") return imageResponse();
    if (url === "/api/translate") {
      apiCalls += 1;
      if (apiCalls === 1) {
        return Response.json(
          {
            error: "Gemini timeout",
            code: "GEMINI_TIMEOUT",
            retryable: true,
          },
          { status: 504 },
        );
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
});

test("cancellation during preparation prevents the next page", async () => {
  vi.useFakeTimers();
  const pages = ["blob:one", "blob:two"];
  let cancelTranslateAll = () => {};
  const preparePageForTranslation = vi.fn(
    async (_url: string, pageIndex: number) => {
      if (pageIndex === 0) cancelTranslateAll();
      return {
        recognitionUrl: pages[pageIndex],
        backgroundUrl: `blob:clean-${pageIndex + 1}`,
      };
    },
  );
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (pages.includes(url)) return imageResponse();
    if (url === "/api/translate") return successResponse();
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
  cancelTranslateAll = result.current.cancelTranslateAll;

  let batch!: Promise<void>;
  act(() => {
    batch = result.current.handleTranslateAll();
  });
  await act(async () => {
    await vi.runAllTimersAsync();
    await batch;
  });

  expect(preparePageForTranslation).toHaveBeenCalledTimes(1);
  expect(preparePageForTranslation).toHaveBeenCalledWith("blob:one", 0);
  expect(result.current.bubbleCacheRef.current.has("blob:two")).toBe(false);
});

test("background batch renders final images by original URL and skips them later", async () => {
  vi.useFakeTimers();
  const pages = ["blob:one", "blob:two"];
  const preparePageForTranslation = vi.fn(
    async (url: string, pageIndex: number) => ({
      recognitionUrl: url,
      backgroundUrl: `blob:clean-${pageIndex + 1}`,
    }),
  );
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (pages.includes(url)) return imageResponse();
    if (url === "/api/translate") return successResponse();
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

  let firstBatch!: Promise<void>;
  act(() => {
    firstBatch = result.current.handleTranslateAll();
  });
  await act(async () => {
    await vi.runAllTimersAsync();
    await firstBatch;
  });

  expect(result.current.translatedImageCacheRef.current.has("blob:one")).toBe(
    true,
  );
  expect(result.current.translatedImageCacheRef.current.has("blob:two")).toBe(
    true,
  );
  expect(
    result.current.translatedImageCacheRef.current.has("blob:clean-2"),
  ).toBe(false);
  expect(vi.mocked(applyTranslationOverlay)).toHaveBeenCalledWith(
    expect.any(Array),
    "offscreen",
    1,
    expect.any(Function),
    expect.any(Function),
    expect.any(Object),
    expect.any(HTMLElement),
  );

  let secondBatch!: Promise<void>;
  act(() => {
    secondBatch = result.current.handleTranslateAll();
  });
  await act(async () => {
    await vi.runAllTimersAsync();
    await secondBatch;
  });
  expect(preparePageForTranslation).toHaveBeenCalledTimes(2);
});

test("quota exhaustion aborts before preparing the next page", async () => {
  const pages = ["blob:one", "blob:two"];
  const preparePageForTranslation = vi.fn(
    async (_url: string, pageIndex: number) => {
      if (pageIndex === 1) throw new Error("page two must not prepare");
      return {
        recognitionUrl: "blob:one",
        backgroundUrl: "blob:clean-one",
      };
    },
  );
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url === "blob:one") return imageResponse();
    if (url === "/api/translate") {
      return Response.json(
        {
          error: "Gemini quota exhausted",
          code: "GEMINI_QUOTA",
          retryable: false,
        },
        { status: 429 },
      );
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

  let batch!: Promise<void>;
  act(() => {
    batch = result.current.handleTranslateAll();
  });
  await act(async () => {
    await batch;
  });

  expect(preparePageForTranslation).toHaveBeenCalledOnce();
  expect(result.current.translationResult).toContain("โควต้า");
  expect(result.current.batchFailures).toEqual([
    expect.objectContaining({ pageIndex: 0, stage: "translation" }),
  ]);
});

test("persists translated caches after an inactive batch page completes", async () => {
  vi.useFakeTimers();
  const pages = ["blob:one", "blob:two"];
  const preparePageForTranslation = vi.fn(
    async (url: string, pageIndex: number) => ({
      recognitionUrl: url,
      backgroundUrl: `blob:clean-${pageIndex + 1}`,
    }),
  );
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (pages.includes(url)) return imageResponse();
    if (url === "/api/translate") return successResponse();
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

  let batch!: Promise<void>;
  act(() => {
    batch = result.current.handleTranslateAll();
  });
  await act(async () => {
    await vi.runAllTimersAsync();
    await batch;
  });

  expect(vi.mocked(saveProjectSession).mock.calls).toEqual(
    expect.arrayContaining([
      [
        expect.objectContaining({
          bubbleCache: expect.objectContaining({
            has: expect.any(Function),
          }),
          translatedImageCache: expect.objectContaining({
            has: expect.any(Function),
          }),
        }),
      ],
    ]),
  );
  const persisted = vi
    .mocked(saveProjectSession)
    .mock.calls.map(([session]) => session)
    .find(
      (session) =>
        session.bubbleCache.has("blob:two") &&
        session.translatedImageCache.has("blob:two"),
    );
  expect(persisted).toBeDefined();

  vi.mocked(saveProjectSession).mockClear();
  act(() => {
    result.current.invalidatePageTranslation("blob:two");
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
  const invalidated = vi
    .mocked(saveProjectSession)
    .mock.calls.map(([session]) => session)
    .find(
      (session) =>
        !session.bubbleCache.has("blob:two") &&
        !session.translatedImageCache.has("blob:two"),
    );
  expect(invalidated).toBeDefined();
});

test("reports cleaning then translating phases for one page", async () => {
  const pages = ["blob:one"];
  let resolvePreparation!: (prepared: {
    recognitionUrl: string;
    backgroundUrl: string;
  }) => void;
  let resolveImage!: (response: Response) => void;
  const preparePageForTranslation = vi.fn(
    () =>
      new Promise<{ recognitionUrl: string; backgroundUrl: string }>((resolve) => {
        resolvePreparation = resolve;
      }),
  );
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    if (url === "blob:one") {
      return new Promise<Response>((resolve) => {
        resolveImage = resolve;
      });
    }
    if (url === "/api/translate") return Promise.resolve(successResponse());
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

  let translation!: Promise<boolean>;
  act(() => {
    translation = result.current.handleTranslate();
  });
  expect(result.current.workflowPhase).toBe("cleaning");
  expect(result.current.translationResult).toContain("กำลังคลีนหน้า 1/1");

  await act(async () => {
    resolvePreparation({
      recognitionUrl: "blob:one",
      backgroundUrl: "blob:clean",
    });
    await Promise.resolve();
  });
  expect(result.current.workflowPhase).toBe("translating");
  expect(result.current.translationResult).toContain("กำลังแปลหน้า 1/1");

  await act(async () => {
    resolveImage(imageResponse());
    await translation;
  });
  expect(result.current.workflowPhase).toBeNull();
});

test("active and background pages cache from unique clean offscreen containers", async () => {
  vi.useFakeTimers();
  const pages = ["blob:one", "blob:two"];
  const preparePageForTranslation = vi.fn(
    async (url: string, pageIndex: number) => ({
      recognitionUrl: url,
      backgroundUrl: `blob:clean-${pageIndex + 1}`,
    }),
  );
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (pages.includes(url)) return imageResponse();
    if (url === "/api/translate") return successResponse();
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

  let batch!: Promise<void>;
  act(() => {
    batch = result.current.handleTranslateAll();
  });
  await act(async () => {
    await vi.runAllTimersAsync();
    await batch;
  });

  const overlayCalls = vi.mocked(applyTranslationOverlay).mock.calls;
  const offscreenCalls = overlayCalls.filter((call) => call[1] === "offscreen");
  expect(offscreenCalls).toHaveLength(2);
  const offscreenContainers = offscreenCalls.map((call) => call[6]);
  expect(offscreenContainers[0]).not.toBe(offscreenContainers[1]);
  expect(
    offscreenContainers.map((container) =>
      container?.querySelector("img")?.getAttribute("src"),
    ),
  ).toEqual(["blob:clean-1", "blob:clean-2"]);
  expect(
    offscreenContainers.every(
      (container) => container?.id !== "offscreen-container",
    ),
  ).toBe(true);
  expect(document.querySelectorAll("#offscreen-container")).toHaveLength(0);

  const activeInteractive = overlayCalls.find(
    (call) => call[1] === "single" && call[2] === 0,
  );
  expect(activeInteractive?.[4]).toBeUndefined();
  expect(result.current.translatedImageCacheRef.current.get("blob:one")).toBe(
    "data:offscreen,blob:clean-1",
  );
  expect(result.current.translatedImageCacheRef.current.get("blob:two")).toBe(
    "data:offscreen,blob:clean-2",
  );
});
