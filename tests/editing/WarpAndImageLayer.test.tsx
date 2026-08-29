import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WarpPanel } from "@/components/editing/WarpPanel";
import { ImageLayerPanel } from "@/components/editing/ImageLayerPanel";
import type { ImageLayer, WarpSettings } from "@/lib/editing/commands";

describe("Warp and Image Layer Panels", () => {
  it("renders warp panel controls and handles bend changes", () => {
    const onChange = vi.fn();
    const warp: WarpSettings = {
      effect: "arch",
      bend: 30,
      horizontal: 0,
      vertical: 0,
    };

    render(<WarpPanel warp={warp} onChange={onChange} onReset={vi.fn()} />);

    expect(screen.getByLabelText("เอฟเฟกต์การดัด")).toHaveValue("arch");
    const bendSlider = screen.getByLabelText("ความโค้ง (Bend)");
    fireEvent.change(bendSlider, { target: { value: "50" } });
    expect(onChange).toHaveBeenCalledWith({ bend: 50 });
  });

  it("renders image layer panel and handles opacity and flips", () => {
    const onChange = vi.fn();
    const layer: ImageLayer = {
      id: "img_1",
      pageId: "page_1",
      src: "https://example.com/layer.png",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      opacity: 1,
      flipX: false,
      flipY: false,
    };

    render(
      <ImageLayerPanel
        layer={layer}
        onChange={onChange}
        onDelete={vi.fn()}
      />,
    );

    const flipXBtn = screen.getByRole("button", { name: "กลับด้านแนวนอน" });
    fireEvent.click(flipXBtn);
    expect(onChange).toHaveBeenCalledWith({ flipX: true });
  });
});
