import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { PageViewer } from "@/components/workspace/PageViewer";

afterEach(() => vi.restoreAllMocks());

test("switching to continuous reading renders pages and virtualizes the reader's own scroll", async () => {
  // jsdom has no layout: provide viewport/row measurements, but keep the real virtualizer.
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-index") ? 1000 : 600;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true, value: vi.fn(),
  });
  const props = {
    pages: Array.from({ length: 23 }, (_, i) => ({ url: `/page-${i}.png`, name: `Page ${i + 1}` })),
    currentPage: 0, workspaceLayer: "original" as const,
    currentCleaningResult: null, cleaningResultsByPage: new Map(), brokenPages: new Set<string>(),
    onPageChange: vi.fn(), onViewLayoutChange: vi.fn(), onRemovePage: vi.fn(), onImageError: vi.fn(),
  };
  const { rerender } = render(<PageViewer {...props} viewLayout="single" />);
  rerender(<PageViewer {...props} viewLayout="scroll" />);
  const reader = screen.getByRole("region", { name: "พื้นที่เลื่อนอ่านมังงะ" });
  expect(reader).toHaveClass("overflow-auto", "h-full");
  expect(await screen.findByRole("img", { name: "Page 1" })).toBeInTheDocument();
  expect(screen.queryByRole("img", { name: "Page 12" })).not.toBeInTheDocument();
  fireEvent.scroll(reader, { target: { scrollTop: 11000 } });
  await waitFor(() => expect(screen.getByRole("img", { name: "Page 12" })).toBeInTheDocument());
  expect(screen.queryByRole("img", { name: "Page 1" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("img", { name: "Page 12" }));
  expect(props.onPageChange).toHaveBeenCalledWith(11);
  expect(props.onViewLayoutChange).toHaveBeenCalledWith("single");
});

