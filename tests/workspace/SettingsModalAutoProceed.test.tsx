import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
  autoProceedOnReview: true,
  onAutoProceedOnReviewChange: vi.fn(),
};

describe("SettingsModal Auto-Proceed Toggle", () => {
  it("renders auto-proceed toggle and handles change events", () => {
    const onChange = vi.fn();
    render(<SettingsModal {...defaultProps} onAutoProceedOnReviewChange={onChange} />);

    const toggle = screen.getByRole("switch", { name: /แปลต่อเนื่องอัตโนมัติ/i });
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("reflects unchecked state when autoProceedOnReview is false", () => {
    render(<SettingsModal {...defaultProps} autoProceedOnReview={false} />);

    const toggle = screen.getByRole("switch", { name: /แปลต่อเนื่องอัตโนมัติ/i });
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });
});
