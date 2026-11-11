import { describe, expect, it } from "vitest";
import {
  calculateBoxIoU,
  deduplicateGlobalBubbles,
  remapChunkBubbleToGlobal,
} from "@/lib/webtoon/coordinateRemapper";
import { type ChunkBubbleRecord, type WebtoonChunk } from "@/lib/webtoon/types";

describe("Webtoon Coordinate Remapper & Bubble Deduplicator", () => {
  const dummyChunk: WebtoonChunk = {
    index: 1,
    sourceY: 2000,
    height: 2400,
    width: 800,
    overlapTop: 240,
    overlapBottom: 240,
    coreY: 2240,
    coreHeight: 1920,
  };

  describe("remapChunkBubbleToGlobal", () => {
    it("correctly transforms local chunk coordinates to full-strip coordinates", () => {
      const stripWidth = 800;
      const stripHeight = 10000;

      // Bubble located in middle of Chunk 1:
      // Local chunk: ymin = 250 (which is 25% of 2400 = 600px local Y)
      // ymax = 350 (which is 35% of 2400 = 840px local Y)
      // Global pixel Y: 2000 + 600 = 2600px, 2000 + 840 = 2840px
      // Global normalized Y on 10,000px strip: 2600 / 10000 * 1000 = 260, 2840 / 10000 * 1000 = 284
      const localBubble: ChunkBubbleRecord = {
        box: [250, 100, 350, 500],
        text: "ตัวอย่างข้อความ",
        original_text: "サンプルテキスト",
        chunkIndex: 1,
      };

      const globalBubble = remapChunkBubbleToGlobal(
        localBubble,
        dummyChunk,
        stripWidth,
        stripHeight,
      );

      expect(globalBubble.sourceChunkIndex).toBe(1);
      expect(globalBubble.box[0]).toBe(260); // global ymin
      expect(globalBubble.box[2]).toBe(284); // global ymax
      expect(globalBubble.box[1]).toBe(100); // xmin stays aligned
      expect(globalBubble.box[3]).toBe(500); // xmax stays aligned

      expect(globalBubble.pixelBox.y).toBe(2600);
      expect(globalBubble.pixelBox.height).toBe(240);
    });
  });

  describe("calculateBoxIoU", () => {
    it("computes accurate IoU scores", () => {
      const boxA = [100, 100, 200, 200];
      const boxB = [100, 100, 200, 200]; // identical
      expect(calculateBoxIoU(boxA, boxB)).toBeCloseTo(1.0);

      const boxC = [300, 300, 400, 400]; // disjoint
      expect(calculateBoxIoU(boxA, boxC)).toBe(0.0);

      const boxD = [150, 100, 250, 200]; // 50% overlap
      // intersection: [150..200, 100..200] = 50 * 100 = 5000
      // areaA = 100 * 100 = 10000, areaD = 100 * 100 = 10000
      // union = 20000 - 5000 = 15000
      // IoU = 5000 / 15000 = 0.3333
      expect(calculateBoxIoU(boxA, boxD)).toBeCloseTo(0.3333, 3);
    });
  });

  describe("deduplicateGlobalBubbles", () => {
    it("removes duplicate detection across chunk seams and retains more complete text", () => {
      const bubbleFromChunk0 = {
        box: [215, 100, 240, 400],
        text: "ฉันจะต้อง...", // clipped at bottom edge of chunk 0
        original_text: "私は...",
        sourceChunkIndex: 0,
        pixelBox: { x: 100, y: 2150, width: 300, height: 250 },
      };

      const bubbleFromChunk1 = {
        box: [216, 99, 241, 402], // slightly shifted overlap detection
        text: "ฉันจะต้องรอดกลับไปให้ได้!", // fully visible in chunk 1
        original_text: "私は生き残る！",
        sourceChunkIndex: 1,
        pixelBox: { x: 99, y: 2160, width: 303, height: 250 },
      };

      const distinctBubble = {
        box: [450, 200, 500, 600],
        text: "อย่าเพิ่งยอมแพ้",
        original_text: "諦めるな",
        sourceChunkIndex: 1,
        pixelBox: { x: 200, y: 4500, width: 400, height: 500 },
      };

      const deduplicated = deduplicateGlobalBubbles([
        bubbleFromChunk0,
        bubbleFromChunk1,
        distinctBubble,
      ]);

      // Should merge the two duplicates into 1, keeping the longer text
      expect(deduplicated).toHaveLength(2);
      expect(deduplicated[0].text).toBe("ฉันจะต้องรอดกลับไปให้ได้!");
      expect(deduplicated[1].text).toBe("อย่าเพิ่งยอมแพ้");
    });
  });
});
