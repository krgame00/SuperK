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
    batchFailures: [],
    retryFailedPages: vi.fn(),
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
    expect(screen.getByText(/manga translator|superk/i)).toBeTruthy();
  });

  it("does not show 'Drop images to add' overlay when dragging non-file elements", () => {
    const { container } = render(<WorkspacePage />);

    // Fire dragOver with no Files in types (e.g. dragging text or internal element)
    const rootDiv = container.firstChild as HTMLElement;
    const dragOverEvent = {
      preventDefault: vi.fn(),
      dataTransfer: {
        types: ["text/plain"],
        files: [],
      },
    };

    // Trigger dragOver
    import("@testing-library/react").then(({ fireEvent }) => {
      fireEvent.dragOver(rootDiv, dragOverEvent);
    });

    expect(screen.queryByText(/Drop images to add/i)).toBeNull();
  });

  it("shows highlight on dropzone when dragging external Files in empty state", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const { container } = render(<WorkspacePage />);

    const rootDiv = container.firstChild as HTMLElement;
    fireEvent.dragOver(rootDiv, {
      dataTransfer: {
        types: ["Files"],
        files: [new File(["dummy"], "page1.png", { type: "image/png" })],
      },
    });

    const dropzone = screen.getByText(/Drag & Drop manga pages/i).parentElement;
    expect(dropzone).toHaveClass("border-primary");
  });
});