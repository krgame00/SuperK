import { describe, expect, it } from "vitest";
import {
  isWebtoonStrip,
  planWebtoonChunking,
  snapToGutter,
} from "@/lib/webtoon/stripChunker";

describe("Webtoon Long-Strip Decomposition Engine", () => {
  describe("isWebtoonStrip", () => {
    it("identifies long-strip webtoon dimensions accurately", () => {
      // Standard manga page (800 x 1200) -> not a webtoon strip
      expect(isWebtoonStrip(800, 1200)).toBe(false);

      // Wide banner (1200 x 800) -> not a webtoon strip
      expect(isWebtoonStrip(1200, 800)).toBe(false);

      // Webtoon strip (800 x 20,000, aspect ratio 25.0 >= 2.5, height >= 4000)
      expect(isWebtoonStrip(800, 20000)).toBe(true);

      // Webtoon strip (1000 x 30,000)
      expect(isWebtoonStrip(1000, 30000)).toBe(true);

      // Zero or negative bounds
      expect(isWebtoonStrip(0, 0)).toBe(false);
      expect(isWebtoonStrip(-100, 5000)).toBe(false);
    });
  });

  describe("planWebtoonChunking", () => {
    it("returns single atomic chunk for standard height images", () => {
      const plan = planWebtoonChunking(800, 1200);
      expect(plan.isLongStrip).toBe(false);
      expect(plan.chunks).toHaveLength(1);
      expect(plan.chunks[0].sourceY).toBe(0);
      expect(plan.chunks[0].height).toBe(1200);
      expect(plan.chunks[0].overlapTop).toBe(0);
      expect(plan.chunks[0].overlapBottom).toBe(0);
    });

    it("partitions 10,000px strip into overlapping slices covering the entire height", () => {
      const stripWidth = 800;
      const stripHeight = 10000;
      const targetChunkHeight = 2400;
      const overlapHeight = 240;

      const plan = planWebtoonChunking(stripWidth, stripHeight, {
        targetChunkHeight,
        overlapHeight,
      });

      expect(plan.isLongStrip).toBe(true);
      expect(plan.chunks.length).toBeGreaterThan(1);

      // First chunk starts at 0 with 0 top overlap
      expect(plan.chunks[0].sourceY).toBe(0);
      expect(plan.chunks[0].overlapTop).toBe(0);
      expect(plan.chunks[0].overlapBottom).toBe(overlapHeight);

      // Last chunk reaches down to stripHeight with 0 bottom overlap
      const lastChunk = plan.chunks[plan.chunks.length - 1];
      expect(lastChunk.sourceY + lastChunk.height).toBe(stripHeight);
      expect(lastChunk.overlapBottom).toBe(0);

      // Check continuity: every point from 0 to 10,000 must be covered by at least one chunk
      let coveredY = 0;
      for (const chunk of plan.chunks) {
        expect(chunk.sourceY).toBeLessThanOrEqual(coveredY);
        coveredY = Math.max(coveredY, chunk.sourceY + chunk.height);
      }
      expect(coveredY).toBe(stripHeight);
    });

    it("properly handles intermediate chunk overlaps", () => {
      const targetChunkHeight = 2000;
      const overlapHeight = 200;
      const plan = planWebtoonChunking(1000, 8000, {
        targetChunkHeight,
        overlapHeight,
      });

      for (let i = 1; i < plan.chunks.length - 1; i++) {
        const chunk = plan.chunks[i];
        expect(chunk.overlapTop).toBe(overlapHeight);
        expect(chunk.overlapBottom).toBe(overlapHeight);
      }
    });
  });

  describe("snapToGutter", () => {
    it("snaps to nearest gutter within search window", () => {
      const proposedY = 2400;
      const gutters = [1200, 2350, 2800];
      const snapped = snapToGutter(proposedY, gutters, 180);
      expect(snapped).toBe(2350);
    });

    it("retains proposed Y if no gutter is within search window", () => {
      const proposedY = 2400;
      const gutters = [1000, 3000];
      const snapped = snapToGutter(proposedY, gutters, 180);
      expect(snapped).toBe(2400);
    });
  });
});
