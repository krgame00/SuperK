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

const contaminatedThai = { box: [100, 100, 300, 200], t: "สวัสดีこんにちは" };
const cleanThai = { box: [100, 100, 300, 200], t: "สวัสดี" };
const farewell = { box: [400, 400, 600, 500], t: "ลาก่อน" };
const contaminatedFarewell = { box: [400, 400, 600, 500], t: "Привет" };

const imageResponse = () =>
  new Response(new Blob(["clean"], { type: "image/png" }), { status: 200 });

const bubblesResponse = (bubbles: unknown[]) =>
  Response.json({ text: JSON.stringify({ bubbles }) });

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
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
    getImageData: vi.fn(() => ({
      data: new Uint8ClampedArray(4),
      width: 1,
      height: 1,
    })),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/jpeg;base64,c2xpY2U=",
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
      preparePageForTranslation: vi.fn().mockResolvedValue({
        recognitionUrl: "blob:one",
        backgroundUrl: "blob:clean-one",
      }),
    }),
  );
}

test("foreign-script contamination triggers one retry and keeps the cleaner pass", async () => {
  const pages = ["blob:one"];
  let translateCalls = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url === "blob:one" || url === "blob:clean-one") return imageResponse();
    if (url === "/api/translate") {
      translateCalls += 1;
      // First pass leaks kana; the enhanced retry comes back clean.
      return bubblesResponse(
        translateCalls === 1 ? [contaminatedThai, farewell] : [cleanThai, farewell],
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  const { result } = renderTranslationHook(pages);

  let translation!: Promise<boolean>;
  act(() => {
    translation = result.current.handleTranslate();
  });
  await act(async () => {
    await vi.runAllTimersAsync();
    expect(await translation).toBe(true);
  });

  expect(translateCalls).toBe(2);
  const rendered = vi
    .mocked(applyTranslationOverlay)
    .mock.calls.findLast((call) => call[1] === "offscreen")?.[0] as Array<{
    t?: string;
  }>;
  expect(rendered).toEqual(
    expect.arrayContaining([expect.objectContaining({ t: "สวัสดี" })]),
  );
  // The kana-contaminated text must not survive into the final bubbles.
  expect(JSON.stringify(rendered)).not.toContain("こんにちは");
});

test("a dirtier retry does not replace the original translation", async () => {
  const pages = ["blob:one"];
  let translateCalls = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url === "blob:one" || url === "blob:clean-one") return imageResponse();
    if (url === "/api/translate") {
      translateCalls += 1;
      // First pass has one contaminated bubble; the retry is worse (two).
      return bubblesResponse(
        translateCalls === 1
          ? [contaminatedThai, farewell]
          : [contaminatedThai, contaminatedFarewell],
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  const { result } = renderTranslationHook(pages);

  let translation!: Promise<boolean>;
  act(() => {
    translation = result.current.handleTranslate();
  });
  await act(async () => {
    await vi.runAllTimersAsync();
    expect(await translation).toBe(true);
  });

  expect(translateCalls).toBe(2);
  const rendered = vi
    .mocked(applyTranslationOverlay)
    .mock.calls.findLast((call) => call[1] === "offscreen")?.[0] as Array<{
    t?: string;
  }>;
  // The original pass stays: it had fewer contaminated bubbles.
  expect(rendered).toEqual(
    expect.arrayContaining([expect.objectContaining({ t: "ลาก่อน" })]),
  );
  expect(JSON.stringify(rendered)).not.toContain("Привет");
});

test("inspectTranslatedPages reports per-page bubble stats", () => {
  const { result } = renderTranslationHook(["blob:clean", "blob:dirty", "blob:none"]);
  act(() => {
    result.current.bubbleCacheRef.current.set("blob:clean", [
      { box: [0, 0, 10, 10], t: "สวัสดี" },
    ]);
    result.current.bubbleCacheRef.current.set("blob:dirty", [
      { box: [0, 0, 10, 10], t: "สวัสดี" },
      { box: [0, 0, 10, 10], t: "สวัสดีこんにちは", isInvalidBox: true },
    ]);
  });
  const stats = result.current.inspectTranslatedPages();
  expect(stats).toHaveLength(2);
  expect(stats[0]).toEqual({ pageUrl: "blob:clean", pageIndex: 0, total: 1, contaminated: 0, invalidBoxes: 0 });
  expect(stats[1]).toEqual({ pageUrl: "blob:dirty", pageIndex: 1, total: 2, contaminated: 1, invalidBoxes: 1 });
});

test("scanTranslatedPages reports only pages with contaminated bubbles", () => {
  const { result } = renderTranslationHook(["blob:clean", "blob:dirty"]);
  act(() => {
    result.current.bubbleCacheRef.current.set("blob:clean", [
      { box: [0, 0, 10, 10], t: "สวัสดี" },
    ]);
    result.current.bubbleCacheRef.current.set("blob:dirty", [
      { box: [0, 0, 10, 10], t: "สวัสดี" },
      { box: [0, 0, 10, 10], t: "こんにちは" },
    ]);
  });
  expect(result.current.scanTranslatedPages()).toEqual([
    { pageUrl: "blob:dirty", pageIndex: 1, contaminated: 1, total: 2 },
  ]);
});
