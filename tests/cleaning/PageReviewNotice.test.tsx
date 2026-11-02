import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PageReviewNotice } from "@/components/cleaning/PageReviewNotice";

describe("PageReviewNotice", () => {
  it("renders notice message and confirm button with proper styling", () => {
    const onConfirm = vi.fn();
    render(<PageReviewNotice onConfirm={onConfirm} />);

    expect(screen.getByText("หน้านี้มีจุดคลีนหรือคำแปลที่ต้องการการตรวจทาน")).toBeInTheDocument();
    const confirmBtn = screen.getByRole("button", { name: "ยืนยันภาพปัจจุบันเพื่อส่งออก" });
    expect(confirmBtn).toBeInTheDocument();

    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("can be dismissed by clicking the close button", () => {
    const onConfirm = vi.fn();
    render(<PageReviewNotice onConfirm={onConfirm} />);

    const closeBtn = screen.getByRole("button", { name: "ปิดการแจ้งเตือน" });
    expect(closeBtn).toBeInTheDocument();

    fireEvent.click(closeBtn);
    expect(screen.queryByText("หน้านี้มีจุดคลีนหรือคำแปลที่ต้องการการตรวจทาน")).not.toBeInTheDocument();
  });
});
