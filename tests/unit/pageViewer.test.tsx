import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PageViewer } from "@/components/workspace/PageViewer";

describe("PageViewer navigation", () => {
  const pages = [
    { url: "page1.jpg", name: "Page 1" },
    { url: "page2.jpg", name: "Page 2" },
    { url: "page3.jpg", name: "Page 3" },
  ];

  it("calls onPageChange with prev + 1 when clicking the Next Page (Right Arrow) button", () => {
    const onPageChange = vi.fn();
    render(
      <PageViewer
        pages={pages}
        currentPage={0}
        viewLayout="single"
        workspaceLayer="original"
        currentCleaningResult={null}
        cleaningResultsByPage={new Map()}
        brokenPages={new Set()}
        onPageChange={onPageChange}
        onViewLayoutChange={vi.fn()}
        onRemovePage={vi.fn()}
        onImageError={vi.fn()}
      />
    );

    const nextBtn = screen.getByTitle("Next Page (Right Arrow)");
    fireEvent.click(nextBtn);

    expect(onPageChange).toHaveBeenCalledTimes(1);
    const updater = onPageChange.mock.calls[0][0];
    expect(typeof updater).toBe("function");
    expect(updater(0)).toBe(1);
  });

  it("calls onPageChange with prev - 1 when clicking the Previous Page (Left Arrow) button", () => {
    const onPageChange = vi.fn();
    render(
      <PageViewer
        pages={pages}
        currentPage={1}
        viewLayout="single"
        workspaceLayer="original"
        currentCleaningResult={null}
        cleaningResultsByPage={new Map()}
        brokenPages={new Set()}
        onPageChange={onPageChange}
        onViewLayoutChange={vi.fn()}
        onRemovePage={vi.fn()}
        onImageError={vi.fn()}
      />
    );

    const prevBtn = screen.getByTitle("Previous Page (Left Arrow)");
    fireEvent.click(prevBtn);

    expect(onPageChange).toHaveBeenCalledTimes(1);
    const updater = onPageChange.mock.calls[0][0];
    expect(typeof updater).toBe("function");
    expect(updater(1)).toBe(0);
  });
});
