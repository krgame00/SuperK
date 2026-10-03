import type { PageExportSource } from "@/lib/export/pageSource";
import { scopedRecognitionImage, withinTranslationScope, type TranslationScope } from "@/lib/cleaning/textAuthorization";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  getTranslationRetryDelay,
  isUserCancelledError,
  readTranslationResponse,
  shouldAutoRetryTranslation,
  TranslationRequestError,
  type TranslationObservabilityMeta,
  DEFAULT_QUOTA_COOLDOWN_MS,
} from "@/lib/translation/requestError";
import { applyTranslationOverlay } from "@/lib/translationOverlay";
import type { TranslatedBubble } from "@/lib/translationOverlay";
import {
  saveProjectSession,
  loadProjectSession,
  clearProjectSession,
  deleteAsset,
} from "@/lib/projectStore";
import { LRUMap } from "@/lib/lruMap";
import { resolveTranslationOutcome } from "@/lib/translationPipeline";
import { parseLLMJSON } from "@/lib/parseLLMJSON";
import { deduplicateTranslations, excludeDeletedTranslations, findMissingTranslationRegions, recoverMissingTranslations } from "@/lib/translation/completeness";
import { reviewTranslatedBubbles } from "@/lib/translation/qualityReviewClient";
import { invalidateQualityReview, needsQualityReview } from "@/lib/translation/qualityReview";
import {
  normalizeTranslationPayload,
  countContaminatedBubbles,
} from "@/lib/thaiSpellcheck";
import { sampleBubbleRegion } from "@/lib/colorMatching/canvasSampler";
import { extractTextColors } from "@/lib/colorMatching/sampleTextColors";
import { needsSourceOutlineRefresh, refreshSourceOutline } from "@/lib/colorMatching/outlineMigration";
import { analyzeImageElementMonochrome } from "@/lib/colorMatching/monochromePage";
import {
  applyNearbyStyleFallbacks,
  inferTextStyleCategory,
} from "@/lib/colorMatching/nearbyStyleFallback";
import type { TextStyleProfile } from "@/lib/colorMatching/types";
import { type GlossaryEntry } from "@/lib/translation/glossary";
import {
  classifyTranslationError,
  type DiagnosticDetail,
} from "@/lib/translation/diagnostics";
import { CleaningClientError } from "@/lib/cleaning/client";
import type { CleaningMode } from "@/lib/cleaning/types";
import {
  buildFailureGroups,
  extendFailureGroupCooldown,
} from "@/lib/translation/failureGroups";

export type SaveStatus = "idle" | "saving" | "saved" | "error";
export type TranslationWorkflowPhase = "cleaning" | "translating";

export interface BatchPageFailure {
  failureGroupId: string;
  pageIndex: number;
  pageUrl: string;
  stage: "cleaning" | "translation";
  message: string;
  diagnostic?: DiagnosticDetail;
}

export interface BatchPerformanceMetrics {
  recordedAt: number;
  wallClockMs: number;
  pageDurationsMs: number[];
  medianPageMs?: number;
  p95PageMs?: number;
  completedPages: number;
  failedPages: number;
  cancelled: boolean;
}

export interface PreparedTranslationPage {
  cleaningMode?: CleaningMode;
  textScope?: TranslationScope;
  recognitionUrl: string;
  backgroundUrl: string;
  maskUrl?: string;
  preparedIdentity?: string;
  awaitingReview?: boolean;
}

interface UseTranslationProps {
  currentPage: number;
  pages: string[];
  /** Stable identities matching `pages` order, used for compact persistence. */
  pageIds?: (string | undefined)[];
  /** Display names matching `pages` order, persisted with saved sessions. */
  pageNames?: string[];
  pageExportSources?: PageExportSource[];
  /** Origin URLs matching `pages` order, persisted with saved sessions. */
  pageOriginUrls?: (string | undefined)[];
  viewMode: "single" | "scroll";
  preparePageForTranslation: (
    pageUrl: string,
    pageIndex: number,
    signal?: AbortSignal,
  ) => Promise<PreparedTranslationPage>;
  onPageDirtied?: (pageUrl: string) => void;
}

const TRANSLATED_IMAGE_CACHE_LIMIT = 8;

export const deduplicateBubbleSFX = (
  bubbles: TranslatedBubble[],
  ..._legacyLimit: number[]
): TranslatedBubble[] => {
  void _legacyLimit;
  return deduplicateTranslations(bubbles);
};

import { preserveManualStyleProfiles } from "@/lib/colorMatching/resolveTextStyle";
export { preserveManualStyleProfiles };

export function sendDesktopNotification(title: string, body: string): void {
  if (typeof window === "undefined") return;

  // 1. Electron Desktop IPC notification
  const desktopApi = (
    window as unknown as {
      superkDesktop?: {
        notify?: (payload: { title: string; body: string }) => void;
      };
    }
  ).superkDesktop;

  if (typeof desktopApi?.notify === "function") {
    try {
      desktopApi.notify({ title, body });
      return;
    } catch {
      // Fallback to Web Notification if IPC fails
    }
  }

  // 2. Web Notification fallback
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    try {
      new Notification(title, { body });
    } catch {
      // Ignore notification errors in restricted environments
    }
  }
}

const waitForImageReady = (src: string, timeoutMs = 3000): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    if (typeof Image === "undefined") {
      reject(new Error("Image constructor unavailable"));
      return;
    }
    const image = new Image();
    if (src.startsWith("http://") || src.startsWith("https://")) {
      image.crossOrigin = "anonymous";
    }

    // In node/JSDOM test environment without layout engine, resolve immediately
    if (typeof process !== "undefined" && process.env?.NODE_ENV === "test") {
      image.onload = () => resolve(image);
      image.onerror = () => resolve(image);
      image.src = src;
      resolve(image);
      return;
    }

    if (image.complete && (image.naturalWidth > 0 || image.width > 0)) {
      resolve(image);
      return;
    }
    let settled = false;
    const watchdog = setTimeout(() => {
      if (settled) return;
      settled = true;
      image.onload = null;
      image.onerror = null;
      if (image.naturalWidth > 0 || image.width > 0) {
        resolve(image);
      } else {
        reject(new Error("โหลดรูปภาพไม่สำเร็จ"));
      }
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(watchdog);
      image.onload = null;
      image.onerror = null;
    };
    image.onload = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("โหลดรูปภาพไม่สำเร็จ"));
    };
    image.src = src;
    if (image.complete && (image.naturalWidth > 0 || image.width > 0)) {
      settled = true;
      cleanup();
      resolve(image);
    }
  });

export const enrichBubblesWithColorProfiles = async (
  bubbles: TranslatedBubble[],
  recognitionUrl: string,
): Promise<TranslatedBubble[]> => {
  if (!bubbles || bubbles.length === 0 || !recognitionUrl) return bubbles;
  try {
    const img = await waitForImageReady(recognitionUrl, 2000);
    const pageAnalysis = analyzeImageElementMonochrome(img);

    for (const b of bubbles) {
      if (b.styleProfile && b.styleProfile.source === "manual") continue;
      if (!b.box || b.box.length < 4 || b.isInvalidBox) continue;

      // Sample the original pre-clean image only. The cleaning mask is a
      // text-removal mask, not a glyph mask, and using it here can leak skin,
      // clothing, or background colors into the recovered source style.
      const sample = sampleBubbleRegion(img, b.box);
      if (sample) {
        const profile = extractTextColors(sample);
        profile.category = inferTextStyleCategory(b);
        if (profile.source === "global" && !profile.fallbackReason) {
          profile.fallbackReason = "low-confidence";
        }
        profile.isMonochromePage = pageAnalysis.isMonochrome;
        profile.monochromeConfidence = pageAnalysis.confidence;
        b.styleProfile = profile;
      }
    }
    applyNearbyStyleFallbacks(bubbles);

    // Propagate page monochrome evidence to any non-manual bubbles that received fallbacks
    for (const b of bubbles) {
      if (b.styleProfile && b.styleProfile.source !== "manual") {
        b.styleProfile.isMonochromePage = pageAnalysis.isMonochrome;
        b.styleProfile.monochromeConfidence = pageAnalysis.confidence;
      }
    }
  } catch (err) {
    console.warn("Failed to sample color profiles for bubbles:", err);
  }
  return bubbles;
};

