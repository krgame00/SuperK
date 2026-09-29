import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsModal, type SettingsModalProps } from "@/components/workspace/SettingsModal";

vi.mock("@/lib/lifecycle/workspaceResourceManager", () => ({
  workspaceResourceManager: {
    getCurrentUsageMB: vi.fn(() => 123),
    getBudgetMB: vi.fn(() => 492),
  },
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
};

describe("SettingsModal memory readout", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows live cache usage against the budget when open", () => {
    render(<SettingsModal {...defaultProps} isOpen={true} />);

    expect(screen.getByText(/123 MB จาก 492 MB/)).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByLabelText("การใช้หน่วยความจำแคชหน้าภาพ")).toBeInTheDocument();
  });

  it("renders no memory card while the modal is closed", () => {
    const { container } = render(<SettingsModal {...defaultProps} isOpen={false} />);

    expect(screen.queryByText(/MB จาก/)).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});
