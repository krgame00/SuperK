import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

import { useTranslation } from "@/hooks/useTranslation";
import { applyTranslationOverlay } from "@/lib/translationOverlay";

vi.mock("@/lib/translationOverlay", () => ({
  applyTranslationOverlay: vi.fn(
    async (
      _bubbles: unknown[],
      viewMode: "single" | "scroll" | "offscreen",
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
        viewMode === "offscreen"
          ? `data:offscreen,${preparedSrc}`
          : "data:interactive-overwrite",
      );
    },
  ),
}));

vi.mock("@/lib/projectStore", () => ({
  saveProjectSession: vi.fn().mockResolvedValue(undefined),
  loadProjectSession: vi.fn().mockResolvedValue(null),
  clearProjectSession: vi.fn().mockResolvedValue(undefined),
}));

const pages = ["blob:one", "blob:two"];
const translatedBubble = { box: [10, 20, 40, 80], t: "hello" };
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

test("navigation restore is display-only and preserves the prepared translated cache", async () => {
  const preparePageForTranslation = vi.fn().mockResolvedValue({
    recognitionUrl: "blob:one",
    backgroundUrl: "blob:clean-one",
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url === "blob:one") {
      return new Response(new Blob(["original"], { type: "image/png" }), {
        status: 200,
      });
    }
    if (url === "/api/translate") {
      return Response.json({
        text: JSON.stringify({ bubbles: [translatedBubble] }),
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });

  const { result, rerender } = renderHook(
    ({ currentPage }) =>
      useTranslation({
        currentPage,
        pages,
        viewMode: "single",
        preparePageForTranslation,
      }),
    { initialProps: { currentPage: 0 } },
  );

  await act(async () => {
    expect(await result.current.handleTranslate()).toBe(true);
  });
  expect(result.current.translatedImageCacheRef.current.get("blob:one")).toBe(
    "data:offscreen,blob:clean-one",
  );

  rerender({ currentPage: 1 });
  rerender({ currentPage: 0 });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
  });

  const restoreCall = vi
    .mocked(applyTranslationOverlay)
    .mock.calls.findLast(
      (call) => call[1] === "single" && call[2] === 0,
    );
  expect(restoreCall?.[4]).toBeUndefined();
  expect(result.current.translatedImageCacheRef.current.get("blob:one")).toBe(
    "data:offscreen,blob:clean-one",
  );
});
