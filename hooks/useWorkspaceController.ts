"use client";

import { useState, useRef, useEffect, type DragEvent } from "react";
import type { WorkspaceHeaderHostProps } from "@/components/workspace/WorkspaceHeaderHost";
import type { WorkspaceCanvasHostProps } from "@/components/workspace/WorkspaceCanvasHost";
import type { WorkspaceBottomStripHostProps } from "@/components/workspace/WorkspaceBottomStripHost";
import type { WorkspaceModalsHostProps } from "@/components/workspace/WorkspaceModalsHost";
import {
  useExportOrchestrator,
  type WorkspaceExportPage,
} from "@/hooks/useExportOrchestrator";
import {
  useWorkspaceDocumentManager,
  type WorkspaceDocumentSessionBridge,
} from "@/hooks/useWorkspaceDocumentManager";
import { useWorkspaceToolbarView } from "@/hooks/useWorkspaceToolbarView";
import { useWorkspaceModalsState } from "@/hooks/useWorkspaceModalsState";
import { useCleaningOrchestrator } from "@/hooks/useCleaningOrchestrator";
import { useTranslationOrchestrator, type TranslationBridge } from "@/hooks/useTranslationOrchestrator";
import { useExtensionWorkspaceBridge } from "@/hooks/useExtensionWorkspaceBridge";
import { useWorkspaceTextActions } from "@/hooks/useWorkspaceTextActions";
import { useTranslationWorkspaceCoordinator } from "@/hooks/useTranslationWorkspaceCoordinator";
import { useWorkspaceShortcuts } from "@/hooks/useWorkspaceShortcuts";
import {
  doesPageRequireReview,
  missingTranslationSignature,
} from "@/lib/export/reviewGate";

export interface WorkspaceControllerOutput {
  headerProps: WorkspaceHeaderHostProps;
  canvasProps: WorkspaceCanvasHostProps;
  bottomStripProps: WorkspaceBottomStripHostProps;
  modalsProps: WorkspaceModalsHostProps;
  rootProps: {
    onDragOver: (e: DragEvent<HTMLDivElement>) => void;
    onDragLeave: (e: DragEvent<HTMLDivElement>) => void;
    onDrop: (e: DragEvent<HTMLDivElement>) => void;
  };
  translateAllProgress: { current: number; total: number } | null;
  isFocusMode: boolean;
}

