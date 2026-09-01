import { describe, expect, it } from "vitest";
import { extractTextColors } from "@/lib/colorMatching/sampleTextColors";
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

describe("Manga Real-World Color Scenarios", () => {
  it("extracts white text with vivid red outline on skin/suit background (No skin color leaks)", () => {
    // 40x40 region: Background is character skin (230, 190, 180) and black suit (20, 15, 25)
    // Stroke contour is Crimson Red (240, 20, 40)
    // Core text is Crisp White (255, 255, 255)
    const sample = createSyntheticRegion(40, 40, (x, y) => {
      // Background skin / suit
      if (x < 5 || x > 35 || y < 5 || y > 35) {
        return x < 20 ? [230, 190, 180, 255] : [20, 15, 25, 255];
      }
      // Red outline contour
      if (x < 10 || x > 30 || y < 10 || y > 30) {
        return [240, 20, 40, 255];
      }
      // White core
      return [255, 255, 255, 255];
    });

    const profile = extractTextColors(sample);
    expect(profile.fill).toBe("#ffffff");
    // Outline MUST be the vivid red, NOT skin tone or dark suit!
    expect(profile.outline).toBe("#f01428");
    expect(profile.outlineWidth).toBeGreaterThanOrEqual(1.0);
    expect(profile.source).toBe("auto");
  });

  it("extracts solid red handwriting text on white background", () => {
    // 30x30 region: White background (255, 255, 255), Red handwriting text (230, 30, 45)
    const sample = createSyntheticRegion(30, 30, (x, y) => {
      if (x >= 10 && x <= 20 && y >= 8 && y <= 22) {
        return [230, 30, 45, 255];
      }
      return [255, 255, 255, 255];
    });

    const profile = extractTextColors(sample);
    expect(profile.fill).toBe("#e61e2d");
    expect(profile.outline).toBe("#ffffff");
    expect(profile.source).toBe("auto");
  });

  it("extracts black dialogue inside white bubble even when bounding box clips skin background", () => {
    // 40x40 region: Corners clip bald man skin (240, 210, 200), center is white bubble (255, 255, 255), text is black (0, 0, 0)
    const sample = createSyntheticRegion(40, 40, (x, y) => {
      // Corners have skin
      if ((x < 6 && y < 6) || (x > 34 && y > 34)) {
        return [240, 210, 200, 255];
      }
      // Bubble center with black text
      if (x >= 15 && x <= 25 && y >= 15 && y <= 25) {
        return [10, 10, 10, 255];
      }
      return [255, 255, 255, 255];
    });

    const profile = extractTextColors(sample);
    // Fill MUST be pure Black #000000, NOT skin tone!
    expect(profile.fill).toBe("#000000");
    expect(profile.outline).toBe("#ffffff");
    expect(profile.source).toBe("auto");
  });

  it("extracts white text with purple glow on black nano-suit", () => {
    // 30x30 region: Black suit background (15, 12, 20), Neon purple glow (120, 20, 220), White letters (255, 255, 255)
    const sample = createSyntheticRegion(30, 30, (x, y) => {
      if (x < 4 || x > 26 || y < 4 || y > 26) return [15, 12, 20, 255];
      if (x < 8 || x > 22 || y < 8 || y > 22) return [120, 20, 220, 255];
      return [255, 255, 255, 255];
    });

    const profile = extractTextColors(sample);
    expect(profile.fill).toBe("#ffffff");
    expect(profile.outline).toBe("#7814dc");
    expect(profile.source).toBe("auto");
  });
});
