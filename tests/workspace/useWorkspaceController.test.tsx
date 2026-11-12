import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import toast from "react-hot-toast";
import { useWorkspaceController } from "@/hooks/useWorkspaceController";
import { useCleaning } from "@/hooks/useCleaning";
import { useTranslation } from "@/hooks/useTranslation";

const docManagerState = vi.hoisted(() => ({ pages: [] as Array<{ url: string; name: string }> }));
const translationRefs = vi.hoisted(() => ({
  bubbleCacheRef: { current: new Map<string, unknown>() },
  translatedImageCacheRef: { current: new Map<string, string>() },
  pageTargetCacheRef: { current: new Map<string, unknown>() },
  textStyleRef: { current: {} },
}));

vi.mock("@/hooks/useWorkspaceDocumentManager", () => ({
  useWorkspaceDocumentManager: vi.fn(() => ({
    pages: docManagerState.pages,
    setPages: vi.fn(),
    currentPage: 0,
    setCurrentPage: vi.fn(),
    currentPageRef: { current: 0 },
    pagesRef: { current: docManagerState.pages },
    confirmedPages: new Set<string>(),
    setConfirmedPages: vi.fn(),
    confirmedPagesRef: { current: new Set<string>() },
    confirmedMissingTranslationsRef: { current: new Map<string, string>() },
    brokenPages: new Set<string>(),
    setBrokenPages: vi.fn(),
    pageUrls: docManagerState.pages.map((p) => p.url),
    pageIds: docManagerState.pages.map((p, i) => `page_${i}`),
    pageNames: docManagerState.pages.map((p) => p.name),
    isDragging: false,
    isImporting: false,
    importStatusMessage: null,
    savedSessionData: null,
    setSavedSessionData: vi.fn(),
    pendingTextlessMatches: [],
    setPendingTextlessMatches: vi.fn(),
    handleImageUpload: vi.fn(),
    handleDragOver: vi.fn(),
    handleDragLeave: vi.fn(),
    handleDrop: vi.fn(),
    handleDeletePage: vi.fn(),
    handleRemovePage: vi.fn(),
    handleReorderPages: vi.fn(),
    handleClearAllPages: vi.fn(),
    handleImageError: vi.fn(),
    handlePageExportSourceChange: vi.fn(),
    handleRestoreSavedSession: vi.fn(),
    handleClearSavedSession: vi.fn(),
    handleExportProjectFile: vi.fn(),
    handleImportProjectFile: vi.fn(),
  })),
}));

vi.mock("@/hooks/useCleaning", () => ({
  useCleaning: vi.fn(() => ({
    cleanPage: vi.fn(),
    cleanCurrentPage: vi.fn(),
    retryRegion: vi.fn(),
    resolveMaskRegion: vi.fn(),
    currentCleaningResult: undefined,
    cleaningProgress: null,
    cleaningError: null,
    cleaningResultsByPage: new Map(),
    cleaningCacheRevision: 0,
    getCurrentRemnantReview: vi.fn(),
    confirmArtworkCandidate: vi.fn(),
    confirmHumanImageInspection: vi.fn(),
    confirmAllPageRemnants: vi.fn(),
    recheckPageRemnants: vi.fn(),
    setPageRemnantTextEvidence: vi.fn(),
    getExpectedRemnantEvidence: vi.fn(),
    remnantEvidenceKey: vi.fn(),
    syncCleaningEvidence: vi.fn(),
  })),
}));

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
    translatedImageCacheRef: translationRefs.translatedImageCacheRef,
    bubbleCacheRef: translationRefs.bubbleCacheRef,
    textStyleRef: translationRefs.textStyleRef,
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
    pageTargetCacheRef: translationRefs.pageTargetCacheRef,
    getPageTargetLanguage: vi.fn(() => "th"),
    sourceLang: "ja",
    setSourceLang: vi.fn(),
    textStyle: {},
    setTextStyle: vi.fn(),
    sfxMode: "transcribe",
    setSfxMode: vi.fn(),
    restoreSavedSession: vi.fn(async () => null),
    clearSavedSession: vi.fn(async () => {}),
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
    cacheRevision: 0,
  })),
}));

