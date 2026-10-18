import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useTranslationWorkspaceCoordinator, type UseTranslationWorkspaceCoordinatorOptions } from "@/hooks/useTranslationWorkspaceCoordinator";

vi.mock("react-hot-toast", () => ({
  default: vi.fn(),
}));

describe("useTranslationWorkspaceCoordinator", () => {
  let uiOperationLockRef: { current: boolean };
  let setIsUiOperationBusy: ReturnType<typeof vi.fn>;
  let setWorkspaceLayer: ReturnType<typeof vi.fn>;
  let onNavigatePage: ReturnType<typeof vi.fn>;
  let setReviewedPageUrls: ReturnType<typeof vi.fn>;
  let handleTranslate: ReturnType<typeof vi.fn>;
  let handleTranslateAll: ReturnType<typeof vi.fn>;
  let handleAutoOrganizeAllPages: ReturnType<typeof vi.fn>;
  let scanTranslatedPages: ReturnType<typeof vi.fn>;
  let inspectLegacyTargets: ReturnType<typeof vi.fn>;
  let confirmLegacyTarget: ReturnType<typeof vi.fn>;
  let inspectReviewIssues: ReturnType<typeof vi.fn>;
  let confirmPointReview: ReturnType<typeof vi.fn>;
  let applyAllSuggestedReviews: ReturnType<typeof vi.fn>;
  let repairWholeBook: ReturnType<typeof vi.fn>;
  let setTranslationResult: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    uiOperationLockRef = { current: false };
    setIsUiOperationBusy = vi.fn();
    setWorkspaceLayer = vi.fn();
    onNavigatePage = vi.fn();
    setReviewedPageUrls = vi.fn();
    handleTranslate = vi.fn().mockResolvedValue(true);
    handleTranslateAll = vi.fn().mockResolvedValue(undefined);
    handleAutoOrganizeAllPages = vi.fn().mockResolvedValue(undefined);
    scanTranslatedPages = vi.fn().mockReturnValue([]);
    inspectLegacyTargets = vi.fn().mockReturnValue([]);
    confirmLegacyTarget = vi.fn().mockReturnValue(1);
    inspectReviewIssues = vi.fn().mockReturnValue([]);
    confirmPointReview = vi.fn();
    applyAllSuggestedReviews = vi.fn().mockReturnValue(2);
    repairWholeBook = vi.fn().mockResolvedValue({
      cancelled: false,
      pagesRepaired: 1,
      pointsRepaired: 3,
      unresolved: [],
      skipped: [],
    });
    setTranslationResult = vi.fn();
  });

  function createHookProps(overrides = {}) {
    return {
      currentPageUrl: "http://example.com/p1.jpg",
      currentPageIndex: 0,
      pagesCount: 3,
      currentCleaningResult: null,
      hasCurrentTranslation: false,
      reviewedPageUrls: new Set<string>(),
      setReviewedPageUrls: setReviewedPageUrls as never,
      setWorkspaceLayer: setWorkspaceLayer as never,
      onNavigatePage: onNavigatePage as never,
      operationBusy: false,
      uiOperationLockRef,
      setIsUiOperationBusy,
      isTranslating: false,
      isTranslatingAll: false,
      translateAllProgress: null,
      cleaningProgress: null,
      workflowPhase: null,
      translationResult: null,
      setTranslationResult,
      handleTranslate,
      handleTranslateAll,
      handleAutoOrganizeAllPages,
      scanTranslatedPages,
      inspectLegacyTargets,
      confirmLegacyTarget,
      inspectReviewIssues,
      confirmPointReview,
      applyAllSuggestedReviews,
      repairWholeBook,
      targetLang: "Thai",
      ...overrides,
    } as unknown as UseTranslationWorkspaceCoordinatorOptions;
  }

  it("handleTranslateCurrent locks UI, sets translated layer and calls handleTranslate", async () => {
    const props = createHookProps();
    const { result } = renderHook(() => useTranslationWorkspaceCoordinator(props));

    let translated = false;
    await act(async () => {
      translated = await result.current.handleTranslateCurrent();
    });

    expect(translated).toBe(true);
    expect(setWorkspaceLayer).toHaveBeenCalledWith("translated");
    expect(handleTranslate).toHaveBeenCalledTimes(1);
    expect(setIsUiOperationBusy).toHaveBeenCalledWith(true);
    expect(setIsUiOperationBusy).toHaveBeenLastCalledWith(false);
    expect(uiOperationLockRef.current).toBe(false);
  });

  it("handleTranslateCurrent bails out when operationBusy or uiOperationLock is true", async () => {
    const props = createHookProps({ operationBusy: true });
    const { result } = renderHook(() => useTranslationWorkspaceCoordinator(props));

    let translated = false;
    await act(async () => {
      translated = await result.current.handleTranslateCurrent();
    });

    expect(translated).toBe(false);
    expect(handleTranslate).not.toHaveBeenCalled();
  });

  it("handleTranslateBook translates all pages and auto-organizes bubbles", async () => {
    const props = createHookProps();
    const { result } = renderHook(() => useTranslationWorkspaceCoordinator(props));

    await act(async () => {
      await result.current.handleTranslateBook();
    });

    expect(setWorkspaceLayer).toHaveBeenCalledWith("translated");
    expect(handleTranslateAll).toHaveBeenCalledTimes(1);
    expect(handleAutoOrganizeAllPages).toHaveBeenCalledTimes(1);
    expect(uiOperationLockRef.current).toBe(false);
  });

  it("resolves primaryAction and triggers translation on handlePrimaryAction", async () => {
    const props = createHookProps({
      hasCurrentTranslation: false,
    });
    const { result } = renderHook(() => useTranslationWorkspaceCoordinator(props));

    expect(result.current.primaryAction.kind).toBe("prepare-and-translate");

    await act(async () => {
      await result.current.handlePrimaryAction();
    });

    expect(handleTranslate).toHaveBeenCalledTimes(1);
    expect(setReviewedPageUrls).toHaveBeenCalled();
  });

  it("switches to translated layer and marks reviewed when primaryAction is review", async () => {
    const props = createHookProps({
      hasCurrentTranslation: true,
      currentCleaningResult: { cleanUrl: "clean.png" },
    });
    const { result } = renderHook(() => useTranslationWorkspaceCoordinator(props));

    expect(result.current.primaryAction.kind).toBe("review");

    await act(async () => {
      await result.current.handlePrimaryAction();
    });

    expect(setWorkspaceLayer).toHaveBeenCalledWith("translated");
    expect(setReviewedPageUrls).toHaveBeenCalled();
  });

  it("handleScanTranslations scans pages and opens legacyTargetPages if pending", () => {
    inspectLegacyTargets.mockReturnValue([{ pageIndex: 1, pageUrl: "http://example.com/p2.jpg" }]);
    const props = createHookProps();
    const { result } = renderHook(() => useTranslationWorkspaceCoordinator(props));

    act(() => {
      result.current.handleScanTranslations();
    });

    expect(result.current.legacyTargetPages).toEqual([
      { pageIndex: 1, pageUrl: "http://example.com/p2.jpg" },
    ]);
    expect(result.current.reviewIssues).toBeNull();
  });

  it("handleScanTranslations opens reviewIssues when review issues are detected", () => {
    inspectReviewIssues.mockReturnValue([{ pageIndex: 0, pageUrl: "http://example.com/p1.jpg" }]);
    const props = createHookProps();
    const { result } = renderHook(() => useTranslationWorkspaceCoordinator(props));

    act(() => {
      result.current.handleScanTranslations();
    });

    expect(result.current.reviewIssues).toEqual([
      { pageIndex: 0, pageUrl: "http://example.com/p1.jpg" },
    ]);
  });

  it("handleRepairWholeBook executes repair and updates issues", async () => {
    const props = createHookProps();
    const { result } = renderHook(() => useTranslationWorkspaceCoordinator(props));

    await act(async () => {
      await result.current.handleRepairWholeBook();
    });

    expect(repairWholeBook).toHaveBeenCalledTimes(1);
    expect(scanTranslatedPages).toHaveBeenCalled();
  });

  it("handleRetranslateContaminated translates only contaminated pages", async () => {
    const props = createHookProps();
    const { result } = renderHook(() => useTranslationWorkspaceCoordinator(props));

    act(() => {
      result.current.setContaminatedScan([
        { pageIndex: 1, contaminated: 2 },
        { pageIndex: 2, contaminated: 1 },
      ]);
    });

    await act(async () => {
      await result.current.handleRetranslateContaminated();
    });

    expect(setWorkspaceLayer).toHaveBeenCalledWith("translated");
    expect(handleTranslateAll).toHaveBeenCalledWith([1, 2]);
  });

  it("manages legacy targets and review points callbacks", () => {
    const props = createHookProps();
    const { result } = renderHook(() => useTranslationWorkspaceCoordinator(props));

    act(() => {
      result.current.setLegacyTargetPages([{ pageIndex: 0, pageUrl: "p1" }]);
    });
    expect(result.current.legacyTargetPages).toHaveLength(1);

    act(() => {
      result.current.handleConfirmLegacyTarget();
    });
    expect(confirmLegacyTarget).toHaveBeenCalledTimes(1);
    expect(result.current.legacyTargetPages).toBeNull();

    act(() => {
      result.current.handleApplyAllSuggestedReviews();
    });
    expect(applyAllSuggestedReviews).toHaveBeenCalledWith("all");

    act(() => {
      result.current.handleConfirmPointReview("http://example.com/p1.jpg", 0, true);
    });
    expect(confirmPointReview).toHaveBeenCalledWith("http://example.com/p1.jpg", 0, true);

    act(() => {
      result.current.handleNavigateToReviewIssuePage(2);
    });
    expect(onNavigatePage).toHaveBeenCalledWith(2);
  });
});
