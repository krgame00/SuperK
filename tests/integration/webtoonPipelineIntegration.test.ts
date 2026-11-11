import { describe, expect, it } from "vitest";
import {
  isWebtoonStrip,
  planWebtoonChunking,
  remapChunkBubbleToGlobal,
  deduplicateGlobalBubbles,
  type ChunkBubbleRecord,
  type GlobalBubbleRecord,
} from "@/lib/webtoon";

describe("Webtoon Long-Strip Pipeline Integration", () => {
  it("orchestrates full decomposition, chunk remapping, and seam deduplication for an 800x8000 strip", () => {
    const stripWidth = 800;
    const stripHeight = 8000;

    // 1. Verify long-strip identification
    expect(isWebtoonStrip(stripWidth, stripHeight)).toBe(true);

    // 2. Plan chunking (targetChunkHeight: 2400, overlapHeight: 240)
    const plan = planWebtoonChunking(stripWidth, stripHeight, {
      targetChunkHeight: 2400,
      overlapHeight: 240,
    });

    expect(plan.isLongStrip).toBe(true);
    expect(plan.chunks.length).toBeGreaterThanOrEqual(3);

    // 3. Simulate bubble detections across chunks
    // Bubble A: Upper section of Chunk 0
    const bubbleChunk0: ChunkBubbleRecord = {
      box: [100, 150, 200, 450],
      text: "ยินดีต้อนรับสู่หอคอย",
      original_text: "塔へようこそ",
      chunkIndex: 0,
    };

    // Bubble B: In the overlap seam between Chunk 0 and Chunk 1
    // Chunk 0 detects it near its bottom (e.g. local Y: 2200px)
    // Chunk 0 height = 2400px -> 2200 / 2400 = ~916.6 norm
    const bubbleSeamChunk0: ChunkBubbleRecord = {
      box: [917, 200, 960, 500],
      text: "พลังนี้คือ...",
      original_text: "この力は…",
      chunkIndex: 0,
    };

    // Chunk 1 detects the same bubble in its top overlap zone:
    // With chunk 1 sourceY = 1920 and height = 2640, global Y = 2201px corresponds to local Y = 281px
    // Chunk 1 height = 2640px -> 281 / 2640 = ~106 norm
    const bubbleSeamChunk1: ChunkBubbleRecord = {
      box: [106, 201, 149, 498],
      text: "พลังนี้คืออะไรกันแน่?!", // more complete text
      original_text: "この力は一体何だ？！",
      chunkIndex: 1,
    };

    // Bubble C: Lower section of Chunk 2
    const chunk2 = plan.chunks[plan.chunks.length - 1];
    const bubbleChunk2: ChunkBubbleRecord = {
      box: [800, 300, 900, 700],
      text: "จบตอนที่ 1",
      original_text: "第1話 完",
      chunkIndex: chunk2.index,
    };

    // 4. Remap all bubbles to global coordinates
    const globalA = remapChunkBubbleToGlobal(bubbleChunk0, plan.chunks[0], stripWidth, stripHeight);
    const globalSeam0 = remapChunkBubbleToGlobal(bubbleSeamChunk0, plan.chunks[0], stripWidth, stripHeight);
    const globalSeam1 = remapChunkBubbleToGlobal(bubbleSeamChunk1, plan.chunks[1], stripWidth, stripHeight);
    const globalC = remapChunkBubbleToGlobal(bubbleChunk2, chunk2, stripWidth, stripHeight);

    // Verify seam detections map to near-identical global coordinates (~2200px / 8000px = ~275 norm)
    expect(globalSeam0.box[0]).toBeCloseTo(globalSeam1.box[0], -1); // within 10 units in 0-1000 scale
    expect(globalSeam0.pixelBox.y).toBeCloseTo(globalSeam1.pixelBox.y, -1);

    // 5. Deduplicate across seams
    const allGlobal: GlobalBubbleRecord[] = [globalA, globalSeam0, globalSeam1, globalC];
    const deduplicated = deduplicateGlobalBubbles(allGlobal);

    // Expect 3 bubbles (Seam duplicate merged, keeping more complete text from Chunk 1)
    expect(deduplicated).toHaveLength(3);

    const seamBubble = deduplicated.find((b) => b.text?.includes("พลังนี้คือ"));
    expect(seamBubble).toBeDefined();
    expect(seamBubble?.text).toBe("พลังนี้คืออะไรกันแน่?!");
  });
});
