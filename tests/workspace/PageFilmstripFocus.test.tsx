import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { PageFilmstrip } from "@/components/workspace/PageFilmstrip";

describe("PageFilmstrip Focus Mode", () => {
  const defaultProps = {
    pages: [
      { url: "/page-1.png", name: "Page 1" },
      { url: "/page-2.png", name: "Page 2" },
    ],
    currentPage: 0,
    onSelectPage: vi.fn(),
    onDeletePage: vi.fn(),
    onReorderPages: vi.fn(),
    onAddImages: vi.fn(),
    onClearAll: vi.fn(),
    isCollapsed: false,
    onToggleCollapse: vi.fn(),
  };

  test("renders visible when not in focus mode", () => {
    render(<PageFilmstrip {...defaultProps} isFocusMode={false} />);

    const nav = screen.getByRole("region", { name: "รายการหน้ามังงะและเครื่องมือจัดการหน้า" });
    expect(nav).toBeInTheDocument();
    expect(nav.className).toContain("translate-y-0");
    expect(nav.className).not.toContain("translate-y-[150%]");
  });

  test("slides down and hides when isFocusMode is true", () => {
    render(<PageFilmstrip {...defaultProps} isFocusMode={true} />);

    const nav = screen.getByRole("region", { name: "รายการหน้ามังงะและเครื่องมือจัดการหน้า" });
    expect(nav).toBeInTheDocument();
    expect(nav.className).toContain("translate-y-[150%]");
    expect(nav.className).toContain("opacity-0");
    expect(nav.className).toContain("pointer-events-none");
  });
});
