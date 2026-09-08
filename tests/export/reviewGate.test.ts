import { describe, expect, it } from "vitest";

import {
  doesPageRequireReview,
  getUnconfirmedPages,
  isPageCleaningUncertain,
  isPageTranslationUncertain,
} from "@/lib/export/reviewGate";
import type { PageCleaningResult } from "@/hooks/useCleaning";
import type { TranslatedBubble } from "@/lib/translationOverlay";

describe("Review Gate & Human Confirmation for Exports (Ticket 07)", () => {
  const sampleCleaningResult: PageCleaningResult = {
    jobId: "job-1",
    sourceHash: "hash-1",
    width: 1000,
    height: 1400,
    cleanAsset: "/v1/clean.png",
    maskAsset: "/v1/mask.png",
    reviewMaskAsset: "/v1/review.png",
    protectedMaskAsset: "/v1/protected.png",
    cleanUrl: "blob:clean-1",
    maskUrl: "blob:mask-1",
    reviewMaskUrl: "blob:review-1",
    protectedMaskUrl: "blob:protected-1",
    timingsMs: {},
    regions: [
      {
        id: "reg-1",
        rect: { x: 10, y: 10, width: 50, height: 50 },
        route: "artwork",
        confidence: 0.5,
        status: "needs_review",
        residualScore: 0.8,
        damageScore: 0.3,
        pageRole: "comic",
        textRole: "review",
        eligibilityConfidence: 0.5,
        automaticAction: "clean",
        protectionReasons: ["low-confidence"],
      },
    ],
  };

  it("detects uncertain cleaning based on needs_review or low confidence", () => {
    expect(isPageCleaningUncertain(sampleCleaningResult)).toBe(true);

    const readyCleaning: PageCleaningResult = {
      ...sampleCleaningResult,
      regions: [
        {
          ...sampleCleaningResult.regions[0],
          status: "ready",
          textRole: "dialogue",
          confidence: 0.95,
          protectionReasons: [],
        },
      ],
    };
    expect(isPageCleaningUncertain(readyCleaning)).toBe(false);
  });

  it("detects uncertain translation based on low-confidence or needsReview flag", () => {
    const normalBubbles: TranslatedBubble[] = [
      { box: [0, 0, 50, 50], t: "มั่นใจ", confidence: 0.95 },
    ];
    expect(isPageTranslationUncertain(normalBubbles)).toBe(false);

    const uncertainBubbles: TranslatedBubble[] = [
      { box: [0, 0, 50, 50], t: "ไม่แน่ใจ", confidence: 0.4 },
    ];
    expect(isPageTranslationUncertain(uncertainBubbles)).toBe(true);

    const flaggedBubbles: TranslatedBubble[] = [
      { box: [0, 0, 50, 50], t: "ต้องตรวจ", needsReview: true },
    ];
    expect(isPageTranslationUncertain(flaggedBubbles)).toBe(true);
  });

  it("evaluates whether a page requires review before export", () => {
    expect(doesPageRequireReview(sampleCleaningResult, [])).toBe(true);
    expect(doesPageRequireReview(null, [{ t: "ok", confidence: 0.95 }])).toBe(false);
  });

  it("blocks export by returning unconfirmed pages and unblocks when confirmed", () => {
    const pages = [
      { url: "blob:page-1", name: "Page 1" },
      { url: "blob:page-2", name: "Page 2" },
    ];
    const confirmedPages = new Set<string>();
    const cleaningMap = new Map<string, PageCleaningResult>([
      ["blob:page-1", sampleCleaningResult],
    ]);
    const bubblesMap = new Map<string, TranslatedBubble[]>([
      ["blob:page-1", [{ t: "p1", confidence: 0.9 }]],
      ["blob:page-2", [{ t: "p2", confidence: 0.95 }]],
    ]);

    // Page 1 has uncertain cleaning and is unconfirmed
    const unconfirmed = getUnconfirmedPages(
      pages,
      confirmedPages,
      cleaningMap,
      bubblesMap,
    );
    expect(unconfirmed.length).toBe(1);
    expect(unconfirmed[0].pageUrl).toBe("blob:page-1");
    expect(unconfirmed[0].hasUncertainCleaning).toBe(true);

    // When reviewer confirms page 1:
    confirmedPages.add("blob:page-1");
    const afterConfirm = getUnconfirmedPages(
      pages,
      confirmedPages,
      cleaningMap,
      bubblesMap,
    );
    expect(afterConfirm.length).toBe(0);

    // When reviewer or translator edits page 1, confirmation is reset:
    confirmedPages.delete("blob:page-1");
    const afterMutation = getUnconfirmedPages(
      pages,
      confirmedPages,
      cleaningMap,
      bubblesMap,
    );
    expect(afterMutation.length).toBe(1);
  });
});
