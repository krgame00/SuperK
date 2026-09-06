import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { useTranslation } from "@/hooks/useTranslation";
import { saveProjectSession } from "@/lib/projectStore";

vi.mock("@/lib/translationOverlay", () => ({
  applyTranslationOverlay: vi.fn(
    async (
      _bubbles: unknown[],
      viewMode: "single" | "scroll" | "offscreen",
      _pageIndex: number,
      _setTranslationResult: (message: string | null) => void,
      onComplete?: (dataUrl: string) => void,
    ) => {
      onComplete?.(`data:rerender,${viewMode}`);
    },
  ),
  clearPageAdjustments: vi.fn(),
  clearAllAdjustments: vi.fn(),
  readOverlayAdjustments: vi.fn(() => ({})),
  bubbleKeyOf: vi.fn(() => "mock-key"),
}));

vi.mock("@/lib/projectStore", () => ({
  deleteAsset: vi.fn().mockResolvedValue(undefined),
  saveProjectSession: vi.fn().mockResolvedValue(undefined),
  loadProjectSession: vi.fn().mockResolvedValue(null),
  clearProjectSession: vi.fn().mockResolvedValue(undefined),
}));

const storageValues = new Map<string, string>();
const storage = {
  get length() { return storageValues.size; },
  clear: () => storageValues.clear(),
  getItem: (key: string) => storageValues.get(key) ?? null,
  key: (index: number) => [...storageValues.keys()][index] ?? null,
  removeItem: (key: string) => { storageValues.delete(key); },
  setItem: (key: string, value: string) => { storageValues.set(key, String(value)); },
} satisfies Storage;

const installImmediateFileReader = () => {
  vi.stubGlobal("FileReader", class {
    result: string | ArrayBuffer | null = null;
    onloadend: (() => void) | null = null;

    readAsDataURL() {
      this.result = "data:image/png;base64,b3JpZ2luYWw=";
      queueMicrotask(() => this.onloadend?.());
    }
  });
};

const installSuccessfulImageAndCanvas = () => {
  vi.stubGlobal("Image", class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 120;
    naturalHeight = 180;

    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
    filter: "none",
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/jpeg;base64,c2xpY2U=",
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  storage.clear();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const flushAsync = async () => {
  await act(async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await Promise.resolve();
    }
  });
};

test("replaceBubbleText rewrites cached bubbles and re-renders without deleting them", async () => {
  const preparePageForTranslation = vi.fn();
  const { result } = renderHook(() => useTranslation({
    currentPage: 0,
    pages: ["blob:a", "blob:b"],
    viewMode: "single",
    preparePageForTranslation,
  }));

  act(() => {
    result.current.bubbleCacheRef.current.set("blob:a", [
      { t: "cat", translated: "cat", box: [0, 0, 20, 80] },
    ]);
    result.current.bubbleCacheRef.current.set("blob:b", [
      { t: "dog runs", translated: "dog runs", box: [0, 0, 20, 80] },
    ]);
    result.current.translatedImageCacheRef.current.set("blob:a", "data:image/png;base64,oldA");
    result.current.translatedImageCacheRef.current.set("blob:b", "data:image/png;base64,oldB");
  });

  let count = 0;
  await act(async () => {
    count = result.current.replaceBubbleText({
      pageUrls: ["blob:a", "blob:b"],
      backgroundUrls: { "blob:a": "blob:clean-a", "blob:b": "blob:clean-b" },
      transform: (b) => {
        const text = typeof b.t === "string" ? b.t : "";
        if (!text) return false;
        b.t = text.toUpperCase();
        b.translated = text.toUpperCase();
        return true;
      },
    });
  });
  await flushAsync();

  expect(count).toBe(2);
  // The bubble cache survives (invalidatePageTranslation would have wiped it)
  expect(result.current.bubbleCacheRef.current.get("blob:a")?.[0]?.t).toBe("CAT");
  expect(result.current.bubbleCacheRef.current.get("blob:b")?.[0]?.t).toBe("DOG RUNS");
  // Rendered images were refreshed by the background re-render
  expect(result.current.translatedImageCacheRef.current.get("blob:a")).toContain("rerender");
  expect(result.current.translatedImageCacheRef.current.get("blob:b")).toContain("rerender");
  // Active page bubbles were re-applied with the replaced text
  expect(result.current.activeBubbles[0]?.t).toBe("CAT");
});

