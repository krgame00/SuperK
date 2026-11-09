import { render, screen } from "@testing-library/react";
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
});
