"use client";

import type { ReactNode, ComponentProps } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { MaskEditor } from "@/components/cleaning/MaskEditor";
import { SettingsModal } from "@/components/workspace/SettingsModal";
import { FindReplaceDialog } from "@/components/editing/FindReplaceDialog";
import { KeyboardShortcutsDialog } from "@/components/editing/KeyboardShortcutsDialog";
import { ExportReportModal } from "@/components/workspace/ExportReportModal";
import { TranslationDiagnosticModal } from "@/components/workspace/TranslationDiagnosticModal";
import type { PixelRect } from "@/lib/cleaning/types";
import type { PageCleaningResult } from "@/hooks/useCleaning";
import type { PageReviewInfo } from "@/lib/export/reviewGate";
import type { PageExportSource } from "@/lib/export/pageSource";
import { normalizePageExportSource } from "@/lib/export/pageSource";

export interface WorkspaceExportPageItem {
  id?: string;
  url: string;
  name: string;
  originUrl?: string;
  readerImageUrl?: string;
  exportSource?: PageExportSource;
  exportExcluded?: boolean;
  sourceFingerprint?: string;
}

export interface ReviewIssuePoint {
  index: number;
  pointId: string;
  characters?: string;
  suggestion?: string;
  hasSource?: boolean;
  humanConfirmable?: boolean;
}

export interface ReviewIssuePage {
  pageIndex: number;
  pageUrl: string;
  targetUnconfirmed?: boolean;
  scriptIssues: ReviewIssuePoint[];
  unverified: ReviewIssuePoint[];
}

export interface WorkspaceModalsHostProps {
  // 1. Mask Editor
  isMaskEditorOpen: boolean;
  currentCleaningResult?: PageCleaningResult | null;
  currentPageItem?: WorkspaceExportPageItem | null;
  maskFocusRect?: PixelRect;
  onCloseMaskEditor: () => void;
  onRetryRegion: ComponentProps<typeof MaskEditor>["onRetry"];
  onResolveRegion: ComponentProps<typeof MaskEditor>["onResolveRegion"];
  onRefreshProposal: ComponentProps<typeof MaskEditor>["onRefreshProposal"];

  // 2. Settings Modal
  isSettingsOpen: boolean;
  onCloseSettings: () => void;
  sourceLang: string;
  targetLang: string;
  onTargetLangChange: (lang: string) => void;
  onSourceLangChange: (lang: string) => void;
  textStyle: ComponentProps<typeof SettingsModal>["textStyle"];
  onTextStyleChange: ComponentProps<typeof SettingsModal>["onTextStyleChange"];
  modelPreference: string;
  onModelPreferenceChange: (model: string) => void;
  allowPreviewModels: boolean;
  onAllowPreviewModelsChange: (allow: boolean) => void;
  userApiKey: string;
  onUserApiKeyChange: (key: string) => void;
  focusApiKey?: boolean;
  onValidateApiKey: ComponentProps<typeof SettingsModal>["onValidateApiKey"];
  onApiKeyValidated: () => void;
  glossary: ComponentProps<typeof SettingsModal>["glossary"];
  onGlossaryChange: ComponentProps<typeof SettingsModal>["onGlossaryChange"];
  onAutoExtractGlossary: () => void;
  sfxMode: ComponentProps<typeof SettingsModal>["sfxMode"];
  onSfxModeChange: ComponentProps<typeof SettingsModal>["onSfxModeChange"];
  nsfwBypassMode: boolean;
  onNsfwBypassModeChange: (enabled: boolean) => void;
  autoProceedOnReview: boolean;
  onAutoProceedOnReviewChange: (enabled: boolean) => void;

  // 3. Find & Replace Dialog
  isFindReplaceOpen: boolean;
  onCloseFindReplace: () => void;
  onReplaceText: ComponentProps<typeof FindReplaceDialog>["onReplace"];

  // 4. Keyboard Shortcuts Dialog
  isShortcutsOpen: boolean;
  onCloseShortcuts: () => void;

