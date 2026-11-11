/**
 * Webtoon Long-Strip Decomposition Engine
 *
 * Implements Item 1 of the Torii Competitive Analysis Parity Roadmap:
 * Plans and partitions massive vertical manga/webtoon strips (e.g. 800x40,000px)
 * into overlapping slices suitable for OCR and inpainting without GPU/Canvas memory exhaustion.
 *
 * Grounded in pstack principles:
 * - principle-model-the-domain: Typed WebtoonChunk, WebtoonChunkPlan.
 * - principle-boundary-discipline: Pure mathematical partitioning isolated from network/IO.
 * - principle-laziness-protocol: Minimal closed-form geometric slicing.
 */

import { type WebtoonChunk, type WebtoonChunkPlan } from "./types";

export interface ChunkingOptions {
  /** Target pixel height for each individual chunk (default: 2400px) */
  targetChunkHeight?: number;
  /** Overlap buffer in pixels between consecutive chunks (default: 240px) */
  overlapHeight?: number;
  /** Strip height threshold above which strip chunking is activated (default: 4000px) */
  longStripThreshold?: number;
}

/**
 * Checks if an image qualifies as a long-strip webtoon based on aspect ratio and absolute height.
 */
export function isWebtoonStrip(
  width: number,
  height: number,
  threshold = 4000,
  minAspectRatio = 2.5,
): boolean {
  if (width <= 0 || height <= 0) return false;
  return height >= threshold && height / width >= minAspectRatio;
}

/**
 * Plans the chunk decomposition of a webtoon strip with overlapping boundaries.
 */
export function planWebtoonChunking(
  stripWidth: number,
  stripHeight: number,
  options?: ChunkingOptions,
): WebtoonChunkPlan {
  const targetChunkHeight = Math.max(800, options?.targetChunkHeight ?? 2400);
  const overlapHeight = Math.max(64, options?.overlapHeight ?? 240);
  const longStripThreshold = Math.max(1200, options?.longStripThreshold ?? 4000);

  // If the image is below threshold, keep as a single atomic chunk
  if (stripHeight <= longStripThreshold) {
    return {
      stripWidth,
      stripHeight,
      targetChunkHeight,
      overlapHeight: 0,
      isLongStrip: false,
      chunks: [
        {
          index: 0,
          sourceY: 0,
          height: stripHeight,
          width: stripWidth,
          overlapTop: 0,
          overlapBottom: 0,
          coreY: 0,
          coreHeight: stripHeight,
        },
      ],
    };
  }

  // Calculate chunk distribution
  // Effective step per chunk = targetChunkHeight - overlapHeight
  const step = Math.max(200, targetChunkHeight - overlapHeight);
  const chunks: WebtoonChunk[] = [];

  let currentCoreY = 0;
  let chunkIdx = 0;

  while (currentCoreY < stripHeight) {
    const isFirst = chunkIdx === 0;
    const remainingAfterCore = stripHeight - (currentCoreY + step);
    const isLast = remainingAfterCore <= overlapHeight;

    const overlapTop = isFirst ? 0 : overlapHeight;
    const sourceY = Math.max(0, currentCoreY - (isFirst ? 0 : overlapHeight));

    // Calculate core height for this chunk
    let coreHeight = step;
    if (isLast) {
      coreHeight = stripHeight - currentCoreY;
    }

    // Overlap bottom
    const overlapBottom = isLast ? 0 : overlapHeight;

    // Total chunk height on source strip
    const totalChunkHeight = Math.min(
      stripHeight - sourceY,
      overlapTop + coreHeight + overlapBottom,
    );

    chunks.push({
      index: chunkIdx,
      sourceY,
      height: totalChunkHeight,
      width: stripWidth,
      overlapTop,
      overlapBottom: isLast ? 0 : overlapBottom,
      coreY: currentCoreY,
      coreHeight,
    });

    if (isLast) {
      break;
    }

    currentCoreY += step;
    chunkIdx++;
  }

  return {
    stripWidth,
    stripHeight,
    targetChunkHeight,
    overlapHeight,
    isLongStrip: true,
    chunks,
  };
}

/**
 * Snaps a proposed slice Y coordinate to the nearest blank panel gutter
 * if one exists within the search window.
 */
export function snapToGutter(
  proposedY: number,
  gutterCandidates: readonly number[],
  searchWindow = 180,
): number {
  if (!gutterCandidates || gutterCandidates.length === 0) {
    return proposedY;
  }

  let bestGutter = proposedY;
  let minDistance = searchWindow + 1;

  for (const gutterY of gutterCandidates) {
    const dist = Math.abs(gutterY - proposedY);
    if (dist <= searchWindow && dist < minDistance) {
      minDistance = dist;
      bestGutter = gutterY;
    }
  }

  return bestGutter;
}
