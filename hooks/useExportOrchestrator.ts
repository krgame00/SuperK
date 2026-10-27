"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import JSZip from "jszip";
import { jsPDF } from "jspdf";
import {
  convertExportBlobToFormat,
  exportImageBlob,
  exportImageFilename,
  normalizeExportImageFormat,
  normalizePageExportSource,
  resolvePageExportUrl,
  type ExportImageFormat,
  type PageExportSource,
} from "@/lib/export/pageSource";
import {
  scanPageGeometry,
  type PageGeometryResult,
  type ReadabilityFinding,
} from "@/lib/export/readabilityScan";
import {
  readabilityAcknowledgmentKey,
  type ReadabilityPageSnapshot,
} from "@/lib/export/readabilityAcknowledgment";
import {
  generateArchiveFilename,
  generateComicInfoXml,
  generatePhotoshopBuildScript,
  generateStripFilename,
} from "@/lib/export/exportManager";
import {
  getAskExportDirectory,
  getOrPickExportDirectory,
  isDirectoryPickerSupported,
  saveBlob,
  type DirectoryHandleLike,
} from "@/lib/export/saveLocation";
import { blobToDataUrl } from "@/lib/projectStore";
import { workspaceResourceManager } from "@/lib/lifecycle/workspaceResourceManager";
import {
  getUnconfirmedPages,
  missingTranslationSignature,
  type PageReviewInfo,
} from "@/lib/export/reviewGate";
import type { BackgroundInspectionResult } from "@/lib/cleaning/backgroundRemnantInspection";
import type { PageTargetIdentity } from "@/lib/translation/pageEligibility";
import type {
  PageCleaningResult,
  PageRemnantTextEvidence,
} from "@/hooks/useCleaning";
import type { WorkspaceLayer } from "@/components/cleaning/CleaningToolbar";
import type { ExportReportRow } from "@/components/workspace/ExportReportModal";
import {
  applyTranslationOverlay,
  type TranslatedBubble,
  type OverlayTextStyle,
} from "@/lib/translationOverlay";

export type WorkspaceExportPage = {
  id?: string;
  url: string;
  name: string;
  originUrl?: string;
  readerImageUrl?: string;
  exportSource?: PageExportSource;
  exportExcluded?: boolean;
  sourceFingerprint?: string;
};

export interface UseExportOrchestratorOptions {
  pages: WorkspaceExportPage[];
  currentPage: number;
  setCurrentPage: (index: number) => void;
  workspaceLayer: WorkspaceLayer;
  setWorkspaceLayer: (layer: WorkspaceLayer) => void;
  setViewLayout: (layout: "single" | "scroll") => void;

  cleaningResultsByPage: Map<string, PageCleaningResult>;
  bubbleCacheRef: React.MutableRefObject<Map<string, TranslatedBubble[]>>;
  textStyleRef: React.MutableRefObject<OverlayTextStyle | undefined>;

  confirmedPages: Set<string>;
  setConfirmedPages: (update: (previous: Set<string>) => Set<string>) => void;
  confirmedPagesRef: React.MutableRefObject<Set<string>>;
  confirmedMissingTranslationsRef: React.MutableRefObject<Map<string, string>>;
  pageTargetCacheRef: React.MutableRefObject<Map<string, PageTargetIdentity>>;

  getPageTargetLanguage: (pageUrl: string) => string | undefined;
  getPageSourceRevision?: (pageUrl: string) => string | undefined;
  getPageSignature?: (pageUrl: string) => string;
  getCurrentRemnantReview?: (
    pageUrl: string,
    evidence: PageRemnantTextEvidence,
  ) => { inspection: BackgroundInspectionResult } | undefined;
  getExpectedRemnantEvidence: (pageUrl: string) => PageRemnantTextEvidence;
  confirmAllPageReviews?: (pageUrl: string) => void;
  confirmAllPageRemnants?: (
    pageUrl: string,
    evidence: PageRemnantTextEvidence,
  ) => void;

  inspectTranslatedPages: () => {
    pageIndex: number;
    total: number;
    contaminated: number;
    invalidBoxes: number;
  }[];
  setTranslationResult: (msg: string | null) => void;

  translationCacheRevision: number;
  cleaningCacheRevision: number;

  translatedImageCacheRef: React.MutableRefObject<Map<string, string>>;
  dirtyExportPagesRef: React.MutableRefObject<Set<string>>;

  exportSnapshotRef?: React.MutableRefObject<{ pages: WorkspaceExportPage[]; currentPage: number } | null>;
  allowUnreviewedExportRef?: React.MutableRefObject<boolean>;
  pendingReviewIndicesRef?: React.MutableRefObject<number[] | undefined>;
  explicitlyApprovedExportPagesRef?: React.MutableRefObject<Set<string>>;
}

