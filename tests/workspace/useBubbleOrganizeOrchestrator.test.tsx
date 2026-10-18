import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useBubbleOrganizeOrchestrator,
  bwContrastModeLabel,
  type UseBubbleOrganizeOrchestratorOptions,
} from "@/hooks/useBubbleOrganizeOrchestrator";
import type { TranslatedBubble } from "@/lib/translationOverlay";
import { undoManager } from "@/lib/undoManager";

vi.mock("@/lib/translationOverlay", () => ({
  autoOrganizePageBubbles: vi.fn((bubbles) => ({
    optimizedBubbles: bubbles.map((b: TranslatedBubble) => ({
      ...b,
      layoutAdjustment: { bx: 10, by: 10, bw: 100, bh: 50, iw: 1200, ih: 1800, scale: 1 },
    })),
    adjustedCount: bubbles.length,
  })),
  syncPageOverlayAdjustments: vi.fn(),
  applyTranslationOverlay: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/colorMatching/resolveTextStyle", () => ({
  applyBwContrastModeToBubbles: vi.fn((bubbles, mode) =>
    bubbles.map((b: TranslatedBubble) => ({
      ...b,
      styleProfile: { bwContrastMode: mode },
    })),
  ),
  cloneTextStyleProfile: vi.fn((profile) => (profile ? { ...profile } : undefined)),
}));

vi.mock("react-hot-toast", () => ({
  default: {
    success: vi.fn(),
    loading: vi.fn().mockReturnValue("toast-id"),
  },
}));

describe("useBubbleOrganizeOrchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    undoManager.clear();
  });

  it("bwContrastModeLabel returns proper descriptions for each mode", () => {
    expect(bwContrastModeLabel("black_on_white")).toBe("ดำ-ขาว (ตัวดำ ขอบขาวหนา)");
    expect(bwContrastModeLabel("white_on_black")).toBe("ขาว-ดำ (ตัวขาว ขอบดำหนา)");
    expect(bwContrastModeLabel("pure_black")).toBe("ดำล้วน (ไม่มีขอบ)");
    expect(bwContrastModeLabel("auto")).toBe("ออโต้ ขาว-ดำ");
  });

  it("handleAutoOrganizeCurrentPage organizes bubbles and updates cache & state", async () => {
    const dummyBubble: TranslatedBubble = {
      id: "b1",
      originalText: "こんにちは",
      text: "สวัสดี",
      box: [10, 10, 100, 50],
    };
    const bubbleCache = new Map<string, TranslatedBubble[]>([
      ["page-1.jpg", [dummyBubble]],
    ]);
    const dirtyExportPages = new Set<string>();
    const markPageDirty = vi.fn();
    const setActiveBubbles = vi.fn();
    const refreshPageTranslation = vi.fn().mockResolvedValue("blob:clean");

    const options: UseBubbleOrganizeOrchestratorOptions = {
      pages: [{ url: "page-1.jpg", name: "001.jpg" }],
      currentPage: 0,
      currentPageUrl: "page-1.jpg",
      activeBubbles: [dummyBubble],
      setActiveBubbles,
      bubbleCacheRef: { current: bubbleCache },
      textStyleRef: { current: undefined },
      targetLang: "th",
      dirtyExportPagesRef: { current: dirtyExportPages },
      markPageDirty,
      viewLayout: "single",
      refreshPageTranslation,
    };

    const { result } = renderHook(() => useBubbleOrganizeOrchestrator(options));

    await act(async () => {
      await result.current.handleAutoOrganizeCurrentPage("readable");
    });

    expect(bubbleCache.get("page-1.jpg")?.length).toBe(1);
    expect(setActiveBubbles).toHaveBeenCalled();
    expect(dirtyExportPages.has("page-1.jpg")).toBe(true);
    expect(markPageDirty).toHaveBeenCalledWith("page-1.jpg");
    expect(refreshPageTranslation).toHaveBeenCalledWith("page-1.jpg", "page-1.jpg");
    expect(undoManager.canUndo()).toBe(true);
  });

  it("handleAutoOrganizeAllPages iterates across all translated pages", async () => {
    const b1: TranslatedBubble = { id: "b1", text: "1", originalText: "1", box: [0, 0, 10, 10] };
    const b2: TranslatedBubble = { id: "b2", text: "2", originalText: "2", box: [0, 0, 10, 10] };
    const bubbleCache = new Map<string, TranslatedBubble[]>([
      ["page-1.jpg", [b1]],
      ["page-2.jpg", [b2]],
    ]);
    const dirtyExportPages = new Set<string>();
    const refreshPageTranslation = vi.fn().mockResolvedValue("blob:clean");

    const options: UseBubbleOrganizeOrchestratorOptions = {
      pages: [
        { url: "page-1.jpg", name: "001.jpg" },
        { url: "page-2.jpg", name: "002.jpg" },
      ],
      currentPage: 0,
      currentPageUrl: "page-1.jpg",
      activeBubbles: [b1],
      setActiveBubbles: vi.fn(),
      bubbleCacheRef: { current: bubbleCache },
      textStyleRef: { current: undefined },
      dirtyExportPagesRef: { current: dirtyExportPages },
      viewLayout: "single",
      translatedImages: new Map([["page-2.jpg", "blob:page2"]]),
      refreshPageTranslation,
    };

    const { result } = renderHook(() => useBubbleOrganizeOrchestrator(options));

    await act(async () => {
      await result.current.handleAutoOrganizeAllPages("readable");
    });

    expect(dirtyExportPages.has("page-1.jpg")).toBe(true);
    expect(dirtyExportPages.has("page-2.jpg")).toBe(true);
    expect(refreshPageTranslation).toHaveBeenCalledTimes(2);
    expect(undoManager.canUndo()).toBe(true);
  });

  it("handleApplyBwContrastCurrentPage updates contrast style profile and pushes undo", async () => {
    const dummyBubble: TranslatedBubble = {
      id: "b1",
      originalText: "こんにちは",
      text: "สวัสดี",
      box: [10, 10, 100, 50],
    };
    const bubbleCache = new Map<string, TranslatedBubble[]>([
      ["page-1.jpg", [dummyBubble]],
    ]);
    const setActiveBubbles = vi.fn();
    const refreshPageTranslation = vi.fn().mockResolvedValue("blob:clean");

    const options: UseBubbleOrganizeOrchestratorOptions = {
      pages: [{ url: "page-1.jpg", name: "001.jpg" }],
      currentPage: 0,
      currentPageUrl: "page-1.jpg",
      activeBubbles: [dummyBubble],
      setActiveBubbles,
      bubbleCacheRef: { current: bubbleCache },
      textStyleRef: { current: undefined },
      dirtyExportPagesRef: { current: new Set() },
      viewLayout: "single",
      refreshPageTranslation,
    };

    const { result } = renderHook(() => useBubbleOrganizeOrchestrator(options));

    await act(async () => {
      await result.current.handleApplyBwContrastCurrentPage("black_on_white");
    });

    expect(setActiveBubbles).toHaveBeenCalled();
    expect(refreshPageTranslation).toHaveBeenCalled();
    expect(undoManager.canUndo()).toBe(true);
  });

  it("handleApplyBwContrastAllPages updates contrast across all translated pages", async () => {
    const b1: TranslatedBubble = { id: "b1", text: "1", originalText: "1", box: [0, 0, 10, 10] };
    const b2: TranslatedBubble = { id: "b2", text: "2", originalText: "2", box: [0, 0, 10, 10] };
    const bubbleCache = new Map<string, TranslatedBubble[]>([
      ["page-1.jpg", [b1]],
      ["page-2.jpg", [b2]],
    ]);

    const options: UseBubbleOrganizeOrchestratorOptions = {
      pages: [
        { url: "page-1.jpg", name: "001.jpg" },
        { url: "page-2.jpg", name: "002.jpg" },
      ],
      currentPage: 0,
      currentPageUrl: "page-1.jpg",
      activeBubbles: [b1],
      setActiveBubbles: vi.fn(),
      bubbleCacheRef: { current: bubbleCache },
      textStyleRef: { current: undefined },
      dirtyExportPagesRef: { current: new Set() },
      viewLayout: "single",
      refreshPageTranslation: vi.fn().mockResolvedValue("blob:clean"),
    };

    const { result } = renderHook(() => useBubbleOrganizeOrchestrator(options));

    await act(async () => {
      await result.current.handleApplyBwContrastAllPages("white_on_black");
    });

    expect(bubbleCache.get("page-1.jpg")?.[0].styleProfile?.bwContrastMode).toBe("white_on_black");
    expect(bubbleCache.get("page-2.jpg")?.[0].styleProfile?.bwContrastMode).toBe("white_on_black");
  });
});
