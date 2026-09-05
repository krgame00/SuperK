import { describe, expect, it } from "vitest";
import {
  colorDistance,
  extractTextColors,
  rgbToHex,
} from "@/lib/colorMatching/sampleTextColors";
import type { ColorSampleRegion } from "@/lib/colorMatching/types";

function createSyntheticRegion(
  width: number,
  height: number,
  generator: (x: number, y: number) => [number, number, number, number],
): ColorSampleRegion {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const [r, g, b, a] = generator(x, y);
      rgba[idx] = r;
      rgba[idx + 1] = g;
      rgba[idx + 2] = b;
      rgba[idx + 3] = a;
    }
  }
  return { width, height, rgba };
}

describe("sampleTextColors color extraction engine", () => {
  it("calculates Euclidean color distance and hex conversion correctly", () => {
    expect(colorDistance(255, 255, 255, 255, 255, 255)).toBe(0);
    expect(colorDistance(0, 0, 0, 255, 255, 255)).toBeCloseTo(441.67, 1);
    expect(rgbToHex(255, 51, 102)).toBe("#ff3366");
  });

  it("extracts white text fill with hot pink outline (Manga Dialogue Style)", () => {
    // 30x30 region: Dark/grey background (40, 40, 40)
    // Outer outline ring: Hot pink (255, 30, 130) at dist 1..2
    // Core interior of letter: Pure white (255, 255, 255) at dist >= 3
    const sample = createSyntheticRegion(30, 30, (x, y) => {
      // Outer background
      if (x < 4 || x > 26 || y < 4 || y > 26) return [40, 40, 40, 255];
      // Pink outline contour
      if (x < 8 || x > 22 || y < 8 || y > 22) return [255, 30, 130, 255];
      // White text interior
      return [255, 255, 255, 255];
    });

    const profile = extractTextColors(sample);
    // Fill MUST be White, and Outline MUST be Pink!
    expect(profile.fill).toBe("#ffffff");
    expect(profile.outline).toBe("#ff1e82");
    expect(profile.fillConfidence).toBeGreaterThan(0.75);
    expect(profile.source).toBe("auto");
  });

  it("extracts white text fill with cyan glowing outline", () => {
    // 30x30 region: Dark background (30, 30, 30)
    // Cyan glowing outline (0, 220, 255) around white letters (255, 255, 255)
    const sample = createSyntheticRegion(30, 30, (x, y) => {
      if (x < 4 || x > 26 || y < 4 || y > 26) return [30, 30, 30, 255];
      if (x < 8 || x > 22 || y < 8 || y > 22) return [0, 220, 255, 255];
      return [255, 255, 255, 255];
    });

    const profile = extractTextColors(sample);
    expect(profile.fill).toBe("#ffffff");
    expect(profile.outline).toBe("#00dcff");
    expect(profile.fillConfidence).toBeGreaterThan(0.75);
  });

  it("extracts black text with white outline from a white speech balloon", () => {
    // 20x20 balloon: white background, black text in center
    const sample = createSyntheticRegion(20, 20, (x, y) => {
      // Background: White
      if (x < 4 || x > 16 || y < 4 || y > 16) return [255, 255, 255, 255];
      // Text center: Black
      if (x >= 8 && x <= 12 && y >= 8 && y <= 12) return [0, 0, 0, 255];
      return [240, 240, 240, 255];
    });

    const profile = extractTextColors(sample);
    expect(profile.fill).toBe("#000000");
    expect(profile.outline).toBe("#ffffff");
    expect(profile.fillConfidence).toBeGreaterThan(0.7);
    expect(profile.source).toBe("auto");
  });

  it("extracts vibrant solid pink fill text with dark outline", () => {
    // 30x30 region: Light background (240, 240, 240)
    // Dark outline (10, 10, 10), Solid pink core (255, 42, 133)
    const sample = createSyntheticRegion(30, 30, (x, y) => {
      if (x < 5 || x > 25 || y < 5 || y > 25) return [240, 240, 240, 255];
      if (x < 8 || x > 22 || y < 8 || y > 22) return [10, 10, 10, 255];
      return [255, 42, 133, 255];
    });

    const profile = extractTextColors(sample);
    expect(profile.fill).toBe("#ff2a85");
    expect(profile.outline).toBe("#0a0a0a");
    expect(profile.fillConfidence).toBeGreaterThan(0.8);
  });

  it("rejects anti-aliased edge gradient pixels in favor of core interior fill", () => {
    // 30x30 region: White background (255, 255, 255)
    // Edge transition: Blended muddy pinkish-grey (200, 150, 170)
    // Core interior: Solid pure pink (255, 40, 140)
    const sample = createSyntheticRegion(30, 30, (x, y) => {
      if (x < 4 || x > 26 || y < 4 || y > 26) return [255, 255, 255, 255];
      if (x < 8 || x > 22 || y < 8 || y > 22) return [200, 150, 170, 255]; // anti-aliased edge
      return [255, 40, 140, 255]; // core interior
    });

    const profile = extractTextColors(sample);
    expect(profile.fill).toBe("#ff288c");
    expect(profile.fillConfidence).toBeGreaterThan(0.75);
  });

  it("protects text fill from adjacent artwork contamination", () => {
    // 40x40 region: White speech bubble background (255, 255, 255)
    // Top-left corner has adjacent red hair/artwork (220, 20, 20) at x<6, y<6
    // Center dialogue text is solid dark navy (10, 20, 60) at x: 15..25, y: 15..25
    const sample = createSyntheticRegion(40, 40, (x, y) => {
      if (x < 2 || x > 38 || y < 2 || y > 38) return [255, 255, 255, 255];
      if (x < 6 && y < 6) return [220, 20, 20, 255];
      if (x >= 14 && x <= 26 && y >= 14 && y <= 26) return [10, 20, 60, 255];
      return [255, 255, 255, 255];
    });

    const profile = extractTextColors(sample);
    expect(profile.fill).toBe("#0a143c");
    expect(profile.fillConfidence).toBeGreaterThan(0.7);
  });

  it("samples fill and outline only from the supplied glyph mask", () => {
    const sample = createSyntheticRegion(40, 40, (x, y) => {
      if (x < 14) return [0, 200, 255, 255]; // Character hair inside the OCR box.
      if (x >= 19 && x <= 30 && y >= 10 && y <= 29) {
        const isOutline = x < 22 || x > 27 || y < 13 || y > 26;
        return isOutline ? [255, 30, 130, 255] : [255, 255, 255, 255];
      }
      return [35, 35, 35, 255];
    });
    sample.glyphMask = new Uint8ClampedArray(40 * 40);
    for (let y = 10; y <= 29; y++) {
      for (let x = 19; x <= 30; x++) {
        sample.glyphMask[y * 40 + x] = 255;
      }
    }

    const profile = extractTextColors(sample);

    expect(profile.fill).toBe("#ffffff");
    expect(profile.outline).toBe("#ff1e82");
    expect(profile.fillConfidence).toBeGreaterThan(0.75);
  });

  it("rejects border-connected artwork when no glyph mask is available", () => {
    const sample = createSyntheticRegion(40, 40, (x, y) => {
      if (x < 14) return [0, 200, 255, 255];
      if (x >= 19 && x <= 30 && y >= 10 && y <= 29) {
        const isOutline = x < 22 || x > 27 || y < 13 || y > 26;
        return isOutline ? [255, 30, 130, 255] : [255, 255, 255, 255];
      }
      return [35, 35, 35, 255];
    });

    const profile = extractTextColors(sample);

    expect(profile.fill).toBe("#ffffff");
    expect(profile.outline).toBe("#ff1e82");
  });

  it("handles low-contrast / empty sample safely with global fallback", () => {
    const emptySample = createSyntheticRegion(10, 10, () => [255, 255, 255, 255]);
    const profile = extractTextColors(emptySample);
    expect(profile.fillConfidence).toBeLessThan(0.65);
    expect(profile.fill).toBe("#000000");
    expect(profile.outline).toBe("#ffffff");
  });
});