export function useTranslation({
  currentPage,
  pages,
  pageIds,
  pageNames,
  pageExportSources,
  pageOriginUrls,
  viewMode,
  preparePageForTranslation,
  onPageDirtied,
}: UseTranslationProps) {
  const [isTranslatingAll, setIsTranslatingAll] = useState(false);
  const [translateAllProgress, setTranslateAllProgress] = useState<{
    current: number;
    total: number;
    status: "cleaning" | "translating" | "waiting" | "cooldown";
    message: string;
    startTime: number;
    elapsedMs: number;
    pageElapsedMs: number;
    lastPageDurationMs?: number;
    secondaryMessage?: string;
  } | null>(null);
  const translationStopwatchRef = useRef<{
    batchStartedAt: number;
    pageStartedAt: number;
    pageExcludedMs: number;
    pagePausedAt: number | null;
    lastPageDurationMs?: number;
  }>({
    batchStartedAt: 0,
    pageStartedAt: 0,
    pageExcludedMs: 0,
    pagePausedAt: null,
  });
  const cancelTranslateAllRef = useRef(false);
  const translationOperationLockRef = useRef(false);
  const suppressedOverlayPagesRef = useRef(new Set<string>());
  // Aborts in-flight fetches as soon as the user cancels (or unmounts),
  // instead of letting the current page run to completion.
  const translationAbortRef = useRef<AbortController | null>(null);
  const [batchFailures, setBatchFailures] = useState<BatchPageFailure[]>([]);
  const [batchPerformanceMetrics, setBatchPerformanceMetrics] =
    useState<BatchPerformanceMetrics | null>(null);
  const failureGroupSequenceRef = useRef(0);
  const [quotaCooldownByGroup, setQuotaCooldownByGroup] = useState<Record<string, number>>({});
  const [quotaClockMs, setQuotaClockMs] = useState(() => Date.now());
  const [workflowPhase, setWorkflowPhase] =
    useState<TranslationWorkflowPhase | null>(null);
  const [autoProceedOnReview, setAutoProceedOnReviewState] = useState<boolean>(() => {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem("superk:auto-proceed-review");
      if (saved !== null) return saved === "true";
    }
    return false;
  });
  const [reviewFlaggedPages, setReviewFlaggedPages] = useState<Set<string>>(new Set());
  const userApprovedReviewPagesRef = useRef<Set<string>>(new Set());
  const inFlightConcurrentPagesRef = useRef<Set<number>>(new Set());

  const setAutoProceedOnReview = useCallback((value: boolean) => {
    setAutoProceedOnReviewState(value);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("superk:auto-proceed-review", String(value));
    }
  }, []);

  useEffect(() => {
    const hasActiveCooldown = Object.values(quotaCooldownByGroup).some(
      (expiry) => expiry > Date.now(),
    );
    if (!hasActiveCooldown) return;

    setQuotaClockMs(Date.now());
    let timerId: number | null = window.setInterval(() => {
      const now = Date.now();
      setQuotaClockMs(now);
      const stillActive = Object.values(quotaCooldownByGroup).some(
        (expiry) => expiry > now,
      );
      if (!stillActive && timerId !== null) {
        window.clearInterval(timerId);
        timerId = null;
      }
    }, 250);

    return () => {
      if (timerId !== null) {
        window.clearInterval(timerId);
        timerId = null;
      }
    };
  }, [quotaCooldownByGroup]);

  useEffect(() => {
    const isTestRuntime =
      typeof process !== "undefined" && process.env?.NODE_ENV === "test";
    if (!isTranslatingAll || isTestRuntime) return;

    const timerId = window.setInterval(() => {
      const now = Date.now();
      const stopwatch = translationStopwatchRef.current;
      const pageClockNow = stopwatch.pagePausedAt ?? now;
      const pageElapsedMs = stopwatch.pageStartedAt > 0
        ? Math.max(
            0,
            pageClockNow - stopwatch.pageStartedAt - stopwatch.pageExcludedMs,
          )
        : (stopwatch.lastPageDurationMs ?? 0);

      setTranslateAllProgress((previous) => previous
        ? {
            ...previous,
            elapsedMs: Math.max(0, now - stopwatch.batchStartedAt),
            pageElapsedMs,
            lastPageDurationMs: stopwatch.lastPageDurationMs,
          }
        : previous);
    }, 250);

    return () => window.clearInterval(timerId);
  }, [isTranslatingAll]);

  const failureGroups = useMemo(
    () => buildFailureGroups(batchFailures, quotaCooldownByGroup, quotaClockMs),
    [batchFailures, quotaCooldownByGroup, quotaClockMs],
  );

  const [targetLang, setTargetLang] = useState("Thai");
  const [sourceLang, setSourceLang] = useState("auto");
  const [modelPreference, setModelPreference] = useState("auto");
  const [allowPreviewModels, setAllowPreviewModelsState] = useState<boolean>(() => {
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      return localStorage.getItem("gemini_allow_preview_models") === "true";
    }
    return false;
  });
  const [textStyle, setTextStyle] = useState({
    fontFamily: "Itim, sans-serif",
    textColor: "#000000",
    textOutline: "#FFFFFF",
    fontSizeMultiplier: 1.0
  });
  const textStyleRef = useRef(textStyle);

  const [nsfwBypassMode, setNsfwBypassMode] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationResult, setTranslationResult] = useState<string | null>(null);
  const [showTranslate, setShowTranslate] = useState(false);
  const [activeBubbles, setActiveBubbles] = useState<TranslatedBubble[]>([]);
  const [cacheRevision, setCacheRevision] = useState(0);

  useEffect(() => {
    textStyleRef.current = textStyle;
    activeBubbles.forEach(b => {
      if (typeof b.render === 'function') b.render();
    });
  }, [textStyle, activeBubbles]);
  const [userApiKey, setUserApiKey] = useState<string>(() => {
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      return localStorage.getItem("gemini_api_key") || "";
    }
    return "";
  });

  const [glossary, setGlossary] = useState<GlossaryEntry[]>(() => {
    if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
      try {
        const saved = localStorage.getItem("manga_glossary");
        return saved ? JSON.parse(saved) : [];
      } catch {
        return [];
      }
    }
    return [];
  });

  const updateGlossary = useCallback((newGlossary: GlossaryEntry[]) => {
    setGlossary(newGlossary);
    if (typeof window !== "undefined") {
      localStorage.setItem("manga_glossary", JSON.stringify(newGlossary));
    }
  }, []);

  const activePageRef = useRef("");
  useEffect(() => {
    if (pages.length > 0) {
      activePageRef.current = pages[currentPage];
    }
  }, [currentPage, pages]);

  // Per-page bubble cache, keyed by image data URL so it survives reordering
  const bubbleCacheRef = useRef<Map<string, TranslatedBubble[]>>(new Map());
  // Per-page final translated image dataUrl cache — LRU-bounded so very long
  // books don't hold every rendered page in memory; exports re-render evicted
  // pages from the bubble cache on demand.
  const translatedImageCacheRef = useRef<LRUMap<string, string>>(
    new LRUMap<string, string>(TRANSLATED_IMAGE_CACHE_LIMIT),
  );
  // Pages whose translation completed (success or clean-only). Survives LRU
  // eviction so batch re-runs don't re-translate evicted pages.
  const completedPagesRef = useRef<Set<string>>(new Set());

  // Monotonic per-page revision tracking for robust autosave concurrency
  const pageRevisionsRef = useRef<Map<string, number>>(new Map());
  const lastSavedRevisionsRef = useRef<Map<string, number>>(new Map());
  const initialSavePendingRef = useRef(true);
  const pendingSaveRevisionRef = useRef<number | null>(null);

  const onPageDirtiedRef = useRef(onPageDirtied);
  useEffect(() => {
    onPageDirtiedRef.current = onPageDirtied;
  }, [onPageDirtied]);

  const markPageDirty = useCallback((pageUrl: string, evictRenderCache: boolean = true) => {
    const nextRev = (pageRevisionsRef.current.get(pageUrl) ?? 0) + 1;
    pageRevisionsRef.current.set(pageUrl, nextRev);
    if (evictRenderCache) {
      translatedImageCacheRef.current.delete(pageUrl);
      setTranslatedImages(new Map(translatedImageCacheRef.current));
    }
    setCacheRevision((rev) => rev + 1);
    onPageDirtiedRef.current?.(pageUrl);
  }, []);

  const getPageRevision = useCallback((pageUrl: string): number => {
    return pageRevisionsRef.current.get(pageUrl) ?? 0;
  }, []);

  const getPageSignature = useCallback((pageUrl: string): string => {
    const rev = pageRevisionsRef.current.get(pageUrl) ?? 0;
    return `rev-${rev}`;
  }, []);
  const [translatedImages, setTranslatedImages] = useState<Map<string, string>>(
    new Map(),
  );

  const getManualBubblesForPage = (pageUrl: string): TranslatedBubble[] => {
    const cachedBubbles = bubbleCacheRef.current.get(pageUrl);
    if (cachedBubbles) {
      return cachedBubbles.filter((bubble) => bubble.isManual || bubble.deleted);
    }
    if (activePageRef.current === pageUrl) {
      return activeBubbles.filter((bubble) => bubble.isManual || bubble.deleted);
    }
    return [];
  };

  // When currentPage changes, restore cached bubbles and re-apply overlay
  useEffect(() => {
    if (pages.length === 0) return;
    const currentKey = pages[currentPage];
    if (suppressedOverlayPagesRef.current.has(currentKey)) {
      setActiveBubbles((previous) => previous.length > 0 ? [] : previous);
      return;
    }
    // Refresh the viewed page's LRU recency so it can't be evicted while
    // the user is looking at it.
    translatedImageCacheRef.current.get(currentKey);
    const cached = bubbleCacheRef.current.get(currentKey);
    if (cached && cached.length > 0) {
      setActiveBubbles(cached);
      // Small delay so the DOM (pageContainer + img) is rendered first
      const timer = setTimeout(() => {
        if (suppressedOverlayPagesRef.current.has(currentKey)) return;
        applyTranslationOverlay(
          cached,
          viewMode,
          currentPage,
          setTranslationResult,
          undefined,
          textStyleRef,
          undefined,
          currentKey,
          () => markPageDirty(currentKey),
          targetLang,
        );
      }, 100);
      return () => clearTimeout(timer);
    } else {
      setActiveBubbles((prev) => (prev.length === 0 ? prev : []));
    }
  }, [currentPage, pages, viewMode, markPageDirty, targetLang, isTranslating, isTranslatingAll]);

  // Save status and revision management for session reliability
  const saveRevisionRef = useRef(0);
  const lastSavedRevisionRef = useRef(0);
  const isSavingRef = useRef(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const stablePagesRef = useRef(pages);
  if (
    stablePagesRef.current.length !== pages.length ||
    pages.some((page, index) => page !== stablePagesRef.current[index])
  ) {
    stablePagesRef.current = pages;
  }
  const pageIdsRef = useRef(pageIds);
  pageIdsRef.current = pageIds;
  const sourceSelectionKey = JSON.stringify(pageExportSources);
  const pageExportSourcesRef = useRef(pageExportSources);
  pageExportSourcesRef.current = pageExportSources;
  const pageNamesRef = useRef(pageNames);
  useEffect(() => {
    pageNamesRef.current = pageNames;
  }, [pageNames]);
  const pageOriginUrlsRef = useRef(pageOriginUrls);
  useEffect(() => {
    pageOriginUrlsRef.current = pageOriginUrls;
  }, [pageOriginUrls]);
  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;

  const performSaveRef = useRef<(targetRevision: number) => Promise<boolean>>(
    async () => false,
  );

  const performSave = useCallback(async (targetRevision: number): Promise<boolean> => {
    const currentPages = pagesRef.current;
    if (currentPages.length === 0) return false;
    if (isSavingRef.current) {
      // A newer state change arrived mid-save — don't drop it, reschedule.
      pendingSaveRevisionRef.current = Math.max(
        pendingSaveRevisionRef.current ?? 0,
        targetRevision,
      );
      return false;
    }

    isSavingRef.current = true;
    setSaveStatus("saving");
    setSaveError(null);

    // Ensure all current pages have an initial revision
    for (const p of currentPages) {
      if (!pageRevisionsRef.current.has(p)) {
        pageRevisionsRef.current.set(p, 1);
      }
    }

    // Snapshot exact monotonic revision per page at the moment save starts
    const revisionSnapshot = new Map(pageRevisionsRef.current);
    const isInitial = initialSavePendingRef.current;

    const dirtyPageUrls = new Set<string>();
    if (isInitial) {
      for (const p of currentPages) {
        dirtyPageUrls.add(p);
      }
    } else {
      for (const [pageUrl, rev] of revisionSnapshot.entries()) {
        const lastSaved = lastSavedRevisionsRef.current.get(pageUrl) ?? 0;
        if (rev > lastSaved) {
          dirtyPageUrls.add(pageUrl);
        }
      }
    }

    try {
      await saveProjectSession(
        {
          pages: currentPages.map(
            (p, i) => ({
              id: pageIdsRef.current?.[i],
              url: p,
              name: pageNamesRef.current?.[i] || `Page ${i + 1}`,
              originUrl: pageOriginUrlsRef.current?.[i],
              exportSource: pageExportSourcesRef.current?.[i],
            }),
          ),
          currentPage: currentPageRef.current,
          bubbleCache: bubbleCacheRef.current,
          translatedImageCache: translatedImageCacheRef.current,
        },
        { dirtyPageUrls: isInitial ? undefined : dirtyPageUrls },
      );

      initialSavePendingRef.current = false;

      // Upon successful persistence, advance lastSavedRevisions to the snapshot revision
      for (const [pageUrl, snapshotRev] of revisionSnapshot.entries()) {
        const currentSaved = lastSavedRevisionsRef.current.get(pageUrl) ?? 0;
        lastSavedRevisionsRef.current.set(pageUrl, Math.max(currentSaved, snapshotRev));
      }

      // Check if any page was modified while this save was in flight
      let hasPendingEdits = false;
      for (const [pageUrl, currentRev] of pageRevisionsRef.current.entries()) {
        const savedRev = lastSavedRevisionsRef.current.get(pageUrl) ?? 0;
        if (currentRev > savedRev) {
          hasPendingEdits = true;
          break;
        }
      }

      lastSavedRevisionRef.current = targetRevision;
      if (!hasPendingEdits && saveRevisionRef.current === targetRevision) {
        setSaveStatus("saved");
        setSaveError(null);
      } else {
        // Newer revision or in-flight edits arrived; remain saving until debounced catchup fires
        setSaveStatus("saving");
      }
      return true;
    } catch (err) {
      console.error("Auto-save session failed:", err);
      setSaveStatus("error");
      setSaveError(err instanceof Error ? err.message : "บันทึกข้อมูลไม่สำเร็จ");
      return false;
    } finally {
      isSavingRef.current = false;
      // A revision arrived while this save was in flight — run the catch-up
      // save only after the saving lock is released.
      const pending = pendingSaveRevisionRef.current;
      if (pending !== null && pending > lastSavedRevisionRef.current) {
        pendingSaveRevisionRef.current = null;
        void performSaveRef.current(pending);
      }
    }
  }, []);
  useEffect(() => {
    performSaveRef.current = performSave;
  }, [performSave]);

  // Auto-save session to IndexedDB (debounced)
  useEffect(() => {
    if (pages.length === 0) {
      setSaveStatus("idle");
      setSaveError(null);
      return;
    }

    saveRevisionRef.current += 1;
    const currentRevision = saveRevisionRef.current;
    setSaveStatus("saving");

    const timer = setTimeout(() => {
      void performSave(currentRevision);
    }, 1000);

    return () => clearTimeout(timer);
  }, [stablePagesRef.current, currentPage, activeBubbles, cacheRevision, sourceSelectionKey, performSave]);

  // Restore saved session helper
  const restoreSavedSession = useCallback(async () => {
    const saved = await loadProjectSession();
    if (!saved) return null;
    const outlineRefreshedPages = new Set<string>();
    for (const page of saved.pages) {
      if (page.unrecoverableSource) continue;
      const bubbles = saved.bubbleCache.get(page.url);
      if (!bubbles?.some(needsSourceOutlineRefresh)) continue;
      try {
        // Stored pages contain the original source, never the cleaned render or removal mask.
        const original = await waitForImageReady(page.url);
        const refreshed = bubbles.map((bubble) => {
          if (!needsSourceOutlineRefresh(bubble) || !bubble.box || bubble.box.length < 4 || bubble.isInvalidBox) return bubble;
          return refreshSourceOutline(bubble, sampleBubbleRegion(original, bubble.box));
        });
        if (refreshed.some((bubble, index) => bubble !== bubbles[index])) {
          saved.bubbleCache.set(page.url, refreshed);
          saved.translatedImageCache.delete(page.url);
          outlineRefreshedPages.add(page.url);
        }
      } catch {
        // Retain the only useful render when originals cannot decode or sampling fails.
      }
    }
    bubbleCacheRef.current = saved.bubbleCache;
    const restoredImages = new LRUMap<string, string>(
      TRANSLATED_IMAGE_CACHE_LIMIT,
      (pageUrl) => pageUrl === activePageRef.current,
    );
    for (const [pageUrl, dataUrl] of saved.translatedImageCache) {
      restoredImages.set(pageUrl, dataUrl);
    }
    translatedImageCacheRef.current = restoredImages;
    setTranslatedImages(new Map(saved.translatedImageCache));
    // Restored assets are already persisted under the same deterministic ids
    initialSavePendingRef.current = false;
    pageRevisionsRef.current.clear();
    lastSavedRevisionsRef.current.clear();
    for (const key of saved.bubbleCache.keys()) {
      pageRevisionsRef.current.set(key, 1);
      lastSavedRevisionsRef.current.set(key, 1);
    }
    completedPagesRef.current = new Set(saved.bubbleCache.keys());
    lastSavedRevisionRef.current = saveRevisionRef.current;
    setSaveStatus("saved");
    setSaveError(null);
    for (const pageUrl of outlineRefreshedPages) markPageDirty(pageUrl);
    return saved;
  }, [markPageDirty]);

  const retrySaveSession = useCallback(async (): Promise<boolean> => {
    if (pages.length === 0 || isSavingRef.current) return false;
    saveRevisionRef.current += 1;
    const currentRevision = saveRevisionRef.current;
    return await performSave(currentRevision);
  }, [pages.length, performSave]);

  const clearSavedSession = async () => {
    bubbleCacheRef.current.clear();
    translatedImageCacheRef.current.clear();
    setTranslatedImages(new Map());
    pageRevisionsRef.current.clear();
    lastSavedRevisionsRef.current.clear();
    initialSavePendingRef.current = true;
    completedPagesRef.current = new Set();
    saveRevisionRef.current = 0;
    lastSavedRevisionRef.current = 0;
    setSaveStatus("idle");
    setSaveError(null);
    await clearProjectSession();
  };

  const translateCrop = async (cropBox: { x: number, y: number, w: number, h: number }, cropBase64: string, fullWidth: number, fullHeight: number) => {
    setIsTranslating(true);
    setTranslationResult("กำลังแปลเฉพาะจุดที่เลือก...");
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: cropBase64,
          mimeType: "image/jpeg",
          targetLang,
          sourceLang,
          modelPreference,
          apiKey: userApiKey,
          allowPreview: allowPreviewModels,
          glossary,
        }),
      });
      const data = await readTranslationResponse<{ text: string }>(res);
      const parsed = JSON.parse(data.text);
      if (!parsed || !parsed.bubbles || parsed.bubbles.length === 0) {
        setTranslationResult("❌ ไม่พบข้อความในจุดที่เลือก");
        return;
      }

      const newBubbles = parsed.bubbles.map((b: TranslatedBubble) => {
        if (!b.box || b.box.length !== 4) return b;
        const cropYminPx = (b.box[0] / 1000) * cropBox.h;
        const cropXminPx = (b.box[1] / 1000) * cropBox.w;
        const cropYmaxPx = (b.box[2] / 1000) * cropBox.h;
        const cropXmaxPx = (b.box[3] / 1000) * cropBox.w;
        return {
          ...b,
          box: [
            ((cropBox.y + cropYminPx) / fullHeight) * 1000,
            ((cropBox.x + cropXminPx) / fullWidth) * 1000,
            ((cropBox.y + cropYmaxPx) / fullHeight) * 1000,
            ((cropBox.x + cropXmaxPx) / fullWidth) * 1000
          ],
          isManual: true
        };
      });

      const coloredNewBubbles = await enrichBubblesWithColorProfiles(
        newBubbles,
        pages[currentPage],
      );
      const updatedBubbles = [...activeBubbles, ...coloredNewBubbles];
      bubbleCacheRef.current.set(pages[currentPage], updatedBubbles);
      markPageDirty(pages[currentPage]);

      if (activePageRef.current === pages[currentPage]) {
        setActiveBubbles(updatedBubbles);
        applyTranslationOverlay(updatedBubbles, viewMode, currentPage, setTranslationResult, (dataUrl) => {
          translatedImageCacheRef.current.set(pages[currentPage], dataUrl);
          markPageDirty(pages[currentPage], false);
          setTranslatedImages(new Map(translatedImageCacheRef.current));
        }, textStyleRef, undefined, pages[currentPage], () => markPageDirty(pages[currentPage]), targetLang);
        setTranslationResult("✅ แปลเฉพาะจุดสำเร็จ!");
      }
      completedPagesRef.current.add(pages[currentPage]);

    } catch (error: unknown) {
      setTranslationResult("❌ Error: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsTranslating(false);
      setTimeout(() => setTranslationResult(null), 4000);
    }
  };

  const renderAndCacheTranslation = useCallback(
    async (
      bubbles: TranslatedBubble[],
      backgroundUrl: string,
      pageUrl: string,
      pageIndex: number,
    ): Promise<void> => {
      const offscreenContainer = document.createElement("div");
      offscreenContainer.dataset.translationOffscreen = pageUrl;
      offscreenContainer.style.cssText =
        "position:fixed;left:-100000px;top:0;pointer-events:none;";
      const image = document.createElement("img");
      image.src = backgroundUrl;
      offscreenContainer.appendChild(image);
      document.body.appendChild(offscreenContainer);

      try {
        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const cleanup = () => clearTimeout(watchdog);
          const rejectOnce = (error: unknown) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
          };
          const complete = (dataUrl: string) => {
            if (settled) return;
            settled = true;
            cleanup();
            translatedImageCacheRef.current.set(pageUrl, dataUrl);
            markPageDirty(pageUrl, false);
            setTranslatedImages(new Map(translatedImageCacheRef.current));
            setCacheRevision((revision) => revision + 1);
            resolve();
          };
          const watchdog = setTimeout(
            () => rejectOnce(new Error("สร้างภาพคำแปลไม่สำเร็จ")),
            30_000,
          );
          void Promise.resolve()
            .then(() =>
              applyTranslationOverlay(
                bubbles,
                "offscreen",
                pageIndex,
                () => {},
                complete,
                textStyleRef,
                offscreenContainer,
                pageUrl,
                undefined,
                targetLang,
              ),
            )
            .catch(rejectOnce);
        });
      } finally {
        image.onload = null;
        image.onerror = null;

        offscreenContainer.remove();
      }

      suppressedOverlayPagesRef.current.delete(pageUrl);
      if (activePageRef.current === pageUrl) {
        setActiveBubbles(bubbles);
        void applyTranslationOverlay(
          bubbles,
          viewMode,
          pageIndex,
          setTranslationResult,
          undefined,
          textStyleRef,
          undefined,
          pageUrl,
          () => markPageDirty(pageUrl),
          targetLang,
        );
      }
    },
    [viewMode, markPageDirty, targetLang],
  );

