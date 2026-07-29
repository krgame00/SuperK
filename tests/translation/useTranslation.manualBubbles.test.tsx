import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { useTranslation } from "@/hooks/useTranslation";
import { applyTranslationOverlay } from "@/lib/translationOverlay";

vi.mock("@/lib/translationOverlay", () => ({
  applyTranslationOverlay: vi.fn(
    async (
      _bubbles: unknown[],
      _viewMode: "single" | "scroll" | "offscreen",
      _pageIndex: number,
      _setTranslationResult: (message: string | null) => void,
      onComplete?: (dataUrl: string) => void,
    ) => {
      onComplete?.("data:translated");
    },
  ),
}));

vi.mock("@/lib/projectStore", () => ({
  saveProjectSession: vi.fn().mockResolvedValue(undefined),
  loadProjectSession: vi.fn().mockResolvedValue(null),
  clearProjectSession: vi.fn().mockResolvedValue(undefined),
}));

const activeManual = {
  box: [100, 100, 200, 300],
  t: "active-manual",
  isManual: true,
};
const backgroundManual = {
  box: [400, 400, 500, 600],
  t: "background-manual",
  isManual: true,
};
const translatedBubble = {
  box: [10, 20, 40, 80],
  t: "translated",
};
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

const imageResponse = () =>
  new Response(new Blob(["clean"], { type: "image/png" }), { status: 200 });

const successResponse = () =>
  Response.json({
    text: JSON.stringify({ bubbles: [translatedBubble] }),
  });

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
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("NSFW translation publishes same-page manual bubbles to both render and bubble cache", async () => {
  const pages = ["blob:one"];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url === "blob:clean-one") return imageResponse();
    if (url === "/api/translate") return successResponse();
    throw new Error(`unexpected fetch: ${url}`);
  });
  const { result } = renderHook(() =>
    useTranslation({
      currentPage: 0,
      pages,
      viewMode: "single",
      preparePageForTranslation: vi.fn().mockResolvedValue("blob:clean-one"),
    }),
  );

  act(() => {
    result.current.bubbleCacheRef.current.set("blob:one", [activeManual]);
    result.current.setActiveBubbles([activeManual]);
    result.current.setNsfwBypassMode(true);
  });

  let translation!: Promise<boolean>;
  act(() => {
    translation = result.current.handleTranslate();
  });
  await act(async () => {
    await vi.runAllTimersAsync();
    expect(await translation).toBe(true);
  });

  const rendered = vi
    .mocked(applyTranslationOverlay)
    .mock.calls.findLast((call) => call[1] === "offscreen")?.[0];
  expect(rendered).toEqual(expect.arrayContaining([activeManual]));
  expect(result.current.bubbleCacheRef.current.get("blob:one")).toEqual(
    expect.arrayContaining([activeManual]),
  );
});

test("Translate All uses each background page cache instead of active-page manual bubbles", async () => {
  const pages = ["blob:one", "blob:two"];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url === "blob:clean-one" || url === "blob:clean-two") {
      return imageResponse();
    }
    if (url === "/api/translate") return successResponse();
    throw new Error(`unexpected fetch: ${url}`);
  });
  const { result } = renderHook(() =>
    useTranslation({
      currentPage: 0,
      pages,
      viewMode: "single",
      preparePageForTranslation: vi.fn(
        async (_pageUrl, pageIndex) => `blob:clean-${pageIndex + 1 === 1 ? "one" : "two"}`,
      ),
    }),
  );

  act(() => {
    result.current.bubbleCacheRef.current.set("blob:one", [activeManual]);
    result.current.bubbleCacheRef.current.set("blob:two", [backgroundManual]);
    result.current.setActiveBubbles([activeManual]);
  });

  let batch!: Promise<void>;
  act(() => {
    batch = result.current.handleTranslateAll();
  });
  await act(async () => {
    await vi.runAllTimersAsync();
    await batch;
  });

  const backgroundRender = vi
    .mocked(applyTranslationOverlay)
    .mock.calls.findLast(
      (call) => call[1] === "offscreen" && call[2] === 1,
    )?.[0];
  expect(backgroundRender).toEqual(
    expect.arrayContaining([backgroundManual]),
  );
  expect(backgroundRender).not.toEqual(expect.arrayContaining([activeManual]));
  expect(result.current.bubbleCacheRef.current.get("blob:two")).toEqual(
    expect.arrayContaining([backgroundManual]),
  );
  expect(result.current.bubbleCacheRef.current.get("blob:two")).not.toEqual(
    expect.arrayContaining([activeManual]),
  );
});
