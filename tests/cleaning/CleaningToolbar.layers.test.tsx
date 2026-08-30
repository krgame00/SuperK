import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { CleaningToolbar } from "@/components/cleaning/CleaningToolbar";

test("offers original clean and translated as primary layers", () => {
  const onLayerChange = vi.fn();
  render(
    <CleaningToolbar
      hasPage
      hasResult
      hasTranslated
      layer="translated"
      onClean={vi.fn()}
      onEditMask={vi.fn()}
      onLayerChange={onLayerChange}
    />,
  );

  fireEvent.click(screen.getByRole("tab", { name: "Original" }));
  fireEvent.click(screen.getByRole("tab", { name: "Clean" }));
  fireEvent.click(screen.getByRole("tab", { name: "Translated" }));

  expect(onLayerChange.mock.calls).toEqual([
    ["original"],
    ["clean"],
    ["translated"],
  ]);
});

test("disables unavailable derived layers and advanced mask", () => {
  const onLayerChange = vi.fn();
  render(
    <CleaningToolbar
      hasPage
      hasResult={false}
      hasTranslated={false}
      layer="original"
      onClean={vi.fn()}
      onEditMask={vi.fn()}
      onLayerChange={onLayerChange}
    />,
  );

  const clean = screen.getByRole("tab", { name: "Clean" });
  const translated = screen.getByRole("tab", { name: "Translated" });
  const mask = screen.getByRole("tab", { name: "Mask" });

  expect(clean.hasAttribute("disabled")).toBe(true);
  expect(translated.hasAttribute("disabled")).toBe(true);
  expect(mask.hasAttribute("disabled")).toBe(true);

  fireEvent.click(clean);
  fireEvent.click(translated);
  fireEvent.click(mask);
  expect(onLayerChange).not.toHaveBeenCalled();
});

test("exposes pressed state and preserves focus for enabled layer controls", () => {
  render(
    <CleaningToolbar
      hasPage
      hasResult
      hasTranslated
      layer="clean"
      onClean={vi.fn()}
      onEditMask={vi.fn()}
      onLayerChange={vi.fn()}
    />,
  );

  const original = screen.getByRole("tab", { name: "Original" });
  const clean = screen.getByRole("tab", { name: "Clean" });
  const translated = screen.getByRole("tab", { name: "Translated" });
  const mask = screen.getByRole("tab", { name: "Mask" });

  expect(original.getAttribute("aria-selected")).toBe("false");
  expect(clean.getAttribute("aria-selected")).toBe("true");
  expect(translated.getAttribute("aria-selected")).toBe("false");
  expect(mask.getAttribute("aria-selected")).toBe("false");

  translated.focus();
  expect(document.activeElement).toBe(translated);
});