vi.mock("@/lib/translationOverlay", () => ({
  applyTranslationOverlay: vi.fn(),
  downloadTranslatedImage: vi.fn(),
  autoOrganizePageBubbles: vi.fn((bubbles) => ({
    optimizedBubbles: bubbles,
    adjustedCount: 0,
    resolvedCollisionCount: 0,
    unresolvedCollisionCount: 0,
  })),
  detectBubbleCollisions: vi.fn(() => []),
  syncPageOverlayAdjustments: vi.fn(),
}));

vi.mock("react-hot-toast", () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn(() => "mock-toast-id") }),
  Toaster: () => null,
}));

describe("useWorkspaceController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    docManagerState.pages.length = 0;
    translationRefs.bubbleCacheRef.current.clear();
    translationRefs.translatedImageCacheRef.current.clear();
    translationRefs.pageTargetCacheRef.current.clear();
  });

  it("assembles domain orchestrators and provides structured host props", () => {
    const { result } = renderHook(() => useWorkspaceController());

    expect(result.current.headerProps).toBeDefined();
    expect(result.current.canvasProps).toBeDefined();
    expect(result.current.bottomStripProps).toBeDefined();
    expect(result.current.modalsProps).toBeDefined();
    expect(result.current.rootProps).toBeDefined();

    expect(result.current.rootProps.onDragOver).toBeTypeOf("function");
    expect(result.current.rootProps.onDragLeave).toBeTypeOf("function");
    expect(result.current.rootProps.onDrop).toBeTypeOf("function");

    expect(result.current.headerProps.saveStatus).toBe("idle");
    expect(result.current.canvasProps.workspaceLayer).toBe("original");
    expect(result.current.modalsProps.isSettingsOpen).toBe(false);
    expect(result.current.bottomStripProps.onRestoreOriginalRemnant).toBeTypeOf("function");
    expect(result.current.bottomStripProps.onCleanRemnantCandidate).toBeTypeOf("function");
  });

  it("batch typography dirties each cached page so the baked render re-renders", async () => {
    docManagerState.pages.push({ url: "blob:p1", name: "Page 1" });
    const { result } = renderHook(() => useWorkspaceController());
    const translation = vi.mocked(useTranslation).mock.results.at(-1)!.value;
    translation.bubbleCacheRef.current.set("blob:p1", [
      { box: [0, 0, 100, 100], original_text: "HELLO", t: "สวัสดี" },
    ]);

    await act(async () => {
      await result.current.canvasProps.onBatchApplyTypography?.({
        fontFamily: "Prompt, sans-serif",
      });
    });

    expect(translation.bubbleCacheRef.current.get("blob:p1")?.[0].fontFamily).toBe(
      "Prompt, sans-serif",
    );
    expect(translation.markPageDirty).toHaveBeenCalledWith("blob:p1");
  });

  it("adding a manual text bubble dirties its page so the baked render re-renders", () => {
    docManagerState.pages.push({ url: "blob:p1", name: "Page 1" });
    const { result } = renderHook(() => useWorkspaceController());
    const translation = vi.mocked(useTranslation).mock.results.at(-1)!.value;

    act(() => {
      result.current.canvasProps.onAddManualTextBubble?.();
    });

    expect(translation.bubbleCacheRef.current.get("blob:p1")).toHaveLength(1);
    expect(translation.markPageDirty).toHaveBeenCalledWith("blob:p1");
  });

  it("a rejected artwork confirmation tells the user the background inspection is still running", async () => {
    docManagerState.pages.push({ url: "blob:p1", name: "Page 1" });
    const { result } = renderHook(() => useWorkspaceController());
    const cleaning = vi.mocked(useCleaning).mock.results.at(-1)!.value;

    cleaning.confirmArtworkCandidate.mockReturnValueOnce(true);
    act(() => {
      result.current.bottomStripProps.onConfirmArtworkCandidate?.("cand-1", { x: 0, y: 0, width: 4, height: 4 });
    });
    await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
    expect(toast.error).not.toHaveBeenCalled();

    cleaning.confirmArtworkCandidate.mockReturnValueOnce(false);
    act(() => {
      result.current.bottomStripProps.onConfirmArtworkCandidate?.("cand-1", { x: 0, y: 0, width: 4, height: 4 });
    });
    await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
    expect(toast.error).toHaveBeenCalledWith("กำลังตรวจสอบพื้นหลังอยู่ ลองกดยืนยันอีกครั้งหลังตรวจเสร็จ");
  });
});
