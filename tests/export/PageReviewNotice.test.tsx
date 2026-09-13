import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PageReviewNotice } from "@/components/cleaning/PageReviewNotice";

describe("page review acceptance", () => {
  it("dismisses presentation without accepting the page", () => {
    const accept = vi.fn();
    render(<PageReviewNotice onConfirm={accept} />);
    fireEvent.click(screen.getByRole("button", { name: "ปิดการแจ้งเตือน" }));
    expect(accept).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("requires the explicit acceptance action", () => {
    const accept = vi.fn();
    render(<PageReviewNotice onConfirm={accept} />);
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันภาพปัจจุบันเพื่อส่งออก" }));
    expect(accept).toHaveBeenCalledTimes(1);
  });
});
