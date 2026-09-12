import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { CleaningToolbar } from "@/components/cleaning/CleaningToolbar";

test("offers clean and layer controls without hiding the page workflow", () => {
  const onClean = vi.fn();
  const onLayerChange = vi.fn();
  render(
    <CleaningToolbar
      hasPage
      hasResult
      hasTranslated
      layer="clean"
      onClean={onClean}
      onEditMask={vi.fn()}
      onLayerChange={onLayerChange}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "คลีนข้อความ" }));
  fireEvent.click(screen.getByRole("tab", { name: "Mask" }));
  expect(onClean).toHaveBeenCalledOnce();
  expect(onLayerChange).toHaveBeenCalledWith("mask");
});

test("explains how to recover when the local cleaner is offline", () => {
  render(
    <CleaningToolbar
      hasPage
      hasResult={false}
      hasTranslated={false}
      layer="original"
      onClean={vi.fn()}
      onEditMask={vi.fn()}
      onLayerChange={vi.fn()}
      error={{
        message: "offline",
        recovery: "start-local-service",
      }}
    />,
  );
  expect(screen.getByText(/ocr-service\\run\.ps1/)).toBeTruthy();
});

test("triggers position toggle and collapse callbacks", () => {
  const onTogglePosition = vi.fn();
  const onCollapse = vi.fn();

  const { rerender } = render(
    <CleaningToolbar
      hasPage
      hasResult
      hasTranslated
      layer="clean"
      onClean={vi.fn()}
      onEditMask={vi.fn()}
      onLayerChange={vi.fn()}
      position="top"
      onTogglePosition={onTogglePosition}
      onCollapse={onCollapse}
    />,
  );

  const moveBtn = screen.getByRole("button", { name: "ย้ายแถบไปด้านล่าง" });
  fireEvent.click(moveBtn);
  expect(onTogglePosition).toHaveBeenCalledOnce();

  const collapseBtn = screen.getByRole("button", { name: "ย่อแถบเครื่องมือ" });
  fireEvent.click(collapseBtn);
  expect(onCollapse).toHaveBeenCalledOnce();

  // Rerender with position="bottom"
  rerender(
    <CleaningToolbar
      hasPage
      hasResult
      hasTranslated
      layer="clean"
      onClean={vi.fn()}
      onEditMask={vi.fn()}
      onLayerChange={vi.fn()}
      position="bottom"
      onTogglePosition={onTogglePosition}
      onCollapse={onCollapse}
    />,
  );

  expect(screen.getByRole("button", { name: "ย้ายแถบไปด้านบน" })).toBeTruthy();
});
