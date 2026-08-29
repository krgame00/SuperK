import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StudioToolbar } from "@/components/editing/StudioToolbar";

describe("StudioToolbar", () => {
  it("renders all editing tool buttons and handles tool selection", () => {
    const onSelectTool = vi.fn();
    const onAddText = vi.fn();

    render(
      <StudioToolbar
        activeTool="select"
        onSelectTool={onSelectTool}
        onAddText={onAddText}
        onOpenFindReplace={vi.fn()}
        onOpenShortcuts={vi.fn()}
        onEditMask={vi.fn()}
      />,
    );

    const textBtn = screen.getByRole("button", { name: "เพิ่มข้อความ (Text)" });
    fireEvent.click(textBtn);
    expect(onSelectTool).toHaveBeenCalledWith("text");
    expect(onAddText).toHaveBeenCalled();
  });

  it("handles opening find/replace and shortcuts dialogs", () => {
    const onFindReplace = vi.fn();
    const onShortcuts = vi.fn();

    render(
      <StudioToolbar
        activeTool="select"
        onSelectTool={vi.fn()}
        onAddText={vi.fn()}
        onOpenFindReplace={onFindReplace}
        onOpenShortcuts={onShortcuts}
        onEditMask={vi.fn()}
      />,
    );

    const findBtn = screen.getByRole("button", { name: "ค้นหาและแทนที่คำ" });
    fireEvent.click(findBtn);
    expect(onFindReplace).toHaveBeenCalled();

    const shortcutsBtn = screen.getByRole("button", { name: "ดูคีย์ลัด" });
    fireEvent.click(shortcutsBtn);
    expect(onShortcuts).toHaveBeenCalled();
  });
});