async function readBlobAsDataUrl(blob: Blob): Promise<string> {
  if (typeof blob.arrayBuffer === "function") {
    const buffer = await blob.arrayBuffer();
    const mimeType = blob.type && blob.type.startsWith("image/") ? blob.type : "image/jpeg";
    if (typeof Buffer !== "undefined") {
      return `data:${mimeType};base64,${Buffer.from(buffer).toString("base64")}`;
    }
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return `data:${mimeType};base64,${btoa(binary)}`;
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("อ่านรูปภาพคลีนไม่สำเร็จ"));
    reader.readAsDataURL(blob);
  });
}

async function readBlobAsBase64(blob: Blob): Promise<string> {
  const dataUrl = await readBlobAsDataUrl(blob);
  const commaIndex = dataUrl.indexOf(",");
  return commaIndex !== -1 ? dataUrl.slice(commaIndex + 1) : dataUrl;
}

  const cacheBackgroundOnly = useCallback(
    async (backgroundUrl: string, pageUrl: string): Promise<void> => {
      const response = await fetch(backgroundUrl);
      if (!response.ok) {
        throw new Error(`ไม่สามารถโหลดรูปภาพคลีนได้ (HTTP ${response.status})`);
      }
      const blob = await response.blob();
      const dataUrl = await readBlobAsDataUrl(blob);

      translatedImageCacheRef.current.set(pageUrl, dataUrl);
      bubbleCacheRef.current.set(pageUrl, []);
      completedPagesRef.current.add(pageUrl);
      suppressedOverlayPagesRef.current.delete(pageUrl);
      markPageDirty(pageUrl, false);
      setTranslatedImages(new Map(translatedImageCacheRef.current));
      setCacheRevision((revision) => revision + 1);
      if (activePageRef.current === pageUrl) {
        setActiveBubbles([]);
        setTranslationResult("ไม่พบประโยคที่ต้องแปล");
        setShowTranslate(false);
      }
    },
    [markPageDirty],
  );

  const performTranslation = async (
    preparedPage: PreparedTranslationPage,
    pageUrl: string,
    pageIndex: number,
    forceNsfwBypass: boolean = false,
    isAutoRetry: boolean = false,
    signal?: AbortSignal,
  ): Promise<boolean> => {
    try {
      const { backgroundUrl, textScope } = preparedPage;
      const recognitionUrl = preparedPage.recognitionUrl;
      const resImg = await fetch(recognitionUrl, signal ? { signal } : undefined);
      if (!resImg.ok) throw new Error(`ไม่สามารถโหลดรูปภาพได้ (HTTP ${resImg.status})`);
      const blob = await resImg.blob();
      const actualMimeType = blob.type && blob.type.startsWith('image/') ? blob.type : "image/jpeg";
      const base64 = await readBlobAsBase64(blob);

      const reviewPage = async (bubbles: TranslatedBubble[]) => {
        if (activePageRef.current === pageUrl && bubbles.some(b => !b.isManual && !b.deleted)) {
          setTranslationResult("กำลังตรวจความหมายและสำนวนคำแปล…");
        }
        return reviewTranslatedBubbles(bubbles,{targetLang,apiKey:userApiKey,modelPreference,
          allowPreview:allowPreviewModels,glossary,signal});
      };

      const recoverDetectedOmissions = async (initial: TranslatedBubble[]) => {
        const manual = getManualBubblesForPage(pageUrl);
        initial = excludeDeletedTranslations(initial, manual);
        const seed = [...initial, ...manual];
        if (findMissingTranslationRegions(seed, textScope).length === 0) return {bubbles:initial,missing:[] as number[][]};
        let original: HTMLImageElement | undefined;
        const recovered = await recoverMissingTranslations(seed, textScope, async target => {
          original ??= await waitForImageReady(recognitionUrl);
          const width = original.naturalWidth;
          const height = original.naturalHeight;
          if (!(width > 0 && height > 0)) throw new Error("Cannot load original image for missing translation recovery.");
          const paddingX = Math.max(4, (target[3]-target[1])*width/1000*.125);
          const paddingY = Math.max(4, (target[2]-target[0])*height/1000*.125);
          const sx = Math.max(0, Math.round(target[1]*width/1000-paddingX));
          const sy = Math.max(0, Math.round(target[0]*height/1000-paddingY));
          const ex = Math.min(width, Math.round(target[3]*width/1000+paddingX));
          const ey = Math.min(height, Math.round(target[2]*height/1000+paddingY));
          const crop = document.createElement("canvas");
          crop.width = ex-sx; crop.height = ey-sy;
          const context = crop.getContext("2d");
          if (!context) throw new Error("Canvas unavailable for missing translation recovery.");
          context.drawImage(original, sx, sy, crop.width, crop.height, 0, 0, crop.width, crop.height);
          context.fillStyle = "white";
          for (const protectedBox of textScope?.excluded ?? []) {
            context.fillRect(protectedBox[1]*width/1000-sx, protectedBox[0]*height/1000-sy,
              (protectedBox[3]-protectedBox[1])*width/1000, (protectedBox[2]-protectedBox[0])*height/1000);
          }
          if (activePageRef.current === pageUrl) setTranslationResult("กำลังตรวจและเติมคำแปลที่ตกหล่น…");
          const response = await fetch("/api/translate", {
            method:"POST", headers:{"Content-Type":"application/json"}, signal,
            body:JSON.stringify({imageBase64:crop.toDataURL("image/png").split(",")[1],mimeType:"image/png",
              targetLang,sourceLang,modelPreference,apiKey:userApiKey,allowPreview:allowPreviewModels,glossary}),
          });
          const data = await readTranslationResponse<{text:string}>(response);
          const parsed = parseLLMJSON(data.text) as {bubbles?:TranslatedBubble[]} | null;
          if (!Array.isArray(parsed?.bubbles)) throw new Error("Missing translation recovery response malformed.");
          const candidates = normalizeTranslationPayload(parsed!).bubbles ?? [];
          return candidates.filter(b=>b.box?.length===4 && b.box.every(Number.isFinite)).map(b=>({...b,box:[
            Math.round((sy+b.box![0]*crop.height/1000)/height*1000),
            Math.round((sx+b.box![1]*crop.width/1000)/width*1000),
            Math.round((sy+b.box![2]*crop.height/1000)/height*1000),
            Math.round((sx+b.box![3]*crop.width/1000)/width*1000),
          ]}));
        }, signal);
        return {...recovered,bubbles:recovered.bubbles.filter(b=>!manual.includes(b))};
      };

      if (nsfwBypassMode || forceNsfwBypass) {
        const imgEl = await waitForImageReady(recognitionUrl);

        const slices = [];
        const rows = 3;
        const cols = 2;
        const baseSliceWidth = imgEl.naturalWidth / cols;
        const baseSliceHeight = imgEl.naturalHeight / rows;
        const overlapX = baseSliceWidth * 0.15;
        const overlapY = baseSliceHeight * 0.15;

        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const sx = Math.max(0, col * baseSliceWidth - (col > 0 ? overlapX : 0));
            const sy = Math.max(0, row * baseSliceHeight - (row > 0 ? overlapY : 0));
            const ex = Math.min(imgEl.naturalWidth, (col + 1) * baseSliceWidth + (col < cols - 1 ? overlapX : 0));
            const ey = Math.min(imgEl.naturalHeight, (row + 1) * baseSliceHeight + (row < rows - 1 ? overlapY : 0));
            const sWidth = ex - sx;
            const sHeight = ey - sy;

            const canvas = document.createElement("canvas");
            canvas.width = sWidth;
            canvas.height = sHeight;
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              throw new Error("Canvas 2D context is unavailable for NSFW slicing");
            }
            ctx.drawImage(imgEl, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);
            const sliceBase64 = canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
            slices.push({ row, col, sx, sy, sWidth, sHeight, base64: sliceBase64 });
          }
        }

        let allBubbles: TranslatedBubble[] = [];
        let successCount = 0;
        let validPayloadCount = 0;

        for (let i = 0; i < slices.length; i++) {
          const slice = slices[i];
          setTranslationResult(`กำลังแปลชิ้นส่วนที่ ${i + 1}/6 ...`);
          try {
            const res = await fetch("/api/translate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                imageBase64: slice.base64,
                mimeType: "image/jpeg",
                targetLang,
                sourceLang,
                modelPreference,
                apiKey: userApiKey,
                allowPreview: allowPreviewModels,
                glossary,
              }),
              signal,
            });
            const data = await readTranslationResponse<{ text: string }>(res);

            let parsed = parseLLMJSON(data.text) as
              | { bubbles?: TranslatedBubble[] }
              | null;
            if (!parsed || !Array.isArray(parsed.bubbles)) {
              throw new Error("Translation response malformed: bubbles array missing.");
            }
            parsed = normalizeTranslationPayload(parsed);
            const sliceBubbles = parsed.bubbles ?? [];
            if (sliceBubbles.length > 0) {
              const { sx, sy, sWidth, sHeight } = slice;

              for (const b of sliceBubbles) {
                if (!b.box || b.box.length !== 4) {
                  b.box = [0, 0, 1000, 1000];
                  b.isInvalidBox = true;
                } else if ((b.box[3] - b.box[1] >= 950 && b.box[2] - b.box[0] >= 950) || (b.box[3] === b.box[1] && b.box[2] === b.box[0])) {
                  // Invalid box: shrink to a centered 20% patch so it can't
                  // white-out the whole page; the invalid marker still shows.
                  const cx = (b.box[1] + b.box[3]) / 2;
                  const cy = (b.box[0] + b.box[2]) / 2;
                  b.box = [cy - 100, cx - 100, cy + 100, cx + 100];
                  b.isInvalidBox = true;
                }

                const ymin_px = (b.box[0] / 1000) * sHeight;
                const xmin_px = (b.box[1] / 1000) * sWidth;
                const ymax_px = (b.box[2] / 1000) * sHeight;
                const xmax_px = (b.box[3] / 1000) * sWidth;

                const global_ymin_px = ymin_px + sy;
                const global_xmin_px = xmin_px + sx;
                const global_ymax_px = ymax_px + sy;
                const global_xmax_px = xmax_px + sx;

                b.box[0] = Math.round((global_ymin_px / imgEl.naturalHeight) * 1000);
                b.box[1] = Math.round((global_xmin_px / imgEl.naturalWidth) * 1000);
                b.box[2] = Math.round((global_ymax_px / imgEl.naturalHeight) * 1000);
                b.box[3] = Math.round((global_xmax_px / imgEl.naturalWidth) * 1000);

                let isDuplicate = false;
                // Dedupe against ALL bubbles (invalid boxes too) to stop
                // overlapping white patches stacking on the same spot.
                for (const existing of allBubbles) {
                  if (!existing.box || existing.box.length < 4) continue;
                  const xA = Math.max(b.box[1], existing.box[1]);
                  const yA = Math.max(b.box[0], existing.box[0]);
                  const xB = Math.min(b.box[3], existing.box[3]);
                  const yB = Math.min(b.box[2], existing.box[2]);
                  const interWidth = Math.max(0, xB - xA);
                  const interHeight = Math.max(0, yB - yA);
                  const interArea = interWidth * interHeight;
                  const boxAArea = (b.box[3] - b.box[1]) * (b.box[2] - b.box[0]);
                  const boxBArea = (existing.box[3] - existing.box[1]) * (existing.box[2] - existing.box[0]);
                  const iou = interArea / (boxAArea + boxBArea - interArea);

                  // Containment: if either box covers ≥80% of the other, they
                  // are the same bubble. 60% was too aggressive — adjacent
                  // speech balloons that touch each other were wrongly merged.
                  const bInExisting = boxBArea > 0 && interArea / boxBArea >= 0.8;
                  const existingInB = boxAArea > 0 && interArea / boxAArea >= 0.8;

                  // Centroid distance: only merge when centers are very close
                  // (≤5% of the page). 120/1000 merged distinct adjacent
                  // bubbles that sit side by side.
                  const bCx = (b.box[1] + b.box[3]) / 2;
                  const bCy = (b.box[0] + b.box[2]) / 2;
                  const eCx = (existing.box[1] + existing.box[3]) / 2;
                  const eCy = (existing.box[0] + existing.box[2]) / 2;
                  const dist = Math.hypot(bCx - eCx, bCy - eCy);

                  if (iou > 0.7 || bInExisting || existingInB || dist < 50) {
                    isDuplicate = true;
                    break;
                  }
                }

                if (!isDuplicate) {
                  allBubbles.push(b);
                }
              }
            }
            validPayloadCount++;
            successCount++;
          } catch (err: unknown) {
            console.warn(`Slice ${i + 1} failed:`, err);
            if (isUserCancelledError(err)) throw err;
            if (getTranslationRetryDelay(err) !== null) {
              throw err;
            }
          }

          if (i < slices.length - 1) {
            await new Promise(r => setTimeout(r, 1000));
          }
        }

        if (validPayloadCount === 0) {
          throw new Error("Translation failed: no valid NSFW slice responses.");
        }

        allBubbles = deduplicateBubbleSFX(allBubbles, 3).filter(b => withinTranslationScope(b.box, textScope));
        const completeness = await recoverDetectedOmissions(allBubbles);
        console.info("[Translation Coverage]", {page:pageIndex+1, detected:textScope?.allowed.length ?? null,
          retained:allBubbles.length, recovered:completeness.bubbles.length-allBubbles.length, missing:completeness.missing.length});

        const outcome = resolveTranslationOutcome(
          completeness.bubbles,
          getManualBubblesForPage(pageUrl),
        );
        if (outcome.kind === "clean-only") {
          await cacheBackgroundOnly(backgroundUrl, pageUrl);
          if (completeness.missing.length > 0 && activePageRef.current === pageUrl) {
            setTranslationResult(`⚠️ ยังขาดคำแปล ${completeness.missing.length} จุด กรุณาตรวจหน้านี้ก่อนส่งออก`);
          }
          return true;
        }

        const reviewedBubbles = await reviewPage(outcome.bubbles);
        const styledBubbles = preserveManualStyleProfiles(
          reviewedBubbles,
          bubbleCacheRef.current.get(pageUrl) ?? [],
        );
        const coloredBubbles = await enrichBubblesWithColorProfiles(
          styledBubbles,
          recognitionUrl,
        );
        await renderAndCacheTranslation(
          coloredBubbles,
          backgroundUrl,
          pageUrl,
          pageIndex,
        );
        bubbleCacheRef.current.set(pageUrl, coloredBubbles);
        completedPagesRef.current.add(pageUrl);
        markPageDirty(pageUrl, false);

        if (activePageRef.current === pageUrl) {
          setTranslationResult(completeness.missing.length > 0
            ? `⚠️ ยังขาดคำแปล ${completeness.missing.length} จุด กรุณาตรวจหน้านี้ก่อนส่งออก`
            : coloredBubbles.some(needsQualityReview)
              ? "⚠️ แปลสำเร็จ แต่มีคำแปลที่ต้องตรวจ เปิดแก้ไขข้อความเพื่อเทียบต้นฉบับและดูคำแนะนำ"
              : `✅ แปลสำเร็จ! (ได้ ${successCount}/6 ส่วน)`);
          setShowTranslate(false);
        }
        return true;
      }

      let res: Response;
      if (
        activePageRef.current === pageUrl &&
        (!modelPreference || modelPreference === "auto")
      ) {
        setTranslationResult("กำลังแปลด้วย Auto · จะสลับโมเดลที่พร้อมใช้เมื่อจำเป็น…");
      }
      const reportModelSwitch = (event: { model: string; fallbackCount: number }) => {
        if (activePageRef.current === pageUrl) {
          setTranslationResult(`กำลังแปลด้วย Auto · สลับไป ${event.model} (fallback ${event.fallbackCount} ครั้ง)…`);
        }
      };
      const wantsProgress = !modelPreference || modelPreference === "auto";
      try {
        res = await fetch("/api/translate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(wantsProgress ? { Accept: "application/x-ndjson" } : {}),
          },
          body: JSON.stringify({
            imageBase64: base64,
            mimeType: actualMimeType,
            targetLang,
            sourceLang,
            modelPreference,
            apiKey: userApiKey,
            allowPreview: allowPreviewModels,
            glossary,
          }),
          signal,
        });
      } catch (err) {
        if (isUserCancelledError(err)) throw err;
        // Network-level failure ("Failed to fetch"): transient, retryable.
        throw new TranslationRequestError(
          "Network error: ลองใหม่อีกครั้ง",
          0,
          "NETWORK",
          true,
        );
      }

      const data = await readTranslationResponse<{
        text: string;
        meta?: TranslationObservabilityMeta;
      }>(res, wantsProgress ? reportModelSwitch : undefined);
      let responseMeta = data.meta;
      let parsed = (data.text ? parseLLMJSON(data.text) : data) as
        | ({ bubbles?: unknown[] } & Record<string, unknown>)
        | null;
      // Gemini sometimes returns a valid JSON object that omits "bubbles"
      // (e.g. an explanatory reply or an empty-scan response). Treat that as
      // "no text found" instead of a hard failure so the page can fall
      // through to clean-only / auto-retry handling below.
      if (!parsed || typeof parsed !== "object") {
        throw new Error("Translation response malformed: invalid JSON.");
      }
      if (!Array.isArray(parsed.bubbles)) {
        parsed = { ...parsed, bubbles: [] as TranslatedBubble[] };
      }
      const typedParsed = parsed as { bubbles?: TranslatedBubble[] } & Record<string, unknown>;
      const normalized = normalizeTranslationPayload(typedParsed);
      let pageBubbles: TranslatedBubble[] = normalized.bubbles ?? [];
      // Foreign-script leakage (Japanese kana/kanji from the source page,
      // Cyrillic runs) is treated like the 0-bubble failure: retry once on
      // the enhanced image and keep whichever pass came out cleaner. The
      // guard only applies to Thai targets — kana/kanji are legitimate when
      // translating INTO Japanese.
      const isThaiTarget = !targetLang || /thai|ไทย/i.test(targetLang);
      let contaminatedBubbles = isThaiTarget
        ? countContaminatedBubbles(pageBubbles)
        : 0;

      if (
        (pageBubbles.length === 0 || contaminatedBubbles > 0)
        && !isAutoRetry
        && !nsfwBypassMode
        && !forceNsfwBypass
      ) {
        console.log(`[Auto-Retry] ${pageBubbles.length === 0 ? "0 bubbles found" : `${contaminatedBubbles} bubble(s) with foreign-script characters`} for page ${pageIndex + 1}. Retrying with enhanced single image...`);
        if (activePageRef.current === pageUrl) {
          setTranslationResult(
            pageBubbles.length === 0
              ? "⏳ ไม่พบข้อความ! กำลังปรับความคมชัดภาพและ Auto-Retry..."
              : `⏳ พบตัวอักษรภาษาอื่นปนในคำแปล ${contaminatedBubbles} จุด! กำลังแปลใหม่อัตโนมัติ...`,
          );
        }

        const imgEl = await waitForImageReady(recognitionUrl);
        const canvas = document.createElement("canvas");
        canvas.width = imgEl.naturalWidth;
        canvas.height = imgEl.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          throw new Error("Translation failed: enhanced image canvas unavailable.");
        }
        ctx.filter = "contrast(1.35) brightness(1.05)";
        ctx.drawImage(imgEl, 0, 0);
        const enhancedBase64 = canvas.toDataURL("image/jpeg", 0.9).split(",")[1];
        if (!enhancedBase64) {
          throw new Error("Translation failed: enhanced image encoding failed.");
        }

        const retryRes = await fetch("/api/translate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(wantsProgress ? { Accept: "application/x-ndjson" } : {}),
          },
          body: JSON.stringify({
            imageBase64: enhancedBase64,
            mimeType: "image/jpeg",
            targetLang,
            sourceLang,
            modelPreference,
            apiKey: userApiKey,
            allowPreview: allowPreviewModels,
            isRetry: true,
            glossary,
          }),
          signal,
        });
        const retryData =
          await readTranslationResponse<{
            text: string;
            meta?: TranslationObservabilityMeta;
          }>(retryRes, wantsProgress ? reportModelSwitch : undefined);
        responseMeta = retryData.meta;
        const retryParsed = (retryData.text
          ? parseLLMJSON(retryData.text)
          : retryData) as { bubbles?: unknown[] } | null;
        if (!retryParsed || !Array.isArray(retryParsed.bubbles)) {
          throw new Error("Translation retry response malformed: bubbles array missing.");
        }
        const retryNormalized = normalizeTranslationPayload(
          retryParsed as { bubbles?: unknown[] } & Record<string, unknown>,
        );
        const retryBubbles: TranslatedBubble[] =
          (retryNormalized as { bubbles?: TranslatedBubble[] }).bubbles ?? [];
        const retryContamination = countContaminatedBubbles(retryBubbles);
        // The retry replaced the first response only when the first pass had
        // nothing to keep (0 bubbles) or the retry is actually cleaner —
        // swapping for a dirtier result would throw away good translations.
        if (pageBubbles.length === 0 || retryContamination < contaminatedBubbles) {
          parsed = retryNormalized;
          pageBubbles = retryBubbles;
          contaminatedBubbles = retryContamination;
        }
      }

      const filteredParsed = deduplicateBubbleSFX(pageBubbles, 3).filter(b => withinTranslationScope(b.box, textScope));
      const completeness = await recoverDetectedOmissions(filteredParsed);
      console.info("[Translation Coverage]", {page:pageIndex+1, detected:textScope?.allowed.length ?? null,
        received:pageBubbles.length, retained:filteredParsed.length, recovered:completeness.bubbles.length-filteredParsed.length,
        missing:completeness.missing.length});

      const outcome = resolveTranslationOutcome(
        completeness.bubbles,
        getManualBubblesForPage(pageUrl),
      );
      if (outcome.kind === "clean-only") {
        await cacheBackgroundOnly(backgroundUrl, pageUrl);
        if (completeness.missing.length > 0 && activePageRef.current === pageUrl) {
          setTranslationResult(`⚠️ ยังขาดคำแปล ${completeness.missing.length} จุด กรุณาตรวจหน้านี้ก่อนส่งออก`);
        }
        return true;
      }

      const reviewedBubbles = await reviewPage(outcome.bubbles);
      const styledBubbles = preserveManualStyleProfiles(
        reviewedBubbles,
        bubbleCacheRef.current.get(pageUrl) ?? [],
      );
      const coloredBubbles = await enrichBubblesWithColorProfiles(
        styledBubbles,
        recognitionUrl,
      );
      await renderAndCacheTranslation(
        coloredBubbles,
        backgroundUrl,
        pageUrl,
        pageIndex,
      );
      bubbleCacheRef.current.set(pageUrl, coloredBubbles);
      completedPagesRef.current.add(pageUrl);
      markPageDirty(pageUrl, false);

      if (activePageRef.current === pageUrl) {
        if (completeness.missing.length > 0) {
          setTranslationResult(`⚠️ ยังขาดคำแปล ${completeness.missing.length} จุด กรุณาตรวจหน้านี้ก่อนส่งออก`);
        } else if (coloredBubbles.some(needsQualityReview)) {
          setTranslationResult("⚠️ แปลสำเร็จ แต่มีคำแปลที่ต้องตรวจ เปิดแก้ไขข้อความเพื่อเทียบต้นฉบับและดูคำแนะนำ");
        } else if (responseMeta) {
          const elapsedSeconds = Math.max(0, responseMeta.elapsedMs / 1000).toFixed(1);
          const fallbackText = responseMeta.fallbackCount > 0
            ? ` · fallback ${responseMeta.fallbackCount} ครั้ง`
            : "";
          setTranslationResult(
            `✅ ${responseMeta.model} · ${elapsedSeconds} วิ${fallbackText}`,
          );
        } else {
          setTranslationResult("✅ แปลสำเร็จ! ข้อความถูกวาดทับลงบนภาพแล้ว");
        }
        setShowTranslate(false);
      }

      return true;
    } catch (error: unknown) {
      if (
        activePageRef.current === pageUrl
        && !isUserCancelledError(error)
      ) {
        setTranslationResult("❌ Error: " + (error instanceof Error ? error.message : String(error)));
      }
      throw error; // Rethrow so the caller can handle 429
    }
  };

  const clearVisibleTranslation = (pageUrl: string, pageIndex: number) => {
    suppressedOverlayPagesRef.current.add(pageUrl);
    if (activePageRef.current !== pageUrl) return;
    setActiveBubbles([]);
    // Applying an empty overlay also invalidates pending paints and detaches
    // their listeners. Cached bubbles remain available for manual edit recovery.
    void applyTranslationOverlay([], viewMode, pageIndex, setTranslationResult,
      undefined, textStyleRef, undefined, pageUrl);
    const container = viewMode === "scroll"
      ? document.getElementById(`spage-${pageIndex}`)
      : document.getElementById("pageContainer");
    const chromeRoot = container?.parentElement?.querySelector("[data-overlay-chrome-layer]")
      ?? document.getElementById("overlayChromeLayer");
    chromeRoot?.querySelectorAll("[data-translation-chrome]").forEach((element) => element.remove());
  };

  const handleTranslate = async (): Promise<boolean> => {
    if (
      translationOperationLockRef.current ||
      isTranslating ||
      isTranslatingAll ||
      pages.length === 0
    ) return false;
    translationOperationLockRef.current = true;
    const pageUrl = pages[currentPage];
    translationAbortRef.current = new AbortController();
    const signal = translationAbortRef.current.signal;

    setIsTranslating(true);
    try {
      clearVisibleTranslation(pageUrl, currentPage);
      setWorkflowPhase("cleaning");
      setTranslationResult(
        `กำลังคลีนหน้า ${currentPage + 1}/${pages.length}`,
      );
      const preparedPage = await preparePageForTranslation(pageUrl, currentPage, signal);
      if (signal.aborted) throw signal.reason;
      setWorkflowPhase("translating");
      setTranslationResult(
        `กำลังแปลหน้า ${currentPage + 1}/${pages.length}`,
      );
      return await performTranslation(
        preparedPage,
        pageUrl,
        currentPage,
        nsfwBypassMode,
        false,
        signal,
      );
    } catch (error) {
      if (isUserCancelledError(error)) {
        setTranslationResult("⏹ ยกเลิกการแปลแล้ว");
        return false;
      }
      const message =
        error instanceof Error ? error.message : "ดำเนินการไม่สำเร็จ";
      setTranslationResult(`❌ Error: ${message}`);
      return false;
    } finally {
      suppressedOverlayPagesRef.current.delete(pageUrl);
      translationOperationLockRef.current = false;
      setWorkflowPhase(null);
      setIsTranslating(false);
      setTimeout(() => setTranslationResult(null), 4000);
    }
  };

  const handleTranslateAll = async (
    targetIndices?: number[],
    options?: { forceNsfw?: boolean },
  ) => {
    if (
      translationOperationLockRef.current ||
      isTranslating ||
      isTranslatingAll
    ) return;
      translationOperationLockRef.current = true;
      if (
        typeof window !== "undefined" &&
        typeof Notification !== "undefined" &&
        Notification.permission === "default"
      ) {
        try {
          Notification.requestPermission().catch(() => {});
        } catch {
          // Ignore permission prompt errors
        }
      }
      let recordBatchMetrics: ((cancelled: boolean) => void) | undefined;
      const batchController = new AbortController();
      try {
        setIsTranslatingAll(true);
        cancelTranslateAllRef.current = false;
        translationAbortRef.current = batchController;
        const signal = batchController.signal;
        const batchStartTime = Date.now();
        translationStopwatchRef.current = {
          batchStartedAt: batchStartTime,
          pageStartedAt: 0,
          pageExcludedMs: 0,
          pagePausedAt: null,
        };
        setBatchPerformanceMetrics(null);
        const failureOperationId = `batch-${++failureGroupSequenceRef.current}`;
        const failureGroupIdFor = (diagnostic: DiagnosticDetail) =>
          `${failureOperationId}:${diagnostic.code}`;
      const failures: BatchPageFailure[] = [];
      const pageDurationsMs: number[] = [];
      let batchMetricsRecorded = false;
      recordBatchMetrics = (cancelled: boolean) => {
        if (batchMetricsRecorded) return;
        batchMetricsRecorded = true;
        const sorted = [...pageDurationsMs].sort((a, b) => a - b);
        const percentile = (fraction: number) =>
          sorted.length === 0
            ? undefined
            : sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
        setBatchPerformanceMetrics({
          recordedAt: Date.now(),
          wallClockMs: Math.max(0, Date.now() - batchStartTime),
          pageDurationsMs: [...pageDurationsMs],
          medianPageMs: percentile(0.5),
          p95PageMs: percentile(0.95),
          completedPages: pageDurationsMs.length,
          failedPages: failures.length,
          cancelled,
        });
        if (typeof localStorage !== "undefined") {
          try {
            localStorage.setItem(
              "superk:batch-performance-metrics",
              JSON.stringify({
                recordedAt: Date.now(),
                wallClockMs: Math.max(0, Date.now() - batchStartTime),
                pageDurationsMs: [...pageDurationsMs],
                medianPageMs: percentile(0.5),
                p95PageMs: percentile(0.95),
                completedPages: pageDurationsMs.length,
                failedPages: failures.length,
                cancelled,
              } satisfies BatchPerformanceMetrics),
            );
          } catch {
            // Metrics are diagnostic and must never affect translation.
          }
        }
      };
      let quotaFailureMessage: string | null = null;

      const isTargetedRetry = Array.isArray(targetIndices) && targetIndices.length > 0;
      const forceNsfwForBatch = options?.forceNsfw === true;
      const candidateIndices = isTargetedRetry
        ? targetIndices.filter((idx) => idx >= 0 && idx < pages.length)
        : pages.map((_, idx) => idx);
      // Snapshot the work set before starting. Already completed pages are not
      // part of this batch, so they cannot inflate the progress frontier.
      const indicesToProcess = isTargetedRetry
        ? candidateIndices
        : candidateIndices.filter((idx) => !completedPagesRef.current.has(pages[idx]));

      if (isTargetedRetry) {
        setBatchFailures((prev) =>
          prev.filter((f) => !targetIndices.includes(f.pageIndex)),
        );
      } else {
        setBatchFailures([]);
        setQuotaCooldownByGroup({});
      }

      const interruptibleDelay = async (ms: number) => {
        if (typeof process !== "undefined" && process.env.NODE_ENV === "test") {
          return;
        }
        const endTime = Date.now() + ms;
        while (Date.now() < endTime) {
          if (cancelTranslateAllRef.current) return;
          await new Promise((r) => setTimeout(r, Math.min(200, ms)));
        }
      };

      type PreparationOutcome =
        | { ok: true; value: PreparedTranslationPage }
        | { ok: false; error: unknown };
      const prepareSafely = async (
        pageIndex: number,
      ): Promise<PreparationOutcome> => {
        if (signal.aborted) return { ok: false, error: signal.reason };
        return new Promise<PreparationOutcome>((resolve) => {
          const finish = (outcome: PreparationOutcome) => {
            signal.removeEventListener("abort", onAbort);
            resolve(outcome);
          };
          const onAbort = () => finish({ ok: false, error: signal.reason });
          signal.addEventListener("abort", onAbort, { once: true });
          try {
            clearVisibleTranslation(pages[pageIndex], pageIndex);
            preparePageForTranslation(pages[pageIndex], pageIndex, signal).then(
              (value) => finish({ ok: true, value }),
              (error) => finish({ ok: false, error }),
            );
          } catch (error) {
            finish({ ok: false, error });
          }
        });
      };
      // Continuous local cleaning is the default; retain the explicit opt-out.
      const legacyPerformanceMode =
        typeof window !== "undefined"
        && window.localStorage.getItem("superk:legacy-performance-mode") === "1";
      const preparationQueue = new Map<number, Promise<PreparationOutcome>>();
      let producerStep = 1;
      let producerRunning = false;
      let producerPage: number | undefined;
      const cleaningProgress = () => producerPage !== undefined
        ? `กำลังคลีนหน้า ${producerPage + 1}/${pages.length} ล่วงหน้า`
        : preparationQueue.size > 0
          ? `เตรียมหน้าเสร็จแล้ว ${preparationQueue.size} หน้า ล่วงหน้า`
          : undefined;
      const publishCleaningProgress = () => {
        if (signal.aborted) return;
        setTranslateAllProgress((previous) => previous
          ? { ...previous, secondaryMessage: cleaningProgress() }
          : previous);
      };
      const pumpPreparationQueue = async () => {
        if (legacyPerformanceMode || producerRunning || signal.aborted) return;
        producerRunning = true;
        try {
          // Outcomes (including the in-flight job) occupy a slot until consumed.
          // The currently translating page has already left this queue.
          while (!signal.aborted && preparationQueue.size < 3 && producerStep < indicesToProcess.length) {
            const pageIndex = indicesToProcess[producerStep++];
            if (!isTargetedRetry && completedPagesRef.current.has(pages[pageIndex])) continue;
            producerPage = pageIndex;
            const pending = prepareSafely(pageIndex);
            preparationQueue.set(pageIndex, pending);
            publishCleaningProgress();
            await pending;
            if (signal.aborted) return;
            producerPage = undefined;
            publishCleaningProgress();
          }
        } finally {
          producerRunning = false;
        }
      };
      const batchReadyPages = new Set<string>();
      const batchProgressFrontier = () => {
        const firstUnready = indicesToProcess.findIndex(
          (candidate) => !batchReadyPages.has(pages[candidate]),
        );
        return firstUnready === -1 ? indicesToProcess.length : firstUnready + 1;
      };

      for (let step = 0; step < indicesToProcess.length; step++) {
        if (cancelTranslateAllRef.current || signal.aborted) break;
        const i = indicesToProcess[step];
        const pageUrl = pages[i];

        const pageStartedAt = Date.now();
        let excludedWaitMs = 0;
        translationStopwatchRef.current.pageStartedAt = pageStartedAt;
        translationStopwatchRef.current.pageExcludedMs = 0;
        translationStopwatchRef.current.pagePausedAt = null;
        translationStopwatchRef.current.lastPageDurationMs = undefined;

        setTranslateAllProgress({
          current: batchProgressFrontier(),
          total: indicesToProcess.length,
          status: "cleaning",
          message: `กำลังคลีนหน้า ${i + 1}/${pages.length}`,
          startTime: batchStartTime,
          elapsedMs: Math.max(0, pageStartedAt - batchStartTime),
          pageElapsedMs: 0,
        });

        let preparedPage: PreparedTranslationPage;
        try {
          const preparation = await (preparationQueue.get(i) ?? prepareSafely(i));
          preparationQueue.delete(i);
          if (signal.aborted) break;
          void pumpPreparationQueue();
          if (!preparation.ok) throw preparation.error;
          preparedPage = preparation.value;
          const isApprovedByUser = userApprovedReviewPagesRef.current.has(pageUrl);
          if (preparedPage.awaitingReview && preparedPage.cleaningMode !== "all-text" && !isTargetedRetry && !isApprovedByUser && !autoProceedOnReview) {
            throw new CleaningClientError(
              422,
              "Page awaiting review after local cleaning verification.",
              "Review or explicitly retry this page before translation.",
            );
          }
          if (preparedPage.awaitingReview) {
            setReviewFlaggedPages((prev) => new Set(prev).add(pageUrl));
          }
        } catch (error) {
          if (signal.aborted || isUserCancelledError(error)) break;
          const explicitCleaningCode = error instanceof CleaningClientError
            ? (error.status === 0 || error.status === 502 || error.status === 503 ||
              /timeout|sidecar|8765|เซิร์ฟเวอร์/i.test(error.message))
                ? "LOCAL_SIDECAR_OFFLINE"
                : error.status >= 500
                  ? "LOCAL_CLEANER_FAILED"
                  : undefined
            : undefined;
          const diagnostic = classifyTranslationError(
            error,
            error instanceof CleaningClientError ? error.status : undefined,
            explicitCleaningCode,
          );
          const failureItem: BatchPageFailure = {
            failureGroupId: failureGroupIdFor(diagnostic),
            pageIndex: i,
            pageUrl,
            stage: "cleaning",
            message: error instanceof Error ? error.message : "คลีนไม่สำเร็จ",
            diagnostic,
          };
          failures.push(failureItem);
          setBatchFailures((prev) => {
            const next = prev.filter((f) => f.pageIndex !== i);
            return [...next, failureItem];
          });
          continue;
        }
        if (cancelTranslateAllRef.current) break;

        setTranslateAllProgress({
          current: batchProgressFrontier(),
          total: indicesToProcess.length,
          status: "translating",
          message: `กำลังแปลหน้า ${i + 1}/${pages.length}`,
          startTime: batchStartTime,
          elapsedMs: Math.max(0, Date.now() - batchStartTime),
          pageElapsedMs: Math.max(0, Date.now() - pageStartedAt - excludedWaitMs),
          secondaryMessage: cleaningProgress(),
        });

        let success = false;
        let retries = 0;
        const forceNsfw = forceNsfwForBatch;
        let lastTranslationError: unknown;

        while (!success && retries < 2 && !cancelTranslateAllRef.current) {
          try {
            setTranslateAllProgress({
              current: batchProgressFrontier(),
              total: indicesToProcess.length,
              status: "translating",
              message: `กำลังแปลหน้า ${i + 1}/${pages.length}`,
              startTime: batchStartTime,
              elapsedMs: Math.max(0, Date.now() - batchStartTime),
              pageElapsedMs: Math.max(0, Date.now() - pageStartedAt - excludedWaitMs),
              secondaryMessage: cleaningProgress(),
            });
            if (nsfwBypassMode || forceNsfw) {
              setTranslationResult(
                `กำลังหั่นภาพเป็น 6 ส่วน (หน้า ${i + 1}) - รอบ ${retries + 1}/2`,
              );
            } else {
              setTranslationResult(
                `กำลังประมวลผลด้วย AI (หน้า ${i + 1}) - รอบ ${retries + 1}/2`,
              );
            }

            success = await performTranslation(
              preparedPage,
              pageUrl,
              i,
              forceNsfw,
              false,
              signal,
            );

            if (!success) throw new Error("Translation failed");
          } catch (err: unknown) {
            lastTranslationError = err;
            // User cancellation must not count as a page failure nor retry.
            if (isUserCancelledError(err)) break;
            const errMsg = err instanceof Error ? err.message : String(err);
            const isQuotaError =
              err instanceof TranslationRequestError &&
              (err.code === "GEMINI_QUOTA" || err.category === "quota");
            if (isQuotaError) {
              batchController.abort();
              const cooldownMs = err.retryAfterMs ?? DEFAULT_QUOTA_COOLDOWN_MS;
              const quotaGroupId = `${failureOperationId}:QUOTA_EXHAUSTED`;
              const nextExpiry = Date.now() + cooldownMs;
              setQuotaCooldownByGroup((previous) =>
                extendFailureGroupCooldown(previous, quotaGroupId, nextExpiry),
              );
              setTranslationResult("โควต้าเต็มชั่วคราว กรุณารอคูลดาวน์แล้วกดลองใหม่");
              break;
            }
            const canAutoRetry = shouldAutoRetryTranslation(err, retries);
            console.warn(
              `Error on page ${i + 1}, retry ${retries + 1}/2:`,
              errMsg,
            );

            if (!canAutoRetry) {
              const retryHint =
                err instanceof TranslationRequestError &&
                typeof err.retryAfterMs === "number"
                  ? ` · ลองใหม่ได้ในประมาณ ${Math.ceil(err.retryAfterMs / 1000)} วิ`
                  : "";
              const autoHint =
                modelPreference && modelPreference !== "auto"
                  ? " · สามารถเปลี่ยนโมเดลเป็น Auto ได้"
                  : "";
              setTranslationResult(`แปลไม่สำเร็จ: ${errMsg}${retryHint}${autoHint}`);
              break;
            }

            const retryDelay = getTranslationRetryDelay(err, retries) ?? 2_000;
            const waitSec = Math.round(retryDelay / 1000);
            const waitStartedAt = Date.now();
            translationStopwatchRef.current.pagePausedAt = waitStartedAt;
            setTranslateAllProgress({
              current: batchProgressFrontier(),
              total: indicesToProcess.length,
              status: "waiting",
              message: err instanceof TranslationRequestError && err.code === "GEMINI_QUOTA"
                ? `รอโควต้า API (${waitSec} วิ)... หน้า ${i + 1}/${pages.length}`
                : `รอลองใหม่ (${waitSec} วิ)... หน้า ${i + 1}/${pages.length}`,
              startTime: batchStartTime,
              elapsedMs: Math.max(0, waitStartedAt - batchStartTime),
              pageElapsedMs: Math.max(0, waitStartedAt - pageStartedAt - excludedWaitMs),
            });
            if (
              err instanceof TranslationRequestError
              && err.code === "GEMINI_QUOTA"
            ) {
              setTranslationResult(
                `API Rate Limit! รอ ${waitSec} วิ... (รอบ ${retries + 1}/2)`,
              );
            } else {
              setTranslationResult(
                `เครือข่ายขัดข้อง รอ ${waitSec} วิเพื่อลองใหม่... (รอบ ${retries + 1}/2)`,
              );
            }
            await interruptibleDelay(retryDelay);
            const waitedMs = Date.now() - waitStartedAt;
            excludedWaitMs += waitedMs;
            translationStopwatchRef.current.pageExcludedMs = excludedWaitMs;
            translationStopwatchRef.current.pagePausedAt = null;
            retries++;
          }
        }

        if (
          !success
          && !isUserCancelledError(lastTranslationError)
          && !cancelTranslateAllRef.current
        ) {
          const errMsg =
            lastTranslationError instanceof Error
              ? lastTranslationError.message
              : "แปลไม่สำเร็จ";
          const errStatus =
            lastTranslationError instanceof TranslationRequestError
              ? lastTranslationError.status
              : undefined;
          const errCode =
            lastTranslationError instanceof TranslationRequestError
              ? lastTranslationError.code
              : undefined;

          const diagnostic = classifyTranslationError(
            lastTranslationError,
            errStatus,
            errCode,
          );
          const failureItem: BatchPageFailure = {
            failureGroupId: failureGroupIdFor(diagnostic),
            pageIndex: i,
            pageUrl,
            stage: "translation",
            message: errMsg,
            diagnostic,
          };
          failures.push(failureItem);
          setBatchFailures((prev) => {
            const next = prev.filter((f) => f.pageIndex !== i);
            return [...next, failureItem];
          });
        }

        if (success) {
          batchReadyPages.add(pageUrl);
          const durationMs = Math.max(0, Date.now() - pageStartedAt - excludedWaitMs);
          pageDurationsMs.push(durationMs);
          translationStopwatchRef.current.lastPageDurationMs = durationMs;
          translationStopwatchRef.current.pageStartedAt = 0;
          translationStopwatchRef.current.pageExcludedMs = 0;
          translationStopwatchRef.current.pagePausedAt = null;
        }

        if (
          lastTranslationError instanceof TranslationRequestError
          && lastTranslationError.code === "GEMINI_QUOTA"
        ) {
          quotaFailureMessage =
            "❌ โควต้า API เต็ม กรุณารอให้โควต้ารีเซ็ตแล้วลองใหม่";
          break;
        }

        if (success && step < indicesToProcess.length - 1 && !cancelTranslateAllRef.current) {
          setTranslateAllProgress({
            current: batchProgressFrontier(),
            total: indicesToProcess.length,
            status: "cooldown",
            message: `พักโหลด 2 วิ... หน้า ${i + 1}/${pages.length}`,
            startTime: batchStartTime,
            elapsedMs: Math.max(0, Date.now() - batchStartTime),
            pageElapsedMs: translationStopwatchRef.current.lastPageDurationMs ?? 0,
            lastPageDurationMs: translationStopwatchRef.current.lastPageDurationMs,
            secondaryMessage: cleaningProgress(),
          });
          await interruptibleDelay(2000);
        }
      }

      if (cancelTranslateAllRef.current) {
        recordBatchMetrics(true);
        setTimeout(() => setTranslationResult(null), 1500);
        return;
      }

      const failedPages = failures.map(({ pageIndex }) => pageIndex + 1);
      const totalElapsedMs = Math.max(0, Date.now() - batchStartTime);
      const totalElapsedSeconds = totalElapsedMs / 1000;
      const totalElapsedLabel = totalElapsedSeconds < 60
        ? `${totalElapsedSeconds.toFixed(1)} วิ`
        : `${Math.floor(totalElapsedSeconds / 60)} นาที ${Math.floor(totalElapsedSeconds % 60)} วิ`;
      const finalResultBase =
        quotaFailureMessage
          ?? (failedPages.length === 0
            ? "✅ แปลเสร็จเรียบร้อยแล้ว"
            : `⚠️ แปลเสร็จ แต่หน้า ${failedPages.join(", ")} ต้องลองใหม่`);
      const finalResultText = `${finalResultBase} · ใช้เวลารวม ${totalElapsedLabel}`;
      setTranslationResult(finalResultText);
      recordBatchMetrics(false);
      sendDesktopNotification("SuperK — Manga Translator", finalResultText);
      setTimeout(() => setTranslationResult(null), 4000);
    } finally {
      batchController.abort();
      suppressedOverlayPagesRef.current.clear();
      recordBatchMetrics?.(cancelTranslateAllRef.current);
      translationOperationLockRef.current = false;
      setIsTranslatingAll(false);
      setTranslateAllProgress(null);
    }
  };

  const handleTranslateAllRef = useRef(handleTranslateAll);
  useEffect(() => {
    handleTranslateAllRef.current = handleTranslateAll;
  });

  const prepareSafely = useCallback(async (
    pageIndex: number,
  ): Promise<
    | { ok: true; value: PreparedTranslationPage }
    | { ok: false; error: unknown }
  > => {
    try {
      return {
        ok: true,
        value: await preparePageForTranslation(pages[pageIndex], pageIndex),
      };
    } catch (error) {
      return { ok: false, error };
    }
  }, [pages, preparePageForTranslation]);

  const executeConcurrentRetry = useCallback(async (
    pageIndices: number[],
    failureGroupIdPrefix: string,
    options?: { forceNsfw?: boolean },
  ) => {
    for (const idx of pageIndices) {
      const pUrl = pages[idx];
      if (pUrl) userApprovedReviewPagesRef.current.add(pUrl);
      inFlightConcurrentPagesRef.current.add(idx);
    }
    setBatchFailures((prev) => prev.filter((f) => !pageIndices.includes(f.pageIndex)));

    const forceNsfw = options?.forceNsfw === true || nsfwBypassMode;
    for (const idx of pageIndices) {
      const pUrl = pages[idx];
      if (!pUrl) continue;
      try {
        const preparation = await prepareSafely(idx);
        if (!preparation.ok) throw preparation.error;
        await performTranslation(
          preparation.value,
          pUrl,
          idx,
          forceNsfw,
          false,
          translationAbortRef.current?.signal,
        );
      } catch (err: unknown) {
        if (!isUserCancelledError(err)) {
          const explicitCleaningCode = err instanceof CleaningClientError
            ? (err.status === 0 || err.status === 502 || err.status === 503 ||
              /timeout|sidecar|8765|เซิร์ฟเวอร์/i.test(err.message))
                ? "LOCAL_SIDECAR_OFFLINE"
                : err.status >= 500
                  ? "LOCAL_CLEANER_FAILED"
                  : undefined
            : undefined;
          const diag = classifyTranslationError(
            err,
            err instanceof CleaningClientError ? err.status : undefined,
            explicitCleaningCode,
          );
          const failureItem: BatchPageFailure = {
            failureGroupId: `${failureGroupIdPrefix}:${diag.code}`,
            pageIndex: idx,
            pageUrl: pUrl,
            stage: "translation",
            message: err instanceof Error ? err.message : "แปลไม่สำเร็จ",
            diagnostic: diag,
          };
          setBatchFailures((prev) => [...prev.filter((f) => f.pageIndex !== idx), failureItem]);
        }
      } finally {
        inFlightConcurrentPagesRef.current.delete(idx);
      }
    }
  }, [pages, nsfwBypassMode, prepareSafely, performTranslation]);

  const retryFailedPages = useCallback(async (
    pageNumbers?: number[],
    options?: { forceNsfw?: boolean },
  ) => {
    if (batchFailures.length === 0) return;
    const selected = pageNumbers?.map((page) => page - 1);
    const failedIndices = (selected && selected.length > 0
      ? selected
      : batchFailures.map((f) => f.pageIndex)
    ).filter((index) =>
      batchFailures.some(
        (failure) => failure.pageIndex === index && pages[index] === failure.pageUrl,
      ),
    );
    if (failedIndices.length === 0) return;

    const activeQuotaFailure = batchFailures.find((failure) => {
      if (!failedIndices.includes(failure.pageIndex)) return false;
      if (failure.diagnostic?.code !== "QUOTA_EXHAUSTED") return false;
      return (quotaCooldownByGroup[failure.failureGroupId] ?? 0) > Date.now();
    });
    if (activeQuotaFailure) {
      const expiry = quotaCooldownByGroup[activeQuotaFailure.failureGroupId];
      setTranslationResult(
        `โควต้ายังอยู่ในคูลดาวน์อีก ${Math.ceil((expiry - Date.now()) / 1000)} วิ`,
      );
      return;
    }

    if (isTranslatingAll) {
      await executeConcurrentRetry(failedIndices, "retry", options);
      return;
    }
    await handleTranslateAllRef.current(failedIndices, options);
  }, [batchFailures, pages, quotaCooldownByGroup, isTranslatingAll, executeConcurrentRetry]);

  const retryFailureGroup = useCallback(async (
    failureGroupId: string,
    options?: { forceNsfw?: boolean },
  ) => {
    const groupFailures = batchFailures.filter(
      (failure) => failure.failureGroupId === failureGroupId,
    );
    if (groupFailures.length === 0) return;

    const cooldownUntil = quotaCooldownByGroup[failureGroupId] ?? 0;
    if (cooldownUntil > Date.now()) {
      setTranslationResult(
        `โควต้ายังอยู่ในคูลดาวน์อีก ${Math.ceil((cooldownUntil - Date.now()) / 1000)} วิ`,
      );
      return;
    }

    const pageIndices = groupFailures
      .filter((failure) => pages[failure.pageIndex] === failure.pageUrl)
      .map((failure) => failure.pageIndex);
    if (pageIndices.length === 0) return;

    setQuotaCooldownByGroup((previous) => {
      if (!(failureGroupId in previous)) return previous;
      const next = { ...previous };
      delete next[failureGroupId];
      return next;
    });
    if (isTranslatingAll) {
      await executeConcurrentRetry(pageIndices, failureGroupId.split(":")[0] || "retry", options);
      return;
    }
    await handleTranslateAllRef.current(pageIndices, options);
  }, [batchFailures, pages, quotaCooldownByGroup, isTranslatingAll, executeConcurrentRetry]);
  const cancelTranslateAll = () => {
    cancelTranslateAllRef.current = true;
    translationAbortRef.current?.abort();
    setTranslationResult("⏹ กำลังยกเลิก...");
  };

  // Unmount: stop in-flight translation work immediately.
  useEffect(() => () => translationAbortRef.current?.abort(), []);

  const invalidatePageTranslation = useCallback((pageUrl: string) => {
    bubbleCacheRef.current.delete(pageUrl);
    translatedImageCacheRef.current.delete(pageUrl);
    completedPagesRef.current.delete(pageUrl);
    const nextRev = (pageRevisionsRef.current.get(pageUrl) ?? 0) + 1;
    pageRevisionsRef.current.set(pageUrl, nextRev);
    setTranslatedImages(new Map(translatedImageCacheRef.current));
    setCacheRevision((revision) => revision + 1);
    if (activePageRef.current === pageUrl) setActiveBubbles([]);
    // The persisted blob for this page is orphaned — drop it immediately
    // (it gets re-put on the next save after a fresh translation).
    void deleteAsset(`translated_${encodeURIComponent(pageUrl)}`);
  }, []);

  // A manual cleaning retry replaces the clean image, but the bubble texts
  // and boxes still apply — re-render the translated image over the fresh
  // cleaning instead of dropping the translations entirely (a full
  // re-translate would cost the user real tokens for unchanged text).
  const refreshPageTranslation = useCallback(
    async (pageUrl: string, backgroundUrl?: string) => {
      const bubbles = bubbleCacheRef.current.get(pageUrl);
      if (!bubbles || bubbles.length === 0) {
        // Nothing to preserve — untranslated pages keep the drop behavior.
        invalidatePageTranslation(pageUrl);
        return;
      }
      try {
        await renderAndCacheTranslation(
          bubbles,
          backgroundUrl ?? pageUrl,
          pageUrl,
          pagesRef.current.indexOf(pageUrl),
        );
      } catch {
        // Drop the stale render; exports re-render it from the bubbles
        // instead of shipping the outdated rendering.
        translatedImageCacheRef.current.delete(pageUrl);
        setTranslatedImages(new Map(translatedImageCacheRef.current));
        setCacheRevision((revision) => revision + 1);
      }
    },
    [invalidatePageTranslation, renderAndCacheTranslation],
  );

  // Whole-book inspection: per-page bubble stats for every translated page.
  // The script guard only protects pages translated after it landed — older
  // pages keep their contamination until they are re-translated, so the
  // review flow needs this report.
  const inspectTranslatedPages = useCallback(() => {
    const results: Array<{
      pageUrl: string;
      pageIndex: number;
      total: number;
      contaminated: number;
      invalidBoxes: number;
    }> = [];
    pagesRef.current.forEach((pageUrl, pageIndex) => {
      const bubbles = bubbleCacheRef.current.get(pageUrl);
      if (!bubbles || bubbles.length === 0) return;
      results.push({
        pageUrl,
        pageIndex,
        total: bubbles.length,
        contaminated: countContaminatedBubbles(bubbles),
        invalidBoxes: bubbles.filter(
          (b) => (b as { isInvalidBox?: boolean }).isInvalidBox === true,
        ).length,
      });
    });
    return results;
  }, []);

  const scanTranslatedPages = useCallback(() => {
    return inspectTranslatedPages()
      .filter((page) => page.contaminated > 0)
      .map(({ pageUrl, pageIndex, contaminated, total }) => ({
        pageUrl,
        pageIndex,
        contaminated,
        total,
      }));
  }, [inspectTranslatedPages]);

  // Find & Replace support: rewrite bubble text in place so the bubble cache
  // survives (invalidating it would wipe the translations being edited).
  // Rendered images are re-rendered afterwards so they carry the new text.
  const replaceBubbleText = useCallback(
    (options: {
      pageUrls: string[];
      backgroundUrls?: Record<string, string>;
      transform: (bubble: TranslatedBubble) => boolean;
    }): number => {
      const targets = options.pageUrls.filter(
        (pageUrl) => bubbleCacheRef.current.has(pageUrl),
      );
      let count = 0;
      for (const pageUrl of targets) {
        for (const b of bubbleCacheRef.current.get(pageUrl) ?? []) {
          if (options.transform(b)) {
            invalidateQualityReview(b);
            count++;
          }
        }
      }
      if (count === 0) return 0;

      for (const pageUrl of targets) {
        markPageDirty(pageUrl);
      }
      setCacheRevision((revision) => revision + 1);

      // Active page's bubbles share object refs with the cache; a shallow
      // array copy re-runs b.render() on the live overlay with the new text.
      const activeUrl = activePageRef.current;
      if (activeUrl && targets.includes(activeUrl)) {
        setActiveBubbles((prev) => (prev.length > 0 ? [...prev] : prev));
      }

      void (async () => {
        const ordered = [...targets].sort((a, b) =>
          a === activeUrl ? -1 : b === activeUrl ? 1 : 0,
        );
        for (const pageUrl of ordered) {
          try {
            await renderAndCacheTranslation(
              bubbleCacheRef.current.get(pageUrl) ?? [],
              options.backgroundUrls?.[pageUrl] ?? pageUrl,
              pageUrl,
              pagesRef.current.indexOf(pageUrl),
            );
          } catch {
            // Drop the stale image; exports re-render it from the bubbles
            // instead of shipping the outdated rendering.
            translatedImageCacheRef.current.delete(pageUrl);
            setTranslatedImages(new Map(translatedImageCacheRef.current));
          }
        }
      })();

      return count;
    },
    [renderAndCacheTranslation, markPageDirty],
  );

  const flushMemory = useCallback(() => {
    const currentKey = pages[currentPage];
    const currentRendered = currentKey ? translatedImageCacheRef.current.get(currentKey) : undefined;
    translatedImageCacheRef.current.clear();
    if (currentKey && currentRendered) {
      translatedImageCacheRef.current.set(currentKey, currentRendered);
    }
    setTranslatedImages(new Map(translatedImageCacheRef.current));
    setCacheRevision((rev) => rev + 1);
  }, [pages, currentPage]);

  return {
    targetLang, setTargetLang,
    sourceLang, setSourceLang,
    modelPreference, setModelPreference,
    allowPreviewModels,
    setAllowPreviewModels: (enabled: boolean) => {
      setAllowPreviewModelsState(enabled);
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("gemini_allow_preview_models", String(enabled));
      }
    },
    textStyle, setTextStyle,
    nsfwBypassMode, setNsfwBypassMode,
    isTranslating,
    translationResult, setTranslationResult,
    showTranslate, setShowTranslate,
    handleTranslate,
    isTranslatingAll,
    translateAllProgress,
    batchPerformanceMetrics,
    handleTranslateAll,
    cancelTranslateAll,
    translateCrop,
    activeBubbles, setActiveBubbles,
    cacheRevision,
    translatedImages,
    translatedImageCacheRef,
    bubbleCacheRef,
    textStyleRef,
    userApiKey,
    setUserApiKey: (key: string) => {
      setUserApiKey(key);
      if (typeof localStorage !== "undefined") {
        if (key) localStorage.setItem("gemini_api_key", key);
        else localStorage.removeItem("gemini_api_key");
      }
    },
    glossary,
    setGlossary: updateGlossary,
    restoreSavedSession,
    clearSavedSession,
    saveStatus,
    saveError,
    retrySaveSession,
    workflowPhase,
    batchFailures,
    failureGroups,
    retryFailedPages,
    retryFailureGroup,
    quotaCooldownByGroup,
    autoProceedOnReview,
    setAutoProceedOnReview,
    reviewFlaggedPages,
    invalidatePageTranslation,
    refreshPageTranslation,
    scanTranslatedPages,
    inspectTranslatedPages,
    replaceBubbleText,
    markPageDirty,
    getPageRevision,
    getPageSignature,
    flushMemory,
  };
}
