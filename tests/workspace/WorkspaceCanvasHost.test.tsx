import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  WorkspaceCanvasHost,
  type WorkspaceCanvasHostProps,
} from "@/components/workspace/WorkspaceCanvasHost";

// Mock PageViewer to keep test fast and isolated
vi.mock("@/components/workspace/PageViewer", () => ({
  PageViewer: vi.fn(({ currentPage, pages }: any) => (
    <div data-testid="mock-page-viewer" data-current-page={currentPage}>
      PageViewer: Page {currentPage + 1} of {pages.length}
    </div>
  )),
}));

// Mock CleaningToolbar to avoid pulling full canvas dependencies
vi.mock("@/components/cleaning/CleaningToolbar", () => ({
  CleaningToolbar: vi.fn(({ children, layer }: any) => (
    <div data-testid="mock-cleaning-toolbar" data-layer={layer}>
      CleaningToolbar
      {children}
    </div>
  )),
}));

function createDefaultProps(): WorkspaceCanvasHostProps {
  return {
    isFocusMode: false,
    isFocusToolbarVisible: true,
    onToggleFocusToolbar: vi.fn(),
    onExitFocusMode: vi.fn(),

    pages: [],
    currentPage: 0,
    onPageChange: vi.fn(),
    onRemovePage: vi.fn(),
    onImageError: vi.fn(),
    viewLayout: "single",
    onViewLayoutChange: vi.fn(),
    onToggleFocusMode: vi.fn(),
    isThumbnailsCollapsed: false,

    isDragging: false,
    isImporting: false,
    importStatusMessage: "",
    onImageUpload: vi.fn(),

    savedSessionData: null,
    onRestoreSavedSession: vi.fn(),
    onClearSavedSession: vi.fn(),

    workflowMessage: null,
    translationResult: null,
    onDismissTranslationResult: vi.fn(),
    modelPreference: "auto" as any,
    onSwitchToAutoModel: vi.fn(),

    toolbarPosition: "top",
    onToggleToolbarPosition: vi.fn(),
    isToolbarCollapsed: false,
    onToggleToolbarCollapsed: vi.fn(),
    workspaceLayer: "translated",
    onLayerChange: vi.fn(),
    operationBusy: false,

    currentCleaningResult: null,
    hasCurrentTranslation: false,
    cleaningProgress: undefined,
    cleaningError: undefined,
    onCleanCurrentPage: vi.fn(),
    onEditMask: vi.fn(),

    targetLang: "th",
    pageTargetCache: new Map(),
    isExportBusy: false,
    onPageExportSourceChange: vi.fn(),
    exportImageFormat: "auto",
    onExportImageFormatChange: vi.fn(),

    onAutoOrganizeCurrentPage: vi.fn(),
    onAutoOrganizeAllPages: vi.fn(),

    onApplyBwContrastCurrentPage: vi.fn(),
    onApplyBwContrastAllPages: vi.fn(),

    isPageReviewRequired: false,
    onConfirmPageReview: vi.fn(),
    batchFailures: [],
    onOpenDiagnostics: vi.fn(),
    onRetryFailedPages: vi.fn(),

    cleaningResultsByPage: new Map(),
    translatedImagesMap: new Map(),
    brokenPages: new Set(),
  };
}

