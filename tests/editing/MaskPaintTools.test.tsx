import { describe, expect, it } from "vitest";
import {
  applyBrushWithSettings,
  type PaintBrushSettings,
} from "@/lib/cleaning/maskEdits";

function createMask(width: number, height: number, alpha = 0): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  if (alpha > 0) {
    for (let i = 0; i < width * height; i++) {
      data[i * 4] = 255;
      data[i * 4 + 3] = alpha;
    }
  }
  return new ImageData(data, width, height);
}

function alphaAt(image: ImageData, x: number, y: number): number {
  return image.data[(y * image.width + x) * 4 + 3];
}

describe("MaskPaintTools", () => {
  it("applies square brush correctly", () => {
    const mask = createMask(10, 10, 0);
    const settings: PaintBrushSettings = {
      shape: "square",
      size: 4,
      feather: 0,
      mode: "paint",
    };

    const result = applyBrushWithSettings(mask, [{ x: 5, y: 5 }], settings);
    expect(alphaAt(result, 5, 5)).toBe(255);
    expect(alphaAt(result, 4, 4)).toBe(255);
    expect(alphaAt(result, 0, 0)).toBe(0);
  });

  it("applies circle brush with radius bounds", () => {
    const mask = createMask(10, 10, 0);
    const settings: PaintBrushSettings = {
      shape: "circle",
      size: 4,
      feather: 0,
      mode: "paint",
    };

    const result = applyBrushWithSettings(mask, [{ x: 5, y: 5 }], settings);
    expect(alphaAt(result, 5, 5)).toBe(255);
    expect(alphaAt(result, 0, 0)).toBe(0);
  });

  it("applies erase mode correctly", () => {
    const mask = createMask(10, 10, 255);
    const settings: PaintBrushSettings = {
      shape: "circle",
      size: 6,
      feather: 0,
      mode: "erase",
    };

    const result = applyBrushWithSettings(mask, [{ x: 5, y: 5 }], settings);
    expect(alphaAt(result, 5, 5)).toBe(0);
    expect(alphaAt(result, 0, 0)).toBe(255);
  });
});