export function useWorkspaceController(): WorkspaceControllerOutput {
  const exportSnapshotRef = useRef<{ pages: WorkspaceExportPage[]; currentPage: number } | null>(null);
  const sessionBridgeRef = useRef<WorkspaceDocumentSessionBridge>({});

  const {
    pages,
    currentPage,
    setCurrentPage,
    currentPageRef,
    pagesRef,
    confirmedPages,
    setConfirmedPages,
    confirmedPagesRef,
    confirmedMissingTranslationsRef,
    brokenPages,
    isDragging,
    isImporting,
    importStatusMessage,
    savedSessionData,
    handleImageUpload,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDeletePage,
    handleRemovePage,
    handleReorderPages,
    handleClearAllPages,
    handleImageError,
    handlePageExportSourceChange,
    handleRestoreSavedSession,
    handleClearSavedSession,
    handleExportProjectFile,
    handleImportProjectFile,
  } = useWorkspaceDocumentManager({
    exportSnapshotRef,
    sessionBridgeRef,
  });

  const {
    workspaceLayer,
    setWorkspaceLayer,
    viewLayout,
    setViewLayout,
    toggleViewLayout,
    isMobileMenuOpen,
    setIsMobileMenuOpen,
    toggleMobileMenu,
    closeMobileMenu,
    isThumbnailsCollapsed,
    toggleThumbnailsCollapse,
    isFocusMode,
    toggleFocusMode,
    exitFocusMode,
    isFocusToolbarVisible,
    setIsFocusToolbarVisible,
    toggleFocusToolbar,
    toolbarPosition,
    toggleToolbarPosition,
    isToolbarCollapsed,
    toggleToolbarCollapsed,
  } = useWorkspaceToolbarView();

  const {
    isSettingsOpen,
    setIsSettingsOpen,
    openSettings,
    closeSettings,
    settingsFocusTarget,
    openSettingsApiKey,
    handleApiKeyValidated,
    isMaskEditorOpen,
    openMaskEditor,
    closeMaskEditor,
    openMaskCandidate,
    maskFocusRect,
    isFindReplaceOpen,
    openFindReplace,
    closeFindReplace,
    isShortcutsOpen,
    openShortcuts,
    closeShortcuts,
    isDiagnosticModalOpen,
    openDiagnostics,
    closeDiagnostics,
    cleanerRecoveryByGroup,
    handleRecoverCleaner,
    validateRecoveryApiKey,
    apiKeyReadyByGroup,
  } = useWorkspaceModalsState();

  const uiOperationLockRef = useRef(false);
  const dirtyExportPagesRef = useRef<Set<string>>(new Set());
  const [isUiOperationBusy, setIsUiOperationBusy] = useState(false);

  const [reviewedPageUrls, setReviewedPageUrls] = useState<Set<string>>(
    () => new Set(),
  );

  const translationBridgeRef = useRef<TranslationBridge>({});

  const {
    currentCleaningResult,
    cleaningProgress,
    cleaningError,
    cleaningResultsByPage,
    cleaningCacheRevision,
    getCurrentRemnantReview,
    confirmArtworkCandidate,
    confirmHumanImageInspection,
    confirmAllPageRemnants,
    recheckPageRemnants,
    handleCleanCurrentPage,
    handleRetryRegion,
    resolveMaskRegion,
    refreshMaskProposal,
    preparePageForTranslation,
    getExpectedRemnantEvidence,
    syncCleaningEvidence,
  } = useCleaningOrchestrator({
    pages,
    currentPage,
    uiOperationLockRef,
    setIsUiOperationBusy,
    setWorkspaceLayer,
    setReviewedPageUrls,
    translationBridgeRef,
  });

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
    allowPreviewModels,
    setAllowPreviewModels,
    targetLang,
    setTargetLang,
    pageTargetCacheRef,
    getPageTargetLanguage,
    sourceLang,
    setSourceLang,
    textStyle,
    setTextStyle,
    sfxMode,
    setSfxMode,
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
    autoProceedOnReview,
    setAutoProceedOnReview,
    scanTranslatedPages,
    inspectTranslatedPages,
    inspectLegacyTargets,
    confirmLegacyTarget,
    inspectReviewIssues,
    confirmPointReview,
    confirmAllPageReviews,
    applyAllSuggestedReviews,
    repairWholeBook,
    cancelWholeBookRepair,
    isRepairingBook,
    replaceBubbleText,
    getPageSignature,
    getPageSourceRevision,
    resizeSavedText,
    translationCacheRevision,
    handleAutoOrganizeCurrentPage,
    handleAutoOrganizeAllPages,
    handleApplyBwContrastCurrentPage,
    handleApplyBwContrastAllPages,
  } = useTranslationOrchestrator({
    pages,
    currentPage,
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
  });

  const {
    isChoosingExport,
    isZipping,
    unconfirmedReviewPages,
    pendingExportAction,
    pendingReviewIndicesRef,
    exportImageFormat,
    setExportImageFormat,
    isExportReportOpen,
    exportReportRows,
    exportScanProgress,
    pendingReadabilityExport,
    handleOpenExportReport,
    continueReadabilityExport,
    selectReadabilityFinding,
    collectExportReviewPages,
    exportInputSignature,
    substituteExportPageWithOriginal,
    excludeExportPage,
    approveExportPageInPlace,
    approveAllExportPagesInPlace,
    requestSinglePageExport,
    requestBookExport,
    handleCancelReview,
    handleProceedWithHold,
    handleProceedWithExport,
    handleNavigateToReviewPage,
    handleCloseExportReport,
    handleSelectReportPage,
  } = useExportOrchestrator({
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
    exportSnapshotRef,
  });

  const { isPublishingBack, handlePublishBackToReadingView } =
    useExtensionWorkspaceBridge({
      pages,
      currentPage,
      userApiKey,
      modelPreference,
      allowPreviewModels,
      glossary,
      textStyle,
      targetLang,
      sourceLang,
      bubbleCacheRef,
      pageTargetCacheRef,
      getCurrentRemnantReview,
      getExpectedRemnantEvidence,
      getPageSourceRevision,
      cleaningResultsByPage,
      translatedImages,
      exportInputSignature,
      collectExportReviewPages,
    });

  const {
    currentPageUrl,
    translatedImagesMap,
    hasCurrentTranslation,
    toggleOriginalTranslated,
    handleAutoExtractGlossary,
    handleFindReplace,
  } = useWorkspaceTextActions({
    pages,
    currentPage,
    activeBubbles,
    bubbleCacheRef,
    translatedImages,
    translationCacheRevision,
    setWorkspaceLayer,
    glossary,
    setGlossary,
    cleaningResultsByPage,
    replaceBubbleText,
  });

  const translationBusy = isTranslating || isTranslatingAll;
  const operationBusy =
    isUiOperationBusy || translationBusy || Boolean(cleaningProgress) || isZipping || isChoosingExport;
  const exportTriggerRef = useRef<HTMLButtonElement>(null);
  const advancedToolsTriggerRef = useRef<HTMLButtonElement>(null);

  const {
    primaryAction,
    handlePrimaryAction,
    handleTranslateCurrent,
    handleTranslateBook,
    workflowMessage,
    contaminatedScan,
    reviewIssues,
    legacyTargetPages,
    setLegacyTargetPages,
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
  } = useTranslationWorkspaceCoordinator({
    currentPageUrl,
    currentPageIndex: currentPage,
    pagesCount: pages.length,
    currentCleaningResult,
    hasCurrentTranslation,
    reviewedPageUrls,
    setReviewedPageUrls,
    setWorkspaceLayer,
    onNavigatePage: setCurrentPage,
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
    targetLang,
    isFocusMode,
    isFocusToolbarVisible,
    exportTriggerRef,
    setIsMobileMenuOpen,
  });

  sessionBridgeRef.current = {
    restoreSavedSession,
    clearSavedSession,
    setActiveBubbles,
    setWorkspaceLayer,
    inspectLegacyTargets,
    setLegacyTargetPages,
  };

  const operationBusyRef = useRef(operationBusy);
  useEffect(() => {
    operationBusyRef.current = operationBusy;
  }, [operationBusy]);

  const { canUndo, canRedo } = useWorkspaceShortcuts({
    pagesCount: pages.length,
    onNavigatePage: setCurrentPage,
    onToggleLayer: toggleOriginalTranslated,
    onTranslateCurrent: () => {
      void handleTranslateCurrent();
    },
    canTranslate:
      !uiOperationLockRef.current &&
      !operationBusy &&
      pages.length > 0,
    onOpenFindReplace: openFindReplace,
    onOpenShortcuts: openShortcuts,
    isFocusMode,
    onToggleFocusMode: toggleFocusMode,
    onExitFocusMode: exitFocusMode,
    onToggleFocusToolbar: toggleFocusToolbar,
  });

  const headerProps: WorkspaceHeaderHostProps = {
    isFocusMode,
    pages,
    currentPage,
    currentPageUrl,
    saveStatus,
    saveError,
    onRetrySaveSession: () => void retrySaveSession(),
    isSettingsOpen,
    onToggleSettings: () => setIsSettingsOpen((prev) => !prev),
    onOpenSettings: openSettings,
    canUndo,
    canRedo,
    workspaceLayer,
    hasCurrentTranslation,
    onToggleOriginalTranslated: toggleOriginalTranslated,
    viewLayout,
    onToggleViewLayout: toggleViewLayout,
    textSizePoints: bubbleCacheRef.current.get(currentPageUrl ?? "") ?? activeBubbles,
    operationBusy,
    onResizeSavedText: resizeSavedText,
    currentCleaningResult,
    batchFailureCount: batchFailures?.length ?? 0,
    contaminatedPageCount: contaminatedScan?.length ?? 0,
    canOrganizeAll: pages?.some(
      (p) => (bubbleCacheRef.current.get(p.url)?.length ?? 0) > 0,
    ) ?? false,
    onCleanCurrentPage: () => void handleCleanCurrentPage(),
    onEditMask: () => openMaskEditor(),
    onTranslateBook: () => void handleTranslateBook(),
    onTranslateCurrent: () => void handleTranslateCurrent(),
    onOrganizeAllPages: () => void handleAutoOrganizeAllPages(),
    onRetryFailedPages: () => void retryFailedPages(),
    onScanTranslations: handleScanTranslations,
    onRetranslateContaminated: () => void handleRetranslateContaminated(),
    onOpenExportReport: handleOpenExportReport,
    onOpenFindReplace: openFindReplace,
    onOpenShortcuts: openShortcuts,
    onExportProjectFile: () => void handleExportProjectFile(),
    onImportProjectFile: handleImportProjectFile,
    advancedToolsTriggerRef,
    primaryAction,
    onPrimaryAction: () => void handlePrimaryAction(),
    onCancelPrimaryAction: cancelTranslateAll,
    exportTriggerRef,
    isZipping,
    isChoosingExport,
    activeBubbles,
    onRequestSinglePageExport: () => void requestSinglePageExport(),
    onRequestBookExport: (kind) => void requestBookExport(kind),
    isPublishingBack,
    onPublishBackToReadingView: () => void handlePublishBackToReadingView(),
    isMobileMenuOpen,
    onToggleMobileMenu: toggleMobileMenu,
    onCloseMobileMenu: closeMobileMenu,
    isTranslatingAll,
    translateAllProgress,
    nsfwBypassMode,
    onToggleNsfwBypassMode: () => setNsfwBypassMode((prev) => !prev),
  };

  const canvasProps: WorkspaceCanvasHostProps = {
    isFocusMode,
    isFocusToolbarVisible,
    onToggleFocusToolbar: () => setIsFocusToolbarVisible((prev) => !prev),
    onExitFocusMode: exitFocusMode,
    pages,
    currentPage,
    onPageChange: setCurrentPage,
    onRemovePage: handleRemovePage,
    onImageError: handleImageError,
    viewLayout,
    onViewLayoutChange: setViewLayout,
    onToggleFocusMode: toggleFocusMode,
    isThumbnailsCollapsed,
    isDragging,
    isImporting,
    importStatusMessage: importStatusMessage ?? undefined,
    onImageUpload: handleImageUpload,
    savedSessionData,
    onRestoreSavedSession: handleRestoreSavedSession,
    onClearSavedSession: handleClearSavedSession,
    workflowMessage,
    translationResult,
    onDismissTranslationResult: () => setTranslationResult(null),
    modelPreference,
    onSwitchToAutoModel: () => {
      setModelPreference("auto");
      setTranslationResult("เปลี่ยนเป็น Auto แล้ว กดลองแปลอีกครั้ง");
    },
    toolbarPosition,
    onToggleToolbarPosition: toggleToolbarPosition,
    isToolbarCollapsed,
    onToggleToolbarCollapsed: toggleToolbarCollapsed,
    workspaceLayer,
    onLayerChange: setWorkspaceLayer,
    operationBusy,
    currentCleaningResult,
    hasCurrentTranslation,
    cleaningProgress,
    cleaningError,
    onCleanCurrentPage: () => void handleCleanCurrentPage(),
    onEditMask: () => openMaskEditor(),
    targetLang,
    pageTargetCache: pageTargetCacheRef?.current ?? new Map(),
    isExportBusy: isZipping || isChoosingExport || Boolean(pendingExportAction) || Boolean(pendingReadabilityExport),
    onPageExportSourceChange: handlePageExportSourceChange,
    exportImageFormat,
    onExportImageFormatChange: setExportImageFormat,
    onAutoOrganizeCurrentPage: (mode) => void handleAutoOrganizeCurrentPage(mode),
    onAutoOrganizeAllPages: (mode) => void handleAutoOrganizeAllPages(mode),
    onApplyBwContrastCurrentPage: (mode) => void handleApplyBwContrastCurrentPage(mode),
    onApplyBwContrastAllPages: (mode) => void handleApplyBwContrastAllPages(mode),
    isPageReviewRequired: Boolean(
      currentPageUrl &&
      !confirmedPages.has(currentPageUrl) &&
      doesPageRequireReview(currentCleaningResult, activeBubbles),
    ),
    onConfirmPageReview: () => {
      if (!currentPageUrl) return;
      confirmedMissingTranslationsRef.current.set(
        currentPageUrl,
        missingTranslationSignature(
          cleaningResultsByPage.get(currentPageUrl),
          bubbleCacheRef.current.get(currentPageUrl),
        ),
      );
      setConfirmedPages((prev) => new Set(prev).add(currentPageUrl));
    },
    batchFailures,
    onOpenDiagnostics: openDiagnostics,
    onRetryFailedPages: () => void retryFailedPages(),
    cleaningResultsByPage,
    translatedImagesMap,
    brokenPages,
  };

  const bottomStripProps: WorkspaceBottomStripHostProps = {
    pages,
    currentPage,
    onSelectPage: setCurrentPage,
    onDeletePage: handleDeletePage,
    onReorderPages: handleReorderPages,
    onAddImages: handleImageUpload,
    onClearAll: handleClearAllPages,
    isThumbnailsCollapsed,
    onToggleCollapse: toggleThumbnailsCollapse,
    isFocusMode,
    currentCleaningResult,
    currentPageUrl,
    canConfirmHumanInspection: pages[currentPage]
      ? getCurrentRemnantReview?.(
          pages[currentPage].url,
          getExpectedRemnantEvidence(pages[currentPage].url),
        )?.canConfirmHumanInspection
      : false,
    remnantInspection: pages[currentPage]
      ? getCurrentRemnantReview?.(
          pages[currentPage].url,
          getExpectedRemnantEvidence(pages[currentPage].url),
        )?.inspection
      : undefined,
    onOpenMaskCandidate: openMaskCandidate,
    onConfirmArtworkCandidate: (candidateId) => {
      if (currentPageUrl) confirmArtworkCandidate(currentPageUrl, candidateId);
    },
    onConfirmAllPageRemnants: () => {
      if (currentPageUrl) {
        confirmAllPageRemnants?.(currentPageUrl, getExpectedRemnantEvidence(currentPageUrl));
      }
    },
    onConfirmHumanInspection: (revisionKey, sourceUrl, cleanUrl) => {
      if (currentPageUrl) {
        confirmHumanImageInspection(currentPageUrl, revisionKey, sourceUrl, cleanUrl);
      }
    },
    onRecheckPageRemnants: () => {
      if (currentPageUrl) void recheckPageRemnants(currentPageUrl);
    },
  };

  const modalsProps: WorkspaceModalsHostProps = {
    isMaskEditorOpen,
    currentCleaningResult,
    currentPageItem: pages[currentPage],
    maskFocusRect,
    onCloseMaskEditor: closeMaskEditor,
    onRetryRegion: handleRetryRegion,
    onResolveRegion: resolveMaskRegion,
    onRefreshProposal: refreshMaskProposal,

    isSettingsOpen,
    onCloseSettings: closeSettings,
    sourceLang,
    targetLang,
    onTargetLangChange: setTargetLang,
    onSourceLangChange: setSourceLang,
    textStyle,
    onTextStyleChange: setTextStyle,
    modelPreference,
    onModelPreferenceChange: setModelPreference,
    allowPreviewModels,
    onAllowPreviewModelsChange: setAllowPreviewModels,
    userApiKey,
    onUserApiKeyChange: setUserApiKey,
    focusApiKey: settingsFocusTarget === "apiKey",
    onValidateApiKey: validateRecoveryApiKey,
    onApiKeyValidated: handleApiKeyValidated,
    glossary,
    onGlossaryChange: setGlossary,
    onAutoExtractGlossary: () => void handleAutoExtractGlossary(),
    sfxMode,
    onSfxModeChange: setSfxMode,
    nsfwBypassMode,
    onNsfwBypassModeChange: setNsfwBypassMode,
    autoProceedOnReview,
    onAutoProceedOnReviewChange: setAutoProceedOnReview,

    isFindReplaceOpen,
    onCloseFindReplace: closeFindReplace,
    onReplaceText: handleFindReplace,

    isShortcutsOpen,
    onCloseShortcuts: closeShortcuts,

    legacyTargetPages,
    onPostponeLegacyTarget: handlePostponeLegacyTarget,
    onConfirmLegacyTarget: handleConfirmLegacyTarget,

    reviewIssues,
    isRepairingBook,
    operationBusy,
    onCancelWholeBookRepair: cancelWholeBookRepair,
    onApplyAllSuggestedReviews: handleApplyAllSuggestedReviews,
    onRepairWholeBook: () => void handleRepairWholeBook(),
    onConfirmLegacyTargetFromReview: handleConfirmLegacyTargetFromReview,
    onNavigateToReviewIssuePage: handleNavigateToReviewIssuePage,
    onConfirmPointReview: handleConfirmPointReview,
    onCloseReviewIssues: handleCloseReviewIssues,

    unconfirmedReviewPages,
    pendingExportAction,
    pages,
    cleaningResultsByPage,
    exportSnapshotPages: exportSnapshotRef.current?.pages,
    pendingReviewIndices: pendingReviewIndicesRef.current,
    onApproveExportPageInPlace: approveExportPageInPlace,
    onSubstituteExportPageWithOriginal: substituteExportPageWithOriginal,
    onExcludeExportPage: excludeExportPage,
    onNavigateToReviewPage: handleNavigateToReviewPage,
    onCancelReview: handleCancelReview,
    onProceedWithHold: handleProceedWithHold,
    onApproveAllPagesInPlace: approveAllExportPagesInPlace,
    onProceedWithExport: handleProceedWithExport,

    isExportReportOpen,
    exportReportRows,
    isZipping,
    onCloseExportReport: handleCloseExportReport,
    onSelectReadabilityFinding: selectReadabilityFinding,
    onSelectReportPage: handleSelectReportPage,
    onContinueExport: pendingReadabilityExport ? continueReadabilityExport : undefined,
    hasPendingReadabilityExport: Boolean(pendingReadabilityExport),
    exportScanProgress,
    exportImageFormat,
    onExportImageFormatChange: setExportImageFormat,

    isDiagnosticModalOpen,
    onCloseDiagnosticModal: closeDiagnostics,
    failureGroups: diagnosticFailureGroups,
    onRetryFailureGroup: (failureGroupId) => retryFailureGroup(failureGroupId),
    onEnableNsfwBypassAndRetry: (failureGroupId) => {
      setNsfwBypassMode(true);
      return retryFailureGroup(failureGroupId, { forceNsfw: true });
    },
    onOpenSettingsApiKey: openSettingsApiKey,
    onRecoverCleaner: handleRecoverCleaner,
    cleanerRecoveryByGroup,
    apiKeyReadyByGroup,
  };

  return {
    headerProps,
    canvasProps,
    bottomStripProps,
    modalsProps,
    rootProps: {
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
    translateAllProgress,
    isFocusMode,
  };
}
