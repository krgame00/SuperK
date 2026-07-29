import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { useTranslation } from "@/hooks/useTranslation";

const overlayControl = vi.hoisted(() => ({
  capture: false,
  lateComplete: undefined as ((dataUrl: string) => void) | undefined,
}));

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
      if (viewMode === "offscreen" && overlayControl.capture) {
        overlayControl.lateComplete = onComplete;
        return;
      }
      const preparedSrc = containerOverride
        ?.querySelector("img")
        ?.getAttribute("src");
      onComplete?.(`data:offscreen,${preparedSrc}`);
    },
  ),
}));

vi.mock("@/lib/projectStore", () => ({
  saveProjectSession: vi.fn().mockResolvedValue(undefined),
  loadProjectSession: vi.fn().mockResolvedValue(null),
  clearProjectSession: vi.fn().mockResolvedValue(undefined),
}));

const nsfwPages = ["blob:nsfw"];
const enhancedPages = ["blob:enhanced"];
const latePages = ["blob:original"];
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

const installImmediateFileReader = () => {
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
};

beforeEach(() => {
  vi.clearAllMocks();
  overlayControl.capture = false;
  overlayControl.lateComplete = undefined;
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("NSFW image errors and enhanced-image timeouts settle while loading prepared clean URLs", async () => {
  vi.useFakeTimers();
  installImmediateFileReader();
  const assignedSources: string[] = [];
  vi.stubGlobal(
    "Image",
    class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 100;
      naturalHeight = 100;

      set src(value: string) {
        assignedSources.push(value);
        if (assignedSources.length === 1) {
          queueMicrotask(() => this.onerror?.());
        }
      }
    },
  );
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url === "blob:clean-nsfw" || url === "blob:clean-enhanced") {
      return new Response(new Blob(["clean"], { type: "image/png" }), {
        status: 200,
      });
    }
    if (url === "/api/translate") {
      return Response.json({
        text: JSON.stringify({ bubbles: [] }),
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  const prepareNsfw = vi.fn().mockResolvedValue("blob:clean-nsfw");
  const prepareEnhanced = vi.fn().mockResolvedValue("blob:clean-enhanced");

  const nsfw = renderHook(() =>
    useTranslation({
      currentPage: 0,
      pages: nsfwPages,
      viewMode: "single",
      preparePageForTranslation: prepareNsfw,
    }),
  );
  const enhanced = renderHook(() =>
    useTranslation({
      currentPage: 0,
      pages: enhancedPages,
      viewMode: "single",
      preparePageForTranslation: prepareEnhanced,
    }),
  );
  act(() => {
    nsfw.result.current.setNsfwBypassMode(true);
  });

  let nsfwTranslation!: Promise<boolean>;
  let enhancedTranslation!: Promise<boolean>;
  act(() => {
    nsfwTranslation = nsfw.result.current.handleTranslate();
    enhancedTranslation = enhanced.result.current.handleTranslate();
  });
  await act(async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    }
  });
  expect(assignedSources).toEqual([
    "blob:clean-nsfw",
    "blob:clean-enhanced",
  ]);

  const settled = Promise.all([nsfwTranslation, enhancedTranslation]).then(
    () => "settled" as const,
  );
  const deadline = new Promise<"hung">((resolve) => {
    setTimeout(() => resolve("hung"), 31_000);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(31_000);
  });

  expect(await Promise.race([settled, deadline])).toBe("settled");
});

test("a late offscreen completion after the watchdog cannot populate translated cache", async () => {
  vi.useFakeTimers();
  installImmediateFileReader();
  overlayControl.capture = true;
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
  const { result } = renderHook(() =>
    useTranslation({
      currentPage: 0,
      pages: latePages,
      viewMode: "single",
      preparePageForTranslation,
    }),
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
  });
  expect(overlayControl.lateComplete).toBeTypeOf("function");

  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await translation).toBe(false);
  });
  expect(
    result.current.translatedImageCacheRef.current.has("blob:original"),
  ).toBe(false);

  act(() => {
    overlayControl.lateComplete?.("data:late");
  });

  expect(
    result.current.translatedImageCacheRef.current.has("blob:original"),
  ).toBe(false);
});
