import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  useTranslation,
  type PreparedTranslationPage,
} from "@/hooks/useTranslation";

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

const mockPages = [
  "blob:page-0",
  "blob:page-1",
  "blob:page-2",
  "blob:page-3",
];

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
  storage.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("parallelPages bounds concurrency to configured worker pool limit", async () => {
  let activeTranslations = 0;
  let peakTranslations = 0;

  const preparePageForTranslation = vi.fn(async (pageUrl: string) => {
    return {
      recognitionUrl: pageUrl,
      backgroundUrl: pageUrl,
    } satisfies PreparedTranslationPage;
  });

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.startsWith("blob:")) {
      return new Response(new Blob(["mock-img"], { type: "image/png" }), {
        status: 200,
      });
    }
    if (url === "/api/translate") {
      activeTranslations++;
      peakTranslations = Math.max(peakTranslations, activeTranslations);
      // Small delay to ensure concurrency overlap
      await new Promise((r) => setTimeout(r, 40));
      activeTranslations--;
      return Response.json({
        text: JSON.stringify({
          bubbles: [{ box: [10, 20, 30, 40], t: "แปลสำเร็จ" }],
        }),
      });
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  });

  const { result } = renderHook(() =>
    useTranslation({
      currentPage: 0,
      pages: mockPages,
      viewMode: "single",
      preparePageForTranslation,
      parallelPages: 2,
    }),
  );

  expect(result.current.parallelPages).toBe(2);

  await act(async () => {
    await result.current.handleTranslateAll();
  });

  // Concurrency was capped at exactly 2 workers
  expect(peakTranslations).toBe(2);
  expect(preparePageForTranslation).toHaveBeenCalledWith(mockPages[0], 0, expect.anything());
  expect(preparePageForTranslation).toHaveBeenCalledWith(mockPages[1], 1, expect.anything());
  expect(preparePageForTranslation).toHaveBeenCalledWith(mockPages[2], 2, expect.anything());
  expect(preparePageForTranslation).toHaveBeenCalledWith(mockPages[3], 3, expect.anything());
});

test("setParallelPages dynamically adjusts the worker pool limit", async () => {
  let activeTranslations = 0;
  let peakTranslations = 0;

  const preparePageForTranslation = vi.fn(async (pageUrl: string) => {
    return {
      recognitionUrl: pageUrl,
      backgroundUrl: pageUrl,
    } satisfies PreparedTranslationPage;
  });

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.startsWith("blob:")) {
      return new Response(new Blob(["mock-img"], { type: "image/png" }), {
        status: 200,
      });
    }
    if (url === "/api/translate") {
      activeTranslations++;
      peakTranslations = Math.max(peakTranslations, activeTranslations);
      await new Promise((r) => setTimeout(r, 40));
      activeTranslations--;
      return Response.json({
        text: JSON.stringify({
          bubbles: [{ box: [10, 20, 30, 40], t: "ข้อความ" }],
        }),
      });
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  });

  const { result } = renderHook(() =>
    useTranslation({
      currentPage: 0,
      pages: mockPages,
      viewMode: "single",
      preparePageForTranslation,
      parallelPages: 1,
    }),
  );

  act(() => {
    result.current.setParallelPages(3);
  });

  expect(result.current.parallelPages).toBe(3);
  expect(storage.getItem("superk:parallel-pages")).toBe("3");

  await act(async () => {
    await result.current.handleTranslateAll();
  });

  expect(peakTranslations).toBe(3);
  expect(preparePageForTranslation).toHaveBeenCalledWith(mockPages[0], 0, expect.anything());
  expect(preparePageForTranslation).toHaveBeenCalledWith(mockPages[1], 1, expect.anything());
  expect(preparePageForTranslation).toHaveBeenCalledWith(mockPages[2], 2, expect.anything());
  expect(preparePageForTranslation).toHaveBeenCalledWith(mockPages[3], 3, expect.anything());
});
