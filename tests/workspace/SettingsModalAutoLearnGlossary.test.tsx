import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SettingsModal, type SettingsModalProps } from "@/components/workspace/SettingsModal";

vi.mock("react-hot-toast", () => ({
  default: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

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
  glossary: [],
  autoLearnGlossary: true,
};

describe("SettingsModal Auto-Learn Character Names Toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the auto-learn character names switch", () => {
    render(<SettingsModal {...defaultProps} />);

    expect(screen.getByText(/Auto-learn Character Names/i)).toBeInTheDocument();
    expect(screen.getByText(/เรียนรู้และบันทึกชื่อตัวละครเข้า Glossary อัตโนมัติขณะแปล/i)).toBeInTheDocument();
    const switchBtn = screen.getByRole("switch", { name: /เปิดปิดการบันทึกชื่อตัวละครอัตโนมัติ/i });
    expect(switchBtn).toBeInTheDocument();
    expect(switchBtn).toHaveAttribute("aria-checked", "true");
  });

  it("calls onAutoLearnGlossaryChange when toggle switch is clicked", () => {
    const onAutoLearnGlossaryChange = vi.fn();
    render(<SettingsModal {...defaultProps} autoLearnGlossary={true} onAutoLearnGlossaryChange={onAutoLearnGlossaryChange} />);

    const switchBtn = screen.getByRole("switch", { name: /เปิดปิดการบันทึกชื่อตัวละครอัตโนมัติ/i });
    fireEvent.click(switchBtn);

    expect(onAutoLearnGlossaryChange).toHaveBeenCalledTimes(1);
    expect(onAutoLearnGlossaryChange).toHaveBeenCalledWith(false);
  });
});
