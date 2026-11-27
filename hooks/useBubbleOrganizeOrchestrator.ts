import { useCallback, useRef, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { PageCleaningResult } from "@/hooks/useCleaning";
import type { WorkspaceExportPage } from "@/hooks/useExportOrchestrator";
import {
  applyTranslationOverlay,
  autoOrganizePageBubbles,
  syncPageOverlayAdjustments,
  type OverlayTextStyle,
  type TranslatedBubble,
} from "@/lib/translationOverlay";
import {
  applyBwContrastModeToBubbles,
  cloneTextStyleProfile,
} from "@/lib/colorMatching/resolveTextStyle";
import type { BwContrastMode } from "@/lib/colorMatching/types";
import { undoManager } from "@/lib/undoManager";
import { boxesFromBubbles, snapBoxesToImageBalloons } from "@/lib/balloonSnap";

export function bwContrastModeLabel(mode: BwContrastMode): string {
  switch (mode) {
    case "black_on_white":
      return "ดำ-ขาว (ตัวดำ ขอบขาวหนา)";
    case "white_on_black":
      return "ขาว-ดำ (ตัวขาว ขอบดำหนา)";
    case "pure_black":
      return "ดำล้วน (ไม่มีขอบ)";
    default:
      return "ออโต้ ขาว-ดำ";
  }
}

async function loadPageDimensions(
  pageUrl: string,
  bubbles: TranslatedBubble[],
  currentPageUrl?: string,
  cleanUrl?: string,
): Promise<{ iw: number; ih: number }> {
  if (currentPageUrl && pageUrl === currentPageUrl) {
    const hostImg = typeof document !== "undefined"
      ? (document.querySelector("#pageContainer img") as HTMLImageElement | null)
      : null;
    if (hostImg?.naturalWidth && hostImg?.naturalHeight) {
      return { iw: hostImg.naturalWidth, ih: hostImg.naturalHeight };
    }
  }
  const existingAdj = bubbles.find(
    (b) => b?.layoutAdjustment && b.layoutAdjustment.iw > 0 && b.layoutAdjustment.ih > 0,
  )?.layoutAdjustment;
  try {
    const probeImg = new Image();
    const isJsdom = typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent || "");
    const decoded = await new Promise<{ iw: number; ih: number } | null>((resolve) => {
      const finish = () => {
        if (probeImg.naturalWidth > 0 && probeImg.naturalHeight > 0) {
          resolve({ iw: probeImg.naturalWidth, ih: probeImg.naturalHeight });
        } else {
          resolve(null);
        }
      };
      probeImg.onload = finish;
      probeImg.onerror = () => resolve(null);
      probeImg.src = cleanUrl ?? pageUrl;
      if (probeImg.complete || isJsdom) {
        finish();
        return;
      }
      setTimeout(() => resolve(null), 300);
    });
    if (decoded) return decoded;
  } catch {}
  if (existingAdj) {
    return { iw: existingAdj.iw, ih: existingAdj.ih };
  }
  return { iw: 1200, ih: 1800 };
}

/**
 * Refines each bubble's detected box against the actual balloon shape in the
 * page image before organizing. The detection box is often tight or shifted,
 * which makes organized text land next to the balloon instead of inside it;
 * snapping measures the white balloon region from pixels instead. Any
 * failure keeps the detected boxes, so organize still works as before.
 */
