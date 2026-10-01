import { describe, expect, it } from "vitest";
import { extractTextColors } from "@/lib/colorMatching/sampleTextColors";
import type { ColorSampleRegion } from "@/lib/colorMatching/types";

function crop(fill: number[], background: number[], outline?: number[], shadow = false): ColorSampleRegion {
  const width = 48, height = 40;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const core = x >= 17 && x <= 30 && y >= 12 && y <= 27;
    const contour = shadow
      ? x >= 20 && x <= 33 && y >= 15 && y <= 30
      : x >= 14 && x <= 33 && y >= 9 && y <= 30;
    rgba.set([...(core ? fill : contour && outline ? outline : background), 255], (y * width + x) * 4);
  }
  return { width, height, rgba };
}

function generated(width: number, height: number, pixel: (x: number, y: number) => number[]): ColorSampleRegion {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    rgba.set([...pixel(x, y), 255], (y * width + x) * 4);
  }
  return { width, height, rgba };
}

describe("source outline evidence", () => {
  it.each([
    [[0, 162, 161], [255, 255, 255]],
    [[180, 10, 20], [245, 230, 210]],
    [[240, 150, 20], [40, 40, 40]],
    [[0, 0, 0], [255, 255, 255]],
    [[255, 255, 255], [20, 20, 20]],
  ])("does not fabricate a contour around plain %j", (fill, background) => {
    const result = extractTextColors(crop(fill, background));
    expect(result.hasOutline).toBe(false);
    expect(result.outlineWidthRatio).toBe(0);
    expect(result.outlineWidth).toBe(0);
  });

  it.each([
    [[0, 162, 161], [20, 30, 60], [255, 255, 255]],
    [[235, 95, 30], [245, 208, 197], [255, 255, 255]],
    [[230, 30, 30], [200, 200, 200], [10, 10, 10]],
    [[255, 255, 255], [30, 30, 30], [255, 30, 130]],
  ])("preserves an actual contour around %j", (fill, background, outline) => {
    const result = extractTextColors(crop(fill, background, outline));
    expect(result.hasOutline).toBe(true);
    expect(result.outlineWidthRatio).toBeGreaterThan(0);
  });

  it("does not classify a displaced shadow as a surrounding stroke", () => {
    const result = extractTextColors(crop([230, 30, 30], [200, 200, 200], [10, 10, 10], true));
    expect(result.hasOutline).toBe(false);
  });

  it("does not turn antialiasing into a source outline", () => {
    const sample = crop([180, 10, 20], [255, 255, 255]);
    for (let y = 12; y <= 27; y++) for (const x of [16, 31]) {
      sample.rgba.set([218, 133, 138, 255], (y * sample.width + x) * 4);
    }
    expect(extractTextColors(sample).hasOutline).toBe(false);
  });

  it("retains a real contour across a short antialiased transition", () => {
    const sample = crop([0, 162, 161], [40, 40, 40], [255, 255, 255]);
    for (let y = 12; y <= 27; y++) for (const x of [16, 31]) {
      sample.rgba.set([127, 208, 208, 255], (y * sample.width + x) * 4);
    }
    expect(extractTextColors(sample).hasOutline).toBe(true);
  });

  it("does not use an unrelated nearby white patch as a contour", () => {
    const sample = crop([0, 162, 161], [40, 40, 40]);
    for (let y = 13; y <= 20; y++) for (let x = 32; x <= 36; x++) {
      sample.rgba.set([255, 255, 255, 255], (y * sample.width + x) * 4);
    }
    expect(extractTextColors(sample).hasOutline).toBe(false);
  });

  it("does not use same-colored artwork outside glyph support as fill evidence", () => {
    const sample = generated(90, 60, (x, y) => {
      if ((x >= 15 && x <= 25 && y >= 20 && y <= 39) ||
          (x >= 60 && x <= 73 && y >= 20 && y <= 39)) return [0, 162, 161];
      if (x >= 57 && x <= 76 && y >= 17 && y <= 42) return [255, 255, 255];
      return [40, 40, 40];
    });
    sample.glyphMask = new Uint8ClampedArray(90 * 60);
    for (let y = 20; y <= 39; y++) for (let x = 15; x <= 25; x++) sample.glyphMask[y * 90 + x] = 255;
    expect(extractTextColors(sample).hasOutline).toBe(false);
  });

  it("does not bridge a background gap to an unrelated surrounding frame", () => {
    const sample = generated(48, 40, (x, y) => {
      if (x >= 17 && x <= 30 && y >= 12 && y <= 27) return [0, 162, 161];
      if (((x === 13 || x === 34) && y >= 8 && y <= 31) ||
          ((y === 8 || y === 31) && x >= 13 && x <= 34)) return [255, 255, 255];
      return [40, 40, 40];
    });
    expect(extractTextColors(sample).hasOutline).toBe(false);
  });

  it("does not mistake a flat pastel background gap for antialiasing", () => {
    const sample = generated(48, 40, (x, y) => {
      if (x >= 17 && x <= 30 && y >= 12 && y <= 27) return [0, 162, 161];
      if (((x === 13 || x === 34) && y >= 8 && y <= 31) ||
          ((y === 8 || y === 31) && x >= 13 && x <= 34)) return [255, 255, 255];
      return [127, 208, 208];
    });
    expect(extractTextColors(sample).hasOutline).toBe(false);
  });

  it("retains a genuine narrow contour clipped by one crop edge", () => {
    const sample = generated(48, 40, (x, y) => {
      if (x >= 17 && x <= 30 && y >= 3 && y <= 18) return [0, 162, 161];
      if (x >= 14 && x <= 33 && y <= 21) return [255, 255, 255];
      return [40, 40, 40];
    });
    expect(extractTextColors(sample).hasOutline).toBe(true);
  });

  it.each([true, false])("separates actual stroke %s from a white background merged with the glyph margin", (outlined) => {
    const sample = generated(48, 40, (x, y) => {
      if (x >= 17 && x <= 30 && y >= 12 && y <= 27) return [0, 162, 161];
      if (outlined && x >= 14 && x <= 33 && y >= 9 && y <= 30) return [255, 255, 255];
      return x < 24 ? [255, 255, 255] : [80, 80, 80];
    });
    expect(extractTextColors(sample).hasOutline).toBe(outlined);
  });
});
