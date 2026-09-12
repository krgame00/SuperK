import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsModal, type SettingsModalProps } from "@/components/workspace/SettingsModal";
import * as saveLocation from "@/lib/export/saveLocation";

const defaultProps: SettingsModalProps = {
  isOpen: true,
  onClose: vi.fn(),
  sourceLang: "ja",
  onSourceLangChange: vi.fn(),
  textStyle: {
    fontFamily: "Noto Sans Thai",
    fontSizeMultiplier: 1,
    textColor: "#000000",
    textOutline: "none",
  },
  onTextStyleChange: vi.fn(),
  modelPreference: "gemini-3.5-flash-lite",
  onModelPreferenceChange: vi.fn(),
  userApiKey: "",
  onUserApiKeyChange: vi.fn(),
};

describe("SettingsModal Export Directory Settings", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders export toggle and hides folder detail when disabled", () => {
    vi.spyOn(saveLocation, "getAskExportDirectory").mockReturnValue(false);
    vi.spyOn(saveLocation, "getRememberedDirectoryName").mockReturnValue("");

    render(<SettingsModal {...defaultProps} />);

    const toggle = screen.getByRole("switch", { name: /เปิด\/ปิดการบันทึกลงโฟลเดอร์ที่กำหนด/i });
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByText(/โฟลเดอร์ที่จำไว้/i)).not.toBeInTheDocument();
  });

  it("shows remembered folder name and buttons when enabled", () => {
    vi.spyOn(saveLocation, "getAskExportDirectory").mockReturnValue(true);
    vi.spyOn(saveLocation, "getRememberedDirectoryName").mockReturnValue("MangaDownloads");

    render(<SettingsModal {...defaultProps} />);

    expect(screen.getByText(/โฟลเดอร์ที่จำไว้:/i)).toBeInTheDocument();
    expect(screen.getByText("MangaDownloads")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /เปลี่ยนโฟลเดอร์/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ล้างค่า/i })).toBeInTheDocument();
  });

  it("toggles export setting and enables folder display", async () => {
    let enabled = false;
    vi.spyOn(saveLocation, "getAskExportDirectory").mockImplementation(() => enabled);
    const setAskSpy = vi.spyOn(saveLocation, "setAskExportDirectory").mockImplementation((val) => {
      enabled = val;
    });

    render(<SettingsModal {...defaultProps} />);

    const toggle = screen.getByRole("switch", { name: /เปิด\/ปิดการบันทึกลงโฟลเดอร์ที่กำหนด/i });
    fireEvent.click(toggle);

    expect(setAskSpy).toHaveBeenCalledWith(true);
    await waitFor(() => {
      expect(screen.getByText(/โฟลเดอร์ที่จำไว้:/i)).toBeInTheDocument();
    });
  });

  it("allows changing folder via pickAndRememberExportDirectory", async () => {
    vi.spyOn(saveLocation, "getAskExportDirectory").mockReturnValue(true);
    vi.spyOn(saveLocation, "getRememberedDirectoryName").mockReturnValue("");
    const pickSpy = vi.spyOn(saveLocation, "pickAndRememberExportDirectory").mockResolvedValue({
      name: "NewFolder2026",
      getFileHandle: vi.fn(),
    });

    render(<SettingsModal {...defaultProps} />);

    const pickBtn = screen.getByRole("button", { name: /เลือกโฟลเดอร์/i });
    fireEvent.click(pickBtn);

    expect(pickSpy).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText("NewFolder2026")).toBeInTheDocument();
    });
  });

  it("clears remembered directory when clicking reset button", async () => {
    vi.spyOn(saveLocation, "getAskExportDirectory").mockReturnValue(true);
    vi.spyOn(saveLocation, "getRememberedDirectoryName").mockReturnValue("FolderToDelete");
    const clearSpy = vi.spyOn(saveLocation, "clearRememberedDirectory").mockResolvedValue();

    render(<SettingsModal {...defaultProps} />);

    const clearBtn = screen.getByRole("button", { name: /ล้างค่า/i });
    fireEvent.click(clearBtn);

    expect(clearSpy).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByText("FolderToDelete")).not.toBeInTheDocument();
      expect(screen.getByText(/ยังไม่ได้เลือก/i)).toBeInTheDocument();
    });
  });
});
