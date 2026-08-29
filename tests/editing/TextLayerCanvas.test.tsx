import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TextLayerCanvas } from "@/components/editing/TextLayerCanvas";
import type { TextLayer } from "@/lib/editing/commands";

describe("TextLayerCanvas", () => {
  const sampleLayer: TextLayer = {
    id: "layer_1",
    pageId: "page_1",
    text: "สวัสดีชาวโลก",
    x: 50,
    y: 50,
    width: 200,
    height: 100,
    fontFamily: "var(--font-manga)",
    fontSize: 20,
    color: "#000000",
  };

  it("renders text layers and triggers selection on click", () => {
    const onSelect = vi.fn();
    const onChange = vi.fn();
    const onDelete = vi.fn();

    render(
      <TextLayerCanvas
        pageId="page_1"
        layers={[sampleLayer]}
        selectedId={null}
        onSelect={onSelect}
        onChange={onChange}
        onDelete={onDelete}
      />,
    );

    const layerElement = screen.getByText("สวัสดีชาวโลก");
    expect(layerElement).toBeInTheDocument();

    fireEvent.click(layerElement);
    expect(onSelect).toHaveBeenCalledWith("layer_1");
  });

  it("allows inline text editing when double clicked or selected", () => {
    const onSelect = vi.fn();
    const onChange = vi.fn();
    const onDelete = vi.fn();

    render(
      <TextLayerCanvas
        pageId="page_1"
        layers={[sampleLayer]}
        selectedId="layer_1"
        onSelect={onSelect}
        onChange={onChange}
        onDelete={onDelete}
      />,
    );

    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveValue("สวัสดีชาวโลก");

    fireEvent.change(textarea, { target: { value: "ข้อความใหม่" } });
    expect(onChange).toHaveBeenCalledWith("layer_1", { text: "ข้อความใหม่" });
  });

  it("renders selection outline and active state when selected", () => {
    render(
      <TextLayerCanvas
        pageId="page_1"
        layers={[sampleLayer]}
        selectedId="layer_1"
        onSelect={vi.fn()}
        onChange={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const container = screen.getByTestId("text-layer-layer_1");
    expect(container).toHaveClass("is-selected");
  });
});
