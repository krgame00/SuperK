import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsModal, type SettingsModalProps } from "@/components/workspace/SettingsModal";

describe("SettingsModal Auto-Fit & Parallel Translation Settings", () => {
  const defaultProps: SettingsModalProps = {
    isOpen: true,
    onClose: vi.fn(),
    sourceLang: "ja",
    onSourceLangChange: vi.fn(),
    textStyle: {
      fontFamily: "Itim, sans-serif",
      fontSizeMultiplier: 1,
      textColor: "#000000",
      textOutline: "#ffffff",
    },
    onTextStyleChange: vi.fn(),
    modelPreference: { engine: "gemini", model: "gemini-3.5-flash-lite" },
    onModelPreferenceChange: vi.fn(),
    userApiKey: "test-api-key",
    onUserApiKeyChange: vi.fn(),
  };

  it("renders the Contour Auto-Fit switch and triggers onAutoFitBubbleContourChange when clicked", () => {
    const onAutoFitChange = vi.fn();
    render(
      <SettingsModal
        {...defaultProps}
        autoFitBubbleContour={true}
        onAutoFitBubbleContourChange={onAutoFitChange}
      />,
    );

    const switchBtn = screen.getByRole("switch", {
      name: /เปิดปิดการปรับขนาดฟอนต์ให้พอดีรูปทรงบอลลูนอัตโนมัติ|Contour Auto-Fit/i,
    });
    expect(switchBtn).toBeInTheDocument();
    expect(switchBtn).toHaveAttribute("aria-checked", "true");

    fireEvent.click(switchBtn);
    expect(onAutoFitChange).toHaveBeenCalledWith(false);
  });

  it("renders Bounded Parallel Translation selector and triggers onParallelPagesChange", () => {
    const onParallelChange = vi.fn();
    render(
      <SettingsModal
        {...defaultProps}
        parallelPages={2}
        onParallelPagesChange={onParallelChange}
      />,
    );

    const parallelSelect = screen.getByLabelText(/การแปลหลายหน้าแบบคู่ขนาน|Parallel Translation/i);
    expect(parallelSelect).toBeInTheDocument();
    expect(parallelSelect).toHaveValue("2");

    fireEvent.change(parallelSelect, { target: { value: "3" } });
    expect(onParallelChange).toHaveBeenCalledWith(3);
  });
});
