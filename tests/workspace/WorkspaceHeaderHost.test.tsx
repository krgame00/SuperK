import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import {
  WorkspaceHeaderHost,
  type WorkspaceHeaderHostProps,
  formatStopwatchTime,
} from "@/components/workspace/WorkspaceHeaderHost";
import type { WorkspacePrimaryActionState } from "@/lib/workspacePrimaryAction";

function createDefaultProps(): WorkspaceHeaderHostProps {
  const defaultPrimaryAction: WorkspacePrimaryActionState = {
    kind: "translate",
    label: "แปลหน้านี้",
    disabled: false,
    cancellable: false,
  };

  return {
    isFocusMode: false,
    pages: [],
    currentPage: 0,
    currentPageUrl: undefined,
    saveStatus: "idle",
    saveError: null,
    onRetrySaveSession: vi.fn(),

    isSettingsOpen: false,
    onToggleSettings: vi.fn(),
    onOpenSettings: vi.fn(),

    canUndo: false,
    canRedo: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),

    workspaceLayer: "translated",
    hasCurrentTranslation: false,
    onToggleOriginalTranslated: vi.fn(),

    viewLayout: "single",
    onToggleViewLayout: vi.fn(),

    textSizePoints: [],
    operationBusy: false,
    onResizeSavedText: vi.fn().mockResolvedValue(1),

    currentCleaningResult: null,
    batchFailureCount: 0,
    contaminatedPageCount: 0,
    canOrganizeAll: false,
    onCleanCurrentPage: vi.fn(),
    onEditMask: vi.fn(),
    onTranslateBook: vi.fn(),
    onTranslateCurrent: vi.fn(),
    onOrganizeAllPages: vi.fn(),
    onRetryFailedPages: vi.fn(),
    onScanTranslations: vi.fn(),
    onRetranslateContaminated: vi.fn(),
    onOpenExportReport: vi.fn(),
    onOpenFindReplace: vi.fn(),
    onOpenShortcuts: vi.fn(),
    onExportProjectFile: vi.fn(),
    onImportProjectFile: vi.fn(),

    primaryAction: defaultPrimaryAction,
    onPrimaryAction: vi.fn(),
    onCancelPrimaryAction: vi.fn(),

    isZipping: false,
    isChoosingExport: false,
    activeBubbles: [],
    onRequestSinglePageExport: vi.fn(),
    onRequestBookExport: vi.fn(),

    isPublishingBack: false,
    onPublishBackToReadingView: vi.fn(),

    isMobileMenuOpen: false,
    onToggleMobileMenu: vi.fn(),
    onCloseMobileMenu: vi.fn(),
    isTranslatingAll: false,
    translateAllProgress: null,
    nsfwBypassMode: false,
    onToggleNsfwBypassMode: vi.fn(),
  };
}

describe("formatStopwatchTime", () => {
  it("formats under a minute correctly with tenths", () => {
    expect(formatStopwatchTime(15234)).toBe("00:15.2");
  });

  it("formats over a minute correctly", () => {
    expect(formatStopwatchTime(75000)).toBe("01:15.0");
  });

  it("formats hours correctly", () => {
    expect(formatStopwatchTime(3661200)).toBe("1:01:01.2");
  });
});

