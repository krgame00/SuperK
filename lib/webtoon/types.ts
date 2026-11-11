/**
 * Webtoon Long-Strip Chunking & Seam Healing Types
 *
 * Implements Item 1 of the Torii Competitive Analysis Parity Roadmap:
 * Enables translating ultra-long vertical webtoon/manhwa strips (up to 60,000+ px)
 * by decomposing them into overlapping chunks, dispatching to OCR/Inpainting,
 * and seamlessly healing the seams on stitch-back.
 */

export interface WebtoonChunk {
  /** Sequential index of this chunk (0-indexed from top of strip) */
  index: number;
  /** Y start position on original strip (including top overlap) */
  sourceY: number;
  /** Total height of this chunk in pixels (content + overlaps) */
  height: number;
  /** Width of the chunk in pixels (matches strip width) */
  width: number;
  /** Overlap height on the top edge (0 for first chunk) */
  overlapTop: number;
  /** Overlap height on the bottom edge (0 for last chunk) */
  overlapBottom: number;
  /** Core non-overlapping content Y start in original strip */
  coreY: number;
  /** Core non-overlapping content height in pixels */
  coreHeight: number;
}

export interface WebtoonChunkPlan {
  stripWidth: number;
  stripHeight: number;
  targetChunkHeight: number;
  overlapHeight: number;
  chunks: WebtoonChunk[];
  isLongStrip: boolean;
}

export interface ChunkBubbleRecord {
  /** Normalized bounding box [ymin, xmin, ymax, xmax] in 0-1000 scale relative to chunk */
  box: number[];
  text?: string;
  original_text?: string;
  chunkIndex: number;
  [key: string]: unknown;
}

export interface GlobalBubbleRecord {
  /** Normalized bounding box [ymin, xmin, ymax, xmax] in 0-1000 scale relative to FULL strip */
  box: number[];
  text?: string;
  original_text?: string;
  sourceChunkIndex: number;
  /** Bounding box in raw pixel coordinates on the full strip [x, y, width, height] */
  pixelBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  [key: string]: unknown;
}
