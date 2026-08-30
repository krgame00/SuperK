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

  it("extracts black text with white outline from a synthetic white balloon background", () => {
    // 20x20 balloon: white background, white outline ring at x=5..15, black text in center x=8..12
    const sample = createSyntheticRegion(20, 20, (x, y) => {
      // Background: White
      if (x < 4 || x > 16 || y < 4 || y > 16) return [255, 255, 255, 255];
      // Text center: Black
      if (x >= 8 && x <= 12 && y >= 8 && y <= 12) return [0, 0, 0, 255];
      // Text outline / stroke
      return [240, 240, 240, 255];
    });

    const profile = extractTextColors(sample);
    expect(profile.fill).toBe("#000000");
    expect(profile.fillConfidence).toBeGreaterThan(0.7);
    expect(profile.source).toBe("auto");
  });

  it("extracts vibrant pink text with white outline", () => {
    // 30x30 balloon: pure white background, outer outline white, inner text vibrant pink #ff2a85 (255, 42, 133)
    const sample = createSyntheticRegion(30, 30, (x, y) => {
      // Background
      if (x < 5 || x > 25 || y < 5 || y > 25) return [255, 255, 255, 255];
      // Outline ring (white/light)
      if (x < 9 || x > 21 || y < 9 || y > 21) return [255, 255, 255, 255];
      // Pink text
      return [255, 42, 133, 255];
    });

    const profile = extractTextColors(sample);
    expect(profile.fill).toBe("#ff2a85");
    expect(profile.fillConfidence).toBeGreaterThan(0.8);
  });

  it("extracts cyan/blue text with dark outline on dark background", () => {
    // Dark background (20, 20, 20), cyan text (0, 200, 255), black outline (0, 0, 0)
    const sample = createSyntheticRegion(30, 30, (x, y) => {
      if (x < 5 || x > 25 || y < 5 || y > 25) return [20, 20, 20, 255];
      if (x < 8 || x > 22 || y < 8 || y > 22) return [0, 0, 0, 255];
      return [0, 200, 255, 255];
    });

    const profile = extractTextColors(sample);
    expect(profile.fill).toBe("#00c8ff");
    expect(profile.outline).toBe("#000000");
    expect(profile.fillConfidence).toBeGreaterThan(0.75);
  });

  it("extracts pink text with cyan outline on dark/red background", () => {
    // Background: Dark red (100, 20, 20), Cyan outline (0, 220, 255), Pink text (255, 50, 150)
    const sample = createSyntheticRegion(30, 30, (x, y) => {
      // Background
      if (x < 5 || x > 25 || y < 5 || y > 25) return [100, 20, 20, 255];
      // Cyan Outline ring
      if (x < 9 || x > 21 || y < 9 || y > 21) return [0, 220, 255, 255];
      // Pink text
      return [255, 50, 150, 255];
    });

    const profile = extractTextColors(sample);
    expect(profile.fill).toBe("#ff3296");
    expect(profile.outline).toBe("#00dcff");
    expect(profile.fillConfidence).toBeGreaterThan(0.85);
    expect(profile.source).toBe("auto");
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
    expect(profile.fillConfidence).toBeGreaterThan(0.8);
  });

  it("protects text fill from adjacent artwork contamination", () => {
    // 40x40 region: White speech bubble background (255, 255, 255)
    // Top-left corner has adjacent red hair/artwork (220, 20, 20) at x<6, y<6
    // Center dialogue text is solid dark navy (10, 20, 60) at x: 15..25, y: 15..25
    const sample = createSyntheticRegion(40, 40, (x, y) => {
      // Border background
      if (x < 2 || x > 38 || y < 2 || y > 38) return [255, 255, 255, 255];
      // Adjacent artwork in corner
      if (x < 6 && y < 6) return [220, 20, 20, 255];
      // Center dialogue text
      if (x >= 14 && x <= 26 && y >= 14 && y <= 26) return [10, 20, 60, 255];
      // Rest of bubble interior
      return [255, 255, 255, 255];
    });

    const profile = extractTextColors(sample);
    // Fill should be dark navy, NOT contaminated by the red artwork
    expect(profile.fill).toBe("#0a143c");
    expect(profile.fillConfidence).toBeGreaterThan(0.7);
  });

  it("handles low-contrast / empty sample safely with global fallback", () => {
    const emptySample = createSyntheticRegion(10, 10, () => [255, 255, 255, 255]);
    const profile = extractTextColors(emptySample);
    expect(profile.fillConfidence).toBeLessThan(0.65);
    expect(profile.fill).toBe("#000000");
    expect(profile.outline).toBe("#ffffff");
  });
});
