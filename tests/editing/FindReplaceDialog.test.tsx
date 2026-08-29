import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FindReplaceDialog } from "@/components/editing/FindReplaceDialog";

describe("FindReplaceDialog", () => {
  it("renders find and replace inputs and triggers onReplace", () => {
    const onReplace = vi.fn();
    render(
      <FindReplaceDialog
        isOpen={true}
        onClose={vi.fn()}
        onReplace={onReplace}
      />,
    );

    const findInput = screen.getByLabelText("ค้นหาคำ");
    const replaceInput = screen.getByLabelText("แทนที่ด้วย");

    fireEvent.change(findInput, { target: { value: "นายท่าน" } });
    fireEvent.change(replaceInput, { target: { value: "ท่านอาจารย์" } });

    const replaceAllBtn = screen.getByRole("button", { name: "แทนที่ทั้งหมด" });
    fireEvent.click(replaceAllBtn);

    expect(onReplace).toHaveBeenCalledWith({
      find: "นายท่าน",
      replace: "ท่านอาจารย์",
      scope: "this-page",
      caseSensitive: false,
    });
  });

  it("handles scope change to all-pages", () => {
    const onReplace = vi.fn();
    render(
      <FindReplaceDialog
        isOpen={true}
        onClose={vi.fn()}
        onReplace={onReplace}
      />,
    );

    const findInput = screen.getByLabelText("ค้นหาคำ");
    fireEvent.change(findInput, { target: { value: "สวัสดี" } });

    const scopeSelect = screen.getByLabelText("ขอบเขต");
    fireEvent.change(scopeSelect, { target: { value: "all-pages" } });

    const replaceAllBtn = screen.getByRole("button", { name: "แทนที่ทั้งหมด" });
    fireEvent.click(replaceAllBtn);

    expect(onReplace).toHaveBeenCalledWith({
      find: "สวัสดี",
      replace: "",
      scope: "all-pages",
      caseSensitive: false,
    });
  });
});
