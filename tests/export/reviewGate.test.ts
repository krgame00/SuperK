import { describe, expect, it } from "vitest";

import {
  doesPageRequireReview,
  getUnconfirmedPages,
  missingTranslationSignature,
  isPageCleaningUncertain,
  isPageTranslationUncertain,
} from "@/lib/export/reviewGate";
import type { PageCleaningResult } from "@/hooks/useCleaning";
import type { TranslatedBubble } from "@/lib/translationOverlay";

describe("Review Gate & Human Confirmation for Exports (Ticket 07)", () => {
  it("requires a fresh snapshot for unresolved semantic suggestions", () => {
    const pages=[{url:"page",name:"Page"}];
    const bubble: TranslatedBubble={t:"รอ",original_text:"Wait.",translationReview:{status:"suggested",sourceText:"Wait.",reviewedText:"รอ",suggestion:"รอก่อนนะ"}};
    const bubbles=new Map([["page",[bubble]]]);
    const confirmed=new Set(["page"]);
    expect(isPageTranslationUncertain([bubble])).toBe(true);
    expect(getUnconfirmedPages(pages,confirmed,new Map(),bubbles)).toHaveLength(1);
    const signatures=new Map([["page",missingTranslationSignature(null,[bubble])]]);
    expect(getUnconfirmedPages(pages,confirmed,new Map(),bubbles,undefined,signatures)).toHaveLength(0);
    bubble.translationReview!.suggestion="รอที่นี่";
    expect(getUnconfirmedPages(pages,confirmed,new Map(),bubbles,undefined,signatures)).toHaveLength(1);
    bubble.translationReview!.status="dismissed";
    expect(isPageTranslationUncertain([bubble])).toBe(false);
    bubble.t="ไป";
    expect(isPageTranslationUncertain([bubble])).toBe(true);
    bubble.deleted=true;
    expect(isPageTranslationUncertain([bubble])).toBe(false);
  });
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
      ["blob:page-1", [{ box: [7, 10, 43, 60], t: "p1", confidence: 0.9 }]],
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

  const readyCleaning = (x = 100): PageCleaningResult => ({
    ...sampleCleaningResult,
    regions: [{
      ...sampleCleaningResult.regions[0],
      rect: { x, y: 140, width: 100, height: 140 },
      status: "ready", textRole: "dialogue", confidence: 0.95,
      protectionReasons: [],
    }],
  });

  it("requires review for uncovered detected text despite high confidence", () => {
    const cleaning = readyCleaning();
    const bubbles = [{ box: [400, 400, 500, 500], t: "Elsewhere", confidence: 0.99 }];
    expect(doesPageRequireReview(cleaning, bubbles)).toBe(true);
    const result = getUnconfirmedPages([{ url: "page", name: "Restored" }], new Set(),
      new Map([["page", cleaning]]), new Map([["page", bubbles]]));
    expect(result[0]).toMatchObject({ missingTranslationCount: 1, hasUncertainCleaning: false, hasUncertainTranslation: false });
  });

  it("checks current bubble geometry, ignores protected text and intentional manual deletions", () => {
    const cleaning = readyCleaning();
    expect(doesPageRequireReview(cleaning, [{ box: [100, 100, 200, 200], t: "Covered" }])).toBe(false);
    expect(doesPageRequireReview(cleaning, [{ box: [0, 0, 1000, 1000], t: "Invalid" }])).toBe(true);
    expect(doesPageRequireReview(cleaning, [{ box: [100, 100, 200, 200], t: "", deleted: true, isManual: true }])).toBe(false);
    const protectedCleaning = { ...cleaning, regions: [{ ...cleaning.regions[0], textRole: "protected" as const }] };
    expect(doesPageRequireReview(protectedCleaning, [])).toBe(false);
  });

  it("accepts an explicit omission snapshot and reopens review for new omissions with the same count", () => {
    const pages = [{ url: "page", name: "Page" }];
    const confirmed = new Set(["page"]);
    const cleaning = readyCleaning();
    const cleaningMap = new Map([["page", cleaning]]);
    const bubblesMap = new Map<string, TranslatedBubble[]>();
    // An old confirmation without an omission snapshot cannot approve newly found missing text.
    expect(getUnconfirmedPages(pages, confirmed, cleaningMap, bubblesMap)).toHaveLength(1);
    const signatures = new Map([["page", missingTranslationSignature(cleaning, [])]]);
    expect(getUnconfirmedPages(pages, confirmed, cleaningMap, bubblesMap, undefined, signatures)).toHaveLength(0);
    cleaningMap.set("page", readyCleaning(400));
    expect(getUnconfirmedPages(pages, confirmed, cleaningMap, bubblesMap, undefined, signatures)).toHaveLength(1);
    signatures.set("page", missingTranslationSignature(cleaningMap.get("page"), []));
    expect(getUnconfirmedPages(pages, confirmed, cleaningMap, bubblesMap, undefined, signatures)).toHaveLength(0);
    confirmed.clear();
    expect(getUnconfirmedPages(pages, confirmed, cleaningMap, bubblesMap, undefined, signatures)).toHaveLength(1);
  });

  it("limits omission review to selected export pages", () => {
    const pages = [{ url: "one", name: "One" }, { url: "two", name: "Two" }];
    const cleaningMap = new Map([["one", readyCleaning()], ["two", readyCleaning()]]);
    const result = getUnconfirmedPages(pages, new Set(), cleaningMap, new Map(), [1]);
    expect(result.map(page => page.pageUrl)).toEqual(["two"]);
    expect(result[0].missingTranslationCount).toBe(1);
  });
});
