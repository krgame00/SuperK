/**
 * Webtoon Chunk Coordinate Remapper & Bubble Deduplicator
 *
 * Implements Item 1 of the Torii Competitive Analysis Parity Roadmap:
 * Reconstructs global webtoon coordinates from chunked detections and
 * resolves duplicate bubbles detected in the overlap seam zones.
 *
 * Grounded in pstack principles:
 * - principle-model-the-domain: Typed ChunkBubbleRecord, GlobalBubbleRecord.
 * - principle-fix-root-causes: Eliminates duplicate/split text bubbles across chunk seams.
 * - principle-laziness-protocol: Fast 2D IoU and centroid proximity deduplication.
 */

import {
  type ChunkBubbleRecord,
  type GlobalBubbleRecord,
  type WebtoonChunk,
} from "./types";

/**
 * Remaps a bubble's local chunk coordinates to the global webtoon strip.
 */
export function remapChunkBubbleToGlobal(
  bubble: ChunkBubbleRecord,
  chunk: WebtoonChunk,
  stripWidth: number,
  stripHeight: number,
): GlobalBubbleRecord {
  const [yminNorm, xminNorm, ymaxNorm, xmaxNorm] = bubble.box;

  // Local pixel coordinates within this chunk
  const localYminPx = (yminNorm / 1000) * chunk.height;
  const localYmaxPx = (ymaxNorm / 1000) * chunk.height;
  const localXminPx = (xminNorm / 1000) * chunk.width;
  const localXmaxPx = (xmaxNorm / 1000) * chunk.width;

  // Global pixel coordinates on the entire vertical strip
  const globalYminPx = chunk.sourceY + localYminPx;
  const globalYmaxPx = chunk.sourceY + localYmaxPx;
  const globalXminPx = localXminPx;
  const globalXmaxPx = localXmaxPx;

  // Convert back to 0-1000 normalized scale relative to full strip
  const globalYminNorm = Math.max(0, Math.min(1000, (globalYminPx / stripHeight) * 1000));
  const globalYmaxNorm = Math.max(0, Math.min(1000, (globalYmaxPx / stripHeight) * 1000));
  const globalXminNorm = Math.max(0, Math.min(1000, (globalXminPx / stripWidth) * 1000));
  const globalXmaxNorm = Math.max(0, Math.min(1000, (globalXmaxPx / stripWidth) * 1000));

  return {
    ...bubble,
    box: [
      Math.round(globalYminNorm),
      Math.round(globalXminNorm),
      Math.round(globalYmaxNorm),
      Math.round(globalXmaxNorm),
    ],
    sourceChunkIndex: chunk.index,
    pixelBox: {
      x: Math.round(globalXminPx),
      y: Math.round(globalYminPx),
      width: Math.round(Math.max(1, globalXmaxPx - globalXminPx)),
      height: Math.round(Math.max(1, globalYmaxPx - globalYminPx)),
    },
  };
}

/**
 * Calculates 2D Intersection-over-Union (IoU) of two bounding boxes in [ymin, xmin, ymax, xmax] format.
 */
export function calculateBoxIoU(
  boxA: readonly number[],
  boxB: readonly number[],
): number {
  const [yminA, xminA, ymaxA, xmaxA] = boxA;
  const [yminB, xminB, ymaxB, xmaxB] = boxB;

  const interYmin = Math.max(yminA, yminB);
  const interXmin = Math.max(xminA, xminB);
  const interYmax = Math.min(ymaxA, ymaxB);
  const interXmax = Math.min(xmaxA, xmaxB);

  const interArea =
    Math.max(0, interYmax - interYmin) * Math.max(0, interXmax - interXmin);

  const areaA = Math.max(0, ymaxA - yminA) * Math.max(0, xmaxA - xminA);
  const areaB = Math.max(0, ymaxB - yminB) * Math.max(0, xmaxB - xminB);

  const unionArea = areaA + areaB - interArea;
  if (unionArea <= 0) return 0;

  return interArea / unionArea;
}

/**
 * Deduplicates overlapping bubbles detected in adjacent chunk seams.
 * If two bubbles have IoU >= threshold (default 0.40), keeps the one
 * with more complete text or situated further from the slice boundary.
 */
export function deduplicateGlobalBubbles(
  bubbles: GlobalBubbleRecord[],
  iouThreshold = 0.40,
): GlobalBubbleRecord[] {
  if (bubbles.length <= 1) return [...bubbles];

  // Sort bubbles top-to-bottom
  const sorted = [...bubbles].sort((a, b) => a.pixelBox.y - b.pixelBox.y);
  const keep: GlobalBubbleRecord[] = [];
  const suppressed = new Set<number>();

  for (let i = 0; i < sorted.length; i++) {
    if (suppressed.has(i)) continue;

    const current = sorted[i];
    let best = current;

    for (let j = i + 1; j < sorted.length; j++) {
      if (suppressed.has(j)) continue;

      const candidate = sorted[j];
      // Early exit if candidate Y is far below current bottom
      if (candidate.pixelBox.y > current.pixelBox.y + current.pixelBox.height * 2) {
        break;
      }

      const iou = calculateBoxIoU(current.box, candidate.box);
      if (iou >= iouThreshold) {
        suppressed.add(j);

        // Preference: pick bubble with longer / more complete text
        const curLen = (best.text ?? best.original_text ?? "").length;
        const candLen = (candidate.text ?? candidate.original_text ?? "").length;

        if (candLen > curLen) {
          best = candidate;
        }
      }
    }

    keep.push(best);
  }

  return keep;
}
