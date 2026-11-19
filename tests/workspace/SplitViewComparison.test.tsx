import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PageViewer } from "@/components/workspace/PageViewer";

describe("PageViewer Side-by-Side Split View", () => {
  const pages = [
    { url: "blob:original-page-1", name: "Page 1.jpg" },
    { url: "blob:original-page-2", name: "Page 2.jpg" },
  ];

  it("renders single view when isSplitView is false", () => {
    const { container } = render(
      <PageViewer
        pages={pages}
        currentPage={0}
        viewLayout="single"
        workspaceLayer="translated"
        currentCleaningResult={null}
        cleaningResultsByPage={new Map()}
        brokenPages={new Set()}
        onPageChange={vi.fn()}
        onViewLayoutChange={vi.fn()}
        onRemovePage={vi.fn()}
        onImageError={vi.fn()}
        isSplitView={false}
      />,
    );

    expect(screen.queryByTestId("split-view-original-pane")).not.toBeInTheDocument();
    expect(screen.queryByTestId("split-view-translated-pane")).not.toBeInTheDocument();
    expect(container.querySelector("#pageContainer")).toBeInTheDocument();
  });

  it("renders side-by-side original and translated panes when isSplitView is true", () => {
    render(
      <PageViewer
        pages={pages}
        currentPage={0}
        viewLayout="single"
        workspaceLayer="translated"
        currentCleaningResult={{
          jobId: "mock-job-1",
          sourceHash: "mock-hash",
          width: 800,
          height: 1200,
          cleanAsset: "asset-1",
          maskAsset: "asset-2",
          reviewMaskAsset: "",
          protectedMaskAsset: "",
          cleanUrl: "blob:cleaned-page-1",
          maskUrl: "blob:mask-page-1",
          reviewMaskUrl: "",
          protectedMaskUrl: "",
          regions: [],
          timingsMs: {},
        }}
        cleaningResultsByPage={new Map()}
        brokenPages={new Set()}
        onPageChange={vi.fn()}
        onViewLayoutChange={vi.fn()}
        onRemovePage={vi.fn()}
        onImageError={vi.fn()}
        isSplitView={true}
      />,
    );

    const origPane = screen.getByTestId("split-view-original-pane");
    const transPane = screen.getByTestId("split-view-translated-pane");

    expect(origPane).toBeInTheDocument();
    expect(transPane).toBeInTheDocument();

    expect(screen.getByText(/ต้นฉบับ \(Original\)/i)).toBeInTheDocument();
    expect(screen.getByText(/หน้าแปลแล้ว \(Translated\)/i)).toBeInTheDocument();

    // Original pane should contain the raw original image
    const origImg = origPane.querySelector("img");
    expect(origImg).toHaveAttribute("src", "blob:original-page-1");

    // Translated pane should contain the interactive pageContainer
    const pageContainer = transPane.querySelector("#pageContainer");
    expect(pageContainer).toBeInTheDocument();

    // Both panes should apply transform styling from stageStyle
    const origStage = origPane.querySelector(".inline-flex");
    expect(origStage?.getAttribute("style")).toContain("translate3d");
    expect(pageContainer?.getAttribute("style")).toContain("translate3d");
  });

  it("dynamically transitions between single view and split view without unmounting essential containers", () => {
    const { rerender } = render(
      <PageViewer
        pages={pages}
        currentPage={0}
        viewLayout="single"
        workspaceLayer="translated"
        currentCleaningResult={null}
        cleaningResultsByPage={new Map()}
        brokenPages={new Set()}
        onPageChange={vi.fn()}
        onViewLayoutChange={vi.fn()}
        onRemovePage={vi.fn()}
        onImageError={vi.fn()}
        isSplitView={false}
      />,
    );

    expect(screen.queryByTestId("split-view-original-pane")).not.toBeInTheDocument();
    expect(screen.queryByTestId("split-view-translated-pane")).not.toBeInTheDocument();

    rerender(
      <PageViewer
        pages={pages}
        currentPage={0}
        viewLayout="single"
        workspaceLayer="translated"
        currentCleaningResult={null}
        cleaningResultsByPage={new Map()}
        brokenPages={new Set()}
        onPageChange={vi.fn()}
        onViewLayoutChange={vi.fn()}
        onRemovePage={vi.fn()}
        onImageError={vi.fn()}
        isSplitView={true}
      />,
    );

    expect(screen.getByTestId("split-view-original-pane")).toBeInTheDocument();
    expect(screen.getByTestId("split-view-translated-pane")).toBeInTheDocument();
  });

  it("toggles between side-by-side and interactive curtain compare slider", () => {
    const onComparisonModeChange = vi.fn();
    render(
      <PageViewer
        pages={pages}
        currentPage={0}
        viewLayout="single"
        workspaceLayer="translated"
        currentCleaningResult={null}
        cleaningResultsByPage={new Map()}
        brokenPages={new Set()}
        onPageChange={vi.fn()}
        onViewLayoutChange={vi.fn()}
        onRemovePage={vi.fn()}
        onImageError={vi.fn()}
        isSplitView={true}
        onComparisonModeChange={onComparisonModeChange}
      />,
    );

    // Initial default is side-by-side
    expect(screen.getByTestId("split-view-original-pane")).toBeInTheDocument();
    expect(screen.getByTestId("split-view-translated-pane")).toBeInTheDocument();
    expect(screen.queryByTestId("compare-slider-container")).not.toBeInTheDocument();

    // Click slider button
    const sliderBtn = screen.getByTestId("compare-mode-slider-btn");
    fireEvent.click(sliderBtn);

    expect(onComparisonModeChange).toHaveBeenCalledWith("slider");
    expect(screen.getByTestId("compare-slider-container")).toBeInTheDocument();
    expect(screen.queryByTestId("split-view-original-pane")).not.toBeInTheDocument();

    // Click side-by-side button to return
    const sbsBtn = screen.getByTestId("compare-mode-side-by-side-btn");
    fireEvent.click(sbsBtn);

    expect(onComparisonModeChange).toHaveBeenCalledWith("side-by-side");
    expect(screen.getByTestId("split-view-original-pane")).toBeInTheDocument();
    expect(screen.queryByTestId("compare-slider-container")).not.toBeInTheDocument();
  });

  it("dispatches superk:request-overlay-refresh event when entering split view or switching to side-by-side", async () => {
    vi.useFakeTimers();
    const refreshListener = vi.fn();
    window.addEventListener("superk:request-overlay-refresh", refreshListener);

    try {
      const { rerender } = render(
        <PageViewer
          pages={pages}
          currentPage={0}
          viewLayout="single"
          workspaceLayer="translated"
          currentCleaningResult={null}
          cleaningResultsByPage={new Map()}
          brokenPages={new Set()}
          onPageChange={vi.fn()}
          onViewLayoutChange={vi.fn()}
          onRemovePage={vi.fn()}
          onImageError={vi.fn()}
          isSplitView={false}
        />,
      );

      vi.advanceTimersByTime(50);
      expect(refreshListener).toHaveBeenCalled();
      refreshListener.mockClear();

      // Enter split view
      rerender(
        <PageViewer
          pages={pages}
          currentPage={0}
          viewLayout="single"
          workspaceLayer="translated"
          currentCleaningResult={null}
          cleaningResultsByPage={new Map()}
          brokenPages={new Set()}
          onPageChange={vi.fn()}
          onViewLayoutChange={vi.fn()}
          onRemovePage={vi.fn()}
          onImageError={vi.fn()}
          isSplitView={true}
        />,
      );

      vi.advanceTimersByTime(50);
      expect(refreshListener).toHaveBeenCalled();
    } finally {
      window.removeEventListener("superk:request-overlay-refresh", refreshListener);
      vi.useRealTimers();
    }
  });

  it("renders dedicated overlay chrome layer and uses translatedImagesMap fallback when cleaning is missing", () => {
    const translatedImages = new Map([
      ["blob:original-page-1", "blob:baked-translated-page-1"],
    ]);

    render(
      <PageViewer
        pages={pages}
        currentPage={0}
        viewLayout="single"
        workspaceLayer="translated"
        currentCleaningResult={null}
        cleaningResultsByPage={new Map()}
        translatedImagesMap={translatedImages}
        brokenPages={new Set()}
        onPageChange={vi.fn()}
        onViewLayoutChange={vi.fn()}
        onRemovePage={vi.fn()}
        onImageError={vi.fn()}
        isSplitView={true}
      />,
    );

    const transPane = screen.getByTestId("split-view-translated-pane");
    const chromeLayer = transPane.querySelector("[data-overlay-chrome-layer]");
    expect(chromeLayer).toBeInTheDocument();

    const img = transPane.querySelector("img");
    expect(img).toHaveAttribute("src", "blob:baked-translated-page-1");
  });
});
