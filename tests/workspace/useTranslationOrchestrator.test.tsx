import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useTranslationOrchestrator } from "@/hooks/useTranslationOrchestrator";
import type { WorkspaceExportPage } from "@/hooks/useExportOrchestrator";
import type { PageCleaningResult } from "@/hooks/useCleaning";
import type { PreparedTranslationPage } from "@/hooks/useTranslation";

vi.mock("@/hooks/useTranslation", () => ({
  useTranslation: vi.fn(() => ({
    isTranslating: false,
    translationResult: null,
    setTranslationResult: vi.fn(),
    handleTranslate: vi.fn(),
    isTranslatingAll: false,
    translateAllProgress: null,
    handleTranslateAll: vi.fn(),
    cancelTranslateAll: vi.fn(),
    activeBubbles: [],
    setActiveBubbles: vi.fn(),
    nsfwBypassMode: false,
    setNsfwBypassMode: vi.fn(),
    translatedImages: new Map(),
    translatedImageCacheRef: { current: new Map() },
    bubbleCacheRef: { current: new Map() },
    textStyleRef: { current: {} },
    userApiKey: "",
    setUserApiKey: vi.fn(),
    glossary: [],
    setGlossary: vi.fn(),
    modelPreference: "auto",
    setModelPreference: vi.fn(),
    allowPreviewModels: false,
    setAllowPreviewModels: vi.fn(),
    targetLang: "th",
    setTargetLang: vi.fn(),
    pageTargetCacheRef: { current: new Map() },
    getPageTargetLanguage: vi.fn(() => "th"),
    sourceLang: "ja",
    setSourceLang: vi.fn(),
    textStyle: {},
    setTextStyle: vi.fn(),
    sfxMode: "transcribe",
    setSfxMode: vi.fn(),
    restoreSavedSession: vi.fn(),
    clearSavedSession: vi.fn(),
    saveStatus: "idle",
    saveError: null,
    retrySaveSession: vi.fn(),
    workflowPhase: "idle",
    batchFailures: [],
    failureGroups: [],
    retryFailedPages: vi.fn(),
    retryFailureGroup: vi.fn(),
    autoProceedOnReview: false,
    setAutoProceedOnReview: vi.fn(),
    reviewFlaggedPages: vi.fn(),
    invalidatePageTranslation: vi.fn(),
    refreshPageTranslation: vi.fn(),
    scanTranslatedPages: vi.fn(),
    inspectTranslatedPages: vi.fn(),
    inspectLegacyTargets: vi.fn(),
    confirmLegacyTarget: vi.fn(),
    inspectReviewIssues: vi.fn(),
    confirmPointReview: vi.fn(),
    confirmAllPageReviews: vi.fn(),
    applyAllSuggestedReviews: vi.fn(),
    repairWholeBook: vi.fn(),
    cancelWholeBookRepair: vi.fn(),
    isRepairingBook: false,
    replaceBubbleText: vi.fn(),
    markPageDirty: vi.fn(),
    getPageSignature: vi.fn(() => "sig-1"),
    getPageSourceRevision: vi.fn(() => "rev-1"),
    resizeSavedText: vi.fn(),
    cacheRevision: 1,
  })),
}));

vi.mock("@/hooks/useBubbleOrganizeOrchestrator", () => ({
  useBubbleOrganizeOrchestrator: vi.fn(() => ({
    handleAutoOrganizeCurrentPage: vi.fn(),
    handleAutoOrganizeAllPages: vi.fn(),
    handleApplyBwContrastCurrentPage: vi.fn(),
    handleApplyBwContrastAllPages: vi.fn(),
    bwContrastModeLabel: vi.fn(() => "Auto"),
  })),
}));

describe("useTranslationOrchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initializes translation and bubble organize state and populates translationBridgeRef", () => {
    const pages: WorkspaceExportPage[] = [
      { url: "http://example.com/p1.jpg", name: "p1.jpg" },
    ];
    const currentPageRef = { current: 0 };
    const pagesRef = { current: pages };
    const dirtyExportPagesRef = { current: new Set<string>() };
    const setConfirmedPages = vi.fn();
    const cleaningResultsByPage = new Map<string, PageCleaningResult>();
    const preparePageForTranslation = vi.fn(async () => ({} as PreparedTranslationPage));
    const syncCleaningEvidence = vi.fn();
    const translationBridgeRef = { current: {} };

    const { result } = renderHook(() =>
      useTranslationOrchestrator({
        pages,
        currentPage: 0,
        currentPageUrl: "http://example.com/p1.jpg",
        currentPageRef,
        pagesRef,
        dirtyExportPagesRef,
        setConfirmedPages,
        viewLayout: "single",
        cleaningResultsByPage,
        preparePageForTranslation,
        syncCleaningEvidence,
        translationBridgeRef,
      }),
    );

    expect(result.current.targetLang).toBe("th");
    expect(result.current.handleAutoOrganizeCurrentPage).toBeDefined();
    expect(result.current.handleAutoOrganizeAllPages).toBeDefined();
    expect(translationBridgeRef.current).toHaveProperty("refreshPageTranslation");
    expect(translationBridgeRef.current).toHaveProperty("activeBubbles");
  });

  it("invokes syncCleaningEvidence when cacheRevision updates", () => {
    const pages: WorkspaceExportPage[] = [
      { url: "http://example.com/p1.jpg", name: "p1.jpg" },
    ];
    const syncCleaningEvidence = vi.fn();
    const translationBridgeRef = { current: {} };

    renderHook(() =>
      useTranslationOrchestrator({
        pages,
        currentPage: 0,
        currentPageUrl: "http://example.com/p1.jpg",
        currentPageRef: { current: 0 },
        pagesRef: { current: pages },
        dirtyExportPagesRef: { current: new Set() },
        setConfirmedPages: vi.fn(),
        viewLayout: "single",
        cleaningResultsByPage: new Map(),
        preparePageForTranslation: vi.fn(async () => ({} as PreparedTranslationPage)),
        syncCleaningEvidence,
        translationBridgeRef,
      }),
    );

    expect(syncCleaningEvidence).toHaveBeenCalled();
  });
});
