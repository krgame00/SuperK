import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SettingsModal, type SettingsModalProps } from "@/components/workspace/SettingsModal";
import type { PronounRelation } from "@/lib/translation/pronounMatrix";

vi.mock("react-hot-toast", () => ({
  default: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockRelations: PronounRelation[] = [
  {
    speaker: "นารูโตะ",
    listener: "ซาสึเกะ",
    firstPerson: "ฉัน",
    secondPerson: "นาย",
    note: "เพื่อนสนิทกึ่งคู่แข่ง",
  },
  {
    speaker: "ซาสึเกะ",
    listener: "นารูโตะ",
    firstPerson: "ฉัน",
    secondPerson: "นาย",
    note: "สุขุม",
  },
];

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
  pronounMatrix: mockRelations,
};

describe("SettingsModal Pronoun & Relationship Matrix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the pronoun matrix section with lock banner and count badge", () => {
    render(<SettingsModal {...defaultProps} />);

    expect(screen.getByText(/ตารางความสัมพันธ์สรรพนาม/i)).toBeInTheDocument();
    expect(screen.getByText(/2 คู่/i)).toBeInTheDocument();
    expect(screen.getByText(/ล็อกสรรพนามใน AI Prompt/i)).toBeInTheDocument();
    expect(screen.getByText(/เพื่อนสนิทกึ่งคู่แข่ง/i)).toBeInTheDocument();
  });

  it("autofills inputs when clicking a pronoun preset chip", () => {
    render(<SettingsModal {...defaultProps} />);

    const presetChip = screen.getByText(/ย้อนยุค \/ โบราณ/i);
    fireEvent.click(presetChip);

    const firstInput = screen.getByLabelText(/สรรพนามแทนตัว/i) as HTMLInputElement;
    const secondInput = screen.getByLabelText(/สรรพนามเรียกอีกฝ่าย/i) as HTMLInputElement;

    expect(firstInput.value).toBe("ข้า");
    expect(secondInput.value).toBe("เจ้า");
  });

  it("adds a new pronoun relation and triggers onPronounMatrixChange", () => {
    const onPronounMatrixChange = vi.fn();
    render(<SettingsModal {...defaultProps} onPronounMatrixChange={onPronounMatrixChange} />);

    const speakerInput = screen.getByLabelText(/ผู้พูด เช่น นารูโตะ/i);
    const listenerInput = screen.getByLabelText(/ผู้ฟัง เช่น ซาสึเกะ/i);
    const firstInput = screen.getByLabelText(/สรรพนามแทนตัว/i);
    const secondInput = screen.getByLabelText(/สรรพนามเรียกอีกฝ่าย/i);
    const noteInput = screen.getByLabelText(/โทนหรือหมายเหตุ/i);
    const addBtn = screen.getByLabelText(/เพิ่มความสัมพันธ์ลงในตาราง/i);

    fireEvent.change(speakerInput, { target: { value: "ซากุระ" } });
    fireEvent.change(listenerInput, { target: { value: "ซาสึเกะ" } });
    fireEvent.change(firstInput, { target: { value: "ฉัน" } });
    fireEvent.change(secondInput, { target: { value: "ซาสึเกะคุง" } });
    fireEvent.change(noteInput, { target: { value: "แอบชอบ เขินอาย" } });
    fireEvent.click(addBtn);

    expect(onPronounMatrixChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          speaker: "ซากุระ",
          listener: "ซาสึเกะ",
          firstPerson: "ฉัน",
          secondPerson: "ซาสึเกะคุง",
          note: "แอบชอบ เขินอาย",
        }),
      ]),
    );
  });

  it("removes a relation when clicking the delete button", () => {
    const onPronounMatrixChange = vi.fn();
    render(<SettingsModal {...defaultProps} onPronounMatrixChange={onPronounMatrixChange} />);

    const deleteBtn = screen.getByLabelText(/ลบความสัมพันธ์ นารูโตะ ถึง ซาสึเกะ/i);
    fireEvent.click(deleteBtn);

    expect(onPronounMatrixChange).toHaveBeenCalledWith([mockRelations[1]]);
  });
});
