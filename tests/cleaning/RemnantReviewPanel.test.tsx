import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { RemnantReviewPanel } from "@/components/cleaning/RemnantReviewPanel";
import type {
  BackgroundInspectionResult,
  RemnantCandidate,
} from "@/lib/cleaning/backgroundRemnantInspection";
import type { CleaningRegion } from "@/lib/cleaning/types";

const region: CleaningRegion = {
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

const farRegion: CleaningRegion = {
  ...region,
  id: "region-2",
  rect: { x: 300, y: 300, width: 20, height: 20 },
};

function candidate(overrides: Partial<RemnantCandidate> = {}): RemnantCandidate {
  return {
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
    ...overrides,
  };
}

function inspected(candidates: RemnantCandidate[]): BackgroundInspectionResult {
  return {
    status: "inspected",
    revisionKey: "rk-1",
    revisions: { sourceRevision: "src", backgroundRevision: "bg", removalRevision: "rem" },
    candidates,
    inspectedAreas: 1,
  };
}

describe("RemnantReviewPanel", () => {
  test("shows inspected empty findings without claiming perfect text recognition", () => {
    render(<RemnantReviewPanel inspection={inspected([])} regions={[region]} />);
    expect(screen.getByRole("status")).toHaveTextContent("ไม่พบจุดสงสัย");
    expect(screen.getByRole("status")).toHaveTextContent("ขอบเขต");
  });
  test("lists an open finding with its page location and offers both resolutions", () => {
    const onOpenMask = vi.fn();
    const onConfirmArtwork = vi.fn();
    render(
      <RemnantReviewPanel
        inspection={inspected([candidate()])}
        regions={[region]}
        onOpenMask={onOpenMask}
        onConfirmArtwork={onConfirmArtwork}
      />,
    );

    const item = screen.getByTestId("remnant-candidate-rem-1");
    expect(item).toBeInTheDocument();
    // Original/clean evidence for the same location is shown honestly.
    expect(item).toHaveTextContent("40");
    expect(item).toHaveTextContent("200");

    fireEvent.click(screen.getByRole("button", { name: "แก้ Mask ที่จุดนี้" }));
    expect(onOpenMask).toHaveBeenCalledWith(expect.objectContaining({ id: "rem-1" }), region);

    fireEvent.click(screen.getByRole("button", { name: "ยืนยันเป็นลายภาพ" }));
    expect(onConfirmArtwork).toHaveBeenCalledWith(expect.objectContaining({ id: "rem-1" }));
  });

  test("disables mask navigation when no authorized removal region covers the finding", () => {
    const onOpenMask = vi.fn();
    render(
      <RemnantReviewPanel
        inspection={inspected([candidate()])}
        regions={[farRegion]}
        onOpenMask={onOpenMask}
      />,
    );
    expect(screen.getByRole("button", { name: "แก้ Mask ที่จุดนี้" })).toBeDisabled();
    expect(onOpenMask).not.toHaveBeenCalled();
  });

  test("shows a human-confirmed candidate as resolved without a confirm action", () => {
    render(
      <RemnantReviewPanel
        inspection={inspected([
          candidate({
            state: "human-confirmed-artwork",
            artworkConfirmation: { candidateId: "rem-1", revisionKey: "rk-1" },
          }),
        ])}
        regions={[region]}
        onOpenMask={vi.fn()}
        onConfirmArtwork={vi.fn()}
      />,
    );
    expect(screen.getByTestId("remnant-candidate-rem-1")).toHaveTextContent("ยืนยันลายภาพแล้ว");
    expect(screen.queryByRole("button", { name: "ยืนยันเป็นลายภาพ" })).not.toBeInTheDocument();
  });

  test("presents unverified evidence as needing human image inspection, never clean", () => {
    const onRecheck = vi.fn();
    render(
      <RemnantReviewPanel
        inspection={{
          status: "unverified",
          unverifiedReason: "missing-original",
          unverifiedDetail: "Both the original and the clean background are required.",
          revisionKey: "rk-1",
          revisions: { sourceRevision: "src", backgroundRevision: "bg", removalRevision: "rem" },
          candidates: [],
          inspectedAreas: 0,
        }}
        regions={[region]}
        onRecheck={onRecheck}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("ตรวจสอบภาพด้วยตนเอง");
    // Must never claim the background is clean when evidence is missing.
    expect(alert.textContent).not.toMatch(/ไม่พบเศษข้อความ|ไม่มีเศษข้อความ|สะอาดแล้ว/);
    fireEvent.click(screen.getByRole("button", { name: "ตรวจสอบอีกครั้ง" }));
    expect(onRecheck).toHaveBeenCalledOnce();
  });

  test("renders nothing without inspection evidence", () => {
    const { container } = render(<RemnantReviewPanel regions={[region]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
