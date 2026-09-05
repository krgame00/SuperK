import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkspacePage from "@/src/app/page";
import { CleaningToolbar } from "@/components/cleaning/CleaningToolbar";

vi.mock("react-hot-toast", () => ({
  default: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
  Toaster: () => null,
}));

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
    restoreSavedSession: vi.fn(async () => ({
      pages: [{ url: "data:image/png;base64,TEST", name: "test-page.png" }],
      currentPage: 0,
      bubbleCache: new Map(),
      translatedImageCache: new Map(),
    })),
    clearSavedSession: vi.fn(),
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

vi.mock("@/components/cleaning/MaskLegend", () => ({
  MaskLegend: () => null,
}));

vi.mock("@/components/cleaning/CleaningToolbar", () => ({
  CleaningToolbar: vi.fn(
    ({ hasTranslated, layer, onClean, onEditMask, onLayerChange }: ComponentProps<typeof CleaningToolbar>) => (
      <section
        aria-label="Cleaning toolbar"
        data-has-translated={String(hasTranslated)}
        data-layer={layer}
      >
        <button type="button" onClick={onClean}>Clean</button>
      </section>
    ),
  ),
}));

describe("Workspace Focus Mode Top Bar Toggle", () => {
  beforeEach(() => {
    globalThis.HTMLCanvasElement.prototype.getContext = vi.fn(() => null);
    globalThis.URL.createObjectURL = vi.fn(() => "blob:mock");
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  it("hides top toolbar by default in focus mode and toggles via button and T key", async () => {
    render(<WorkspacePage />);

    // Click restore session button
    const restoreBtn = await screen.findByText("📂 คืนค่างานเดิม");
    fireEvent.click(restoreBtn);

    // Wait for session to restore and render the page
    const toolbar = await screen.findByRole("region", { name: "Cleaning toolbar" });
    const toolbarContainer = toolbar.closest(".pointer-events-none");
    expect(toolbarContainer).toBeTruthy();
    expect(toolbarContainer?.className).toContain("translate-y-0");

    // Enter Focus Mode via 'F' key
    fireEvent.keyDown(window, { key: "F" });

    // In focus mode, toolbar container should be translated up and faded out
    expect(toolbarContainer?.className).toContain("-translate-y-24");
    expect(toolbarContainer?.className).toContain("opacity-0");
    expect(toolbarContainer?.className).toContain("pointer-events-none");

    // Toggle button should be present with "แสดงแถบบน"
    const toggleBtn = screen.getByRole("button", { name: "แสดงแถบเครื่องมือคลีน (B)" });
    expect(toggleBtn).toBeInTheDocument();

    // Click toggle button to reveal toolbar
    fireEvent.click(toggleBtn);
    expect(toolbarContainer?.className).toContain("translate-y-0");
    expect(toolbarContainer?.className).toContain("opacity-100");
    expect(screen.getByRole("button", { name: "ซ่อนแถบเครื่องมือคลีน (B)" })).toBeInTheDocument();

    // Press 'B' key to hide toolbar again
    fireEvent.keyDown(window, { key: "B" });
    expect(toolbarContainer?.className).toContain("-translate-y-24");
    expect(toolbarContainer?.className).toContain("opacity-0");

    // Press 'Escape' to exit focus mode -> toolbar returns to normal visible state
    fireEvent.keyDown(window, { key: "Escape" });
    expect(toolbarContainer?.className).toContain("translate-y-0");
    expect(toolbarContainer?.className).toContain("opacity-100");
  });
});
