import { useState, useCallback, useEffect } from "react";
import { getWorkspacePrimaryAction } from "@/lib/workspacePrimaryAction";
import { stageLabel, type WorkspaceLayer } from "@/components/cleaning/CleaningToolbar";
import { formatStopwatchTime } from "@/components/workspace/WorkspaceHeaderHost";
import type { ReviewIssuePage } from "@/components/workspace/WorkspaceModalsHost";
import type { CleaningProgress } from "@/lib/cleaning/types";

export interface UseTranslationWorkspaceCoordinatorOptions {
  // Page & Workspace State
  currentPageUrl?: string;
  currentPageIndex: number;
  pagesCount: number;
  currentCleaningResult?: unknown;
  hasCurrentTranslation: boolean;
  reviewedPageUrls: Set<string>;
  setReviewedPageUrls: (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  setWorkspaceLayer: (layer: WorkspaceLayer) => void;
  onNavigatePage: (index: number) => void;

  // Operation locks
  operationBusy: boolean;
  uiOperationLockRef: React.MutableRefObject<boolean>;
  setIsUiOperationBusy: (busy: boolean) => void;

  // Translation Hooks State
  isTranslating: boolean;
  isTranslatingAll: boolean;
  translateAllProgress: {
    current: number;
    total: number;
    status: string;
    message?: string;
    secondaryMessage?: string;
    elapsedMs?: number;
    pageElapsedMs?: number;
  } | null;
  cleaningProgress?: CleaningProgress | null;
  workflowPhase: "cleaning" | "translating" | null;
  translationResult: string | null;
  setTranslationResult: (result: string | null) => void;
  importStatusMessage?: string | null;

  // Handlers from useTranslation & useBubbleOrganizeOrchestrator
  handleTranslate: () => Promise<boolean>;
  handleTranslateAll: (indices?: number[]) => Promise<void>;
  handleAutoOrganizeAllPages: () => Promise<void>;
  scanTranslatedPages: () => Array<{ pageIndex: number; contaminated: number; total?: number }>;
  inspectLegacyTargets: () => Array<{ pageIndex: number; pageUrl: string; candidateLanguage?: string }>;
  confirmLegacyTarget: () => number;
  inspectReviewIssues: () => ReviewIssuePage[];
  confirmPointReview: (pageUrl: string, pointIndex: number, useSuggestion?: boolean) => void;
  applyAllSuggestedReviews?: (scope?: "current" | "all") => number;
  repairWholeBook: () => Promise<{
    cancelled?: boolean;
    pagesRepaired: number;
    pointsRepaired: number;
    unresolved: Array<{ pageIndex: number; points: number }>;
    skipped: Array<{ pageIndex: number }>;
  } | null>;

  // Target Language for toast feedback
  targetLang?: string;

  // Focus mode & UI elements
  isFocusMode?: boolean;
  isFocusToolbarVisible?: boolean;
  exportTriggerRef?: React.RefObject<HTMLButtonElement | null>;
  setIsMobileMenuOpen?: (open: boolean) => void;
}

export function useTranslationWorkspaceCoordinator({
  currentPageUrl,
  pagesCount,
  currentCleaningResult,
  hasCurrentTranslation,
  reviewedPageUrls,
  setReviewedPageUrls,
  setWorkspaceLayer,
  onNavigatePage,
  operationBusy,
  uiOperationLockRef,
  setIsUiOperationBusy,
  isTranslating,
  isTranslatingAll,
  translateAllProgress,
  cleaningProgress,
  workflowPhase,
  translationResult,
  setTranslationResult,
  importStatusMessage,
  handleTranslate,
  handleTranslateAll,
  handleAutoOrganizeAllPages,
  scanTranslatedPages,
  inspectLegacyTargets,
  confirmLegacyTarget,
  inspectReviewIssues,
  confirmPointReview,
  applyAllSuggestedReviews,
  repairWholeBook,
  targetLang = "Thai",
  isFocusMode = false,
  isFocusToolbarVisible = false,
  exportTriggerRef,
  setIsMobileMenuOpen,
}: UseTranslationWorkspaceCoordinatorOptions) {
  // Whole-book foreign-script scan: explicit scan + targeted re-translate
  const [contaminatedScan, setContaminatedScan] = useState<
    Array<{ pageIndex: number; contaminated: number }>
  >([]);

  // Actionable review list: per-page script failures and unverified points
  const [reviewIssues, setReviewIssues] = useState<ReviewIssuePage[] | null>(null);

  // Legacy saved-work pages that still need one-time target confirmation
  const [legacyTargetPages, setLegacyTargetPages] = useState<
    Array<{ pageIndex: number; pageUrl: string; candidateLanguage?: string }> | null
  >(null);

  // Workflow status message derivation
  const translateAllStatusText = translateAllProgress
    ? `${translateAllProgress.message}${
        translateAllProgress.secondaryMessage
          ? ` · ${translateAllProgress.secondaryMessage}`
          : ""
      } · ⏱ ${formatStopwatchTime(translateAllProgress.pageElapsedMs ?? 0)} · รวม ${formatStopwatchTime(translateAllProgress.elapsedMs ?? 0)} (${Math.round((translateAllProgress.current / translateAllProgress.total) * 100)}%)`
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
    if (
      translationResult.startsWith("⏳") ||
      translationResult.startsWith("กำลัง") ||
      translationResult.startsWith("แปลไม่สำเร็จ")
    ) return;

    const timer = setTimeout(() => {
      setTranslationResult(null);
    }, 4000);

    return () => clearTimeout(timer);
  }, [translationResult, setTranslationResult]);

  // Execute translation on current page with UI locking
  const handleTranslateCurrent = useCallback(async (): Promise<boolean> => {
    if (
      uiOperationLockRef.current ||
      operationBusy ||
      pagesCount === 0
    ) return false;

    uiOperationLockRef.current = true;
    setIsUiOperationBusy(true);
    try {
      setWorkspaceLayer("translated");
      return await handleTranslate();
    } finally {
      uiOperationLockRef.current = false;
      setIsUiOperationBusy(false);
    }
  }, [handleTranslate, operationBusy, pagesCount, setIsUiOperationBusy, setWorkspaceLayer, uiOperationLockRef]);

  // Execute whole-book batch translation and auto-organize
  const handleTranslateBook = useCallback(async (): Promise<void> => {
    if (
      uiOperationLockRef.current ||
      operationBusy ||
      pagesCount === 0
    ) return;

    uiOperationLockRef.current = true;
    setIsUiOperationBusy(true);
    try {
      setWorkspaceLayer("translated");
      await handleTranslateAll();
      await handleAutoOrganizeAllPages();
    } finally {
      uiOperationLockRef.current = false;
      setIsUiOperationBusy(false);
    }
  }, [handleAutoOrganizeAllPages, handleTranslateAll, operationBusy, pagesCount, setIsUiOperationBusy, setWorkspaceLayer, uiOperationLockRef]);

  // Contamination scan
  const handleScanTranslations = useCallback(() => {
    const found = scanTranslatedPages();
    setContaminatedScan(found);

    const pendingLegacy = inspectLegacyTargets();
    if (pendingLegacy.length > 0) {
      setLegacyTargetPages(pendingLegacy);
      return;
    }

    const issues = inspectReviewIssues();
    if (issues.length > 0) {
      setReviewIssues(issues);
      return;
    }

    void import("react-hot-toast").then((m) => {
      if (found.length === 0) {
        m.default("✅ ไม่พบตัวอักษรภาษาอื่นปนในคำแปลทั้งเล่ม", { duration: 3500 });
      } else {
        const detail = found
          .map((f) => `หน้า ${f.pageIndex + 1} (${f.contaminated}/${f.total ?? f.contaminated} จุด)`)
          .join(", ");
        m.default(
          `⚠️ พบตัวอักษรภาษาอื่นปนในคำแปล: ${detail} — แปลใหม่ได้จากเมนูเครื่องมือ`,
          { duration: 7000 },
        );
      }
    });
  }, [inspectLegacyTargets, inspectReviewIssues, scanTranslatedPages]);

  // Whole-book repair
  const handleRepairWholeBook = useCallback(async (): Promise<void> => {
    if (uiOperationLockRef.current || operationBusy) return;
    uiOperationLockRef.current = true;
    setIsUiOperationBusy(true);
    try {
      const summary = await repairWholeBook();
      if (!summary) return;
      setContaminatedScan(scanTranslatedPages());
      const issues = inspectReviewIssues();
      setReviewIssues(issues.length > 0 ? issues : null);
      void import("react-hot-toast").then((m) => {
        if (summary.cancelled) {
          const skippedNote = summary.skipped.length > 0
            ? ` — ข้าม ${summary.skipped.length} หน้า (ยืนยันภาษาไม่ครบ)`
            : "";
          m.default(`⏹ ยกเลิกการแก้ทั้งเล่ม (แก้สำเร็จ ${summary.pointsRepaired} จุด)${skippedNote} — กด Undo เพื่อคืนค่าก่อนแก้`, { duration: 5000 });
        } else if (summary.unresolved.length > 0) {
          const detail = summary.unresolved.map((page) => `หน้า ${page.pageIndex + 1} (${page.points} จุด)`).join(", ");
          const skippedNote = summary.skipped.length > 0
            ? ` และข้าม ${summary.skipped.length} หน้า (ยืนยันภาษาไม่ครบ)`
            : "";
          m.default(`⚠️ แก้ตัวอักษรปนสำเร็จ ${summary.pointsRepaired} จุด แต่ยังไม่สำเร็จ: ${detail}${skippedNote} — เปิดแก้ไขข้อความเพื่อเทียบต้นฉบับ`, { duration: 7000 });
        } else if (summary.skipped.length > 0) {
          m.default(`✅ แก้ตัวอักษรปนสำเร็จ ${summary.pointsRepaired} จุด — ข้าม ${summary.skipped.length} หน้า (ยืนยันภาษาไม่ครบ)`, { duration: 6000 });
        } else {
          m.default(`✅ แก้ตัวอักษรปนสำเร็จ ${summary.pointsRepaired} จุด (${summary.pagesRepaired} หน้า)`, { duration: 3500 });
        }
      });
    } catch (error) {
      void import("react-hot-toast").then((m) =>
        m.default(`❌ แก้ตัวอักษรปนทั้งเล่มไม่สำเร็จ: ${error instanceof Error ? error.message : String(error)}`, { duration: 6000 }),
      );
    } finally {
      uiOperationLockRef.current = false;
      setIsUiOperationBusy(false);
    }
  }, [inspectReviewIssues, operationBusy, repairWholeBook, scanTranslatedPages, setIsUiOperationBusy, uiOperationLockRef]);

  // Retranslate contaminated pages
  const handleRetranslateContaminated = useCallback(async (): Promise<void> => {
    if (
      uiOperationLockRef.current ||
      operationBusy ||
      contaminatedScan.length === 0
    ) return;
    uiOperationLockRef.current = true;
    setIsUiOperationBusy(true);
    const indices = contaminatedScan.map((f) => f.pageIndex);
    try {
      setWorkspaceLayer("translated");
      await handleTranslateAll(indices);
      setContaminatedScan(scanTranslatedPages());
    } finally {
      uiOperationLockRef.current = false;
      setIsUiOperationBusy(false);
    }
  }, [contaminatedScan, handleTranslateAll, operationBusy, scanTranslatedPages, setIsUiOperationBusy, setWorkspaceLayer, uiOperationLockRef]);

  // Primary action computation
  const hasEnteredReview = Boolean(
    currentPageUrl && reviewedPageUrls.has(currentPageUrl),
  );

  const batchIsCleaning = isTranslatingAll && translateAllProgress?.status === "cleaning";
  const batchIsTranslating = isTranslatingAll && translateAllProgress != null && translateAllProgress.status !== "cleaning";
  const effectiveIsCleaning = Boolean(cleaningProgress) || workflowPhase === "cleaning" || batchIsCleaning;
  const effectiveIsTranslating = isTranslating || batchIsTranslating;
  const effectiveWorkflowPhase: "cleaning" | "translating" | null =
    batchIsCleaning ? "cleaning"
    : batchIsTranslating ? "translating"
    : workflowPhase;

  const primaryAction = getWorkspacePrimaryAction({
    hasPage: Boolean(currentPageUrl),
    hasCleanResult: Boolean(currentCleaningResult),
    hasTranslation: hasCurrentTranslation,
    hasEnteredReview,
    isCleaning: effectiveIsCleaning,
    isTranslating: effectiveIsTranslating,
    workflowPhase: effectiveWorkflowPhase,
    cancellable: isTranslatingAll,
  });

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
      const issues = inspectReviewIssues();
      if (issues.length > 0) {
        setReviewIssues(issues);
      } else {
        void import("react-hot-toast").then((m) =>
          m.default("✨ ตรวจคำแปลหน้านี้เรียบร้อยแล้ว ไม่พบข้อผิดพลาด พร้อมส่งออก", { duration: 3500 }),
        );
      }
      return;
    }
    if (primaryAction.kind === "export") {
      if (typeof window !== "undefined" && window.innerWidth < 1024) {
        setIsMobileMenuOpen?.(true);
      } else {
        exportTriggerRef?.current?.click();
      }
      return;
    }
  };

  // Helper callbacks for modals & review dialogs
  const handlePostponeLegacyTarget = useCallback(() => {
    setLegacyTargetPages(null);
  }, []);

  const handleConfirmLegacyTarget = useCallback(() => {
    const assigned = confirmLegacyTarget();
    setLegacyTargetPages(null);
    if (assigned > 0) {
      void import("react-hot-toast").then((m) =>
        m.default(`✅ ยืนยันใช้ภาษา ${targetLang} กับ ${assigned} หน้า`, { duration: 3000 }),
      );
    }
  }, [confirmLegacyTarget, targetLang]);

  const handleConfirmLegacyTargetFromReview = useCallback(() => {
    const assigned = confirmLegacyTarget();
    if (assigned > 0) {
      void import("react-hot-toast").then((m) =>
        m.default(`✅ ยืนยันใช้ภาษา ${targetLang} กับ ${assigned} หน้า`, { duration: 3000 }),
      );
    }
    const issues = inspectReviewIssues();
    setReviewIssues(issues.length > 0 ? issues : null);
  }, [confirmLegacyTarget, inspectReviewIssues, targetLang]);

  const handleApplyAllSuggestedReviews = useCallback(() => {
    const applied = applyAllSuggestedReviews?.("all") ?? 0;
    const issues = inspectReviewIssues();
    setReviewIssues(issues.length > 0 ? issues : null);
    if (applied > 0) {
      void import("react-hot-toast").then((m) =>
        m.default(`✨ ใช้คำแปลที่ AI เกลาทั้งหมด ${applied} จุดเรียบร้อยแล้ว (กด Ctrl+Z ย้อนกลับได้)`, { duration: 3500 }),
      );
    }
  }, [applyAllSuggestedReviews, inspectReviewIssues]);

  const handleConfirmPointReview = useCallback(
    (pageUrl: string, pointIndex: number, useSuggestion?: boolean) => {
      if (useSuggestion !== undefined) {
        confirmPointReview(pageUrl, pointIndex, useSuggestion);
      } else {
        confirmPointReview(pageUrl, pointIndex);
      }
      const issues = inspectReviewIssues();
      setReviewIssues(issues.length > 0 ? issues : null);
    },
    [confirmPointReview, inspectReviewIssues],
  );

  const handleCloseReviewIssues = useCallback(() => {
    setReviewIssues(null);
  }, []);

  const handleNavigateToReviewIssuePage = useCallback(
    (pageIndex: number) => {
      setReviewIssues(null);
      onNavigatePage(pageIndex);
    },
    [onNavigatePage],
  );

  return {
    // Primary Action
    primaryAction,
    handlePrimaryAction,
    hasEnteredReview,

    // Direct Translation Triggers
    handleTranslateCurrent,
    handleTranslateBook,

    // Status & Notification
    workflowMessage,

    // Contaminated scan & Review state
    contaminatedScan,
    setContaminatedScan,
    reviewIssues,
    setReviewIssues,
    legacyTargetPages,
    setLegacyTargetPages,

    // Coordinator Actions
    handleScanTranslations,
    handleRepairWholeBook,
    handleRetranslateContaminated,
    handlePostponeLegacyTarget,
    handleConfirmLegacyTarget,
    handleConfirmLegacyTargetFromReview,
    handleApplyAllSuggestedReviews,
    handleConfirmPointReview,
    handleCloseReviewIssues,
    handleNavigateToReviewIssuePage,
  };
}
