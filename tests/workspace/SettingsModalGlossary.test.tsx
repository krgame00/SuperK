import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
  glossary: [{ source: "ルフィ", target: "ลูฟี่", note: "เพิ่มมือ" }],
};

describe("SettingsModal Glossary Import Merging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("merges imported glossary entries instead of wiping existing items", async () => {
    const onGlossaryChange = vi.fn();
    render(<SettingsModal {...defaultProps} onGlossaryChange={onGlossaryChange} />);

    const fileInput = screen.getByLabelText(/นำเข้าคลังคำศัพท์/i);
    expect(fileInput).toBeInTheDocument();

    const incomingJson = JSON.stringify([
      { source: "ナミ", target: "นามิ" },
      { source: "ルフィ", target: "มังกี้ ดี ลูฟี่", note: "อัปเดต" },
    ]);
    const file = new File([incomingJson], "glossary.json", { type: "application/json" });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(onGlossaryChange).toHaveBeenCalledTimes(1);
    });

    const mergedResult = onGlossaryChange.mock.calls[0][0];
    expect(mergedResult).toHaveLength(2);
    expect(mergedResult[0]).toEqual({
      source: "ルフィ",
      target: "มังกี้ ดี ลูฟี่",
      note: "อัปเดต",
    });
    expect(mergedResult[1]).toEqual({
      source: "ナミ",
      target: "นามิ",
      note: undefined,
    });
  });
});
