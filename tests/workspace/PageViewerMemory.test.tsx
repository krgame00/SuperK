import { render } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { PageViewer } from "@/components/workspace/PageViewer";

describe("PageViewer Windowed Image Preloading", () => {
  const originalImage = globalThis.Image;
  let createdImageSources: string[] = [];

  beforeEach(() => {
    createdImageSources = [];
    class MockImage {
      private _src = "";
      naturalWidth = 1000;
      naturalHeight = 1500;
      onload: (() => void) | null = null;
      complete = false;

      get src() {
        return this._src;
      }
      set src(value: string) {
        this._src = value;
        createdImageSources.push(value);
      }
    }
    globalThis.Image = MockImage as unknown as typeof Image;
  });

  afterEach(() => {
    globalThis.Image = originalImage;
  });

  const generatePages = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      url: `/manga/page-${i}.png`,
      name: `Page ${i + 1}`,
    }));

  const defaultProps = {
    pages: generatePages(10),
    currentPage: 0,
    viewLayout: "single" as const,
    workspaceLayer: "original" as const,
    currentCleaningResult: null,
    cleaningResultsByPage: new Map(),
    translatedImagesMap: new Map(),
    brokenPages: new Set<string>(),
    onPageChange: vi.fn(),
    onViewLayoutChange: vi.fn(),
    onRemovePage: vi.fn(),
    onImageError: vi.fn(),
  };

  test("preloads only pages within window (currentPage ± 2) instead of all pages", () => {
    render(<PageViewer {...defaultProps} currentPage={0} />);

    // For currentPage = 0, pages in window are 0, 1, 2
    expect(createdImageSources).toContain("/manga/page-0.png");
    expect(createdImageSources).toContain("/manga/page-1.png");
    expect(createdImageSources).toContain("/manga/page-2.png");

    // Pages outside window should NOT be preloaded
    expect(createdImageSources).not.toContain("/manga/page-3.png");
    expect(createdImageSources).not.toContain("/manga/page-4.png");
    expect(createdImageSources).not.toContain("/manga/page-9.png");
  });

  test("slides preloading window when currentPage changes", () => {
    const { rerender } = render(<PageViewer {...defaultProps} currentPage={0} />);

    expect(createdImageSources).not.toContain("/manga/page-5.png");

    // Advance to page 5
    rerender(<PageViewer {...defaultProps} currentPage={5} />);

    // Window around 5 is [3, 4, 5, 6, 7]
    expect(createdImageSources).toContain("/manga/page-5.png");
    expect(createdImageSources).toContain("/manga/page-6.png");
    expect(createdImageSources).toContain("/manga/page-7.png");

    // Page 9 is still outside window [3..7]
    expect(createdImageSources).not.toContain("/manga/page-9.png");
  });
});
