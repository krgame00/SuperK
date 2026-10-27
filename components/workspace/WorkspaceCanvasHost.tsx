"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
  type SetStateAction,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Contrast,
  Eraser,
  Eye,
  EyeOff,
  Loader2,
  Sparkles,
  Upload,
} from "lucide-react";

import {
  CleaningToolbar,
  type WorkspaceLayer,
} from "@/components/cleaning/CleaningToolbar";
import { PageReviewNotice } from "@/components/cleaning/PageReviewNotice";
import { PageViewer } from "@/components/workspace/PageViewer";
import { StudioToolbar, type StudioTool } from "@/components/editing/StudioToolbar";
import { OcrAreaTool, type PixelRect as OcrPixelRect } from "@/components/editing/OcrAreaTool";
import { TranscriptModal, type TranscriptPageData } from "@/components/editing/TranscriptModal";
import { GlossaryModal } from "@/components/editing/GlossaryModal";
import { WarpPanel } from "@/components/editing/WarpPanel";
import { ImageLayerPanel } from "@/components/editing/ImageLayerPanel";
import { TextPropertiesPanel } from "@/components/editing/TextPropertiesPanel";
import { TextLayerCanvas } from "@/components/editing/TextLayerCanvas";
import { ColorMatchStatus } from "@/components/colorMatching/ColorMatchStatus";
import { WorkspaceExportButtons } from "@/components/workspace/WorkspaceExportButtons";
import { useTextLayers } from "@/hooks/useTextLayers";
import type { ImageLayer, TextLayer, WarpEffect } from "@/lib/editing/commands";
import type { TranslatedBubble } from "@/lib/translationOverlay";
import type { GlossaryEntry } from "@/lib/translation/glossary";
import type { BwContrastMode } from "@/lib/colorMatching/types";
import type { PageCleaningResult, CleaningHookError } from "@/hooks/useCleaning";
import type { CleaningProgress } from "@/lib/cleaning/types";
import {
  normalizePageExportSource,
  type ExportImageFormat,
  type PageExportSource,
} from "@/lib/export/pageSource";
import type { WorkspaceExportPage } from "@/hooks/useExportOrchestrator";
import type { BatchPageFailure } from "@/hooks/useTranslation";
import { resolveTargetLanguage } from "@/lib/languagePolicy";

export type OrganizeTargetMode = "readable" | "xlarge" | "original";

export interface SavedSessionSnapshot {
  pages: WorkspaceExportPage[];
  currentPage?: number;
  hasUnrecoverableSources?: boolean;
  bubbleCache?: Map<string, unknown>;
  translatedImageCache?: Map<string, unknown>;
}

export interface WorkspaceCanvasHostProps {
  // Focus Mode
  isFocusMode: boolean;
  isFocusToolbarVisible: boolean;
  onToggleFocusToolbar: () => void;
  onExitFocusMode: () => void;

  // Pages & Viewport
  pages: WorkspaceExportPage[];
  currentPage: number;
  onPageChange: (updater: SetStateAction<number>) => void;
  onRemovePage: (index: number) => void;
  onImageError: (url: string) => void;
  viewLayout: "single" | "scroll";
  onViewLayoutChange: (layout: "single" | "scroll") => void;
  onToggleFocusMode: () => void;
  isThumbnailsCollapsed: boolean;

  // Dragging & Uploading
  isDragging: boolean;
  isImporting: boolean;
  importStatusMessage?: string;
  onImageUpload: (event: ChangeEvent<HTMLInputElement>) => void;

  // Saved Session Banner
  savedSessionData: SavedSessionSnapshot | null;
  onRestoreSavedSession: () => void | Promise<void>;
  onClearSavedSession: () => void;

  // Workflow message / status
  workflowMessage: string | null;
  translationResult: string | null;
  onDismissTranslationResult: () => void;
  modelPreference: string;
  onSwitchToAutoModel: () => void;

  // Toolbar state & controls
  toolbarPosition: "top" | "bottom";
  onToggleToolbarPosition: () => void;
  isToolbarCollapsed: boolean;
  onToggleToolbarCollapsed: () => void;
  workspaceLayer: WorkspaceLayer;
  onLayerChange: (layer: WorkspaceLayer) => void;
  operationBusy: boolean;

  // Cleaning & Translation state for toolbar
  currentCleaningResult: PageCleaningResult | null | undefined;
  hasCurrentTranslation: boolean;
  cleaningProgress?: CleaningProgress;
  cleaningError?: CleaningHookError;
  onCleanCurrentPage: () => void;
  onEditMask: () => void;

  // Export settings inside toolbar
  targetLang: string;
  pageTargetCache: Map<string, { targetId?: string }>;
  isExportBusy: boolean;
  onPageExportSourceChange: (pageIndex: number, source: PageExportSource) => void;
  exportImageFormat: ExportImageFormat;
  onExportImageFormatChange: (format: ExportImageFormat) => void;

  // Auto-organize menu actions
  onAutoOrganizeCurrentPage: (mode?: OrganizeTargetMode) => void;
  onAutoOrganizeAllPages: (mode?: OrganizeTargetMode) => void;

  // B/W Contrast menu actions
  onApplyBwContrastCurrentPage: (mode: BwContrastMode) => void;
  onApplyBwContrastAllPages: (mode: BwContrastMode) => void;

  // Review & diagnostics
  isPageReviewRequired: boolean;
  onConfirmPageReview: () => void;
  batchFailures: BatchPageFailure[];
  onOpenDiagnostics: () => void;
  onRetryFailedPages: () => void;

