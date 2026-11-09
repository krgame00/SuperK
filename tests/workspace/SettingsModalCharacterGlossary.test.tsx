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
  glossary: [
    { source: "ルフィ", target: "ลูฟี่", note: "กัปตันเรือหมวกฟาง" },
    { source: "ゾロ", target: "โซโล", note: "นักดาบ" },
  ],
};

describe("SettingsModal Manga Character Glossary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the character glossary section with lock indicator and notes", () => {
    render(<SettingsModal {...defaultProps} />);

    expect(screen.getByText(/Glossary & ล็อกชื่อตัวละคร/i)).toBeInTheDocument();
    expect(screen.getByText(/ระบบจะส่งชื่อและคำแปลเหล่านี้ล็อกใน Gemini Prompt/i)).toBeInTheDocument();
    expect(screen.getByText(/กัปตันเรือหมวกฟาง/i)).toBeInTheDocument();
    expect(screen.getByText(/นักดาบ/i)).toBeInTheDocument();
  });

  it("adds a new character entry with source, target, and optional note", async () => {
    const onGlossaryChange = vi.fn();
    render(<SettingsModal {...defaultProps} onGlossaryChange={onGlossaryChange} />);

    const sourceInput = screen.getByLabelText(/คำต้นฉบับ/i);
    const targetInput = screen.getByLabelText(/คำแปลที่ต้องการ/i);
    const noteInput = screen.getByLabelText(/คำอธิบายหรือความสัมพันธ์/i);
    const submitBtn = screen.getByLabelText(/เพิ่มคำศัพท์ลงใน Glossary/i);

    fireEvent.change(sourceInput, { target: { value: "ナミ" } });
    fireEvent.change(targetInput, { target: { value: "นามิ" } });
    fireEvent.change(noteInput, { target: { value: "ต้นหนเรือ" } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onGlossaryChange).toHaveBeenCalledTimes(1);
    });

    const updated = onGlossaryChange.mock.calls[0][0];
    expect(updated).toHaveLength(3);
    expect(updated[2]).toEqual({
      source: "ナミ",
      target: "นามิ",
      note: "ต้นหนเรือ",
    });
  });

  it("supports quick-adding common manga archetypes like 先生 (อาจารย์)", async () => {
    const onGlossaryChange = vi.fn();
    render(<SettingsModal {...defaultProps} onGlossaryChange={onGlossaryChange} />);

    const quickArchetypeBtn = screen.getByText(/先生.*อาจารย์/i);
    expect(quickArchetypeBtn).toBeInTheDocument();
    fireEvent.click(quickArchetypeBtn);

    await waitFor(() => {
      expect(onGlossaryChange).toHaveBeenCalledTimes(1);
    });

    const updated = onGlossaryChange.mock.calls[0][0];
    expect(updated.some((g: { source: string; target: string }) => g.source === "先生" && g.target === "อาจารย์")).toBe(true);
  });
});
