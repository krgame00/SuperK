import { describe, expect, it } from "vitest";
import {
  classifyAccentLuminance,
  deriveSourceAccentColor,
  resolveBubbleTextStyle,
  selectAdaptiveReadableStyle,
  strengthenSourceAccentOutline,
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

function getLuminance(hex: string): number {
  const { r, g, b } = parseRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

describe("Ticket 19: Brightness Classification & Outline Strengthening", () => {
  describe("deriveSourceAccentColor", () => {
    it("extracts chromatic outline from profile evidence", () => {
      const profile: TextStyleProfile = {
        fill: "#ffffff",
        outline: "#ff007f", // chromatic rose
        hasOutline: true,
        source: "auto",
      };
      expect(deriveSourceAccentColor(profile)).toBe("#ff007f");
    });

    it("extracts chromatic fill when outline is absent or neutral", () => {
      const profile: TextStyleProfile = {
        fill: "#3b82f6", // chromatic blue
        outline: "#ffffff",
        hasOutline: false,
        source: "auto",
      };
      expect(deriveSourceAccentColor(profile)).toBe("#3b82f6");
    });

    it("does NOT use surrounding background color as accent", () => {
      const profile: TextStyleProfile = {
        fill: "#ffffff",
        outline: "#ffffff",
        backgroundColor: "#ff5500", // background contamination
        source: "fallback",
        fallbackReason: "background-contamination",
      };
      const accent = deriveSourceAccentColor(profile);
      expect(accent?.toLowerCase()).not.toBe("#ff5500");
    });
  });

  describe("classifyAccentLuminance", () => {
    it("classifies light and bright colors as 'bright'", () => {
      expect(classifyAccentLuminance("#00ffff")).toBe("bright"); // Cyan (~178)
      expect(classifyAccentLuminance("#ffeb3b")).toBe("bright"); // Yellow (~217)
      expect(classifyAccentLuminance("#ffc0cb")).toBe("bright"); // Pink (~208)
      expect(classifyAccentLuminance("#ffffff")).toBe("bright"); // Pure White (255)
    });

    it("classifies dark and near-black colors as 'dark'", () => {
      expect(classifyAccentLuminance("#000033")).toBe("dark"); // Deep navy (~6)
      expect(classifyAccentLuminance("#1f2937")).toBe("dark"); // Dark gray (~41)
      expect(classifyAccentLuminance("#3b1010")).toBe("dark"); // Dark maroon (~31)
      expect(classifyAccentLuminance("#000000")).toBe("dark"); // Pure Black (0)
    });

    it("classifies ambiguous mid-tones as 'ambiguous'", () => {
      expect(classifyAccentLuminance("#3b82f6")).toBe("ambiguous"); // Blue (~130)
      expect(classifyAccentLuminance("#10b981")).toBe("ambiguous"); // Emerald (~146)
      expect(classifyAccentLuminance("#8b5cf6")).toBe("ambiguous"); // Violet (~117)
    });
  });

  describe("strengthenSourceAccentOutline", () => {
    it("darkens pastel pink while preserving its red/pink hue", () => {
      const pastelPink = "#ffc0cb";
      const originalHue = getHue(pastelPink);
      const strengthened = strengthenSourceAccentOutline(pastelPink, "#ffffff");

      expect(getLuminance(strengthened)).toBeLessThan(140);
      const newHue = getHue(strengthened);
      // Hue should remain in the red/pink region (within +/- 15 deg)
      const hueDiff = Math.abs(originalHue - newHue);
      expect(hueDiff <= 15 || hueDiff >= 345).toBe(true);
    });

    it("darkens light cyan while preserving cyan/teal hue", () => {
      const lightCyan = "#e0ffff";
      const originalHue = getHue(lightCyan);
      const strengthened = strengthenSourceAccentOutline(lightCyan, "#ffffff");

      expect(getLuminance(strengthened)).toBeLessThan(140);
      const newHue = getHue(strengthened);
      const hueDiff = Math.abs(originalHue - newHue);
      expect(hueDiff <= 15 || hueDiff >= 345).toBe(true);
    });

    it("falls back to safe neutral outline if color has no separation or saturation", () => {
      const pureWhite = "#ffffff";
      const strengthened = strengthenSourceAccentOutline(pureWhite, "#ffffff");
      expect(strengthened.toLowerCase()).toBe("#000000");
    });
  });

  describe("selectAdaptiveReadableStyle with Source Accent", () => {
    it("prefers white fill + strengthened accent outline for bright accents", () => {
      const style = selectAdaptiveReadableStyle({
        sourceAccentColor: "#00e5ff", // Bright Cyan
        backgroundLuminance: 40,
      });
      expect(style.textColor).toBe("#ffffff");
      expect(style.hasOutline).toBe(true);
      // Outline should be strengthened cyan, not pure black and not invisible white
      expect(getLuminance(style.textOutline)).toBeLessThan(150);
      const hue = getHue(style.textOutline);
      expect(hue).toBeGreaterThan(170);
      expect(hue).toBeLessThan(200);
    });

    it("prefers black fill + high-contrast light outline for dark accents", () => {
      const style = selectAdaptiveReadableStyle({
        sourceAccentColor: "#0f172a", // Dark Slate
      });
      expect(style.textColor).toBe("#000000");
      expect(style.hasOutline).toBe(true);
      expect(style.textOutline).toBe("#ffffff");
    });

    it("evaluates ambiguous mid-tone accents according to background context", () => {
      const darkBgStyle = selectAdaptiveReadableStyle({
        sourceAccentColor: "#3b82f6", // Mid-tone blue
        backgroundLuminance: 30, // Dark background
      });
      expect(darkBgStyle.textColor).toBe("#ffffff");
      expect(darkBgStyle.hasOutline).toBe(true);

      const brightBgStyle = selectAdaptiveReadableStyle({
        sourceAccentColor: "#3b82f6",
        backgroundLuminance: 230, // Bright background
      });
      expect(brightBgStyle.textColor).toBe("#000000");
      expect(brightBgStyle.hasOutline).toBe(true);
    });

    it("ensures glyph fill is strictly pure white or pure black across all accent variations", () => {
      const testAccents = [
        "#ff0055", // Bright rose
        "#ffff00", // Yellow
        "#000000", // Black
        "#112233", // Dark
        "#ffb6c1", // Pastel pink
        "#e0ffff", // Pastel cyan
        "#7c3aed", // Mid purple
      ];

      for (const accent of testAccents) {
        const style = selectAdaptiveReadableStyle({ sourceAccentColor: accent });
        expect(["#ffffff", "#000000"]).toContain(style.textColor);
        expect(style.hasOutline).toBe(true);
      }
    });
  });

  describe("resolveBubbleTextStyle integration", () => {
    it("applies brightness classification and outline strengthening when fallback occurs", () => {
      const bubble: TranslatedBubble = {
        id: 101,
        t: "ข้อความฟอลแบ็ก",
        styleProfile: {
          sourceAccentColor: "#ff4081", // Bright pink
          fill: "#ff4081",
          outline: "#ffffff",
          source: "fallback",
          fallbackReason: "low-readability",
          evidenceState: "rejected",
          backgroundLuminance: 60,
        } as TextStyleProfile,
      };

      const resolved = resolveBubbleTextStyle(bubble);
      expect(resolved.textColor).toBe("#ffffff");
      expect(resolved.hasOutline).toBe(true);
      // Accent outline derived from #ff4081 and strengthened
      const hue = getHue(resolved.textOutline);
      expect(hue >= 330 || hue <= 20).toBe(true);
    });
  });
});
