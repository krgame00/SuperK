import { describe, it, expect } from "vitest";
import { analyzeMonochromePage } from "@/lib/colorMatching/monochromePage";

function makePage(pixels: Array<[number, number, number, number?]>): {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
} {
  const width = pixels.length;
  const height = 1;
  const rgba = new Uint8ClampedArray(width * 4);
  pixels.forEach(([r, g, b, a = 255], i) => {
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = a;
  });
  return { rgba, width, height };
}

function makeMostlyGrayPageWithColorPatch(
  colorRgb: [number, number, number],
  colorRatio: number,
  totalPixels = 1000,
): { rgba: Uint8ClampedArray; width: number; height: number } {
  const width = totalPixels;
  const height = 1;
  const rgba = new Uint8ClampedArray(width * 4);
  const colorCount = Math.round(totalPixels * colorRatio);

  for (let i = 0; i < totalPixels; i++) {
    const isColor = i < colorCount;
    const r = isColor ? colorRgb[0] : 200;
    const g = isColor ? colorRgb[1] : 200;
    const b = isColor ? colorRgb[2] : 200;
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = 255;
  }
  return { rgba, width, height };
}

function makeNearGrayNoisePage(options: { maxChannelDelta: number; totalPixels?: number }): {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
} {
  const totalPixels = options.totalPixels ?? 1000;
  const rgba = new Uint8ClampedArray(totalPixels * 4);
  for (let i = 0; i < totalPixels; i++) {
    const base = 150 + (i % 50);
    const delta = (i % (options.maxChannelDelta * 2 + 1)) - options.maxChannelDelta;
    rgba[i * 4] = Math.min(255, Math.max(0, base));
    rgba[i * 4 + 1] = Math.min(255, Math.max(0, base + Math.round(delta / 2)));
    rgba[i * 4 + 2] = Math.min(255, Math.max(0, base - delta));
    rgba[i * 4 + 3] = 255;
  }
  return { rgba, width: totalPixels, height: 1 };
}

describe("Page-level Monochrome Classifier (Task 1)", () => {
  it("classifies a neutral grayscale manga page as monochrome", () => {
    const page = makePage([
      [255, 255, 255],
      [220, 220, 220],
      [120, 120, 120],
      [20, 20, 20],
      [0, 0, 0],
    ]);
    const result = analyzeMonochromePage(page.rgba, page.width, page.height);
    expect(result.isMonochrome).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.chromaticPixelRatio).toBe(0);
    expect(result.strongChromaticPixelRatio).toBe(0);
  });

  it("rejects a page with meaningful colored artwork (e.g. 8% colored patch)", () => {
    const page = makeMostlyGrayPageWithColorPatch([220, 45, 70], 0.08);
    const result = analyzeMonochromePage(page.rgba, page.width, page.height);
    expect(result.isMonochrome).toBe(false);
    expect(result.chromaticPixelRatio).toBeGreaterThan(0.02);
  });

  it("tolerates scanner noise and JPEG channel drift", () => {
    const page = makeNearGrayNoisePage({ maxChannelDelta: 8 });
    const result = analyzeMonochromePage(page.rgba, page.width, page.height);
    expect(result.isMonochrome).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("ignores transparent or near-transparent pixels (alpha < 32)", () => {
    const page = makePage([
      [255, 0, 0, 10], // transparent red - should be ignored
      [200, 200, 200, 255],
      [100, 100, 100, 255],
      [50, 50, 50, 255],
    ]);
    const result = analyzeMonochromePage(page.rgba, page.width, page.height);
    expect(result.isMonochrome).toBe(true);
    expect(result.sampledPixelCount).toBe(3);
  });

  it("handles high-resolution images by deterministic subsampling without reading all millions of pixels", () => {
    const width = 2000;
    const height = 3000;
    // Buffer for 2000x3000 = 6,000,000 pixels (24 MB)
    const rgba = new Uint8ClampedArray(width * height * 4);
    // Fill with grayscale
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = 180;
      rgba[i + 1] = 180;
      rgba[i + 2] = 180;
      rgba[i + 3] = 255;
    }
    const result = analyzeMonochromePage(rgba, width, height);
    expect(result.isMonochrome).toBe(true);
    expect(result.sampledPixelCount).toBeLessThanOrEqual(25000);
    expect(result.sampledPixelCount).toBeGreaterThanOrEqual(10000);
  });
});
