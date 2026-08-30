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
import { Upload, Download, Flame, Eye, EyeOff, Undo2, Redo2, GalleryVertical, RectangleHorizontal, Menu, X, Settings, FileArchive, BookOpen, FileText, Sparkles } from "lucide-react";
import { undoManager } from "@/lib/undoManager";
import JSZip from "jszip";
import { useCleaning } from "@/hooks/useCleaning";
import {
  CleaningToolbar,
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
import { generateComicInfoXml } from "@/lib/export/exportManager";
import {
  FindReplaceDialog,
  type ReplaceOptions,
} from "@/components/editing/FindReplaceDialog";
import { KeyboardShortcutsDialog } from "@/components/editing/KeyboardShortcutsDialog";

export default function WorkspacePage() {

  const [pages, setPages] = useState<{url: string, name: string}[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
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
  const [isFindReplaceOpen, setIsFindReplaceOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const pageUrls = useMemo(() => pages.map(p => p.url), [pages]);
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
      await cleanCurrentPage(await response.blob());
      invalidatePageTranslation(page.url);
      setWorkspaceLayer("clean");
    } finally {
      uiOperationLockRef.current = false;
      setIsUiOperationBusy(false);
    }
  };

  const preparePageForTranslation = useCallback(
    async (pageUrl: string, pageIndex: number) => {
      const cachedResult = cleaningResultsByPage.get(pageUrl);
      if (cachedResult) {
        return {
          recognitionUrl: pageUrl,
          backgroundUrl: cachedResult.cleanUrl,
        };
      }

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
      };
    },
    [cleanPage, cleaningResultsByPage, pages],
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
    workflowPhase,
    batchFailures,
    retryFailedPages,
    invalidatePageTranslation,
    cacheRevision: translationCacheRevision,
  } = useTranslation({
    currentPage,
    pages: pageUrls,
    viewMode: "single",
    preparePageForTranslation,
  });

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
  const workflowMessage = translateAllProgress?.message ?? translationResult;

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
    if (page) {
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

  const [savedSessionData, setSavedSessionData] = useState<{ pages: { url: string, name: string }[], currentPage: number } | null>(null);

  // Check for saved IndexedDB session on mount
  useEffect(() => {
    restoreSavedSession().then(saved => {
      if (saved && saved.pages && saved.pages.length > 0) {
        setSavedSessionData({ pages: saved.pages, currentPage: saved.currentPage });
      }
    });
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
    let count = 0;

    const regex = new RegExp(
      find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      caseSensitive ? "g" : "gi",
    );

    const applyReplace = (b: TranslatedBubble) => {
      const text =
        typeof b.t === "string"
          ? b.t
          : typeof b.translated === "string"
            ? b.translated
            : "";
      if (text && regex.test(text)) {
        const newText = text.replace(regex, replace);
        b.t = newText;
        if (typeof b.translated === "string") b.translated = newText;
        count++;
        return true;
      }
      return false;
    };

    if (scope === "this-page") {
      setActiveBubbles((prev) => {
        return prev.map((b) => {
          const clone = { ...b };
          applyReplace(clone);
          return clone;
        });
      });
      const currentUrl = pages[currentPage]?.url;
      if (currentUrl) invalidatePageTranslation(currentUrl);
    } else {
      bubbleCacheRef.current.forEach((bubbles, pageUrl) => {
        let changed = false;
        bubbles.forEach((b) => {
          if (applyReplace(b)) changed = true;
        });
        if (changed) invalidatePageTranslation(pageUrl);
      });
      setActiveBubbles((prev) => {
        return prev.map((b) => {
          const clone = { ...b };
          applyReplace(clone);
          return clone;
        });
      });
    }

    import("react-hot-toast").then((m) =>
      m.default(`🔄 แทนที่ข้อความสำเร็จ ${count} จุด`, { duration: 2000 }),
    );
  };

  const handleDownloadAll = async (format: "zip" | "cbz" | "pdf" | "strip" = "zip") => {
    if (pages.length === 0) return;
    setIsZipping(true);

    const getExportDataUrl = async (pageUrl: string, index: number): Promise<string> => {
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
        return new Promise<string>((resolve) => {
          const offscreenContainer = document.getElementById("offscreen-container");
          const offscreenImg = document.getElementById("offscreen-image") as HTMLImageElement;

          if (!offscreenContainer || !offscreenImg) {
            resolve(pageUrl);
            return;
          }

          // Safety timeout (4 seconds) so export never hangs indefinitely
          const timeout = setTimeout(() => {
            console.warn(`Offscreen render timed out for page ${index + 1}`);
            resolve(pageUrl);
          }, 4000);

          offscreenContainer.querySelectorAll(".tl-overlay,.tl-canvas").forEach((el) => el.remove());

          offscreenImg.onload = () => {
            applyTranslationOverlay(
              bubbles,
              "offscreen",
              -1,
              () => {},
              (renderedUrl) => {
                clearTimeout(timeout);
                translatedImageCacheRef.current.set(pageUrl, renderedUrl);
                resolve(renderedUrl);
              },
              textStyleRef
            );
          };
          offscreenImg.onerror = () => {
            clearTimeout(timeout);
            resolve(pageUrl);
          };
          offscreenImg.src =
            cleaningResultsByPage.get(pageUrl)?.cleanUrl ?? pageUrl;
        });
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
            if (!dataUrl) continue;
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
          }
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

          const stripDataUrl = stripCanvas.toDataURL("image/jpeg", 0.92);
          const link = document.createElement("a");
          link.href = stripDataUrl;
          link.download = isMulti
            ? `SuperK_Webtoon_Strip_Part${String(index).padStart(2, '0')}.jpg`
            : `SuperK_Webtoon_LongStrip.jpg`;
          link.click();
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
            if (!dataUrl) continue;

            const img = new Image();
            img.src = dataUrl;
            await new Promise<void>((resolve) => {
              const timer = setTimeout(() => resolve(), 3000);
              img.onload = () => { clearTimeout(timer); resolve(); };
              img.onerror = () => { clearTimeout(timer); resolve(); };
            });

            if (!img.naturalWidth || !img.naturalHeight) {
              console.warn(`Skipping broken page ${i + 1} for PDF export`);
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

        if (addedCount > 0) {
          setTranslationResult(`⏳ กำลังบันทึก PDF...`);
          pdf.save("SuperK_Translations.pdf");
          setTranslationResult(`✅ ดาวน์โหลด PDF สำเร็จ! (${addedCount} หน้า)`);
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
        if (!dataUrl || !dataUrl.includes(",")) continue;
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

        setTranslationResult(`⏳ กำลังสร้างไฟล์ ${format.toUpperCase()}...`);
        const content = await zip.generateAsync({ type: "blob" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(content);
        link.download = format === "cbz" ? "SuperK_Translations.cbz" : "SuperK_Translations.zip";
        link.click();
        setTranslationResult(`✅ ดาวน์โหลด ${format.toUpperCase()} สำเร็จ! (${zipAddedCount} หน้า)`);
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

  const processFiles = async (files: File[]) => {
    // Natural sort: "page1, page2, page10" instead of "page1, page10, page2"
    const sorted = [...files].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );

    const newPages: {url: string, name: string}[] = [];
    for (const file of sorted) {
      if (file.type === "application/zip" || file.type === "application/x-zip-compressed" || file.name.toLowerCase().endsWith('.zip') || file.name.toLowerCase().endsWith('.cbz')) {
        try {
          const zip = new JSZip();
          const loadedZip = await zip.loadAsync(file);

          const zipFiles = Object.values(loadedZip.files).filter(f => !f.dir && f.name.match(/\.(jpg|jpeg|png|webp|gif)$/i));

          zipFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

          for (const zipFile of zipFiles) {
            const base64 = await zipFile.async("base64");
            const ext = zipFile.name.split('.').pop()?.toLowerCase();
            const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
            newPages.push({ url: `data:${mimeType};base64,${base64}`, name: zipFile.name });
          }
        } catch (e) {
          console.error("Failed to extract zip/cbz", e);
        }
      } else if (file.type === "application/pdf" || file.name.toLowerCase().endsWith('.pdf')) {
        try {
          const pdfjsLib = await import('pdfjs-dist');
          if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
          }
          const arrayBuffer = await file.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
          const numPages = pdf.numPages;

          for (let i = 1; i <= numPages; i++) {
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
        }
      } else if (file.type.startsWith("image/")) {
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
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    await processFiles(files);
    e.target.value = ''; // Reset input
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    await processFiles(files);
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
        <div className="fixed top-16 left-0 right-0 z-50">
          <div className="h-1 bg-surface w-full">
            <div
              className="h-full bg-primary transition-all duration-500 ease-out"
              style={{ width: `${(translateAllProgress.current / translateAllProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Header Panel */}
      <header className="w-full bg-background/95 backdrop-blur-md border-b border-border/80 h-14 flex justify-between items-center px-3 sm:px-5 z-50 fixed top-0 select-none">
        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          <h1 className="text-base font-semibold tracking-tight text-foreground flex items-center">
            <span className="flex items-center gap-0.5">
              Super<span className="text-primary font-bold">K</span>
            </span>
            <span className="text-muted text-xs font-normal hidden sm:inline-block pl-2.5 ml-2.5 border-l border-border/80 tracking-wide uppercase">
              Manga Translator
            </span>
          </h1>
        </div>

        {/* Simple Settings Modal with Backdrop */}
        {isSettingsOpen && (
          <>
            <div
              className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[90] animate-in fade-in duration-200"
              onClick={() => setIsSettingsOpen(false)}
              aria-hidden="true"
            />
            <div
              id="settings-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="settings-modal-title"
              className="fixed inset-x-4 top-16 sm:absolute sm:inset-auto sm:right-6 sm:top-14 w-auto sm:w-80 max-w-sm bg-surface/95 backdrop-blur-xl border border-border rounded-xl shadow-2xl p-4 z-[100] max-h-[85vh] overflow-y-auto mx-auto animate-in fade-in zoom-in-95 duration-200"
            >
              <div className="flex justify-between items-center mb-4">
                <h3 id="settings-modal-title" className="font-semibold text-foreground text-sm">Settings</h3>
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(false)}
                  aria-label="ปิดหน้าต่างตั้งค่า"
                  className="text-muted hover:text-foreground p-1.5 rounded-md hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Source Language (ภาษาต้นฉบับ)</label>
                  <select
                    value={sourceLang}
                    onChange={(e) => setSourceLang(e.target.value)}
                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary appearance-none"
                  >
                    <option value="auto">Auto Detect (ตรวจจับอัตโนมัติ)</option>
                    <option value="Japanese">🇯🇵 Japanese (ญี่ปุ่น)</option>
                    <option value="Korean">🇰🇷 Korean (เกาหลี)</option>
                    <option value="Chinese">🇨🇳 Chinese (จีน)</option>
                    <option value="English">🇬🇧 English (อังกฤษ)</option>
                  </select>
                </div>

                <div className="pt-2 border-t border-border">
                  <label className="block text-xs font-medium text-muted mb-2">Text Style (รูปแบบข้อความแปล)</label>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted">Font Family</span>
                      <select
                        value={textStyle.fontFamily}
                        onChange={(e) => setTextStyle({ ...textStyle, fontFamily: e.target.value })}
                        className="bg-background border border-border rounded px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary w-32"
                      >
                        <option value="Itim, cursive">Itim (การ์ตูน)</option>
                        <option value="Prompt, sans-serif">Prompt (อ่านง่าย)</option>
                        <option value="Kanit, sans-serif">Kanit (โมเดิร์น)</option>
                        <option value="Sarabun, sans-serif">Sarabun (ทางการ)</option>
                      </select>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted">Text Color</span>
                      <input
                        type="color"
                        value={textStyle.textColor}
                        onChange={(e) => setTextStyle({ ...textStyle, textColor: e.target.value })}
                        aria-label="เลือกสีข้อความ"
                        className="w-7 h-7 rounded cursor-pointer border-0 p-0 bg-transparent"
                      />
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted">Outline Color</span>
                      <input
                        type="color"
                        value={textStyle.textOutline}
                        onChange={(e) => setTextStyle({ ...textStyle, textOutline: e.target.value })}
                        aria-label="เลือกสีขอบข้อความ"
                        className="w-7 h-7 rounded cursor-pointer border-0 p-0 bg-transparent"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-muted">
                        <span>Font Size Multiplier</span>
                        <span className="font-semibold text-foreground">{textStyle.fontSizeMultiplier.toFixed(1)}x</span>
                      </div>
                      <input
                        type="range"
                        min="0.5" max="2.0" step="0.1"
                        value={textStyle.fontSizeMultiplier}
                        onChange={(e) => setTextStyle({ ...textStyle, fontSizeMultiplier: parseFloat(e.target.value) })}
                        aria-label="ปรับขนาดฟอนต์"
                        className="w-full accent-primary"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-border">
                  <label className="block text-xs font-medium text-muted mb-1">Model Preference</label>
                  <select
                    value={modelPreference}
                    onChange={(e) => setModelPreference(e.target.value)}
                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary appearance-none"
                  >
                    <option value="auto">Auto (สลับโมเดลอัตโนมัติเมื่อโควต้าเต็ม)</option>
                    <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash Lite (แนะนำ! โควต้าเหลือเพียบ 500 RPD)</option>
                    <option value="gemini-3.6-flash">Gemini 3.6 Flash</option>
                    <option value="gemini-3-flash">Gemini 3.0 Flash</option>
                    <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
                    <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite</option>
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                    <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash Lite</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Gemini API Key (Optional)</label>
                  <input
                    type="password"
                    value={userApiKey}
                    onChange={(e) => setUserApiKey(e.target.value)}
                    placeholder="AIzaSy..."
                    aria-label="Gemini API Key"
                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <p className="text-[11px] text-muted mt-1.5 leading-relaxed">
                    By default, the app uses a shared key with limits.
                    To avoid &quot;Quota exceeded&quot; errors (especially in 18+ mode), enter your free Gemini API key from <a href="https://aistudio.google.com/app/apikey" target="_blank" className="text-primary underline font-medium">Google AI Studio</a>.
                  </p>
                </div>

              </div>
            </div>
          </>
        )}

        {/* Desktop Menu */}
        <div className="hidden md:flex items-center gap-2.5 flex-nowrap">
          {pages.length === 0 ? (
            /* ── Empty State Header Controls: Clean & Minimal ── */
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setNsfwBypassMode(!nsfwBypassMode)}
                aria-label={nsfwBypassMode ? "ปิดโหมด 18+ หั่นภาพหลบเซนเซอร์" : "เปิดโหมด 18+ หั่นภาพหลบเซนเซอร์"}
                className={`h-8.5 px-3 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  nsfwBypassMode
                    ? 'text-red-400 bg-red-500/15 border-red-500/30 shadow-xs'
                    : 'text-foreground border-border hover:bg-surface-hover'
                }`}
                title="โหมด 18+ หั่นภาพหลบเซนเซอร์"
              >
                <Flame className="w-4 h-4 text-red-400" aria-hidden="true" />
                <span>โหมด 18+</span>
                {nsfwBypassMode && <span className="text-[9px] font-bold bg-red-500/20 text-red-400 px-1 py-0.2 rounded-full leading-none">ON</span>}
              </button>

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
                      const originalName = pages[currentPage]?.name || "page.png";
                      const extension = originalName.includes('.') ? originalName.split('.').pop() : 'png';
                      const baseName = originalName.includes('.') ? originalName.substring(0, originalName.lastIndexOf('.')) : originalName;
                      const filename = `SuperK_Page_${String(currentPage + 1).padStart(3, '0')}_${baseName}.${extension}`;
                      downloadTranslatedImage("single", currentPage, filename);
                    } else {
                      handleDownloadAll(kind);
                    }
                  }}
                />
              </div>
            </>
          )}
        </div>

        {/* Mobile Header Controls */}
        <div className="flex md:hidden items-center gap-2">
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
                  {translateAllProgress && translateAllProgress.current > 1 && typeof translateAllProgress.remainingSeconds === 'number' && (
                    <span className="text-[10px] text-muted">
                      {translateAllProgress.remainingSeconds < 60
                        ? `เหลืออีก ~${Math.ceil(translateAllProgress.remainingSeconds)} วินาที`
                        : `เหลืออีก ~${Math.ceil(translateAllProgress.remainingSeconds / 60)} นาที`}
                    </span>
                  )}
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
                  const originalName = pages[currentPage].name;
                  const extension = originalName.includes('.') ? originalName.split('.').pop() : 'png';
                  const baseName = originalName.includes('.') ? originalName.substring(0, originalName.lastIndexOf('.')) : originalName;
                  const filename = `SuperK_Page_${String(currentPage + 1).padStart(3, '0')}_${baseName}.${extension}`;
                  downloadTranslatedImage("single", currentPage, filename);
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
      <main className={`flex-1 w-full mt-14 flex flex-col items-center transition-opacity duration-300 ${isDragging ? 'opacity-50' : 'opacity-100'} ${pages.length > 0 ? (isThumbnailsCollapsed ? 'mb-10 sm:mb-12' : 'mb-24 sm:mb-28') : ''}`}>
        {workflowMessage && (
          <div className="fixed top-16 left-1/2 -translate-x-1/2 z-40 bg-surface/90 backdrop-blur-md border border-primary/30 text-foreground px-4 py-1.5 rounded-full text-xs font-semibold shadow-lg animate-in fade-in slide-in-from-top-2 duration-300 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <span>{workflowMessage}</span>
          </div>
        )}

        {pages.length > 0 ? (
          <div className="w-full flex flex-col items-center flex-1 px-2 sm:px-4 py-4 sm:py-6">
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
            />

            <PageViewer
              pages={pages}
              currentPage={currentPage}
              viewLayout={viewLayout}
              workspaceLayer={workspaceLayer}
              currentCleaningResult={currentCleaningResult}
              cleaningResultsByPage={cleaningResultsByPage}
              translatedImagesMap={translatedImagesMap}
              brokenPages={brokenPages}
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
              <Upload className={`w-8 h-8 mb-4 ${isDragging ? 'text-primary' : 'text-muted'}`} />
              <p className="text-foreground text-lg mb-1 font-medium">Drag & Drop manga pages</p>
              <p className="text-muted text-sm mb-6">Support for Images, ZIP, CBZ, and PDF</p>

              <label className="bg-surface hover:bg-surface-hover text-foreground px-6 py-2 rounded-md text-sm font-medium cursor-pointer transition-colors duration-150 border border-surface-hover">
                Browse Files
                <input type="file" multiple accept="image/*,.zip,.cbz,.pdf" className="hidden" onChange={handleImageUpload} />
              </label>
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
        glossary={glossary}
        onGlossaryChange={setGlossary}
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
    </div>
  );
}
