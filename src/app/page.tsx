"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { getWorkspacePrimaryAction } from "@/lib/workspacePrimaryAction";
import { useTranslation } from "@/hooks/useTranslation";
import { jsPDF } from "jspdf";
import { Toaster } from "react-hot-toast";
import {
  downloadTranslatedImage,
  applyTranslationOverlay,
  type TranslatedBubble,
} from "@/lib/translationOverlay";
import { Upload, Download, Flame, Eye, EyeOff, Undo2, Redo2, GalleryVertical, RectangleHorizontal, Menu, X, Settings, FileArchive, BookOpen, FileText, Sparkles, Loader2, Check, AlertCircle, RefreshCw, ArrowDown, ArrowUp, ChevronDown, ChevronUp, Eraser } from "lucide-react";
import { undoManager } from "@/lib/undoManager";
import JSZip from "jszip";
import { useCleaning } from "@/hooks/useCleaning";
import {
  CleaningToolbar,
  stageLabel,
  type WorkspaceLayer,
} from "@/components/cleaning/CleaningToolbar";
import { MaskEditor } from "@/components/cleaning/MaskEditor";
import type {
  CleanerOverride,
  ManualRegionAction,
} from "@/lib/cleaning/types";
import { PageViewer } from "@/components/workspace/PageViewer";
import { PageFilmstrip } from "@/components/workspace/PageFilmstrip";
import { SettingsModal } from "@/components/workspace/SettingsModal";
import { WorkspaceExportMenu } from "@/components/workspace/WorkspaceExportMenu";
import { WorkspacePrimaryAction } from "@/components/workspace/WorkspacePrimaryAction";
import { WorkspaceAdvancedTools } from "@/components/workspace/WorkspaceAdvancedTools";
import {
  generateArchiveFilename,
  generateComicInfoXml,
  generateStripFilename,
} from "@/lib/export/exportManager";
import {
  getAskExportDirectory,
  getOrPickExportDirectory,
  isDirectoryPickerSupported,
  pickExportDirectory,
  saveBlob,
  type DirectoryHandleLike,
} from "@/lib/export/saveLocation";
import { dataUrlToBlob } from "@/lib/projectStore";
import {
  FindReplaceDialog,
  type ReplaceOptions,
} from "@/components/editing/FindReplaceDialog";
import { KeyboardShortcutsDialog } from "@/components/editing/KeyboardShortcutsDialog";
import {
  doesPageRequireReview,
  getUnconfirmedPages,
  type PageReviewInfo,
} from "@/lib/export/reviewGate";
import {
  TranslationDiagnosticModal,
  type CleanerRecoveryViewState,
} from "@/components/workspace/TranslationDiagnosticModal";
import { recoverDesktopCleaner } from "@/lib/desktopBridge";

