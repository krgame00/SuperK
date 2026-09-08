import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { useTranslation } from "@/hooks/useTranslation";
import { applyTranslationOverlay } from "@/lib/translationOverlay";
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
      onComplete?.(
        viewMode === "offscreen" ? "data:fresh-rendered" : "data:interactive",
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

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("canvas overlay mutation evicts pre-rendered image cache and triggers autosave", async () => {
  const pages = ["blob:page1"];
  const { result } = renderHook(() =>
    useTranslation({
      currentPage: 0,
      pages,
      viewMode: "single",
      preparePageForTranslation: vi.fn(),
    }),
  );

  // 1. Initial state: simulate rendered image cached from initial translation
  result.current.bubbleCacheRef.current.set("blob:page1", [
    { box: [10, 10, 50, 50], t: "Original Position" },
  ]);
  result.current.translatedImageCacheRef.current.set(
    "blob:page1",
    "data:stale-pre-edit-image",
  );
  expect(result.current.translatedImageCacheRef.current.has("blob:page1")).toBe(true);

  // Complete initial mount autosave
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(result.current.saveStatus).toBe("saved");
  vi.mocked(saveProjectSession).mockClear();

  // 2. User moves bubble / modifies text on canvas -> triggers markPageDirty
  act(() => {
    // Update bubble coordinates in cache
    result.current.bubbleCacheRef.current.set("blob:page1", [
      { box: [100, 100, 150, 150], t: "Moved Position" },
    ]);
    result.current.markPageDirty("blob:page1");
  });

  // 3. Render cache MUST be immediately evicted so export never outputs stale images
  expect(result.current.translatedImageCacheRef.current.has("blob:page1")).toBe(false);

  // 4. Autosave is debounced and dirty flag remains active until save completes
  expect(result.current.saveStatus).toBe("saving");

  // Advance timer for debounced autosave
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });

  expect(saveProjectSession).toHaveBeenCalled();
  const lastSaveCall = vi.mocked(saveProjectSession).mock.calls.at(-1);
  expect(lastSaveCall?.[1]?.dirtyPageUrls?.has("blob:page1")).toBe(true);
  expect(result.current.saveStatus).toBe("saved");
});
