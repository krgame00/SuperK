import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { useTranslation } from "@/hooks/useTranslation";
import { applyTranslationOverlay } from "@/lib/translationOverlay";
import { deleteAsset } from "@/lib/projectStore";

vi.mock("@/lib/translationOverlay", () => ({
  applyTranslationOverlay: vi.fn(
    async (
      _bubbles: unknown[],
      viewMode: "single" | "scroll" | "offscreen",
      _pageIndex: number,
      _setTranslationResult: (message: string | null) => void,
      onComplete?: (dataUrl: string) => void,
    ) => {
      onComplete?.(
        viewMode === "offscreen" ? "data:rendered" : "data:interactive",
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

const pages = ["blob:original", "blob:second"];
const storageValues = new Map<string, string>();
const storage = {
  get length() {
    return storageValues.size;
  },
  clear: () => storageValues.clear(),
  getItem: (key: string) => storageValues.get(key) ?? null,
  key: (index: number) => [...storageValues.keys()][index] ?? null,
  removeItem: (key: string) => {
    storageValues.delete(key);
  },
  setItem: (key: string, value: string) => {
    storageValues.set(key, String(value));
  },
} satisfies Storage;

beforeEach(() => {
  vi.clearAllMocks();
  storage.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("existing translation bubbles survive failed re-clean and are only evicted on replacement clean", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url === "blob:original") {
      return new Response(new Blob(["original"], { type: "image/png" }), {
        status: 200,
      });
    }
    if (url === "/api/translate") {
      return Response.json({
        text: JSON.stringify({
          bubbles: [{ box: [10, 20, 40, 80], t: "existing translation text" }],
        }),
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });

  const preparePageForTranslation = vi.fn().mockResolvedValue({
    recognitionUrl: "blob:original",
    backgroundUrl: "blob:clean",
  });

  const { result } = renderHook(
    ({ currentPage }) =>
      useTranslation({
        currentPage,
        pages,
        viewMode: "single",
        preparePageForTranslation,
      }),
    { initialProps: { currentPage: 0 } },
  );

  // 1. Initial successful translation
  await act(async () => {
    expect(await result.current.handleTranslate()).toBe(true);
  });

  // Verify translation bubbles and rendered image cache exist
  expect(result.current.bubbleCacheRef.current.get("blob:original")).toEqual([
    expect.objectContaining({ t: "existing translation text" }),
  ]);
  expect(result.current.translatedImages.get("blob:original")).toBe(
    "data:rendered",
  );

  // 2. Simulated failed re-clean: caller does NOT call invalidatePageTranslation
  // (e.g. cleanCurrentPage returned undefined / threw error)
  // Translation bubbles, caches, and deleteAsset MUST remain untouched
  expect(result.current.bubbleCacheRef.current.has("blob:original")).toBe(true);
  expect(result.current.translatedImages.has("blob:original")).toBe(true);
  expect(deleteAsset).not.toHaveBeenCalled();

  // 3. Successful replacement clean: caller explicitly calls invalidatePageTranslation
  act(() => {
    result.current.invalidatePageTranslation("blob:original");
  });

  // Now translation bubbles and rendered image cache are evicted
  expect(result.current.bubbleCacheRef.current.has("blob:original")).toBe(false);
  expect(result.current.translatedImages.has("blob:original")).toBe(false);
  expect(result.current.activeBubbles).toEqual([]);
  expect(deleteAsset).toHaveBeenCalledWith(
    `translated_${encodeURIComponent("blob:original")}`,
  );
});
