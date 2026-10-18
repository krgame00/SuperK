"use client";

import { useMemo, useCallback, useEffect } from "react";
import { useTranslation, type PreparedTranslationPage } from "@/hooks/useTranslation";
import {
  useBubbleOrganizeOrchestrator,
} from "@/hooks/useBubbleOrganizeOrchestrator";
import { normalizePageExportSource } from "@/lib/export/pageSource";
import { workspaceResourceManager } from "@/lib/lifecycle/workspaceResourceManager";
import type { WorkspaceExportPage } from "@/hooks/useExportOrchestrator";
import type { PageCleaningResult } from "@/hooks/useCleaning";
import type { TranslatedBubble } from "@/lib/translationOverlay";

export interface TranslationBridge {
  refreshPageTranslation?: (pageUrl: string, cleanUrl?: string) => Promise<unknown> | void;
  invalidatePageTranslation?: (pageUrl: string) => void;
  activeBubbles?: TranslatedBubble[];
  bubbleCacheRef?: { current: Map<string, TranslatedBubble[]> };
  getPageSourceRevision?: (pageUrl: string) => string | undefined;
  isTranslating?: boolean;
  isTranslatingAll?: boolean;
}

export interface UseTranslationOrchestratorOptions {
  pages: WorkspaceExportPage[];
  currentPage: number;
  currentPageUrl?: string;
  currentPageRef: { current: number };
  pagesRef: { current: WorkspaceExportPage[] };
  dirtyExportPagesRef: { current: Set<string> };
  setConfirmedPages: (update: (previous: Set<string>) => Set<string>) => void;
  viewLayout: "single" | "scroll";
  currentCleaningResult?: PageCleaningResult;
  cleaningResultsByPage: Map<string, PageCleaningResult>;
  preparePageForTranslation: (
    pageUrl: string,
    pageIndex: number,
    signal?: AbortSignal,
  ) => Promise<PreparedTranslationPage>;
  syncCleaningEvidence: () => void;
  translationBridgeRef: { current: TranslationBridge };
}

export function useTranslationOrchestrator({
  pages,
  currentPage,
  currentPageUrl,
  currentPageRef,
  pagesRef,
  dirtyExportPagesRef,
  setConfirmedPages,
  viewLayout,
  currentCleaningResult,
  cleaningResultsByPage,
  preparePageForTranslation,
  syncCleaningEvidence,
  translationBridgeRef,
}: UseTranslationOrchestratorOptions) {
  const pageUrls = useMemo(() => pages.map((p) => p.url), [pages]);
  const pageIds = useMemo(
    () => pages.map((p, i) => p.id || `page_${i}`),
    [pages],
  );
  const pageNames = useMemo(() => pages.map((p) => p.name), [pages]);
  const pageOriginUrls = useMemo(() => pages.map((p) => p.originUrl), [pages]);
  const pageReaderImageUrls = useMemo(
    () => pages.map((p) => p.readerImageUrl),
    [pages],
  );
  const pageExportSources = useMemo(
    () => pages.map((p) => normalizePageExportSource(p.exportSource)),
    [pages],
  );
  const pageSourceFingerprints = useMemo(() => {
    const safeResults =
      cleaningResultsByPage && typeof cleaningResultsByPage.entries === "function"
        ? [...cleaningResultsByPage.entries()]
        : [];
    return new Map([
      ...pages.flatMap((page) =>
        page.sourceFingerprint ? ([[page.url, page.sourceFingerprint] as const]) : [],
      ),
      ...safeResults.flatMap(([url, result]) =>
        result.sourceFingerprint ? ([[url, result.sourceFingerprint] as const]) : [],
      ),
    ]);
  }, [pages, cleaningResultsByPage]);

  const getCleanedPageUrl = useCallback(
    (pageUrl: string) => cleaningResultsByPage?.get?.(pageUrl)?.cleanUrl,
    [cleaningResultsByPage],
  );

  const onPageDirtied = useCallback(
    (pageUrl: string) => {
      dirtyExportPagesRef.current.add(pageUrl);
      setConfirmedPages((prev) => {
        if (!prev.has(pageUrl)) return prev;
        const next = new Set(prev);
        next.delete(pageUrl);
        return next;
      });
    },
    [dirtyExportPagesRef, setConfirmedPages],
  );

  const translation = useTranslation({
    currentPage,
    pages: pageUrls,
    pageIds,
    pageNames,
    pageOriginUrls,
    pageReaderImageUrls,
    pageExportSources,
    pageSourceFingerprints,
    viewMode: "single",
    preparePageForTranslation,
    getCleanedPageUrl,
    onPageDirtied,
  });

  const {
    refreshPageTranslation,
    invalidatePageTranslation,
    activeBubbles,
    bubbleCacheRef,
    getPageSourceRevision,
    isTranslating,
    isTranslatingAll,
    translatedImages,
    getPageSignature,
    cacheRevision: translationCacheRevision,
    setActiveBubbles,
    textStyleRef,
    targetLang,
    getPageTargetLanguage,
    markPageDirty,
    setTranslationResult,
  } = translation;

  translationBridgeRef.current = {
    refreshPageTranslation,
    invalidatePageTranslation,
    activeBubbles,
    bubbleCacheRef,
    getPageSourceRevision,
    isTranslating,
    isTranslatingAll,
  };

  useEffect(() => {
    syncCleaningEvidence();
  }, [translationCacheRevision, syncCleaningEvidence]);

  useEffect(() => {
    if (!translatedImages) return;
    for (let i = 0; i < pages.length; i++) {
      if (Math.abs(i - currentPage) > 2) continue;
      const page = pages[i];
      const pageId = page.id || `page_${i}`;
      const renderedUrl = translatedImages?.get?.(page.url);
      if (renderedUrl && !workspaceResourceManager.hasResource(pageId, "translated-render")) {
        const approxBytes = Math.round(renderedUrl.length * 0.75);
        const signature = getPageSignature?.(page.url) ?? "rev-0";
        workspaceResourceManager.registerRenderedImage(pageId, signature, renderedUrl, approxBytes);
      }
    }
  }, [pages, currentPage, translatedImages, getPageSignature]);

  const organize = useBubbleOrganizeOrchestrator({
    pages,
    currentPage,
    currentPageUrl: currentPageUrl ?? pages[currentPage]?.url,
    activeBubbles,
    setActiveBubbles,
    bubbleCacheRef,
    pagesRef,
    currentPageRef,
    textStyleRef,
    targetLang,
    getPageTargetLanguage,
    dirtyExportPagesRef,
    markPageDirty,
    viewLayout,
    setTranslationResult,
    refreshPageTranslation,
    currentCleaningResult,
    cleaningResultsByPage,
    translatedImages,
  });

  return {
    ...translation,
    translationCacheRevision,
    ...organize,
  };
}
