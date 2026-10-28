"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type SetStateAction, type Dispatch } from "react";
import {
  findRecoveredRegionId,
  useCleaning,
  type PageCleaningResult,
  type PageRemnantTextEvidence,
} from "@/hooks/useCleaning";
import type { WorkspaceExportPage } from "@/hooks/useExportOrchestrator";
import type { TranslatedBubble } from "@/lib/translationOverlay";
import type { WorkspaceLayer } from "@/components/cleaning/CleaningToolbar";
import type { PreparedTranslationPage } from "@/hooks/useTranslation";
import type {
  CleanerOverride,
  CleaningProgress,
  CleaningRegion,
  ManualRegionAction,
} from "@/lib/cleaning/types";
import { translationScope } from "@/lib/cleaning/textAuthorization";
import { workspaceResourceManager } from "@/lib/lifecycle/workspaceResourceManager";

function resolveImageMimeType(blob: Blob, filename?: string): string {
  if (blob.type && blob.type !== "application/octet-stream") {
    return blob.type;
  }
  const ext = filename?.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return "image/png";
}

export interface UseCleaningOrchestratorOptions {
  pages: WorkspaceExportPage[];
  currentPage: number;
  bubbleCacheRef?: MutableRefObject<Map<string, TranslatedBubble[]>>;
  uiOperationLockRef?: MutableRefObject<boolean>;
  setIsUiOperationBusy?: (busy: boolean) => void;
  setWorkspaceLayer?: (layer: WorkspaceLayer) => void;
  setReviewedPageUrls?: Dispatch<SetStateAction<Set<string>>>;
  getPageSourceRevision?: (pageUrl: string) => string | undefined;
  translationCacheRevision?: number;

  // Bridge for post-cleaning actions / state from translation hook
  translationBridgeRef?: MutableRefObject<{
    refreshPageTranslation?: (pageUrl: string, cleanUrl?: string) => Promise<unknown> | void;
    invalidatePageTranslation?: (pageUrl: string) => void;
    activeBubbles?: TranslatedBubble[];
    bubbleCacheRef?: MutableRefObject<Map<string, TranslatedBubble[]>>;
    getPageSourceRevision?: (pageUrl: string) => string | undefined;
    isTranslating?: boolean;
    isTranslatingAll?: boolean;
  }>;

  // Direct callbacks / state overrides (for tests and direct callers)
  refreshPageTranslation?: (pageUrl: string, cleanUrl?: string) => Promise<unknown> | void;
  invalidatePageTranslation?: (pageUrl: string) => void;
  activeBubbles?: TranslatedBubble[];
  isTranslating?: boolean;
  isTranslatingAll?: boolean;
}

export type UseCleaningOrchestratorReturn = ReturnType<typeof useCleaning> & {
  // Aliases matching page.tsx conventions
  currentCleaningResult: PageCleaningResult | undefined;
  cleaningProgress: CleaningProgress | undefined;
  cleaningError: ReturnType<typeof useCleaning>["error"];
  cleaningResultsByPage: Map<string, PageCleaningResult>;
  cleaningCacheRevision: number;

  // Orchestrated cleaning actions
  handleCleanCurrentPage: () => Promise<void>;
  handleRetryRegion: (
    regionId: string,
    mask: Blob,
    cleaner: CleanerOverride,
    action: ManualRegionAction,
  ) => Promise<PageCleaningResult | undefined>;
  refreshMaskProposal: (
    region: CleaningRegion,
  ) => Promise<{ region: CleaningRegion; maskUrl: string } | undefined>;
  preparePageForTranslation: (
    pageUrl: string,
    pageIndex: number,
    signal?: AbortSignal,
  ) => Promise<PreparedTranslationPage>;

  // Remnant evidence helpers
  getExpectedRemnantEvidence: (pageUrl: string) => PageRemnantTextEvidence;
  remnantEvidenceKey: string;
  syncCleaningEvidence: () => void;
};

