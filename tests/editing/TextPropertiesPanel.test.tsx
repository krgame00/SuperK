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

  it("renders speaker input with AI/confirmed badge and updates on change", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <TextPropertiesPanel
        layer={{ ...sampleLayer, speaker: "พระเอก", speakerConfirmed: false }}
        onChange={onChange}
      />,
    );

    const speakerInput = screen.getByLabelText("ผู้พูด / ตัวละคร (Speaker)");
    expect(speakerInput).toHaveValue("พระเอก");
    expect(screen.getByText("AI ระบุ")).toBeInTheDocument();

    fireEvent.change(speakerInput, { target: { value: "ซาโตรุ" } });
    expect(onChange).toHaveBeenCalledWith({ speaker: "ซาโตรุ", speakerConfirmed: true });

    rerender(
      <TextPropertiesPanel
        layer={{ ...sampleLayer, speaker: "ซาโตรุ", speakerConfirmed: true }}
        onChange={onChange}
      />,
    );
    expect(screen.getByText("ยืนยันแล้ว")).toBeInTheDocument();
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
  it("renders broadcast font button when scope is all-pages and triggers onBatchApplyTypography", () => {
    const onBatchApply = vi.fn();
    render(
      <TextPropertiesPanel
        layer={sampleLayer}
        onChange={vi.fn()}
        onScopeChange={vi.fn()}
        scope="all-pages"
        onBatchApplyTypography={onBatchApply}
      />,
    );

    const broadcastBtn = screen.getByRole("button", {
      name: "⚡ กระจายฟอนต์นี้ไปยังทุกหน้าทั้งเล่ม",
    });
    expect(broadcastBtn).toBeInTheDocument();

    fireEvent.click(broadcastBtn);
    expect(onBatchApply).toHaveBeenCalledWith({
      fontFamily: sampleLayer.fontFamily,
      isBold: sampleLayer.isBold,
      isItalic: sampleLayer.isItalic,
    });
  });

  it("automatically broadcasts font change when scope is all-pages and font dropdown changes", () => {
    const onChange = vi.fn();
    const onBatchApply = vi.fn();
    render(
      <TextPropertiesPanel
        layer={sampleLayer}
        onChange={onChange}
        onScopeChange={vi.fn()}
        scope="all-pages"
        onBatchApplyTypography={onBatchApply}
      />,
    );

    const fontSelect = screen.getByLabelText("แบบอักษร");
    fireEvent.change(fontSelect, { target: { value: "Prompt, sans-serif" } });

    expect(onChange).toHaveBeenCalledWith({ fontFamily: "Prompt, sans-serif" });
    expect(onBatchApply).toHaveBeenCalledWith({ fontFamily: "Prompt, sans-serif" });
  });

  it("renders 5 typography preset buttons and applies preset style on click", () => {
    const onChange = vi.fn();
    render(
      <TextPropertiesPanel
        layer={sampleLayer}
        onChange={onChange}
      />,
    );

    const shoutBtn = screen.getByRole("button", { name: "ใช้สไตล์ เสียงตะโกน" });
    expect(shoutBtn).toBeInTheDocument();

    fireEvent.click(shoutBtn);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        fontFamily: "Chakra Petch, sans-serif",
        isBold: true,
        strokeWidth: 4,
      }),
    );
  });

  it("broadcasts typography preset when scope is all-pages", () => {
    const onChange = vi.fn();
    const onBatchApply = vi.fn();
    render(
      <TextPropertiesPanel
        layer={sampleLayer}
        onChange={onChange}
        scope="all-pages"
        onBatchApplyTypography={onBatchApply}
      />,
    );

    const whisperBtn = screen.getByRole("button", { name: "ใช้สไตล์ เสียงกระซิบ" });
    fireEvent.click(whisperBtn);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        fontFamily: "Mali, sans-serif",
        isItalic: true,
      }),
    );
    expect(onBatchApply).toHaveBeenCalledWith({
      fontFamily: "Mali, sans-serif",
      isBold: false,
      isItalic: true,
    });
  });

  it("renders auto-fit button and calls onAutoFitBubble when clicked", () => {
    const onAutoFit = vi.fn();
    render(
      <TextPropertiesPanel
        layer={sampleLayer}
        onChange={vi.fn()}
        onAutoFitBubble={onAutoFit}
      />,
    );

    const autoFitBtn = screen.getByRole("button", {
      name: /ปรับพอดีบอลลูน|Auto Fit/i,
    });
    expect(autoFitBtn).toBeInTheDocument();

    fireEvent.click(autoFitBtn);
    expect(onAutoFit).toHaveBeenCalledTimes(1);
  });

  it("renders custom font upload button and accepts font files", () => {
    render(
      <TextPropertiesPanel
        layer={sampleLayer}
        onChange={vi.fn()}
      />,
    );

    const uploadBtn = screen.getByRole("button", { name: "เพิ่มแบบอักษรใหม่" });
    expect(uploadBtn).toBeInTheDocument();

    const fileInput = screen.getByLabelText("เลือกไฟล์ฟอนต์");
    expect(fileInput).toHaveAttribute("accept", ".ttf,.otf,.woff,.woff2");
  });
});
