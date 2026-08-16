import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { MaskEditor } from "@/components/cleaning/MaskEditor";
import type { CleaningRegion } from "@/lib/cleaning/types";

const preservedRegion: CleaningRegion = {
  id: "region-1",
  rect: { x: 10, y: 10, width: 20, height: 12 },
  route: "flat",
  confidence: 0.9,
  status: "preserved",
  residualScore: 0,
  damageScore: 0,
  pageRole: "comic",
  textRole: "review",
  eligibilityConfidence: 0.7,
  automaticAction: "preserve",
  protectionReasons: ["low-confidence"],
};

test("preserved region offers force clean, protect, and automatic actions", () => {
  render(
    <MaskEditor
      sourceUrl="blob:clean"
      maskUrl="blob:mask"
      regions={[preservedRegion]}
      onClose={vi.fn()}
      onRetry={vi.fn().mockResolvedValue(undefined)}
    />,
  );

  expect(
    (screen.getByRole("button", { name: "Force clean" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  expect(
    (screen.getByRole("button", { name: "Protect" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  expect(
    (
      screen.getByRole("button", {
        name: "Reset to automatic",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
  expect(
    screen.getByText("ลบตาม Mask นี้แม้ระบบป้องกันไว้"),
  ).toBeTruthy();
});
