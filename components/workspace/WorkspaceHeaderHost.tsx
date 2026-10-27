"use client";

import React from "react";
import {
  Loader2,
  Check,
  AlertCircle,
  RefreshCw,
  Settings,
  Undo2,
  Redo2,
  Eye,
  EyeOff,
  GalleryVertical,
  RectangleHorizontal,
  Sparkles,
  Eraser,
  Paintbrush,
  RotateCcw,
  ScanSearch,
  Flame,
  Download,
  FileArchive,
  BookOpen,
  FileText,
  Menu,
  X,
} from "lucide-react";
import {
  SavedTextSizeControls,
  type SavedSizeAction,
} from "@/components/workspace/SavedTextSizeControls";
import { WorkspaceAdvancedTools } from "@/components/workspace/WorkspaceAdvancedTools";
import { WorkspacePrimaryAction } from "@/components/workspace/WorkspacePrimaryAction";
import { WorkspaceExportMenu } from "@/components/workspace/WorkspaceExportMenu";
import type { WorkspaceLayer } from "@/components/cleaning/CleaningToolbar";
import {
  normalizePageExportSource,
  type PageExportSource,
} from "@/lib/export/pageSource";
import { undoManager } from "@/lib/undoManager";
import type { WorkspacePrimaryActionState } from "@/lib/workspacePrimaryAction";
import type { TranslatedBubble } from "@/lib/translationOverlay";
import type { PageCleaningResult } from "@/hooks/useCleaning";

