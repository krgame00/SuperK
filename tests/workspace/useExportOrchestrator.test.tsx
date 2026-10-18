import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useExportOrchestrator, type WorkspaceExportPage } from "@/hooks/useExportOrchestrator";
import type { PageCleaningResult } from "@/hooks/useCleaning";
import type { TranslatedBubble } from "@/lib/translationOverlay";
import { createPageTargetIdentity, type PageTargetIdentity } from "@/lib/translation/pageEligibility";

describe("useExportOrchestrator", () => {
  const dummyPages: WorkspaceExportPage[] = [
    { url: "blob:page-0", name: "page0.jpg", exportSource: "translated" },
    { url: "blob:page-1", name: "page1.jpg", exportSource: "original" },
    { url: "blob:page-2", name: "page2.jpg", exportSource: "clean" },
  ];

  const createOptions = (overrides?: Partial<Parameters<typeof useExportOrchestrator>[0]>) => {
    const pages = overrides?.pages ?? dummyPages;
    const cleaningResultsByPage = overrides?.cleaningResultsByPage ?? new Map<string, PageCleaningResult>();
    const bubbleCache = new Map<string, TranslatedBubble[]>([
      ["blob:page-0", [{ id: "b1", box: [10, 10, 100, 100], translated: "สวัสดี" } as TranslatedBubble]],
    ]);
    const bubbleCacheRef = { current: bubbleCache };
    const textStyleRef = { current: { fontFamily: "Itim", textColor: "#000", textOutline: "#fff", fontSizeMultiplier: 1.0 } };
    const confirmedPagesRef = { current: new Set<string>() };
    const confirmedMissingTranslationsRef = { current: new Map<string, string>() };
    const targetIdentity = createPageTargetIdentity("th")!;
    const pageTargetCacheRef = { current: new Map<string, PageTargetIdentity>([["blob:page-0", targetIdentity]]) };
    const translatedImageCacheRef = { current: new Map<string, string>() };
    const dirtyExportPagesRef = { current: new Set<string>() };

    return {
      pages,
      currentPage: 0,
      setCurrentPage: vi.fn(),
      workspaceLayer: "translated" as const,
      setWorkspaceLayer: vi.fn(),
      setViewLayout: vi.fn(),
      cleaningResultsByPage,
      bubbleCacheRef,
      textStyleRef,
      confirmedPages: new Set<string>(),
      setConfirmedPages: vi.fn(),
      confirmedPagesRef,
      confirmedMissingTranslationsRef,
      pageTargetCacheRef,
      getPageTargetLanguage: () => "th",
      getPageSourceRevision: (url: string) => `rev-${url}`,
      getPageSignature: (url: string) => `sig-${url}`,
      getCurrentRemnantReview: () => undefined,
      getExpectedRemnantEvidence: () => ({ sourceContext: "src", textEvidence: [] }),
      confirmAllPageReviews: vi.fn(),
      confirmAllPageRemnants: vi.fn(),
      inspectTranslatedPages: () => [{ pageIndex: 0, total: 1, contaminated: 0, invalidBoxes: 0 }],
      setTranslationResult: vi.fn(),
      translationCacheRevision: 0,
      cleaningCacheRevision: 0,
      translatedImageCacheRef,
      dirtyExportPagesRef,
      ...overrides,
    };
  };

  const store = new Map<string, string>();
  const mockStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, val: string) => { store.set(key, val); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: mockStorage });
    if (typeof window !== "undefined") {
      Object.defineProperty(window, "localStorage", { configurable: true, value: mockStorage });
    }
  });

  it("initializes with default image format and idle state", () => {
    const options = createOptions();
    const { result } = renderHook(() => useExportOrchestrator(options));

    expect(result.current.exportImageFormat).toBe("jpg");
    expect(result.current.isZipping).toBe(false);
    expect(result.current.isChoosingExport).toBe(false);
    expect(result.current.isExportReportOpen).toBe(false);
    expect(result.current.exportReportRows).toEqual([]);
    expect(result.current.unconfirmedReviewPages).toBeNull();
  });

  it("updates export image format and persists to localStorage", () => {
    const options = createOptions();
    const { result } = renderHook(() => useExportOrchestrator(options));

    act(() => {
      result.current.setExportImageFormat("png");
    });

    expect(result.current.exportImageFormat).toBe("png");
    expect(localStorage.getItem("superk:export-image-format")).toBe("png");
  });

  it("builds export report rows with accurate counts for translated and original pages", () => {
    const options = createOptions();
    const { result } = renderHook(() => useExportOrchestrator(options));

    const rows = result.current.buildExportReportRows();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      pageIndex: 0,
      exportSource: "translated",
      translated: true,
      totalBubbles: 1,
      contaminated: 0,
      invalidBoxes: 0,
      pendingCleaning: 0,
    });
    expect(rows[1]).toEqual({
      pageIndex: 1,
      exportSource: "original",
      translated: false,
      totalBubbles: 0,
      contaminated: 0,
      invalidBoxes: 0,
      pendingCleaning: 0,
    });
  });

  it("handles export review page substitution with original", () => {
    const options = createOptions();
    const { result } = renderHook(() => useExportOrchestrator(options));

    act(() => {
      result.current.exportSnapshotRef.current = {
        pages: [...dummyPages],
        currentPage: 0,
      };
    });

    act(() => {
      result.current.substituteExportPageWithOriginal("blob:page-0");
    });

    expect(result.current.exportSnapshotRef.current?.pages[0].exportSource).toBe("original");
  });

  it("handles export review page exclusion", () => {
    const options = createOptions();
    const { result } = renderHook(() => useExportOrchestrator(options));

    act(() => {
      result.current.exportSnapshotRef.current = {
        pages: [...dummyPages],
        currentPage: 0,
      };
    });

    act(() => {
      result.current.excludeExportPage("blob:page-0");
    });

    expect(result.current.exportSnapshotRef.current?.pages[0].exportExcluded).toBe(true);
  });

  it("cancels review cleanly and resets holding states", () => {
    const options = createOptions();
    const { result } = renderHook(() => useExportOrchestrator(options));

    act(() => {
      result.current.exportSnapshotRef.current = { pages: [...dummyPages], currentPage: 0 };
      result.current.setIsChoosingExport(true);
    });

    act(() => {
      result.current.handleCancelReview();
    });

    expect(result.current.exportSnapshotRef.current).toBeNull();
    expect(result.current.isChoosingExport).toBe(false);
    expect(result.current.unconfirmedReviewPages).toBeNull();
    expect(result.current.pendingExportAction).toBeNull();
  });
});
