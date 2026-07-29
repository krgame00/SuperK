import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

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
    ) => {
      if (viewMode !== "offscreen") {
        onComplete?.("data:interactive");
      }
    },
  ),
}));

vi.mock("@/lib/projectStore", () => ({
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
  vi.stubGlobal(
    "FileReader",
    class {
      result: string | ArrayBuffer | null = null;
      onloadend: (() => void) | null = null;

      readAsDataURL() {
        this.result = "data:image/png;base64,Y2xlYW4=";
        queueMicrotask(() => this.onloadend?.());
      }
    },
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("failed offscreen rendering leaves no bubbles to restore after navigation", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url === "blob:clean") {
      return new Response(new Blob(["clean"], { type: "image/png" }), {
        status: 200,
      });
    }
    if (url === "/api/translate") {
      return Response.json({
        text: JSON.stringify({
          bubbles: [{ box: [10, 20, 40, 80], t: "hello" }],
        }),
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  const preparePageForTranslation = vi.fn().mockResolvedValue("blob:clean");
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

  let translation!: Promise<boolean>;
  act(() => {
    translation = result.current.handleTranslate();
  });
  await act(async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    }
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await translation).toBe(false);
  });

  expect(result.current.bubbleCacheRef.current.has("blob:original")).toBe(
    false,
  );
  vi.mocked(applyTranslationOverlay).mockClear();

  rerender({ currentPage: 1 });
  rerender({ currentPage: 0 });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(150);
  });

  expect(
    vi
      .mocked(applyTranslationOverlay)
      .mock.calls.some((call) => call[1] === "single"),
  ).toBe(false);
});