describe("WorkspaceHeaderHost", () => {
  it("renders empty state header with logo and settings button when no pages exist", () => {
    const props = createDefaultProps();
    render(<WorkspaceHeaderHost {...props} />);

    expect(screen.getByAltText("SuperK Logo")).toBeInTheDocument();
    expect(screen.getByText("Super")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เปิดหน้าต่างตั้งค่า" })).toBeInTheDocument();

    const desktopHeader = document.querySelector("[data-workspace-header-desktop]");
    expect(desktopHeader).toBeInTheDocument();

    // In empty state, undo/redo should not be present
    expect(screen.queryByTitle(/Undo/i)).not.toBeInTheDocument();
  });

  it("renders active workspace desktop controls when pages are present", () => {
    const props: WorkspaceHeaderHostProps = {
      ...createDefaultProps(),
      pages: [{ url: "blob:page-1", name: "Page 1" }],
      currentPage: 0,
      currentPageUrl: "blob:page-1",
      canUndo: true,
      canRedo: true,
      hasCurrentTranslation: true,
      saveStatus: "saved",
    };

    render(<WorkspaceHeaderHost {...props} />);

    // Save status indicator
    expect(screen.getByTitle("บันทึกข้อมูลล่าสุดลงเครื่องเรียบร้อยแล้ว")).toBeInTheDocument();

    // Undo / Redo buttons
    const undoBtn = screen.getByTitle("Undo (Ctrl+Z)");
    const redoBtn = screen.getByTitle("Redo (Ctrl+Shift+Z)");
    expect(undoBtn).toBeInTheDocument();
    expect(redoBtn).toBeInTheDocument();

    fireEvent.click(undoBtn);
    expect(props.onUndo).toHaveBeenCalledTimes(1);

    fireEvent.click(redoBtn);
    expect(props.onRedo).toHaveBeenCalledTimes(1);

    // Layer toggle
    const layerBtn = screen.getByTitle("ดูต้นฉบับ");
    fireEvent.click(layerBtn);
    expect(props.onToggleOriginalTranslated).toHaveBeenCalledTimes(1);

    // Layout toggle
    const layoutBtn = screen.getByTitle("โหมดทีละหน้า");
    fireEvent.click(layoutBtn);
    expect(props.onToggleViewLayout).toHaveBeenCalledTimes(1);

    // Shortcuts helper (?)
    const shortcutsBtn = screen.getByRole("button", { name: "ดูปุ่มลัดคีย์บอร์ด (?)" });
    fireEvent.click(shortcutsBtn);
    expect(props.onOpenShortcuts).toHaveBeenCalledTimes(1);

    // Primary Action
    const desktop = document.querySelector("[data-workspace-header-desktop]") as HTMLElement;
    const primaryBtn = within(desktop).getByRole("button", { name: /แปลหน้านี้/i });
    fireEvent.click(primaryBtn);
    expect(props.onPrimaryAction).toHaveBeenCalledTimes(1);
  });

  it("handles save error with retry trigger", () => {
    const onRetrySaveSession = vi.fn();
    const props: WorkspaceHeaderHostProps = {
      ...createDefaultProps(),
      pages: [{ url: "blob:page-1", name: "Page 1" }],
      saveStatus: "error",
      saveError: "Storage full",
      onRetrySaveSession,
    };

    render(<WorkspaceHeaderHost {...props} />);

    expect(screen.getByText("Storage full")).toBeInTheDocument();
    const retryBtn = screen.getByTitle("ลองบันทึกอีกครั้ง");
    fireEvent.click(retryBtn);
    expect(onRetrySaveSession).toHaveBeenCalledTimes(1);
  });

  it("renders extension send-back button when originUrl is present and invokes callback", () => {
    const onPublishBackToReadingView = vi.fn();
    const props: WorkspaceHeaderHostProps = {
      ...createDefaultProps(),
      pages: [{ url: "blob:page-1", originUrl: "https://example.com/chapter-1" }],
      currentPage: 0,
      onPublishBackToReadingView,
    };

    render(<WorkspaceHeaderHost {...props} />);

    const sendBackBtns = screen.getAllByRole("button", { name: /ส่งคำแปลกลับไปยังหน้าอ่านบนเว็บ/i });
    expect(sendBackBtns.length).toBeGreaterThan(0);

    fireEvent.click(sendBackBtns[0]);
    expect(onPublishBackToReadingView).toHaveBeenCalledTimes(1);
  });

  it("renders mobile header controls and toggles mobile drawer", () => {
    const onToggleMobileMenu = vi.fn();
    const props: WorkspaceHeaderHostProps = {
      ...createDefaultProps(),
      pages: [{ url: "blob:page-1", name: "Page 1" }],
      currentPageUrl: "blob:page-1",
      onToggleMobileMenu,
    };

    render(<WorkspaceHeaderHost {...props} />);

    const mobileHeader = document.querySelector("[data-workspace-header-mobile]");
    expect(mobileHeader).toBeInTheDocument();

    const menuBtn = within(mobileHeader as HTMLElement).getByRole("button", { name: "เปิดเมนู" });
    fireEvent.click(menuBtn);
    expect(onToggleMobileMenu).toHaveBeenCalledTimes(1);
  });

  it("renders mobile drawer sections and triggers action callbacks when open", () => {
    const onTranslateCurrent = vi.fn();
    const onCleanCurrentPage = vi.fn();
    const onToggleNsfwBypassMode = vi.fn();
    const onCloseMobileMenu = vi.fn();

    const props: WorkspaceHeaderHostProps = {
      ...createDefaultProps(),
      pages: [{ url: "blob:page-1", name: "Page 1" }],
      currentPageUrl: "blob:page-1",
      isMobileMenuOpen: true,
      onTranslateCurrent,
      onCleanCurrentPage,
      onToggleNsfwBypassMode,
      onCloseMobileMenu,
    };

    render(<WorkspaceHeaderHost {...props} />);

    // Mobile drawer actions
    const translateCurrentBtn = screen.getByRole("button", { name: /แปลหน้านี้ใหม่/i });
    fireEvent.click(translateCurrentBtn);
    expect(onTranslateCurrent).toHaveBeenCalledTimes(1);
    expect(onCloseMobileMenu).toHaveBeenCalledTimes(1);

    const cleanBtn = screen.getByRole("button", { name: /คลีนข้อความใหม่/i });
    fireEvent.click(cleanBtn);
    expect(onCleanCurrentPage).toHaveBeenCalledTimes(1);

    const nsfwBtn = screen.getByRole("button", { name: /18\+ Bypass Mode/i });
    fireEvent.click(nsfwBtn);
    expect(onToggleNsfwBypassMode).toHaveBeenCalledTimes(1);
  });

  it("renders translation progress in mobile drawer when isTranslatingAll is true", () => {
    const onCancelPrimaryAction = vi.fn();
    const props: WorkspaceHeaderHostProps = {
      ...createDefaultProps(),
      pages: [{ url: "blob:page-1" }, { url: "blob:page-2" }],
      isMobileMenuOpen: true,
      isTranslatingAll: true,
      translateAllProgress: {
        current: 1,
        total: 2,
        message: "กำลังแปลหน้า 1...",
        secondaryMessage: "ตรวจพบ 3 บับเบิล",
        elapsedMs: 2500,
        pageElapsedMs: 1200,
      },
      onCancelPrimaryAction,
    };

    render(<WorkspaceHeaderHost {...props} />);

    expect(screen.getByText("กำลังแปลหน้า 1...")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("ตรวจพบ 3 บับเบิล")).toBeInTheDocument();

    const cancelBtn = screen.getByRole("button", { name: /หยุดแปล/i });
    fireEvent.click(cancelBtn);
    expect(onCancelPrimaryAction).toHaveBeenCalledTimes(1);
  });
});
