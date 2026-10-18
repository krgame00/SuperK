import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceTextActions } from "@/hooks/useWorkspaceTextActions";
import type { TranslatedBubble } from "@/lib/translationOverlay";

vi.mock("react-hot-toast", () => ({
  default: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@/lib/translation/glossary", () => ({
  extractGlossaryCandidatesFromBubbles: vi.fn(() => [
    { source: "ルフィ", target: "ลูฟี่" },
  ]),
}));

import type { GlossaryEntry } from "@/lib/translation/glossary";
import type { WorkspaceLayer } from "@/components/cleaning/CleaningToolbar";

describe("useWorkspaceTextActions", () => {
  let bubbleCacheRef: { current: Map<string, TranslatedBubble[]> };
  let setWorkspaceLayer: ReturnType<typeof vi.fn<(layer: WorkspaceLayer | ((prev: WorkspaceLayer) => WorkspaceLayer)) => void>>;
  let setGlossary: ReturnType<typeof vi.fn<(items: GlossaryEntry[]) => void>>;
  let replaceBubbleText: ReturnType<typeof vi.fn<(opts: any) => number>>;

  beforeEach(() => {
    vi.clearAllMocks();
    bubbleCacheRef = {
      current: new Map([
        [
          "http://example.com/p1.jpg",
          [
            {
              x: 10,
              y: 10,
              w: 50,
              h: 50,
              text: "Hello",
              translated: "สวัสดี",
              t: "สวัสดี",
            },
          ],
        ],
      ]),
    };
    setWorkspaceLayer = vi.fn();
    setGlossary = vi.fn();
    replaceBubbleText = vi.fn(() => 1);
  });

  it("calculates hasCurrentTranslation correctly and toggles original/translated", () => {
    const pages = [{ url: "http://example.com/p1.jpg", name: "page1.jpg" }];
    const translatedImages = new Map<string, string>();

    const { result } = renderHook(() =>
      useWorkspaceTextActions({
        pages,
        currentPage: 0,
        activeBubbles: [],
        bubbleCacheRef,
        translatedImages,
        translationCacheRevision: 1,
        setWorkspaceLayer,
        setGlossary,
        glossary: [],
        cleaningResultsByPage: new Map(),
        replaceBubbleText,
      }),
    );

    expect(result.current.hasCurrentTranslation).toBe(true);

    act(() => {
      result.current.toggleOriginalTranslated();
    });

    expect(setWorkspaceLayer).toHaveBeenCalledTimes(1);
    const updater = setWorkspaceLayer.mock.calls[0][0] as (prev: WorkspaceLayer) => WorkspaceLayer;
    expect(updater("original")).toBe("translated");
    expect(updater("translated")).toBe("original");
  });

  it("handles find and replace with literal replacement string", () => {
    const pages = [{ url: "http://example.com/p1.jpg", name: "page1.jpg" }];

    const { result } = renderHook(() =>
      useWorkspaceTextActions({
        pages,
        currentPage: 0,
        activeBubbles: [],
        bubbleCacheRef,
        translatedImages: new Map(),
        translationCacheRevision: 1,
        setWorkspaceLayer,
        setGlossary,
        glossary: [],
        cleaningResultsByPage: new Map(),
        replaceBubbleText,
      }),
    );

    act(() => {
      result.current.handleFindReplace({
        find: "สวัสดี",
        replace: "ฮัลโหล",
        scope: "this-page",
        caseSensitive: false,
      });
    });

    expect(replaceBubbleText).toHaveBeenCalledTimes(1);
    const callArgs = replaceBubbleText.mock.calls[0][0];
    expect(callArgs.pageUrls).toEqual(["http://example.com/p1.jpg"]);

    // Test the transform function logic
    const testBubble: TranslatedBubble = {
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      text: "Hello",
      translated: "สวัสดีชาวโลก",
      t: "สวัสดีชาวโลก",
    };
    const changed = callArgs.transform(testBubble);
    expect(changed).toBe(true);
    expect(testBubble.t).toBe("ฮัลโหลชาวโลก");
    expect(testBubble.translated).toBe("ฮัลโหลชาวโลก");
  });

  it("handles auto-extract glossary from bubbles", async () => {
    const pages = [{ url: "http://example.com/p1.jpg", name: "page1.jpg" }];

    const { result } = renderHook(() =>
      useWorkspaceTextActions({
        pages,
        currentPage: 0,
        activeBubbles: [],
        bubbleCacheRef,
        translatedImages: new Map(),
        translationCacheRevision: 1,
        setWorkspaceLayer,
        setGlossary,
        glossary: [],
        cleaningResultsByPage: new Map(),
        replaceBubbleText,
      }),
    );

    await act(async () => {
      await result.current.handleAutoExtractGlossary();
    });

    expect(setGlossary).toHaveBeenCalledWith([
      { source: "ルフィ", target: "ลูฟี่" },
    ]);
  });
});
