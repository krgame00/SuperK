import { describe, expect, it } from "vitest";
import { applyNearbyStyleFallbacks } from "@/lib/colorMatching/nearbyStyleFallback";
import { resolveBubbleTextStyle } from "@/lib/colorMatching/resolveTextStyle";
import type { TranslatedBubble } from "@/lib/translationOverlay";
import type { TextStyleProfile } from "@/lib/colorMatching/types";

describe("Ticket 10: Validated Fallback Chain & Nearby Admission", () => {
  it("rejects an anchor candidate that has high confidence but failed evidence admission (evidenceState: rejected)", () => {
    const bubbles: TranslatedBubble[] = [
      {
        id: "contaminated_anchor",
        box: [100, 100, 200, 300],
        category: "dialogue",
        styleProfile: {
          fill: "#8c5028", // floor contamination
          outline: "#8c5028",
          fillConfidence: 0.95, // high numeric confidence!
          outlineConfidence: 0.95,
          source: "fallback",
          evidenceState: "rejected",
          fallbackReason: "background-contamination",
          category: "dialogue",
        },
      },
      {
        id: "target_low_conf",
        box: [220, 120, 280, 250],
        category: "dialogue",
        styleProfile: {
          fill: "#000000",
          outline: "#ffffff",
          fillConfidence: 0.35,
          outlineConfidence: 0.35,
          source: "global",
          category: "dialogue",
        },
      },
    ];

    const result = applyNearbyStyleFallbacks(bubbles);
    // target must NOT inherit contaminated style from contaminated_anchor
    expect(result[1].styleProfile?.fill).not.toBe("#8c5028");
    expect(result[1].styleProfile?.nearbySourceId).toBeUndefined();
  });

  it("admits a valid nearby anchor only when source evidence was admitted", () => {
    const bubbles: TranslatedBubble[] = [
      {
        id: "valid_anchor",
        box: [100, 100, 200, 300],
        category: "dialogue",
        styleProfile: {
          fill: "#0064ff",
          outline: "#ffffff",
          hasOutline: true,
          fillConfidence: 0.92,
          outlineConfidence: 0.90,
          source: "auto",
          evidenceState: "admitted",
          category: "dialogue",
        },
      },
      {
        id: "target_low_conf",
        box: [220, 120, 280, 250],
        category: "dialogue",
        styleProfile: {
          fill: "#000000",
          outline: "#ffffff",
          fillConfidence: 0.35,
          outlineConfidence: 0.35,
          source: "global",
          category: "dialogue",
        },
      },
    ];

    const result = applyNearbyStyleFallbacks(bubbles);
    expect(result[1].styleProfile?.fill).toBe("#0064ff");
    expect(result[1].styleProfile?.outline).toBe("#ffffff");
    expect(result[1].styleProfile?.source).toBe("fallback");
    expect(result[1].styleProfile?.fallbackReason).toBe("nearby");
    expect(result[1].styleProfile?.nearbySourceId).toBe("valid_anchor");
  });

  it("does not inherit across category boundaries even if spatially adjacent", () => {
    const bubbles: TranslatedBubble[] = [
      {
        id: "sfx_anchor",
        box: [800, 100, 850, 250],
        category: "sfx",
        styleProfile: {
          fill: "#ff0055",
          outline: "#ffff00",
          hasOutline: true,
          fillConfidence: 0.95,
          source: "auto",
          evidenceState: "admitted",
          category: "sfx",
        },
      },
      {
        id: "subtitle_target",
        box: [810, 120, 860, 550], // directly overlapping!
        category: "overlay_subtitle",
        styleProfile: {
          fill: "#000000",
          outline: "#ffffff",
          fillConfidence: 0.35,
          source: "global",
          category: "overlay_subtitle",
        },
      },
    ];

    const result = applyNearbyStyleFallbacks(bubbles);
    expect(result[1].styleProfile?.fill).not.toBe("#ff0055");
    expect(result[1].styleProfile?.source).toBe("global");
  });

  it("rejects nearby inheritance if the anchor style is unreadable for target category", () => {
    // Dialogue anchor has no outline (valid for dialogue), but target is overlay_subtitle (which requires outline for variable artwork)
    const bubbles: TranslatedBubble[] = [
      {
        id: "dialogue_no_outline",
        box: [750, 100, 800, 250],
        category: "overlay_subtitle", // both same category
        styleProfile: {
          fill: "#333333",
          outline: "#333333",
          hasOutline: false, // unreadable for subtitle over artwork!
          fillConfidence: 0.90,
          source: "auto",
          evidenceState: "admitted",
          category: "overlay_subtitle",
        },
      },
      {
        id: "subtitle_target",
        box: [820, 100, 870, 500],
        category: "overlay_subtitle",
        styleProfile: {
          fill: "#000000",
          outline: "#ffffff",
          fillConfidence: 0.30,
          source: "global",
          category: "overlay_subtitle",
        },
      },
    ];

    const result = applyNearbyStyleFallbacks(bubbles);
    // Should NOT inherit unreadable style with no outline
    expect(result[1].styleProfile?.hasOutline).not.toBe(false);
  });

  it("preserves explicit fallback provenance (rejection reason) when no nearby candidate survives", () => {
    const bubbles: TranslatedBubble[] = [
      {
        id: "isolated_bubble",
        box: [800, 100, 860, 600],
        category: "overlay_subtitle",
        styleProfile: {
          fill: "#8c5028",
          outline: "#8c5028",
          fillConfidence: 0.85,
          outlineConfidence: 0.85,
          source: "fallback",
          evidenceState: "rejected",
          fallbackReason: "background-contamination",
          category: "overlay_subtitle",
        },
      },
    ];

    const result = applyNearbyStyleFallbacks(bubbles);
    expect(result[0].styleProfile?.source).toBe("fallback");
    expect(result[0].styleProfile?.evidenceState).toBe("rejected");
    expect(result[0].styleProfile?.fallbackReason).toBe("background-contamination");

    const resolved = resolveBubbleTextStyle(result[0]);
    expect(resolved.source).toBe("fallback");
    expect(resolved.textColor).toBe("#ffffff"); // readable fallback
    expect(resolved.textOutline).toBe("#000000");
  });
});