export default function WorkspacePage() {

  const [pages, setPages] = useState<{url: string, name: string, originUrl?: string}[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [confirmedPages, setConfirmedPages] = useState<Set<string>>(new Set());
  const [unconfirmedReviewPages, setUnconfirmedReviewPages] = useState<PageReviewInfo[] | null>(null);
  const [pendingExportAction, setPendingExportAction] = useState<(() => void) | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [workspaceLayer, setWorkspaceLayer] =
    useState<WorkspaceLayer>("original");
  const [viewLayout, setViewLayout] = useState<'single' | 'scroll'>('single');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isThumbnailsCollapsed, setIsThumbnailsCollapsed] = useState(false);
  const [isMaskEditorOpen, setIsMaskEditorOpen] = useState(false);
  const uiOperationLockRef = useRef(false);
  const [isUiOperationBusy, setIsUiOperationBusy] = useState(false);
  const [brokenPages, setBrokenPages] = useState<Set<string>>(new Set());

  // Settings Modal State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsFocusTarget, setSettingsFocusTarget] = useState<"apiKey" | null>(null);
  const [apiKeyRecoveryGroupId, setApiKeyRecoveryGroupId] = useState<string | null>(null);
  const [apiKeyReadyByGroup, setApiKeyReadyByGroup] = useState<Record<string, boolean>>({});
  const [isFindReplaceOpen, setIsFindReplaceOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importStatusMessage, setImportStatusMessage] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [isFocusToolbarVisible, setIsFocusToolbarVisible] = useState(false);
  const [toolbarPosition, setToolbarPosition] = useState<"top" | "bottom">("top");
  const [isToolbarCollapsed, setIsToolbarCollapsed] = useState(false);

  // Restore toolbar preferences from localStorage
  useEffect(() => {
    try {
      const savedPos = localStorage.getItem("manga_clean_toolbar_position");
      if (savedPos === "top" || savedPos === "bottom") {
        setToolbarPosition(savedPos);
      }
      const savedCollapsed = localStorage.getItem("manga_clean_toolbar_collapsed");
      if (savedCollapsed !== null) {
        setIsToolbarCollapsed(savedCollapsed === "true");
      }
    } catch {
      // ignore localStorage errors (e.g. incognito/disabled)
    }
  }, []);

  const toggleToolbarPosition = useCallback(() => {
    setToolbarPosition((prev) => {
      const next = prev === "top" ? "bottom" : "top";
      try {
        localStorage.setItem("manga_clean_toolbar_position", next);
      } catch {}
      return next;
    });
  }, []);

  const toggleToolbarCollapsed = useCallback(() => {
    setIsToolbarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("manga_clean_toolbar_collapsed", String(next));
      } catch {}
      return next;
    });
  }, []);

  // Reset focus toolbar visibility whenever entering focus mode
  useEffect(() => {
    if (isFocusMode) {
      setIsFocusToolbarVisible(false);
    }
  }, [isFocusMode]);

  // Global keyboard shortcuts for Focus Mode (F to toggle, T to toggle top bar, Esc to exit)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable ||
          (typeof target.closest === "function" && Boolean(target.closest('[role="dialog"]'))))
      ) {
        return;
      }

      if (e.key === "f" || e.key === "F") {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          setIsFocusMode((prev) => !prev);
        }
      } else if (e.key === "b" || e.key === "B") {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          setIsFocusMode((focus) => {
            if (focus) {
              setIsFocusToolbarVisible((prev) => !prev);
            } else {
              toggleToolbarCollapsed();
            }
            return focus;
          });
        }
      } else if (e.key === "Escape") {
        setIsFocusMode((prev) => {
          if (prev) {
            e.preventDefault();
            return false;
          }
          return false;
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const pageUrls = useMemo(() => pages.map(p => p.url), [pages]);
  const pageNames = useMemo(() => pages.map(p => p.name), [pages]);
  const {
    cleanPage,
    cleanCurrentPage,
    retryRegion,
    currentResult: currentCleaningResult,
    progress: cleaningProgress,
    error: cleaningError,
    resultsByPage: cleaningResultsByPage,
  } = useCleaning({ pages: pageUrls, currentPage });

  const handleCleanCurrentPage = async () => {
    if (
      uiOperationLockRef.current ||
      isTranslating ||
      isTranslatingAll ||
      cleaningProgress
    ) return;
    const page = pages[currentPage];
    if (!page) return;

    uiOperationLockRef.current = true;
    setIsUiOperationBusy(true);
    try {
      const response = await fetch(page.url);
      if (!response.ok) {
        throw new Error(`Failed to load page for cleaning (${response.status}).`);
      }
      const cleanResult = await cleanCurrentPage(await response.blob());
      if (cleanResult) {
        invalidatePageTranslation(page.url);
        setWorkspaceLayer("clean");
      }
    } finally {
      uiOperationLockRef.current = false;
      setIsUiOperationBusy(false);
    }
  };

  const preparePageForTranslation = useCallback(
    async (pageUrl: string, pageIndex: number) => {
      const page = pages[pageIndex];
      if (!page || page.url !== pageUrl) {
        throw new Error("Page is no longer available for cleaning.");
      }

      const response = await fetch(pageUrl);
      if (!response.ok) {
        throw new Error(`Failed to load page for cleaning (${response.status}).`);
      }
      const result = await cleanPage(pageUrl, await response.blob());
      return {
        recognitionUrl: pageUrl,
        backgroundUrl: result.cleanUrl,
        maskUrl: result.maskUrl,
        preparedIdentity: result.preparedIdentity,
        awaitingReview: result.awaitingReview === true,
      };
    },
    [cleanPage, pages],
  );

  const {
    isTranslating,
    translationResult,
    setTranslationResult,
    handleTranslate,
    isTranslatingAll,
    translateAllProgress,
    handleTranslateAll,
    cancelTranslateAll,
    activeBubbles,
    setActiveBubbles,
    nsfwBypassMode,
    setNsfwBypassMode,
    translatedImages,
    translatedImageCacheRef,
    bubbleCacheRef,
    textStyleRef,
    userApiKey,
    setUserApiKey,
    glossary,
    setGlossary,
    modelPreference,
    setModelPreference,
    targetLang,
    sourceLang,
    setSourceLang,
    textStyle,
    setTextStyle,
    restoreSavedSession,
    clearSavedSession,
    saveStatus,
    saveError,
    retrySaveSession,
    workflowPhase,
    batchFailures,
    failureGroups: diagnosticFailureGroups,
    retryFailedPages,
    retryFailureGroup,
    invalidatePageTranslation,
    replaceBubbleText,
    markPageDirty,
    cacheRevision: translationCacheRevision,
  } = useTranslation({
    currentPage,
    pages: pageUrls,
    pageNames,
    pageOriginUrls: pages.map((p) => p.originUrl),
    viewMode: "single",
    preparePageForTranslation,
    onPageDirtied: (pageUrl) => {
      setConfirmedPages((prev) => {
        if (!prev.has(pageUrl)) return prev;
        const next = new Set(prev);
        next.delete(pageUrl);
        return next;
      });
    },
  });

  const [isDiagnosticModalOpen, setIsDiagnosticModalOpen] = useState(false);
  const [cleanerRecoveryByGroup, setCleanerRecoveryByGroup] = useState<
    Record<string, CleanerRecoveryViewState>
  >({});

  const handleRecoverCleaner = useCallback(async (failureGroupId: string) => {
    setCleanerRecoveryByGroup((previous) => ({
      ...previous,
      [failureGroupId]: { status: "checking" },
    }));

    const result = await recoverDesktopCleaner((status, message) => {
      setCleanerRecoveryByGroup((previous) => ({
        ...previous,
        [failureGroupId]: { status, message },
      }));
    });

    setCleanerRecoveryByGroup((previous) => ({
      ...previous,
      [failureGroupId]: {
        status: result.status,
        message: result.message,
      },
    }));
  }, []);

  const validateRecoveryApiKey = useCallback(async (apiKey: string) => {
    try {
      const response = await fetch("/api/translate/validate-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        valid?: boolean;
        message?: string;
      };
      return {
        ok: response.ok && data.valid === true,
        message: data.message || (response.ok ? undefined : "ตรวจสอบ API Key ไม่สำเร็จ"),
      };
    } catch {
      return {
        ok: false,
        message: "เชื่อมต่อเซิร์ฟเวอร์เพื่อตรวจสอบ API Key ไม่สำเร็จ",
      };
    }
  }, []);

  const currentPageUrl = pages[currentPage]?.url;
  const translatedImagesMap = translatedImages;
  const hasCurrentTranslation = Boolean(
    currentPageUrl &&
      (activeBubbles.length > 0 ||
        translationCacheRevision >= 0 /* reactive cache revision */) &&
      (translatedImagesMap?.has(currentPageUrl) ?? false),
  );
  const toggleOriginalTranslated = useCallback(() => {
    setWorkspaceLayer((currentLayer) =>
      currentLayer === "original" && hasCurrentTranslation
        ? "translated"
        : "original",
    );
  }, [hasCurrentTranslation]);

  const translationBusy = isTranslating || isTranslatingAll;
  const operationBusy =
    isUiOperationBusy || translationBusy || Boolean(cleaningProgress);
  const translateAllStatusText = translateAllProgress
    ? `${translateAllProgress.message}${
        translateAllProgress.secondaryMessage
          ? ` · ${translateAllProgress.secondaryMessage}`
          : ""
      }${
        translateAllProgress.estimating
          ? " · กำลังประเมินเวลาที่เหลือ..."
          : typeof translateAllProgress.remainingSeconds === "number"
            ? ` · ${
                translateAllProgress.remainingSeconds < 60
                  ? `เหลืออีก ~${Math.ceil(translateAllProgress.remainingSeconds)} วิ`
                  : `เหลืออีก ~${Math.ceil(translateAllProgress.remainingSeconds / 60)} นาที`
              }`
            : ""
      } (${Math.round((translateAllProgress.current / translateAllProgress.total) * 100)}%)`
    : null;

  const cleaningStatusText = cleaningProgress
    ? `กำลังคลีน: ${stageLabel(cleaningProgress.stage)} · ${cleaningProgress.completedRegions}/${cleaningProgress.totalRegions} · ${(cleaningProgress.elapsedMs / 1000).toFixed(1)}s`
    : null;

  const workflowMessage =
    importStatusMessage ??
    translateAllStatusText ??
    (isFocusMode && !isFocusToolbarVisible ? cleaningStatusText : null) ??
    translationResult;

  // Auto-dismiss transient translation / export completion messages after 4 seconds
  useEffect(() => {
    if (!translationResult) return;
    if (translationResult.startsWith("⏳") || translationResult.startsWith("กำลัง")) return;

    const timer = setTimeout(() => {
      setTranslationResult(null);
    }, 4000);

    return () => clearTimeout(timer);
  }, [translationResult, setTranslationResult]);

  const handleTranslateCurrent = useCallback(async (): Promise<boolean> => {
    if (
      uiOperationLockRef.current ||
      operationBusy ||
      pages.length === 0
    ) return false;

    uiOperationLockRef.current = true;
    setIsUiOperationBusy(true);
    try {
      const translated = await handleTranslate();
      if (translated) setWorkspaceLayer("translated");
      return translated;
    } finally {
      uiOperationLockRef.current = false;
      setIsUiOperationBusy(false);
    }
  }, [handleTranslate, operationBusy, pages.length]);

  const handleTranslateBook = useCallback(async (): Promise<void> => {
    if (
      uiOperationLockRef.current ||
      operationBusy ||
      pages.length === 0
    ) return;

    uiOperationLockRef.current = true;
    setIsUiOperationBusy(true);
    try {
      setWorkspaceLayer("translated");
      await handleTranslateAll();
    } finally {
      uiOperationLockRef.current = false;
      setIsUiOperationBusy(false);
    }
  }, [handleTranslateAll, operationBusy, pages.length]);

  const [reviewedPageUrls, setReviewedPageUrls] = useState<Set<string>>(
    () => new Set(),
  );
  const hasEnteredReview = Boolean(
    currentPageUrl && reviewedPageUrls.has(currentPageUrl),
  );

  const primaryAction = getWorkspacePrimaryAction({
    hasPage: Boolean(currentPageUrl),
    hasCleanResult: Boolean(currentCleaningResult),
    hasTranslation: hasCurrentTranslation,
    hasEnteredReview,
    isCleaning: Boolean(cleaningProgress) || workflowPhase === "cleaning",
    isTranslating,
    workflowPhase,
    cancellable: isTranslatingAll,
  });

  const exportTriggerRef = useRef<HTMLButtonElement>(null);
  const advancedToolsTriggerRef = useRef<HTMLButtonElement>(null);

  const handlePrimaryAction = async () => {
    if (!currentPageUrl) return;
    if (primaryAction.kind === "prepare-and-translate" || primaryAction.kind === "translate") {
      const translated = await handleTranslateCurrent();
      if (translated) {
        setReviewedPageUrls((current) => {
          const next = new Set(current);
          next.delete(currentPageUrl);
          return next;
        });
      }
      return;
    }
    if (primaryAction.kind === "review") {
      setWorkspaceLayer("translated");
      setReviewedPageUrls((current) => new Set(current).add(currentPageUrl));
      return;
    }
    if (primaryAction.kind === "export") {
      exportTriggerRef.current?.click();
    }
  };

  const handleRetryRegion = async (
    regionId: string,
    mask: Blob,
    cleaner: CleanerOverride,
    action: ManualRegionAction,
  ) => {
    const result = await retryRegion(regionId, mask, cleaner, action);
    const page = pages[currentPage];
    if (page && result) {
      invalidatePageTranslation(page.url);
      setReviewedPageUrls((current) => {
        const next = new Set(current);
        next.delete(page.url);
        return next;
      });
      setWorkspaceLayer("clean");
    }
    return result;
  };

  const [savedSessionData, setSavedSessionData] = useState<{ pages: { url: string, name: string, originUrl?: string }[], currentPage: number } | null>(null);

  // Check for saved IndexedDB session on mount
  useEffect(() => {
    restoreSavedSession().then(saved => {
      if (saved && saved.pages && saved.pages.length > 0) {
        setSavedSessionData({ pages: saved.pages, currentPage: saved.currentPage });
      }
    });
  }, [restoreSavedSession]);

  // Check for extension workspace handoff parameter (?handoff=hnd_...)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const handoffId = params.get("handoff");
    if (!handoffId) return;

    // Clean URL query without page reload
    window.history.replaceState({}, document.title, window.location.pathname);

    (async () => {
      try {
        const res = await fetch(`/api/extension/workspace/append?id=${encodeURIComponent(handoffId)}`);
        if (!res.ok) return;
        const handoffData = await res.json();

        const { appendPageToProjectSession } = await import("@/lib/projectStore");
        const appendRes = await appendPageToProjectSession({
          pageUrl: handoffData.pageUrl,
          name: handoffData.name || `Extension Page`,
          cleanUrl: handoffData.cleanUrl,
          bubbles: handoffData.bubbles,
          originUrl: handoffData.originUrl,
        });

        const restored = await restoreSavedSession();
        if (restored && restored.pages.length > 0) {
          setPages(restored.pages);
          setCurrentPage(appendRes.pageIndex);
          setSavedSessionData(null);
        }
        import("react-hot-toast").then((m) =>
          m.default("✨ นำเข้าภาพจาก Chrome Extension เรียบร้อยแล้ว!", { duration: 2500 })
        );
      } catch (err) {
        console.error("Failed to process extension handoff:", err);
      }
    })();
  }, [restoreSavedSession]);

  // Keyboard shortcuts refs (to access latest state from event listener closure)
  const currentPageRef = useRef(currentPage);
  const pagesRef = useRef(pages);
  const operationBusyRef = useRef(operationBusy);
  useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);
  useEffect(() => { pagesRef.current = pages; }, [pages]);
  useEffect(() => { operationBusyRef.current = operationBusy; }, [operationBusy]);

  // Keyboard shortcuts + Undo/Redo state sync
  useEffect(() => {
    const syncState = () => {
      setCanUndo(undoManager.canUndo());
      setCanRedo(undoManager.canRedo());
    };
    const unsub = undoManager.onChange(syncState);

    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if user is typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // Undo: Ctrl+Z
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const label = undoManager.undo();
        if (label) import('react-hot-toast').then(m => m.default(`↩️ Undo: ${label}`, { duration: 1500 }));
        return;
      }
      // Redo: Ctrl+Shift+Z / Ctrl+Y
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        const label = undoManager.redo();
        if (label) import('react-hot-toast').then(m => m.default(`↪️ Redo: ${label}`, { duration: 1500 }));
        return;
      }
      // Find & Replace: Ctrl+F
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setIsFindReplaceOpen(true);
        return;
      }
      // Shortcuts Help: ?
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setIsShortcutsOpen(true);
        return;
      }

      // Don't trigger shortcuts when modifier keys are held (except for undo/redo above)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // ← Previous page
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setCurrentPage(p => Math.max(0, p - 1));
      }
      // → Next page
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setCurrentPage(p => Math.min(pagesRef.current.length - 1, p + 1));
      }
      // T = Translate current page
      if (e.key === 't' || e.key === 'T') {
        if (
          !uiOperationLockRef.current &&
          !operationBusyRef.current &&
          pagesRef.current.length > 0
        ) {
          void handleTranslateCurrent();
        }
      }
      // Space = Toggle Original/Translated
      if (e.key === ' ') {
        e.preventDefault();
        toggleOriginalTranslated();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => { window.removeEventListener('keydown', handleKeyDown); unsub(); };
  }, [handleTranslateCurrent, toggleOriginalTranslated]);

  // Clear undo stack when changing pages
  useEffect(() => { undoManager.clear(); }, [currentPage]);

  const handleFindReplace = ({
    find,
    replace,
    scope,
    caseSensitive,
  }: ReplaceOptions) => {
    if (!find) return;

    // Compare the replaced output instead of regex.test() — /g regexes are
    // stateful under .test(), which silently skips matches on later bubbles.
    const regex = new RegExp(
      find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      caseSensitive ? "g" : "gi",
    );
    let count = 0;
    const transform = (b: TranslatedBubble): boolean => {
      const text =
        typeof b.t === "string"
          ? b.t
          : typeof b.translated === "string"
            ? b.translated
            : "";
      if (!text) return false;
      // Function replacer: treat `replace` literally — "$&"/"$1" typed by
      // the user must not be interpreted as replacement metacharacters.
      const newText = text.replace(regex, () => replace);
      if (newText === text) return false;
      b.t = newText;
      if (typeof b.translated === "string") b.translated = newText;
      count++;
      return true;
    };

    // replaceBubbleText edits the bubble cache in place (bubbles survive) and
    // re-renders the cached images — invalidatePageTranslation would delete
    // the very translations we just edited.
    if (scope === "this-page") {
      const currentUrl = pages[currentPage]?.url;
      if (currentUrl) {
        count = replaceBubbleText({
          pageUrls: [currentUrl],
          backgroundUrls: {
            [currentUrl]:
              cleaningResultsByPage.get(currentUrl)?.cleanUrl ?? currentUrl,
          },
          transform,
        });
      }
    } else {
      const pageUrls = [...bubbleCacheRef.current.keys()];
      count = replaceBubbleText({
        pageUrls,
        backgroundUrls: Object.fromEntries(
          pageUrls.map((url) => [
            url,
            cleaningResultsByPage.get(url)?.cleanUrl ?? url,
          ]),
        ),
        transform,
      });
    }

    import("react-hot-toast").then((m) => {
      if (count > 0) {
        m.default(`🔄 แทนที่ข้อความสำเร็จ ${count} จุด`, { duration: 2000 });
      } else {
        m.default("ไม่พบข้อความที่ตรงกับคำค้นหา", { duration: 2000 });
      }
    });
  };

  const [isPublishingBack, setIsPublishingBack] = useState(false);

  const handlePublishBackToReadingView = async () => {
    const page = pages[currentPage];
    if (!page || !page.originUrl) return;

    setIsPublishingBack(true);
    try {
      const cleanUrl = cleaningResultsByPage.get(page.url)?.cleanUrl || translatedImages.get(page.url);
      const res = await fetch("/api/extension/publish-back", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageUrl: page.url,
          originUrl: page.originUrl,
          bubbles: activeBubbles,
          textStyle,
          cleanUrl,
        }),
      });

      if (!res.ok) {
        throw new Error(`Server returned status ${res.status}`);
      }

      const toast = (await import("react-hot-toast")).default;
      toast.success("🚀 ส่งคำแปลที่ปรับแต่งกลับไปยังหน้าอ่านแล้ว!");
    } catch (err) {
      console.error("Failed to publish back to reading view:", err);
      const toast = (await import("react-hot-toast")).default;
      toast.error("ส่งกลับหน้าอ่านไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsPublishingBack(false);
    }
  };

  const handleDownloadAll = async (format: "zip" | "cbz" | "pdf" | "strip" = "zip") => {
    if (pages.length === 0) return;

    const unconfirmed = getUnconfirmedPages(
      pages,
      confirmedPages,
      cleaningResultsByPage,
      bubbleCacheRef.current,
    );
    if (unconfirmed.length > 0) {
      setUnconfirmedReviewPages(unconfirmed);
      setPendingExportAction(() => () => void executeDownloadAll(format));
      return;
    }

    await executeDownloadAll(format);
  };

  const executeDownloadAll = async (format: "zip" | "cbz" | "pdf" | "strip" = "zip") => {
    if (pages.length === 0) return;
    setIsZipping(true);

    // Optional destination-folder picker (Chrome/Edge). Unavailable browsers
    // or a dismissed dialog fall back to the normal download flow.
    let destDir: DirectoryHandleLike | null = null;
    if (getAskExportDirectory()) {
      if (!isDirectoryPickerSupported()) {
        import("react-hot-toast").then((m) =>
          m.default("เบราว์เซอร์นี้ไม่รองรับการเลือกโฟลเดอร์ จะดาวน์โหลดตามค่าตั้งต้นแทน", { duration: 3000 }),
        );
      } else {
        destDir = await getOrPickExportDirectory();
        if (!destDir) {
          setIsZipping(false);
          return;
        }
      }
    }

    const failedExportPages: number[] = [];
    const reportRenderFailures = () => {
      setTranslationResult(
        `❌ Export ไม่สำเร็จ: เรนเดอร์คำแปลไม่สำเร็จที่หน้า ${failedExportPages.join(", ")} — ลองใหม่อีกครั้ง`,
      );
      setTimeout(() => setTranslationResult(null), 5000);
    };

    const getExportDataUrl = async (pageUrl: string, index: number): Promise<string | null> => {
      if (
        index === currentPage &&
        workspaceLayer === "translated" &&
        activeBubbles.length > 0
      ) {
        const currentDataUrl = downloadTranslatedImage("single", index, "", true);
        if (currentDataUrl) return currentDataUrl;
      }

      if (translatedImageCacheRef.current.has(pageUrl)) {
        return translatedImageCacheRef.current.get(pageUrl) as string;
      }

      const bubbles = bubbleCacheRef.current.get(pageUrl);
      if (bubbles && bubbles.length > 0) {
        setTranslationResult(`⏳ กำลังเตรียมรูปภาพหน้า ${index + 1}/${pages.length}...`);
        try {
          return await new Promise<string>((resolve, reject) => {
            const offscreenContainer = document.getElementById("offscreen-container");
            const offscreenImg = document.getElementById("offscreen-image") as HTMLImageElement | null;

            if (!offscreenContainer || !offscreenImg) {
              reject(new Error("ไม่พบพื้นที่เรนเดอร์สำหรับสร้างภาพ"));
              return;
            }

            let timeout: ReturnType<typeof setTimeout> | undefined;
            // A timeout/image failure must NOT fall back to the raw page —
            // that silently exports untranslated pages into the book.
            const fail = (reason: string) => {
              clearTimeout(timeout);
              reject(new Error(`เรนเดอร์คำแปลไม่สำเร็จ (${reason})`));
            };

            offscreenContainer.querySelectorAll(".tl-overlay,.tl-canvas").forEach((el) => el.remove());

            offscreenImg.onload = () => {
              // Larger pages need proportionally longer to render (30s cap).
              const megapixels =
                (offscreenImg.naturalWidth * offscreenImg.naturalHeight) / 1_000_000;
              timeout = setTimeout(
                () => fail("หมดเวลา"),
                Math.min(30_000, 2_000 + Math.round(megapixels * 1_000)),
              );
              applyTranslationOverlay(
                bubbles,
                "offscreen",
                -1,
                () => {},
                (renderedUrl) => {
                  clearTimeout(timeout);
                  translatedImageCacheRef.current.set(pageUrl, renderedUrl);
                  markPageDirty(pageUrl, false);
                  resolve(renderedUrl);
                },
                textStyleRef,
                undefined,
                pageUrl,
              );
            };
            offscreenImg.onerror = () => fail("โหลดภาพไม่สำเร็จ");
            offscreenImg.src =
              cleaningResultsByPage.get(pageUrl)?.cleanUrl ?? pageUrl;
          });
        } catch (err) {
          console.warn(`Offscreen render failed for page ${index + 1}`, err);
          return null;
        }
      }
      return pageUrl;
    };

    if (format === "strip") {
      try {
        setTranslationResult(`⏳ กำลังโหลดและรวมภาพแบบ Webtoon Strip...`);
        const loadedImages: HTMLImageElement[] = [];
        const targetWidth = 1200;

        for (let i = 0; i < pages.length; i++) {
          try {
            const dataUrl = await getExportDataUrl(pages[i].url, i);
            if (!dataUrl) {
              failedExportPages.push(i + 1);
              continue;
            }
            const img = new Image();
            img.src = dataUrl;
            await new Promise<void>((resolve) => {
              const timer = setTimeout(() => resolve(), 3000);
              img.onload = () => { clearTimeout(timer); resolve(); };
              img.onerror = () => { clearTimeout(timer); resolve(); };
            });
            if (img.naturalWidth && img.naturalHeight) {
              loadedImages.push(img);
            }
          } catch (err) {
            console.warn(`Error loading page ${i + 1} for long strip`, err);
            failedExportPages.push(i + 1);
          }
        }

        if (failedExportPages.length > 0) {
          reportRenderFailures();
          return;
        }

        if (loadedImages.length === 0) {
          setTranslationResult(`❌ ไม่พบรูปภาพที่สมบูรณ์สำหรับสร้าง Webtoon Strip`);
          setTimeout(() => setTranslationResult(null), 3000);
          return;
        }

        const MAX_STRIP_HEIGHT = 14000;
        let currentChunk: { img: HTMLImageElement; height: number }[] = [];
        let currentHeight = 0;
        let chunkIndex = 1;

        const exportChunk = (chunk: { img: HTMLImageElement; height: number }[], index: number, isMulti: boolean) => {
          const totalH = chunk.reduce((sum, item) => sum + item.height, 0);
          const stripCanvas = document.createElement("canvas");
          stripCanvas.width = targetWidth;
          stripCanvas.height = totalH;
          const ctx = stripCanvas.getContext("2d");
          if (!ctx) return;

          let yOffset = 0;
          for (const item of chunk) {
            ctx.drawImage(item.img, 0, yOffset, targetWidth, item.height);
            yOffset += item.height;
          }

          const stripFilename = generateStripFilename(index, chunkIndex > 1 ? chunkIndex : 1, pages);
          stripCanvas.toBlob(
            (blob) => {
              if (!blob) return;
              void saveBlob(blob, stripFilename, destDir).then((savedName) => {
                if (savedName && savedName !== stripFilename) {
                  import("react-hot-toast").then((m) =>
                    m.default.success(`บันทึกเป็น "${savedName}" (พบไฟล์ชื่อซ้ำ)`),
                  );
                }
              });
            },
            "image/jpeg",
            0.92,
          );
        };

        for (const img of loadedImages) {
          const scaledHeight = Math.round((targetWidth / img.naturalWidth) * img.naturalHeight);
          if (currentHeight + scaledHeight > MAX_STRIP_HEIGHT && currentChunk.length > 0) {
            exportChunk(currentChunk, chunkIndex++, true);
            currentChunk = [];
            currentHeight = 0;
          }
          currentChunk.push({ img, height: scaledHeight });
          currentHeight += scaledHeight;
        }

        if (currentChunk.length > 0) {
          exportChunk(currentChunk, chunkIndex, chunkIndex > 1);
        }

        setTranslationResult(`✅ ดาวน์โหลด Webtoon Strip สำเร็จ! (${loadedImages.length} หน้า)`);
        setTimeout(() => setTranslationResult(null), 3000);
      } catch (e) {
        console.error("Failed to generate long strip", e);
        setTranslationResult(`❌ เกิดข้อผิดพลาดในการรวมภาพ Webtoon Strip`);
        setTimeout(() => setTranslationResult(null), 3000);
      } finally {
        setIsZipping(false);
      }
      return;
    }

    if (format === "pdf") {
      try {
        const pdf = new jsPDF({ orientation: "portrait", unit: "px" });
        let addedCount = 0;

        for (let i = 0; i < pages.length; i++) {
          try {
            const dataUrl = await getExportDataUrl(pages[i].url, i);
            if (!dataUrl) {
              failedExportPages.push(i + 1);
              continue;
            }

            const img = new Image();
            img.src = dataUrl;
            await new Promise<void>((resolve) => {
              const timer = setTimeout(() => resolve(), 3000);
              img.onload = () => { clearTimeout(timer); resolve(); };
              img.onerror = () => { clearTimeout(timer); resolve(); };
            });

            if (!img.naturalWidth || !img.naturalHeight) {
              console.warn(`Skipping broken page ${i + 1} for PDF export`);
              failedExportPages.push(i + 1);
              continue;
            }

            const orientation = img.naturalWidth > img.naturalHeight ? "l" : "p";
            if (addedCount > 0) pdf.addPage([img.naturalWidth, img.naturalHeight], orientation);
            else pdf.setPage(1);

            if (addedCount === 0) {
              pdf.deletePage(1);
              pdf.addPage([img.naturalWidth, img.naturalHeight], orientation);
            }

            pdf.addImage(dataUrl, "JPEG", 0, 0, img.naturalWidth, img.naturalHeight);
            addedCount++;
          } catch (err) {
            console.warn(`Error processing PDF page ${i + 1}`, err);
          }
        }

        if (failedExportPages.length > 0) {
          reportRenderFailures();
          return;
        }

        if (addedCount > 0) {
          const pdfFilename = generateArchiveFilename("pdf", pages);
          setTranslationResult(`⏳ กำลังบันทึก PDF...`);
          const savedName = await saveBlob(pdf.output("blob"), pdfFilename, destDir);
          const wasRenamed = savedName !== pdfFilename;
          const folderLabel = destDir?.name ? ` ใน "${destDir.name}"` : "";
          setTranslationResult(
            wasRenamed
              ? `✅ บันทึก ${savedName}${folderLabel} สำเร็จ! (พบชื่อซ้ำ จึงเปลี่ยนชื่อให้อัตโนมัติ)`
              : `✅ ดาวน์โหลด PDF${folderLabel} สำเร็จ! (${addedCount} หน้า)`
          );
          if (wasRenamed) {
            import("react-hot-toast").then((m) =>
              m.default.success(`บันทึกเป็น "${savedName}"${folderLabel} (พบไฟล์ชื่อซ้ำ)`),
            );
          }
        } else {
          setTranslationResult(`❌ ไม่พบรูปภาพที่สมบูรณ์สำหรับสร้าง PDF`);
        }
        setTimeout(() => setTranslationResult(null), 3000);
      } catch (e) {
        console.error("Failed to generate PDF", e);
        setTranslationResult(`❌ เกิดข้อผิดพลาดในการสร้าง PDF`);
        setTimeout(() => setTranslationResult(null), 3000);
      } finally {
        setIsZipping(false);
      }
      return;
    }

    const zip = new JSZip();
    let zipAddedCount = 0;

    for (let i = 0; i < pages.length; i++) {
      try {
        const dataUrl = await getExportDataUrl(pages[i].url, i);
        if (!dataUrl) {
          failedExportPages.push(i + 1);
          continue;
        }
        if (!dataUrl.includes(",")) continue;
        const base64Data = dataUrl.split(",")[1];
        if (!base64Data) continue;

        const originalName = pages[i].name;
        const extension = originalName.includes('.') ? originalName.split('.').pop() : 'png';
        const baseName = originalName.includes('.') ? originalName.substring(0, originalName.lastIndexOf('.')) : originalName;
        const filename = `SuperK_Page_${String(i + 1).padStart(3, '0')}_${baseName}.${extension}`;
        zip.file(filename, base64Data, { base64: true });
        zipAddedCount++;
      } catch (err) {
        console.warn(`Error processing ZIP page ${i + 1}`, err);
      }
    }

    if (failedExportPages.length > 0) {
      reportRenderFailures();
      setIsZipping(false);
      return;
    }

    try {
      if (zipAddedCount > 0) {
        if (format === "cbz") {
          const xml = generateComicInfoXml({
            title: pages[0]?.name?.replace(/\.[^/.]+$/, "") || "Manga Translation",
            pageCount: zipAddedCount,
            languageISO: targetLang === "Thai" ? "th" : "en",
          });
          zip.file("ComicInfo.xml", xml);
        }

        const archiveFilename = generateArchiveFilename(format, pages);
        setTranslationResult(`⏳ กำลังสร้างไฟล์ ${format.toUpperCase()}...`);
        const content = await zip.generateAsync({ type: "blob" });
        const savedName = await saveBlob(content, archiveFilename, destDir);
        const wasRenamed = savedName !== archiveFilename;
        const folderLabel = destDir?.name ? ` ใน "${destDir.name}"` : "";
        setTranslationResult(
          wasRenamed
            ? `✅ บันทึก ${savedName}${folderLabel} สำเร็จ! (พบชื่อซ้ำ จึงเปลี่ยนชื่อให้อัตโนมัติ)`
            : `✅ ดาวน์โหลด ${format.toUpperCase()}${folderLabel} สำเร็จ! (${zipAddedCount} หน้า)`
        );
        if (wasRenamed) {
          import("react-hot-toast").then((m) =>
            m.default.success(`บันทึกเป็น "${savedName}"${folderLabel} (พบไฟล์ชื่อซ้ำ)`),
          );
        }
      } else {
        setTranslationResult(`❌ ไม่พบรูปภาพที่สมบูรณ์สำหรับสร้าง ${format.toUpperCase()}`);
      }
      setTimeout(() => setTranslationResult(null), 3000);
    } catch (e) {
      console.error(`Failed to generate ${format}`, e);
      setTranslationResult(`❌ เกิดข้อผิดพลาดในการสร้าง ${format.toUpperCase()}`);
      setTimeout(() => setTranslationResult(null), 3000);
    } finally {
      setIsZipping(false);
    }
  };

  const saveCurrentPageImage = async () => {
    const unconfirmed = getUnconfirmedPages(
      pages,
      confirmedPages,
      cleaningResultsByPage,
      bubbleCacheRef.current,
      [currentPage],
    );
    if (unconfirmed.length > 0) {
      setUnconfirmedReviewPages(unconfirmed);
      setPendingExportAction(() => () => void executeSaveCurrentPageImage());
      return;
    }

    await executeSaveCurrentPageImage();
  };

  const executeSaveCurrentPageImage = async () => {
    const originalName = pages[currentPage]?.name || "page.png";
    const extension = originalName.includes('.') ? originalName.split('.').pop() : 'png';
    const baseName = originalName.includes('.') ? originalName.substring(0, originalName.lastIndexOf('.')) : originalName;
    const filename = `SuperK_Page_${String(currentPage + 1).padStart(3, '0')}_${baseName}.${extension}`;

    let destDir: DirectoryHandleLike | null = null;
    if (getAskExportDirectory() && isDirectoryPickerSupported()) {
      destDir = await getOrPickExportDirectory();
      if (!destDir) return;
    }
    if (destDir) {
      const dataUrl = downloadTranslatedImage("single", currentPage, "", true);
      if (dataUrl) {
        const savedName = await saveBlob(dataUrlToBlob(dataUrl), filename, destDir);
        const wasRenamed = savedName !== filename;
        const folderLabel = destDir.name ? ` ใน "${destDir.name}"` : "";
        setTranslationResult(
          wasRenamed
            ? `✅ บันทึก ${savedName}${folderLabel} สำเร็จ! (พบชื่อซ้ำ จึงเปลี่ยนชื่อให้อัตโนมัติ)`
            : `✅ บันทึก ${filename}${folderLabel} สำเร็จ!`
        );
        if (wasRenamed) {
          import("react-hot-toast").then((m) =>
            m.default.success(`บันทึกเป็น "${savedName}"${folderLabel} (พบไฟล์ชื่อซ้ำ)`),
          );
        }
        setTimeout(() => setTranslationResult(null), 3000);
      }
      return;
    }
    downloadTranslatedImage("single", currentPage, filename);
  };

  const processFiles = async (files: File[]) => {
    if (files.length === 0 || isImporting) return;

    setIsImporting(true);
    setImportStatusMessage("กำลังจัดเตรียมไฟล์...");

    try {
      // Natural sort: "page1, page2, page10" instead of "page1, page10, page2"
      const sorted = [...files].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      );

      const newPages: {url: string, name: string}[] = [];
      let failureCount = 0;

      for (let fileIdx = 0; fileIdx < sorted.length; fileIdx++) {
        const file = sorted[fileIdx];
        const isArchive = file.type === "application/zip" || file.type === "application/x-zip-compressed" || file.name.toLowerCase().endsWith('.zip') || file.name.toLowerCase().endsWith('.cbz');
        const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith('.pdf');

        if (isArchive) {
          try {
            setImportStatusMessage(`กำลังแตกไฟล์ ZIP/CBZ: ${file.name}...`);
            const zip = new JSZip();
            const loadedZip = await zip.loadAsync(file);

            const zipFiles = Object.values(loadedZip.files).filter(f => !f.dir && f.name.match(/\.(jpg|jpeg|png|webp|gif)$/i));
            zipFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

            if (zipFiles.length === 0) {
              const toast = (await import('react-hot-toast')).default;
              toast.error(`ไม่พบไฟล์รูปภาพใน ${file.name}`);
              failureCount++;
              continue;
            }

            for (let zIdx = 0; zIdx < zipFiles.length; zIdx++) {
              const zipFile = zipFiles[zIdx];
              setImportStatusMessage(`กำลังอ่านไฟล์ ${file.name} (รูปที่ ${zIdx + 1}/${zipFiles.length})...`);
              const base64 = await zipFile.async("base64");
              const ext = zipFile.name.split('.').pop()?.toLowerCase();
              const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
              newPages.push({ url: `data:${mimeType};base64,${base64}`, name: zipFile.name });
            }
          } catch (e) {
            console.error("Failed to extract zip/cbz", e);
            failureCount++;
            const toast = (await import('react-hot-toast')).default;
            toast.error(`ไม่สามารถเปิดไฟล์ ZIP/CBZ: ${file.name}`);
          }
        } else if (isPdf) {
          try {
            setImportStatusMessage(`กำลังเปิดไฟล์ PDF: ${file.name}...`);
            const pdfjsLib = await import('pdfjs-dist');
            if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
              // Local worker copied to /public by scripts/copy-pdf-worker.mjs
              // (postinstall) — keeps PDF import working offline and avoids
              // loading code from a third-party CDN at runtime.
              pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
            }
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            const numPages = pdf.numPages;

            for (let i = 1; i <= numPages; i++) {
              setImportStatusMessage(`กำลังแปลงหน้า PDF: ${file.name} (หน้า ${i}/${numPages})...`);
              const page = await pdf.getPage(i);
              const viewport = page.getViewport({ scale: 2.0 }); // scale for better quality
              const canvas = document.createElement("canvas");
              canvas.width = viewport.width;
              canvas.height = viewport.height;
              const ctx = canvas.getContext("2d");
              if (!ctx) continue;

              // pdfjs RenderParameters requires canvas ctx type from its own DOM
              // lib; our ctx is structurally identical so cast through unknown.
              const renderParams = {
                canvasContext: ctx,
                viewport,
              } as unknown as Parameters<typeof page.render>[0];
              await page.render(renderParams).promise;
              const base64 = canvas.toDataURL("image/jpeg", 0.95);
              newPages.push({ url: base64, name: `${file.name.replace('.pdf', '')}_page${i}.jpg` });
            }
          } catch (e) {
            console.error("Failed to parse PDF", e);
            failureCount++;
            const toast = (await import('react-hot-toast')).default;
            toast.error(`ไม่สามารถแปลงไฟล์ PDF: ${file.name}`);
          }
        } else if (file.type.startsWith("image/")) {
          setImportStatusMessage(`กำลังโหลดรูป: ${file.name} (${fileIdx + 1}/${sorted.length})...`);
          const base64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = (event) => resolve(event.target?.result as string);
            reader.readAsDataURL(file);
          });
          newPages.push({ url: base64, name: file.name });
        }
      }

      if (newPages.length > 0) {
        setPages(prev => {
          const updated = [...prev, ...newPages];
          if (prev.length === 0) {
            setCurrentPage(0);
            setActiveBubbles([]);
          }
          return updated;
        });
        const toast = (await import('react-hot-toast')).default;
        toast.success(`นำเข้าสำเร็จ ${newPages.length} หน้า`);
      } else if (failureCount > 0) {
        const toast = (await import('react-hot-toast')).default;
        toast.error("ไม่สามารถนำเข้าไฟล์ที่เลือกได้ กรุณาตรวจสอบรูปแบบไฟล์");
      }
    } finally {
      setIsImporting(false);
      setImportStatusMessage(null);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    await processFiles(files);
    e.target.value = ''; // Reset input
  };

  const handleDragOver = (e: React.DragEvent) => {
    // Only accept drag if files from outside the browser are being dragged
    const hasFiles = e.dataTransfer.types && Array.from(e.dataTransfer.types).includes("Files");
    if (hasFiles) {
      e.preventDefault();
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      await processFiles(files);
    }
  };

  return (
    <div
      className="min-h-screen bg-background text-foreground flex flex-col font-sans"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <Toaster position="top-center" toastOptions={{
        style: {
          background: 'var(--surface)',
          color: 'var(--foreground)',
          border: '1px solid var(--surface-hover)',
        },
      }} />

      {/* Batch Progress Bar - Full Width */}
      {translateAllProgress && (
        <div
          className={`fixed left-0 right-0 z-50 transition-all duration-200 ${
            isFocusMode ? "top-0" : "top-14"
          }`}
        >
          <div className="h-1 bg-surface/60 backdrop-blur-xs w-full">
            <div
              className="h-full bg-primary shadow-[0_0_8px_rgba(var(--primary-rgb),0.7)] transition-all duration-500 ease-out"
              style={{ width: `${(translateAllProgress.current / translateAllProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Header Panel */}
      <header
        className={`w-full bg-background/95 backdrop-blur-md border-b border-border/80 h-14 flex justify-between items-center px-3 sm:px-5 z-50 fixed top-0 select-none transition-transform duration-300 ${
          isFocusMode ? "-translate-y-full pointer-events-none" : "translate-y-0"
        }`}
      >
        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icon-512.png"
            alt="SuperK Logo"
            className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg shadow-sm border border-border/80 object-cover flex-shrink-0"
          />
          <h1 className="text-base font-semibold tracking-tight text-foreground flex items-center">
            <span className="flex items-center gap-0.5">
              Super<span className="text-primary font-bold">K</span>
            </span>
            <span className="text-muted text-xs font-normal hidden sm:inline-block pl-2.5 ml-2.5 border-l border-border/80 tracking-wide uppercase">
              Manga Translator
            </span>
          </h1>

          {/* Save Status Indicator */}
          {pages.length > 0 && saveStatus !== "idle" && (
            <div className="flex items-center ml-1 sm:ml-2">
              {saveStatus === "saving" && (
                <span
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] text-muted font-medium bg-surface/60 border border-border/60 rounded-full select-none"
                  title="กำลังบันทึกข้อมูลล่าสุดลง IndexedDB..."
                >
                  <Loader2 className="w-3 h-3 animate-spin text-primary" />
                  <span className="hidden sm:inline">กำลังบันทึก...</span>
                </span>
              )}
              {saveStatus === "saved" && (
                <span
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] text-emerald-500/90 dark:text-emerald-400 font-medium bg-emerald-500/10 border border-emerald-500/20 rounded-full select-none"
                  title="บันทึกข้อมูลล่าสุดลงเครื่องเรียบร้อยแล้ว"
                >
                  <Check className="w-3 h-3 text-emerald-500" />
                  <span className="hidden sm:inline">บันทึกแล้ว</span>
                </span>
              )}
              {saveStatus === "error" && (
                <div
                  className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[11px] text-amber-500 dark:text-amber-400 font-medium bg-amber-500/10 border border-amber-500/30 rounded-full shadow-xs"
                  role="alert"
                >
                  <AlertCircle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                  <span className="hidden sm:inline truncate max-w-[150px]">
                    {saveError || "บันทึกไม่สำเร็จ"}
                  </span>
                  <button
                    type="button"
                    onClick={() => void retrySaveSession()}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-400 hover:underline cursor-pointer ml-1 pl-1.5 border-l border-amber-500/30 focus-visible:outline-none"
                    title="ลองบันทึกอีกครั้ง"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>ลองใหม่</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Desktop Menu */}
        <div className="hidden md:flex items-center gap-2.5 flex-nowrap">
          {pages.length === 0 ? (
            /* ── Empty State Header Controls: Clean & Minimal ── */
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                aria-label="เปิดหน้าต่างตั้งค่า"
                className={`h-8.5 px-3 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  isSettingsOpen
                    ? 'text-primary bg-primary/10 border-primary/30'
                    : 'text-foreground border-border hover:bg-surface-hover'
                }`}
                title="ตั้งค่า API & ฟอนต์"
              >
                <Settings className="w-4 h-4 text-muted" aria-hidden="true" />
                <span>ตั้งค่า</span>
              </button>
            </div>
          ) : (
            /* ── Active Workspace Controls: Grouped & Unified ── */
            <>
              {/* ── Utilities Group (Undo, Redo, Eye, Layout, Tools) ── */}
              <div className="flex items-center gap-1.5" role="group" aria-label="เครื่องมือและมุมมอง">
                <div className="flex items-center bg-surface/80 rounded-lg p-0.5 border border-border/70 gap-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      const label = undoManager.undo();
                      if (label) import('react-hot-toast').then(m => m.default(`↩️ Undo: ${label}`, { duration: 1500 }));
                    }}
                    disabled={!canUndo}
                    aria-label="เลิกทำ (Undo, Ctrl+Z)"
                    className="h-7.5 w-7.5 rounded-md flex items-center justify-center text-muted hover:text-foreground hover:bg-surface-hover/80 disabled:opacity-25 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    title="Undo (Ctrl+Z)"
                  >
                    <Undo2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const label = undoManager.redo();
                      if (label) import('react-hot-toast').then(m => m.default(`↪️ Redo: ${label}`, { duration: 1500 }));
                    }}
                    disabled={!canRedo}
                    aria-label="ทำซ้ำ (Redo, Ctrl+Shift+Z)"
                    className="h-7.5 w-7.5 rounded-md flex items-center justify-center text-muted hover:text-foreground hover:bg-surface-hover/80 disabled:opacity-25 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    title="Redo (Ctrl+Shift+Z)"
                  >
                    <Redo2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>

                {/* Layer toggle for quickly peeking translation */}
                <button
                  type="button"
                  onClick={toggleOriginalTranslated}
                  disabled={!hasCurrentTranslation}
                  aria-label={workspaceLayer === "original" ? "สลับไปแสดงคำแปล" : "สลับไปดูภาพต้นฉบับ"}
                  className={`h-8.5 w-8.5 rounded-lg border border-border flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    workspaceLayer === "original" ? 'text-muted hover:text-foreground hover:bg-surface-hover/80 bg-surface' : 'text-primary bg-primary/10'
                  } disabled:opacity-30`}
                  title={workspaceLayer === "original" ? 'แสดงคำแปล' : 'ดูต้นฉบับ'}
                >
                  {workspaceLayer === "original" ? <Eye className="w-4 h-4" aria-hidden="true" /> : <EyeOff className="w-4 h-4" aria-hidden="true" />}
                </button>

                {/* Layout toggle (Single / Scroll) */}
                <button
                  type="button"
                  onClick={() => setViewLayout(prev => prev === 'single' ? 'scroll' : 'single')}
                  disabled={pages.length === 0}
                  aria-label={viewLayout === 'scroll' ? "เปลี่ยนเป็นโหมดอ่านทีละหน้า" : "เปลี่ยนเป็นโหมดเลื่อนอ่าน"}
                  className={`h-8.5 w-8.5 rounded-lg border border-border flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    viewLayout === 'scroll' ? 'text-primary bg-primary/10' : 'text-muted hover:text-foreground hover:bg-surface-hover/80 bg-surface'
                  } disabled:opacity-30`}
                  title={viewLayout === 'scroll' ? 'โหมดเลื่อนอ่าน' : 'โหมดทีละหน้า'}
                >
                  {viewLayout === 'scroll' ? <GalleryVertical className="w-4 h-4" aria-hidden="true" /> : <RectangleHorizontal className="w-4 h-4" aria-hidden="true" />}
                </button>

                {/* Advanced Tools dropdown */}
                <WorkspaceAdvancedTools
                  canClean={Boolean(currentPageUrl)}
                  canEditMask={Boolean(currentCleaningResult)}
                  busy={operationBusy}
                  batchFailureCount={batchFailures.length}
                  onClean={() => void handleCleanCurrentPage()}
                  onEditMask={() => setIsMaskEditorOpen(true)}
                  onTranslateBook={() => void handleTranslateBook()}
                  onRetryFailedPages={() => void retryFailedPages()}
                  triggerRef={advancedToolsTriggerRef}
                />

                {/* Settings button (always accessible in desktop header) */}
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                  aria-label="เปิดหน้าต่างตั้งค่า"
                  className={`h-8.5 w-8.5 rounded-lg border flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    isSettingsOpen
                      ? 'text-primary bg-primary/10 border-primary/30'
                      : 'text-muted hover:text-foreground hover:bg-surface-hover/80 bg-surface border-border'
                  }`}
                  title="ตั้งค่า API, ฟอนต์, คำศัพท์"
                >
                  <Settings className="w-4 h-4" aria-hidden="true" />
                </button>

                {/* Keyboard shortcuts helper button */}
                <button
                  type="button"
                  onClick={() => setIsShortcutsOpen(true)}
                  aria-label="ดูปุ่มลัดคีย์บอร์ด (?)"
                  className="h-8.5 w-8.5 rounded-lg border border-border flex items-center justify-center text-muted hover:text-foreground hover:bg-surface-hover/80 bg-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary text-xs font-semibold"
                  title="ปุ่มลัดคีย์บอร์ด (?)"
                >
                  ?
                </button>
              </div>

              {/* ── Primary Action Buttons ── */}
              <div className="flex items-center gap-2">
                <WorkspacePrimaryAction
                  state={primaryAction}
                  onAction={() => void handlePrimaryAction()}
                  onCancel={cancelTranslateAll}
                />

                {/* ── Export Menu Dropdown ── */}
                <WorkspaceExportMenu
                  triggerRef={exportTriggerRef}
                  disabled={pages.length === 0}
                  disabledKinds={{
                    image: activeBubbles.length === 0 || workspaceLayer !== "translated",
                    pdf: isZipping || pages.length === 0,
                    strip: isZipping || pages.length === 0,
                    zip: isZipping || pages.length === 0,
                    cbz: isZipping || pages.length === 0,
                  }}
                  onExport={(kind) => {
                    if (kind === "image") {
                      void saveCurrentPageImage();
                    } else {
                      handleDownloadAll(kind);
                    }
                  }}
                />

                {/* Send Back to Reading View (if page came from extension) */}
                {pages[currentPage]?.originUrl && (
                  <button
                    type="button"
                    onClick={() => void handlePublishBackToReadingView()}
                    disabled={isPublishingBack}
                    aria-label="ส่งคำแปลกลับไปยังหน้าอ่านบนเว็บ"
                    className="h-8.5 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                    title={`ส่งคำแปลกลับไปยัง ${pages[currentPage]?.originUrl}`}
                  >
                    {isPublishingBack ? (
                      <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <span>🚀 ส่งกลับหน้าอ่าน</span>
                    )}
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {/* Mobile Header Controls */}
        <div className="flex md:hidden items-center gap-2">
          {pages[currentPage]?.originUrl && (
            <button
              type="button"
              onClick={() => void handlePublishBackToReadingView()}
              disabled={isPublishingBack}
              aria-label="ส่งคำแปลกลับไปยังหน้าอ่านบนเว็บ"
              className="h-8.5 px-2.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm disabled:opacity-50 cursor-pointer"
              title="ส่งกลับหน้าอ่าน"
            >
              {isPublishingBack ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <span>🚀 ส่งกลับ</span>
              )}
            </button>
          )}
          {pages.length > 0 && (
            <WorkspacePrimaryAction
              state={primaryAction}
              onAction={() => void handlePrimaryAction()}
              onCancel={cancelTranslateAll}
            />
          )}
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-expanded={isMobileMenuOpen}
            aria-label={isMobileMenuOpen ? "ปิดเมนู" : "เปิดเมนู"}
            className={`p-1.5 rounded-md transition-colors ${isMobileMenuOpen ? 'bg-surface text-foreground' : 'text-muted hover:text-foreground hover:bg-surface'}`}
          >
            {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Mobile Dropdown Menu with Backdrop */}
        {isMobileMenuOpen && (
          <>
            <div
              className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 md:hidden animate-in fade-in duration-200"
              onClick={() => setIsMobileMenuOpen(false)}
            />
            <div className="absolute top-[60px] right-3 left-3 sm:right-6 sm:w-80 sm:left-auto bg-background border border-surface shadow-2xl rounded-xl p-3.5 z-50 md:hidden flex flex-col gap-3 max-h-[calc(100vh-80px)] overflow-y-auto animate-in fade-in slide-in-from-top-2 duration-200">

            {/* ── Section: 🔤 การแปล ── */}
            <div>
              <div className="text-[10px] font-bold text-muted uppercase tracking-wider px-1 mb-1.5 flex items-center gap-1.5">🔤 การแปล</div>
              {isTranslatingAll ? (
                <div className="flex flex-col gap-2 p-2.5 bg-primary/5 rounded-lg border border-primary/15">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-primary font-semibold flex items-center gap-1.5">
                      <span className="animate-spin h-3 w-3 border-2 border-primary border-t-transparent rounded-full"></span>
                      {translateAllProgress?.message ?? 'กำลังเตรียม...'}
                    </span>
                    {translateAllProgress && (
                      <span className="text-muted font-bold">
                        {Math.round((translateAllProgress.current / translateAllProgress.total) * 100)}%
                      </span>
                    )}
                  </div>
                  <div className="w-full h-2 bg-surface rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-primary to-primary/60 rounded-full transition-all duration-500 ease-out"
                      style={{ width: translateAllProgress ? `${(translateAllProgress.current / translateAllProgress.total) * 100}%` : '0%' }}
                    />
                  </div>
                  {translateAllProgress?.secondaryMessage && (
                    <span className="text-[10px] text-primary/80">
                      {translateAllProgress.secondaryMessage}
                    </span>
                  )}
                  {translateAllProgress?.estimating ? (
                    <span className="text-[10px] text-muted">กำลังประเมินเวลาที่เหลือ...</span>
                  ) : translateAllProgress && typeof translateAllProgress.remainingSeconds === 'number' ? (
                    <span className="text-[10px] text-muted">
                      {translateAllProgress.remainingSeconds < 60
                        ? `เหลืออีก ~${Math.ceil(translateAllProgress.remainingSeconds)} วินาที`
                        : `เหลืออีก ~${Math.ceil(translateAllProgress.remainingSeconds / 60)} นาที`}
                    </span>
                  ) : null}
                  <button
                    onClick={cancelTranslateAll}
                    className="w-full bg-red-500/15 text-red-400 hover:bg-red-500/25 px-4 py-2 rounded-md text-sm font-semibold flex justify-center items-center gap-2 transition-all"
                  >
                    ⏹ หยุดแปล
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { void handleTranslateBook(); setIsMobileMenuOpen(false); }}
                  disabled={operationBusy || pages.length === 0}
                  className="w-full bg-gradient-to-r from-primary/20 to-primary/10 text-primary hover:from-primary/30 hover:to-primary/20 disabled:opacity-50 px-4 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-150 border border-primary/20"
                >
                  <Sparkles className="w-5 h-5" />
                  <span>✨ แปลทั้งเล่ม</span>
                </button>
              )}
            </div>

            {/* ── Section: 👁️ การแสดงผล ── */}
            <div>
              <div className="text-[10px] font-bold text-muted uppercase tracking-wider px-1 mb-1.5 flex items-center gap-1.5">👁️ การแสดงผล</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => { setViewLayout(prev => prev === 'single' ? 'scroll' : 'single'); setIsMobileMenuOpen(false); }}
                  disabled={pages.length === 0}
                  className={`p-2.5 rounded-lg text-xs font-medium flex flex-col items-center justify-center gap-1.5 transition-all duration-150 border ${viewLayout === 'scroll' ? 'text-primary bg-primary/10 border-primary/20' : 'bg-surface text-foreground border-transparent'}`}
                >
                  {viewLayout === 'scroll' ? <GalleryVertical className="w-5 h-5" /> : <RectangleHorizontal className="w-5 h-5" />}
                  <span>{viewLayout === 'scroll' ? 'เลื่อนอ่าน' : 'ทีละหน้า'}</span>
                </button>

                <button
                  onClick={() => { toggleOriginalTranslated(); setIsMobileMenuOpen(false); }}
                  disabled={!hasCurrentTranslation}
                  className={`p-2.5 rounded-lg text-xs font-medium flex flex-col items-center justify-center gap-1.5 transition-all duration-150 border ${workspaceLayer === "original" ? 'bg-surface text-foreground border-transparent' : 'text-primary bg-primary/10 border-primary/20'}`}
                >
                  {workspaceLayer === "original" ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
                  <span>{workspaceLayer === "original" ? 'แสดงคำแปล' : 'ดูต้นฉบับ'}</span>
                </button>
              </div>
            </div>

            {/* ── Section: ⚙️ ตั้งค่า ── */}
            <div>
              <div className="text-[10px] font-bold text-muted uppercase tracking-wider px-1 mb-1.5 flex items-center gap-1.5">⚙️ ตั้งค่า</div>
              <div className="flex flex-col gap-1.5">
                <button
                  onClick={() => { setNsfwBypassMode(!nsfwBypassMode); setIsMobileMenuOpen(false); }}
                  className={`w-full p-2.5 rounded-lg text-sm font-medium flex items-center gap-3 transition-all duration-150 border ${nsfwBypassMode ? 'text-red-400 bg-red-500/10 border-red-500/20 shadow-[0_0_10px_rgba(239,68,68,0.1)]' : 'bg-surface text-foreground border-transparent'}`}
                >
                  <Flame className="w-5 h-5" />
                  <span>18+ Bypass Mode</span>
                  {nsfwBypassMode && <span className="ml-auto text-[10px] font-bold bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">ON</span>}
                </button>

                <button
                  onClick={() => { setIsSettingsOpen(true); setIsMobileMenuOpen(false); }}
                  className="w-full bg-surface text-foreground p-2.5 rounded-lg text-sm font-medium flex items-center gap-3 border border-transparent"
                >
                  <Settings className="w-5 h-5" />
                  <span>API Key & ฟอนต์</span>
                </button>
              </div>
            </div>

            {/* ── Section: ↩️ ย้อนกลับ ── */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  const label = undoManager.undo();
                  if (label) import('react-hot-toast').then(m => m.default(`↩️ Undo: ${label}`, { duration: 1500 }));
                }}
                disabled={!canUndo}
                className="bg-surface text-foreground disabled:opacity-25 p-2.5 rounded-lg text-sm font-medium flex justify-center items-center gap-2 border border-transparent"
              >
                <Undo2 className="w-5 h-5" /> ย้อนกลับ
              </button>
              <button
                onClick={() => {
                  const label = undoManager.redo();
                  if (label) import('react-hot-toast').then(m => m.default(`↪️ Redo: ${label}`, { duration: 1500 }));
                }}
                disabled={!canRedo}
                className="bg-surface text-foreground disabled:opacity-25 p-2.5 rounded-lg text-sm font-medium flex justify-center items-center gap-2 border border-transparent"
              >
                <Redo2 className="w-5 h-5" /> ทำซ้ำ
              </button>
            </div>

            {/* ── Section: 📥 ดาวน์โหลด ── */}
            <div className="bg-surface/50 p-2.5 rounded-lg border border-surface-hover">
              <div className="text-[10px] font-bold text-muted uppercase tracking-wider px-1 mb-2 flex items-center gap-1.5">📥 ดาวน์โหลด</div>
              <button
                onClick={() => {
                  void saveCurrentPageImage();
                  setIsMobileMenuOpen(false);
                }}
                disabled={activeBubbles.length === 0 || workspaceLayer !== "translated"}
                className="w-full bg-surface text-foreground disabled:opacity-40 p-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 mb-2 border border-transparent"
              >
                <Download className="w-5 h-5" /> บันทึกหน้านี้
              </button>
              <div className="grid grid-cols-4 gap-2">
                <button
                  onClick={() => { handleDownloadAll("strip"); setIsMobileMenuOpen(false); }}
                  disabled={isZipping || pages.length === 0}
                  className="bg-surface text-foreground disabled:opacity-40 p-2 rounded-lg text-xs font-bold flex flex-col items-center justify-center gap-1 border border-transparent"
                >
                  {isZipping ? <span className="animate-spin h-4 w-4 border-2 border-foreground border-t-transparent rounded-full"></span> : <><GalleryVertical className="w-5 h-5 text-muted" /><span>Strip</span></>}
                </button>
                <button
                  onClick={() => { handleDownloadAll("zip"); setIsMobileMenuOpen(false); }}
                  disabled={isZipping || pages.length === 0}
                  className="bg-surface text-foreground disabled:opacity-40 p-2 rounded-lg text-xs font-bold flex flex-col items-center justify-center gap-1 border border-transparent"
                >
                  {isZipping ? <span className="animate-spin h-4 w-4 border-2 border-foreground border-t-transparent rounded-full"></span> : <><FileArchive className="w-5 h-5 text-muted" /><span>ZIP</span></>}
                </button>
                <button
                  onClick={() => { handleDownloadAll("cbz"); setIsMobileMenuOpen(false); }}
                  disabled={isZipping || pages.length === 0}
                  className="bg-surface text-foreground disabled:opacity-40 p-2 rounded-lg text-xs font-bold flex flex-col items-center justify-center gap-1 border border-transparent"
                >
                  {isZipping ? <span className="animate-spin h-4 w-4 border-2 border-foreground border-t-transparent rounded-full"></span> : <><BookOpen className="w-5 h-5 text-muted" /><span>CBZ</span></>}
                </button>
                <button
                  onClick={() => { handleDownloadAll("pdf"); setIsMobileMenuOpen(false); }}
                  disabled={isZipping || pages.length === 0}
                  className="bg-surface text-foreground disabled:opacity-40 p-2 rounded-lg text-xs font-bold flex flex-col items-center justify-center gap-1 border border-transparent"
                >
                  {isZipping ? <span className="animate-spin h-4 w-4 border-2 border-foreground border-t-transparent rounded-full"></span> : <><FileText className="w-5 h-5 text-muted" /><span>PDF</span></>}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </header>

      {/* Main Workspace */}
      <main
        className={`w-full flex flex-col items-center overflow-hidden transition-all duration-300 ${
          isFocusMode
            ? "h-[100dvh] mt-0"
            : pages.length > 0
              ? "h-[calc(100dvh-3.5rem)] mt-14"
              : "flex-1 min-h-[calc(100dvh-3.5rem)] mt-14"
        } ${isDragging ? "opacity-50" : "opacity-100"}`}
      >
        {isFocusMode && (
          <div className="fixed top-3 right-3 z-40 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsFocusToolbarVisible((prev) => !prev)}
              aria-label={isFocusToolbarVisible ? "ซ่อนแถบเครื่องมือคลีน (B)" : "แสดงแถบเครื่องมือคลีน (B)"}
              className="bg-surface/90 hover:bg-surface text-foreground/80 hover:text-foreground text-xs px-3 py-1.5 rounded-full border border-border/80 shadow-lg backdrop-blur-md transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer"
              title={isFocusToolbarVisible ? "ซ่อนแถบบน (B)" : "แสดงแถบบน (B)"}
            >
              {isFocusToolbarVisible ? (
                <EyeOff className="w-3.5 h-3.5 text-primary" />
              ) : (
                <Eye className="w-3.5 h-3.5 text-muted" />
              )}
              <span>{isFocusToolbarVisible ? "ซ่อนแถบบน" : "แสดงแถบบน"}</span>
              <kbd className="px-1.5 py-0.5 text-[10px] font-semibold bg-background/80 rounded border border-border/60 text-muted">
                B
              </kbd>
            </button>
            <button
              type="button"
              onClick={() => setIsFocusMode(false)}
              aria-label="ออกจากโหมดโฟกัส (Esc หรือ F)"
              className="bg-surface/90 hover:bg-surface text-foreground/80 hover:text-foreground text-xs px-3 py-1.5 rounded-full border border-border/80 shadow-lg backdrop-blur-md transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer"
              title="Exit Focus Mode (Esc / F)"
            >
              <span>ออกจากโหมดโฟกัส</span>
              <kbd className="px-1.5 py-0.5 text-[10px] font-semibold bg-background/80 rounded border border-border/60 text-muted">
                Esc
              </kbd>
            </button>
          </div>
        )}

        {workflowMessage && (!isFocusMode || !isFocusToolbarVisible) && (
          <div
            onClick={() => {
              if (translationResult) {
                setTranslationResult(null);
              }
            }}
            role="status"
            aria-live="polite"
            className={`fixed left-1/2 -translate-x-1/2 z-40 bg-surface/90 backdrop-blur-md border border-primary/30 text-foreground px-4 py-1.5 rounded-full text-xs font-semibold shadow-lg animate-in fade-in slide-in-from-top-2 duration-300 flex items-center gap-2 max-w-[90vw] truncate transition-all cursor-pointer hover:bg-surface select-none ${
              isFocusMode
                ? "top-3"
                : toolbarPosition === "top"
                  ? isToolbarCollapsed ? "top-20 sm:top-22" : "top-24 sm:top-26"
                  : "top-16"
            }`}
            title="คลิกเพื่อปิดการแจ้งเตือน"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" />
            <span className="truncate">{workflowMessage}</span>
            {translationResult && (
              <span className="ml-1 text-muted hover:text-foreground text-xs leading-none">&times;</span>
            )}
          </div>
        )}

        {pages.length > 0 ? (
          <div
            className={`w-full flex-1 min-h-0 flex flex-col items-center relative overflow-hidden transition-all duration-200 ${
              isFocusMode
                ? "p-0"
                : isThumbnailsCollapsed
                  ? "px-1 pb-7"
                  : "px-1 pb-20 sm:pb-22"
            }`}
          >
            {/* Cleaning Toolbar: Floating at top or bottom with collapse support */}
            <div
              className={`w-full absolute ${
                toolbarPosition === "top"
                  ? "top-2.5"
                  : isFocusMode
                    ? "bottom-3 sm:bottom-4"
                    : isThumbnailsCollapsed
                      ? "bottom-9 sm:bottom-10"
                      : "bottom-23 sm:bottom-25"
              } left-1/2 -translate-x-1/2 z-30 flex justify-center pointer-events-none px-2 transition-all duration-300 ease-out ${
                isFocusMode && !isFocusToolbarVisible
                  ? `${toolbarPosition === "top" ? "-translate-y-24" : "translate-y-24"} opacity-0 pointer-events-none max-h-0 py-0 overflow-hidden`
                  : "translate-y-0 opacity-100 py-0"
              }`}
            >
              <div
                className={`pointer-events-auto max-w-full flex ${
                  toolbarPosition === "bottom" ? "flex-col-reverse" : "flex-col"
                } items-center gap-1.5`}
              >
                {isToolbarCollapsed ? (
                  <div
                    className="flex items-center gap-1.5 rounded-full border border-border/80 bg-surface/90 px-3 py-1.5 shadow-xl backdrop-blur-md transition-all hover:bg-surface"
                    role="region"
                    aria-label="แถบเครื่องมือแบบย่อ"
                  >
                    <button
                      type="button"
                      onClick={toggleToolbarCollapsed}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground hover:text-primary transition-colors cursor-pointer"
                      title="ขยายแถบเครื่องมือ (กด B)"
                      aria-label="ขยายแถบเครื่องมือ (กด B)"
                    >
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-primary">
                        <Eraser className="h-3 w-3" />
                      </span>
                      <span className="font-semibold text-xs capitalize text-foreground">
                        {workspaceLayer}
                      </span>
                      {toolbarPosition === "top" ? (
                        <ChevronDown className="h-3.5 w-3.5 text-muted" />
                      ) : (
                        <ChevronUp className="h-3.5 w-3.5 text-muted" />
                      )}
                    </button>

                    {currentPageUrl &&
                      !confirmedPages.has(currentPageUrl) &&
                      doesPageRequireReview(
                        cleaningResultsByPage.get(currentPageUrl),
                        activeBubbles,
                      ) && (
                        <button
                          type="button"
                          onClick={toggleToolbarCollapsed}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-500 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full hover:bg-amber-500/20 transition-colors cursor-pointer"
                          title="หน้านี้ต้องการการตรวจทาน (คลิกเพื่อดู)"
                        >
                          <span>⚠️ ตรวจทาน</span>
                        </button>
                      )}

                    {batchFailures.length > 0 && (
                      <button
                        type="button"
                        onClick={toggleToolbarCollapsed}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-red-400 bg-red-500/10 border border-red-500/30 px-2 py-0.5 rounded-full hover:bg-red-500/20 transition-colors cursor-pointer"
                        title={`แปลไม่สำเร็จ ${batchFailures.length} หน้า (คลิกเพื่อดู)`}
                      >
                        <span>❌ {batchFailures.length}</span>
                      </button>
                    )}

                    <div className="h-3.5 w-px bg-border/60 mx-0.5" />

                    <button
                      type="button"
                      onClick={toggleToolbarPosition}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted hover:text-foreground hover:bg-surface-hover transition-colors cursor-pointer"
                      title={
                        toolbarPosition === "top"
                          ? "ย้ายแถบไปด้านล่าง"
                          : "ย้ายแถบไปด้านบน"
                      }
                      aria-label={
                        toolbarPosition === "top"
                          ? "ย้ายแถบไปด้านล่าง"
                          : "ย้ายแถบไปด้านบน"
                      }
                    >
                      {toolbarPosition === "top" ? (
                        <ArrowDown className="h-3 w-3" />
                      ) : (
                        <ArrowUp className="h-3 w-3" />
                      )}
                    </button>

                    <kbd className="hidden sm:inline-flex px-1.5 py-0.5 text-[10px] font-semibold bg-background/80 rounded border border-border/60 text-muted">
                      B
                    </kbd>
                  </div>
                ) : (
                  <>
                    <CleaningToolbar
                      hasPage={pages.length > 0 && !operationBusy}
                      hasResult={Boolean(currentCleaningResult)}
                      hasTranslated={hasCurrentTranslation}
                      layer={workspaceLayer}
                      onClean={() => void handleCleanCurrentPage()}
                      onEditMask={() => setIsMaskEditorOpen(true)}
                      onLayerChange={setWorkspaceLayer}
                      progress={cleaningProgress}
                      error={cleaningError}
                      position={toolbarPosition}
                      onTogglePosition={toggleToolbarPosition}
                      onCollapse={toggleToolbarCollapsed}
                      className="flex w-full max-w-4xl flex-wrap items-center justify-between gap-2 rounded-xl border border-border/80 bg-surface/90 px-3 py-1.5 shadow-xl backdrop-blur-md transition-all"
                    />
                    {currentPageUrl &&
                      !confirmedPages.has(currentPageUrl) &&
                      doesPageRequireReview(
                        cleaningResultsByPage.get(currentPageUrl),
                        activeBubbles,
                      ) && (
                        <div className="w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-xs backdrop-blur-md shadow-md animate-in fade-in">
                          <span className="flex items-center gap-1.5 text-amber-500 font-medium">
                            ⚠️ หน้านี้มีจุดคลีนหรือคำแปลที่ต้องการการตรวจทาน
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setConfirmedPages((prev) =>
                                  new Set(prev).add(currentPageUrl),
                                )
                              }
                              className="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold transition-colors cursor-pointer"
                            >
                              ยืนยันหน้านี้
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setConfirmedPages((prev) =>
                                  new Set(prev).add(currentPageUrl),
                                )
                              }
                              className="text-muted hover:text-foreground p-1 rounded transition-colors cursor-pointer text-xs"
                              title="ปิดการแจ้งเตือน"
                              aria-label="ปิดการแจ้งเตือน"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      )}
                    {batchFailures.length > 0 && (
                      <div className="w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg border border-red-500/40 bg-red-500/15 text-xs backdrop-blur-md shadow-md animate-in fade-in">
                        <div className="flex items-center gap-2">
                          <span className="text-red-400 font-semibold">
                            ❌ แปลไม่สำเร็จ {batchFailures.length} หน้า
                          </span>
                          <span className="text-muted text-[11px] hidden sm:inline">
                            (หน้า{" "}
                            {batchFailures
                              .map((f) => f.pageIndex + 1)
                              .join(", ")}
                            )
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setIsDiagnosticModalOpen(true)}
                            className="px-2.5 py-1 rounded bg-red-600 hover:bg-red-500 text-white font-medium text-xs transition-colors cursor-pointer shadow-sm"
                          >
                            ดูสาเหตุและแก้ไข
                          </button>
                          <button
                            type="button"
                            onClick={() => retryFailedPages()}
                            className="px-2 py-1 rounded bg-surface-hover hover:bg-surface-active text-foreground text-xs transition-colors cursor-pointer border border-surface-hover"
                          >
                            ลองใหม่
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* PageViewer in full flex container */}
            <div className="flex-1 min-h-0 w-full h-full relative flex justify-center items-center overflow-hidden">
              <PageViewer
                pages={pages}
                currentPage={currentPage}
                viewLayout={viewLayout}
                workspaceLayer={workspaceLayer}
                currentCleaningResult={currentCleaningResult}
                cleaningResultsByPage={cleaningResultsByPage}
                translatedImagesMap={translatedImagesMap}
                brokenPages={brokenPages}
                isFocusMode={isFocusMode}
                onToggleFocusMode={() => setIsFocusMode((prev) => !prev)}
                onPageChange={(updater) => {
                  setCurrentPage((prev) => {
                    const next = typeof updater === "function" ? updater(prev) : updater;
                    if (pages.length === 0) return 0;
                    return Math.max(0, Math.min(pages.length - 1, next));
                  });
                }}
                onViewLayoutChange={setViewLayout}
                onRemovePage={(idx) => {
                  setPages((prev) => {
                    const newPages = prev.filter((_, i) => i !== idx);
                    if (newPages.length === 0) setCurrentPage(0);
                    else if (currentPage >= newPages.length) setCurrentPage(newPages.length - 1);
                    return newPages;
                  });
                  import("react-hot-toast").then((m) => m.default("ลบรูปพังออกแล้ว", { duration: 1500 }));
                }}
                onImageError={(url) => {
                  setBrokenPages((prev) => new Set(prev).add(url));
                }}
              />
            </div>

            {/* Hidden container for offscreen rendering */}
            <div id="offscreen-container" className="fixed top-0 left-0 w-full max-w-4xl opacity-0 pointer-events-none -z-50" style={{ visibility: 'hidden' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img id="offscreen-image" alt="offscreen" className="max-w-full h-auto" crossOrigin="anonymous" />
            </div>

            {isDragging && (
              <div className="fixed inset-0 z-50 bg-background/80 flex items-center justify-center">
                <div className="text-xl text-primary font-medium flex items-center gap-3">
                  <Upload className="w-6 h-6" /> Drop images to add
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center w-full max-w-2xl px-4 gap-4">
            {savedSessionData && (
              <div className="w-full bg-primary/10 border border-primary/30 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="flex items-center gap-3">
                  <div className="text-2xl">💾</div>
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">พบงานแปลค้างไว้ล่าสุด ({savedSessionData.pages.length} หน้า)</h4>
                    <p className="text-xs text-muted">ระบบจำสถานะคำแปลและรูปภาพเดิมไว้ สามารถดึงกลับมาทำต่อได้ทันที</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={async () => {
                      const restored = await restoreSavedSession();
                      if (restored && restored.pages.length > 0) {
                        setPages(restored.pages);
                        setCurrentPage(restored.currentPage || 0);
                        setSavedSessionData(null);
                      }
                      import('react-hot-toast').then(m => m.default("ดึงค่างานเดิมกลับมาเรียบร้อย!", { duration: 2000 }));
                    }}
                    className="bg-primary text-primary-content hover:bg-primary-hover px-3.5 py-1.5 rounded-md text-xs font-semibold shadow-sm transition-colors cursor-pointer"
                  >
                    📂 คืนค่างานเดิม
                  </button>
                  <button
                    onClick={() => {
                      clearSavedSession();
                      setSavedSessionData(null);
                      import('react-hot-toast').then(m => m.default("ล้างเซสชันเก่าแล้ว", { duration: 1500 }));
                    }}
                    className="bg-surface hover:bg-surface-hover text-muted hover:text-foreground border border-surface-hover px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer"
                  >
                    ล้างแล้วเริ่มใหม่
                  </button>
                </div>
              </div>
            )}

            <div className={`w-full aspect-video rounded-xl border border-dashed flex flex-col items-center justify-center transition-colors duration-200 ${isDragging ? 'border-primary bg-primary/5' : 'border-surface-hover hover:border-muted'}`}>
              {isImporting ? (
                <div className="flex flex-col items-center justify-center p-6 gap-3 animate-in fade-in duration-150">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  <p className="text-foreground text-base font-medium">{importStatusMessage || "กำลังนำเข้าไฟล์..."}</p>
                  <p className="text-muted text-xs">กรุณารอสักครู่ ระบบกำลังประมวลผลหน้ามังงะ</p>
                </div>
              ) : (
                <>
                  <Upload className={`w-8 h-8 mb-4 ${isDragging ? 'text-primary' : 'text-muted'}`} />
                  <p className="text-foreground text-lg mb-1 font-medium">Drag & Drop manga pages</p>
                  <p className="text-muted text-sm mb-6">Support for Images, ZIP, CBZ, and PDF</p>

                  <label
                    htmlFor="file-upload-input"
                    className="bg-surface hover:bg-surface-hover text-foreground px-6 py-2 rounded-md text-sm font-medium cursor-pointer transition-colors duration-150 border border-surface-hover focus-within:ring-2 focus-within:ring-primary focus-within:outline-none inline-flex items-center gap-2"
                  >
                    <span>เลือกไฟล์มังงะ (Browse Files)</span>
                    <input
                      id="file-upload-input"
                      type="file"
                      multiple
                      accept="image/*,.zip,.cbz,.pdf"
                      className="sr-only"
                      tabIndex={0}
                      disabled={isImporting}
                      onChange={handleImageUpload}
                    />
                  </label>
                </>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Bottom Thumbnail Strip */}
      <PageFilmstrip
        pages={pages}
        currentPage={currentPage}
        onSelectPage={setCurrentPage}
        onDeletePage={(i) => {
          setPages((prev) => {
            const newPages = prev.filter((_, idx) => idx !== i);
            if (newPages.length === 0) setCurrentPage(0);
            else if (currentPage >= newPages.length) setCurrentPage(newPages.length - 1);
            else if (currentPage > i) setCurrentPage(currentPage - 1);
            return newPages;
          });
        }}
        onReorderPages={setPages}
        onAddImages={handleImageUpload}
        onClearAll={() => {
          setPages([]);
          setCurrentPage(0);
          clearSavedSession();
        }}
        isCollapsed={isThumbnailsCollapsed}
        onToggleCollapse={() => setIsThumbnailsCollapsed(!isThumbnailsCollapsed)}
        isFocusMode={isFocusMode}
      />
      {isMaskEditorOpen && currentCleaningResult && pages[currentPage] && (
        <MaskEditor
          sourceUrl={currentCleaningResult.cleanUrl}
          maskUrl={currentCleaningResult.maskUrl}
          regions={currentCleaningResult.regions}
          onClose={() => setIsMaskEditorOpen(false)}
          onRetry={handleRetryRegion}
        />
      )}

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        sourceLang={sourceLang}
        onSourceLangChange={setSourceLang}
        textStyle={textStyle}
        onTextStyleChange={setTextStyle}
        modelPreference={modelPreference}
        onModelPreferenceChange={setModelPreference}
        userApiKey={userApiKey}
        onUserApiKeyChange={setUserApiKey}
        focusApiKey={settingsFocusTarget === "apiKey"}
        onValidateApiKey={validateRecoveryApiKey}
        onApiKeyValidated={() => {
          if (apiKeyRecoveryGroupId) {
            setApiKeyReadyByGroup((previous) => ({
              ...previous,
              [apiKeyRecoveryGroupId]: true,
            }));
          }
          setSettingsFocusTarget(null);
        }}
        glossary={glossary}
        onGlossaryChange={setGlossary}
        nsfwBypassMode={nsfwBypassMode}
        onNsfwBypassModeChange={setNsfwBypassMode}
      />

      <FindReplaceDialog
        isOpen={isFindReplaceOpen}
        onClose={() => setIsFindReplaceOpen(false)}
        onReplace={handleFindReplace}
      />

      <KeyboardShortcutsDialog
        isOpen={isShortcutsOpen}
        onClose={() => setIsShortcutsOpen(false)}
      />

      {/* ── Human Review Confirmation Gate Modal (Ticket 07) ── */}
      {unconfirmedReviewPages && unconfirmedReviewPages.length > 0 && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-surface border border-border shadow-2xl rounded-2xl max-w-lg w-full p-5 flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-amber-500/15 text-amber-500 text-xl flex-shrink-0">
                ⚠️
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold text-foreground">
                  มีหน้าที่ต้องได้รับการยืนยันก่อน Export
                </h3>
                <p className="text-xs text-muted mt-1 leading-relaxed">
                  พบหน้าที่การคลีนหรือการแปลมีความมั่นใจต่ำ ต้องได้รับการตรวจสอบและยืนยันโดยผู้ใช้งานก่อนที่จะสามารถส่งออกไฟล์ได้
                </p>
              </div>
            </div>

            <div className="max-h-60 overflow-y-auto border border-border/60 rounded-xl divide-y divide-border/40 bg-background/50">
              {unconfirmedReviewPages.map((p) => (
                <div key={p.pageUrl} className="flex items-center justify-between p-3 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold text-foreground">
                      หน้า {p.pageIndex + 1}
                    </span>
                    <span className="text-muted truncate max-w-[150px]">
                      ({p.pageName})
                    </span>
                    <div className="flex items-center gap-1">
                      {p.hasUncertainCleaning && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500 text-[10px] font-medium">
                          การคลีนไม่แน่นอน
                        </span>
                      )}
                      {p.hasUncertainTranslation && (
                        <span className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-500 text-[10px] font-medium">
                          การแปลความมั่นใจต่ำ
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setCurrentPage(p.pageIndex);
                      setUnconfirmedReviewPages(null);
                      setPendingExportAction(null);
                    }}
                    className="px-2 py-1 rounded border border-border hover:bg-surface text-[11px] font-medium transition-colors cursor-pointer"
                  >
                    ไปที่หน้านี้
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-border/50">
              <button
                type="button"
                onClick={() => {
                  setUnconfirmedReviewPages(null);
                  setPendingExportAction(null);
                }}
                className="px-4 py-2 rounded-xl border border-border hover:bg-surface text-xs font-semibold text-muted hover:text-foreground transition-colors cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmedPages((prev) => {
                    const next = new Set(prev);
                    unconfirmedReviewPages.forEach((p) => next.add(p.pageUrl));
                    return next;
                  });
                  const action = pendingExportAction;
                  setUnconfirmedReviewPages(null);
                  setPendingExportAction(null);
                  action?.();
                }}
                className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-primary-content text-xs font-semibold shadow-md transition-colors cursor-pointer"
              >
                ยืนยันทุกหน้าและดำเนินการ Export
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Diagnostic Taxonomy Modal for Batch Failures */}
      <TranslationDiagnosticModal
        isOpen={isDiagnosticModalOpen}
        onClose={() => setIsDiagnosticModalOpen(false)}
        failureGroups={diagnosticFailureGroups}
        onRetryFailureGroup={(failureGroupId) => retryFailureGroup(failureGroupId)}
        onEnableNsfwBypassAndRetry={(failureGroupId) => {
          setNsfwBypassMode(true);
          return retryFailureGroup(failureGroupId, { forceNsfw: true });
        }}
        onOpenSettingsApiKey={(failureGroupId) => {
          setIsDiagnosticModalOpen(false);
          setApiKeyRecoveryGroupId(failureGroupId);
          setSettingsFocusTarget("apiKey");
          setIsSettingsOpen(true);
        }}
        onRecoverCleaner={handleRecoverCleaner}
        cleanerRecoveryByGroup={cleanerRecoveryByGroup}
        apiKeyReadyByGroup={apiKeyReadyByGroup}
      />
    </div>
  );
}
