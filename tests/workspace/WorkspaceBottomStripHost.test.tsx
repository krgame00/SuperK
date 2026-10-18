import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  WorkspaceBottomStripHost,
  type WorkspaceBottomStripHostProps,
} from "@/components/workspace/WorkspaceBottomStripHost";

// Mock PageFilmstrip
vi.mock("@/components/workspace/PageFilmstrip", () => ({
  PageFilmstrip: vi.fn(({ pages, currentPage, onSelectPage, onDeletePage, onClearAll, isCollapsed }: any) => (
    <div data-testid="mock-page-filmstrip" data-collapsed={isCollapsed} data-current={currentPage}>
      <span>Filmstrip: {pages.length} pages</span>
      <button type="button" onClick={() => onSelectPage(1)}>Select Page 2</button>
      <button type="button" onClick={() => onDeletePage(0)}>Delete Page 1</button>
      <button type="button" onClick={onClearAll}>Clear All</button>
    </div>
  )),
}));

// Mock RemnantReviewPanel
vi.mock("@/components/cleaning/RemnantReviewPanel", () => ({
  RemnantReviewPanel: vi.fn(({ regions, onOpenMask, onConfirmAllArtwork, onRecheck }: any) => (
    <div data-testid="mock-remnant-review-panel" data-region-count={regions?.length ?? 0}>
      <span>RemnantReviewPanel: {regions?.length ?? 0} regions</span>
      <button type="button" onClick={() => onOpenMask({ id: "cand-1", rect: { x: 0, y: 0, width: 10, height: 10 } })}>
        Open Mask
      </button>
      <button type="button" onClick={onConfirmAllArtwork}>
        Confirm All
      </button>
      <button type="button" onClick={onRecheck}>
        Recheck
      </button>
    </div>
  )),
}));

function createDefaultProps(): WorkspaceBottomStripHostProps {
  return {
    pages: [
      { url: "blob:p1", name: "01.png" },
      { url: "blob:p2", name: "02.png" },
    ],
    currentPage: 0,
    onSelectPage: vi.fn(),
    onDeletePage: vi.fn(),
    onReorderPages: vi.fn(),
    onAddImages: vi.fn(),
    onClearAll: vi.fn(),
    isThumbnailsCollapsed: false,
    onToggleCollapse: vi.fn(),
    isFocusMode: false,

    currentCleaningResult: {
      cleanUrl: "blob:clean1",
      width: 800,
      height: 1200,
      regions: [{ id: "r1", box: [0, 0, 10, 10] } as any],
    } as any,
    currentPageUrl: "blob:p1",
    canConfirmHumanInspection: false,
    remnantInspection: undefined,
    onOpenMaskCandidate: vi.fn(),
    onConfirmArtworkCandidate: vi.fn(),
    onConfirmAllPageRemnants: vi.fn(),
    onConfirmHumanInspection: vi.fn(),
    onRecheckPageRemnants: vi.fn(),
  };
}

describe("WorkspaceBottomStripHost", () => {
  it("renders PageFilmstrip and RemnantReviewPanel with correct data bindings", () => {
    const props = createDefaultProps();
    render(<WorkspaceBottomStripHost {...props} />);

    expect(screen.getByTestId("mock-page-filmstrip")).toBeInTheDocument();
    expect(screen.getByTestId("mock-remnant-review-panel")).toBeInTheDocument();
    expect(screen.getByText("Filmstrip: 2 pages")).toBeInTheDocument();
    expect(screen.getByText("RemnantReviewPanel: 1 regions")).toBeInTheDocument();
  });

  it("relays PageFilmstrip actions (select, delete, clear)", () => {
    const props = createDefaultProps();
    render(<WorkspaceBottomStripHost {...props} />);

    fireEvent.click(screen.getByText("Select Page 2"));
    expect(props.onSelectPage).toHaveBeenCalledWith(1);

    fireEvent.click(screen.getByText("Delete Page 1"));
    expect(props.onDeletePage).toHaveBeenCalledWith(0);

    fireEvent.click(screen.getByText("Clear All"));
    expect(props.onClearAll).toHaveBeenCalledTimes(1);
  });

  it("relays RemnantReviewPanel actions (open mask, confirm all, recheck)", () => {
    const props = createDefaultProps();
    render(<WorkspaceBottomStripHost {...props} />);

    fireEvent.click(screen.getByText("Open Mask"));
    expect(props.onOpenMaskCandidate).toHaveBeenCalledWith({
      id: "cand-1",
      rect: { x: 0, y: 0, width: 10, height: 10 },
    });

    fireEvent.click(screen.getByText("Confirm All"));
    expect(props.onConfirmAllPageRemnants).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("Recheck"));
    expect(props.onRecheckPageRemnants).toHaveBeenCalledTimes(1);
  });
});
