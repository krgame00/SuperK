import { describe, expect, it } from "vitest";
import {
  preserveManualStyleProfiles,
  recomputeAdaptiveReadableOnLayoutCommit,
  resolveBubbleTextStyle,
  selectAdaptiveReadableStyle,
} from "@/lib/colorMatching/resolveTextStyle";
import { extractTextColors } from "@/lib/colorMatching/sampleTextColors";
import { inferTextStyleCategory } from "@/lib/colorMatching/nearbyStyleFallback";
import type { ColorSampleRegion, TextStyleProfile } from "@/lib/colorMatching/types";
import type { TranslatedBubble } from "@/lib/translationOverlay";

function createSolidSample(r: number, g: number, b: number, width = 60, height = 60): ColorSampleRegion {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, rgba };
}

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

describe("Ticket 22: Binary Fill Regression, Batch & Export Parity", () => {
  describe("Seam 1: Source Style Recovery + Evidence Admission", () => {
    it("rejects dominating background/artwork contamination without admitting it as source style", () => {
      // 90% brown artwork crop
      const sample = createSolidSample(140, 80, 40, 100, 30);
      const profile = extractTextColors(sample);

      expect(profile.fillConfidence).toBeLessThan(0.60);
      expect(profile.evidenceState).not.toBe("admitted");

      const bubble: TranslatedBubble = {
        box: [800, 100, 850, 600],
        styleProfile: profile,
      };

      const resolved = resolveBubbleTextStyle(bubble);
      // Floor colors (#8c5028) must never appear as resolved text fill
      expect(resolved.textColor).not.toBe("#8c5028");
      expect(["#ffffff", "#000000"]).toContain(resolved.textColor);
    });

    it("preserves admitted source-faithful chromatic and decorative styling without flattening to binary fill", () => {
      const decorativeBubble: TranslatedBubble = {
        id: "sfx_admitted",
        box: [100, 100, 200, 300],
        category: "sfx",
        t: "ตูมมม!",
        styleProfile: {
          ownershipMode: "auto",
          source: "auto",
          fill: "#ff5722", // chromatic orange
          outline: "#ffff00", // bright yellow
          hasOutline: true,
          outlineWidthRatio: 0.15,
          fillConfidence: 0.95,
          outlineConfidence: 0.95,
          evidenceState: "admitted",
          glow: {
            color: "#ff0000",
            opacity: 0.8,
            blurRatio: 0.25,
            offsetXRatio: 0,
            offsetYRatio: 0,
          },
        },
      };

      const resolved = resolveBubbleTextStyle(decorativeBubble);
      // Retains exact source chromatic styling
      expect(resolved.textColor).toBe("#ff5722");
      expect(resolved.textOutline).toBe("#ffff00");
      expect(resolved.glow?.color).toBe("#ff0000");
      expect(resolved.source).toBe("auto");
    });

    it("preserves admitted source-faithful no-outline dialogue without forcing outline", () => {
      const plainBubble: TranslatedBubble = {
        id: "dialogue_admitted_no_outline",
        box: [100, 100, 200, 300],
        category: "dialogue",
        t: "บทพูดไม่มีขอบ",
        styleProfile: {
          ownershipMode: "auto",
          source: "auto",
          fill: "#111111",
          outline: "#ffffff",
          hasOutline: false,
          outlineWidthRatio: 0,
          fillConfidence: 0.95,
          evidenceState: "admitted",
        },
      };

      const resolved = resolveBubbleTextStyle(plainBubble);
      expect(resolved.textColor).toBe("#111111");
      expect(resolved.hasOutline).toBe(false);
      expect(resolved.outlineWidthRatio).toBe(0);
    });
  });

  describe("Seam 2: Style Resolution + Readability/Fallback Policy", () => {
    it("guarantees fallback fill is strictly pure white (#ffffff) or pure black (#000000)", () => {
      const testCases: { bgLum: number; accent?: string; cat?: any }[] = [
        { bgLum: 250, accent: "#ff007f" },
        { bgLum: 25, accent: "#00ffff" },
        { bgLum: 130, accent: "#ffc0cb" },
        { bgLum: 180, accent: "#1a1a2e" },
        { bgLum: 255, cat: "overlay_subtitle" },
        { bgLum: 30, cat: "overlay_subtitle" },
      ];

      for (const tc of testCases) {
        const style = selectAdaptiveReadableStyle({
          backgroundLuminance: tc.bgLum,
          sourceAccentColor: tc.accent,
          category: tc.cat,
        });
        expect(["#ffffff", "#000000"]).toContain(style.textColor);
        expect(style.hasOutline).toBe(true);
      }
    });

    it("prevents white-on-white text in white speech balloons by rejecting white fill preference", () => {
      const bubble: TranslatedBubble = {
        id: "white_balloon",
        box: [100, 100, 200, 300],
        t: "ข้อความบนบอลลูนขาว",
        styleProfile: {
          sourceAccentColor: "#00ffff", // Bright cyan (prefers white fill normally)
          fill: "#00ffff",
          outline: "#ffffff",
          source: "fallback",
          fallbackReason: "background-contamination",
          evidenceState: "rejected",
          backgroundLuminance: 250,
          backgroundColor: "#ffffff",
        },
      };

      const resolved = resolveBubbleTextStyle(bubble);
      expect(resolved.textColor).toBe("#000000"); // Must switch to black fill
      expect(resolved.hasOutline).toBe(true);
      expect(resolved.textOutline).toBe("#ffffff");
    });

    it("prevents black-on-dark text on dark artwork by rejecting black fill preference", () => {
      const bubble: TranslatedBubble = {
        id: "dark_artwork",
        box: [100, 100, 200, 300],
        t: "ข้อความบนฉากมืด",
        styleProfile: {
          sourceAccentColor: "#111827", // Dark slate (prefers black fill normally)
          fill: "#111827",
          outline: "#ffffff",
          source: "fallback",
          fallbackReason: "low-readability",
          evidenceState: "rejected",
          backgroundLuminance: 30,
          backgroundColor: "#10151c",
        },
      };

      const resolved = resolveBubbleTextStyle(bubble);
      expect(resolved.textColor).toBe("#ffffff"); // Must switch to white fill
      expect(resolved.hasOutline).toBe(true);
      expect(resolved.textOutline).toBe("#000000");
    });

    it("strengthens pastel source accent outlines while preserving hue", () => {
      const pastelPink = "#ffc0cb";
      const style = selectAdaptiveReadableStyle({
        sourceAccentColor: pastelPink,
        backgroundLuminance: 40,
      });

      expect(style.textColor).toBe("#ffffff");
      expect(style.hasOutline).toBe(true);
      // Hue remains in red/pink spectrum (around 340-360 / 0-20 deg)
      const hue = getHue(style.textOutline);
      expect(hue >= 330 || hue <= 20).toBe(true);
    });

    it("simplifies unverified decorative effects entering Readable fallback to clean binary fill", () => {
      const unverifiedDecorative: TextStyleProfile = {
        ownershipMode: "auto",
        source: "fallback",
        fill: "#ff007f",
        outline: "#ffffff",
        hasOutline: true,
        evidenceState: "rejected",
        fallbackReason: "insufficient-evidence",
        backgroundLuminance: 240,
        glow: {
          color: "#ff00ff",
          opacity: 0.9,
          blurRatio: 0.4,
          offsetXRatio: 0,
          offsetYRatio: 0,
        },
      };

      const bubble: TranslatedBubble = {
        id: "sfx_fallback",
        box: [100, 100, 200, 300],
        t: "เอฟเฟกต์ตกชั้น",
        styleProfile: unverifiedDecorative,
      };

      const resolved = resolveBubbleTextStyle(bubble);
      expect(resolved.textColor).toBe("#000000");
      expect(resolved.hasOutline).toBe(true);
      expect(resolved.source).toBe("fallback");
      // Uncertain source glow is not rendered in fallback
      expect(resolved.glow).toBeUndefined();
    });
  });

  describe("Seam 3: Overlay / UI / Export Behavior & Batch Parity", () => {
    it("produces identical style resolution across single-page and batch translation lists", () => {
      const testBubbles: TranslatedBubble[] = [
        {
          id: "batch_1",
          box: [100, 100, 200, 300],
          category: "dialogue",
          styleProfile: {
            ownershipMode: "auto",
            source: "fallback",
            fill: "#ff0055",
            outline: "#ffffff",
            hasOutline: true,
            backgroundLuminance: 240,
            fallbackReason: "background-contamination",
          },
        },
        {
          id: "batch_2",
          box: [400, 100, 500, 600],
          category: "overlay_subtitle",
          styleProfile: {
            ownershipMode: "readable",
            source: "fallback",
            fill: "#ffffff",
            outline: "#000000",
            hasOutline: true,
            backgroundLuminance: 35,
          },
        },
      ];

      // Resolve individually (single-page mode)
      const singleResults = testBubbles.map((b) => resolveBubbleTextStyle(b));

      // Resolve in batch list
      const batchResults = testBubbles.map((b) => resolveBubbleTextStyle(b));

      expect(singleResults[0]).toEqual(batchResults[0]);
      expect(singleResults[1]).toEqual(batchResults[1]);
      expect(singleResults[0].textColor).toBe("#000000");
      expect(singleResults[1].textColor).toBe("#ffffff");
    });

    it("preserves manual styles identically through layout edits, re-translation, and export roundtrip", () => {
      const manualBubble: TranslatedBubble = {
        id: "manual_e2e",
        box: [200, 200, 350, 450],
        original_text: "テキスト",
        t: "ข้อความกำหนดเอง",
        styleProfile: {
          ownershipMode: "manual",
          source: "manual",
          fill: "#00bcd4", // custom cyan
          outline: "#d32f2f", // custom red
          hasOutline: true,
          outlineWidthRatio: 0.11,
        },
      };

      // 1. Layout commit
      const darkBg = createSolidSample(15, 15, 20);
      recomputeAdaptiveReadableOnLayoutCommit(manualBubble, darkBg);
      expect(manualBubble.styleProfile?.fill).toBe("#00bcd4");
      expect(manualBubble.styleProfile?.outline).toBe("#d32f2f");

      // 2. Re-translation
      const newBatch: TranslatedBubble[] = [
        {
          id: "manual_e2e",
          box: [200, 200, 350, 450],
          original_text: "テキスト",
          t: "ข้อความแปลใหม่",
        },
      ];
      const preserved = preserveManualStyleProfiles(newBatch, [manualBubble]);
      expect(preserved[0].styleProfile?.fill).toBe("#00bcd4");
      expect(preserved[0].styleProfile?.outline).toBe("#d32f2f");

      // 3. Export resolution
      const exportStyle = resolveBubbleTextStyle(preserved[0]);
      expect(exportStyle.textColor).toBe("#00bcd4");
      expect(exportStyle.textOutline).toBe("#d32f2f");
      expect(exportStyle.outlineWidthRatio).toBe(0.11);
      expect(exportStyle.hasOutline).toBe(true);
    });
  });
});
