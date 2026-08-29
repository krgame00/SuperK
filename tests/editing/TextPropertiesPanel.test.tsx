import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TextPropertiesPanel } from "@/components/editing/TextPropertiesPanel";
import type { TextLayer } from "@/lib/editing/commands";

describe("TextPropertiesPanel", () => {
  const sampleLayer: TextLayer = {
    id: "layer_1",
    pageId: "page_1",
    text: "ทดสอบข้อความ",
    x: 50,
    y: 50,
    width: 200,
    height: 80,
    fontFamily: "var(--font-manga)",
    fontSize: 24,
    color: "#000000",
    strokeColor: "#ffffff",
    strokeWidth: 2,
    align: "center",
  };

  it("renders typography controls for the selected layer", () => {
    render(
      <TextPropertiesPanel
        layer={sampleLayer}
        onChange={vi.fn()}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("ขนาดฟอนต์")).toHaveValue(24);
  });

  it("triggers onChange when font size or text color is updated", () => {
    const onChange = vi.fn();
    render(
      <TextPropertiesPanel
        layer={sampleLayer}
        onChange={onChange}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
      />,
    );

    const sizeInput = screen.getByLabelText("ขนาดฟอนต์");
    fireEvent.change(sizeInput, { target: { value: "32" } });
    expect(onChange).toHaveBeenCalledWith({ fontSize: 32 });

    // Switch to Appearance tab for colors
    fireEvent.click(screen.getByRole("button", { name: "สี & ขอบ" }));
    const colorInput = screen.getByLabelText("สีข้อความ");
    fireEvent.change(colorInput, { target: { value: "#ff0000" } });
    expect(onChange).toHaveBeenCalledWith({ color: "#ff0000" });
  });

  it("handles bold and italic toggles", () => {
    const onChange = vi.fn();
    render(
      <TextPropertiesPanel
        layer={sampleLayer}
        onChange={onChange}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
      />,
    );

    const boldBtn = screen.getByRole("button", { name: "ตัวหนา" });
    fireEvent.click(boldBtn);
    expect(onChange).toHaveBeenCalledWith({ isBold: true });
  });
});
