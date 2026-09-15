import { describe, expect, it } from "vitest";
import { inferTextStyleCategory, applyNearbyStyleFallbacks } from "@/lib/colorMatching/nearbyStyleFallback";
import { resolveBubbleTextStyle } from "@/lib/colorMatching/resolveTextStyle";
import type { TranslatedBubble } from "@/lib/translationOverlay";
import type { TextStyleProfile } from "@/lib/colorMatching/types";

describe("Ticket 09: Overlay Subtitle Classification & Readable Safety Path", () => {
  describe("Category Classification & Distinction", () => {
    it("distinguishes overlay_subtitle from dialogue, narration, and sfx", () => {
      const subBubble: TranslatedBubble = {
        box: [800, 100, 880, 700],
        category: "subtitle",
      };
      const dialogueBubble: TranslatedBubble = {
        box: [200, 200, 400, 400],
        category: "dialogue",
      };
      const narrationBubble: TranslatedBubble = {
        box: [50, 50, 150, 300],
        category: "narration",
      };
      const sfxBubble: TranslatedBubble = {
        box: [500, 300, 600, 500],
        category: "sfx",
      };

      expect(inferTextStyleCategory(subBubble)).toBe("overlay_subtitle");
      expect(inferTextStyleCategory(dialogueBubble)).toBe("dialogue");
      expect(inferTextStyleCategory(narrationBubble)).toBe("narration");
      expect(inferTextStyleCategory(sfxBubble)).toBe("sfx");
    });

    it("classifies wide, shallow bottom-placed text regions as overlay_subtitle without cloud calls", () => {
      const wideBottomBubble: TranslatedBubble = {
        // Height: 60, Width: 450 -> aspect ratio 7.5; Ymin: 750 (bottom of panel)
        box: [750, 100, 810, 550],
      };

      expect(inferTextStyleCategory(wideBottomBubble)).toBe("overlay_subtitle");
    });

    it("does NOT reclassify explicit narration or dialogue boxes as overlay_subtitle even if wide", () => {
      const wideNarrationBox: TranslatedBubble = {
        box: [700, 100, 780, 600],
        category: "narration",
      };
      const wideDialogueBox: TranslatedBubble = {
        box: [700, 100, 780, 600],
        category: "dialogue",
      };

      expect(inferTextStyleCategory(wideNarrationBox)).toBe("narration");
      expect(inferTextStyleCategory(wideDialogueBox)).toBe("dialogue");
    });

    it("preserves legacy profiles without cross-inheriting as overlay_subtitle", () => {
      const legacyProfileBubble: TranslatedBubble = {
        box: [750, 100, 810, 550],
        styleProfile: {
          fill: "#111111",
          outline: "#ffffff",
          category: "narration",
          source: "auto",
        },
      };

      expect(inferTextStyleCategory(legacyProfileBubble)).toBe("narration");
    });
  });

  describe("Validated Source vs. Readable Fallback Policy", () => {
    it("preserves a validated overlay_subtitle source profile that passes evidence and readability", () => {
      // e.g. bright yellow subtitle with black outline on complex background
      const validatedProfile: TextStyleProfile = {
        fill: "#ffee00",
        outline: "#000000",
        hasOutline: true,
        outlineWidth: 1.0,
        outlineWidthRatio: 0.18,
        source: "auto",
        evidenceState: "admitted",
        category: "overlay_subtitle",
        fillConfidence: 0.92,
        outlineConfidence: 0.90,
      };

      const bubble: TranslatedBubble = {
        box: [800, 100, 860, 600],
        category: "overlay_subtitle",
        styleProfile: validatedProfile,
      };

      const resolved = resolveBubbleTextStyle(bubble);
      expect(resolved.textColor).toBe("#ffee00");
      expect(resolved.textOutline).toBe("#000000");
      expect(resolved.hasOutline).toBe(true);
      expect(resolved.outlineWidthRatio).toBe(0.18);
      expect(resolved.source).toBe("auto");
    });

    it("degrades an overlay_subtitle candidate that fails evidence validation to readable fallback", () => {
      // Contaminated brown carpet color from surrounding artwork
      const contaminatedProfile: TextStyleProfile = {
        fill: "#8c5028",
        outline: "#8c5028",
        hasOutline: false,
        source: "fallback",
        evidenceState: "rejected",
        fallbackReason: "background-contamination",
        category: "overlay_subtitle",
        fillConfidence: 0.88,
        outlineConfidence: 0.88,
      };

      const bubble: TranslatedBubble = {
        box: [800, 100, 860, 600],
        category: "overlay_subtitle",
        styleProfile: contaminatedProfile,
      };

      const resolved = resolveBubbleTextStyle(bubble);
      // Must NOT render the contaminated brown color!
      expect(resolved.textColor).not.toBe("#8c5028");
      // Default overlay_subtitle readable fallback: white fill, dark outline, explicit outline
      expect(resolved.textColor).toBe("#ffffff");
      expect(resolved.textOutline).toBe("#000000");
      expect(resolved.hasOutline).toBe(true);
      expect(resolved.outlineWidthRatio).toBeGreaterThanOrEqual(0.16);
      expect(resolved.source).toBe("fallback");
    });

    it("degrades an overlay_subtitle candidate that fails readability validation (e.g. no outline, poor contrast)", () => {
      // Source profile with identical fill and outline or no outline over artwork
      const unreadableProfile: TextStyleProfile = {
        fill: "#333333",
        outline: "#333333",
        hasOutline: false,
        source: "auto",
        evidenceState: "unverified",
        category: "overlay_subtitle",
        fillConfidence: 0.75,
        outlineConfidence: 0.75,
      };

      const bubble: TranslatedBubble = {
        box: [800, 100, 860, 600],
        category: "overlay_subtitle",
        styleProfile: unreadableProfile,
      };

      const resolved = resolveBubbleTextStyle(bubble);
      expect(resolved.textColor).toBe("#ffffff");
      expect(resolved.textOutline).toBe("#000000");
      expect(resolved.hasOutline).toBe(true);
      expect(resolved.source).toBe("fallback");
    });

    it("preserves valid plain dialogue with no-outline and does NOT force outline from subtitle policy", () => {
      const dialogueProfile: TextStyleProfile = {
        fill: "#000000",
        outline: "#000000",
        hasOutline: false,
        outlineWidthRatio: 0,
        outlineWidth: 0,
        source: "auto",
        evidenceState: "admitted",
        category: "dialogue",
        fillConfidence: 0.95,
        outlineConfidence: 0.95,
      };

      const bubble: TranslatedBubble = {
        box: [200, 200, 350, 350],
        category: "dialogue",
        styleProfile: dialogueProfile,
      };

      const resolved = resolveBubbleTextStyle(bubble);
      expect(resolved.textColor).toBe("#000000");
      expect(resolved.hasOutline).toBe(false);
      expect(resolved.outlineWidthRatio).toBe(0);
      expect(resolved.source).toBe("auto");
    });

    it("does not allow nearby inheritance between narration and overlay_subtitle", () => {
      const bubbles: TranslatedBubble[] = [
        {
          id: "narration_anchor",
          box: [700, 100, 780, 300],
          category: "narration",
          styleProfile: {
            fill: "#ffffcc",
            outline: "#333300",
            category: "narration",
            fillConfidence: 0.95,
            outlineConfidence: 0.95,
            source: "auto",
          },
        },
        {
          id: "subtitle_target",
          box: [800, 100, 860, 600],
          category: "overlay_subtitle",
          styleProfile: {
            fill: "#000000",
            outline: "#ffffff",
            category: "overlay_subtitle",
            fillConfidence: 0.30,
            outlineConfidence: 0.30,
            source: "global",
          },
        },
      ];

      const result = applyNearbyStyleFallbacks(bubbles);
      // Subtitle must NOT inherit narration style
      expect(result[1].styleProfile?.fill).not.toBe("#ffffcc");
      expect(result[1].styleProfile?.source).toBe("global");
    });
  });
});
