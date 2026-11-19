import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { PageViewer } from "@/components/workspace/PageViewer";
import * as translationOverlayModule from "@/lib/translationOverlay";

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

test("renders translation overlay on virtual pages in scroll mode when bubbles exist without cached bitmap", async () => {
  const overlaySpy = vi
    .spyOn(translationOverlayModule, "applyTranslationOverlay")
    .mockResolvedValue(undefined as unknown as void);

  const pages = [{ url: "/page-0.png", name: "Page 1" }];
  const mockBubbles = [
    { box: [100, 100, 300, 300], t: "ข้อความแปลไทย" },
  ];
  const props = {
    pages,
    currentPage: 0,
    viewLayout: "scroll" as const,
    workspaceLayer: "translated" as const,
    currentCleaningResult: null,
    cleaningResultsByPage: new Map([
      ["/page-0.png", { cleanUrl: "blob:clean-page-0" } as any],
    ]),
    translatedImagesMap: new Map(),
    getBubblesForPage: vi.fn(() => mockBubbles),
    brokenPages: new Set<string>(),
    onPageChange: vi.fn(),
    onViewLayoutChange: vi.fn(),
    onRemovePage: vi.fn(),
    onImageError: vi.fn(),
  };

  render(<PageViewer {...props} />);

  const img = await screen.findByRole("img", { name: "Page 1" });
  expect(img).toHaveAttribute("src", "blob:clean-page-0");

  const pageContainer = document.getElementById("spage-0");
  expect(pageContainer).toBeInTheDocument();

  expect(overlaySpy).toHaveBeenCalledWith(
    mockBubbles,
    "scroll",
    0,
    expect.any(Function),
    undefined,
    undefined,
    pageContainer,
    "/page-0.png",
    undefined,
    "th",
  );
});

test("renders cached translated image in scroll mode directly without calling applyTranslationOverlay", async () => {
  const overlaySpy = vi
    .spyOn(translationOverlayModule, "applyTranslationOverlay")
    .mockResolvedValue(undefined as unknown as void);

  const pages = [{ url: "/page-0.png", name: "Page 1" }];
  const mockBubbles = [
    { box: [100, 100, 300, 300], t: "ข้อความแปลไทย" },
  ];
  const translatedImages = new Map([
    ["/page-0.png", "data:image/jpeg;base64,mockRenderedData"],
  ]);
  const props = {
    pages,
    currentPage: 0,
    viewLayout: "scroll" as const,
    workspaceLayer: "translated" as const,
    currentCleaningResult: null,
    cleaningResultsByPage: new Map([
      ["/page-0.png", { cleanUrl: "blob:clean-page-0" } as any],
    ]),
    translatedImagesMap: translatedImages,
    getBubblesForPage: vi.fn(() => mockBubbles),
    brokenPages: new Set<string>(),
    onPageChange: vi.fn(),
    onViewLayoutChange: vi.fn(),
    onRemovePage: vi.fn(),
    onImageError: vi.fn(),
  };

  render(<PageViewer {...props} />);

  const img = await screen.findByRole("img", { name: "Page 1" });
  expect(img).toHaveAttribute("src", "data:image/jpeg;base64,mockRenderedData");

  expect(overlaySpy).not.toHaveBeenCalled();
});