describe("WorkspaceCanvasHost", () => {
  it("renders empty dropzone when no pages are loaded", () => {
    const props = createDefaultProps();
    render(<WorkspaceCanvasHost {...props} />);

    expect(screen.getByText("Drag & Drop manga pages")).toBeInTheDocument();
    expect(screen.getByText("Support for Images, ZIP, CBZ, and PDF")).toBeInTheDocument();
    expect(screen.getByLabelText("เลือกไฟล์มังงะ (Browse Files)")).toBeInTheDocument();
  });

  it("renders import loading state when isImporting is true", () => {
    const props = createDefaultProps();
    props.isImporting = true;
    props.importStatusMessage = "กำลังแตกไฟล์ ZIP...";
    render(<WorkspaceCanvasHost {...props} />);

    expect(screen.getByText("กำลังแตกไฟล์ ZIP...")).toBeInTheDocument();
    expect(screen.getByText("กรุณารอสักครู่ ระบบกำลังประมวลผลหน้ามังงะ")).toBeInTheDocument();
  });

  it("renders saved session banner and invokes restore/clear callbacks", () => {
    const props = createDefaultProps();
    props.savedSessionData = {
      pages: [{ url: "blob:1", name: "p1.png" }],
      hasUnrecoverableSources: false,
    } as any;
    render(<WorkspaceCanvasHost {...props} />);

    expect(screen.getByText(/พบงานแปลค้างไว้ล่าสุด/)).toBeInTheDocument();
    const restoreBtn = screen.getByRole("button", { name: /คืนค่างานเดิม/ });
    fireEvent.click(restoreBtn);
    expect(props.onRestoreSavedSession).toHaveBeenCalledTimes(1);

    const clearBtn = screen.getByRole("button", { name: /ล้างแล้วเริ่มใหม่/ });
    fireEvent.click(clearBtn);
    expect(props.onClearSavedSession).toHaveBeenCalledTimes(1);
  });

  it("renders PageViewer and toolbar when pages exist", () => {
    const props = createDefaultProps();
    props.pages = [
      { url: "blob:page1", name: "01.png" },
      { url: "blob:page2", name: "02.png" },
    ];
    props.currentPage = 0;
    render(<WorkspaceCanvasHost {...props} />);

    expect(screen.getByTestId("mock-page-viewer")).toBeInTheDocument();
    expect(screen.getByTestId("mock-cleaning-toolbar")).toBeInTheDocument();
    expect(screen.getByLabelText("ส่งออกหน้านี้เป็น")).toBeInTheDocument();
    expect(screen.getByLabelText("สกุลไฟล์ภาพส่งออก")).toBeInTheDocument();
  });

  it("renders workflow status pill when message is provided", () => {
    const props = createDefaultProps();
    props.pages = [{ url: "blob:page1", name: "01.png" }];
    props.workflowMessage = "กำลังแปลหน้า 1...";
    render(<WorkspaceCanvasHost {...props} />);

    expect(screen.getByRole("status")).toHaveTextContent("กำลังแปลหน้า 1...");
  });

  it("renders Focus Mode overlay controls and invokes exit callback", () => {
    const props = createDefaultProps();
    props.pages = [{ url: "blob:page1", name: "01.png" }];
    props.isFocusMode = true;
    render(<WorkspaceCanvasHost {...props} />);

    const exitBtn = screen.getByRole("button", { name: "ออกจากโหมดโฟกัส (Esc หรือ F)" });
    fireEvent.click(exitBtn);
    expect(props.onExitFocusMode).toHaveBeenCalledTimes(1);

    const toggleToolbarBtn = screen.getByRole("button", { name: "ซ่อนแถบเครื่องมือคลีน (B)" });
    fireEvent.click(toggleToolbarBtn);
    expect(props.onToggleFocusToolbar).toHaveBeenCalledTimes(1);
  });

  it("renders batch failures warning banner and triggers retry and diagnostics", () => {
    const props = createDefaultProps();
    props.pages = [{ url: "blob:page1", name: "01.png" }];
    props.batchFailures = [{
      failureGroupId: "test-group",
      pageIndex: 0,
      pageUrl: "blob:page1",
      stage: "translation",
      message: "Network error",
    }];
    render(<WorkspaceCanvasHost {...props} />);

    expect(screen.getByText("❌ แปลไม่สำเร็จ 1 หน้า")).toBeInTheDocument();

    const diagBtn = screen.getByRole("button", { name: "ดูสาเหตุและแก้ไข" });
    fireEvent.click(diagBtn);
    expect(props.onOpenDiagnostics).toHaveBeenCalledTimes(1);

    const retryBtn = screen.getByRole("button", { name: "ลองใหม่" });
    fireEvent.click(retryBtn);
    expect(props.onRetryFailedPages).toHaveBeenCalledTimes(1);
  });
});
