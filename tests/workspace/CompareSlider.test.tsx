import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CompareSlider } from "@/components/workspace/CompareSlider";

describe("CompareSlider (Interactive Drag-Compare Curtain Slider)", () => {
  const defaultProps = {
    originalUrl: "blob:original-image",
    translatedUrl: "blob:translated-image",
    originalAlt: "ต้นฉบับ (Original)",
    translatedAlt: "หน้าแปลแล้ว (Translated)",
  };

  it("renders container, both images, divider and interactive slider handle", () => {
    render(<CompareSlider {...defaultProps} initialPosition={50} />);

    expect(screen.getByTestId("compare-slider-container")).toBeInTheDocument();
    expect(screen.getByTestId("compare-slider-original-image")).toHaveAttribute(
      "src",
      "blob:original-image",
    );
    expect(screen.getByTestId("compare-slider-translated-image")).toHaveAttribute(
      "src",
      "blob:translated-image",
    );
    expect(screen.getByTestId("compare-slider-divider")).toBeInTheDocument();

    const handle = screen.getByRole("slider");
    expect(handle).toBeInTheDocument();
    expect(handle).toHaveAttribute("aria-valuenow", "50");
    expect(handle).toHaveAttribute("aria-valuemin", "0");
    expect(handle).toHaveAttribute("aria-valuemax", "100");
  });

  it("applies clip-path polygon correctly based on slider position", () => {
    render(<CompareSlider {...defaultProps} initialPosition={65} />);

    const clippedLayer = screen.getByTestId("compare-slider-clipped-layer");
    expect(clippedLayer).toHaveStyle({
      clipPath: "polygon(0 0, 65% 0, 65% 100%, 0 100%)",
    });

    const divider = screen.getByTestId("compare-slider-divider");
    expect(divider).toHaveStyle({
      left: "65%",
    });
  });

  it("resets position to 50% on double click", () => {
    const onPositionChange = vi.fn();
    render(
      <CompareSlider
        {...defaultProps}
        initialPosition={25}
        onPositionChange={onPositionChange}
      />,
    );

    const handle = screen.getByRole("slider");
    expect(handle).toHaveAttribute("aria-valuenow", "25");

    fireEvent.doubleClick(handle);
    expect(onPositionChange).toHaveBeenCalledWith(50);
    expect(handle).toHaveAttribute("aria-valuenow", "50");
  });

  it("supports keyboard navigation with arrow keys and home/end", () => {
    const onPositionChange = vi.fn();
    render(
      <CompareSlider
        {...defaultProps}
        initialPosition={50}
        onPositionChange={onPositionChange}
      />,
    );

    const handle = screen.getByRole("slider");

    // Arrow Left (-2%)
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onPositionChange).toHaveBeenLastCalledWith(48);

    // Arrow Right (+2%)
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onPositionChange).toHaveBeenLastCalledWith(50);

    // PageDown (-10%)
    fireEvent.keyDown(handle, { key: "PageDown" });
    expect(onPositionChange).toHaveBeenLastCalledWith(40);

    // Home (0%)
    fireEvent.keyDown(handle, { key: "Home" });
    expect(onPositionChange).toHaveBeenLastCalledWith(0);

    // End (100%)
    fireEvent.keyDown(handle, { key: "End" });
    expect(onPositionChange).toHaveBeenLastCalledWith(100);
  });

  it("updates position on pointer drag interactions", () => {
    const onPositionChange = vi.fn();
    render(
      <CompareSlider
        {...defaultProps}
        initialPosition={50}
        onPositionChange={onPositionChange}
      />,
    );

    const container = screen.getByTestId("compare-slider-container");

    // Mock getBoundingClientRect
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 0,
      width: 1000,
      height: 600,
      right: 1100,
      bottom: 600,
      x: 100,
      y: 0,
      toJSON: () => {},
    });

    // Pointer down at x=400 (which is (400 - 100)/1000 = 30%)
    fireEvent.pointerDown(container, { clientX: 400, pointerId: 1 });
    expect(onPositionChange).toHaveBeenCalledWith(30);

    // Pointer move to x=800 ((800 - 100)/1000 = 70%)
    fireEvent.pointerMove(container, { clientX: 800, pointerId: 1 });
    expect(onPositionChange).toHaveBeenCalledWith(70);

    // Pointer up
    fireEvent.pointerUp(container, { clientX: 800, pointerId: 1 });
  });

  it("works in controlled mode when position prop is supplied", () => {
    const { rerender } = render(
      <CompareSlider {...defaultProps} position={40} />,
    );

    const handle = screen.getByRole("slider");
    expect(handle).toHaveAttribute("aria-valuenow", "40");

    rerender(<CompareSlider {...defaultProps} position={85} />);
    expect(handle).toHaveAttribute("aria-valuenow", "85");
  });
});
