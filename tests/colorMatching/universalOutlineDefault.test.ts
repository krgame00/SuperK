import { describe, expect, it } from "vitest";
import {
  extractTextColors,
  type ColorSampleRegion,
} from "@/lib/colorMatching/sampleTextColors";
import { resolveBubbleTextStyle } from "@/lib/colorMatching/resolveTextStyle";
import type { TranslatedBubble, OverlayTextStyle } from "@/lib/translationOverlay";
import type { TextStyleProfile } from "@/lib/colorMatching/types";

describe("Universal Outline Default & Bidirectional Stroke Detection", () => {
  const globalStyle: OverlayTextStyle = {
    textColor: "#000000",
    textOutline: "#ffffff",
  };

  /**
   * Helper to create a synthetic RGBA image region with core and contour pixels.
   */
  function makeCrop(
    width: number,
    height: number,
    opts: {
      bgRgba: [number, number, number, number];
      coreRgba: [number, number, number, number];
      contourRgba?: [number, number, number, number];
      coreRadius?: number;
      contourRadius?: number;
    },
  ): ColorSampleRegion {
    const rgba = new Uint8ClampedArray(width * height * 4);
    const cx = width / 2;
    const cy = height / 2;
    const coreR = opts.coreRadius ?? 6;
    const contourR = opts.contourRadius ?? 10;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const dist = Math.hypot(x - cx, y - cy);

        if (dist <= coreR) {
          rgba[idx] = opts.coreRgba[0];
          rgba[idx + 1] = opts.coreRgba[1];
          rgba[idx + 2] = opts.coreRgba[2];
          rgba[idx + 3] = opts.coreRgba[3];
        } else if (opts.contourRgba && dist <= contourR) {
          rgba[idx] = opts.contourRgba[0];
          rgba[idx + 1] = opts.contourRgba[1];
          rgba[idx + 2] = opts.contourRgba[2];
          rgba[idx + 3] = opts.contourRgba[3];
        } else {
          rgba[idx] = opts.bgRgba[0];
          rgba[idx + 1] = opts.bgRgba[1];
          rgba[idx + 2] = opts.bgRgba[2];
          rgba[idx + 3] = opts.bgRgba[3];
        }
      }
    }
    return { width, height, rgba };
  }

  describe("Bidirectional Outline Extraction (sampleTextColors)", () => {
    it("detects white/light outline on chromatic text (e.g. cyan text with white border on dark background)", () => {
      // Background: Dark blue night sky (20, 30, 60)
      // Contour: White border (255, 255, 255)
      // Core: Cyan text (0, 162, 255)
      const sample = makeCrop(32, 32, {
        bgRgba: [20, 30, 60, 255],
        contourRgba: [255, 255, 255, 255],
        coreRgba: [0, 162, 255, 255],
        coreRadius: 6,
        contourRadius: 10,
      });

      const profile = extractTextColors(sample);

      expect(profile.hasOutline).toBe(true);
      expect(profile.outline).toBe("#ffffff");
      expect(profile.fill).toMatch(/^#00[a-f0-9]{4}$/i); // cyan hue
      expect(profile.outlineWidthRatio).toBeGreaterThanOrEqual(0.08);
      expect(profile.evidenceState).toBe("admitted");
    });

    it("detects white/light outline on orange/warm chromatic text (e.g. orange on skin tone)", () => {
      // Background: Skin tone (245, 208, 197)
      // Contour: White stroke (255, 255, 255)
      // Core: Orange text (235, 95, 30)
      const sample = makeCrop(32, 32, {
        bgRgba: [245, 208, 197, 255],
        contourRgba: [255, 255, 255, 255],
        coreRgba: [235, 95, 30, 255],
        coreRadius: 6,
        contourRadius: 10,
      });

      const profile = extractTextColors(sample);

      expect(profile.hasOutline).toBe(true);
      expect(profile.outline).toBe("#ffffff");
      expect(profile.fill).toMatch(/^#[d-f][a-f0-9]{5}$/i); // warm orange
      expect(profile.outlineWidthRatio).toBeGreaterThanOrEqual(0.08);
    });

    it("detects dark outline on chromatic text when dark contour is present", () => {
      // Background: Light neutral (200, 200, 200)
      // Contour: Dark stroke (10, 10, 10)
      // Core: Red text (230, 30, 30)
      const sample = makeCrop(32, 32, {
        bgRgba: [200, 200, 200, 255],
        contourRgba: [10, 10, 10, 255],
        coreRgba: [230, 30, 30, 255],
        coreRadius: 6,
        contourRadius: 10,
      });

      const profile = extractTextColors(sample);

      expect(profile.hasOutline).toBe(true);
      expect(profile.outline).toBe("#0a0a0a");
      expect(profile.outlineWidthRatio).toBeGreaterThanOrEqual(0.08);
    });

    it("assigns universal contrasting outline even when chromatic text has no visible contour in source", () => {
      // Background: Dark blue (15, 25, 50)
      // Core: Solid Blue (30, 100, 240) - NO contour in sample
      const sample = makeCrop(32, 32, {
        bgRgba: [15, 25, 50, 255],
        coreRgba: [30, 100, 240, 255],
        coreRadius: 8,
      });

      const profile = extractTextColors(sample);

      // Universal Outline Default requires outline to be true and contrasting
      expect(profile.hasOutline).toBe(true);
      expect(profile.outline).toBe("#ffffff"); // dark background -> white stroke
      expect(profile.outlineWidthRatio).toBeGreaterThanOrEqual(0.10);
    });
  });

  describe("Universal Outline Default (resolveBubbleTextStyle)", () => {
    it("guarantees outline for fallback profiles even if legacy profile has hasOutline=false", () => {
      const bubble: TranslatedBubble = {
        box: [100, 100, 200, 200],
        original_text: "DARK TEXT OVER ARTWORK",
        translated: "ข้อความสีเข้มบนภาพวาด",
        styleProfile: {
          fill: "#111111",
          outline: "#111111", // legacy identical outline
          hasOutline: false, // legacy false
          fillConfidence: 0.50,
          outlineConfidence: 0.50,
          source: "fallback",
          fallbackReason: "background-contamination",
          backgroundLuminance: 35, // dark background
        },
      };

      const resolved = resolveBubbleTextStyle(bubble, globalStyle);

      expect(resolved.hasOutline).toBe(true);
      expect(resolved.textColor).toBe("#ffffff");
      expect(resolved.textOutline).toBe("#000000");
      expect(resolved.outlineWidthRatio).toBeGreaterThanOrEqual(0.12);
    });

    it("applies Binary Fill Readable (white fill + outline) for chromatic text in Readable mode", () => {
      const chromaticBubble: TranslatedBubble = {
        box: [100, 100, 200, 200],
        original_text: "ANYONE COULD SEE US FROM HERE",
        translated: "ใครก็มองเห็นเราจากตรงนี้นะ",
        styleProfile: {
          fill: "#00a2ff",
          outline: "#00a2ff",
          hasOutline: false,
          ownershipMode: "readable",
          source: "auto",
          backgroundLuminance: 35,
        },
      };

      const resolved = resolveBubbleTextStyle(chromaticBubble, globalStyle);

      expect(resolved.hasOutline).toBe(true);
      expect(resolved.textColor).toBe("#ffffff");
      expect(resolved.isAdaptiveReadable).toBe(true);
    });

    it("preserves manual user override when user explicitly sets borderless / strokeWidth=0", () => {
      const manualBubble: TranslatedBubble = {
        box: [100, 100, 200, 200],
        translated: "ข้อความกำหนดเองแบบไม่มีขอบ",
        styleProfile: {
          fill: "#ff0077",
          outline: "#ffffff",
          hasOutline: false,
          outlineWidth: 0,
          outlineWidthRatio: 0,
          source: "manual",
          ownershipMode: "manual",
        },
      };

      const resolved = resolveBubbleTextStyle(manualBubble, globalStyle);

      // Manual override MUST be respected
      expect(resolved.hasOutline).toBe(false);
      expect(resolved.outlineWidth).toBe(0);
      expect(resolved.outlineWidthRatio).toBe(0);
    });

    it("normal speech bubbles in white balloons receive clean default white outline to prevent inpaint bleed", () => {
      const whiteBalloonBubble: TranslatedBubble = {
        box: [100, 100, 300, 300],
        translated: "บทสนทนาในบอลลูน",
        styleProfile: {
          fill: "#000000",
          outline: "#ffffff",
          hasOutline: true,
          fillConfidence: 1.0,
          source: "auto",
          backgroundLuminance: 255,
        },
      };

      const resolved = resolveBubbleTextStyle(whiteBalloonBubble, globalStyle);

      expect(resolved.hasOutline).toBe(true);
      expect(resolved.textColor).toBe("#000000");
      expect(resolved.textOutline).toBe("#ffffff");
      expect(resolved.outlineWidthRatio).toBeGreaterThanOrEqual(0.12);
    });
  });
});
