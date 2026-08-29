import { describe, expect, it } from "vitest";
import {
  normalizeBubbleBox,
  sampleBubbleRegionFromImageData,
} from "@/lib/colorMatching/canvasSampler";

describe("canvasSampler pixel reading & OCR box normalization", () => {
  it("normalizes [ymin, xmin, ymax, xmax] 0-1000 coordinates to image pixel dimensions", () => {
    // 1000x2000 image
    const box = [100, 200, 300, 600]; // ymin=10%, xmin=20%, ymax=30%, xmax=60%
    const normalized = normalizeBubbleBox(box, 1000, 2000);

    expect(normalized.x).toBe(200); // 20% of 1000
    expect(normalized.y).toBe(200); // 10% of 2000
    expect(normalized.width).toBe(400); // 40% of 1000
    expect(normalized.height).toBe(400); // 20% of 2000
  });

  it("clamps out-of-range coordinates gracefully", () => {
    const box = [-50, -100, 1200, 1500];
    const normalized = normalizeBubbleBox(box, 800, 1000);

    expect(normalized.x).toBe(0);
    expect(normalized.y).toBe(0);
    expect(normalized.width).toBe(800);
    expect(normalized.height).toBe(1000);
  });

  it("samples sub-region pixels accurately from full image buffer", () => {
    // 10x10 full image filled with blue (0, 0, 255) and a 2x2 red square (255, 0, 0) at x=3, y=3
    const fullData = new Uint8ClampedArray(10 * 10 * 4);
    for (let i = 0; i < fullData.length; i += 4) {
      fullData[i] = 0;
      fullData[i + 1] = 0;
      fullData[i + 2] = 255;
      fullData[i + 3] = 255;
    }
    // Set 2x2 red box at (3,3)..(4,4)
    for (let y = 3; y <= 4; y++) {
      for (let x = 3; x <= 4; x++) {
        const idx = (y * 10 + x) * 4;
        fullData[idx] = 255;
        fullData[idx + 1] = 0;
        fullData[idx + 2] = 0;
        fullData[idx + 3] = 255;
      }
    }

    const sampled = sampleBubbleRegionFromImageData(
      fullData,
      10,
      10,
      { x: 3, y: 3, width: 2, height: 2 },
    );

    expect(sampled.width).toBe(2);
    expect(sampled.height).toBe(2);
    expect(sampled.rgba.length).toBe(16); // 2 * 2 * 4
    // Top-left pixel of sampled region must be red
    expect(sampled.rgba[0]).toBe(255);
    expect(sampled.rgba[1]).toBe(0);
    expect(sampled.rgba[2]).toBe(0);
    expect(sampled.rgba[3]).toBe(255);
  });
});