export function formatStopwatchTime(elapsedMs: number): string {
  const safeMs = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);
  const totalTenths = Math.floor(safeMs / 100);
  const tenths = totalTenths % 10;
  const totalSeconds = Math.floor(totalTenths / 10);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
  }
  return `${String(totalMinutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

export interface WorkspaceHeaderHostProps {
  isFocusMode: boolean;
  pages: Array<{
    url: string;
    name?: string;
    originUrl?: string;
    exportSource?: PageExportSource;
  }>;
  currentPage: number;
  currentPageUrl?: string;
  saveStatus: "idle" | "saving" | "saved" | "error";
  saveError?: string | null;
  onRetrySaveSession: () => void | Promise<void>;

  isSettingsOpen: boolean;
  onToggleSettings: () => void;
  onOpenSettings: () => void;

  canUndo: boolean;
  canRedo: boolean;
  onUndo?: () => void;
  onRedo?: () => void;

  workspaceLayer: WorkspaceLayer;
  hasCurrentTranslation: boolean;
  onToggleOriginalTranslated: () => void;

  viewLayout: "single" | "scroll";
  onToggleViewLayout: () => void;

  textSizePoints: TranslatedBubble[];
  operationBusy: boolean;
  onResizeSavedText: (options: SavedSizeAction) => Promise<number>;

  // WorkspaceAdvancedTools props
  currentCleaningResult?: PageCleaningResult | null;
  batchFailureCount: number;
  contaminatedPageCount: number;
  canOrganizeAll: boolean;
  onCleanCurrentPage: () => void | Promise<void>;
  onEditMask: () => void;
  onTranslateBook: () => void | Promise<void>;
  onTranslateCurrent: () => void | Promise<void>;
  onOrganizeAllPages: () => void | Promise<void>;
  onRetryFailedPages: () => void | Promise<void>;
  onScanTranslations: () => void;
  onRetranslateContaminated: () => void | Promise<void>;
  onOpenExportReport: () => void;
  onOpenFindReplace: () => void;
  onOpenShortcuts: () => void;
  onExportProjectFile?: () => void | Promise<void>;
  onImportProjectFile?: () => void;
  onOpenLogs?: () => void;
  advancedToolsTriggerRef?: React.RefObject<HTMLButtonElement | null>;

  // Primary action & export
  primaryAction: WorkspacePrimaryActionState;
  onPrimaryAction: () => void | Promise<void>;
  onCancelPrimaryAction: () => void;
  exportTriggerRef?: React.RefObject<HTMLButtonElement | null>;
  isZipping: boolean;
  isChoosingExport: boolean;
  activeBubbles: TranslatedBubble[];
  onRequestSinglePageExport: () => void | Promise<void>;
  onRequestBookExport: (kind: "strip" | "zip" | "cbz" | "pdf" | "layered") => void | Promise<void>;

  // Reading view return
  isPublishingBack: boolean;
  onPublishBackToReadingView: () => void | Promise<void>;

  // Mobile menu / drawer
  isMobileMenuOpen: boolean;
  onToggleMobileMenu: () => void;
  onCloseMobileMenu: () => void;
  isTranslatingAll: boolean;
  translateAllProgress: {
    current: number;
    total: number;
    message?: string;
    secondaryMessage?: string;
    elapsedMs: number;
    pageElapsedMs: number;
  } | null;
  nsfwBypassMode: boolean;
  onToggleNsfwBypassMode: () => void;
}

export function WorkspaceHeaderHost({
  isFocusMode,
  pages,
  currentPage,
  currentPageUrl,
  saveStatus,
  saveError,
  onRetrySaveSession,
  isSettingsOpen,
  onToggleSettings,
  onOpenSettings,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  workspaceLayer,
  hasCurrentTranslation,
  onToggleOriginalTranslated,
  viewLayout,
  onToggleViewLayout,
  textSizePoints,
  operationBusy,
  onResizeSavedText,
  currentCleaningResult,
  batchFailureCount,
  contaminatedPageCount,
  canOrganizeAll,
  onCleanCurrentPage,
  onEditMask,
  onTranslateBook,
  onTranslateCurrent,
  onOrganizeAllPages,
  onRetryFailedPages,
  onScanTranslations,
  onRetranslateContaminated,
  onOpenExportReport,
  onOpenFindReplace,
  onOpenShortcuts,
  onExportProjectFile,
  onImportProjectFile,
  onOpenLogs,
  advancedToolsTriggerRef,
  primaryAction,
  onPrimaryAction,
  onCancelPrimaryAction,
  exportTriggerRef,
  isZipping,
  isChoosingExport,
  activeBubbles,
  onRequestSinglePageExport,
  onRequestBookExport,
  isPublishingBack,
  onPublishBackToReadingView,
  isMobileMenuOpen,
  onToggleMobileMenu,
  onCloseMobileMenu,
  isTranslatingAll,
  translateAllProgress,
  nsfwBypassMode,
  onToggleNsfwBypassMode,
}: WorkspaceHeaderHostProps) {
  const handleUndo = () => {
    if (onUndo) {
      onUndo();
      return;
    }
    const label = undoManager.undo();
    if (label) {
      import("react-hot-toast").then((m) =>
        m.default(`↩️ Undo: ${label}`, { duration: 1500 })
      );
    }
  };

  const handleRedo = () => {
    if (onRedo) {
      onRedo();
      return;
    }
    const label = undoManager.redo();
    if (label) {
      import("react-hot-toast").then((m) =>
        m.default(`↪️ Redo: ${label}`, { duration: 1500 })
      );
    }
  };

  return (
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
          <span className="text-muted text-xs font-normal hidden xl:inline-block pl-2.5 ml-2.5 border-l border-border/80 tracking-wide uppercase whitespace-nowrap">
            Manga Translator
          </span>
        </h1>

        {/* Save Status Indicator */}
        {pages.length > 0 && saveStatus !== "idle" && (
          <div className="hidden sm:flex items-center ml-1 sm:ml-2">
            {saveStatus === "saving" && (
              <span
                className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] text-muted font-medium bg-surface/60 border border-border/60 rounded-full select-none"
                title="กำลังบันทึกข้อมูลล่าสุดลง IndexedDB..."
              >
                <Loader2 className="w-3 h-3 animate-spin text-primary" />
                <span className="hidden xl:inline">กำลังบันทึก...</span>
              </span>
            )}
            {saveStatus === "saved" && (
              <span
                className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] text-emerald-500/90 dark:text-emerald-400 font-medium bg-emerald-500/10 border border-emerald-500/20 rounded-full select-none"
                title="บันทึกข้อมูลล่าสุดลงเครื่องเรียบร้อยแล้ว"
              >
                <Check className="w-3 h-3 text-emerald-500" />
                <span className="hidden xl:inline">บันทึกแล้ว</span>
              </span>
            )}
            {saveStatus === "error" && (
              <div
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[11px] text-amber-500 dark:text-amber-400 font-medium bg-amber-500/10 border border-amber-500/30 rounded-full shadow-xs"
                role="alert"
              >
                <AlertCircle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                <span className="hidden xl:inline truncate max-w-[150px]">
                  {saveError || "บันทึกไม่สำเร็จ"}
                </span>
                <button
                  type="button"
                  onClick={() => void onRetrySaveSession()}
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
      <div
        data-workspace-header-desktop
        className="hidden lg:flex min-w-0 items-center gap-1.5 xl:gap-2.5 flex-nowrap"
      >
        {pages.length === 0 ? (
          /* ── Empty State Header Controls: Clean & Minimal ── */
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onToggleSettings}
              aria-label="เปิดหน้าต่างตั้งค่า"
              className={`h-8.5 px-3 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                isSettingsOpen
                  ? "text-primary bg-primary/10 border-primary/30"
                  : "text-foreground border-border hover:bg-surface-hover"
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
            <div
              className="flex items-center gap-1.5"
              role="group"
              aria-label="เครื่องมือและมุมมอง"
            >
              <div className="flex items-center bg-surface/80 rounded-lg p-0.5 border border-border/70 gap-0.5">
                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={!canUndo}
                  aria-label="เลิกทำ (Undo, Ctrl+Z)"
                  className="h-7.5 w-7.5 rounded-md flex items-center justify-center text-muted hover:text-foreground hover:bg-surface-hover/80 disabled:opacity-25 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  title="Undo (Ctrl+Z)"
                >
                  <Undo2 className="w-4 h-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={handleRedo}
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
                onClick={onToggleOriginalTranslated}
                disabled={!hasCurrentTranslation}
                aria-label={
                  workspaceLayer === "original"
                    ? "สลับไปแสดงคำแปล"
                    : "สลับไปดูภาพต้นฉบับ"
                }
                className={`h-8.5 w-8.5 rounded-lg border border-border flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  workspaceLayer === "original"
                    ? "text-muted hover:text-foreground hover:bg-surface-hover/80 bg-surface"
                    : "text-primary bg-primary/10"
                } disabled:opacity-30`}
                title={workspaceLayer === "original" ? "แสดงคำแปล" : "ดูต้นฉบับ"}
              >
                {workspaceLayer === "original" ? (
                  <Eye className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <EyeOff className="w-4 h-4" aria-hidden="true" />
                )}
              </button>

              {/* Layout toggle (Single / Scroll) */}
              <button
                type="button"
                onClick={onToggleViewLayout}
                disabled={pages.length === 0}
                aria-label={
                  viewLayout === "scroll"
                    ? "เปลี่ยนเป็นโหมดอ่านทีละหน้า"
                    : "เปลี่ยนเป็นโหมดเลื่อนอ่าน"
                }
                className={`h-8.5 w-8.5 rounded-lg border border-border flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  viewLayout === "scroll"
                    ? "text-primary bg-primary/10"
                    : "text-muted hover:text-foreground hover:bg-surface-hover/80 bg-surface"
                } disabled:opacity-30`}
                title={
                  viewLayout === "scroll" ? "โหมดเลื่อนอ่าน" : "โหมดทีละหน้า"
                }
              >
                {viewLayout === "scroll" ? (
                  <GalleryVertical className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <RectangleHorizontal className="w-4 h-4" aria-hidden="true" />
                )}
              </button>

              {/* Advanced Tools dropdown */}
              <SavedTextSizeControls
                key={currentPageUrl}
                pageUrl={currentPageUrl}
                points={textSizePoints}
                busy={operationBusy}
                onResize={onResizeSavedText}
              />
              <WorkspaceAdvancedTools
                canClean={Boolean(currentPageUrl)}
                canEditMask={Boolean(currentCleaningResult)}
                busy={operationBusy}
                batchFailureCount={batchFailureCount}
                contaminatedPageCount={contaminatedPageCount}
                onClean={() => void onCleanCurrentPage()}
                onEditMask={onEditMask}
                onTranslateBook={() => void onTranslateBook()}
                onTranslateCurrent={() => void onTranslateCurrent()}
                onOrganizeAllPages={() => void onOrganizeAllPages()}
                canOrganizeAll={canOrganizeAll}
                onRetryFailedPages={() => void onRetryFailedPages()}
                onScanTranslations={onScanTranslations}
                onRetranslateContaminated={() => void onRetranslateContaminated()}
                onOpenExportReport={onOpenExportReport}
                onOpenFindReplace={onOpenFindReplace}
                onOpenShortcuts={onOpenShortcuts}
                onExportProjectFile={onExportProjectFile}
                onImportProjectFile={onImportProjectFile}
                onOpenLogs={onOpenLogs}
                triggerRef={advancedToolsTriggerRef}
              />

              {/* Settings button (always accessible in desktop header) */}
              <button
                type="button"
                onClick={onToggleSettings}
                aria-label="เปิดหน้าต่างตั้งค่า"
                className={`h-8.5 w-8.5 rounded-lg border flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  isSettingsOpen
                    ? "text-primary bg-primary/10 border-primary/30"
                    : "text-muted hover:text-foreground hover:bg-surface-hover/80 bg-surface border-border"
                }`}
                title="ตั้งค่า API, ฟอนต์, คำศัพท์"
              >
                <Settings className="w-4 h-4" aria-hidden="true" />
              </button>

              {/* Keyboard shortcuts helper button */}
              <button
                type="button"
                onClick={onOpenShortcuts}
                aria-label="ดูปุ่มลัดคีย์บอร์ด (?)"
                className="h-8.5 w-8.5 rounded-lg border border-border flex items-center justify-center text-muted hover:text-foreground hover:bg-surface-hover/80 bg-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary text-xs font-semibold"
                title="ปุ่มลัดคีย์บอร์ด (?)"
              >
                ?
              </button>
            </div>

            {/* ── Primary Action Buttons ── */}
            <div className="flex items-center gap-2">
              {primaryAction.kind !== "export" && (
                <WorkspacePrimaryAction
                  state={primaryAction}
                  onAction={() => void onPrimaryAction()}
                  onCancel={onCancelPrimaryAction}
                />
              )}

              {/* ── Export Menu Dropdown ── */}
              <WorkspaceExportMenu
                triggerRef={exportTriggerRef}
                variant={primaryAction.kind === "export" ? "primary" : "default"}
                disabled={pages.length === 0}
                disabledKinds={{
                  image:
                    isZipping ||
                    isChoosingExport ||
                    (normalizePageExportSource(pages[currentPage]?.exportSource) ===
                      "translated" &&
                      activeBubbles.length > 0 &&
                      workspaceLayer !== "translated"),
                  pdf: isZipping || isChoosingExport || pages.length === 0,
                  strip: isZipping || isChoosingExport || pages.length === 0,
                  zip: isZipping || isChoosingExport || pages.length === 0,
                  cbz: isZipping || isChoosingExport || pages.length === 0,
                  layered: isZipping || isChoosingExport || pages.length === 0,
                }}
                onExport={(kind) => {
                  if (kind === "image") {
                    void onRequestSinglePageExport();
                  } else {
                    void onRequestBookExport(kind);
                  }
                }}
              />

              {/* Send Back to Reading View (if page came from extension) */}
              {pages[currentPage]?.originUrl && (
                <button
                  type="button"
                  onClick={() => void onPublishBackToReadingView()}
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
      <div
        data-workspace-header-mobile
        className="flex lg:hidden min-w-0 items-center gap-1.5 sm:gap-2"
      >
        {pages[currentPage]?.originUrl && (
          <button
            type="button"
            onClick={() => void onPublishBackToReadingView()}
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
          <WorkspaceAdvancedTools
            canClean={Boolean(currentPageUrl)}
            canEditMask={Boolean(currentCleaningResult)}
            busy={operationBusy}
            batchFailureCount={batchFailureCount}
            contaminatedPageCount={contaminatedPageCount}
            onClean={() => void onCleanCurrentPage()}
            onEditMask={onEditMask}
            onTranslateBook={() => void onTranslateBook()}
            onTranslateCurrent={() => void onTranslateCurrent()}
            onOrganizeAllPages={() => void onOrganizeAllPages()}
            canOrganizeAll={canOrganizeAll}
            onRetryFailedPages={() => void onRetryFailedPages()}
            onScanTranslations={onScanTranslations}
            onRetranslateContaminated={() => void onRetranslateContaminated()}
            onOpenExportReport={onOpenExportReport}
            onOpenFindReplace={onOpenFindReplace}
            onOpenShortcuts={onOpenShortcuts}
            onExportProjectFile={onExportProjectFile}
            onImportProjectFile={onImportProjectFile}
            onOpenLogs={onOpenLogs}
          />
        )}
        {pages.length > 0 && (
          <WorkspacePrimaryAction
            state={primaryAction}
            onAction={() => void onPrimaryAction()}
            onCancel={onCancelPrimaryAction}
          />
        )}
        <button
          type="button"
          onClick={onToggleMobileMenu}
          aria-expanded={isMobileMenuOpen}
          aria-label={isMobileMenuOpen ? "ปิดเมนู" : "เปิดเมนู"}
          className={`p-1.5 rounded-md transition-colors ${
            isMobileMenuOpen
              ? "bg-surface text-foreground"
              : "text-muted hover:text-foreground hover:bg-surface"
          }`}
        >
          {isMobileMenuOpen ? (
            <X className="w-5 h-5" />
          ) : (
            <Menu className="w-5 h-5" />
          )}
        </button>
      </div>

      {/* Mobile Dropdown Menu with Backdrop */}
      {isMobileMenuOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 lg:hidden animate-in fade-in duration-200"
            onClick={onCloseMobileMenu}
          />
          <div className="absolute top-[60px] right-3 left-3 sm:right-6 sm:w-80 sm:left-auto bg-background border border-surface shadow-2xl rounded-xl p-3.5 z-50 lg:hidden flex flex-col gap-3 max-h-[calc(100vh-80px)] overflow-y-auto animate-in fade-in slide-in-from-top-2 duration-200">
            {/* ── Section: 🔤 การแปล ── */}
            <div>
              <div className="text-[10px] font-bold text-muted uppercase tracking-wider px-1 mb-1.5 flex items-center gap-1.5">
                🔤 การแปล
              </div>
              {isTranslatingAll ? (
                <div className="flex flex-col gap-2 p-2.5 bg-primary/5 rounded-lg border border-primary/15">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-primary font-semibold flex items-center gap-1.5">
                      <span className="animate-spin h-3 w-3 border-2 border-primary border-t-transparent rounded-full" />
                      {translateAllProgress?.message ?? "กำลังเตรียม..."}
                    </span>
                    {translateAllProgress && (
                      <span className="text-muted font-bold">
                        {Math.round(
                          (translateAllProgress.current /
                            translateAllProgress.total) *
                            100
                        )}
                        %
                      </span>
                    )}
                  </div>
                  <div className="w-full h-2 bg-surface rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-primary to-primary/60 rounded-full transition-all duration-500 ease-out"
                      style={{
                        width: translateAllProgress
                          ? `${(translateAllProgress.current / translateAllProgress.total) * 100}%`
                          : "0%",
                      }}
                    />
                  </div>
                  {translateAllProgress?.secondaryMessage && (
                    <span className="text-[10px] text-primary/80">
                      {translateAllProgress.secondaryMessage}
                    </span>
                  )}
                  {translateAllProgress && (
                    <div className="flex items-center justify-between gap-3 text-[10px] text-muted tabular-nums">
                      <span>
                        ⏱ หน้านี้{" "}
                        {formatStopwatchTime(
                          translateAllProgress.pageElapsedMs
                        )}
                      </span>
                      <span>
                        รวม{" "}
                        {formatStopwatchTime(translateAllProgress.elapsedMs)}
                      </span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={onCancelPrimaryAction}
                    className="w-full bg-red-500/15 text-red-400 hover:bg-red-500/25 px-4 py-2 rounded-md text-sm font-semibold flex justify-center items-center gap-2 transition-all"
                  >
                    ⏹ หยุดแปล
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      void onTranslateCurrent();
                      onCloseMobileMenu();
                    }}
                    disabled={operationBusy || !currentPageUrl}
                    className="w-full bg-gradient-to-r from-primary/20 to-primary/10 text-primary hover:from-primary/30 hover:to-primary/20 disabled:opacity-50 px-4 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-150 border border-primary/20"
                  >
                    <Sparkles className="w-5 h-5" />
                    <span>แปลหน้านี้ใหม่</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void onTranslateBook();
                      onCloseMobileMenu();
                    }}
                    disabled={operationBusy || pages.length === 0}
                    className="w-full bg-surface text-foreground hover:bg-surface-hover disabled:opacity-50 px-4 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-150 border border-transparent"
                  >
                    <Sparkles className="w-5 h-5 text-primary" />
                    <span>✨ แปลทั้งเล่ม</span>
                  </button>
                </div>
              )}
            </div>

            {/* ── Section: 🛠️ เครื่องมือ ── */}
            <div>
              <div className="text-[10px] font-bold text-muted uppercase tracking-wider px-1 mb-1.5 flex items-center gap-1.5">
                🛠️ เครื่องมือ
              </div>
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    void onCleanCurrentPage();
                    onCloseMobileMenu();
                  }}
                  disabled={operationBusy || !currentPageUrl}
                  className="w-full bg-surface text-foreground hover:bg-surface-hover disabled:opacity-40 p-2.5 rounded-lg text-sm font-medium flex items-center gap-3 border border-transparent transition-colors"
                >
                  <Eraser className="w-5 h-5 text-primary" />
                  <span>คลีนข้อความใหม่</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onEditMask();
                    onCloseMobileMenu();
                  }}
                  disabled={operationBusy || !currentCleaningResult}
                  className="w-full bg-surface text-foreground hover:bg-surface-hover disabled:opacity-40 p-2.5 rounded-lg text-sm font-medium flex items-center gap-3 border border-transparent transition-colors"
                >
                  <Paintbrush className="w-5 h-5 text-primary" />
                  <span>แก้ Mask</span>
                </button>
                {batchFailureCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      void onRetryFailedPages();
                      onCloseMobileMenu();
                    }}
                    disabled={operationBusy}
                    className="w-full bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 disabled:opacity-40 p-2.5 rounded-lg text-sm font-medium flex items-center gap-3 border border-amber-500/20 transition-colors"
                  >
                    <RotateCcw className="w-5 h-5 text-amber-400" />
                    <span>ลองใหม่ {batchFailureCount} หน้าที่พลาด</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    onScanTranslations();
                    onCloseMobileMenu();
                  }}
                  disabled={operationBusy}
                  className="w-full bg-surface text-foreground hover:bg-surface-hover disabled:opacity-40 p-2.5 rounded-lg text-sm font-medium flex items-center gap-3 border border-transparent transition-colors"
                >
                  <ScanSearch className="w-5 h-5 text-primary" />
                  <span>ตรวจคำแปลทั้งเล่ม</span>
                </button>
              </div>
            </div>

            {/* ── Section: 👁️ การแสดงผล ── */}
            <div>
              <div className="text-[10px] font-bold text-muted uppercase tracking-wider px-1 mb-1.5 flex items-center gap-1.5">
                👁️ การแสดงผล
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onToggleViewLayout();
                    onCloseMobileMenu();
                  }}
                  disabled={pages.length === 0}
                  className={`p-2.5 rounded-lg text-xs font-medium flex flex-col items-center justify-center gap-1.5 transition-all duration-150 border ${
                    viewLayout === "scroll"
                      ? "text-primary bg-primary/10 border-primary/20"
                      : "bg-surface text-foreground border-transparent"
                  }`}
                >
                  {viewLayout === "scroll" ? (
                    <GalleryVertical className="w-5 h-5" />
                  ) : (
                    <RectangleHorizontal className="w-5 h-5" />
                  )}
                  <span>
                    {viewLayout === "scroll" ? "เลื่อนอ่าน" : "ทีละหน้า"}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onToggleOriginalTranslated();
                    onCloseMobileMenu();
                  }}
                  disabled={!hasCurrentTranslation}
                  className={`p-2.5 rounded-lg text-xs font-medium flex flex-col items-center justify-center gap-1.5 transition-all duration-150 border ${
                    workspaceLayer === "original"
                      ? "bg-surface text-foreground border-transparent"
                      : "text-primary bg-primary/10 border-primary/20"
                  }`}
                >
                  {workspaceLayer === "original" ? (
                    <Eye className="w-5 h-5" />
                  ) : (
                    <EyeOff className="w-5 h-5" />
                  )}
                  <span>
                    {workspaceLayer === "original"
                      ? "แสดงคำแปล"
                      : "ดูต้นฉบับ"}
                  </span>
                </button>
              </div>
            </div>

            {/* ── Section: ⚙️ ตั้งค่า ── */}
            <div>
              <div className="text-[10px] font-bold text-muted uppercase tracking-wider px-1 mb-1.5 flex items-center gap-1.5">
                ⚙️ ตั้งค่า
              </div>
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    onToggleNsfwBypassMode();
                    onCloseMobileMenu();
                  }}
                  className={`w-full p-2.5 rounded-lg text-sm font-medium flex items-center gap-3 transition-all duration-150 border ${
                    nsfwBypassMode
                      ? "text-red-400 bg-red-500/10 border-red-500/20 shadow-[0_0_10px_rgba(239,68,68,0.1)]"
                      : "bg-surface text-foreground border-transparent"
                  }`}
                >
                  <Flame className="w-5 h-5" />
                  <span>18+ Bypass Mode</span>
                  {nsfwBypassMode && (
                    <span className="ml-auto text-[10px] font-bold bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">
                      ON
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onOpenSettings();
                    onCloseMobileMenu();
                  }}
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
                type="button"
                onClick={handleUndo}
                disabled={!canUndo}
                className="bg-surface text-foreground disabled:opacity-25 p-2.5 rounded-lg text-sm font-medium flex justify-center items-center gap-2 border border-transparent"
              >
                <Undo2 className="w-5 h-5" /> ย้อนกลับ
              </button>
              <button
                type="button"
                onClick={handleRedo}
                disabled={!canRedo}
                className="bg-surface text-foreground disabled:opacity-25 p-2.5 rounded-lg text-sm font-medium flex justify-center items-center gap-2 border border-transparent"
              >
                <Redo2 className="w-5 h-5" /> ทำซ้ำ
              </button>
            </div>

            {/* ── Section: 📥 ดาวน์โหลด ── */}
            <div className="bg-surface/50 p-2.5 rounded-lg border border-surface-hover">
              <div className="text-[10px] font-bold text-muted uppercase tracking-wider px-1 mb-2 flex items-center gap-1.5">
                📥 ดาวน์โหลด
              </div>
              <button
                type="button"
                onClick={() => {
                  void onRequestSinglePageExport();
                  onCloseMobileMenu();
                }}
                disabled={
                  isZipping ||
                  isChoosingExport ||
                  (normalizePageExportSource(pages[currentPage]?.exportSource) ===
                    "translated" &&
                    activeBubbles.length > 0 &&
                    workspaceLayer !== "translated")
                }
                className="w-full bg-surface text-foreground disabled:opacity-40 p-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 mb-2 border border-transparent"
              >
                <Download className="w-5 h-5" /> บันทึกหน้านี้
              </button>
              <div className="grid grid-cols-4 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void onRequestBookExport("strip");
                    onCloseMobileMenu();
                  }}
                  title="ภาพยาว (หลายส่วนรวม ZIP)"
                  disabled={isZipping || isChoosingExport || pages.length === 0}
                  className="bg-surface text-foreground disabled:opacity-40 p-2 rounded-lg text-xs font-bold flex flex-col items-center justify-center gap-1 border border-transparent"
                >
                  {isZipping ? (
                    <span className="animate-spin h-4 w-4 border-2 border-foreground border-t-transparent rounded-full" />
                  ) : (
                    <>
                      <GalleryVertical className="w-5 h-5 text-muted" />
                      <span>Strip</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void onRequestBookExport("zip");
                    onCloseMobileMenu();
                  }}
                  disabled={isZipping || isChoosingExport || pages.length === 0}
                  className="bg-surface text-foreground disabled:opacity-40 p-2 rounded-lg text-xs font-bold flex flex-col items-center justify-center gap-1 border border-transparent"
                >
                  {isZipping ? (
                    <span className="animate-spin h-4 w-4 border-2 border-foreground border-t-transparent rounded-full" />
                  ) : (
                    <>
                      <FileArchive className="w-5 h-5 text-muted" />
                      <span>ZIP</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void onRequestBookExport("cbz");
                    onCloseMobileMenu();
                  }}
                  disabled={isZipping || isChoosingExport || pages.length === 0}
                  className="bg-surface text-foreground disabled:opacity-40 p-2 rounded-lg text-xs font-bold flex flex-col items-center justify-center gap-1 border border-transparent"
                >
                  {isZipping ? (
                    <span className="animate-spin h-4 w-4 border-2 border-foreground border-t-transparent rounded-full" />
                  ) : (
                    <>
                      <BookOpen className="w-5 h-5 text-muted" />
                      <span>CBZ</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void onRequestBookExport("pdf");
                    onCloseMobileMenu();
                  }}
                  disabled={isZipping || isChoosingExport || pages.length === 0}
                  className="bg-surface text-foreground disabled:opacity-40 p-2 rounded-lg text-xs font-bold flex flex-col items-center justify-center gap-1 border border-transparent"
                >
                  {isZipping ? (
                    <span className="animate-spin h-4 w-4 border-2 border-foreground border-t-transparent rounded-full" />
                  ) : (
                    <>
                      <FileText className="w-5 h-5 text-muted" />
                      <span>PDF</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </header>
  );
}
