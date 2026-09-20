import { describe, expect, it } from "vitest";
import {
  resolveBubbleTextStyle,
  selectAdaptiveReadableStyle,
} from "@/lib/colorMatching/resolveTextStyle";
import type { TranslatedBubble } from "@/lib/translationOverlay";
import type { TextStyleProfile } from "@/lib/colorMatching/types";

function parseRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace(/^#/, "");
  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16),
  };
}

function getHue(hex: string): number {
  const { r, g, b } = parseRgb(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  if (d === 0) return 0;
  let h = 0;
  if (max === rn) {
    h = ((gn - bn) / d) % 6;
  } else if (max === gn) {
    h = (bn - rn) / d + 2;
  } else {
    h = (rn - gn) / d + 4;
  }
  h = Math.round(h * 60);
  if (h < 0) h += 360;
  return h;
}

describe("Ticket 20: Background-Aware Binary Readability Gate", () => {
  describe("Preferred Pair Rejection & Alternate Binary Fill Selection", () => {
    it("uses white fill with strengthened cyan source outline on white/bright speech balloon", () => {
      // Source text has bright cyan accent (#00e5ff) inside a bright white speech balloon (bgLum = 245).
      const style = selectAdaptiveReadableStyle({
        sourceAccentColor: "#00e5ff",
        backgroundLuminance: 245,
        backgroundColor: "#ffffff",
        backgroundLuminanceSamples: [240, 245, 250, 248, 242],
      });

      // White fill is preserved and outline is strengthened cyan (darkened with hue preserved)
      expect(style.textColor).toBe("#ffffff");
      expect(style.hasOutline).toBe(true);
      const hue = getHue(style.textOutline);
      expect(hue).toBeGreaterThan(170);
      expect(hue).toBeLessThan(200);
    });

    it("uses white fill with dark outline on dark panel", () => {
      // Source text has dark slate accent (#1a1a2e) over a dark night panel (bgLum = 30).
      const style = selectAdaptiveReadableStyle({
        sourceAccentColor: "#1a1a2e",
        backgroundLuminance: 30,
        backgroundColor: "#121820",
        backgroundLuminanceSamples: [25, 30, 35, 28, 32],
      });

      expect(style.textColor).toBe("#ffffff");
      expect(style.hasOutline).toBe(true);
      expect(style.textOutline).not.toBe("#ffffff");
    });

    it("accepts bright-accent white-fill preference on dark/artwork backgrounds", () => {
      // Source text has bright cyan accent (#00e5ff) over dark background (bgLum = 40).
      const style = selectAdaptiveReadableStyle({
        sourceAccentColor: "#00e5ff",
        backgroundLuminance: 40,
        backgroundColor: "#202028",
        backgroundLuminanceSamples: [35, 40, 45, 38, 42],
      });

      // White fill + strengthened cyan outline has strong contrast against dark background.
      expect(style.textColor).toBe("#ffffff");
      expect(style.hasOutline).toBe(true);
      const hue = getHue(style.textOutline);
      expect(hue).toBeGreaterThan(170);
      expect(hue).toBeLessThan(200);
    });

    it("uses white fill with safe dark outline for dark accent on bright background", () => {
      // Source text has dark accent (#111827) on bright speech balloon (bgLum = 240).
      const style = selectAdaptiveReadableStyle({
        sourceAccentColor: "#111827",
        backgroundLuminance: 240,
        backgroundColor: "#ffffff",
      });

      expect(style.textColor).toBe("#ffffff");
      expect(style.hasOutline).toBe(true);
      expect(style.textOutline).not.toBe("#ffffff");
    });
  });

  describe("Mixed Background & Weak-Region Evaluation", () => {
    it("evaluates weak local regions on mixed background and escalates outline ratio", () => {
      // Mixed background with high average (196) but a dark patch (25-30)
      const style = selectAdaptiveReadableStyle({
        backgroundLuminance: 196,
        backgroundLuminanceSamples: [245, 250, 240, 235, 30, 25],
        category: "dialogue",
      });

      expect(style.textColor).toBe("#ffffff");
      expect(style.hasOutline).toBe(true);
      // Escalated outline (0.16–0.20) to ensure legibility across the dark patch
      expect(style.outlineWidthRatio).toBeGreaterThanOrEqual(0.16);
      expect(style.outlineWidthRatio).toBeLessThanOrEqual(0.20);
    });

    it("caps outline width ratio at 0.20 to protect Thai vowel counters and tone marks", () => {
      const extremeMixed = selectAdaptiveReadableStyle({
        backgroundLuminance: 128,
        backgroundLuminanceSamples: [0, 255, 0, 255, 0, 255, 0, 255],
      });

      expect(extremeMixed.hasOutline).toBe(true);
      expect(extremeMixed.outlineWidthRatio).toBeLessThanOrEqual(0.20);
      expect(extremeMixed.outlineWidthRatio).toBeGreaterThanOrEqual(0.16);
    });
  });

  describe("Escalation & Safety Hierarchy", () => {
    it("never gives automatic background plate to dialogue or narration, flagging reviewRequired instead", () => {
      const dialogueStyle = selectAdaptiveReadableStyle({
        backgroundLuminance: 128,
        category: "dialogue",
        requiresPlateEscalation: true,
      });

      expect(dialogueStyle.backgroundPlate).toBeUndefined();
      expect(dialogueStyle.reviewRequired).toBe(true);

      const narrationStyle = selectAdaptiveReadableStyle({
        backgroundLuminance: 128,
        category: "narration",
        requiresPlateEscalation: true,
      });

      expect(narrationStyle.backgroundPlate).toBeUndefined();
      expect(narrationStyle.reviewRequired).toBe(true);
    });

    it("permits emergency background plate ONLY for overlay_subtitle when requested", () => {
      const subtitleStyle = selectAdaptiveReadableStyle({
        backgroundLuminance: 128,
        category: "overlay_subtitle",
        requiresPlateEscalation: true,
      });

      expect(subtitleStyle.backgroundPlate).toBeDefined();
      expect(subtitleStyle.backgroundPlate?.opacity).toBeGreaterThan(0.5);
      expect(subtitleStyle.reviewRequired).toBeUndefined();
    });
  });

  describe("Strict Binary Fill Contract", () => {
    it("guarantees fill is strictly pure white (#ffffff) or pure black (#000000) across all background scenarios", () => {
      const scenarios = [
        { bgLum: 10, accent: "#ff007f" },
        { bgLum: 50, accent: "#00ffff" },
        { bgLum: 100, accent: "#ffea00" },
        { bgLum: 140, accent: "#3b82f6" },
        { bgLum: 180, accent: "#10b981" },
        { bgLum: 220, accent: "#ffc0cb" },
        { bgLum: 255, accent: "#ffffff" },
        { bgLum: 255, accent: "#000000" },
      ];

      for (const { bgLum, accent } of scenarios) {
        const style = selectAdaptiveReadableStyle({
          backgroundLuminance: bgLum,
          sourceAccentColor: accent,
        });
        expect(["#ffffff", "#000000"]).toContain(style.textColor);
        expect(style.hasOutline).toBe(true);
      }
    });
  });

  describe("resolveBubbleTextStyle Integration", () => {
    it("does not reuse a rejected source accent and falls back to a safe dark outline", () => {
      const bubble: TranslatedBubble = {
        id: "bubble_cyan_on_white",
        box: [100, 100, 200, 300],
        t: "ข้อความบนบอลลูนขาว",
        styleProfile: {
          sourceAccentColor: "#00ffff", // Candidate color was detected, but evidence rejected it.
          fill: "#00ffff",
          outline: "#ffffff",
          source: "fallback",
          fallbackReason: "low-readability",
          evidenceState: "rejected",
          fillConfidence: 0.52,
          outlineConfidence: 0.48,
          backgroundLuminance: 245,
          backgroundColor: "#ffffff",
        } as TextStyleProfile,
      };

      const resolved = resolveBubbleTextStyle(bubble);
      expect(resolved.textColor).toBe("#ffffff");
      expect(resolved.hasOutline).toBe(true);
      expect(resolved.textOutline).toBe("#000000");
    });
  });
});
