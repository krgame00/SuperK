import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock hooks and heavy modules for WorkspacePage
vi.mock("@/hooks/useCleaning", () => ({
  useCleaning: () => ({
    cleanPage: vi.fn(),
    cleanCurrentPage: vi.fn(async () => {}),
    retryRegion: vi.fn(),
    currentResult: null,
    progress: null,
    error: null,
    resultsByPage: new Map(),
  }),
}));

vi.mock("@/hooks/useTranslation", () => ({
  useTranslation: () => ({
    targetLang: "Thai",
    setTargetLang: vi.fn(),
    sourceLang: "auto",
    setSourceLang: vi.fn(),
    modelPreference: "auto",
    setModelPreference: vi.fn(),
    textStyle: {
      fontFamily: "Itim, sans-serif",
      textColor: "#000000",
      textOutline: "#FFFFFF",
      fontSizeMultiplier: 1.0,
    },
    setTextStyle: vi.fn(),
    nsfwBypassMode: false,
    setNsfwBypassMode: vi.fn(),
    isTranslating: false,
    setIsTranslating: vi.fn(),
    translationResult: null,
    setTranslationResult: vi.fn(),
    showTranslate: false,
    setShowTranslate: vi.fn(),
    activeBubbles: [],
    setActiveBubbles: vi.fn(),
    userApiKey: "",
    setUserApiKey: vi.fn(),
    restoreSavedSession: vi.fn(async () => null),
    clearSavedSession: vi.fn(),
    saveStatus: "idle",
    saveError: null,
    retrySaveSession: vi.fn(),
    workflowPhase: null,
    batchFailures: [],
    retryFailedPages: vi.fn(),
    invalidatePageTranslation: vi.fn(),
  }),
}));

vi.mock("@/lib/translationOverlay", () => ({
  downloadTranslatedImage: vi.fn(),
  applyTranslationOverlay: vi.fn(),
}));

import { SettingsModal } from "@/components/workspace/SettingsModal";
import WorkspacePage from "@/src/app/page";

describe("SettingsModal Accessibility", () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    sourceLang: "auto",
    onSourceLangChange: vi.fn(),
    textStyle: {
      fontFamily: "Itim, sans-serif",
      fontSizeMultiplier: 1.0,
      textColor: "#000000",
      textOutline: "#ffffff",
    },
    onTextStyleChange: vi.fn(),
    modelPreference: "auto",
    onModelPreferenceChange: vi.fn(),
    userApiKey: "",
    onUserApiKeyChange: vi.fn(),
    glossary: [{ source: "Luffy", target: "ลูฟี่" }],
    onGlossaryChange: vi.fn(),
  };

  it("associates labels with their corresponding input and select controls via htmlFor and id", () => {
    render(<SettingsModal {...defaultProps} />);

    // Source language select
    const sourceLangSelect = screen.getByLabelText(/Source Language/i);
    expect(sourceLangSelect).toBeInTheDocument();
    expect(sourceLangSelect.id).toBe("settings-source-lang");

    // Font family select
    const fontFamilySelect = screen.getByLabelText(/Font Family/i);
    expect(fontFamilySelect).toBeInTheDocument();
    expect(fontFamilySelect.id).toBe("settings-font-family");

    // Text color
    const textColorInput = screen.getByLabelText(/Text Color/i);
    expect(textColorInput).toBeInTheDocument();
    expect(textColorInput.id).toBe("settings-text-color");

    // Text outline
    const textOutlineInput = screen.getByLabelText(/Outline Color/i);
    expect(textOutlineInput).toBeInTheDocument();
    expect(textOutlineInput.id).toBe("settings-text-outline");

    // Font size multiplier
    const fontSizeInput = screen.getByLabelText(/Font Size Multiplier/i);
    expect(fontSizeInput).toBeInTheDocument();
    expect(fontSizeInput.id).toBe("settings-font-size");

    // Model preference
    const modelSelect = screen.getByLabelText(/Model Preference/i);
    expect(modelSelect).toBeInTheDocument();
    expect(modelSelect.id).toBe("settings-model-preference");

    // API key
    const apiKeyInput = screen.getByLabelText(/Gemini API Key/i);
    expect(apiKeyInput).toBeInTheDocument();
    expect(apiKeyInput.id).toBe("settings-api-key");
  });

  it("restores focus to the trigger element when closed", () => {
    const trigger = document.createElement("button");
    trigger.setAttribute("id", "trigger-btn");
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const onClose = vi.fn();
    const { rerender } = render(<SettingsModal {...defaultProps} onClose={onClose} />);

    // When modal opens, focus moves to close button
    const closeBtn = screen.getByLabelText("ปิด Settings");
    expect(document.activeElement).toBe(closeBtn);

    // When modal closes, focus returns to trigger
    rerender(<SettingsModal {...defaultProps} isOpen={false} onClose={onClose} />);
    expect(document.activeElement).toBe(trigger);

    document.body.removeChild(trigger);
  });
});

describe("WorkspacePage Accessibility & P1 Controls", () => {
  beforeEach(() => {
    globalThis.HTMLCanvasElement.prototype.getContext = vi.fn(() => null);
    globalThis.URL.createObjectURL = vi.fn(() => "blob:mock");
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  it("renders a focusable file input with accessible label in empty state", () => {
    render(<WorkspacePage />);

    // The file input should have id="file-upload-input" and be in the document
    const fileInput = document.getElementById("file-upload-input");
    expect(fileInput).toBeInTheDocument();
    expect(fileInput).toHaveAttribute("type", "file");
    expect(fileInput).toHaveAttribute("multiple");
    expect(fileInput).toHaveClass("sr-only"); // Visually hidden but accessible in focus tree

    // The label pointing to it should be present
    const label = screen.getByText(/Browse Files/i);
    expect(label).toBeInTheDocument();
  });

  it("renders Settings button on header in empty state", () => {
    render(<WorkspacePage />);
    const settingsBtn = screen.getByRole("button", { name: /เปิดหน้าต่างตั้งค่า/i });
    expect(settingsBtn).toBeInTheDocument();
  });
});
