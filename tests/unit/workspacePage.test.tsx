import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock heavy hooks before importing the page
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
    workflowPhase: null,
    invalidatePageTranslation: vi.fn(),
  }),
}));

// Canvas + jsPDF + browser APIs are heavy; stub the overlay module too
vi.mock("@/lib/translationOverlay", () => ({
  downloadTranslatedImage: vi.fn(),
  applyTranslationOverlay: vi.fn(),
}));

import { render, screen } from "@testing-library/react";
import WorkspacePage from "@/src/app/page";

describe("WorkspacePage smoke test", () => {
  beforeEach(() => {
    // jsdom lacks these browser APIs used at render time
    globalThis.HTMLCanvasElement.prototype.getContext = vi.fn(() => null);
    globalThis.URL.createObjectURL = vi.fn(() => "blob:mock");
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  it("renders without crashing (imports resolve, page mounts)", () => {
    render(<WorkspacePage />);
    // Header should be present
    expect(screen.getByText(/ann|superk|translate/i)).toBeTruthy();
  });
});