async function refineBubblesWithBalloonSnap(
  bubbles: TranslatedBubble[],
  imageUrl?: string,
): Promise<TranslatedBubble[]> {
  if (!imageUrl || typeof document === "undefined") return bubbles;
  try {
    const img = new Image();
    const isJsdom = typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent || "");
    const loaded = await new Promise<HTMLImageElement | null>((resolve) => {
      const finish = () => {
        resolve(img.naturalWidth > 0 ? img : null);
      };
      img.onload = finish;
      img.onerror = () => resolve(null);
      img.src = imageUrl;
      if (img.complete || isJsdom) {
        finish();
        return;
      }
      setTimeout(() => resolve(null), 300);
    });
    if (!loaded) return bubbles;
    const canvas = document.createElement("canvas");
    canvas.width = loaded.naturalWidth;
    canvas.height = loaded.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return bubbles;
    ctx.drawImage(loaded, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    canvas.width = 0;
    canvas.height = 0;
    const snapped = snapBoxesToImageBalloons(
      { data: pixels.data, width: pixels.width, height: pixels.height },
      boxesFromBubbles(bubbles),
    );
    let refinedCount = 0;
    const refined = bubbles.map((b, i) => {
      const next = snapped[i];
      if (!next) return b;
      refinedCount++;
      return { ...b, box: next };
    });
    if (refinedCount > 0) {
      console.info(`[BalloonSnap] refined ${refinedCount}/${bubbles.length} boxes from page pixels`);
    }
    return refined;
  } catch (err) {
    console.warn("Balloon snap skipped; keeping detected boxes:", err);
    return bubbles;
  }
}

export interface UseBubbleOrganizeOrchestratorOptions {
  pages: WorkspaceExportPage[];
  currentPage: number;
  currentPageUrl?: string;
  activeBubbles: TranslatedBubble[];
  setActiveBubbles: Dispatch<SetStateAction<TranslatedBubble[]>>;
  bubbleCacheRef: MutableRefObject<Map<string, TranslatedBubble[]>>;
  pagesRef?: MutableRefObject<WorkspaceExportPage[]>;
  currentPageRef?: MutableRefObject<number>;
  textStyleRef: MutableRefObject<OverlayTextStyle | undefined>;
  targetLang?: string;
  getPageTargetLanguage?: (url: string) => string | undefined;
  dirtyExportPagesRef: MutableRefObject<Set<string>>;
  markPageDirty?: (pageUrl: string) => void;
  viewLayout: "single" | "scroll";
  setTranslationResult?: (result: string | null) => void;
  refreshPageTranslation: (pageUrl: string, cleanUrl?: string) => Promise<unknown>;
  currentCleaningResult?: PageCleaningResult;
  cleaningResultsByPage?: Map<string, PageCleaningResult>;
  translatedImages?: Map<string, string>;
}

export interface UseBubbleOrganizeOrchestratorReturn {
  handleAutoOrganizeCurrentPage: (
    mode?: "readable" | "xlarge" | "original",
    overrideManual?: boolean,
  ) => Promise<void>;
  handleAutoOrganizeAllPages: (
    mode?: "readable" | "xlarge" | "original",
  ) => Promise<void>;
  handleApplyBwContrastCurrentPage: (
    mode: BwContrastMode,
  ) => Promise<void>;
  handleApplyBwContrastAllPages: (
    mode: BwContrastMode,
  ) => Promise<void>;
  bwContrastModeLabel: (mode: BwContrastMode) => string;
}

