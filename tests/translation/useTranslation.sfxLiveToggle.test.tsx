import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { useTranslation, type PreparedTranslationPage } from "@/hooks/useTranslation";
import { applyTranslationOverlay, type TranslatedBubble } from "@/lib/translationOverlay";

vi.mock("@/lib/colorMatching/canvasSampler", async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/colorMatching/canvasSampler')>(),
  sampleBubbleRegion: vi.fn(() => null),
}));

vi.mock("@/lib/translationOverlay", () => ({
  applyTranslationOverlay: vi.fn(
    async (
      _bubbles: unknown[],
      _viewMode: "single" | "scroll" | "offscreen",
      _pageIndex: number,
      _setTranslationResult: (message: string | null) => void,
      onComplete?: (dataUrl: string) => void,
    ) => {
      onComplete?.("data:interactive");
    },
  ),
}));

vi.mock("@/lib/projectStore", () => ({
  saveProjectSession: vi.fn().mockResolvedValue(undefined),
  loadProjectSession: vi.fn().mockResolvedValue(null),
  clearProjectSession: vi.fn().mockResolvedValue(undefined),
  deleteAsset: vi.fn().mockResolvedValue(undefined),
}));

const samplePages = ["page-url-1", "page-url-2"];

const defaultPrepare = async (
  pageUrl: string,
): Promise<PreparedTranslationPage> => ({
  recognitionUrl: pageUrl,
  backgroundUrl: pageUrl,
  cleaningMode: "safe",
});

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

describe("useTranslation - Live SFX Policy Toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });
    if (typeof window !== "undefined") {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: storage,
      });
    }
    storage.clear();
  });

  afterEach(() => {
    storage.clear();
    vi.restoreAllMocks();
  });

  test("toggling sfxMode immediately updates activeBubbles, bubbleCacheRef, and re-renders overlay without re-translating", async () => {
    const { result } = renderHook(() =>
      useTranslation({
        currentPage: 0,
        pages: samplePages,
        viewMode: "single",
        preparePageForTranslation: defaultPrepare,
      }),
    );

    // Initial bubbles on page 1: 1 dialogue and 1 SFX bubble
    const page1Bubbles: TranslatedBubble[] = [
      {
        id: "b-diag-1",
        t: "สวัสดีครับ",
        translated: "สวัสดีครับ",
        original_text: "こんにちは",
        box: [100, 100, 200, 200],
      },
      {
        id: "b-sfx-1",
        t: "*ตู้ม*",
        translated: "*ตู้ม*",
        original_text: "ドカーン",
        isSfx: true,
        box: [300, 300, 400, 400],
      },
    ];

    // Seed activeBubbles and cache
    act(() => {
      result.current.bubbleCacheRef.current.set("page-url-1", [...page1Bubbles]);
      result.current.setActiveBubbles([...page1Bubbles]);
    });

    vi.mocked(applyTranslationOverlay).mockClear();

    // 1. Switch to "ignore"
    act(() => {
      result.current.setSfxMode("ignore");
    });

    expect(result.current.sfxMode).toBe("ignore");
    expect(storage.getItem("superk:sfx-policy")).toBe("ignore");

    // Check active bubbles
    const activeAfterIgnore = result.current.activeBubbles;
    expect(activeAfterIgnore[0].t).toBe("สวัสดีครับ");
    expect(activeAfterIgnore[0].hidden).toBeFalsy();
    expect(activeAfterIgnore[1].hidden).toBe(true);
    expect(activeAfterIgnore[1].sfxTranslated).toBe("*ตู้ม*");
    expect(activeAfterIgnore[1].sfxOriginal).toBe("ドカーン");

    // Check cached bubbles in page-url-1
    const cachedAfterIgnore = result.current.bubbleCacheRef.current.get("page-url-1")!;
    expect(cachedAfterIgnore[1].hidden).toBe(true);
    expect(cachedAfterIgnore[1].sfxTranslated).toBe("*ตู้ม*");

    // Overlay was immediately re-applied on the active page
    expect(applyTranslationOverlay).toHaveBeenCalled();

    vi.mocked(applyTranslationOverlay).mockClear();

    // 2. Switch to "preserve"
    act(() => {
      result.current.setSfxMode("preserve");
    });

    expect(result.current.sfxMode).toBe("preserve");
    expect(storage.getItem("superk:sfx-policy")).toBe("preserve");

    const activeAfterPreserve = result.current.activeBubbles;
    expect(activeAfterPreserve[1].hidden).toBe(false);
    expect(activeAfterPreserve[1].t).toBe("ドカーン");
    expect(activeAfterPreserve[1].translated).toBe("ドカーン");
    expect(activeAfterPreserve[1].sfxTranslated).toBe("*ตู้ม*");

    // Overlay was re-applied
    expect(applyTranslationOverlay).toHaveBeenCalled();

    vi.mocked(applyTranslationOverlay).mockClear();

    // 3. Switch to "translate"
    act(() => {
      result.current.setSfxMode("translate");
    });

    expect(result.current.sfxMode).toBe("translate");
    expect(storage.getItem("superk:sfx-policy")).toBe("translate");

    const activeAfterTranslate = result.current.activeBubbles;
    expect(activeAfterTranslate[1].hidden).toBe(false);
    expect(activeAfterTranslate[1].t).toBe("*ตู้ม*");
    expect(activeAfterTranslate[1].translated).toBe("*ตู้ม*");

    // Overlay was re-applied
    expect(applyTranslationOverlay).toHaveBeenCalled();
  });

  test("sfxMode applies across all cached pages when toggled", () => {
    const { result } = renderHook(() =>
      useTranslation({
        currentPage: 0,
        pages: samplePages,
        viewMode: "single",
        preparePageForTranslation: defaultPrepare,
      }),
    );

    const page2Bubbles: TranslatedBubble[] = [
      {
        id: "b2-sfx",
        t: "*เปรี้ยง*",
        translated: "*เปรี้ยง*",
        original_text: "バチバチ",
        styleCategory: "sfx",
        box: [200, 200, 300, 300],
      },
    ];

    act(() => {
      result.current.bubbleCacheRef.current.set("page-url-2", [...page2Bubbles]);
    });

    // Toggle to ignore
    act(() => {
      result.current.setSfxMode("ignore");
    });

    const page2AfterIgnore = result.current.bubbleCacheRef.current.get("page-url-2")!;
    expect(page2AfterIgnore[0].hidden).toBe(true);

    // Toggle to preserve
    act(() => {
      result.current.setSfxMode("preserve");
    });

    const page2AfterPreserve = result.current.bubbleCacheRef.current.get("page-url-2")!;
    expect(page2AfterPreserve[0].hidden).toBe(false);
    expect(page2AfterPreserve[0].t).toBe("バチバチ");

    // Toggle back to translate
    act(() => {
      result.current.setSfxMode("translate");
    });

    const page2AfterTranslate = result.current.bubbleCacheRef.current.get("page-url-2")!;
    expect(page2AfterTranslate[0].hidden).toBe(false);
    expect(page2AfterTranslate[0].t).toBe("*เปรี้ยง*");
  });
});
