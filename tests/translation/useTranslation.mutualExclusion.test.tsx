import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { useTranslation } from "@/hooks/useTranslation";

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

const pages = ["blob:original"];

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function imageResponse() {
  return new Response(new Blob(["clean"], { type: "image/png" }), {
    status: 200,
  });
}

function successResponse() {
  return Response.json({
    text: JSON.stringify({
      bubbles: [{ box: [10, 20, 40, 80], t: "translated" }],
    }),
  });
}

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

test("rejects a single-page translation while batch translation is running", async () => {
  const firstPreparation = deferred<{
    recognitionUrl: string;
    backgroundUrl: string;
  }>();
  const preparePageForTranslation = vi
    .fn()
    .mockImplementationOnce(() => firstPreparation.promise)
    .mockResolvedValue({
      recognitionUrl: "blob:original",
      backgroundUrl: "blob:clean",
    });
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input) => {
      const url = String(input);
      if (url === "blob:original" || url === "blob:clean") {
        return imageResponse();
      }
      if (url === "/api/translate") return successResponse();
      throw new Error(`unexpected fetch: ${url}`);
    },
  );

  const { result } = renderHook(() =>
    useTranslation({
      currentPage: 0,
      pages,
      viewMode: "single",
      preparePageForTranslation,
    }),
  );

  let batchPromise!: Promise<void>;
  await act(async () => {
    batchPromise = result.current.handleTranslateAll();
    await Promise.resolve();
  });
  expect(result.current.isTranslatingAll).toBe(true);

  await act(async () => {
    expect(await result.current.handleTranslate()).toBe(false);
  });

  expect(preparePageForTranslation).toHaveBeenCalledTimes(1);
  expect(fetchSpy).not.toHaveBeenCalled();

  await act(async () => {
    result.current.cancelTranslateAll();
    firstPreparation.resolve({
      recognitionUrl: "blob:original",
      backgroundUrl: "blob:clean",
    });
    await batchPromise;
  });
});

test("rejects batch translation while a single-page translation is running", async () => {
  const firstPreparation = deferred<{
    recognitionUrl: string;
    backgroundUrl: string;
  }>();
  const preparePageForTranslation = vi
    .fn()
    .mockImplementationOnce(() => firstPreparation.promise)
    .mockResolvedValue({
      recognitionUrl: "blob:original",
      backgroundUrl: "blob:clean",
    });
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input) => {
      const url = String(input);
      if (url === "blob:original" || url === "blob:clean") {
        return imageResponse();
      }
      if (url === "/api/translate") return successResponse();
      throw new Error(`unexpected fetch: ${url}`);
    },
  );

  const { result } = renderHook(() =>
    useTranslation({
      currentPage: 0,
      pages,
      viewMode: "single",
      preparePageForTranslation,
    }),
  );

  let singlePromise!: Promise<boolean>;
  await act(async () => {
    singlePromise = result.current.handleTranslate();
    await Promise.resolve();
  });
  expect(result.current.isTranslating).toBe(true);

  await act(async () => {
    await result.current.handleTranslateAll();
  });

  expect(preparePageForTranslation).toHaveBeenCalledTimes(1);
  expect(fetchSpy).not.toHaveBeenCalled();

  await act(async () => {
    firstPreparation.resolve({
      recognitionUrl: "blob:original",
      backgroundUrl: "blob:clean",
    });
    expect(await singlePromise).toBe(true);
  });
});
