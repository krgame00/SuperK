import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useWorkspaceController } from "@/hooks/useWorkspaceController";

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

describe("useWorkspaceController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
