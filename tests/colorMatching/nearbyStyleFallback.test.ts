import { describe, expect, it } from "vitest";
import { applyNearbyStyleFallbacks } from "@/lib/colorMatching/nearbyStyleFallback";
import type { TranslatedBubble } from "@/lib/translationOverlay";

describe("nearbyStyleFallback spatial style inheritance", () => {
  it("leaves high-confidence auto-matched bubbles untouched", () => {
    const bubbles: TranslatedBubble[] = [
      {
        id: "b1",
        t: "ข้อความสีชมพู",
        box: [100, 100, 200, 300],
        styleProfile: {
          fill: "#ff2a85",
          outline: "#ffffff",
          fillConfidence: 0.95,
          outlineConfidence: 0.90,
          source: "auto",
        },
      },
    ];

    const result = applyNearbyStyleFallbacks(bubbles);
    expect(result[0].styleProfile?.fill).toBe("#ff2a85");
    expect(result[0].styleProfile?.source).toBe("auto");
  });

  it("propagates style to a nearby low-confidence bubble in the same panel", () => {
    const bubbles: TranslatedBubble[] = [
      {
        id: "anchor",
        t: "บับเบิลหลักสีฟ้า",
        box: [100, 100, 250, 350],
        styleProfile: {
          fill: "#00b4d8",
          outline: "#03045e",
          fillConfidence: 0.92,
          outlineConfidence: 0.88,
          source: "auto",
        },
      },
      {
        id: "small_nearby",
        t: "!",
        box: [260, 120, 300, 180], // nearby within 100 distance units
        styleProfile: {
          fill: "#000000",
          outline: "#ffffff",
          fillConfidence: 0.40,
          outlineConfidence: 0.50,
          source: "global",
        },
      },
    ];

    const result = applyNearbyStyleFallbacks(bubbles);
    const smallBubbleProfile = result[1].styleProfile;

    expect(smallBubbleProfile?.fill).toBe("#00b4d8");
    expect(smallBubbleProfile?.outline).toBe("#03045e");
    expect(smallBubbleProfile?.source).toBe("fallback");
    expect(smallBubbleProfile?.nearbySourceId).toBe("anchor");
    expect(smallBubbleProfile?.fillConfidence).toBeGreaterThanOrEqual(0.70);
  });

  it("does not inherit style if the distance exceeds maximum panel threshold", () => {
    const bubbles: TranslatedBubble[] = [
      {
        id: "anchor_top",
        t: "บนสุดของหน้า",
        box: [50, 50, 100, 200], // top left
        styleProfile: {
          fill: "#ff5500",
          outline: "#000000",
          fillConfidence: 0.95,
          outlineConfidence: 0.90,
          source: "auto",
        },
      },
      {
        id: "far_bottom",
        t: "ล่างสุดของหน้า",
        box: [850, 850, 950, 950], // bottom right (> 1000 distance units away)
        styleProfile: {
          fill: "#000000",
          outline: "#ffffff",
          fillConfidence: 0.40,
          outlineConfidence: 0.40,
          source: "global",
        },
      },
    ];

    const result = applyNearbyStyleFallbacks(bubbles, { maxDistanceThreshold: 300 });
    const farBubbleProfile = result[1].styleProfile;

    // Should NOT inherit from anchor_top because it is too far
    expect(farBubbleProfile?.source).toBe("global");
    expect(farBubbleProfile?.fill).toBe("#000000");
  });

  it("handles empty or deleted bubbles gracefully", () => {
    const bubbles: TranslatedBubble[] = [
      { id: "del", t: "deleted", deleted: true, box: [100, 100, 200, 200] },
    ];
    const result = applyNearbyStyleFallbacks(bubbles);
    expect(result.length).toBe(1);
  });
});