test("enhanced auto-retry bubbles are used instead of discarded", async () => {
  installImmediateFileReader();
  installSuccessfulImageAndCanvas();
  let translateAttempt = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url === "blob:enhanced" || url === "blob:clean-enhanced") {
      return new Response(new Blob(["image"], { type: "image/png" }), { status: 200 });
    }
    if (url === "/api/translate") {
      translateAttempt += 1;
      return Response.json({
        text: translateAttempt === 1
          ? JSON.stringify({ bubbles: [] })
          : JSON.stringify({
              bubbles: [{ box: [10, 20, 40, 80], t: "retry bubble" }],
            }),
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  const preparePageForTranslation = vi.fn().mockResolvedValue({
    recognitionUrl: "blob:enhanced",
    backgroundUrl: "blob:clean-enhanced",
  });
  const { result } = renderHook(() => useTranslation({
    currentPage: 0,
    pages: ["blob:enhanced"],
    viewMode: "single",
    preparePageForTranslation,
  }));

  let success = false;
  await act(async () => {
    success = await result.current.handleTranslate();
  });

  expect(translateAttempt).toBe(2);
  expect(success).toBe(true);
  // Pre-fix behavior: the retry result was discarded and the page fell
  // through to clean-only with an empty bubble cache.
  expect(result.current.bubbleCacheRef.current.get("blob:enhanced")?.[0]?.t).toBe("retry bubble");
});

test("non-retryable translation errors stop the batch without retrying", async () => {
  installImmediateFileReader();
  const apiCalls = vi.fn();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url === "blob:a" || url === "blob:clean") {
      return new Response(new Blob(["image"], { type: "image/png" }), { status: 200 });
    }
    if (url === "/api/translate") {
      apiCalls();
      return Response.json({ error: "Invalid API key", retryable: false }, { status: 401 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  const preparePageForTranslation = vi.fn().mockResolvedValue({
    recognitionUrl: "blob:a",
    backgroundUrl: "blob:clean",
  });
  const { result } = renderHook(() => useTranslation({
    currentPage: 0,
    pages: ["blob:a"],
    viewMode: "single",
    preparePageForTranslation,
  }));

  await act(async () => {
    await result.current.handleTranslateAll();
  });

  // Exactly one Gemini call — pre-fix behavior retried the 401 three times.
  expect(apiCalls).toHaveBeenCalledTimes(1);
  expect(result.current.batchFailures).toHaveLength(1);
  expect(result.current.batchFailures[0].stage).toBe("translation");
});

test("auto-save persists original page names instead of 'Page'", async () => {
  vi.useFakeTimers();
  const preparePageForTranslation = vi.fn();
  renderHook(() => useTranslation({
    currentPage: 0,
    pages: ["blob:a", "blob:b"],
    pageNames: ["chapter1.png", "chapter2.png"],
    viewMode: "single",
    preparePageForTranslation,
  }));

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });

  const call = vi.mocked(saveProjectSession).mock.calls.at(-1)?.[0];
  expect(call?.pages.map((p) => p.name)).toEqual(["chapter1.png", "chapter2.png"]);
  expect(call?.pages.map((p) => p.url)).toEqual(["blob:a", "blob:b"]);
});

test("cancel aborts in-flight translation fetches without page failures", async () => {
  installImmediateFileReader();
  const preparePageForTranslation = vi.fn().mockResolvedValue({
    recognitionUrl: "blob:a",
    backgroundUrl: "blob:clean",
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === "blob:a" || url === "blob:clean") {
      return new Response(new Blob(["image"], { type: "image/png" }), { status: 200 });
    }
    if (url === "/api/translate") {
      // Hangs forever unless the pipeline aborts it.
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  const { result } = renderHook(() => useTranslation({
    currentPage: 0,
    pages: ["blob:a"],
    viewMode: "single",
    preparePageForTranslation,
  }));

  let batch!: Promise<void>;
  act(() => {
    batch = result.current.handleTranslateAll().then(() => undefined);
  });
  await flushAsync();
  act(() => {
    result.current.cancelTranslateAll();
  });
  await act(async () => {
    await batch;
  });

  // Pre-fix behavior: the hung fetch ran to completion and the cancelled
  // page was recorded as a batch failure.
  expect(result.current.batchFailures).toHaveLength(0);
  expect(result.current.translationResult).toContain("ยกเลิก");
});
