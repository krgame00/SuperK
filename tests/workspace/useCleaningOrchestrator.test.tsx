import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useCleaningOrchestrator,
} from "@/hooks/useCleaningOrchestrator";
import type { TranslatedBubble } from "@/lib/translationOverlay";
import { workspaceResourceManager } from "@/lib/lifecycle/workspaceResourceManager";

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock useCleaning
const mockCleanPage = vi.fn();
const mockCleanCurrentPage = vi.fn();
const mockRetryRegion = vi.fn();
const mockResolveMaskRegion = vi.fn();
const mockConfirmArtworkCandidate = vi.fn();
const mockConfirmHumanImageInspection = vi.fn();
const mockConfirmAllPageRemnants = vi.fn();
const mockRecheckPageRemnants = vi.fn();
const mockSetPageRemnantTextEvidence = vi.fn();
const mockGetCurrentRemnantReview = vi.fn();

vi.mock("@/hooks/useCleaning", () => ({
  useCleaning: vi.fn(() => ({
    cleanPage: mockCleanPage,
    cleanCurrentPage: mockCleanCurrentPage,
    retryRegion: mockRetryRegion,
    resolveMaskRegion: mockResolveMaskRegion,
    currentResult: undefined,
    progress: null,
    error: null,
    resultsByPage: new Map(),
    getCurrentRemnantReview: mockGetCurrentRemnantReview,
    confirmArtworkCandidate: mockConfirmArtworkCandidate,
    confirmHumanImageInspection: mockConfirmHumanImageInspection,
    confirmAllPageRemnants: mockConfirmAllPageRemnants,
    recheckPageRemnants: mockRecheckPageRemnants,
    setPageRemnantTextEvidence: mockSetPageRemnantTextEvidence,
    cacheRevision: 0,
  })),
  findRecoveredRegionId: vi.fn((_region, _regions, id) => id),
}));

vi.mock("@/lib/cleaning/textAuthorization", () => ({
  translationScope: vi.fn(() => ({ authorized: true })),
}));

