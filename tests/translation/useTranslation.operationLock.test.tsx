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
      bubbles: [{ box: [10, 20, 40, 80], t: "สวัสดี" }],
    }),
  });
}

function installSuccessfulFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url === "blob:clean") return imageResponse();
    if (url === "/api/translate") return successResponse();
    throw new Error(`unexpected fetch: ${url}`);
  });
}

function renderTranslation(
  preparePageForTranslation: (pageUrl: string, pageIndex: number) => Promise<string>,
) {
  return renderHook(() =>
    useTranslation({
      currentPage: 0,
      pages,
      viewMode: "single",
      preparePageForTranslation,
    }),
  );
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

test("starts only single-page translation when single and batch are called in the same tick", async () => {
  const preparation = deferred<string>();
  const preparePageForTranslation = vi.fn(() => preparation.promise);
  const fetchSpy = installSuccessfulFetch();
  const { result } = renderTranslation(preparePageForTranslation);

  let singlePromise!: Promise<boolean>;
  let batchPromise!: Promise<void>;
  act(() => {
    singlePromise = result.current.handleTranslate();
    batchPromise = result.current.handleTranslateAll();
  });

  await act(async () => {
    preparation.resolve("blob:clean");
    await Promise.all([singlePromise, batchPromise]);
  });

  expect(preparePageForTranslation).toHaveBeenCalledTimes(1);
  expect(
    fetchSpy.mock.calls.filter(([input]) => String(input) === "/api/translate"),
  ).toHaveLength(1);
});

test("starts only batch translation when batch and single are called in the same tick", async () => {
  const preparation = deferred<string>();
  const preparePageForTranslation = vi.fn(() => preparation.promise);
  const fetchSpy = installSuccessfulFetch();
  const { result } = renderTranslation(preparePageForTranslation);

  let batchPromise!: Promise<void>;
  let singlePromise!: Promise<boolean>;
  act(() => {
    batchPromise = result.current.handleTranslateAll();
    singlePromise = result.current.handleTranslate();
  });

  await act(async () => {
    preparation.resolve("blob:clean");
    await Promise.all([batchPromise, singlePromise]);
  });

  expect(preparePageForTranslation).toHaveBeenCalledTimes(1);
  expect(
    fetchSpy.mock.calls.filter(([input]) => String(input) === "/api/translate"),
  ).toHaveLength(1);
});

test("keeps batch busy and blocks single translation until pending preparation settles after cancel", async () => {
  const preparation = deferred<string>();
  const preparePageForTranslation = vi
    .fn()
    .mockImplementationOnce(() => preparation.promise)
    .mockResolvedValue("blob:clean");
  installSuccessfulFetch();
  const { result } = renderTranslation(preparePageForTranslation);

  let batchPromise!: Promise<void>;
  await act(async () => {
    batchPromise = result.current.handleTranslateAll();
    await Promise.resolve();
  });

  act(() => {
    result.current.cancelTranslateAll();
  });
  const busyAfterCancel = result.current.isTranslatingAll;

  let singleResult!: boolean;
  await act(async () => {
    singleResult = await result.current.handleTranslate();
  });
  const prepareCallsBeforeRelease = preparePageForTranslation.mock.calls.length;

  await act(async () => {
    preparation.resolve("blob:clean");
    await batchPromise;
  });

  expect(busyAfterCancel).toBe(true);
  expect(singleResult).toBe(false);
  expect(prepareCallsBeforeRelease).toBe(1);
  expect(result.current.isTranslatingAll).toBe(false);
  expect(result.current.translateAllProgress).toBeNull();
});
