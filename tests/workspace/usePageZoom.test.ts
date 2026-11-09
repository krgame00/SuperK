import { renderHook, act } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { usePageZoom, MIN_ZOOM_SCALE, MAX_ZOOM_SCALE } from "@/hooks/usePageZoom";

describe("usePageZoom", () => {
  const createMockContainer = (width = 800, height = 1000) => {
    const el = document.createElement("div");
    Object.defineProperty(el, "clientWidth", { value: width, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: height, configurable: true });
    Object.defineProperty(el, "getBoundingClientRect", {
      value: () => ({
        left: 0,
        top: 0,
        width,
        height,
        right: width,
        bottom: height,
      }),
      configurable: true,
    });
    return el;
  };

  test("calculates fitScale based on container and image dimensions", () => {
    const container = createMockContainer(800, 1000);
    const containerRef = { current: container };

    const { result } = renderHook(() =>
      usePageZoom({
        currentPage: 0,
        workspaceLayer: "original",
        viewLayout: "single",
        containerRef,
        imageNaturalWidth: 1600,
        imageNaturalHeight: 2000,
      }),
    );

    // 800 / 1600 = 0.5, 1000 / 2000 = 0.5 -> fitScale = 0.5
    expect(result.current.fitScale).toBeCloseTo(0.5);
    expect(result.current.scale).toBeCloseTo(0.5);
    expect(result.current.isFit).toBe(true);
    expect(result.current.displayPercentage).toBe(50);
  });

  test("centers the shorter axis when fitting a natural-size stage", () => {
    const container = createMockContainer(800, 1000);
    const containerRef = { current: container };

    const { result } = renderHook(() =>
      usePageZoom({
        currentPage: 0,
        workspaceLayer: "original",
        viewLayout: "single",
        containerRef,
        imageNaturalWidth: 1600,
        imageNaturalHeight: 1000,
      }),
    );

    expect(result.current.fitScale).toBeCloseTo(0.5);
    expect(result.current.pan).toEqual({ x: 0, y: 250 });
  });

  test("clamps scale between MIN_ZOOM_SCALE (0.25) and MAX_ZOOM_SCALE (4.0)", () => {
    const container = createMockContainer(1000, 1000);
    const containerRef = { current: container };

    const { result } = renderHook(() =>
      usePageZoom({
        currentPage: 0,
        workspaceLayer: "original",
        viewLayout: "single",
        containerRef,
        imageNaturalWidth: 1000,
        imageNaturalHeight: 1000,
      }),
    );

    act(() => {
      result.current.zoomTo(10.0);
    });
    expect(result.current.scale).toBe(MAX_ZOOM_SCALE);
    expect(result.current.displayPercentage).toBe(400);

    act(() => {
      result.current.zoomTo(0.05);
    });
    expect(result.current.scale).toBe(MIN_ZOOM_SCALE);
    expect(result.current.displayPercentage).toBe(25);
  });

  test("anchors zoom to focal point coordinate accurately", () => {
    const container = createMockContainer(1000, 1000);
    const containerRef = { current: container };

    const { result } = renderHook(() =>
      usePageZoom({
        currentPage: 0,
        workspaceLayer: "original",
        viewLayout: "single",
        containerRef,
        imageNaturalWidth: 1000,
        imageNaturalHeight: 1000,
      }),
    );

    // Initial scale: 1.0, pan: (0, 0)
    // Zoom in at point (400, 300) from 1.0 to 2.0
    // Initial pixel under cursor: (400 - 0) / 1.0 = 400
    // Target pan: 400 - 400 * 2.0 = -400
    act(() => {
      result.current.zoomTo(2.0, { x: 400, y: 300 });
    });

    expect(result.current.scale).toBe(2.0);
    expect(result.current.pan.x).toBeCloseTo(-400, 1);
    expect(result.current.pan.y).toBeCloseTo(-300, 1);

    // Check pixel invariant: (cursorX - panX) / scale should still be 400
    const pixelX = (400 - result.current.pan.x) / result.current.scale;
    const pixelY = (300 - result.current.pan.y) / result.current.scale;
    expect(pixelX).toBeCloseTo(400, 1);
    expect(pixelY).toBeCloseTo(300, 1);
  });

  test("pans the zoomed image vertically with ordinary wheel scrolling", () => {
    const container = createMockContainer(800, 1000);
    const containerRef = { current: container };

    const { result } = renderHook(() =>
      usePageZoom({
        currentPage: 0,
        workspaceLayer: "original",
        viewLayout: "single",
        containerRef,
        imageNaturalWidth: 1600,
        imageNaturalHeight: 2000,
      }),
    );

    act(() => {
      result.current.zoomTo(2.0);
    });
    const initialPanY = result.current.pan.y;
    const wheelEvent = new WheelEvent("wheel", { deltaY: 120, cancelable: true });

    act(() => {
      result.current.handleWheel(wheelEvent);
    });

    expect(wheelEvent.defaultPrevented).toBe(true);
    expect(result.current.pan.y).toBe(initialPanY - 120);
  });

  test("resets scale to Fit when currentPage changes", () => {
    const container = createMockContainer(1000, 1000);
    const containerRef = { current: container };

    let page = 0;
    const { result, rerender } = renderHook(() =>
      usePageZoom({
        currentPage: page,
        workspaceLayer: "original",
        viewLayout: "single",
        containerRef,
        imageNaturalWidth: 1000,
        imageNaturalHeight: 1000,
      }),
    );

    // Zoom in on page 0
    act(() => {
      result.current.zoomTo(2.0);
    });
    expect(result.current.scale).toBe(2.0);
    expect(result.current.isFit).toBe(false);

    // Change page to 1
    page = 1;
    rerender();

    expect(result.current.scale).toBe(1.0);
    expect(result.current.isFit).toBe(true);
    expect(result.current.pan).toEqual({ x: 0, y: 0 });
  });

  test("persists zoom scale and pan offset when workspaceLayer changes", () => {
    const container = createMockContainer(1000, 1000);
    const containerRef = { current: container };

    let layer = "original";
    const { result, rerender } = renderHook(() =>
      usePageZoom({
        currentPage: 0,
        workspaceLayer: layer,
        viewLayout: "single",
        containerRef,
        imageNaturalWidth: 1000,
        imageNaturalHeight: 1000,
      }),
    );

    // Zoom in on original layer
    act(() => {
      result.current.zoomTo(2.5, { x: 500, y: 500 });
    });
    const savedScale = result.current.scale;
    const savedPan = { ...result.current.pan };

    // Switch layer to clean
    layer = "clean";
    rerender();

    expect(result.current.scale).toBe(savedScale);
    expect(result.current.pan).toEqual(savedPan);

    // Switch layer to mask
    layer = "mask";
    rerender();

    expect(result.current.scale).toBe(savedScale);
    expect(result.current.pan).toEqual(savedPan);
  });

  test("handles keyboard shortcuts (+, -, 0, 1) and ignores input elements", () => {
    const container = createMockContainer(1000, 1000);
    const containerRef = { current: container };

    const { result } = renderHook(() =>
      usePageZoom({
        currentPage: 0,
        workspaceLayer: "original",
        viewLayout: "single",
        containerRef,
        imageNaturalWidth: 1000,
        imageNaturalHeight: 1000,
      }),
    );

    // Press '+' to zoom in
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "+" }));
    });
    expect(result.current.scale).toBeGreaterThan(1.0);

    // Press '0' to reset to fit
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "0" }));
    });
    expect(result.current.isFit).toBe(true);

    // Press '1' to go to 100%
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "1" }));
    });
    expect(result.current.scale).toBe(1.0);

    // When focused in an input, shortcuts must be ignored
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "+" }));
    });
    expect(result.current.scale).toBe(1.0);

    document.body.removeChild(input);
  });

  test("toggles scrollZoomMode between fit-width and actual-size in scroll layout", () => {
    const container = createMockContainer(1000, 1000);
    const containerRef = { current: container };

    const { result } = renderHook(() =>
      usePageZoom({
        currentPage: 0,
        workspaceLayer: "original",
        viewLayout: "scroll",
        containerRef,
        imageNaturalWidth: 1000,
        imageNaturalHeight: 1000,
      }),
    );

    expect(result.current.scrollZoomMode).toBe("fit-width");

    act(() => {
      result.current.toggleScrollZoomMode();
    });
    expect(result.current.scrollZoomMode).toBe("actual-size");

    act(() => {
      result.current.setScrollZoomMode("fit-width");
    });
    expect(result.current.scrollZoomMode).toBe("fit-width");
  });

  test("ignores pointerdown on interactive overlay elements so text bubble can be edited without starting viewer pan", () => {
    const container = createMockContainer(1000, 1000);
    const containerRef = { current: container };

    const { result } = renderHook(() =>
      usePageZoom({
        currentPage: 0,
        workspaceLayer: "original",
        viewLayout: "single",
        containerRef,
        imageNaturalWidth: 1000,
        imageNaturalHeight: 1000,
      }),
    );

    // Zoom in to 2.0 so panning would normally be enabled
    act(() => {
      result.current.zoomTo(2.0);
    });

    const bubbleEl = document.createElement("div");
    bubbleEl.className = "translation-bubble translation-bubble-wrapper";
    document.body.appendChild(bubbleEl);

    const preventDefault = vi.fn();
    act(() => {
      result.current.handlePointerDown({
        button: 0,
        clientX: 100,
        clientY: 100,
        target: bubbleEl,
        currentTarget: container,
        pointerId: 1,
        preventDefault,
      } as unknown as React.PointerEvent);
    });

    // isPanning must NOT be true, and preventDefault must NOT be called on the bubble
    expect(result.current.isPanning).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();

    document.body.removeChild(bubbleEl);
  });

  test("allows panning with Spacebar held even at fitScale", () => {
    const container = createMockContainer(1000, 1000);
    const containerRef = { current: container };

    const { result } = renderHook(() =>
      usePageZoom({
        currentPage: 0,
        workspaceLayer: "original",
        viewLayout: "single",
        containerRef,
        imageNaturalWidth: 1000,
        imageNaturalHeight: 1000,
      }),
    );

    expect(result.current.isFit).toBe(true);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " " }));
    });
    expect(result.current.isSpacePressed).toBe(true);

    const preventDefault = vi.fn();
    act(() => {
      result.current.handlePointerDown({
        button: 0,
        clientX: 200,
        clientY: 200,
        target: container,
        currentTarget: container,
        pointerId: 1,
        preventDefault,
      } as unknown as React.PointerEvent);
    });

    expect(result.current.isPanning).toBe(true);
    expect(preventDefault).toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space", key: " " }));
    });
    expect(result.current.isSpacePressed).toBe(false);
  });

  test("smooths continuous pinch gestures on trackpad wheel with small deltaY", () => {
    const container = createMockContainer(1000, 1000);
    const containerRef = { current: container };

    const { result } = renderHook(() =>
      usePageZoom({
        currentPage: 0,
        workspaceLayer: "original",
        viewLayout: "single",
        containerRef,
        imageNaturalWidth: 1000,
        imageNaturalHeight: 1000,
      }),
    );

    const pinchEvent = new WheelEvent("wheel", {
      deltaY: -2,
      deltaMode: 0,
      ctrlKey: true,
      cancelable: true,
      clientX: 500,
      clientY: 500,
    });

    act(() => {
      result.current.handleWheel(pinchEvent);
    });

    expect(result.current.scale).toBeGreaterThan(1.01);
    expect(result.current.scale).toBeLessThan(1.05);
    expect(result.current.isWheelActive).toBe(true);
  });

  test("applies inertial glide on pointerup with high release velocity", () => {
    vi.useFakeTimers();
    const container = createMockContainer(1000, 1000);
    const containerRef = { current: container };

    const { result } = renderHook(() =>
      usePageZoom({
        currentPage: 0,
        workspaceLayer: "original",
        viewLayout: "single",
        containerRef,
        imageNaturalWidth: 2000,
        imageNaturalHeight: 2000,
      }),
    );

    act(() => {
      result.current.zoomTo(2.0);
    });

    const preventDefault = vi.fn();
    act(() => {
      result.current.handlePointerDown({
        button: 0,
        clientX: 400,
        clientY: 400,
        target: container,
        currentTarget: container,
        pointerId: 1,
        preventDefault,
      } as unknown as React.PointerEvent);
    });

    act(() => {
      result.current.handlePointerMove({
        clientX: 300,
        clientY: 300,
      } as unknown as React.PointerEvent);
    });

    act(() => {
      result.current.handlePointerUp({
        pointerId: 1,
        currentTarget: container,
      } as unknown as React.PointerEvent);
    });

    expect(result.current.isPanning).toBe(false);
    expect(result.current.isInertiaActive).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current.isInertiaActive).toBe(false);
    vi.useRealTimers();
  });

  test("cancels inertial glide immediately when pointerdown fires during glide", () => {
    vi.useFakeTimers();
    const container = createMockContainer(1000, 1000);
    const containerRef = { current: container };

    const { result } = renderHook(() =>
      usePageZoom({
        currentPage: 0,
        workspaceLayer: "original",
        viewLayout: "single",
        containerRef,
        imageNaturalWidth: 2000,
        imageNaturalHeight: 2000,
      }),
    );

    act(() => {
      result.current.zoomTo(2.0);
    });

    const preventDefault = vi.fn();
    act(() => {
      result.current.handlePointerDown({
        button: 0,
        clientX: 400,
        clientY: 400,
        target: container,
        currentTarget: container,
        pointerId: 1,
        preventDefault,
      } as unknown as React.PointerEvent);
    });

    act(() => {
      result.current.handlePointerMove({
        clientX: 300,
        clientY: 300,
      } as unknown as React.PointerEvent);
    });

    act(() => {
      result.current.handlePointerUp({
        pointerId: 1,
        currentTarget: container,
      } as unknown as React.PointerEvent);
    });

    expect(result.current.isInertiaActive).toBe(true);

    // Another click during glide should immediately stop inertia
    act(() => {
      result.current.handlePointerDown({
        button: 0,
        clientX: 300,
        clientY: 300,
        target: container,
        currentTarget: container,
        pointerId: 2,
        preventDefault,
      } as unknown as React.PointerEvent);
    });

    expect(result.current.isInertiaActive).toBe(false);
    vi.useRealTimers();
  });

  test("calculates fitScale and centers image within split-view half pane when isSplitView is true", () => {
    // 1400px wide, 900px high viewport
    const container = createMockContainer(1400, 900);
    const containerRef = { current: container };

    const { result } = renderHook(() =>
      usePageZoom({
        currentPage: 0,
        workspaceLayer: "original",
        viewLayout: "single",
        containerRef,
        imageNaturalWidth: 800,
        imageNaturalHeight: 1200,
        isSplitView: true,
      }),
    );

    // Available pane width: Math.floor((1400 - 28) / 2) = 686px
    // Available pane height: 900 - 16 = 884px
    // scaleX = 686 / 800 = 0.8575, scaleY = 884 / 1200 = 0.73666...
    // fitScale = Math.min(0.8575, 0.73666...) ~= 0.7367
    expect(result.current.fitScale).toBeCloseTo(884 / 1200, 3);
    expect(result.current.scale).toBeCloseTo(884 / 1200, 3);

    // Centering in 686px pane:
    // scaledW = 800 * (884 / 1200) = 589.33px
    // pan.x = (686 - 589.33) / 2 ~= 48.33px (perfectly centered, NOT pushed 400px right)
    const expectedScaledW = 800 * (884 / 1200);
    const expectedPanX = (686 - expectedScaledW) / 2;
    expect(result.current.pan.x).toBeCloseTo(expectedPanX, 1);
    expect(result.current.pan.y).toBeCloseTo(0, 1);
  });

  test("resets zoom state to split fit dimensions when isSplitView toggles dynamically", () => {
    const container = createMockContainer(1400, 900);
    const containerRef = { current: container };

    const { result, rerender } = renderHook(
      ({ isSplitView }) =>
        usePageZoom({
          currentPage: 0,
          workspaceLayer: "original",
          viewLayout: "single",
          containerRef,
          imageNaturalWidth: 800,
          imageNaturalHeight: 1200,
          isSplitView,
        }),
      {
        initialProps: { isSplitView: false },
      },
    );

    // Single view: fitScale = 900 / 1200 = 0.75, pan.x = (1400 - 800 * 0.75) / 2 = 400px
    expect(result.current.fitScale).toBeCloseTo(0.75, 2);
    expect(result.current.pan.x).toBeCloseTo(400, 1);

    // Toggle to split view:
    rerender({ isSplitView: true });

    // Split view: fitScale = 884 / 1200 ~= 0.7367, pan.x ~= 48.33px
    expect(result.current.fitScale).toBeCloseTo(884 / 1200, 3);
    expect(result.current.pan.x).toBeCloseTo((686 - 800 * (884 / 1200)) / 2, 1);
  });
});
