import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { useTranslation } from "@/hooks/useTranslation";
import { applyTranslationOverlay } from "@/lib/translationOverlay";
import { deleteAsset as deleteProjectAsset } from "@/lib/projectStore";

vi.mock("@/lib/translationOverlay", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/translationOverlay")>();
  return {
    ...original,
    applyTranslationOverlay: vi.fn(),
    clearPageAdjustments: vi.fn(),
    clearAllAdjustments: vi.fn(),
    readOverlayAdjustments: vi.fn(() => ({})),
    bubbleKeyOf: vi.fn(() => "mock-key"),
  };
});

vi.mock("@/lib/projectStore", () => ({
  deleteAsset: vi.fn().mockResolvedValue(undefined),
  saveProjectSession: vi.fn().mockResolvedValue(undefined),
  loadProjectSession: vi.fn().mockResolvedValue(null),
  clearProjectSession: vi.fn().mockResolvedValue(undefined),
}));

const state = vi.hoisted(() => ({ offscreenBackground: null as string | null }));
const mockedOverlay = vi.mocked(applyTranslationOverlay);

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
  vi.useFakeTimers();
  vi.clearAllMocks();
  storage.clear();
  state.offscreenBackground = null;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
  vi.stubGlobal(
    "Image",
    class {
      onload: (() => void) | null = null;
      naturalWidth = 1000;
      naturalHeight = 1000;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/jpeg;base64,c2xpY2U=",
  );
  mockedOverlay.mockImplementation(
    async (
      _bubbles: unknown[],
      _viewMode: "single" | "scroll" | "offscreen",
      _pageIndex: number,
      _setTranslationResult: (message: string | null) => void,
      onComplete?: (dataUrl: string) => void,
      _textStyle?: unknown,
      container?: Element,
    ) => {
      if (container) {
        state.offscreenBackground =
          container.querySelector("img")?.getAttribute("src") ?? null;
      }
      onComplete?.("data:translated");
    },
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function renderTranslationHook(pages: string[]) {
  return renderHook(() =>
    useTranslation({
      currentPage: 0,
      pages,
      viewMode: "single",
      preparePageForTranslation: vi.fn(),
    }),
  );
}

test("refreshPageTranslation re-renders cached bubbles over the new clean image", async () => {
  const { result } = renderTranslationHook(["blob:one"]);
  const bubbles = [{ box: [10, 20, 40, 80], t: "แปลแล้ว" }];
  act(() => {
    result.current.bubbleCacheRef.current.set("blob:one", bubbles);
    result.current.translatedImageCacheRef.current.set("blob:one", "data:stale");
  });

  await act(async () => {
    await result.current.refreshPageTranslation("blob:one", "blob:clean-new");
  });

  expect(mockedOverlay).toHaveBeenCalled();
  const renderCall = mockedOverlay.mock.calls.find((c) => c[1] === "offscreen")!;
  expect(renderCall[0]).toBe(bubbles);
  expect(renderCall[7]).toBe("blob:one");
  // The render used the fresh cleaning, not the stale page or old background.
  expect(state.offscreenBackground).toBe("blob:clean-new");
  expect(result.current.translatedImageCacheRef.current.get("blob:one")).toBe(
    "data:translated",
  );
  // The translations survive — nothing was invalidated or dropped.
  expect(result.current.bubbleCacheRef.current.get("blob:one")).toBe(bubbles);
  expect(vi.mocked(deleteProjectAsset)).not.toHaveBeenCalled();
});

test("refreshPageTranslation falls back to invalidation for untranslated pages", async () => {
  const { result } = renderTranslationHook(["blob:one"]);
  act(() => {
    result.current.translatedImageCacheRef.current.set("blob:one", "data:stale");
  });

  await act(async () => {
    await result.current.refreshPageTranslation("blob:one", "blob:clean-new");
  });

  expect(mockedOverlay).not.toHaveBeenCalled();
  expect(result.current.translatedImageCacheRef.current.has("blob:one")).toBe(
    false,
  );
  expect(vi.mocked(deleteProjectAsset)).toHaveBeenCalledWith(
    "translated_blob%3Aone",
  );
});

test("a failed refresh keeps the bubble cache for later re-renders", async () => {
  const { result } = renderTranslationHook(["blob:one"]);
  const bubbles = [{ box: [10, 20, 40, 80], t: "แปลแล้ว" }];
  act(() => {
    result.current.bubbleCacheRef.current.set("blob:one", bubbles);
    result.current.translatedImageCacheRef.current.set("blob:one", "data:stale");
  });
  mockedOverlay.mockRejectedValueOnce(new Error("render failed"));

  await act(async () => {
    await result.current.refreshPageTranslation("blob:one", "blob:clean-new");
  });

  // The stale render is dropped but the translations stay for re-rendering.
  expect(result.current.translatedImageCacheRef.current.has("blob:one")).toBe(
    false,
  );
  expect(result.current.bubbleCacheRef.current.get("blob:one")).toBe(bubbles);
  expect(vi.mocked(deleteProjectAsset)).not.toHaveBeenCalled();
});
