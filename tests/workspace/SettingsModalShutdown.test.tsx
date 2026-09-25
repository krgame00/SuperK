import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsModal, type SettingsModalProps } from "@/components/workspace/SettingsModal";

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

describe("SettingsModal System Shutdown Feature", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders shutdown section with initial trigger button", () => {
    render(<SettingsModal {...defaultProps} />);
    expect(screen.getByText(/จัดการระบบและการปิดโปรแกรม/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ปิดระบบ SuperK ทั้งหมด \(Shutdown\)/i })).toBeInTheDocument();
  });

  it("shows confirmation prompt when clicking shutdown button", () => {
    render(<SettingsModal {...defaultProps} />);
    const shutdownBtn = screen.getByRole("button", { name: /ปิดระบบ SuperK ทั้งหมด \(Shutdown\)/i });
    fireEvent.click(shutdownBtn);

    expect(screen.getByText(/ยืนยันที่จะปิดการทำงานของระบบ SuperK ทั้งหมดใช่หรือไม่/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ยืนยันปิดระบบ/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ยกเลิก/i })).toBeInTheDocument();
  });

  it("cancels confirmation when clicking cancel", () => {
    render(<SettingsModal {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /ปิดระบบ SuperK ทั้งหมด \(Shutdown\)/i }));
    fireEvent.click(screen.getByRole("button", { name: /ยกเลิก/i }));

    expect(screen.queryByText(/ยืนยันที่จะปิดการทำงานของระบบ SuperK ทั้งหมดใช่หรือไม่/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ปิดระบบ SuperK ทั้งหมด \(Shutdown\)/i })).toBeInTheDocument();
  });

  it("calls /api/system/shutdown and displays completion screen upon confirmation", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    globalThis.fetch = fetchMock;

    render(<SettingsModal {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /ปิดระบบ SuperK ทั้งหมด \(Shutdown\)/i }));
    fireEvent.click(screen.getByRole("button", { name: /ยืนยันปิดระบบ/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/system/shutdown", { method: "POST" });
    });

    expect(await screen.findByText(/ปิดระบบ SuperK เรียบร้อยแล้ว/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ปิดแท็บนี้ \(Close Tab\)/i })).toBeInTheDocument();
  });
});
