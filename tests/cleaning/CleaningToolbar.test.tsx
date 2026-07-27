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
      layer="clean"
      onClean={onClean}
      onEditMask={vi.fn()}
      onLayerChange={onLayerChange}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "คลีนข้อความ" }));
  fireEvent.click(screen.getByRole("button", { name: "Mask" }));
  expect(onClean).toHaveBeenCalledOnce();
  expect(onLayerChange).toHaveBeenCalledWith("mask");
});

test("explains how to recover when the local cleaner is offline", () => {
  render(
    <CleaningToolbar
      hasPage
      hasResult={false}
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
