import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { MaskLegend } from "@/components/cleaning/MaskLegend";
import type { CleaningRegion } from "@/lib/cleaning/types";

const regions: CleaningRegion[] = [
  {
    id: "clean",
    rect: { x: 0, y: 0, width: 10, height: 10 },
    route: "flat",
    confidence: 1,
    status: "repaired",
    residualScore: 0,
    damageScore: 0,
    pageRole: "comic",
    textRole: "dialogue",
    eligibilityConfidence: 0.95,
    automaticAction: "clean",
    protectionReasons: [],
  },
  {
    id: "review",
    rect: { x: 20, y: 0, width: 10, height: 10 },
    route: "flat",
    confidence: 1,
    status: "preserved",
    residualScore: 0,
    damageScore: 0,
    pageRole: "comic",
    textRole: "review",
    eligibilityConfidence: 0.6,
    automaticAction: "preserve",
    protectionReasons: ["low-confidence"],
  },
  {
    id: "protected",
    rect: { x: 40, y: 0, width: 10, height: 10 },
    route: "flat",
    confidence: 1,
    status: "preserved",
    residualScore: 0,
    damageScore: 0,
    pageRole: "comic",
    textRole: "protected",
    eligibilityConfidence: 1,
    automaticAction: "preserve",
    protectionReasons: ["qr"],
  },
];

test("summarizes clean, review, and protected regions", () => {
  render(<MaskLegend regions={regions} />);

  expect(screen.getByText("หน้าการ์ตูน")).toBeTruthy();
  expect(screen.getByText("พื้นที่ที่จะลบ 1")).toBeTruthy();
  expect(screen.getByText("ควรตรวจ 1")).toBeTruthy();
  expect(screen.getByText("เก็บภาพเดิม 1")).toBeTruthy();
});
