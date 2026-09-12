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
    ({
      hasTranslated,
      layer,
      onClean,
      position,
      onTogglePosition,
      onCollapse,
    }: ComponentProps<typeof CleaningToolbar>) => (
      <section
        aria-label="Cleaning toolbar"
        data-has-translated={String(hasTranslated)}
        data-layer={layer}
        data-position={position}
      >
        <button type="button" onClick={onClean}>Clean</button>
        {onTogglePosition && (
          <button type="button" onClick={onTogglePosition} aria-label="Toggle position">
            Toggle position
          </button>
        )}
        {onCollapse && (
          <button type="button" onClick={onCollapse} aria-label="Collapse toolbar">
            Collapse toolbar
          </button>
        )}
      </section>
    ),
  ),
}));

describe("Workspace Toolbar Docking and Collapse", () => {
  beforeEach(() => {
    globalThis.HTMLCanvasElement.prototype.getContext = vi.fn(() => null);
    globalThis.URL.createObjectURL = vi.fn(() => "blob:mock");
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  it("toggles collapse into mini-pill via collapse button, B key, and expand button", async () => {
    render(<WorkspacePage />);

    // Restore session
    const restoreBtn = await screen.findByText("📂 คืนค่างานเดิม");
    fireEvent.click(restoreBtn);

    // Initial state: full toolbar is shown
    const toolbar = await screen.findByRole("region", { name: "Cleaning toolbar" });
    expect(toolbar).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "แถบเครื่องมือแบบย่อ" })).toBeNull();

    // Click collapse button
    const collapseBtn = screen.getByRole("button", { name: "Collapse toolbar" });
    fireEvent.click(collapseBtn);

    // Mini-pill should now be visible, full toolbar should be unmounted
    const miniPill = await screen.findByRole("region", { name: "แถบเครื่องมือแบบย่อ" });
    expect(miniPill).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Cleaning toolbar" })).toBeNull();

    // Click expand on mini-pill
    const expandBtn = screen.getByRole("button", { name: "ขยายแถบเครื่องมือ (กด B)" });
    fireEvent.click(expandBtn);

    // Full toolbar returns
    expect(await screen.findByRole("region", { name: "Cleaning toolbar" })).toBeInTheDocument();

    // Press 'B' key to collapse again
    fireEvent.keyDown(window, { key: "B" });
    expect(await screen.findByRole("region", { name: "แถบเครื่องมือแบบย่อ" })).toBeInTheDocument();

    // Press 'B' key again to expand
    fireEvent.keyDown(window, { key: "B" });
    expect(await screen.findByRole("region", { name: "Cleaning toolbar" })).toBeInTheDocument();
  });

  it("toggles position between top and bottom", async () => {
    render(<WorkspacePage />);

    // Restore session
    const restoreBtn = await screen.findByText("📂 คืนค่างานเดิม");
    fireEvent.click(restoreBtn);

    const toolbar = await screen.findByRole("region", { name: "Cleaning toolbar" });
    const container = toolbar.closest(".pointer-events-none");
    expect(container).toBeTruthy();

    // Default position is top
    expect(container?.className).toContain("top-2.5");

    // Click toggle position button
    const togglePosBtn = screen.getByRole("button", { name: "Toggle position" });
    fireEvent.click(togglePosBtn);

    // Should now be positioned at the bottom (bottom-23 or bottom-25 when filmstrip is visible)
    expect(container?.className).toContain("bottom-23");

    // Click again to return to top
    fireEvent.click(togglePosBtn);
    expect(container?.className).toContain("top-2.5");
  });
});