  // 5. Legacy Saved-Work Target Confirmation
  legacyTargetPages?: { pageIndex: number; pageUrl: string }[] | null;
  onPostponeLegacyTarget: () => void;
  onConfirmLegacyTarget: () => void;

  // 6. Actionable Review List
  reviewIssues?: ReviewIssuePage[] | null;
  isRepairingBook?: boolean;
  operationBusy?: boolean;
  onCancelWholeBookRepair?: () => void;
  onApplyAllSuggestedReviews?: () => void;
  onRepairWholeBook?: () => void;
  onConfirmLegacyTargetFromReview?: () => void;
  onNavigateToReviewIssuePage?: (pageIndex: number) => void;
  onConfirmPointReview?: (pageUrl: string, pointIndex: number, useSuggestion?: boolean) => void;
  onCloseReviewIssues?: () => void;

  // 7. Human Review Confirmation Gate Modal
  unconfirmedReviewPages?: PageReviewInfo[] | null;
  pendingExportAction?: (() => void) | null;
  pages: WorkspaceExportPageItem[];
  cleaningResultsByPage: Map<string, PageCleaningResult>;
  exportSnapshotPages?: WorkspaceExportPageItem[] | null;
  pendingReviewIndices?: number[];
  onApproveExportPageInPlace: (pageUrl: string) => void;
  onSubstituteExportPageWithOriginal: (pageUrl: string) => void;
  onExcludeExportPage: (pageUrl: string) => void;
  onNavigateToReviewPage: (pageIndex: number) => void;
  onCancelReview: () => void;
  onProceedWithHold: () => void;
  onApproveAllPagesInPlace: () => void;
  onProceedWithExport: () => void;

  // 8. Export Report Modal
  isExportReportOpen: boolean;
  exportReportRows: ComponentProps<typeof ExportReportModal>["rows"];
  isZipping?: boolean;
  onCloseExportReport: () => void;
  onSelectReadabilityFinding: ComponentProps<typeof ExportReportModal>["onSelectFinding"];
  onSelectReportPage: ComponentProps<typeof ExportReportModal>["onSelectPage"];
  onContinueExport?: ComponentProps<typeof ExportReportModal>["onContinueExport"];
  hasPendingReadabilityExport?: boolean;
  exportScanProgress?: ComponentProps<typeof ExportReportModal>["scanProgress"];
  exportImageFormat: ComponentProps<typeof ExportReportModal>["exportImageFormat"];
  onExportImageFormatChange: ComponentProps<typeof ExportReportModal>["onExportImageFormatChange"];

  // 9. Translation Diagnostic Modal
  isDiagnosticModalOpen: boolean;
  onCloseDiagnosticModal: () => void;
  failureGroups: ComponentProps<typeof TranslationDiagnosticModal>["failureGroups"];
  onRetryFailureGroup: ComponentProps<typeof TranslationDiagnosticModal>["onRetryFailureGroup"];
  onEnableNsfwBypassAndRetry: ComponentProps<typeof TranslationDiagnosticModal>["onEnableNsfwBypassAndRetry"];
  onOpenSettingsApiKey: ComponentProps<typeof TranslationDiagnosticModal>["onOpenSettingsApiKey"];
  onRecoverCleaner: ComponentProps<typeof TranslationDiagnosticModal>["onRecoverCleaner"];
  cleanerRecoveryByGroup: ComponentProps<typeof TranslationDiagnosticModal>["cleanerRecoveryByGroup"];
  apiKeyReadyByGroup: ComponentProps<typeof TranslationDiagnosticModal>["apiKeyReadyByGroup"];
}

