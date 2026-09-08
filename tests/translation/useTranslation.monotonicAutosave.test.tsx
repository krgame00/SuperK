import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { useTranslation } from "@/hooks/useTranslation";
import { saveProjectSession } from "@/lib/projectStore";

vi.mock("@/lib/translationOverlay", () => ({
  applyTranslationOverlay: vi.fn(),
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
  vi.useFakeTimers();
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
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("monotonic autosave preserves edits made while a save is in-flight", async () => {
  let resolveFirstSave!: () => void;
  const firstSavePromise = new Promise<void>((resolve) => {
    resolveFirstSave = resolve;
  });
  let resolveSecondSave!: () => void;
  const secondSavePromise = new Promise<void>((resolve) => {
    resolveSecondSave = resolve;
  });

  // Mock saveProjectSession: first and second calls hang until explicitly resolved
  vi.mocked(saveProjectSession)
    .mockImplementationOnce(async () => {
      await firstSavePromise;
    })
    .mockImplementationOnce(async () => {
      await secondSavePromise;
    })
    .mockResolvedValue(undefined);

  const pages = ["blob:page1", "blob:page2"];
  const { result } = renderHook(() =>
    useTranslation({
      currentPage: 0,
      pages,
      viewMode: "single",
      preparePageForTranslation: vi.fn(),
    }),
  );

  // Set up initial bubbles for page1 and page2
  result.current.bubbleCacheRef.current.set("blob:page1", [
    { box: [10, 10, 50, 50], t: "Page 1 Initial" },
  ]);
  result.current.bubbleCacheRef.current.set("blob:page2", [
    { box: [20, 20, 60, 60], t: "Page 2 Initial" },
  ]);

  // Trigger initial save
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });

  // Save is now in-flight
  expect(result.current.saveStatus).toBe("saving");
  expect(saveProjectSession).toHaveBeenCalledTimes(1);

  // While first save is in-flight, translator edits text on page1 rapidly
  act(() => {
    result.current.bubbleCacheRef.current.set("blob:page1", [
      { box: [10, 10, 50, 50], t: "Page 1 Rapid Edit While Saving" },
    ]);
    result.current.markPageDirty("blob:page1");
  });

  // First save now completes
  await act(async () => {
    resolveFirstSave();
    await Promise.resolve();
  });

  // Because page1 was edited while saving, it MUST NOT be marked saved
  expect(result.current.saveStatus).toBe("saving");

  // Advance timer for debounced catch-up save
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });

  // A follow-up save must have been called
  expect(saveProjectSession).toHaveBeenCalledTimes(2);

  // The second save must include blob:page1 as dirty
  const secondSaveOptions = vi.mocked(saveProjectSession).mock.calls[1]?.[1];
  expect(secondSaveOptions?.dirtyPageUrls).toBeDefined();
  expect(secondSaveOptions?.dirtyPageUrls?.has("blob:page1")).toBe(true);

  // Second save now finishes
  await act(async () => {
    resolveSecondSave();
    await Promise.resolve();
  });

  // And now that all edits are saved, status becomes saved
  expect(result.current.saveStatus).toBe("saved");
  expect(result.current.saveError).toBeNull();
});
