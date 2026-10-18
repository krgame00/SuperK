import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WorkspaceModalsHost, type WorkspaceModalsHostProps } from "@/components/workspace/WorkspaceModalsHost";
import type { WorkspaceTextStyle } from "@/components/workspace/SettingsModal";

const mockTextStyle: WorkspaceTextStyle = {
  fontFamily: "sans-serif",
  fontSizeMultiplier: 1.0,
  textColor: "#000000",
  textOutline: "#ffffff",
};

function createDefaultProps(): WorkspaceModalsHostProps {
  return {
    isMaskEditorOpen: false,
    onCloseMaskEditor: vi.fn(),
    onRetryRegion: vi.fn().mockResolvedValue(undefined),
    onResolveRegion: vi.fn().mockResolvedValue(undefined),
    onRefreshProposal: vi.fn().mockResolvedValue(undefined),

    isSettingsOpen: false,
    onCloseSettings: vi.fn(),
    sourceLang: "ja",
    targetLang: "th",
    onTargetLangChange: vi.fn(),
    onSourceLangChange: vi.fn(),
    textStyle: mockTextStyle,
    onTextStyleChange: vi.fn(),
    modelPreference: "gemini-3.5-flash-lite",
    onModelPreferenceChange: vi.fn(),
    allowPreviewModels: false,
    onAllowPreviewModelsChange: vi.fn(),
    userApiKey: "",
    onUserApiKeyChange: vi.fn(),
    onValidateApiKey: vi.fn().mockResolvedValue({ ok: true }),
    onApiKeyValidated: vi.fn(),
    glossary: [],
    onGlossaryChange: vi.fn(),
    onAutoExtractGlossary: vi.fn(),
    sfxMode: "translate",
    onSfxModeChange: vi.fn(),
    nsfwBypassMode: false,
    onNsfwBypassModeChange: vi.fn(),
    autoProceedOnReview: false,
    onAutoProceedOnReviewChange: vi.fn(),

    isFindReplaceOpen: false,
    onCloseFindReplace: vi.fn(),
    onReplaceText: vi.fn(),

    isShortcutsOpen: false,
    onCloseShortcuts: vi.fn(),

    legacyTargetPages: null,
    onPostponeLegacyTarget: vi.fn(),
    onConfirmLegacyTarget: vi.fn(),

    reviewIssues: null,
    onCancelWholeBookRepair: vi.fn(),
    onApplyAllSuggestedReviews: vi.fn(),
    onRepairWholeBook: vi.fn(),
    onConfirmLegacyTargetFromReview: vi.fn(),
    onNavigateToReviewIssuePage: vi.fn(),
    onConfirmPointReview: vi.fn(),
    onCloseReviewIssues: vi.fn(),

    unconfirmedReviewPages: null,
    pendingExportAction: null,
    pages: [],
    cleaningResultsByPage: new Map(),
    onApproveExportPageInPlace: vi.fn(),
    onSubstituteExportPageWithOriginal: vi.fn(),
    onExcludeExportPage: vi.fn(),
    onNavigateToReviewPage: vi.fn(),
    onCancelReview: vi.fn(),
    onProceedWithHold: vi.fn(),
    onApproveAllPagesInPlace: vi.fn(),
    onProceedWithExport: vi.fn(),

    isExportReportOpen: false,
    exportReportRows: [],
    onCloseExportReport: vi.fn(),
    onSelectReadabilityFinding: vi.fn(),
    onSelectReportPage: vi.fn(),
    exportImageFormat: "auto",
    onExportImageFormatChange: vi.fn(),

    isDiagnosticModalOpen: false,
    onCloseDiagnosticModal: vi.fn(),
    failureGroups: [],
    onRetryFailureGroup: vi.fn().mockResolvedValue(undefined),
    onEnableNsfwBypassAndRetry: vi.fn().mockResolvedValue(undefined),
    onOpenSettingsApiKey: vi.fn(),
    onRecoverCleaner: vi.fn().mockResolvedValue(undefined),
    cleanerRecoveryByGroup: {},
    apiKeyReadyByGroup: {},
  };
}

describe("WorkspaceModalsHost", () => {
  it("renders null or empty fragments when all modals are closed", () => {
    const props = createDefaultProps();
    const { container } = render(<WorkspaceModalsHost {...props} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders SettingsModal when isSettingsOpen is true and handles close", () => {
    const props = createDefaultProps();
    props.isSettingsOpen = true;
    render(<WorkspaceModalsHost {...props} />);

    expect(screen.getByRole("dialog", { name: "ตั้งค่า" })).toBeDefined();
    const closeBtn = screen.getByRole("button", { name: "ปิด Settings" });
    fireEvent.click(closeBtn);
    expect(props.onCloseSettings).toHaveBeenCalled();
  });

  it("renders FindReplaceDialog when isFindReplaceOpen is true", () => {
    const props = createDefaultProps();
    props.isFindReplaceOpen = true;
    render(<WorkspaceModalsHost {...props} />);

    expect(screen.getByRole("dialog", { name: "ค้นหาและแทนที่คำแปล" })).toBeDefined();
  });

  it("renders KeyboardShortcutsDialog when isShortcutsOpen is true", () => {
    const props = createDefaultProps();
    props.isShortcutsOpen = true;
    render(<WorkspaceModalsHost {...props} />);

    expect(screen.getByRole("dialog", { name: "คีย์ลัดสำหรับแก้ไขมังงะ" })).toBeDefined();
  });

  it("renders Legacy Saved-Work Target Confirmation dialog when legacyTargetPages is provided", () => {
    const props = createDefaultProps();
    props.legacyTargetPages = [{ pageIndex: 0, pageUrl: "blob:test" }];
    props.targetLang = "Thai";
    render(<WorkspaceModalsHost {...props} />);

    expect(screen.getByRole("dialog", { name: "ยืนยันภาษาปลายทางของงานเก่า" })).toBeDefined();
    const confirmBtn = screen.getByRole("button", { name: "ยืนยันใช้ภาษา Thai" });
    fireEvent.click(confirmBtn);
    expect(props.onConfirmLegacyTarget).toHaveBeenCalled();
  });
});