  // PageViewer image layers
  cleaningResultsByPage: Map<string, PageCleaningResult>;
  translatedImagesMap: Map<string, string>;
  brokenPages: Set<string>;

  // Optional Studio Tools integration (Ctrl+1..7 / Text / OCR / FindReplace / Shortcuts)
  onOpenFindReplace?: () => void;
  onOpenShortcuts?: () => void;
  onAddManualTextBubble?: () => void;
  onDetectOcrRegion?: (rect: OcrPixelRect) => void | Promise<void>;
  transcriptPagesData?: TranscriptPageData[];
  onApplyTranscriptUpdates?: (updatesByPageUrl: Map<string, Map<number, string>>) => void;
  onExportLayeredArchive?: () => void;
  glossary?: GlossaryEntry[];
  onGlossaryChange?: (entries: GlossaryEntry[]) => void;
  onAutoExtractGlossary?: () => void;
  onQuickExport?: (kind: "image" | "pdf" | "strip" | "zip" | "cbz" | "layered") => void;
}

export function WorkspaceCanvasHost({
  isFocusMode,
  isFocusToolbarVisible,
  onToggleFocusToolbar,
  onExitFocusMode,
  pages,
  currentPage,
  onPageChange,
  onRemovePage,
  onImageError,
  viewLayout,
  onViewLayoutChange,
  onToggleFocusMode,
  isThumbnailsCollapsed,
  isDragging,
  isImporting,
  importStatusMessage,
  onImageUpload,
  savedSessionData,
  onRestoreSavedSession,
  onClearSavedSession,
  workflowMessage,
  translationResult,
  onDismissTranslationResult,
  modelPreference,
  onSwitchToAutoModel,
  toolbarPosition,
  onToggleToolbarPosition,
  isToolbarCollapsed,
  onToggleToolbarCollapsed,
  workspaceLayer,
  onLayerChange,
  operationBusy,
  currentCleaningResult,
  hasCurrentTranslation,
  cleaningProgress,
  cleaningError,
  onCleanCurrentPage,
  onEditMask,
  targetLang,
  pageTargetCache,
  isExportBusy,
  onPageExportSourceChange,
  exportImageFormat,
  onExportImageFormatChange,
  onAutoOrganizeCurrentPage,
  onAutoOrganizeAllPages,
  onApplyBwContrastCurrentPage,
  onApplyBwContrastAllPages,
  isPageReviewRequired,
  onConfirmPageReview,
  batchFailures,
  onOpenDiagnostics,
  onRetryFailedPages,
  cleaningResultsByPage,
  translatedImagesMap,
  brokenPages,
  onOpenFindReplace,
  onOpenShortcuts,
  onAddManualTextBubble,
  onDetectOcrRegion,
  transcriptPagesData,
  onApplyTranscriptUpdates,
  onExportLayeredArchive,
  glossary = [],
  onGlossaryChange,
  onAutoExtractGlossary,
  onQuickExport,
}: WorkspaceCanvasHostProps): ReactElement {
  const [isOrganizeMenuOpen, setIsOrganizeMenuOpen] = useState(false);
  const organizeMenuRef = useRef<HTMLDivElement>(null);
  const [isBwContrastMenuOpen, setIsBwContrastMenuOpen] = useState(false);
  const bwContrastMenuRef = useRef<HTMLDivElement>(null);
  const [activeStudioTool, setActiveStudioTool] = useState<StudioTool>("select");
  const [isTranscriptModalOpen, setIsTranscriptModalOpen] = useState(false);
  const [isGlossaryModalOpen, setIsGlossaryModalOpen] = useState(false);
  const [inspectorScope, setInspectorScope] = useState<"this-page" | "all-pages">("this-page");
  const [, setInspectorTick] = useState(0);
  const [selectedBubbleBridge, setSelectedBubbleBridge] = useState<{
    bubble: TranslatedBubble;
    bubbleId: string;
    getFontSize: () => number;
    applyUpdates: (updates: Record<string, unknown>) => void;
    deleteBubble: () => void;
    reanalyzeColor: () => void;
  } | null>(null);
  const imageLayerInputRef = useRef<HTMLInputElement>(null);
  const [imageLayersByPage, setImageLayersByPage] = useState<Record<string, ImageLayer[]>>({});
  const [selectedImageLayerId, setSelectedImageLayerId] = useState<string | null>(null);
  const activePageUrlKey = pages[currentPage]?.url ?? "page_0";
  const textLayersManager = useTextLayers({ pageId: activePageUrlKey });
  const currentPageImageLayers = imageLayersByPage[activePageUrlKey] ?? [];
  const selectedImageLayer =
    currentPageImageLayers.find((l) => l.id === selectedImageLayerId) ?? null;

  useEffect(() => {
    const handleBubbleSelected = (e: Event) => {
      const custom = e as CustomEvent;
      setSelectedBubbleBridge(custom.detail ?? null);
      if (custom.detail) {
        setSelectedImageLayerId(null);
      }
    };
    window.addEventListener("superk:bubble-selected", handleBubbleSelected);
    return () => window.removeEventListener("superk:bubble-selected", handleBubbleSelected);
  }, []);

  useEffect(() => {
    if (!isOrganizeMenuOpen && !isBwContrastMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        organizeMenuRef.current &&
        !organizeMenuRef.current.contains(e.target as Node)
      ) {
        setIsOrganizeMenuOpen(false);
      }
      if (
        bwContrastMenuRef.current &&
        !bwContrastMenuRef.current.contains(e.target as Node)
      ) {
        setIsBwContrastMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, [isOrganizeMenuOpen, isBwContrastMenuOpen]);

  const activePage = pages[currentPage];

  return (
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
            onClick={onToggleFocusToolbar}
            aria-label={
              isFocusToolbarVisible
                ? "ซ่อนแถบเครื่องมือคลีน (B)"
                : "แสดงแถบเครื่องมือคลีน (B)"
            }
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
            onClick={onExitFocusMode}
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
              onDismissTranslationResult();
            }
          }}
          role="status"
          aria-live="polite"
          className={`fixed left-1/2 -translate-x-1/2 z-40 bg-surface/90 backdrop-blur-md border border-primary/30 text-foreground px-4 py-1.5 rounded-full text-xs font-semibold shadow-lg animate-in fade-in duration-300 flex items-center gap-2 max-w-[90vw] truncate transition-all cursor-pointer hover:bg-surface select-none ${
            isFocusMode
              ? "bottom-5 sm:bottom-6 slide-in-from-bottom-2"
              : toolbarPosition === "top"
                ? isThumbnailsCollapsed
                  ? "bottom-12 sm:bottom-12 slide-in-from-bottom-2"
                  : "bottom-32 sm:bottom-34 slide-in-from-bottom-2"
                : "top-16 sm:top-18 slide-in-from-top-2"
          }`}
          title="คลิกเพื่อปิดการแจ้งเตือน"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" />
          <span className="truncate">{workflowMessage}</span>
          {modelPreference !== "auto" &&
            translationResult?.startsWith("แปลไม่สำเร็จ") && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onSwitchToAutoModel();
                }}
                className="shrink-0 rounded border border-primary/40 px-2 py-0.5 text-primary hover:bg-primary/10"
              >
                เปลี่ยนเป็น Auto
              </button>
            )}
          {translationResult && (
            <span className="ml-1 text-muted hover:text-foreground text-xs leading-none">
              &times;
            </span>
          )}
        </div>
      )}

      {pages.length > 0 ? (
        <div
          className={`w-full flex-1 min-h-0 flex flex-col items-center relative overflow-hidden transition-all duration-200 ${
            isFocusMode
              ? "p-0"
              : isThumbnailsCollapsed
                ? "px-1 pb-9"
                : "px-1 pb-29 sm:pb-31"
          }`}
        >
          {/* Top controls participate in layout so they never cover manga content.
              Bottom controls intentionally remain floating above PageFilmstrip */}
          <div
            data-page-controls-dock={toolbarPosition}
            className={`w-full z-40 flex justify-center pointer-events-none px-2 transition-all duration-300 ease-out ${
              toolbarPosition === "top"
                ? "relative shrink-0"
                : `absolute ${
                    isFocusMode
                      ? "bottom-3 sm:bottom-4"
                      : isThumbnailsCollapsed
                        ? "bottom-12 sm:bottom-12"
                        : "bottom-32 sm:bottom-34"
                  } left-1/2 -translate-x-1/2`
            } ${
              isFocusMode && !isFocusToolbarVisible
                ? `${toolbarPosition === "top" ? "-translate-y-24" : "translate-y-24"} opacity-0 pointer-events-none max-h-0 py-0 overflow-hidden`
                : `${toolbarPosition === "top" ? "translate-y-0 pt-2.5 pb-2" : "translate-y-0 py-0"} opacity-100`
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
                    onClick={onToggleToolbarCollapsed}
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

                  {isPageReviewRequired && (
                    <button
                      type="button"
                      onClick={onToggleToolbarCollapsed}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-500 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full hover:bg-amber-500/20 transition-colors cursor-pointer"
                      title="หน้านี้ต้องการการตรวจทาน (คลิกเพื่อดู)"
                    >
                      <span>⚠️ ตรวจทาน</span>
                    </button>
                  )}

                  {batchFailures.length > 0 && (
                    <button
                      type="button"
                      onClick={onToggleToolbarCollapsed}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-red-400 bg-red-500/10 border border-red-500/30 px-2 py-0.5 rounded-full hover:bg-red-500/20 transition-colors cursor-pointer"
                      title={`แปลไม่สำเร็จ ${batchFailures.length} หน้า (คลิกเพื่อดู)`}
                    >
                      <span>❌ {batchFailures.length}</span>
                    </button>
                  )}

                  <div className="h-3.5 w-px bg-border/60 mx-0.5" />

                  <button
                    type="button"
                    onClick={onToggleToolbarPosition}
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
                    onClean={onCleanCurrentPage}
                    onEditMask={onEditMask}
                    onLayerChange={onLayerChange}
                    progress={cleaningProgress}
                    error={cleaningError}
                    position={toolbarPosition}
                    onTogglePosition={onToggleToolbarPosition}
                    onCollapse={onToggleToolbarCollapsed}
                    className="relative z-30 flex flex-wrap sm:flex-nowrap w-full max-w-5xl items-center justify-between gap-1.5 sm:gap-2 rounded-xl border border-border/80 bg-surface/90 px-2 sm:px-3 py-1.5 shadow-xl backdrop-blur-md transition-all overflow-visible"
                  >
                    {activePage && (
                      <div className="flex flex-nowrap items-center gap-1.5 sm:gap-2 text-xs shrink-0 select-none">
                        <label className="flex flex-nowrap items-center gap-1.5 sm:gap-2 text-xs shrink-0 select-none">
                          <span className="sr-only">
                            หน้า {currentPage + 1} · ส่งออกหน้านี้เป็น
                          </span>
                          <span
                            aria-hidden="true"
                            className="font-medium text-foreground/80 whitespace-nowrap hidden xl:inline text-xs"
                          >
                            หน้า {currentPage + 1} ·
                          </span>
                          <span
                            aria-hidden="true"
                            className="font-medium text-foreground/70 whitespace-nowrap hidden sm:inline text-xs"
                          >
                            ส่งออก:
                          </span>
                          {(() => {
                            const cachedTargetId = pageTargetCache.get(
                              activePage.url,
                            )?.targetId;
                            const target = resolveTargetLanguage(
                              cachedTargetId ?? targetLang,
                            );
                            const isResolved = target.status === "resolved";
                            const langLabel = isResolved
                              ? target.profile.label
                              : targetLang || "ไทย";
                            return (
                              <span
                                aria-label="ภาษาคำแปลของหน้า"
                                className="hidden 2xl:inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20 shadow-xs whitespace-nowrap shrink-0"
                              >
                                <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                                <span>{langLabel}</span>
                              </span>
                            );
                          })()}
                          <div className="relative inline-flex items-center shrink-0">
                            <select
                              aria-label="ส่งออกหน้านี้เป็น"
                              className="appearance-none cursor-pointer rounded-lg border border-border/80 bg-background/90 hover:bg-surface-hover active:bg-surface-active px-2 sm:px-2.5 py-1 pr-5.5 text-xs font-semibold text-foreground transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-40 disabled:cursor-not-allowed shadow-xs shrink-0"
                              value={normalizePageExportSource(
                                activePage.exportSource,
                              )}
                              disabled={isExportBusy}
                              onChange={(event) => {
                                if (isExportBusy) return;
                                const source = normalizePageExportSource(
                                  event.target.value,
                                );
                                onPageExportSourceChange(currentPage, source);
                              }}
                            >
                              <option value="translated">พร้อมคำแปล</option>
                              <option value="original">ต้นฉบับ</option>
                              <option
                                value="clean"
                                disabled={!currentCleaningResult?.cleanUrl}
                              >
                                ภาพคลีน
                              </option>
                            </select>
                            <ChevronDown className="pointer-events-none absolute right-1.5 h-3 w-3 text-muted" />
                          </div>
                        </label>
                        <div className="relative inline-flex items-center shrink-0">
                          <select
                            aria-label="สกุลไฟล์ภาพส่งออก"
                            title="กำหนดให้ไฟล์ภาพตอนส่งออก (ZIP / CBZ / รูปหน้านี้) มีนามสกุลเดียวกันทั้งหมด"
                            className="appearance-none cursor-pointer rounded-lg border border-border/80 bg-background/90 hover:bg-surface-hover active:bg-surface-active px-2 py-1 pr-5 text-xs font-semibold text-foreground transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-40 disabled:cursor-not-allowed shadow-xs shrink-0"
                            value={exportImageFormat}
                            disabled={isExportBusy}
                            onChange={(event) => {
                              if (isExportBusy) return;
                              onExportImageFormatChange(
                                event.target.value as ExportImageFormat,
                              );
                            }}
                          >
                            <option value="jpg">สกุล .JPG ทั้งหมด</option>
                            <option value="png">สกุล .PNG ทั้งหมด</option>
                            <option value="webp">สกุล .WEBP ทั้งหมด</option>
                            <option value="auto">สกุลตามไฟล์จริง</option>
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-1.5 h-3 w-3 text-muted" />
                        </div>
                        {hasCurrentTranslation &&
                          workspaceLayer === "translated" && (
                            <>
                              <div
                                ref={organizeMenuRef}
                                className="relative inline-flex items-center rounded-lg border border-primary/40 bg-primary/10 shadow-xs shrink-0"
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    setIsOrganizeMenuOpen(false);
                                    onAutoOrganizeCurrentPage();
                                  }}
                                  disabled={operationBusy}
                                  aria-label="จัดระเบียบข้อความออโต้"
                                  title="จัดระเบียบบับเบิลหน้านี้ให้อัตโนมัติ (Auto-Fit & De-overlap)"
                                  className="inline-flex h-7 sm:h-7.5 items-center gap-1 hover:bg-primary/20 active:bg-primary/30 px-2 text-xs font-semibold text-primary transition-all duration-150 cursor-pointer select-none rounded-l-lg disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  <Sparkles
                                    className="h-3 w-3 text-primary shrink-0"
                                    aria-hidden="true"
                                  />
                                  <span className="hidden sm:inline">
                                    จัดระเบียบ
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setIsBwContrastMenuOpen(false);
                                    setIsOrganizeMenuOpen((prev) => !prev);
                                  }}
                                  disabled={operationBusy}
                                  aria-label="ตัวเลือกจัดระเบียบบับเบิล"
                                  title="ตัวเลือกจัดระเบียบหน้านี้ หรือทุกหน้า"
                                  className="inline-flex h-7 sm:h-7.5 items-center px-1 border-l border-primary/30 hover:bg-primary/20 active:bg-primary/30 text-primary transition-all duration-150 cursor-pointer rounded-r-lg disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  <ChevronDown className="h-3 w-3 shrink-0" />
                                </button>
                                {isOrganizeMenuOpen && (
                                  <div
                                    role="menu"
                                    aria-label="เมนูตัวเลือกจัดระเบียบบับเบิล"
                                    className={`absolute ${
                                      toolbarPosition === "bottom"
                                        ? "bottom-full mb-1.5"
                                        : "top-full mt-1.5"
                                    } right-0 sm:left-0 z-50 min-w-[235px] py-1 bg-surface border border-border rounded-lg shadow-2xl text-xs font-medium`}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setIsOrganizeMenuOpen(false);
                                        onAutoOrganizeCurrentPage("original");
                                      }}
                                      className="w-full text-left px-3 py-1.5 hover:bg-surface-hover flex items-center gap-2 text-foreground transition-colors cursor-pointer"
                                    >
                                      <Sparkles className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                                      <span>
                                        จัดตำแหน่งตามต้นฉบับ (หน้านี้)
                                      </span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setIsOrganizeMenuOpen(false);
                                        onAutoOrganizeCurrentPage("readable");
                                      }}
                                      className="w-full text-left px-3 py-1.5 hover:bg-surface-hover flex items-center gap-2 text-foreground transition-colors cursor-pointer"
                                    >
                                      <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
                                      <span>
                                        จัดระเบียบหน้านี้ (ตัวใหญ่อ่านง่าย)
                                      </span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setIsOrganizeMenuOpen(false);
                                        onAutoOrganizeCurrentPage("xlarge");
                                      }}
                                      className="w-full text-left px-3 py-1.5 hover:bg-surface-hover flex items-center gap-2 text-foreground transition-colors cursor-pointer"
                                    >
                                      <Sparkles className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                                      <span>ขยายตัวใหญ่พิเศษ (หน้านี้)</span>
                                    </button>
                                    <div className="my-1 border-t border-border/60" />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setIsOrganizeMenuOpen(false);
                                        onAutoOrganizeAllPages("original");
                                      }}
                                      className="w-full text-left px-3 py-1.5 hover:bg-surface-hover flex items-center gap-2 text-foreground transition-colors cursor-pointer"
                                    >
                                      <Sparkles className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                                      <span>
                                        จัดตำแหน่งตามต้นฉบับ (ทุกหน้า)
                                      </span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setIsOrganizeMenuOpen(false);
                                        onAutoOrganizeAllPages("readable");
                                      }}
                                      className="w-full text-left px-3 py-1.5 hover:bg-surface-hover flex items-center gap-2 text-foreground transition-colors cursor-pointer"
                                    >
                                      <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
                                      <span>
                                        จัดระเบียบทุกหน้า ({pages.length} หน้า)
                                      </span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setIsOrganizeMenuOpen(false);
                                        onAutoOrganizeAllPages("xlarge");
                                      }}
                                      className="w-full text-left px-3 py-1.5 hover:bg-surface-hover flex items-center gap-2 text-foreground transition-colors cursor-pointer"
                                    >
                                      <Sparkles className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                                      <span>ขยายตัวใหญ่พิเศษ (ทุกหน้า)</span>
                                    </button>
                                  </div>
                                )}
                              </div>

                              <div
                                ref={bwContrastMenuRef}
                                className="relative inline-flex items-center rounded-lg border border-border/80 bg-background/90 shadow-xs shrink-0"
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    setIsBwContrastMenuOpen(false);
                                    onApplyBwContrastCurrentPage("black_on_white");
                                  }}
                                  disabled={operationBusy}
                                  aria-label="ปรับข้อความขาว-ดำให้อ่านง่าย"
                                  title="ปรับหน้านี้เป็นโหมด ดำ-ขาว (ตัวดำ ขอบขาวหนา) ให้อ่านง่ายบนพื้นหลังมืด/เทา"
                                  className="inline-flex h-7 sm:h-7.5 items-center gap-1 hover:bg-surface-hover active:bg-surface-active px-2 text-xs font-semibold text-foreground transition-all duration-150 cursor-pointer select-none rounded-l-lg disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  <Contrast
                                    className="h-3 w-3 text-foreground shrink-0"
                                    aria-hidden="true"
                                  />
                                  <span className="hidden sm:inline">
                                    ขาว-ดำ
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setIsOrganizeMenuOpen(false);
                                    setIsBwContrastMenuOpen((prev) => !prev);
                                  }}
                                  disabled={operationBusy}
                                  aria-label="ตัวเลือกโหมดสีขาว-ดำ"
                                  title="เลือกโหมดสี ขาว-ดำ / ดำ-ขาว สำหรับหน้านี้หรือทุกหน้า"
                                  className="inline-flex h-7 sm:h-7.5 items-center px-1 border-l border-border/60 hover:bg-surface-hover active:bg-surface-active text-foreground transition-all duration-150 cursor-pointer rounded-r-lg disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  <ChevronDown className="h-3 w-3 shrink-0" />
                                </button>
                                {isBwContrastMenuOpen && (
                                  <div
                                    role="menu"
                                    aria-label="เมนูตัวเลือกโหมดสีขาว-ดำ"
                                    className={`absolute ${
                                      toolbarPosition === "bottom"
                                        ? "bottom-full mb-1.5"
                                        : "top-full mt-1.5"
                                    } right-0 sm:left-0 z-50 min-w-[240px] py-1.5 bg-surface border border-border rounded-lg shadow-2xl text-xs font-medium`}
                                  >
                                    <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
                                      หน้านี้ (หน้า {currentPage + 1})
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setIsBwContrastMenuOpen(false);
                                        onApplyBwContrastCurrentPage("black_on_white");
                                      }}
                                      className="w-full text-left px-3 py-1.5 hover:bg-surface-hover flex items-center gap-2 text-foreground transition-colors cursor-pointer"
                                    >
                                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-black text-white border border-white text-[9px] font-bold shrink-0">
                                        ก
                                      </span>
                                      <span>ดำ-ขาว (ตัวดำ ขอบขาวหนา)</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setIsBwContrastMenuOpen(false);
                                        onApplyBwContrastCurrentPage("white_on_black");
                                      }}
                                      className="w-full text-left px-3 py-1.5 hover:bg-surface-hover flex items-center gap-2 text-foreground transition-colors cursor-pointer"
                                    >
                                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-white text-black border border-black text-[9px] font-bold shrink-0">
                                        ก
                                      </span>
                                      <span>ขาว-ดำ (ตัวขาว ขอบดำหนา)</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setIsBwContrastMenuOpen(false);
                                        onApplyBwContrastCurrentPage("auto");
                                      }}
                                      className="w-full text-left px-3 py-1.5 hover:bg-surface-hover flex items-center gap-2 text-foreground transition-colors cursor-pointer"
                                    >
                                      <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
                                      <span>
                                        ออโต้ ขาว-ดำ (แยกตามพื้นหลัง)
                                      </span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setIsBwContrastMenuOpen(false);
                                        onApplyBwContrastCurrentPage("pure_black");
                                      }}
                                      className="w-full text-left px-3 py-1.5 hover:bg-surface-hover flex items-center gap-2 text-foreground transition-colors cursor-pointer"
                                    >
                                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-zinc-900 text-white text-[9px] font-bold shrink-0">
                                        ก
                                      </span>
                                      <span>ดำล้วน (ไม่มีขอบขาว)</span>
                                    </button>

                                    <div className="my-1 border-t border-border/60" />
                                    <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
                                      ทุกหน้าในเล่ม ({pages.length} หน้า)
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setIsBwContrastMenuOpen(false);
                                        onApplyBwContrastAllPages("black_on_white");
                                      }}
                                      className="w-full text-left px-3 py-1.5 hover:bg-surface-hover flex items-center gap-2 text-foreground transition-colors cursor-pointer"
                                    >
                                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-black text-white border border-white text-[9px] font-bold shrink-0">
                                        ก
                                      </span>
                                      <span>
                                        ดำ-ขาว ทุกหน้า (ตัวดำ ขอบขาวหนา)
                                      </span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setIsBwContrastMenuOpen(false);
                                        onApplyBwContrastAllPages("white_on_black");
                                      }}
                                      className="w-full text-left px-3 py-1.5 hover:bg-surface-hover flex items-center gap-2 text-foreground transition-colors cursor-pointer"
                                    >
                                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-white text-black border border-black text-[9px] font-bold shrink-0">
                                        ก
                                      </span>
                                      <span>
                                        ขาว-ดำ ทุกหน้า (ตัวขาว ขอบดำหนา)
                                      </span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setIsBwContrastMenuOpen(false);
                                        onApplyBwContrastAllPages("auto");
                                      }}
                                      className="w-full text-left px-3 py-1.5 hover:bg-surface-hover flex items-center gap-2 text-foreground transition-colors cursor-pointer"
                                    >
                                      <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
                                      <span>ออโต้ ขาว-ดำ ทุกหน้า</span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            </>
                          )}
                      </div>
                    )}
                  </CleaningToolbar>
                  {isPageReviewRequired && (
                    <PageReviewNotice
                      key={`${activePage?.url ?? ""}:${currentCleaningResult?.jobId ?? ""}`}
                      onConfirm={onConfirmPageReview}
                    />
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
                          onClick={onOpenDiagnostics}
                          className="px-2.5 py-1 rounded bg-red-600 hover:bg-red-500 text-white font-medium text-xs transition-colors cursor-pointer shadow-sm"
                        >
                          ดูสาเหตุและแก้ไข
                        </button>
                        <button
                          type="button"
                          onClick={onRetryFailedPages}
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
            {onOpenFindReplace && onOpenShortcuts && !isFocusMode && (
              <div className="fixed left-3 top-1/2 -translate-y-1/2 z-30 hidden xl:flex flex-col gap-2">
                <StudioToolbar
                  activeTool={activeStudioTool}
                  onSelectTool={setActiveStudioTool}
                  onAddText={() => {
                    onAddManualTextBubble?.();
                    setActiveStudioTool("select");
                  }}
                  onAddImageLayer={() => imageLayerInputRef.current?.click()}
                  onOpenFindReplace={onOpenFindReplace}
                  onOpenShortcuts={onOpenShortcuts}
                  onOpenTranscript={transcriptPagesData ? () => setIsTranscriptModalOpen(true) : undefined}
                  onOpenGlossary={onGlossaryChange ? () => setIsGlossaryModalOpen(true) : undefined}
                  onEditMask={onEditMask}
                  disabled={operationBusy}
                />
                <input
                  ref={imageLayerInputRef}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file || !activePage) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      const src = String(reader.result || "");
                      if (!src) return;
                      const newLayer: ImageLayer = {
                        id: `img_${Date.now()}`,
                        pageId: activePage.url,
                        src,
                        x: 120,
                        y: 120,
                        width: 220,
                        height: 220,
                        opacity: 1,
                        flipX: false,
                        flipY: false,
                      };
                      setImageLayersByPage((prev) => ({
                        ...prev,
                        [activePage.url]: [...(prev[activePage.url] ?? []), newLayer],
                      }));
                      setSelectedImageLayerId(newLayer.id);
                    };
                    reader.readAsDataURL(file);
                  }}
                />
              </div>
            )}
            {!isFocusMode && (selectedBubbleBridge || selectedImageLayer) && (
              <div className="fixed right-3 top-20 z-30 hidden lg:flex flex-col gap-2 max-h-[calc(100dvh-9rem)] overflow-y-auto pr-0.5">
                {selectedBubbleBridge && (
                  <>
                    <ColorMatchStatus
                      profile={selectedBubbleBridge.bubble.styleProfile}
                      onReanalyze={() => {
                        selectedBubbleBridge.reanalyzeColor();
                        setInspectorTick((t) => t + 1);
                      }}
                      onSelectMode={(mode) => {
                        selectedBubbleBridge.applyUpdates({ ownershipMode: mode });
                        setInspectorTick((t) => t + 1);
                      }}
                    />
                    <TextPropertiesPanel
                      layer={{
                        id: selectedBubbleBridge.bubbleId,
                        pageId: activePageUrlKey,
                        text: selectedBubbleBridge.bubble.t ?? selectedBubbleBridge.bubble.translated ?? "",
                        x: 0,
                        y: 0,
                        width: 200,
                        height: 80,
                        fontFamily:
                          (selectedBubbleBridge.bubble as { fontFamily?: string }).fontFamily ||
                          "var(--font-manga)",
                        fontSize: selectedBubbleBridge.getFontSize(),
                        color: selectedBubbleBridge.bubble.styleProfile?.fill || "#000000",
                        strokeColor: selectedBubbleBridge.bubble.styleProfile?.outline || "#ffffff",
                        strokeWidth:
                          (selectedBubbleBridge.bubble as { strokeWidth?: number }).strokeWidth ?? 3,
                        align:
                          (selectedBubbleBridge.bubble as { align?: "left" | "center" | "right" }).align ||
                          "center",
                        isBold:
                          (selectedBubbleBridge.bubble as { isBold?: boolean }).isBold ?? true,
                        isItalic: Boolean(
                          selectedBubbleBridge.bubble.isItalic ?? selectedBubbleBridge.bubble.italic,
                        ),
                        boxFill: (selectedBubbleBridge.bubble as { boxFill?: string }).boxFill,
                        opacity: (selectedBubbleBridge.bubble as { opacity?: number }).opacity ?? 1,
                      }}
                      scope={inspectorScope}
                      onScopeChange={setInspectorScope}
                      onChange={(updates: Partial<TextLayer>) => {
                        selectedBubbleBridge.applyUpdates(updates as Record<string, unknown>);
                        setInspectorTick((t) => t + 1);
                      }}
                      onDelete={() => {
                        selectedBubbleBridge.deleteBubble();
                        setSelectedBubbleBridge(null);
                      }}
                    />
                    <WarpPanel
                      warp={{
                        effect: (selectedBubbleBridge.bubble.warp?.type ?? "none") as WarpEffect,
                        bend: Math.round((selectedBubbleBridge.bubble.warp?.bend ?? 0) * 100),
                        horizontal: 0,
                        vertical: 0,
                      }}
                      onChange={(warpUpdates) => {
                        const prevType = selectedBubbleBridge.bubble.warp?.type ?? "none";
                        const nextEffect = (warpUpdates.effect ?? prevType) as
                          | "none"
                          | "arch"
                          | "wave"
                          | "bulge"
                          | "squeeze";
                        const rawBend =
                          typeof warpUpdates.bend === "number"
                            ? warpUpdates.bend / 100
                            : (selectedBubbleBridge.bubble.warp?.bend ?? 0.45);
                        selectedBubbleBridge.applyUpdates({
                          warp:
                            nextEffect === "none"
                              ? undefined
                              : {
                                  type: nextEffect,
                                  bend: rawBend,
                                  frequency: selectedBubbleBridge.bubble.warp?.frequency ?? 1.5,
                                },
                        });
                        setInspectorTick((t) => t + 1);
                      }}
                      onReset={() => {
                        selectedBubbleBridge.applyUpdates({ warp: undefined });
                        setInspectorTick((t) => t + 1);
                      }}
                    />
                  </>
                )}
                {selectedImageLayer && activePage && (
                  <ImageLayerPanel
                    layer={selectedImageLayer}
                    onChange={(updates) => {
                      setImageLayersByPage((prev) => ({
                        ...prev,
                        [activePage.url]: (prev[activePage.url] ?? []).map((item) =>
                          item.id === selectedImageLayer.id ? { ...item, ...updates } : item,
                        ),
                      }));
                    }}
                    onDelete={(id) => {
                      setImageLayersByPage((prev) => ({
                        ...prev,
                        [activePage.url]: (prev[activePage.url] ?? []).filter((item) => item.id !== id),
                      }));
                      setSelectedImageLayerId(null);
                    }}
                  />
                )}
              </div>
            )}
            {textLayersManager.layers.length > 0 && (
              <TextLayerCanvas
                pageId={activePageUrlKey}
                layers={textLayersManager.layers}
                selectedId={textLayersManager.selectedId ?? null}
                onSelect={textLayersManager.selectLayer}
                onChange={textLayersManager.updateLayer}
                onDelete={textLayersManager.deleteLayer}
              />
            )}
            {currentPageImageLayers.length > 0 && activePage && (
              <div className="pointer-events-none absolute inset-0 z-25 overflow-hidden">
                {currentPageImageLayers.map((imgLayer) => (
                  <div
                    key={imgLayer.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedImageLayerId(imgLayer.id);
                    }}
                    style={{
                      position: "absolute",
                      left: imgLayer.x,
                      top: imgLayer.y,
                      width: imgLayer.width,
                      height: imgLayer.height,
                      opacity: imgLayer.opacity ?? 1,
                      transform: `scaleX(${imgLayer.flipX ? -1 : 1}) scaleY(${imgLayer.flipY ? -1 : 1})`,
                    }}
                    className={`pointer-events-auto cursor-move select-none ${
                      selectedImageLayerId === imgLayer.id
                        ? "ring-2 ring-primary shadow-lg"
                        : "hover:ring-1 hover:ring-primary/50"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imgLayer.src}
                      alt="Image Layer"
                      draggable={false}
                      className="w-full h-full object-contain pointer-events-none"
                    />
                  </div>
                ))}
              </div>
            )}
            {onQuickExport && isFocusMode && isFocusToolbarVisible && (
              <div className="fixed bottom-4 right-4 z-40">
                <WorkspaceExportButtons
                  disabled={isExportBusy || pages.length === 0}
                  onExport={onQuickExport}
                />
              </div>
            )}
            {transcriptPagesData && onApplyTranscriptUpdates && (
              <TranscriptModal
                isOpen={isTranscriptModalOpen}
                onClose={() => setIsTranscriptModalOpen(false)}
                pagesData={transcriptPagesData}
                currentPageIndex={currentPage}
                onApplyTranscript={onApplyTranscriptUpdates}
                onExportLayeredArchive={onExportLayeredArchive}
              />
            )}
            {onGlossaryChange && (
              <GlossaryModal
                isOpen={isGlossaryModalOpen}
                onClose={() => setIsGlossaryModalOpen(false)}
                glossary={glossary}
                onGlossaryChange={onGlossaryChange}
                onAutoExtractGlossary={onAutoExtractGlossary}
              />
            )}
            <OcrAreaTool
              active={activeStudioTool === "ocr"}
              loading={operationBusy}
              onDetectRegion={async (rect) => {
                await onDetectOcrRegion?.(rect);
                setActiveStudioTool("select");
              }}
              onClose={() => setActiveStudioTool("select")}
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
              isFocusMode={isFocusMode}
              isFilmstripVisible={!isThumbnailsCollapsed && !isFocusMode}
              onToggleFocusMode={onToggleFocusMode}
              onPageChange={onPageChange}
              onViewLayoutChange={onViewLayoutChange}
              onRemovePage={onRemovePage}
              onImageError={onImageError}
            />
          </div>

          {/* Hidden container for offscreen rendering */}
          <div
            id="offscreen-container"
            className="fixed top-0 left-0 w-full max-w-4xl opacity-0 pointer-events-none -z-50"
            style={{ visibility: "hidden" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              id="offscreen-image"
              alt="offscreen"
              className="max-w-full h-auto"
            />
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
            <div
              className={`w-full ${
                savedSessionData.hasUnrecoverableSources
                  ? "bg-amber-500/10 border-amber-500/30"
                  : "bg-primary/10 border-primary/30"
              } border rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left animate-in fade-in slide-in-from-top-2 duration-300`}
            >
              <div className="flex items-center gap-3">
                <div className="text-2xl">
                  {savedSessionData.hasUnrecoverableSources ? "⚠️" : "💾"}
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-foreground">
                    {savedSessionData.hasUnrecoverableSources
                      ? `พบข้อมูลคำแปลค้างไว้ (${savedSessionData.pages.length} หน้า) แต่รูปต้นฉบับหมดอายุ`
                      : `พบงานแปลค้างไว้ล่าสุด (${savedSessionData.pages.length} หน้า)`}
                  </h4>
                  <p className="text-xs text-muted">
                    {savedSessionData.hasUnrecoverableSources
                      ? "ระบบจำข้อมูลคำแปลและตำแหน่งบอลลูนไว้ แต่รูปต้นฉบับ session เดิมหมดอายุแล้ว กรุณานำเข้ารูปภาพใหม่เพื่อทำต่อ"
                      : "ระบบจำสถานะคำแปลและรูปภาพเดิมไว้ สามารถดึงกลับมาทำต่อได้ทันที"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => void onRestoreSavedSession()}
                  className="bg-primary text-primary-content hover:bg-primary-hover px-3.5 py-1.5 rounded-md text-xs font-semibold shadow-sm transition-colors cursor-pointer"
                >
                  📂 คืนค่างานเดิม
                </button>
                <button
                  type="button"
                  onClick={onClearSavedSession}
                  className="bg-surface hover:bg-surface-hover text-muted hover:text-foreground border border-surface-hover px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer"
                >
                  ล้างแล้วเริ่มใหม่
                </button>
              </div>
            </div>
          )}

          <div
            className={`w-full aspect-video rounded-xl border border-dashed flex flex-col items-center justify-center transition-colors duration-200 ${
              isDragging
                ? "border-primary bg-primary/5"
                : "border-surface-hover hover:border-muted"
            }`}
          >
            {isImporting ? (
              <div className="flex flex-col items-center justify-center p-6 gap-3 animate-in fade-in duration-150">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <p className="text-foreground text-base font-medium">
                  {importStatusMessage || "กำลังนำเข้าไฟล์..."}
                </p>
                <p className="text-muted text-xs">
                  กรุณารอสักครู่ ระบบกำลังประมวลผลหน้ามังงะ
                </p>
              </div>
            ) : (
              <>
                <Upload
                  className={`w-8 h-8 mb-4 ${
                    isDragging ? "text-primary" : "text-muted"
                  }`}
                />
                <p className="text-foreground text-lg mb-1 font-medium">
                  Drag & Drop manga pages
                </p>
                <p className="text-muted text-sm mb-6">
                  Support for Images, ZIP, CBZ, and PDF
                </p>

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
                    onChange={onImageUpload}
                  />
                </label>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