export function useCleaningOrchestrator(
  options: UseCleaningOrchestratorOptions,
): UseCleaningOrchestratorReturn {
  const {
    pages,
    currentPage,
    bubbleCacheRef,
    uiOperationLockRef,
    setIsUiOperationBusy,
    setWorkspaceLayer,
    setReviewedPageUrls,
    getPageSourceRevision,
    translationCacheRevision = 0,
    translationBridgeRef,
    refreshPageTranslation: refreshProp,
    invalidatePageTranslation: invalidateProp,
    activeBubbles: activeBubblesProp = [],
    isTranslating: isTranslatingProp = false,
    isTranslatingAll: isTranslatingAllProp = false,
  } = options;

  const pageUrls = useMemo(() => pages.map((p) => p.url), [pages]);
  const pageIds = useMemo(() => pages.map((p) => p.id), [pages]);

  const cleaning = useCleaning({ pages: pageUrls, pageIds, currentPage });
  const {
    cleanPage,
    cleanCurrentPage,
    retryRegion,
    resolveMaskRegion,
    currentResult: currentCleaningResult,
    progress: cleaningProgress,
    error: cleaningError,
    resultsByPage: cleaningResultsByPage,
    getCurrentRemnantReview,
    confirmArtworkCandidate,
    confirmHumanImageInspection,
    confirmAllPageRemnants,
    recheckPageRemnants,
    setPageRemnantTextEvidence,
    cacheRevision: cleaningCacheRevision,
  } = cleaning;

  // Sync results with workspaceResourceManager
  useEffect(() => {
    if (!cleaningResultsByPage) return;
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const pageId = page.id || `page_${i}`;
      const cleanRes = cleaningResultsByPage.get?.(page.url);
      if (cleanRes) {
        if (!workspaceResourceManager.hasResource(pageId, "clean") && cleanRes.cleanUrl) {
          workspaceResourceManager.registerResource(pageId, "clean", cleanRes.cleanUrl, 1024 * 1024);
        }
        if (!workspaceResourceManager.hasResource(pageId, "mask") && cleanRes.maskUrl) {
          workspaceResourceManager.registerResource(pageId, "mask", cleanRes.maskUrl, 256 * 1024);
        }
      }
    }
  }, [pages, cleaningResultsByPage]);

  // Helpers to resolve bridge or prop values at execution time
  const getActiveBubbles = useCallback((): TranslatedBubble[] => {
    return translationBridgeRef?.current?.activeBubbles ?? activeBubblesProp;
  }, [translationBridgeRef, activeBubblesProp]);

  const getIsBusy = useCallback((): boolean => {
    const isTranslating = translationBridgeRef?.current?.isTranslating ?? isTranslatingProp;
    const isTranslatingAll = translationBridgeRef?.current?.isTranslatingAll ?? isTranslatingAllProp;
    return Boolean(
      uiOperationLockRef?.current ||
      isTranslating ||
      isTranslatingAll ||
      cleaningProgress
    );
  }, [uiOperationLockRef, translationBridgeRef, isTranslatingProp, isTranslatingAllProp, cleaningProgress]);

  const getRefreshPageTranslation = useCallback(() => {
    return translationBridgeRef?.current?.refreshPageTranslation ?? refreshProp;
  }, [translationBridgeRef, refreshProp]);

  const getInvalidatePageTranslation = useCallback(() => {
    return translationBridgeRef?.current?.invalidatePageTranslation ?? invalidateProp;
  }, [translationBridgeRef, invalidateProp]);

  const fallbackBubbleCacheRef = useRef<Map<string, TranslatedBubble[]>>(new Map());
  const getBubbleCache = useCallback((): Map<string, TranslatedBubble[]> => {
    return (
      translationBridgeRef?.current?.bubbleCacheRef?.current ??
      bubbleCacheRef?.current ??
      fallbackBubbleCacheRef.current
    );
  }, [translationBridgeRef, bubbleCacheRef]);

  // Unified post-cleaning translation & layer sync
  const syncTranslationAfterClean = useCallback(
    (pageUrl: string, cleanUrl: string, allowInvalidate: boolean) => {
      const bubbleCache = getBubbleCache();
      const cachedBubbles = bubbleCache.get(pageUrl);
      const active = getActiveBubbles();
      const hasExistingTranslation = Boolean(
        (cachedBubbles && cachedBubbles.some((b) => !b.deleted)) ||
        (active.length > 0 && active.some((b) => !b.deleted)),
      );

      if (hasExistingTranslation) {
        if ((!cachedBubbles || cachedBubbles.length === 0) && active.length > 0) {
          bubbleCache.set(pageUrl, active);
        }
        const refresh = getRefreshPageTranslation();
        void refresh?.(pageUrl, cleanUrl);
        setReviewedPageUrls?.((current) => {
          const next = new Set(current);
          next.delete(pageUrl);
          return next;
        });
        setWorkspaceLayer?.("translated");
      } else {
        if (allowInvalidate) {
          getInvalidatePageTranslation()?.(pageUrl);
        }
        setWorkspaceLayer?.("clean");
      }
    },
    [
      getBubbleCache,
      getActiveBubbles,
      getRefreshPageTranslation,
      getInvalidatePageTranslation,
      setReviewedPageUrls,
      setWorkspaceLayer,
    ],
  );

  const handleCleanCurrentPage = useCallback(async () => {
    if (getIsBusy()) return;
    const page = pages[currentPage];
    if (!page) return;

    if (uiOperationLockRef) uiOperationLockRef.current = true;
    setIsUiOperationBusy?.(true);
    try {
      const response = await fetch(page.url);
      if (!response.ok) {
        throw new Error(`Failed to load page for cleaning (${response.status}).`);
      }
      const rawBlob = await response.blob();
      const mime = resolveImageMimeType(rawBlob, page.name);
      const typedBlob = rawBlob.type === mime ? rawBlob : new Blob([rawBlob], { type: mime });
      const cleanResult = await cleanCurrentPage(typedBlob);
      if (cleanResult) {
        const pageId = page.id || `page_${currentPage}`;
        workspaceResourceManager.registerResource(pageId, "clean", cleanResult.cleanUrl, 1024 * 1024);
        if (cleanResult.maskUrl) {
          workspaceResourceManager.registerResource(pageId, "mask", cleanResult.maskUrl, 256 * 1024);
        }
        syncTranslationAfterClean(page.url, cleanResult.cleanUrl, true);
      }
    } finally {
      if (uiOperationLockRef) uiOperationLockRef.current = false;
      setIsUiOperationBusy?.(false);
    }
  }, [
    getIsBusy,
    pages,
    currentPage,
    uiOperationLockRef,
    setIsUiOperationBusy,
    cleanCurrentPage,
    syncTranslationAfterClean,
  ]);

  const preparePageForTranslation = useCallback(
    async (
      pageUrl: string,
      pageIndex: number,
      signal?: AbortSignal,
    ): Promise<PreparedTranslationPage> => {
      const page = pages[pageIndex];
      if (!page || page.url !== pageUrl) {
        throw new Error("Page is no longer available for cleaning.");
      }

      const response = await fetch(pageUrl, { signal });
      if (!response.ok) {
        throw new Error(`Failed to load page for cleaning (${response.status}).`);
      }
      const rawBlob = await response.blob();
      const mime = resolveImageMimeType(rawBlob, page.name);
      const typedBlob = rawBlob.type === mime ? rawBlob : new Blob([rawBlob], { type: mime });
      const result = await cleanPage(pageUrl, typedBlob, false, signal);
      if (signal?.aborted) {
        throw new DOMException("Page preparation was cancelled.", "AbortError");
      }
      const pageId = page.id || `page_${pageIndex}`;
      workspaceResourceManager.registerResource(pageId, "clean", result.cleanUrl, 1024 * 1024);
      if (result.maskUrl) {
        workspaceResourceManager.registerResource(pageId, "mask", result.maskUrl, 256 * 1024);
      }
      const activeSfxMode: "ignore" | "preserve" | "translate" =
        typeof window !== "undefined" && typeof localStorage !== "undefined"
          ? ((localStorage.getItem("superk:sfx-policy") as "ignore" | "preserve" | "translate" | null) ?? "ignore")
          : "ignore";
      return {
        recognitionUrl: pageUrl,
        textScope: translationScope(result, activeSfxMode),
        backgroundUrl: result.cleanUrl,
        maskUrl: result.maskUrl,
        preparedIdentity: result.preparedIdentity,
        sourceFingerprint: result.sourceFingerprint,
        awaitingReview: result.awaitingReview === true,
        cleaningMode: result.cleaningMode,
      };
    },
    [cleanPage, pages],
  );

  const handleRetryRegion = useCallback(
    async (
      regionId: string,
      mask: Blob,
      cleaner: CleanerOverride,
      action: ManualRegionAction,
    ): Promise<PageCleaningResult | undefined> => {
      const result = await retryRegion(regionId, mask, cleaner, action);
      const page = pages[currentPage];
      if (page && result && action !== "confirm-text") {
        const pageId = page.id || `page_${currentPage}`;
        if (result.cleanUrl) {
          workspaceResourceManager.registerResource(pageId, "clean", result.cleanUrl, 1024 * 1024);
        }
        if (result.maskUrl) {
          workspaceResourceManager.registerResource(pageId, "mask", result.maskUrl, 256 * 1024);
        }
        syncTranslationAfterClean(page.url, result.cleanUrl, false);
      }
      return result;
    },
    [retryRegion, pages, currentPage, syncTranslationAfterClean],
  );

  const [evidenceSyncTrigger, setEvidenceSyncTrigger] = useState(0);
  const syncCleaningEvidence = useCallback(() => {
    setEvidenceSyncTrigger((prev) => prev + 1);
  }, []);

  const refreshMaskProposal = useCallback(
    async (region: CleaningRegion) => {
      const page = pages[currentPage];
      if (!page) return undefined;
      const response = await fetch(page.url, { cache: "no-store" });
      if (!response.ok) return undefined;
      const refreshed = await cleanCurrentPage(await response.blob(), true);
      if (!refreshed) return undefined;
      const pageId = page.id || `page_${currentPage}`;
      if (refreshed.cleanUrl) {
        workspaceResourceManager.registerResource(pageId, "clean", refreshed.cleanUrl, 1024 * 1024);
      }
      if (refreshed.maskUrl) {
        workspaceResourceManager.registerResource(pageId, "mask", refreshed.maskUrl, 256 * 1024);
      }
      syncTranslationAfterClean(page.url, refreshed.cleanUrl, false);
      const recoveredId = findRecoveredRegionId(region, refreshed.regions, region.id);
      const recovered = refreshed.regions.find((item) => item.id === recoveredId);
      return recovered && refreshed.reviewMaskUrl
        ? { region: recovered, maskUrl: refreshed.reviewMaskUrl }
        : undefined;
    },
    [pages, currentPage, cleanCurrentPage, syncTranslationAfterClean],
  );

  // Remnant evidence synchronization
  const pageSourceFingerprintByUrl = useMemo(() => {
    const map = new Map<string, string>();
    for (const page of pages) {
      if (page.sourceFingerprint) map.set(page.url, page.sourceFingerprint);
    }
    return map;
  }, [pages]);

  const getExpectedRemnantEvidence = useCallback(
    (pageUrl: string): PageRemnantTextEvidence => {
      const getSourceRev =
        translationBridgeRef?.current?.getPageSourceRevision ?? getPageSourceRevision;
      return {
        sourceContext:
          cleaningResultsByPage?.get?.(pageUrl)?.sourceFingerprint ||
          getSourceRev?.(pageUrl) ||
          pageSourceFingerprintByUrl.get(pageUrl) ||
          "",
        textEvidence: (getBubbleCache().get(pageUrl) ?? []).flatMap((bubble, index) =>
          !bubble.deleted &&
          bubble.original_text?.trim() &&
          bubble.box?.length === 4 &&
          bubble.box.every(Number.isFinite)
            ? [{ id: String(index), box: [...bubble.box] }]
            : [],
        ),
      };
    },
    [
      getBubbleCache,
      cleaningResultsByPage,
      translationBridgeRef,
      getPageSourceRevision,
      pageSourceFingerprintByUrl,
    ],
  );

  const remnantEvidenceKey = useMemo(
    () =>
      pages
        .map((page, idx) => {
          const ev = getExpectedRemnantEvidence(page.url);
          return `${page.id ?? idx}:${ev.sourceContext}:${ev.textEvidence.map((t) => `${t.id}@${t.box.join(",")}`).join(";")}`;
        })
        .join("|"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pages, evidenceSyncTrigger, cleaningCacheRevision, getExpectedRemnantEvidence],
  );

  const lastSyncedEvidenceByPageRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const activeUrls = new Set(pages.map((p) => p.url));
    for (const url of lastSyncedEvidenceByPageRef.current.keys()) {
      if (!activeUrls.has(url)) lastSyncedEvidenceByPageRef.current.delete(url);
    }
    for (const page of pages) {
      const ev = getExpectedRemnantEvidence(page.url);
      const pageKey = `${ev.sourceContext}:${ev.textEvidence.map((t) => `${t.id}@${t.box.join(",")}`).join(";")}`;
      if (lastSyncedEvidenceByPageRef.current.get(page.url) === pageKey) continue;
      lastSyncedEvidenceByPageRef.current.set(page.url, pageKey);
      setPageRemnantTextEvidence?.(page.url, ev);
    }
  }, [pages, remnantEvidenceKey, evidenceSyncTrigger, getExpectedRemnantEvidence, setPageRemnantTextEvidence]);

  return {
    ...cleaning,
    currentCleaningResult,
    cleaningProgress,
    cleaningError,
    cleaningResultsByPage,
    cleaningCacheRevision,
    handleCleanCurrentPage,
    handleRetryRegion,
    refreshMaskProposal,
    preparePageForTranslation,
    getExpectedRemnantEvidence,
    remnantEvidenceKey,
    syncCleaningEvidence,
  };
}