export function WorkspaceModalsHost(props: WorkspaceModalsHostProps): ReactNode {
  const {
    isMaskEditorOpen,
    currentCleaningResult,
    currentPageItem,
    maskFocusRect,
    onCloseMaskEditor,
    onRetryRegion,
    onResolveRegion,
    onRefreshProposal,

    isSettingsOpen,
    onCloseSettings,
    sourceLang,
    targetLang,
    onTargetLangChange,
    onSourceLangChange,
    textStyle,
    onTextStyleChange,
    modelPreference,
    onModelPreferenceChange,
    allowPreviewModels,
    onAllowPreviewModelsChange,
    userApiKey,
    onUserApiKeyChange,
    focusApiKey,
    onValidateApiKey,
    onApiKeyValidated,
    glossary,
    onGlossaryChange,
    onAutoExtractGlossary,
    sfxMode,
    onSfxModeChange,
    nsfwBypassMode,
    onNsfwBypassModeChange,
    autoProceedOnReview,
    onAutoProceedOnReviewChange,

    isFindReplaceOpen,
    onCloseFindReplace,
    onReplaceText,

    isShortcutsOpen,
    onCloseShortcuts,

    legacyTargetPages,
    onPostponeLegacyTarget,
    onConfirmLegacyTarget,

    reviewIssues,
    isRepairingBook,
    operationBusy,
    onCancelWholeBookRepair,
    onApplyAllSuggestedReviews,
    onRepairWholeBook,
    onConfirmLegacyTargetFromReview,
    onNavigateToReviewIssuePage,
    onConfirmPointReview,
    onCloseReviewIssues,

    unconfirmedReviewPages,
    pendingExportAction,
    pages,
    cleaningResultsByPage,
    exportSnapshotPages,
    pendingReviewIndices,
    onApproveExportPageInPlace,
    onSubstituteExportPageWithOriginal,
    onExcludeExportPage,
    onNavigateToReviewPage,
    onCancelReview,
    onProceedWithHold,
    onApproveAllPagesInPlace,
    onProceedWithExport,

    isExportReportOpen,
    exportReportRows,
    onCloseExportReport,
    onSelectReadabilityFinding,
    onSelectReportPage,
    onContinueExport,
    hasPendingReadabilityExport,
    exportScanProgress,
    exportImageFormat,
    onExportImageFormatChange,

    isDiagnosticModalOpen,
    onCloseDiagnosticModal,
    failureGroups,
    onRetryFailureGroup,
    onEnableNsfwBypassAndRetry,
    onOpenSettingsApiKey,
    onRecoverCleaner,
    cleanerRecoveryByGroup,
    apiKeyReadyByGroup,
  } = props;

  return (
    <>
      {/* 1. Mask Editor */}
      {isMaskEditorOpen && currentCleaningResult && currentPageItem && (
        <MaskEditor
          sourceUrl={currentPageItem.url}
          cleanUrl={currentCleaningResult.cleanUrl}
          proposalMaskUrl={currentCleaningResult.reviewMaskUrl}
          maskUrl={currentCleaningResult.maskUrl}
          regions={currentCleaningResult.regions}
          focusRect={maskFocusRect}
          onClose={onCloseMaskEditor}
          onRetry={onRetryRegion}
          onResolveRegion={onResolveRegion}
          onRefreshProposal={onRefreshProposal}
        />
      )}

      {/* 2. Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={onCloseSettings}
        sourceLang={sourceLang}
        targetLang={targetLang}
        onTargetLangChange={onTargetLangChange}
        onSourceLangChange={onSourceLangChange}
        textStyle={textStyle}
        onTextStyleChange={onTextStyleChange}
        modelPreference={modelPreference}
        onModelPreferenceChange={onModelPreferenceChange}
        allowPreviewModels={allowPreviewModels}
        onAllowPreviewModelsChange={onAllowPreviewModelsChange}
        userApiKey={userApiKey}
        onUserApiKeyChange={onUserApiKeyChange}
        focusApiKey={focusApiKey}
        onValidateApiKey={onValidateApiKey}
        onApiKeyValidated={onApiKeyValidated}
        glossary={glossary}
        onGlossaryChange={onGlossaryChange}
        onAutoExtractGlossary={onAutoExtractGlossary}
        sfxMode={sfxMode}
        onSfxModeChange={onSfxModeChange}
        nsfwBypassMode={nsfwBypassMode}
        onNsfwBypassModeChange={onNsfwBypassModeChange}
        autoProceedOnReview={autoProceedOnReview}
        onAutoProceedOnReviewChange={onAutoProceedOnReviewChange}
      />

      {/* 3. Find & Replace Dialog */}
      <FindReplaceDialog
        isOpen={isFindReplaceOpen}
        onClose={onCloseFindReplace}
        onReplace={onReplaceText}
      />

      {/* 4. Keyboard Shortcuts Dialog */}
      <KeyboardShortcutsDialog
        isOpen={isShortcutsOpen}
        onClose={onCloseShortcuts}
      />

      {/* 5. Legacy Saved-Work Target Confirmation */}
      {legacyTargetPages && legacyTargetPages.length > 0 && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div
            role="dialog"
            aria-label="ยืนยันภาษาปลายทางของงานเก่า"
            className="bg-surface border border-border shadow-2xl rounded-2xl max-w-lg w-full p-5 flex flex-col gap-4"
          >
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-primary/15 text-primary text-xl flex-shrink-0">🌐</div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold text-foreground">ยืนยันภาษาปลายทางของงานเก่า</h3>
                <p className="text-xs text-muted mt-1 leading-relaxed">
                  งานเก่าต้องยืนยันภาษาครั้งแรกก่อนตรวจสอบ — ระบบแนะนำภาษาไทย (Thai) หน้าที่เคยบันทึกภาษาไว้แล้วจะคงภาษาของตัวเอง และการเปลี่ยนภาษาในงานถัดไปจะไม่มีผลกับงานที่บันทึกไว้
                </p>
              </div>
            </div>
            <div className="max-h-48 overflow-y-auto border border-border/60 rounded-xl divide-y divide-border/40 bg-background/50">
              {legacyTargetPages.map((page) => (
                <div key={page.pageUrl} className="px-3 py-2 text-xs text-foreground">
                  หน้า {page.pageIndex + 1}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-border/50">
              <button
                type="button"
                onClick={onPostponeLegacyTarget}
                className="px-4 py-2 rounded-xl border border-border hover:bg-surface text-xs font-semibold text-muted hover:text-foreground transition-colors cursor-pointer"
              >
                ยืนยันภายหลัง
              </button>
              <button
                type="button"
                onClick={onConfirmLegacyTarget}
                className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-primary-content text-xs font-semibold shadow-md transition-colors cursor-pointer"
              >
                ยืนยันใช้ภาษา {targetLang}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. Actionable Review List */}
      {reviewIssues && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div
            role="dialog"
            aria-label="รายการตรวจคำแปลที่ต้องดำเนินการ"
            className="bg-surface border border-border shadow-2xl rounded-2xl max-w-xl w-full p-5 flex flex-col gap-4"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-bold text-foreground">รายการตรวจคำแปลที่ต้องดำเนินการ</h3>
              <div className="flex items-center gap-2">
                {isRepairingBook && onCancelWholeBookRepair && (
                  <button
                    type="button"
                    onClick={onCancelWholeBookRepair}
                    aria-label="ยกเลิกการแก้ทั้งเล่ม"
                    className="px-3 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400 text-xs font-semibold cursor-pointer"
                  >
                    ยกเลิก
                  </button>
                )}
                {onApplyAllSuggestedReviews && reviewIssues.some((p) => p.unverified.some((pt) => pt.suggestion)) && (
                  <button
                    type="button"
                    onClick={onApplyAllSuggestedReviews}
                    disabled={isRepairingBook || operationBusy}
                    aria-label="ใช้คำแปลที่เกลาทั้งหมด"
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md transition-colors cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
                  >
                    ✨ ใช้คำแปลที่เกลาทั้งหมด
                  </button>
                )}
                {onRepairWholeBook && (
                  <button
                    type="button"
                    onClick={onRepairWholeBook}
                    disabled={isRepairingBook || operationBusy}
                    aria-label="แก้ตัวอักษรปนทั้งเล่ม"
                    className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-hover text-primary-content text-xs font-semibold shadow-md transition-colors cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
                  >
                    {isRepairingBook ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                    แก้ตัวอักษรปนทั้งเล่ม
                  </button>
                )}
              </div>
            </div>
            <p className="text-xs text-muted leading-relaxed">
              จุดที่มีตัวอักษรภาษาอื่นปนต้องแก้ไขหรือสั่งแก้ทั้งเล่มก่อนส่งออก และยืนยันเองไม่ได้ · จุดที่สคริปต์ผ่านแต่ยังไม่ได้ตรวจด้วย AI สามารถยืนยันเองได้เมื่อเทียบกับต้นฉบับแล้ว
            </p>
            <div className="max-h-80 overflow-y-auto border border-border/60 rounded-xl divide-y divide-border/40 bg-background/50">
              {reviewIssues.map((page) => (
                <div key={page.pageUrl} className="p-3 flex flex-col gap-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-foreground">หน้า {page.pageIndex + 1}</span>
                    <div className="flex items-center gap-1.5">
                      {page.targetUnconfirmed && onConfirmLegacyTargetFromReview && (
                        <>
                          <span className="px-1.5 py-0.5 rounded bg-primary/15 text-primary text-[10px] font-medium">
                            ยืนยันภาษาของหน้าก่อน
                          </span>
                          <button
                            type="button"
                            onClick={onConfirmLegacyTargetFromReview}
                            className="px-2 py-1 rounded border border-primary/40 bg-primary/10 hover:bg-primary/20 text-primary text-[11px] font-medium transition-colors cursor-pointer"
                          >
                            ยืนยันภาษา
                          </button>
                        </>
                      )}
                      {onNavigateToReviewIssuePage && (
                        <button
                          type="button"
                          onClick={() => onNavigateToReviewIssuePage(page.pageIndex)}
                          className="px-2 py-1 rounded border border-border hover:bg-surface text-[11px] font-medium transition-colors cursor-pointer"
                        >
                          ไปที่หน้านี้
                        </button>
                      )}
                    </div>
                  </div>
                  {page.scriptIssues.map((point) => (
                    <div key={`script-${point.index}`} className="flex flex-wrap items-center gap-2 text-red-500">
                      <span className="font-medium">จุด #{point.pointId}</span>
                      <span>ตัวอักษรปน: {point.characters}</span>
                      <span className="text-muted">— เปิดแก้ไขข้อความเพื่อเทียบต้นฉบับ (ยืนยันผ่านไม่ได้)</span>
                    </div>
                  ))}
                  {page.unverified.map((point) => (
                    <div key={`unverified-${point.index}`} className="flex flex-wrap items-center gap-2 text-foreground">
                      <span className="font-medium">จุด #{point.pointId}</span>
                      <span className="text-muted">
                        {point.suggestion
                          ? `คำแนะนำ AI: "${point.suggestion}"`
                          : point.hasSource
                          ? "สคริปต์ผ่าน แต่ยังไม่ได้ตรวจบริบท"
                          : "ไม่มีข้อความต้นฉบับ กรุณาตรวจจากภาพ"}
                      </span>
                      {point.suggestion && onConfirmPointReview && (
                        <button
                          type="button"
                          onClick={() => onConfirmPointReview(page.pageUrl, point.index, true)}
                          aria-label={`ใช้คำแปลที่เกลาจุดที่ ${point.pointId}`}
                          className="px-2 py-1 rounded bg-indigo-600/15 text-indigo-400 border border-indigo-500/30 text-[11px] font-medium hover:bg-indigo-600/25 transition-colors cursor-pointer"
                        >
                          ✨ ใช้คำแปลที่เกลา
                        </button>
                      )}
                      {point.humanConfirmable && onConfirmPointReview && (
                        <button
                          type="button"
                          onClick={() => onConfirmPointReview(page.pageUrl, point.index)}
                          aria-label={`ยืนยันจุดที่ ${point.pointId} ตรงต้นฉบับ`}
                          className="px-2 py-1 rounded bg-emerald-600/15 text-emerald-500 border border-emerald-500/30 text-[11px] font-medium hover:bg-emerald-600/25 transition-colors cursor-pointer"
                        >
                          ยืนยันว่าตรงกับต้นฉบับ
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-end pt-2 border-t border-border/50">
              <button
                type="button"
                onClick={onCloseReviewIssues}
                className="px-4 py-2 rounded-xl border border-border hover:bg-surface text-xs font-semibold text-muted hover:text-foreground transition-colors cursor-pointer"
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. Human Review Confirmation Gate Modal */}
      {unconfirmedReviewPages && (unconfirmedReviewPages.length > 0 || pendingExportAction) && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-surface border border-border shadow-2xl rounded-2xl max-w-2xl w-full p-5 flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-amber-500/15 text-amber-500 text-xl flex-shrink-0">
                ⚠️
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold text-foreground">
                  มีหน้าที่ต้องได้รับการยืนยันก่อน Export
                </h3>
                <p className="text-xs text-muted mt-1 leading-relaxed">
                  ตรวจหน้าที่ระบุหรือกลับไปแก้ก่อนก็ได้ หากต้องการไฟล์ทันที เลือกส่งออกภาพและคำแปลปัจจุบันทั้งที่มีจุดค้างได้
                </p>
              </div>
            </div>

            <div className="max-h-60 overflow-y-auto border border-border/60 rounded-xl divide-y divide-border/40 bg-background/50">
              {unconfirmedReviewPages.map((p) => (
                <div key={p.pageUrl} className="flex items-center justify-between p-3 text-xs">
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <span className="font-semibold text-foreground">
                      หน้า {p.pageIndex + 1}
                    </span>
                    <span className="text-muted truncate max-w-[150px]">
                      ({p.pageName})
                    </span>
                    <div className="flex flex-wrap items-center gap-1">
                      {p.scriptIssueCount > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-500 text-[10px] font-medium">
                          ตัวอักษรภาษาอื่นปน {p.scriptIssueCount} จุด (ยืนยันผ่านไม่ได้)
                        </span>
                      )}
                      {p.unverifiedReviewCount > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-500 text-[10px] font-medium">
                          ยังไม่ได้ตรวจกับต้นฉบับ {p.unverifiedReviewCount} จุด
                        </span>
                      )}
                      {p.targetUnconfirmed && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500 text-[10px] font-medium">
                          ยังไม่ยืนยันภาษาของหน้า
                        </span>
                      )}
                      {p.backgroundBlocked && (
                        <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-500 text-[10px] font-medium">
                          พบร่องรอยต้องตรวจในภาพพื้นหลัง
                        </span>
                      )}
                      {p.missingTranslationCount > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-500 text-[10px] font-medium">
                          ยังไม่มีคำแปล {p.missingTranslationCount} บริเวณ
                        </span>
                      )}
                      {p.hasUncertainCleaning && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500 text-[10px] font-medium">
                          การคลีนไม่แน่นอน
                        </span>
                      )}
                      {p.hasUncertainTranslation && (
                        <span className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-500 text-[10px] font-medium">
                          คำแปลควรตรวจสอบ
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => onApproveExportPageInPlace(p.pageUrl)}
                      className="px-2 py-1 rounded border border-emerald-500/50 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-[11px] font-semibold transition-colors cursor-pointer"
                    >
                      อนุมัติหน้านี้
                    </button>
                    {p.hasHardBlockers && (
                      <button
                        type="button"
                        onClick={() => onSubstituteExportPageWithOriginal(p.pageUrl)}
                        className="px-2 py-1 rounded border border-border hover:bg-surface text-[11px] font-medium transition-colors cursor-pointer"
                      >
                        ส่งออกเป็นต้นฉบับ
                      </button>
                    )}
                    {p.hasHardBlockers && pendingReviewIndices === undefined && (
                      <button
                        type="button"
                        onClick={() => onExcludeExportPage(p.pageUrl)}
                        className="px-2 py-1 rounded border border-border hover:bg-surface text-[11px] font-medium transition-colors cursor-pointer"
                      >
                        ตัดหน้านี้ออก
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onNavigateToReviewPage(p.pageIndex)}
                      className="px-2 py-1 rounded border border-border hover:bg-surface text-[11px] font-medium transition-colors cursor-pointer"
                    >
                      ไปที่หน้านี้
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {unconfirmedReviewPages.length === 0 && (
              <p className="text-xs text-muted">
                ทุกหน้าที่ได้รับผลกระทบถูกเลือกส่งออกเป็นต้นฉบับหรือตัดออกจากการส่งออกแล้ว
              </p>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2 border-t border-border/50">
              <button
                type="button"
                onClick={onCancelReview}
                className="px-4 py-2 rounded-xl border border-border hover:bg-surface text-xs font-semibold text-muted hover:text-foreground transition-colors cursor-pointer"
              >
                ยกเลิก
              </button>
              {pendingExportAction && unconfirmedReviewPages.length > 0 && (
                <button
                  type="button"
                  onClick={onProceedWithHold}
                  className="px-3 py-2 rounded-xl border border-amber-500/60 bg-amber-500/10 hover:bg-amber-500/20 text-amber-200 text-xs font-semibold transition-colors cursor-pointer"
                >
                  ส่งออกภาพและคำแปลปัจจุบัน แม้มีจุดค้าง
                </button>
              )}
              {unconfirmedReviewPages.some((p) => p.hasHardBlockers) && (
                <button
                  type="button"
                  onClick={onApproveAllPagesInPlace}
                  className="px-3.5 py-2 rounded-xl border border-emerald-500/60 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-xs font-semibold transition-colors cursor-pointer"
                >
                  อนุมัติจุดค้างทุกหน้า
                </button>
              )}
              {unconfirmedReviewPages.some((p) => p.hasHardBlockers) && (
                <p className="text-[11px] text-muted max-w-[220px] text-right">
                  ทางเลือกส่งออกปัจจุบันจะรวมหน้าที่มีจุดค้างตามภาพและคำแปลที่เห็น
                </p>
              )}
              <button
                type="button"
                disabled={unconfirmedReviewPages.some((p) => {
                  const snapshotList = exportSnapshotPages ?? pages;
                  const pageItem = snapshotList[p.pageIndex];
                  const missingCleanAsset =
                    normalizePageExportSource(pageItem?.exportSource) === "clean" &&
                    !cleaningResultsByPage.get(p.pageUrl)?.cleanUrl;
                  return (
                    p.scriptIssueCount > 0 ||
                    p.targetUnconfirmed ||
                    p.unverifiedReviewCount > 0 ||
                    missingCleanAsset
                  );
                })}
                onClick={onProceedWithExport}
                className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-primary-content text-xs font-semibold shadow-md transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {unconfirmedReviewPages.length === 0 ? "ดำเนินการ Export ต่อ" : "ยืนยันทุกหน้าและดำเนินการ Export"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. Export Report Modal */}
      <ExportReportModal
        isOpen={isExportReportOpen}
        rows={exportReportRows}
        onClose={onCloseExportReport}
        onSelectFinding={onSelectReadabilityFinding}
        onSelectPage={onSelectReportPage}
        onContinueExport={hasPendingReadabilityExport ? onContinueExport : undefined}
        scanProgress={exportScanProgress}
        exportImageFormat={exportImageFormat}
        onExportImageFormatChange={onExportImageFormatChange}
      />

      {/* 9. Translation Diagnostic Modal */}
      <TranslationDiagnosticModal
        isOpen={isDiagnosticModalOpen}
        onClose={onCloseDiagnosticModal}
        failureGroups={failureGroups}
        onRetryFailureGroup={onRetryFailureGroup}
        onEnableNsfwBypassAndRetry={onEnableNsfwBypassAndRetry}
        onOpenSettingsApiKey={onOpenSettingsApiKey}
        onRecoverCleaner={onRecoverCleaner}
        cleanerRecoveryByGroup={cleanerRecoveryByGroup}
        apiKeyReadyByGroup={apiKeyReadyByGroup}
      />
    </>
  );
}