export function useExportOrchestrator({
  pages,
  currentPage,
  setCurrentPage,
  workspaceLayer,
  setWorkspaceLayer,
  setViewLayout,
  cleaningResultsByPage,
  bubbleCacheRef,
  textStyleRef,
  confirmedPages,
  setConfirmedPages,
  confirmedPagesRef,
  confirmedMissingTranslationsRef,
  pageTargetCacheRef,
  getPageTargetLanguage,
  getPageSourceRevision,
  getPageSignature,
  getCurrentRemnantReview,
  getExpectedRemnantEvidence,
  confirmAllPageReviews,
  confirmAllPageRemnants,
  inspectTranslatedPages,
  setTranslationResult,
  translationCacheRevision,
  cleaningCacheRevision,
  translatedImageCacheRef,
  dirtyExportPagesRef,
  exportSnapshotRef: externalExportSnapshotRef,
  allowUnreviewedExportRef: externalAllowUnreviewedExportRef,
  pendingReviewIndicesRef: externalPendingReviewIndicesRef,
  explicitlyApprovedExportPagesRef: externalExplicitlyApprovedExportPagesRef,
}: UseExportOrchestratorOptions) {
  const [isChoosingExport, setIsChoosingExport] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [unconfirmedReviewPages, setUnconfirmedReviewPages] = useState<PageReviewInfo[] | null>(null);
  const [pendingExportAction, setPendingExportAction] = useState<(() => void) | null>(null);

  const internalPendingReviewIndicesRef = useRef<number[] | undefined>(undefined);
  const pendingReviewIndicesRef = externalPendingReviewIndicesRef ?? internalPendingReviewIndicesRef;

  const internalExportSnapshotRef = useRef<{ pages: WorkspaceExportPage[]; currentPage: number } | null>(null);
  const exportSnapshotRef = externalExportSnapshotRef ?? internalExportSnapshotRef;

  const internalAllowUnreviewedExportRef = useRef(false);
  const allowUnreviewedExportRef = externalAllowUnreviewedExportRef ?? internalAllowUnreviewedExportRef;

  const internalExplicitlyApprovedExportPagesRef = useRef<Set<string>>(new Set());
  const explicitlyApprovedExportPagesRef = externalExplicitlyApprovedExportPagesRef ?? internalExplicitlyApprovedExportPagesRef;

  const [exportImageFormat, setExportImageFormatState] = useState<ExportImageFormat>("jpg");
  const exportImageFormatRef = useRef<ExportImageFormat>("jpg");
  const exportFormatExplicitRef = useRef(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("superk:export-image-format");
      if (saved === "jpg" || saved === "png" || saved === "webp" || saved === "auto") {
        setExportImageFormatState(saved);
        exportImageFormatRef.current = saved;
      }
    } catch {}
  }, []);

  const setExportImageFormat = useCallback((nextFormat: ExportImageFormat) => {
    const normalized = normalizeExportImageFormat(nextFormat);
    exportFormatExplicitRef.current = true;
    exportImageFormatRef.current = normalized;
    setExportImageFormatState(normalized);
    try {
      localStorage.setItem("superk:export-image-format", normalized);
    } catch {}
  }, []);

  const [isExportReportOpen, setIsExportReportOpen] = useState(false);
  const [exportReportRows, setExportReportRows] = useState<ExportReportRow[]>([]);
  const [pendingReadabilityExport, setPendingReadabilityExport] = useState<(() => void) | null>(null);
  const [pendingReadabilityAck, setPendingReadabilityAck] = useState<string | null>(null);
  const acknowledgedReadabilityRef = useRef(new Set<string>());
  const [exportScanProgress, setExportScanProgress] = useState<{ completed: number; total: number } | null>(null);
  const reportScanGenerationRef = useRef(0);
  const [pendingReadabilityTarget, setPendingReadabilityTarget] = useState<ReadabilityFinding | null>(null);

  const buildExportReportRows = useCallback((): ExportReportRow[] => {
    const inspected = inspectTranslatedPages?.() ?? [];
    return pages.map((page, pageIndex) => {
      const source = normalizePageExportSource(page.exportSource);
      const info = source === "translated" ? inspected.find((item) => item.pageIndex === pageIndex) : undefined;
      const cleaning = cleaningResultsByPage.get(page.url);
      return {
        pageIndex,
        exportSource: source,
        translated: Boolean(info),
        totalBubbles: info?.total ?? 0,
        contaminated: info?.contaminated ?? 0,
        invalidBoxes: info?.invalidBoxes ?? 0,
        pendingCleaning:
          source === "original"
            ? 0
            : cleaning?.regions.filter((region) => region.status === "needs_review").length ?? 0,
      };
    });
  }, [pages, inspectTranslatedPages, cleaningResultsByPage]);

  const scanReadabilityPage = useCallback(
    async (pageIndex: number): Promise<PageGeometryResult> => {
      const page = (exportSnapshotRef.current?.pages ?? pages)[pageIndex];
      if (page && normalizePageExportSource(page.exportSource) !== "translated") return { findings: [] };
      if (!page) return { findings: [], unavailableReason: "ไม่พบหน้านี้" };
      try {
        return await scanPageGeometry({
          pageUrl: page.url,
          backgroundUrl: cleaningResultsByPage.get(page.url)?.cleanUrl ?? page.url,
          pageIndex,
          bubbles: bubbleCacheRef.current.get(page.url) ?? [],
          textStyle: textStyleRef.current,
        });
      } catch {
        return { findings: [], unavailableReason: "ประเมินหน้านี้ไม่สำเร็จ" };
      }
    },
    [pages, cleaningResultsByPage, bubbleCacheRef, textStyleRef],
  );

  const handleOpenExportReport = useCallback(() => {
    if (exportSnapshotRef.current) return;
    const generation = ++reportScanGenerationRef.current;
    setPendingReadabilityAck(null);
    setPendingReadabilityExport(null);
    const rows = buildExportReportRows();
    setExportReportRows(rows);
    setIsExportReportOpen(true);
    void (async () => {
      for (const row of rows) {
        const page = pages[row.pageIndex];
        const bubbles = bubbleCacheRef.current.get(page.url) ?? [];
        if (bubbles.length === 0) {
          setExportReportRows((current) =>
            current.map((item) =>
              item.pageIndex === row.pageIndex ? { ...item, readabilityFindings: [] } : item,
            ),
          );
          continue;
        }
        const result = await scanReadabilityPage(row.pageIndex);
        if (generation !== reportScanGenerationRef.current) return;
        setExportReportRows((current) =>
          current.map((item) =>
            item.pageIndex === row.pageIndex
              ? { ...item, readabilityFindings: result.findings, readabilityUnavailable: result.unavailableReason }
              : item,
          ),
        );
      }
    })();
  }, [pages, buildExportReportRows, bubbleCacheRef, scanReadabilityPage]);

  const closeExportReport = useCallback(() => {
    reportScanGenerationRef.current += 1;
    setIsExportReportOpen(false);
    setPendingReadabilityExport(null);
    setPendingReadabilityAck(null);
    setExportScanProgress(null);
    setIsChoosingExport(false);
  }, []);

  const continueReadabilityExport = useCallback(() => {
    const action = pendingReadabilityExport;
    if (!exportScanProgress && pendingReadabilityAck) acknowledgedReadabilityRef.current.add(pendingReadabilityAck);
    closeExportReport();
    action?.();
  }, [pendingReadabilityExport, pendingReadabilityAck, exportScanProgress, closeExportReport]);

  const selectReadabilityFinding = useCallback(
    (finding: ReadabilityFinding) => {
      closeExportReport();
      exportSnapshotRef.current = null;
      setViewLayout("single");
      setWorkspaceLayer("translated");
      setCurrentPage(finding.pageIndex);
      setPendingReadabilityTarget(finding);
    },
    [closeExportReport, setViewLayout, setWorkspaceLayer, setCurrentPage],
  );

  useEffect(() => {
    if (!pendingReadabilityTarget || currentPage !== pendingReadabilityTarget.pageIndex || workspaceLayer !== "translated")
      return;
    const host = document.getElementById("pageContainer");
    if (!host) return;
    const findTarget = () => {
      const target = [...host.querySelectorAll<HTMLElement>("[data-bubble-id]")].find(
        (item) => item.dataset.bubbleId === pendingReadabilityTarget.bubbleId,
      );
      if (!target) return false;
      target.dataset.readabilityTarget = "true";
      target.style.outline = "3px solid #f59e0b";
      target.focus();
      target.scrollIntoView?.({ block: "center", inline: "center" });
      window.setTimeout(() => {
        if (target.dataset.readabilityTarget === "true") {
          delete target.dataset.readabilityTarget;
          target.style.outline = "";
        }
      }, 3000);
      setPendingReadabilityTarget(null);
      return true;
    };
    if (findTarget()) return;
    const observer = new MutationObserver(() => {
      if (findTarget()) observer.disconnect();
    });
    observer.observe(host, { childList: true, subtree: true });
    const timeout = window.setTimeout(() => {
      observer.disconnect();
      setPendingReadabilityTarget(null);
      import("react-hot-toast").then((module) => module.default("ไปยังหน้าแล้ว แต่ไม่พบจุดข้อความเดิม"));
    }, 3000);
    return () => {
      observer.disconnect();
      window.clearTimeout(timeout);
    };
  }, [pendingReadabilityTarget, currentPage, workspaceLayer]);

  const collectExportReviewPages = useCallback(
    (snapshotPages: WorkspaceExportPage[], targetIndices?: number[], allowUnreviewedExport = false) => {
      const effectiveCleaningMap = new Map(cleaningResultsByPage);
      for (const page of snapshotPages) {
        if (
          explicitlyApprovedExportPagesRef.current.has(page.url) &&
          !effectiveCleaningMap.get(page.url)?.cleanUrl &&
          normalizePageExportSource(page.exportSource) === "translated"
        ) {
          effectiveCleaningMap.set(page.url, {
            pageId: page.url,
            cleanUrl: page.url,
            maskUrl: "",
            reviewMaskUrl: "",
            protectedMaskUrl: "",
            width: 1000,
            height: 1000,
            regions: [],
            sourceFingerprint: getPageSourceRevision?.(page.url) || "approved-source",
          } as unknown as PageCleaningResult);
        }
      }
      return getUnconfirmedPages(
        snapshotPages,
        confirmedPagesRef.current,
        effectiveCleaningMap,
        bubbleCacheRef.current,
        targetIndices,
        confirmedMissingTranslationsRef.current,
        {
          allowUnreviewedExport,
          targetIdentities: pageTargetCacheRef.current,
          sourceRevisions: new Map(snapshotPages.map((page) => [page.url, getPageSourceRevision?.(page.url)])),
          backgroundInspections: new Map(
            snapshotPages.flatMap((page) => {
              const review = getCurrentRemnantReview?.(page.url, getExpectedRemnantEvidence(page.url));
              if (review) return [[page.url, review.inspection] as const];
              if (explicitlyApprovedExportPagesRef.current.has(page.url)) {
                const approvedInspection: BackgroundInspectionResult = {
                  status: "inspected",
                  revisionKey: "approved-export-background",
                  revisions: {
                    sourceRevision: getPageSourceRevision?.(page.url) || "approved-src",
                    backgroundRevision: "approved-bg",
                    removalRevision: "approved-rm",
                  },
                  candidates: [],
                  inspectedAreas: 1,
                };
                return [[page.url, approvedInspection] as const];
              }
              return [];
            }),
          ),
        },
      );
    },
    [
      cleaningResultsByPage,
      getPageSourceRevision,
      confirmedPagesRef,
      bubbleCacheRef,
      confirmedMissingTranslationsRef,
      pageTargetCacheRef,
      getCurrentRemnantReview,
      getExpectedRemnantEvidence,
    ],
  );

  const substituteExportPageWithOriginal = useCallback(
    (pageUrl: string) => {
      const snapshot = exportSnapshotRef.current;
      if (!snapshot) return;
      snapshot.pages = snapshot.pages.map((page) =>
        page.url === pageUrl ? { ...page, exportSource: "original" as const } : page,
      );
      setUnconfirmedReviewPages(collectExportReviewPages(snapshot.pages, pendingReviewIndicesRef.current));
    },
    [collectExportReviewPages],
  );

  const excludeExportPage = useCallback(
    (pageUrl: string) => {
      const snapshot = exportSnapshotRef.current;
      if (!snapshot) return;
      snapshot.pages = snapshot.pages.map((page) =>
        page.url === pageUrl ? { ...page, exportExcluded: true } : page,
      );
      const remainingIndices = pendingReviewIndicesRef.current?.filter(
        (index) => snapshot.pages[index]?.url !== pageUrl,
      );
      setUnconfirmedReviewPages(collectExportReviewPages(snapshot.pages, remainingIndices));
    },
    [collectExportReviewPages],
  );

  const approveExportPageInPlace = useCallback(
    (pageUrl: string) => {
      explicitlyApprovedExportPagesRef.current.add(pageUrl);
      confirmAllPageReviews?.(pageUrl);
      confirmAllPageRemnants?.(pageUrl, getExpectedRemnantEvidence(pageUrl));
      const missingSig = missingTranslationSignature(
        cleaningResultsByPage?.get?.(pageUrl),
        bubbleCacheRef.current.get(pageUrl),
      );
      confirmedMissingTranslationsRef.current.set(pageUrl, missingSig);
      confirmedPagesRef.current.add(pageUrl);
      setConfirmedPages((prev) => {
        const next = new Set(prev);
        next.add(pageUrl);
        return next;
      });
      const snapshotPages = exportSnapshotRef.current?.pages ?? pages;
      setUnconfirmedReviewPages(collectExportReviewPages(snapshotPages, pendingReviewIndicesRef.current));
    },
    [
      bubbleCacheRef,
      cleaningResultsByPage,
      collectExportReviewPages,
      confirmAllPageRemnants,
      confirmAllPageReviews,
      confirmedMissingTranslationsRef,
      confirmedPagesRef,
      getExpectedRemnantEvidence,
      pages,
      setConfirmedPages,
    ],
  );

  const approveAllExportPagesInPlace = useCallback(() => {
    if (!unconfirmedReviewPages || unconfirmedReviewPages.length === 0) return;
    for (const p of unconfirmedReviewPages) {
      explicitlyApprovedExportPagesRef.current.add(p.pageUrl);
      confirmAllPageReviews?.(p.pageUrl);
      confirmAllPageRemnants?.(p.pageUrl, getExpectedRemnantEvidence(p.pageUrl));
      const missingSig = missingTranslationSignature(
        cleaningResultsByPage?.get?.(p.pageUrl),
        bubbleCacheRef.current.get(p.pageUrl),
      );
      confirmedMissingTranslationsRef.current.set(p.pageUrl, missingSig);
      confirmedPagesRef.current.add(p.pageUrl);
    }
    setConfirmedPages((prev) => {
      const next = new Set(prev);
      for (const p of unconfirmedReviewPages) {
        next.add(p.pageUrl);
      }
      return next;
    });
    const snapshotPages = exportSnapshotRef.current?.pages ?? pages;
    setUnconfirmedReviewPages(collectExportReviewPages(snapshotPages, pendingReviewIndicesRef.current));
  }, [
    bubbleCacheRef,
    cleaningResultsByPage,
    collectExportReviewPages,
    confirmAllPageRemnants,
    confirmAllPageReviews,
    confirmedMissingTranslationsRef,
    confirmedPagesRef,
    getExpectedRemnantEvidence,
    pages,
    setConfirmedPages,
    unconfirmedReviewPages,
  ]);

  useEffect(() => {
    if (!unconfirmedReviewPages || !exportSnapshotRef.current) return;
    setUnconfirmedReviewPages(
      collectExportReviewPages(exportSnapshotRef.current.pages, pendingReviewIndicesRef.current),
    );
  }, [translationCacheRevision, cleaningCacheRevision, collectExportReviewPages]);

  const exportInputSignature = useCallback(
    (pageUrl: string) =>
      JSON.stringify([
        pageTargetCacheRef.current.get(pageUrl),
        bubbleCacheRef.current.get(pageUrl)?.map((b) => [
          b.id,
          b.box,
          b.t ?? b.translated,
          b.deleted,
          b.rotation,
          b.isItalic ?? b.italic,
          b.layoutAdjustment,
          b.fontSizeMultiplier,
          b.targetFontSize,
          b.styleProfile?.bwContrastMode,
          b.styleProfile?.fill,
          b.styleProfile?.outline,
          b.styleProfile?.hasOutline,
          b.warp,
        ]),
        textStyleRef.current,
        getCurrentRemnantReview?.(pageUrl, getExpectedRemnantEvidence(pageUrl))?.inspection.revisionKey,
        getPageSourceRevision?.(pageUrl),
        cleaningResultsByPage.get(pageUrl)?.sourceFingerprint,
        cleaningResultsByPage.get(pageUrl)?.cleanUrl,
      ]),
    [
      pageTargetCacheRef,
      bubbleCacheRef,
      textStyleRef,
      getCurrentRemnantReview,
      getExpectedRemnantEvidence,
      getPageSourceRevision,
      cleaningResultsByPage,
    ],
  );

  const renderExportImage = useCallback(
    async (pageUrl: string, index: number, pagesToRender: WorkspaceExportPage[]): Promise<string | null> => {
      if (collectExportReviewPages(pagesToRender, [index], allowUnreviewedExportRef.current).length) {
        throw new Error("กรุณาตรวจหลักฐานหน้านี้ใหม่ เลือกต้นฉบับ หรือข้ามหน้า");
      }
      const beforeSignature = exportInputSignature(pageUrl);
      const pageId = pagesToRender[index]?.id || `page_${index}`;
      const rawBubbles = bubbleCacheRef.current.get(pageUrl);
      const bubbles = rawBubbles ? rawBubbles.map((b) => ({ ...b })) : rawBubbles;

      const hasRenderableBubbles = Boolean(
        bubbles?.some((b) => b && !b.deleted && ((b.t ?? b.translated ?? "").trim() || b.layoutAdjustment)),
      );

      if (hasRenderableBubbles && bubbles) {
        setTranslationResult(`⏳ กำลังเตรียมรูปภาพหน้า ${index + 1}/${pagesToRender.length}...`);
        try {
          return await new Promise<string>((resolve, reject) => {
            const offscreenContainer = document.getElementById("offscreen-container");
            const offscreenImg = document.getElementById("offscreen-image") as HTMLImageElement | null;

            if (!offscreenContainer || !offscreenImg) {
              reject(new Error("ไม่พบพื้นที่เรนเดอร์สำหรับสร้างภาพ"));
              return;
            }

            let timeout: ReturnType<typeof setTimeout> | undefined;
            const fail = (reason: string) => {
              clearTimeout(timeout);
              reject(new Error(`เรนเดอร์คำแปลไม่สำเร็จ (${reason})`));
            };

            offscreenContainer.querySelectorAll(".tl-overlay,.tl-canvas").forEach((el) => el.remove());

            const targetSrc = cleaningResultsByPage.get(pageUrl)?.cleanUrl ?? pageUrl;

            const startRender = () => {
              const megapixels =
                ((offscreenImg.naturalWidth || 1000) * (offscreenImg.naturalHeight || 1000)) / 1_000_000;
              timeout = setTimeout(
                () => fail("หมดเวลา"),
                Math.max(10_000, Math.min(30_000, 2_000 + Math.round(megapixels * 1_000))),
              );
              applyTranslationOverlay(
                bubbles,
                "offscreen",
                -1,
                () => {},
                (renderedUrl) => {
                  clearTimeout(timeout);
                  const approxBytes = Math.round(renderedUrl.length * 0.75);
                  if (
                    collectExportReviewPages(pagesToRender, [index], allowUnreviewedExportRef.current).length ||
                    beforeSignature !== exportInputSignature(pageUrl)
                  ) {
                    reject(new Error("ข้อความหรือหลักฐานเปลี่ยนระหว่างเรนเดอร์ กรุณาลองส่งออกใหม่"));
                    return;
                  }
                  translatedImageCacheRef.current.set(pageUrl, renderedUrl);
                  const freshSig = getPageSignature?.(pageUrl) ?? "rev-0";
                  workspaceResourceManager.registerRenderedImage(pageId, freshSig, renderedUrl, approxBytes);
                  dirtyExportPagesRef.current.delete(pageUrl);
                  resolve(renderedUrl);
                },
                textStyleRef as unknown as React.MutableRefObject<OverlayTextStyle>,
                undefined,
                pageUrl,
                undefined,
                getPageTargetLanguage(pageUrl),
              );
            };

            offscreenImg.onload = () => startRender();
            offscreenImg.onerror = () => fail("โหลดภาพไม่สำเร็จ");

            if (offscreenImg.complete && offscreenImg.naturalWidth > 0 && offscreenImg.src === targetSrc) {
              startRender();
            } else {
              offscreenImg.src = targetSrc;
            }
          });
        } catch (err) {
          console.warn(`Offscreen render failed for page ${index + 1}`, err);
          throw err instanceof Error ? err : new Error(String(err));
        }
      }
      return cleaningResultsByPage.get(pageUrl)?.cleanUrl ?? pageUrl;
    },
    [
      collectExportReviewPages,
      exportInputSignature,
      bubbleCacheRef,
      setTranslationResult,
      cleaningResultsByPage,
      textStyleRef,
      getPageTargetLanguage,
      translatedImageCacheRef,
      getPageSignature,
      dirtyExportPagesRef,
    ],
  );

  const executeDownloadAll = useCallback(
    async (format: "zip" | "cbz" | "pdf" | "strip" | "layered" = "zip") => {
      const activePages = exportSnapshotRef.current?.pages ?? [];
      if (activePages.length === 0) {
        allowUnreviewedExportRef.current = false;
        return;
      }
      const outputSignatures = new Map(activePages.map((page) => [page.url, exportInputSignature(page.url)]));
      const assertCurrentOutput = () => {
        if (
          collectExportReviewPages(activePages, undefined, allowUnreviewedExportRef.current).length ||
          activePages.some(
            (page) =>
              !page.exportExcluded &&
              normalizePageExportSource(page.exportSource) !== "original" &&
              outputSignatures.get(page.url) !== exportInputSignature(page.url),
          )
        ) {
          throw new Error("หลักฐานหรือข้อความเปลี่ยนระหว่างส่งออก กรุณาตรวจหน้าและส่งออกใหม่");
        }
      };
      setIsChoosingExport(false);
      setIsZipping(true);

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
            allowUnreviewedExportRef.current = false;
            exportSnapshotRef.current = null;
            return;
          }
        }
      }

      const failedExportPages: number[] = [];
      const exportErrors: string[] = [];
      const excludedCount = activePages.filter((page) => page.exportExcluded).length;
      const excludedNote = excludedCount > 0 ? ` — ตัด ${excludedCount} หน้าออกตามที่เลือก` : "";
      const reportRenderFailures = () => {
        setTranslationResult(
          `❌ Export ไม่สำเร็จที่หน้า ${failedExportPages.join(", ")} ${exportErrors.join("; ")} — ลองใหม่อีกครั้ง`,
        );
        setTimeout(() => setTranslationResult(null), 5000);
      };

      const getExportDataUrl = async (pageUrl: string, index: number): Promise<string> => {
        if (collectExportReviewPages(activePages, [index], allowUnreviewedExportRef.current).length) {
          throw new Error("กรุณาตรวจหลักฐานหน้านี้ใหม่ เลือกต้นฉบับ หรือข้ามหน้า");
        }
        const selectedUrl = await resolvePageExportUrl(
          activePages[index],
          cleaningResultsByPage.get(pageUrl)?.cleanUrl,
          () => renderExportImage(pageUrl, index, activePages),
        );
        return selectedUrl.startsWith("data:") ? selectedUrl : blobToDataUrl(await exportImageBlob(selectedUrl));
      };

      if (format === "layered") {
        try {
          setTranslationResult("⏳ กำลังสร้างแพ็กเกจแยกเลเยอร์ (Photoshop / Photopea Pack)...");
          const layeredZip = new JSZip();
          let layeredCount = 0;
          for (let i = 0; i < activePages.length; i++) {
            const p = activePages[i];
            if (p.exportExcluded) continue;
            const numStr = String(i + 1).padStart(3, "0");
            const folder = layeredZip.folder(`Page_${numStr}`);
            if (!folder) continue;
            const origName = `page_${numStr}_original.png`;
            const cleanName = `page_${numStr}_inpainted.png`;
            try {
              const origBlob = await exportImageBlob(p.url);
              folder.file(origName, origBlob);
            } catch {}
            const cleanUrl = cleaningResultsByPage.get(p.url)?.cleanUrl;
            if (cleanUrl) {
              try {
                const cleanBlob = await exportImageBlob(cleanUrl);
                folder.file(cleanName, cleanBlob);
              } catch {}
            }
            const bubbles = bubbleCacheRef.current.get(p.url) ?? [];
            folder.file(
              `page_${numStr}_layers.json`,
              JSON.stringify({ page: i + 1, name: p.name, bubbles }, null, 2),
            );
            folder.file(
              `build_layered_page_${numStr}.jsx`,
              generatePhotoshopBuildScript(i + 1, origName, cleanName, bubbles),
            );
            layeredCount++;
          }
          const content = await layeredZip.generateAsync({ type: "blob", compression: "DEFLATE" });
          await saveBlob(content, "SuperK_Layered_Photoshop_Pack.zip", destDir);
          setTranslationResult(`✅ ดาวน์โหลดแพ็กเกจแยกเลเยอร์สำเร็จ! (${layeredCount} หน้า)${excludedNote}`);
          setTimeout(() => setTranslationResult(null), 3000);
        } catch (err) {
          console.error("Failed to export layered pack", err);
          setTranslationResult("❌ เกิดข้อผิดพลาดในการสร้างแพ็กเกจแยกเลเยอร์");
          setTimeout(() => setTranslationResult(null), 3000);
        } finally {
          setIsZipping(false);
          allowUnreviewedExportRef.current = false;
          exportSnapshotRef.current = null;
        }
        return;
      }

      if (format === "strip") {
        try {
          setTranslationResult(`⏳ กำลังโหลดและรวมภาพแบบ Webtoon Strip...`);
          const loadedImages: HTMLImageElement[] = [];
          const targetWidth = 1200;

          for (let i = 0; i < activePages.length; i++) {
            if (activePages[i].exportExcluded) continue;
            try {
              const dataUrl = await getExportDataUrl(activePages[i].url, i);
              if (!dataUrl) {
                failedExportPages.push(i + 1);
                continue;
              }
              const img = new Image();
              img.src = dataUrl;
              await new Promise<void>((resolve) => {
                const timer = setTimeout(() => resolve(), 3000);
                img.onload = () => {
                  clearTimeout(timer);
                  resolve();
                };
                img.onerror = () => {
                  clearTimeout(timer);
                  resolve();
                };
              });
              if (img.naturalWidth && img.naturalHeight) {
                loadedImages.push(img);
              } else {
                failedExportPages.push(i + 1);
              }
            } catch (err) {
              console.warn(`Error loading page ${i + 1} for long strip`, err);
              failedExportPages.push(i + 1);
              exportErrors.push(err instanceof Error ? err.message : String(err));
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
          const stagedChunks: Blob[] = [];

          const exportChunk = async (chunk: { img: HTMLImageElement; height: number }[]) => {
            const totalH = chunk.reduce((sum, item) => sum + item.height, 0);
            const stripCanvas = document.createElement("canvas");
            stripCanvas.width = targetWidth;
            stripCanvas.height = totalH;
            const ctx = stripCanvas.getContext("2d");
            if (!ctx) throw new Error("ไม่สามารถสร้างภาพ Strip");

            let yOffset = 0;
            for (const item of chunk) {
              ctx.drawImage(item.img, 0, yOffset, targetWidth, item.height);
              yOffset += item.height;
            }

            const blob = await new Promise<Blob>((resolve, reject) => {
              stripCanvas.toBlob(
                (result) => (result ? resolve(result) : reject(new Error("ไม่สามารถสร้างภาพ Strip"))),
                "image/jpeg",
                0.92,
              );
            });
            stripCanvas.width = 0;
            stripCanvas.height = 0;
            assertCurrentOutput();
            stagedChunks.push(blob);
          };

          for (const img of loadedImages) {
            const scaledHeight = Math.round((targetWidth / img.naturalWidth) * img.naturalHeight);
            if (currentHeight + scaledHeight > MAX_STRIP_HEIGHT && currentChunk.length > 0) {
              await exportChunk(currentChunk);
              currentChunk = [];
              currentHeight = 0;
            }
            currentChunk.push({ img, height: scaledHeight });
            currentHeight += scaledHeight;
          }

          if (currentChunk.length > 0) {
            await exportChunk(currentChunk);
          }

          let releaseBlob = stagedChunks[0];
          let releaseFilename = generateStripFilename(1, stagedChunks.length, activePages);
          if (stagedChunks.length > 1) {
            const archive = new JSZip();
            for (let i = 0; i < stagedChunks.length; i++) {
              const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as ArrayBuffer);
                reader.onerror = () => reject(reader.error);
                reader.readAsArrayBuffer(stagedChunks[i]);
              });
              archive.file(generateStripFilename(i + 1, stagedChunks.length, activePages), bytes);
            }
            releaseBlob = await archive.generateAsync({ type: "blob" });
            releaseFilename = generateStripFilename(1, 1, activePages).replace(/\.jpg$/, ".zip");
          }
          assertCurrentOutput();
          const savedName = await saveBlob(releaseBlob, releaseFilename, destDir);
          if (savedName && savedName !== releaseFilename) {
            const toast = (await import("react-hot-toast")).default;
            toast.success(`บันทึกเป็น "${savedName}" (พบไฟล์ชื่อซ้ำ)`);
          }

          const folderLabel = destDir?.name ? ` ใน "${destDir.name}"` : "";
          setTranslationResult(
            `✅ ดาวน์โหลดภาพยาว${stagedChunks.length > 1 ? " รวมทุกส่วนใน ZIP" : ""}${folderLabel} สำเร็จ! (${loadedImages.length} หน้า)${excludedNote}`,
          );
          setTimeout(() => setTranslationResult(null), 3000);
        } catch (e) {
          console.error("Failed to generate long strip", e);
          setTranslationResult(`❌ เกิดข้อผิดพลาดในการรวมภาพ Webtoon Strip`);
          setTimeout(() => setTranslationResult(null), 3000);
        } finally {
          setIsZipping(false);
          allowUnreviewedExportRef.current = false;
          exportSnapshotRef.current = null;
        }
        return;
      }

      if (format === "pdf") {
        try {
          const pdf = new jsPDF({ orientation: "portrait", unit: "px" });
          let addedCount = 0;

          for (let i = 0; i < activePages.length; i++) {
            if (activePages[i].exportExcluded) continue;
            try {
              const dataUrl = await getExportDataUrl(activePages[i].url, i);
              if (!dataUrl) {
                failedExportPages.push(i + 1);
                continue;
              }

              const img = new Image();
              img.src = dataUrl;
              await new Promise<void>((resolve) => {
                const timer = setTimeout(() => resolve(), 3000);
                img.onload = () => {
                  clearTimeout(timer);
                  resolve();
                };
                img.onerror = () => {
                  clearTimeout(timer);
                  resolve();
                };
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

              const canvas = document.createElement("canvas");
              canvas.width = img.naturalWidth;
              canvas.height = img.naturalHeight;
              const context = canvas.getContext("2d");
              if (!context) throw new Error("ไม่สามารถสร้างภาพสำหรับ PDF");
              context.fillStyle = "#ffffff";
              context.fillRect(0, 0, canvas.width, canvas.height);
              context.drawImage(img, 0, 0);
              pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, img.naturalWidth, img.naturalHeight);
              canvas.width = 0;
              canvas.height = 0;
              addedCount++;
            } catch (err) {
              console.warn(`Error processing PDF page ${i + 1}`, err);
              failedExportPages.push(i + 1);
              exportErrors.push(err instanceof Error ? err.message : String(err));
            }
          }

          if (failedExportPages.length > 0) {
            reportRenderFailures();
            return;
          }

          if (addedCount > 0) {
            const pdfFilename = generateArchiveFilename("pdf", activePages);
            setTranslationResult(`⏳ กำลังบันทึก PDF...`);
            assertCurrentOutput();
            const savedName = await saveBlob(pdf.output("blob"), pdfFilename, destDir);
            const wasRenamed = savedName !== pdfFilename;
            const folderLabel = destDir?.name ? ` ใน "${destDir.name}"` : "";
            setTranslationResult(
              wasRenamed
                ? `✅ บันทึก ${savedName}${folderLabel} สำเร็จ! (พบชื่อซ้ำ จึงเปลี่ยนชื่อให้อัตโนมัติ)`
                : `✅ ดาวน์โหลด PDF${folderLabel} สำเร็จ! (${addedCount} หน้า)${excludedNote}`,
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
          allowUnreviewedExportRef.current = false;
          exportSnapshotRef.current = null;
        }
        return;
      }

      const zip = new JSZip();
      let zipAddedCount = 0;

      for (let i = 0; i < activePages.length; i++) {
        if (activePages[i].exportExcluded) continue;
        try {
          if (collectExportReviewPages(activePages, [i], allowUnreviewedExportRef.current).length) {
            throw new Error("กรุณาตรวจหลักฐานหน้านี้ใหม่ เลือกต้นฉบับ หรือข้ามหน้า");
          }
          const selectedUrl = await resolvePageExportUrl(
            activePages[i],
            cleaningResultsByPage.get(activePages[i].url)?.cleanUrl,
            () => renderExportImage(activePages[i].url, i, activePages),
          );
          const rawBlob = await exportImageBlob(selectedUrl);
          const blob = await convertExportBlobToFormat(
            rawBlob,
            exportImageFormatRef.current,
            exportFormatExplicitRef.current,
          );
          const filename = exportImageFilename(activePages[i].name, i, blob.type);
          const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as ArrayBuffer);
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(blob);
          });
          zip.file(filename, bytes);
          zipAddedCount++;
        } catch (err) {
          console.warn(`Error processing ZIP page ${i + 1}`, err);
          failedExportPages.push(i + 1);
          exportErrors.push(err instanceof Error ? err.message : String(err));
        }
      }

      if (failedExportPages.length > 0) {
        reportRenderFailures();
        setIsZipping(false);
        allowUnreviewedExportRef.current = false;
        exportSnapshotRef.current = null;
        return;
      }

      try {
        if (zipAddedCount > 0) {
          if (format === "cbz") {
            const xml = generateComicInfoXml({
              title: activePages[0]?.name?.replace(/\.[^/.]+$/, "") || "Manga Translation",
              pageCount: zipAddedCount,
              languageISO: (() => {
                const targets = activePages.map((page) => getPageTargetLanguage(page.url));
                if (targets.some((target) => !target)) return "und";
                const languages = [...new Set(targets.map((target) => target!.split("-")[0]))];
                return languages.length === 1 ? languages[0] : "mul";
              })(),
            });
            zip.file("ComicInfo.xml", xml);
          }

          const archiveFilename = generateArchiveFilename(format, activePages);
          setTranslationResult(`⏳ กำลังสร้างไฟล์ ${format.toUpperCase()}...`);
          const content = await zip.generateAsync({ type: "blob" });
          assertCurrentOutput();
          const savedName = await saveBlob(content, archiveFilename, destDir);
          const wasRenamed = savedName !== archiveFilename;
          const folderLabel = destDir?.name ? ` ใน "${destDir.name}"` : "";
          setTranslationResult(
            wasRenamed
              ? `✅ บันทึก ${savedName}${folderLabel} สำเร็จ! (พบชื่อซ้ำ จึงเปลี่ยนชื่อให้อัตโนมัติ)`
              : `✅ ดาวน์โหลด ${format.toUpperCase()}${folderLabel} สำเร็จ! (${zipAddedCount} หน้า)${excludedNote}`,
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
        allowUnreviewedExportRef.current = false;
        exportSnapshotRef.current = null;
      }
    },
    [
      exportInputSignature,
      collectExportReviewPages,
      setTranslationResult,
      cleaningResultsByPage,
      renderExportImage,
      getPageTargetLanguage,
    ],
  );

  const handleDownloadAll = useCallback(
    async (format: "zip" | "cbz" | "pdf" | "strip" | "layered" = "zip") => {
      if (pages.length === 0) return;

      const unconfirmed = collectExportReviewPages(exportSnapshotRef.current?.pages ?? pages);
      if (unconfirmed.length > 0) {
        pendingReviewIndicesRef.current = undefined;
        setUnconfirmedReviewPages(unconfirmed);
        setPendingExportAction(() => () => void executeDownloadAll(format));
        return;
      }

      await executeDownloadAll(format);
    },
    [pages, collectExportReviewPages, executeDownloadAll],
  );

  const executeSaveCurrentPageImage = useCallback(async () => {
    const activePages = exportSnapshotRef.current?.pages ?? [];
    const activeCurrentPage = exportSnapshotRef.current?.currentPage ?? 0;
    setIsChoosingExport(false);
    setIsZipping(true);
    try {
      const page = activePages[activeCurrentPage];
      if (!page) return;
      if (collectExportReviewPages(activePages, [activeCurrentPage], allowUnreviewedExportRef.current).length) {
        throw new Error("หน้านี้ยังต้องตรวจคำแปลหรือภาพพื้นหลัง กรุณาตรวจใหม่ เลือกต้นฉบับ หรือข้ามหน้า");
      }
      const beforeSignature = exportInputSignature(page.url);
      const url = await resolvePageExportUrl(
        page,
        cleaningResultsByPage.get(page.url)?.cleanUrl,
        () => renderExportImage(page.url, activeCurrentPage, activePages),
      );
      const rawBlob = await exportImageBlob(url);
      const blob = await convertExportBlobToFormat(
        rawBlob,
        exportImageFormatRef.current,
        exportFormatExplicitRef.current,
      );
      const filename = exportImageFilename(page.name, activeCurrentPage, blob.type);
      let directory: DirectoryHandleLike | null = null;
      if (getAskExportDirectory() && isDirectoryPickerSupported()) {
        directory = await getOrPickExportDirectory();
        if (!directory) return;
      }
      if (
        collectExportReviewPages(activePages, [activeCurrentPage], allowUnreviewedExportRef.current).length ||
        (normalizePageExportSource(page.exportSource) !== "original" && beforeSignature !== exportInputSignature(page.url))
      ) {
        throw new Error("หลักฐานเปลี่ยนระหว่างส่งออก กรุณาตรวจหน้าอีกครั้ง");
      }
      await saveBlob(blob, filename, directory);
      setTranslationResult(`✅ บันทึก ${filename} สำเร็จ!`);
    } catch (error) {
      setTranslationResult(`❌ ส่งออกไม่สำเร็จ: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsZipping(false);
      allowUnreviewedExportRef.current = false;
      exportSnapshotRef.current = null;
    }
  }, [
    collectExportReviewPages,
    exportInputSignature,
    cleaningResultsByPage,
    renderExportImage,
    setTranslationResult,
  ]);

  const saveCurrentPageImage = useCallback(async () => {
    const unconfirmed = collectExportReviewPages(
      exportSnapshotRef.current?.pages ?? pages,
      [exportSnapshotRef.current?.currentPage ?? currentPage],
    );
    if (unconfirmed.length > 0) {
      pendingReviewIndicesRef.current = [exportSnapshotRef.current?.currentPage ?? currentPage];
      setUnconfirmedReviewPages(unconfirmed);
      setPendingExportAction(() => () => void executeSaveCurrentPageImage());
      return;
    }

    await executeSaveCurrentPageImage();
  }, [collectExportReviewPages, pages, currentPage, executeSaveCurrentPageImage]);

  const requestSinglePageExport = useCallback(async () => {
    const page = pages[currentPage];
    if (!page || isChoosingExport || isZipping) return;
    exportSnapshotRef.current = { pages: pages.map((p) => ({ ...p })), currentPage };
    setIsChoosingExport(true);
    const generation = ++reportScanGenerationRef.current;
    const result = await scanReadabilityPage(currentPage);
    if (generation !== reportScanGenerationRef.current) return;
    if (result.findings.length === 0 && !result.unavailableReason) {
      await saveCurrentPageImage();
      return;
    }
    const ackKey = readabilityAcknowledgmentKey([
      {
        pageUrl: page.url,
        revision: getPageSignature?.(page.url) ?? "rev-0",
        findings: result.findings,
        unavailable: result.unavailableReason,
      },
    ]);
    if (ackKey && acknowledgedReadabilityRef.current.has(ackKey)) {
      await saveCurrentPageImage();
      return;
    }
    const info = inspectTranslatedPages().find((item) => item.pageIndex === currentPage);
    const cleaning = cleaningResultsByPage.get(page.url);
    setExportReportRows([
      {
        pageIndex: currentPage,
        exportSource: normalizePageExportSource(page.exportSource),
        translated: Boolean(info),
        totalBubbles: info?.total ?? 0,
        contaminated: info?.contaminated ?? 0,
        invalidBoxes: info?.invalidBoxes ?? 0,
        pendingCleaning:
          cleaning?.regions.filter((region) => region.status === "needs_review").length ?? 0,
        readabilityFindings: result.findings,
        readabilityUnavailable: result.unavailableReason,
      },
    ]);
    setPendingReadabilityExport(() => () => {
      void saveCurrentPageImage();
    });
    setPendingReadabilityAck(ackKey);
    setIsExportReportOpen(true);
  }, [
    isChoosingExport,
    isZipping,
    pages,
    currentPage,
    scanReadabilityPage,
    getPageSignature,
    inspectTranslatedPages,
    cleaningResultsByPage,
    saveCurrentPageImage,
  ]);

  const requestBookExport = useCallback(
    async (format: "zip" | "cbz" | "pdf" | "strip" | "layered") => {
      if (pages.length === 0 || isChoosingExport || isZipping) return;
      exportSnapshotRef.current = { pages: pages.map((p) => ({ ...p })), currentPage };
      setIsChoosingExport(true);
      const generation = ++reportScanGenerationRef.current;
      const rows = buildExportReportRows();
      setExportReportRows(rows);
      setExportScanProgress({ completed: 0, total: rows.length });
      setPendingReadabilityAck(null);
      setPendingReadabilityExport(() => () => {
        void handleDownloadAll(format);
      });
      setIsExportReportOpen(true);

      let needsReview = false;
      const snapshots: ReadabilityPageSnapshot[] = [];
      for (const row of rows) {
        const page = pages[row.pageIndex];
        const result = await scanReadabilityPage(row.pageIndex);
        if (generation !== reportScanGenerationRef.current) return;
        needsReview ||= result.findings.length > 0 || Boolean(result.unavailableReason);
        snapshots.push({
          pageUrl: page.url,
          revision: getPageSignature?.(page.url) ?? "rev-0",
          findings: result.findings,
          unavailable: result.unavailableReason,
        });
        setExportReportRows((current) =>
          current.map((item) =>
            item.pageIndex === row.pageIndex
              ? { ...item, readabilityFindings: result.findings, readabilityUnavailable: result.unavailableReason }
              : item,
          ),
        );
        setExportScanProgress({ completed: row.pageIndex + 1, total: rows.length });
      }
      if (generation !== reportScanGenerationRef.current) return;
      setExportScanProgress(null);
      const ackKey = readabilityAcknowledgmentKey(snapshots);
      if (!needsReview || (ackKey && acknowledgedReadabilityRef.current.has(ackKey))) {
        closeExportReport();
        await handleDownloadAll(format);
      } else {
        setPendingReadabilityAck(ackKey);
      }
    },
    [
      pages,
      currentPage,
      isChoosingExport,
      isZipping,
      buildExportReportRows,
      handleDownloadAll,
      scanReadabilityPage,
      getPageSignature,
      closeExportReport,
    ],
  );

  const handleCancelReview = useCallback(() => {
    setUnconfirmedReviewPages(null);
    setPendingExportAction(null);
    setIsChoosingExport(false);
    allowUnreviewedExportRef.current = false;
    exportSnapshotRef.current = null;
  }, []);

  const handleProceedWithHold = useCallback(() => {
    const action = pendingExportAction;
    allowUnreviewedExportRef.current = true;
    setUnconfirmedReviewPages(null);
    setPendingExportAction(null);
    action?.();
  }, [pendingExportAction]);

  const handleProceedWithExport = useCallback(() => {
    const currentReview = collectExportReviewPages(
      exportSnapshotRef.current?.pages ?? pages,
      pendingReviewIndicesRef.current,
    );
    const shown = new Map(unconfirmedReviewPages?.map((p) => [p.pageUrl, p]) ?? []);
    const hasNewWarning = currentReview.some((p) => {
      const previous = shown.get(p.pageUrl);
      return (
        !previous ||
        previous.missingTranslationSignature !== p.missingTranslationSignature ||
        previous.hasUncertainCleaning !== p.hasUncertainCleaning ||
        previous.hasUncertainTranslation !== p.hasUncertainTranslation ||
        previous.hasHardBlockers !== p.hasHardBlockers ||
        previous.scriptIssueCount !== p.scriptIssueCount ||
        previous.unverifiedReviewCount !== p.unverifiedReviewCount ||
        previous.targetUnconfirmed !== p.targetUnconfirmed ||
        previous.backgroundBlocked !== p.backgroundBlocked
      );
    });
    if (hasNewWarning) {
      setUnconfirmedReviewPages(currentReview);
      return;
    }
    unconfirmedReviewPages?.forEach((p) => {
      explicitlyApprovedExportPagesRef.current.add(p.pageUrl);
      confirmAllPageReviews?.(p.pageUrl);
      confirmAllPageRemnants?.(p.pageUrl, getExpectedRemnantEvidence(p.pageUrl));
      confirmedMissingTranslationsRef.current.set(p.pageUrl, p.missingTranslationSignature);
      confirmedPagesRef.current.add(p.pageUrl);
    });
    setConfirmedPages((prev) => {
      const next = new Set(prev);
      unconfirmedReviewPages?.forEach((p) => next.add(p.pageUrl));
      return next;
    });
    const action = pendingExportAction;
    setUnconfirmedReviewPages(null);
    setPendingExportAction(null);
    action?.();
  }, [
    collectExportReviewPages,
    pages,
    unconfirmedReviewPages,
    confirmAllPageReviews,
    confirmAllPageRemnants,
    getExpectedRemnantEvidence,
    confirmedMissingTranslationsRef,
    confirmedPagesRef,
    setConfirmedPages,
    pendingExportAction,
  ]);

  const handleNavigateToReviewPage = useCallback(
    (pageIndex: number) => {
      exportSnapshotRef.current = null;
      setIsChoosingExport(false);
      setCurrentPage(pageIndex);
      setUnconfirmedReviewPages(null);
      setPendingExportAction(null);
    },
    [setCurrentPage],
  );

  const handleCloseExportReport = useCallback(() => {
    if (isZipping) return;
    closeExportReport();
    exportSnapshotRef.current = null;
  }, [isZipping, closeExportReport]);

  const handleSelectReportPage = useCallback(
    (pageIndex: number) => {
      closeExportReport();
      exportSnapshotRef.current = null;
      setViewLayout("single");
      setCurrentPage(pageIndex);
    },
    [closeExportReport, setViewLayout, setCurrentPage],
  );

  return {
    isChoosingExport,
    setIsChoosingExport,
    isZipping,
    setIsZipping,
    unconfirmedReviewPages,
    setUnconfirmedReviewPages,
    pendingExportAction,
    setPendingExportAction,
    pendingReviewIndicesRef,
    exportSnapshotRef,
    allowUnreviewedExportRef,
    explicitlyApprovedExportPagesRef,

    exportImageFormat,
    setExportImageFormat,

    isExportReportOpen,
    exportReportRows,
    exportScanProgress,
    pendingReadabilityExport,
    handleOpenExportReport,
    closeExportReport,
    continueReadabilityExport,
    selectReadabilityFinding,

    buildExportReportRows,
    scanReadabilityPage,
    collectExportReviewPages,
    exportInputSignature,
    renderExportImage,

    substituteExportPageWithOriginal,
    excludeExportPage,
    approveExportPageInPlace,
    approveAllExportPagesInPlace,

    executeDownloadAll,
    handleDownloadAll,
    executeSaveCurrentPageImage,
    saveCurrentPageImage,
    requestSinglePageExport,
    requestBookExport,

    handleCancelReview,
    handleProceedWithHold,
    handleProceedWithExport,
    handleNavigateToReviewPage,
    handleCloseExportReport,
    handleSelectReportPage,
  };
}