describe("useCleaningOrchestrator", () => {
  const dummyPages = [
    { id: "page_0", url: "blob:http://localhost:3000/page0", name: "page0.jpg" },
    { id: "page_1", url: "blob:http://localhost:3000/page1", name: "page1.png" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["test-image"], { type: "image/jpeg" }),
    });
  });

  it("handleCleanCurrentPage cleans the page and updates layer to clean when untranslated", async () => {
    const bubbleCache = new Map<string, TranslatedBubble[]>();
    const bubbleCacheRef = { current: bubbleCache };
    const uiOperationLockRef = { current: false };
    const setIsUiOperationBusy = vi.fn();
    const setWorkspaceLayer = vi.fn();
    const invalidatePageTranslation = vi.fn();
    const refreshPageTranslation = vi.fn();

    const cleanResult = {
      cleanUrl: "blob:http://localhost:3000/clean0",
      maskUrl: "blob:http://localhost:3000/mask0",
      regions: [],
      cleaningMode: "safe" as const,
      sourceFingerprint: "fp0",
      width: 1000,
      height: 1500,
    };
    mockCleanCurrentPage.mockResolvedValue(cleanResult);

    const { result } = renderHook(() =>
      useCleaningOrchestrator({
        pages: dummyPages,
        currentPage: 0,
        bubbleCacheRef,
        uiOperationLockRef,
        setIsUiOperationBusy,
        setWorkspaceLayer,
        invalidatePageTranslation,
        refreshPageTranslation,
      })
    );

    await act(async () => {
      await result.current.handleCleanCurrentPage();
    });

    expect(mockCleanCurrentPage).toHaveBeenCalled();
    expect(setWorkspaceLayer).toHaveBeenCalledWith("clean");
    expect(invalidatePageTranslation).toHaveBeenCalledWith(dummyPages[0].url);
    expect(workspaceResourceManager.hasResource("page_0", "clean")).toBe(true);
  });

  it("handleCleanCurrentPage retains translated layer and calls refreshPageTranslation when page has translations", async () => {
    const bubbleCache = new Map<string, TranslatedBubble[]>([
      [
        dummyPages[0].url,
        [
          {
            id: "b1",
            original_text: "こんにちは",
            text: "สวัสดี",
            box: [10, 10, 100, 50],
            deleted: false,
          },
        ],
      ],
    ]);
    const bubbleCacheRef = { current: bubbleCache };
    const uiOperationLockRef = { current: false };
    const setIsUiOperationBusy = vi.fn();
    const setWorkspaceLayer = vi.fn();
    const refreshPageTranslation = vi.fn();
    const setReviewedPageUrls = vi.fn();

    const cleanResult = {
      cleanUrl: "blob:http://localhost:3000/clean0-v2",
      maskUrl: "blob:http://localhost:3000/mask0-v2",
      regions: [],
      cleaningMode: "safe" as const,
      sourceFingerprint: "fp0",
      width: 1000,
      height: 1500,
    };
    mockCleanCurrentPage.mockResolvedValue(cleanResult);

    const { result } = renderHook(() =>
      useCleaningOrchestrator({
        pages: dummyPages,
        currentPage: 0,
        bubbleCacheRef,
        uiOperationLockRef,
        setIsUiOperationBusy,
        setWorkspaceLayer,
        refreshPageTranslation,
        setReviewedPageUrls,
      })
    );

    await act(async () => {
      await result.current.handleCleanCurrentPage();
    });

    expect(mockCleanCurrentPage).toHaveBeenCalled();
    expect(setWorkspaceLayer).toHaveBeenCalledWith("translated");
    expect(refreshPageTranslation).toHaveBeenCalledWith(dummyPages[0].url, cleanResult.cleanUrl);
  });

  it("preparePageForTranslation fetches, cleans, and formats page for batch translation", async () => {
    const bubbleCacheRef = { current: new Map<string, TranslatedBubble[]>() };
    const cleanResult = {
      cleanUrl: "blob:http://localhost:3000/clean1",
      maskUrl: "blob:http://localhost:3000/mask1",
      regions: [],
      cleaningMode: "safe" as const,
      preparedIdentity: "prepared-id-1",
      sourceFingerprint: "source-fp-1",
      awaitingReview: false,
    };
    mockCleanPage.mockResolvedValue(cleanResult);

    const { result } = renderHook(() =>
      useCleaningOrchestrator({
        pages: dummyPages,
        currentPage: 0,
        bubbleCacheRef,
      })
    );

    const prepared = await result.current.preparePageForTranslation(dummyPages[1].url, 1);

    expect(prepared.recognitionUrl).toBe(dummyPages[1].url);
    expect(prepared.backgroundUrl).toBe(cleanResult.cleanUrl);
    expect(prepared.maskUrl).toBe(cleanResult.maskUrl);
    expect(prepared.preparedIdentity).toBe(cleanResult.preparedIdentity);
    expect(workspaceResourceManager.hasResource("page_1", "clean")).toBe(true);
  });

  it("getExpectedRemnantEvidence extracts text bounding boxes from bubbleCache", () => {
    const bubbleCache = new Map<string, TranslatedBubble[]>([
      [
        dummyPages[0].url,
        [
          {
            id: "b1",
            original_text: "Text A",
            text: "ข้อความ A",
            box: [10, 20, 100, 200],
            deleted: false,
          },
          {
            id: "b2",
            original_text: "Deleted",
            text: "ลบ",
            box: [50, 50, 80, 80],
            deleted: true,
          },
        ],
      ],
    ]);
    const bubbleCacheRef = { current: bubbleCache };

    const { result } = renderHook(() =>
      useCleaningOrchestrator({
        pages: dummyPages,
        currentPage: 0,
        bubbleCacheRef,
      })
    );

    const evidence = result.current.getExpectedRemnantEvidence(dummyPages[0].url);
    expect(evidence.textEvidence).toHaveLength(1);
    expect(evidence.textEvidence[0].box).toEqual([10, 20, 100, 200]);
  });

  it("handleRetryRegion retries region and updates resources and layer", async () => {
    const bubbleCache = new Map<string, TranslatedBubble[]>([
      [
        dummyPages[0].url,
        [
          {
            id: "b1",
            original_text: "Text A",
            text: "ข้อความ A",
            box: [10, 20, 100, 200],
            deleted: false,
          },
        ],
      ],
    ]);
    const bubbleCacheRef = { current: bubbleCache };
    const setWorkspaceLayer = vi.fn();
    const refreshPageTranslation = vi.fn();

    const retryResult = {
      cleanUrl: "blob:http://localhost:3000/retry-clean",
      maskUrl: "blob:http://localhost:3000/retry-mask",
      regions: [],
      cleaningMode: "safe" as const,
      sourceFingerprint: "fp-retry",
      width: 1000,
      height: 1500,
    };
    mockRetryRegion.mockResolvedValue(retryResult);

    const { result } = renderHook(() =>
      useCleaningOrchestrator({
        pages: dummyPages,
        currentPage: 0,
        bubbleCacheRef,
        setWorkspaceLayer,
        refreshPageTranslation,
      })
    );

    const maskBlob = new Blob(["mask"], { type: "image/png" });
    const retried = await result.current.handleRetryRegion("reg1", maskBlob, "anime-lama", "force-clean");

    expect(mockRetryRegion).toHaveBeenCalledWith("reg1", maskBlob, "anime-lama", "force-clean");
    expect(retried).toBe(retryResult);
    expect(setWorkspaceLayer).toHaveBeenCalledWith("translated");
    expect(refreshPageTranslation).toHaveBeenCalledWith(dummyPages[0].url, retryResult.cleanUrl);
  });

  it("refreshMaskProposal fetches page, cleans, and recovers region", async () => {
    const bubbleCacheRef = { current: new Map<string, TranslatedBubble[]>() };
    const refreshedResult = {
      cleanUrl: "blob:http://localhost:3000/proposal-clean",
      maskUrl: "blob:http://localhost:3000/proposal-mask",
      reviewMaskUrl: "blob:http://localhost:3000/proposal-review-mask",
      regions: [{ id: "reg1", box: [0, 0, 10, 10] }],
      cleaningMode: "safe" as const,
      sourceFingerprint: "fp-prop",
      width: 1000,
      height: 1500,
    };
    mockCleanCurrentPage.mockResolvedValue(refreshedResult);

    const { result } = renderHook(() =>
      useCleaningOrchestrator({
        pages: dummyPages,
        currentPage: 0,
        bubbleCacheRef,
      })
    );

    const proposal = await result.current.refreshMaskProposal({
      id: "reg1",
      box: [0, 0, 10, 10],
    } as any);

    expect(proposal).toBeDefined();
    expect(proposal?.region.id).toBe("reg1");
    expect(proposal?.maskUrl).toBe(refreshedResult.reviewMaskUrl);
  });
});

