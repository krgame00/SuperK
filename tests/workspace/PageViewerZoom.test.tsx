import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { PageViewer } from "@/components/workspace/PageViewer";

describe("PageViewer Zoom Integration", () => {
  const defaultProps = {
    pages: [
      { url: "/page-1.png", name: "Page 1" },
      { url: "/page-2.png", name: "Page 2" },
    ],
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

  test("renders zoom controls and updates #pageContainer transform on zoom in", () => {
    render(<PageViewer {...defaultProps} />);

    const zoomInBtn = screen.getByRole("button", { name: "ซูมเข้า" });
    expect(zoomInBtn).toBeInTheDocument();

    const pageContainer = document.querySelector("#pageContainer");
    expect(pageContainer).toBeInTheDocument();
    expect(pageContainer).toHaveStyle({ transform: "translate3d(0px, 0px, 0) scale(1)" });

    fireEvent.click(zoomInBtn);

    // After clicking zoom in, scale should increase (next preset is 1.5)
    expect(pageContainer?.getAttribute("style")).toContain("scale(1.5)");
  });

  test("renders the zoom stage at natural size so Fit is applied exactly once", () => {
    render(<PageViewer {...defaultProps} />);

    const image = screen.getByRole("img", { name: "หน้า 1: Page 1" });
    Object.defineProperty(image, "naturalWidth", {
      configurable: true,
      value: 1600,
    });
    Object.defineProperty(image, "naturalHeight", {
      configurable: true,
      value: 2000,
    });

    fireEvent.load(image);

    const pageContainer = document.querySelector("#pageContainer");
    expect(pageContainer).toHaveStyle({ width: "1600px", height: "2000px" });
    expect(image).toHaveStyle({ width: "100%", height: "100%" });
    expect(image).not.toHaveClass("max-w-full");
    expect(image).not.toHaveClass("max-h-[calc(100vh-160px)]");
  });

  test("retains cached natural dimensions across page transitions without layout shifts", () => {
    const { rerender } = render(<PageViewer {...defaultProps} currentPage={0} />);

    const image1 = screen.getByRole("img", { name: "หน้า 1: Page 1" });
    Object.defineProperty(image1, "naturalWidth", { configurable: true, value: 1600 });
    Object.defineProperty(image1, "naturalHeight", { configurable: true, value: 2000 });
    fireEvent.load(image1);

    expect(document.querySelector("#pageContainer")).toHaveStyle({ width: "1600px", height: "2000px" });

    // Navigate to page 2 (new page, dimensions not yet loaded)
    rerender(<PageViewer {...defaultProps} currentPage={1} />);
    expect(document.querySelector("#pageContainer")).toHaveStyle({ width: "100%", height: "100%" });

    const image2 = screen.getByRole("img", { name: "หน้า 2: Page 2" });
    Object.defineProperty(image2, "naturalWidth", { configurable: true, value: 1200 });
    Object.defineProperty(image2, "naturalHeight", { configurable: true, value: 1800 });
    fireEvent.load(image2);

    expect(document.querySelector("#pageContainer")).toHaveStyle({ width: "1200px", height: "1800px" });

    // Navigate back to page 1 - dimensions should be immediately restored from cache without waiting for load
    rerender(<PageViewer {...defaultProps} currentPage={0} />);
    expect(document.querySelector("#pageContainer")).toHaveStyle({ width: "1600px", height: "2000px" });
  });

  test("disables zoom controls when current page is broken", () => {
    render(
      <PageViewer
        {...defaultProps}
        brokenPages={new Set(["/page-1.png"])}
      />,
    );

    const zoomInBtn = screen.getByRole("button", { name: "ซูมเข้า" });
    expect(zoomInBtn).toBeDisabled();
  });

  test("renders scroll mode toolbar and toggles between fit-width and actual-size", () => {
    render(<PageViewer {...defaultProps} viewLayout="scroll" />);

    const fitWidthBtn = screen.getByRole("button", { name: "พอดีความกว้าง" });
    const actualSizeBtn = screen.getByRole("button", { name: "ขนาดจริง (100%)" });

    expect(fitWidthBtn).toBeInTheDocument();
    expect(actualSizeBtn).toBeInTheDocument();

    fireEvent.click(actualSizeBtn);
    expect(actualSizeBtn).toHaveAttribute("aria-pressed", "true");
  });

  test("prevents default on Ctrl+Wheel inside viewport", () => {
    render(<PageViewer {...defaultProps} />);

    const viewport = document.querySelector("#pageContainer")?.parentElement;
    expect(viewport).toBeInTheDocument();

    const wheelEvent = new WheelEvent("wheel", {
      ctrlKey: true,
      deltaY: -100,
      bubbles: true,
      cancelable: true,
    });

    const preventDefaultSpy = vi.spyOn(wheelEvent, "preventDefault");
    act(() => {
      viewport?.dispatchEvent(wheelEvent);
    });

    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  test("prevents native HTML5 drag on image and viewport to avoid dropzone trigger", () => {
    render(<PageViewer {...defaultProps} />);

    const image = screen.getByRole("img", { name: "หน้า 1: Page 1" });
    const viewport = document.querySelector("#pageContainer")?.parentElement;
    expect(image).toBeInTheDocument();
    expect(viewport).toBeInTheDocument();

    // Image must have draggable set to false and pointer-events-none class
    expect(image).toHaveAttribute("draggable", "false");
    expect(image).toHaveClass("pointer-events-none");

    // dragstart on image must be prevented
    const dragEvent = fireEvent.dragStart(image);
    expect(dragEvent).toBe(false); // fireEvent returns false when defaultPrevented

    // dragstart on viewport must also be prevented
    const viewportDragEvent = fireEvent.dragStart(viewport!);
    expect(viewportDragEvent).toBe(false);
  });

  test("prevents pointerdown default when zoomed in to avoid browser drag gestures", () => {
    render(<PageViewer {...defaultProps} />);

    const zoomInBtn = screen.getByRole("button", { name: "ซูมเข้า" });
    fireEvent.click(zoomInBtn); // scale moves to 1.5 (> 1.05)

    const viewport = document.querySelector("#pageContainer")?.parentElement;
    expect(viewport).toBeInTheDocument();

    const pointerDownEvent = fireEvent.pointerDown(viewport!, {
      button: 0,
      clientX: 200,
      clientY: 200,
    });
    expect(pointerDownEvent).toBe(false); // defaultPrevented
  });

  test("suppresses transition-transform on initial page render to prevent jumpy zoom animation", () => {
    render(<PageViewer {...defaultProps} />);

    const pageContainer = document.querySelector("#pageContainer");
    expect(pageContainer).toBeInTheDocument();
    // Initially transition must be "none" and opacity 0 until dimensions are resolved
    expect(pageContainer).toHaveStyle({ transition: "none", opacity: "0" });
    expect(pageContainer?.className).not.toContain("transition-transform");
  });
});