export function useBubbleOrganizeOrchestrator({
  pages,
  currentPage,
  currentPageUrl,
  activeBubbles,
  setActiveBubbles,
  bubbleCacheRef,
  pagesRef: externalPagesRef,
  currentPageRef: externalCurrentPageRef,
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
}: UseBubbleOrganizeOrchestratorOptions): UseBubbleOrganizeOrchestratorReturn {
  const internalPagesRef = useRef(pages);
  const internalCurrentPageRef = useRef(currentPage);

  useEffect(() => {
    internalPagesRef.current = pages;
  }, [pages]);

  useEffect(() => {
    internalCurrentPageRef.current = currentPage;
  }, [currentPage]);

  const pagesRef = externalPagesRef ?? internalPagesRef;
  const currentPageRef = externalCurrentPageRef ?? internalCurrentPageRef;
  const effectiveCurrentPageUrl = currentPageUrl ?? pages[currentPage]?.url;
  const translatedImagesMap = translatedImages;
  const notifyTranslationResult = useCallback(
    (msg: string | null) => {
      setTranslationResult?.(msg);
    },
    [setTranslationResult],
  );
  const safeTextStyleRef = textStyleRef as unknown as MutableRefObject<OverlayTextStyle>;

  const handleAutoOrganizeCurrentPage = useCallback(
    async (
      mode: "readable" | "xlarge" | "original" = "readable",
      overrideManual = true,
    ) => {
      if (!effectiveCurrentPageUrl) return;
      const currentBubbles =
        bubbleCacheRef.current.get(effectiveCurrentPageUrl) ?? activeBubbles;
      if (!currentBubbles || currentBubbles.length === 0) return;

      const beforeBubbles = currentBubbles.map((b) => ({
        ...b,
        layoutAdjustment: b.layoutAdjustment ? { ...b.layoutAdjustment } : undefined,
        styleProfile: b.styleProfile ? { ...b.styleProfile } : undefined,
      }));

      const hostImg = typeof document !== "undefined"
        ? (document.querySelector("#pageContainer img") as HTMLImageElement | null)
        : null;
      const iw = hostImg?.naturalWidth || 1200;
      const ih = hostImg?.naturalHeight || 1800;

      const targetLangCode =
        getPageTargetLanguage?.(effectiveCurrentPageUrl) ?? targetLang ?? "th";
      const isXLarge = mode === "xlarge";
      const isOriginalMode = mode === "original";
      const cleanUrl = currentCleaningResult?.cleanUrl
        ?? cleaningResultsByPage?.get?.(effectiveCurrentPageUrl)?.cleanUrl;
      const snappedBubbles = await refineBubblesWithBalloonSnap(
        currentBubbles,
        cleanUrl ?? effectiveCurrentPageUrl,
      );
      const result = autoOrganizePageBubbles(snappedBubbles, iw, ih, {
        fontFamily: textStyleRef.current?.fontFamily,
        fontSizeMultiplier: textStyleRef.current?.fontSizeMultiplier || 1.0,
        locale: targetLangCode === "en" ? "en" : "th",
        forceRealign: true,
        overrideUserModified: overrideManual,
        ...(isOriginalMode
          ? {
              constrainToOriginalBox: true,
              preserveOriginalPosition: true,
            }
          : isXLarge
            ? {
                minFontSize: Math.max(22, Math.round(iw * 0.0195)),
                maxEnlargeRatio: 1.75,
              }
            : {}),
      });

      const afterBubbles = result.optimizedBubbles.map((b) => ({
        ...b,
        layoutAdjustment: b.layoutAdjustment ? { ...b.layoutAdjustment } : undefined,
        styleProfile: b.styleProfile ? { ...b.styleProfile } : undefined,
      }));

      if (result.adjustedCount > 0) {
        const targetUrl = effectiveCurrentPageUrl;
        const restorePageSnapshot = (snapshot: TranslatedBubble[]) => {
          bubbleCacheRef.current.set(targetUrl, snapshot);
          syncPageOverlayAdjustments(targetUrl, snapshot);
          if (pagesRef.current[currentPageRef.current]?.url === targetUrl) {
            setActiveBubbles(snapshot);
          }
          dirtyExportPagesRef.current.add(targetUrl);
          markPageDirty?.(targetUrl);
        };
        undoManager.push({
          label: `จัดระเบียบบับเบิลหน้า ${currentPage + 1}`,
          undo: () => restorePageSnapshot(beforeBubbles),
          redo: () => restorePageSnapshot(afterBubbles),
        });
      }

      bubbleCacheRef.current.set(effectiveCurrentPageUrl, result.optimizedBubbles);
      syncPageOverlayAdjustments(effectiveCurrentPageUrl, result.optimizedBubbles);
      setActiveBubbles(result.optimizedBubbles);
      dirtyExportPagesRef.current.add(effectiveCurrentPageUrl);
      markPageDirty?.(effectiveCurrentPageUrl);

      // 1. Immediately re-render the active visible screen overlay in #pageContainer
      const pageContainer = typeof document !== "undefined"
        ? document.getElementById("pageContainer")
        : null;
      if (pageContainer) {
        await applyTranslationOverlay(
          result.optimizedBubbles,
          viewLayout,
          currentPage,
          notifyTranslationResult,
          undefined,
          safeTextStyleRef,
          pageContainer,
          effectiveCurrentPageUrl,
          () => dirtyExportPagesRef.current.add(effectiveCurrentPageUrl),
          targetLangCode,
        );
      }

      // 2. Also re-rasterize offscreen cache for PDF/ZIP export parity
      await refreshPageTranslation(
        effectiveCurrentPageUrl,
        currentCleaningResult?.cleanUrl ?? effectiveCurrentPageUrl,
      );

      import("react-hot-toast").then((m) =>
        m.default.success(
          result.adjustedCount > 0
            ? `✅ จัดระเบียบบับเบิล (${isOriginalMode ? "ตามตำแหน่งต้นฉบับ" : isXLarge ? "ตัวใหญ่พิเศษ XL" : "สมดุลอ่านง่าย"}) ${result.adjustedCount} จุดเรียบร้อยแล้ว!`
            : `✅ บับเบิลทุกจุดจัดระเบียบเรียบร้อยแล้ว`,
        ),
      );
    },
    [
      effectiveCurrentPageUrl,
      activeBubbles,
      setActiveBubbles,
      bubbleCacheRef,
      getPageTargetLanguage,
      targetLang,
      textStyleRef,
      dirtyExportPagesRef,
      markPageDirty,
      viewLayout,
      currentPage,
      refreshPageTranslation,
      currentCleaningResult,
      cleaningResultsByPage,
      pagesRef,
      currentPageRef,
      notifyTranslationResult,
      safeTextStyleRef,
    ],
  );

  const handleAutoOrganizeAllPages = useCallback(
    async (mode: "readable" | "xlarge" | "original" = "readable") => {
      if (pages.length === 0) return;
      const translatedPages = pages.filter((p) => {
        const b = bubbleCacheRef.current.get(p.url);
        return b && b.length > 0;
      });

      if (translatedPages.length === 0) {
        import("react-hot-toast").then((m) =>
          m.default("ยังไม่มีหน้าที่มีคำแปลให้จัดระเบียบ", { icon: "ℹ️" }),
        );
        return;
      }

      try {
        const toastModule = await import("react-hot-toast");
        const toast = toastModule.default;
        const isXLarge = mode === "xlarge";
        const isOriginalMode = mode === "original";
        const toastId =
          typeof toast?.loading === "function"
            ? toast.loading(`กำลังจัดระเบียบทุกหน้า (0/${translatedPages.length})...`)
            : undefined;
        let totalAdjusted = 0;
        let processedCount = 0;
        const beforeByPage = new Map<string, TranslatedBubble[]>();
        const afterByPage = new Map<string, TranslatedBubble[]>();

        for (let i = 0; i < translatedPages.length; i++) {
          const pageItem = translatedPages[i];
          const pageUrl = pageItem.url;
          const currentBubbles = bubbleCacheRef.current.get(pageUrl);
          if (!currentBubbles || currentBubbles.length === 0) continue;

          const cleanUrl = cleaningResultsByPage?.get?.(pageUrl)?.cleanUrl;
          const { iw, ih } = await loadPageDimensions(
            pageUrl,
            currentBubbles,
            effectiveCurrentPageUrl,
            cleanUrl,
          );
          const snappedBubbles = await refineBubblesWithBalloonSnap(
            currentBubbles,
            cleanUrl ?? pageUrl,
          );

          const targetLangCode =
            getPageTargetLanguage?.(pageUrl) ?? targetLang ?? "th";
          const result = autoOrganizePageBubbles(snappedBubbles, iw, ih, {
            fontFamily: textStyleRef.current?.fontFamily,
            fontSizeMultiplier: textStyleRef.current?.fontSizeMultiplier || 1.0,
            locale: targetLangCode === "en" ? "en" : "th",
            forceRealign: true,
            overrideUserModified: isOriginalMode,
            ...(isOriginalMode
              ? {
                  constrainToOriginalBox: true,
                  preserveOriginalPosition: true,
                }
              : isXLarge
                ? {
                    minFontSize: Math.max(22, Math.round(iw * 0.0195)),
                    maxEnlargeRatio: 1.75,
                  }
                : {}),
          });

          if (result.adjustedCount > 0) {
            beforeByPage.set(
              pageUrl,
              currentBubbles.map((b) => ({
                ...b,
                layoutAdjustment: b.layoutAdjustment ? { ...b.layoutAdjustment } : undefined,
                styleProfile: b.styleProfile ? { ...b.styleProfile } : undefined,
              })),
            );
            afterByPage.set(
              pageUrl,
              result.optimizedBubbles.map((b) => ({
                ...b,
                layoutAdjustment: b.layoutAdjustment ? { ...b.layoutAdjustment } : undefined,
                styleProfile: b.styleProfile ? { ...b.styleProfile } : undefined,
              })),
            );
          }
          bubbleCacheRef.current.set(pageUrl, result.optimizedBubbles);
          syncPageOverlayAdjustments(pageUrl, result.optimizedBubbles);
          dirtyExportPagesRef.current.add(pageUrl);
          markPageDirty?.(pageUrl);
          totalAdjusted += result.adjustedCount;
          processedCount++;

          // If active on screen, live re-render #pageContainer and refresh offscreen bitmap
          if (pageUrl === effectiveCurrentPageUrl) {
            setActiveBubbles(result.optimizedBubbles);
            const pageContainer = typeof document !== "undefined"
              ? document.getElementById("pageContainer")
              : null;
            if (pageContainer) {
              await applyTranslationOverlay(
                result.optimizedBubbles,
                viewLayout,
                currentPage,
                notifyTranslationResult,
                undefined,
                safeTextStyleRef,
                pageContainer,
                effectiveCurrentPageUrl,
                () => dirtyExportPagesRef.current.add(effectiveCurrentPageUrl),
                targetLangCode,
              );
            }
            await refreshPageTranslation(
              effectiveCurrentPageUrl,
              currentCleaningResult?.cleanUrl ?? effectiveCurrentPageUrl,
            );
          } else if (translatedImagesMap?.has(pageUrl) || viewLayout === "scroll") {
            await refreshPageTranslation(
              pageUrl,
              cleaningResultsByPage?.get?.(pageUrl)?.cleanUrl ?? pageUrl,
            );
          }

          if (toastId && typeof toast?.loading === "function") {
            toast.loading(
              `กำลังจัดระเบียบหน้า ${i + 1}/${translatedPages.length}...`,
              { id: toastId },
            );
          }

          // Yield microtask so UI stays responsive
          await new Promise((resolve) => setTimeout(resolve, 0));
        }

        if (totalAdjusted > 0 && afterByPage.size > 0) {
          const applyBookSnapshot = (snapshotMap: Map<string, TranslatedBubble[]>) => {
            snapshotMap.forEach((bubbles, url) => {
              bubbleCacheRef.current.set(url, bubbles);
              syncPageOverlayAdjustments(url, bubbles);
              dirtyExportPagesRef.current.add(url);
              markPageDirty?.(url);
              if (pagesRef.current[currentPageRef.current]?.url === url) {
                setActiveBubbles(bubbles);
              }
            });
          };
          undoManager.push({
            label: `จัดระเบียบทุกหน้า (${totalAdjusted} จุด)`,
            undo: () => applyBookSnapshot(beforeByPage),
            redo: () => applyBookSnapshot(afterByPage),
          });
        }

        const summaryMsg = totalAdjusted > 0
          ? `✅ จัดระเบียบครบทั้ง ${processedCount} หน้า (${totalAdjusted} จุด) เรียบร้อยแล้ว! (กด Ctrl+Z ย้อนกลับได้)`
          : `✅ จัดระเบียบครบทั้ง ${processedCount} หน้าเรียบร้อยแล้ว`;
        if (typeof toast?.success === "function") {
          toast.success(summaryMsg, toastId ? { id: toastId } : undefined);
        } else if (typeof toast === "function") {
          toast(summaryMsg, toastId ? { id: toastId } : undefined);
        }
      } catch (err) {
        console.error("Auto organize all pages failed:", err);
      }
    },
    [
      pages,
      bubbleCacheRef,
      effectiveCurrentPageUrl,
      getPageTargetLanguage,
      targetLang,
      textStyleRef,
      dirtyExportPagesRef,
      markPageDirty,
      setActiveBubbles,
      viewLayout,
      currentPage,
      refreshPageTranslation,
      currentCleaningResult,
      cleaningResultsByPage,
      translatedImagesMap,
      pagesRef,
      currentPageRef,
      notifyTranslationResult,
      safeTextStyleRef,
    ],
  );

  const handleApplyBwContrastCurrentPage = useCallback(
    async (mode: BwContrastMode) => {
      if (!effectiveCurrentPageUrl) return;
      const currentBubbles =
        bubbleCacheRef.current.get(effectiveCurrentPageUrl) ?? activeBubbles;
      if (!currentBubbles || currentBubbles.length === 0) return;

      const beforeBw = currentBubbles.map((b) => ({
        ...b,
        layoutAdjustment: b.layoutAdjustment ? { ...b.layoutAdjustment } : undefined,
        styleProfile: cloneTextStyleProfile(b.styleProfile),
      }));
      const updated = applyBwContrastModeToBubbles(currentBubbles, mode).map(
        (b) =>
          b.layoutAdjustment
            ? {
                ...b,
                layoutAdjustment: {
                  ...b.layoutAdjustment,
                  styleProfile: cloneTextStyleProfile(b.styleProfile),
                },
              }
            : b,
      );

      const targetUrl = effectiveCurrentPageUrl;
      const applyBwSnapshot = (snapshot: TranslatedBubble[]) => {
        bubbleCacheRef.current.set(targetUrl, snapshot);
        syncPageOverlayAdjustments(targetUrl, snapshot);
        if (pagesRef.current[currentPageRef.current]?.url === targetUrl) {
          setActiveBubbles(snapshot);
        }
        dirtyExportPagesRef.current.add(targetUrl);
        markPageDirty?.(targetUrl);
      };
      undoManager.push({
        label: `ปรับโหมดสี "${bwContrastModeLabel(mode)}" หน้า ${currentPage + 1}`,
        undo: () => applyBwSnapshot(beforeBw),
        redo: () => applyBwSnapshot(updated),
      });

      bubbleCacheRef.current.set(effectiveCurrentPageUrl, updated);
      syncPageOverlayAdjustments(effectiveCurrentPageUrl, updated);
      setActiveBubbles(updated);
      dirtyExportPagesRef.current.add(effectiveCurrentPageUrl);
      markPageDirty?.(effectiveCurrentPageUrl);

      const targetLangCode =
        getPageTargetLanguage?.(effectiveCurrentPageUrl) ?? targetLang ?? "th";
      const pageContainer = typeof document !== "undefined"
        ? document.getElementById("pageContainer")
        : null;
      if (pageContainer) {
        await applyTranslationOverlay(
          updated,
          viewLayout,
          currentPage,
          notifyTranslationResult,
          undefined,
          safeTextStyleRef,
          pageContainer,
          effectiveCurrentPageUrl,
          () => dirtyExportPagesRef.current.add(effectiveCurrentPageUrl),
          targetLangCode,
        );
      }

      await refreshPageTranslation(
        effectiveCurrentPageUrl,
        currentCleaningResult?.cleanUrl ?? effectiveCurrentPageUrl,
      );

      import("react-hot-toast").then((m) =>
        m.default.success(
          `✅ ปรับโหมดสีหน้านี้เป็น "${bwContrastModeLabel(mode)}" เรียบร้อยแล้ว!`,
        ),
      );
    },
    [
      effectiveCurrentPageUrl,
      activeBubbles,
      bubbleCacheRef,
      setActiveBubbles,
      dirtyExportPagesRef,
      markPageDirty,
      getPageTargetLanguage,
      targetLang,
      viewLayout,
      currentPage,
      refreshPageTranslation,
      currentCleaningResult,
      pagesRef,
      currentPageRef,
      notifyTranslationResult,
      safeTextStyleRef,
    ],
  );

  const handleApplyBwContrastAllPages = useCallback(
    async (mode: BwContrastMode) => {
      if (pages.length === 0) return;
      const translatedPages = pages.filter((p) => {
        const b = bubbleCacheRef.current.get(p.url);
        return b && b.length > 0;
      });

      if (translatedPages.length === 0) {
        import("react-hot-toast").then((m) =>
          m.default("ยังไม่มีหน้าที่มีคำแปลให้ปรับสีข้อความ", { icon: "ℹ️" }),
        );
        return;
      }

      try {
        const toastModule = await import("react-hot-toast");
        const toast = toastModule.default;
        const label = bwContrastModeLabel(mode);
        const toastId =
          typeof toast?.loading === "function"
            ? toast.loading(
                `กำลังปรับโหมด "${label}" ทุกหน้า (0/${translatedPages.length})...`,
              )
            : undefined;
        let processedCount = 0;

        for (let i = 0; i < translatedPages.length; i++) {
          const pageItem = translatedPages[i];
          const pageUrl = pageItem.url;
          const currentBubbles = bubbleCacheRef.current.get(pageUrl);
          if (!currentBubbles || currentBubbles.length === 0) continue;

          const updated = applyBwContrastModeToBubbles(
            currentBubbles,
            mode,
          ).map((b) =>
            b.layoutAdjustment
              ? {
                  ...b,
                  layoutAdjustment: {
                    ...b.layoutAdjustment,
                    styleProfile: cloneTextStyleProfile(b.styleProfile),
                  },
                }
              : b,
          );

          bubbleCacheRef.current.set(pageUrl, updated);
          syncPageOverlayAdjustments(pageUrl, updated);
          dirtyExportPagesRef.current.add(pageUrl);
          markPageDirty?.(pageUrl);
          processedCount++;

          const targetLangCode =
            getPageTargetLanguage?.(pageUrl) ?? targetLang ?? "th";

          if (pageUrl === effectiveCurrentPageUrl) {
            setActiveBubbles(updated);
            const pageContainer = typeof document !== "undefined"
              ? document.getElementById("pageContainer")
              : null;
            if (pageContainer) {
              await applyTranslationOverlay(
                updated,
                viewLayout,
                currentPage,
                notifyTranslationResult,
                undefined,
                safeTextStyleRef,
                pageContainer,
                effectiveCurrentPageUrl,
                () => dirtyExportPagesRef.current.add(effectiveCurrentPageUrl),
                targetLangCode,
              );
            }
            await refreshPageTranslation(
              effectiveCurrentPageUrl,
              currentCleaningResult?.cleanUrl ?? effectiveCurrentPageUrl,
            );
          } else if (
            translatedImagesMap?.has(pageUrl) ||
            viewLayout === "scroll"
          ) {
            await refreshPageTranslation(
              pageUrl,
              cleaningResultsByPage?.get?.(pageUrl)?.cleanUrl ?? pageUrl,
            );
          }

          if (toastId && typeof toast?.loading === "function") {
            toast.loading(
              `กำลังปรับโหมด "${label}" หน้า ${i + 1}/${translatedPages.length}...`,
              { id: toastId },
            );
          }

          await new Promise((resolve) => setTimeout(resolve, 0));
        }

        const summaryMsg = `✅ ปรับโหมด "${label}" ครบทั้ง ${processedCount} หน้าเรียบร้อยแล้ว!`;
        if (typeof toast?.success === "function") {
          toast.success(summaryMsg, toastId ? { id: toastId } : undefined);
        } else if (typeof toast === "function") {
          toast(summaryMsg, toastId ? { id: toastId } : undefined);
        }
      } catch (err) {
        console.error("Apply B&W contrast all pages failed:", err);
      }
    },
    [
      pages,
      bubbleCacheRef,
      effectiveCurrentPageUrl,
      getPageTargetLanguage,
      targetLang,
      dirtyExportPagesRef,
      markPageDirty,
      setActiveBubbles,
      viewLayout,
      currentPage,
      refreshPageTranslation,
      currentCleaningResult,
      cleaningResultsByPage,
      translatedImagesMap,
      notifyTranslationResult,
      safeTextStyleRef,
    ],
  );

  return {
    handleAutoOrganizeCurrentPage,
    handleAutoOrganizeAllPages,
    handleApplyBwContrastCurrentPage,
    handleApplyBwContrastAllPages,
    bwContrastModeLabel,
  };
}
