import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { PageFilmstrip } from "@/components/workspace/PageFilmstrip";

describe("PageFilmstrip", () => {
  test("constrains the thumbnail scroller to the viewport", () => {
    render(
      <PageFilmstrip
        pages={Array.from({ length: 20 }, (_, index) => ({
          url: `/page-${index + 1}.png`,
          name: `Page ${index + 1}`,
        }))}
        currentPage={0}
        onSelectPage={vi.fn()}
        onDeletePage={vi.fn()}
        onReorderPages={vi.fn()}
        onAddImages={vi.fn()}
        onClearAll={vi.fn()}
        isCollapsed={false}
        onToggleCollapse={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("region", { name: "รายการหน้ามังงะและเครื่องมือจัดการหน้า" }),
    ).toHaveClass("min-w-0");
    expect(document.querySelector("#page-filmstrip")).toHaveClass(
      "w-full",
      "max-w-full",
      "min-w-0",
      "overflow-x-auto",
    );
  });

  test("uses a vertical mouse wheel to move the horizontal filmstrip", () => {
    render(
      <PageFilmstrip
        pages={Array.from({ length: 20 }, (_, index) => ({
          url: `/page-${index + 1}.png`,
          name: `Page ${index + 1}`,
        }))}
        currentPage={0}
        onSelectPage={vi.fn()}
        onDeletePage={vi.fn()}
        onReorderPages={vi.fn()}
        onAddImages={vi.fn()}
        onClearAll={vi.fn()}
        isCollapsed={false}
        onToggleCollapse={vi.fn()}
      />,
    );

    const filmstrip = document.querySelector<HTMLDivElement>("#page-filmstrip");
    expect(filmstrip).not.toBeNull();
    Object.defineProperties(filmstrip!, {
      clientWidth: { configurable: true, value: 320 },
      scrollWidth: { configurable: true, value: 1200 },
    });

    fireEvent.wheel(filmstrip!, { deltaY: 120 });

    expect(filmstrip!.scrollLeft).toBe(120);
  });
});
