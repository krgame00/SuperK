import { describe, expect, it } from "vitest";
import {
  blendSeamPixelRow,
  computeSeamBlendWeights,
} from "@/lib/webtoon/seamHealer";

describe("Webtoon Seam Healer & Inpainting Stitcher", () => {
  describe("computeSeamBlendWeights", () => {
    it("returns empty array for zero or negative overlap", () => {
      expect(computeSeamBlendWeights(0)).toHaveLength(0);
      expect(computeSeamBlendWeights(-10)).toHaveLength(0);
    });

    it("generates monotonically increasing linear blend weights from 0 to 1", () => {
      const weights = computeSeamBlendWeights(5, "linear");
      expect(weights).toHaveLength(5);
      expect(weights[0]).toBeCloseTo(0.0);
      expect(weights[4]).toBeCloseTo(1.0);
      for (let i = 1; i < weights.length; i++) {
        expect(weights[i]).toBeGreaterThan(weights[i - 1]);
      }
    });

    it("generates smooth cosine S-curve blend weights from 0 to 1", () => {
      const weights = computeSeamBlendWeights(9, "cosine");
      expect(weights).toHaveLength(9);
      expect(weights[0]).toBeCloseTo(0.0);
      expect(weights[8]).toBeCloseTo(1.0);
      // Midpoint at index 4 should be 0.5
      expect(weights[4]).toBeCloseTo(0.5);
    });
  });

  describe("blendSeamPixelRow", () => {
    it("blends RGBA pixels accurately according to weight", () => {
      // Top row: Pure Red [255, 0, 0, 255]
      const topRow = new Uint8ClampedArray([255, 0, 0, 255]);
      // Bottom row: Pure Blue [0, 0, 255, 255]
      const bottomRow = new Uint8ClampedArray([0, 0, 255, 255]);
      const outRow = new Uint8ClampedArray(4);

      // 100% top row (weight 0.0)
      blendSeamPixelRow(topRow, bottomRow, outRow, 0.0);
      expect(outRow[0]).toBe(255);
      expect(outRow[2]).toBe(0);

      // 100% bottom row (weight 1.0)
      blendSeamPixelRow(topRow, bottomRow, outRow, 1.0);
      expect(outRow[0]).toBe(0);
      expect(outRow[2]).toBe(255);

      // 50/50 blend (weight 0.5) -> Purple [128, 0, 128, 255]
      blendSeamPixelRow(topRow, bottomRow, outRow, 0.5);
      expect(outRow[0]).toBe(128);
      expect(outRow[1]).toBe(0);
      expect(outRow[2]).toBe(128);
      expect(outRow[3]).toBe(255);
    });
  });
});
