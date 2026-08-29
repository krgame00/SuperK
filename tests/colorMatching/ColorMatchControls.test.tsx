import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ColorMatchStatus } from "@/components/colorMatching/ColorMatchStatus";
import { TextPropertiesPanel } from "@/components/editing/TextPropertiesPanel";
import type { TextLayer } from "@/lib/editing/commands";

describe("ColorMatchControls and UI Status", () => {
  it("renders auto-match status with high confidence", () => {
    const onReanalyze = vi.fn();
    render(
      <ColorMatchStatus
        profile={{
          fill: "#ff2a85",
          outline: "#ffffff",
          fillConfidence: 0.92,
          outlineConfidence: 0.85,
          source: "auto",
        }}
        onReanalyze={onReanalyze}
      />,
    );

    expect(screen.getByText(/จับสีอัตโนมัติ/)).toBeInTheDocument();
    expect(screen.getByText(/92%/)).toBeInTheDocument();

    const reanalyzeBtn = screen.getByRole("button", { name: "วิเคราะห์สีใหม่" });
    fireEvent.click(reanalyzeBtn);
    expect(onReanalyze).toHaveBeenCalled();
  });

  it("renders low confidence warning status", () => {
    render(
      <ColorMatchStatus
        profile={{
          fill: "#112233",
          outline: "#ffffff",
          fillConfidence: 0.45,
          outlineConfidence: 0.5,
          source: "global",
        }}
      />,
    );

    expect(screen.getByText(/ใช้สีมาตรฐาน/)).toBeInTheDocument();
  });

  it("triggers color actions from TextPropertiesPanel", () => {
    const onChange = vi.fn();
    const layer: TextLayer = {
      id: "layer_1",
      pageId: "page_1",
      text: "ทดสอบ",
      x: 10,
      y: 10,
      width: 100,
      height: 50,
      color: "#000000",
      strokeColor: "#ffffff",
      fontFamily: "Prompt",
      fontSize: 18,
    };

    render(
      <TextPropertiesPanel
        layer={layer}
        onChange={onChange}
        onDelete={vi.fn()}
      />,
    );

    // Switch to Appearance tab
    const appearanceTab = screen.getByRole("button", { name: "สี & ขอบ" });
    fireEvent.click(appearanceTab);

    expect(screen.getByLabelText("สีข้อความ")).toHaveValue("#000000");
  });
});
