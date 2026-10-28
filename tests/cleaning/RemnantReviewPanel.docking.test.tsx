import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { RemnantReviewPanel } from "@/components/cleaning/RemnantReviewPanel";
import type { BackgroundInspectionResult, RemnantCandidate } from "@/lib/cleaning/backgroundRemnantInspection";
import type { CleaningRegion } from "@/lib/cleaning/types";

const mockRegion: CleaningRegion = {
  id: "region-1",
  rect: { x: 16, y: 20, width: 28, height: 18 },
  route: "flat",
  confidence: 0.9,
  status: "ready",
  residualScore: 0,
  damageScore: 0,
  pageRole: "comic",
  textRole: "dialogue",
  eligibilityConfidence: 0.8,
  automaticAction: "clean",
  protectionReasons: [],
};

const mockCandidate: RemnantCandidate = {
  id: "rem-1",
  state: "suspected-remnant",
  detail: "full-glyph",
  rect: { x: 20, y: 24, width: 20, height: 10 },
  box: [375, 312, 531, 625],
  confidence: 0.9,
  evidence: {
    removalRegionIds: ["region-1"],
    textEvidenceIds: [],
    originalInkPixels: 200,
    survivingInkPixels: 200,
    meanLumaOriginal: 40,
    meanLumaClean: 40,
  },
};

const mockInspection: BackgroundInspectionResult = {
  status: "inspected",
  revisionKey: "rk-1",
  revisions: { sourceRevision: "src", backgroundRevision: "bg", removalRevision: "rem" },
  candidates: [mockCandidate],
  inspectedAreas: 1,
};

describe("RemnantReviewPanel Docking & Non-Overlap", () => {
  test("shifts down when toolbarPosition='top' and isPageReviewRequired=true to clear PageReviewNotice", () => {
    render(
      <RemnantReviewPanel
        inspection={mockInspection}
        regions={[mockRegion]}
        toolbarPosition="top"
        isPageReviewRequired={true}
      />
    );

    const panel = screen.getByTestId("remnant-review-findings");
    expect(panel.className).toContain("top-[168px]");
    expect(panel.className).toContain("sm:top-[172px]");
  });

  test("uses top-14 sm:top-16 when toolbarPosition='bottom'", () => {
    render(
      <RemnantReviewPanel
        inspection={mockInspection}
        regions={[mockRegion]}
        toolbarPosition="bottom"
      />
    );

    const panel = screen.getByTestId("remnant-review-findings");
    expect(panel.className).toContain("top-14");
    expect(panel.className).toContain("sm:top-16");
  });

  test("uses default top-28 sm:top-32 when isPageReviewRequired=false", () => {
    render(
      <RemnantReviewPanel
        inspection={mockInspection}
        regions={[mockRegion]}
        toolbarPosition="top"
        isPageReviewRequired={false}
      />
    );

    const panel = screen.getByTestId("remnant-review-findings");
    expect(panel.className).toContain("top-28");
    expect(panel.className).toContain("sm:top-32");
  });
});
