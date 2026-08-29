import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OcrAreaTool } from "@/components/editing/OcrAreaTool";

describe("OcrAreaTool", () => {
  it("renders OCR region selection prompt and handles trigger", () => {
    const onDetect = vi.fn();
    render(
      <OcrAreaTool
        active={true}
        onDetectRegion={onDetect}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("โหมดเลือกพื้นที่ OCR")).toBeInTheDocument();

    const triggerBtn = screen.getByRole("button", { name: "ตรวจจับข้อความในกรอบ" });
    fireEvent.click(triggerBtn);
    expect(onDetect).toHaveBeenCalled();
  });

  it("handles cancel action", () => {
    const onClose = vi.fn();
    render(
      <OcrAreaTool
        active={true}
        onDetectRegion={vi.fn()}
        onClose={onClose}
      />,
    );

    const closeBtn = screen.getByRole("button", { name: "ยกเลิก" });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });
});
