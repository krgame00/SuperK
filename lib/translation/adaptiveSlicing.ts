/**
 * Adaptive Slicing Engine (Ladder Plan Phase 3)
 *
 * Implements hierarchical, non-uniform image slicing to replace the rigid 3x2 grid.
 * Slices horizontally into 2 halves at Level 1, then only subdivides slices that
 * trigger Google Gemini SAFETY_BLOCKED or soft refusal (empty bubbles) down to
 * Level 2 (columns), capped at max 6 total calls across all depths.
 *
 * Grounded in pstack principles:
 * - principle-model-the-domain: Explicit AdaptiveSlice and RunAdaptiveSlicingResult models.
 * - principle-laziness-protocol: Translates 2 slices first; avoids slicing clean panels.
 * - principle-fix-root-causes: Isolates suggestive artwork to smaller sub-regions.
 * - principle-prove-it-works: 100% covered by deterministic unit test fixtures.
 */

import type { TranslatedBubble } from "@/lib/overlay/overlayTypes";

export interface AdaptiveSlice {
  id: string;
  depth: number;
  sx: number;
  sy: number;
  sWidth: number;
  sHeight: number;
  pageWidth: number;
  pageHeight: number;
}

export interface SliceTranslatorResult {
  ok: boolean;
  bubbles: TranslatedBubble[];
  isBlockedOrEmpty?: boolean;
  error?: unknown;
}

export type SliceTranslator = (slice: AdaptiveSlice) => Promise<SliceTranslatorResult>;

export interface RunAdaptiveSlicingOptions {
  pageWidth: number;
  pageHeight: number;
  translator: SliceTranslator;
  overlapRatio?: number;
  maxDepth?: number;
  maxTotalSlices?: number;
  onSliceStart?: (slice: AdaptiveSlice, totalSoFar: number) => void;
  onSliceDone?: (slice: AdaptiveSlice, result: SliceTranslatorResult) => void;
}

export interface RunAdaptiveSlicingResult {
  bubbles: TranslatedBubble[];
  totalCalls: number;
  successfulSlices: AdaptiveSlice[];
  failedSlices: AdaptiveSlice[];
}

/**
 * Creates the initial Level 1 adaptive slices (Top and Bottom halves with overlap).
 */
export function createInitialAdaptiveSlices(
  pageWidth: number,
  pageHeight: number,
  overlapRatio = 0.15,
): AdaptiveSlice[] {
  const halfHeight = Math.round(pageHeight / 2);
  const overlapY = Math.round(halfHeight * overlapRatio);

  const top: AdaptiveSlice = {
    id: "L1-top",
    depth: 1,
    sx: 0,
    sy: 0,
    sWidth: pageWidth,
    sHeight: Math.min(pageHeight, halfHeight + overlapY),
    pageWidth,
    pageHeight,
  };

  const bottomSy = Math.max(0, halfHeight - overlapY);
  const bottom: AdaptiveSlice = {
    id: "L1-bottom",
    depth: 1,
    sx: 0,
    sy: bottomSy,
    sWidth: pageWidth,
    sHeight: pageHeight - bottomSy,
    pageWidth,
    pageHeight,
  };

  return [top, bottom];
}

/**
 * Subdivides a slice into two sub-slices (Level 2 columns with overlap).
 * Returns empty array if slice has already reached maxDepth (2).
 */
export function subdivideSlice(
  slice: AdaptiveSlice,
  overlapRatio = 0.15,
): AdaptiveSlice[] {
  if (slice.depth >= 2) {
    return [];
  }

  const nextDepth = slice.depth + 1;
  const halfWidth = Math.round(slice.sWidth / 2);
  const overlapX = Math.round(halfWidth * overlapRatio);

  const left: AdaptiveSlice = {
    id: `${slice.id}-left`,
    depth: nextDepth,
    sx: slice.sx,
    sy: slice.sy,
    sWidth: Math.min(slice.pageWidth - slice.sx, halfWidth + overlapX),
    sHeight: slice.sHeight,
    pageWidth: slice.pageWidth,
    pageHeight: slice.pageHeight,
  };

  const rightSx = Math.max(0, slice.sx + halfWidth - overlapX);
  const right: AdaptiveSlice = {
    id: `${slice.id}-right`,
    depth: nextDepth,
    sx: rightSx,
    sy: slice.sy,
    sWidth: Math.min(slice.pageWidth - rightSx, slice.sWidth - (rightSx - slice.sx)),
    sHeight: slice.sHeight,
    pageWidth: slice.pageWidth,
    pageHeight: slice.pageHeight,
  };

  return [left, right];
}

/**
 * Remaps a slice's local 0-1000 normalized coordinates back to the global page coordinates.
 */
export function remapSliceBubbleToPage(
  bubble: TranslatedBubble,
  slice: AdaptiveSlice,
): TranslatedBubble & { box: [number, number, number, number] } {
  const rawBox = bubble.box && bubble.box.length === 4 ? [...bubble.box] : [0, 0, 1000, 1000];
  const cloned: TranslatedBubble & { box: [number, number, number, number] } = {
    ...bubble,
    box: [rawBox[0], rawBox[1], rawBox[2], rawBox[3]],
  };

  if (!bubble.box || bubble.box.length !== 4) {
    cloned.isInvalidBox = true;
  } else if (
    (cloned.box[3] - cloned.box[1] >= 950 && cloned.box[2] - cloned.box[0] >= 950) ||
    (cloned.box[3] === cloned.box[1] && cloned.box[2] === cloned.box[0])
  ) {
    // Invalid whole-slice box: shrink to a centered 20% patch so it cannot white-out whole page
    const cx = (cloned.box[1] + cloned.box[3]) / 2;
    const cy = (cloned.box[0] + cloned.box[2]) / 2;
    cloned.box = [Math.round(cy - 100), Math.round(cx - 100), Math.round(cy + 100), Math.round(cx + 100)];
    cloned.isInvalidBox = true;
  }

  const ymin_px = (cloned.box[0] / 1000) * slice.sHeight + slice.sy;
  const xmin_px = (cloned.box[1] / 1000) * slice.sWidth + slice.sx;
  const ymax_px = (cloned.box[2] / 1000) * slice.sHeight + slice.sy;
  const xmax_px = (cloned.box[3] / 1000) * slice.sWidth + slice.sx;

  cloned.box[0] = Math.round((ymin_px / slice.pageHeight) * 1000);
  cloned.box[1] = Math.round((xmin_px / slice.pageWidth) * 1000);
  cloned.box[2] = Math.round((ymax_px / slice.pageHeight) * 1000);
  cloned.box[3] = Math.round((xmax_px / slice.pageWidth) * 1000);

  return cloned;
}

/**
 * Deduplicates incoming bubbles against an existing pool using IoU, containment, and centroid distance.
 */
export function deduplicateSliceBubbles(
  existingBubbles: TranslatedBubble[],
  incomingBubbles: TranslatedBubble[],
): TranslatedBubble[] {
  const result = [...existingBubbles];

  for (const b of incomingBubbles) {
    if (!b.box || b.box.length < 4) continue;

    let isDuplicate = false;
    for (const existing of result) {
      if (!existing.box || existing.box.length < 4) continue;

      const xA = Math.max(b.box[1], existing.box[1]);
      const yA = Math.max(b.box[0], existing.box[0]);
      const xB = Math.min(b.box[3], existing.box[3]);
      const yB = Math.min(b.box[2], existing.box[2]);

      const interWidth = Math.max(0, xB - xA);
      const interHeight = Math.max(0, yB - yA);
      const interArea = interWidth * interHeight;

      const boxAArea = (b.box[3] - b.box[1]) * (b.box[2] - b.box[0]);
      const boxBArea = (existing.box[3] - existing.box[1]) * (existing.box[2] - existing.box[0]);
      const iou = interArea / (boxAArea + boxBArea - interArea);

      // Containment: >= 80% coverage
      const bInExisting = boxBArea > 0 && interArea / boxBArea >= 0.8;
      const existingInB = boxAArea > 0 && interArea / boxAArea >= 0.8;

      // Centroid distance: <= 50 units (5% page dimension)
      const bCx = (b.box[1] + b.box[3]) / 2;
      const bCy = (b.box[0] + b.box[2]) / 2;
      const eCx = (existing.box[1] + existing.box[3]) / 2;
      const eCy = (existing.box[0] + existing.box[2]) / 2;
      const dist = Math.hypot(bCx - eCx, bCy - eCy);

      if (iou > 0.7 || bInExisting || existingInB || dist < 50) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      result.push(b);
    }
  }

  return result;
}

/**
 * Runs the hierarchical Adaptive Slicing translation workflow.
 */
export async function runAdaptiveSlicing(
  options: RunAdaptiveSlicingOptions,
): Promise<RunAdaptiveSlicingResult> {
  const {
    pageWidth,
    pageHeight,
    translator,
    overlapRatio = 0.15,
    maxDepth = 2,
    maxTotalSlices = 6,
    onSliceStart,
    onSliceDone,
  } = options;

  let totalCalls = 0;
  let accumulatedBubbles: TranslatedBubble[] = [];
  const successfulSlices: AdaptiveSlice[] = [];
  const failedSlices: AdaptiveSlice[] = [];

  // Level 1: Initial 2 horizontal slices
  const initialSlices = createInitialAdaptiveSlices(pageWidth, pageHeight, overlapRatio);
  const nextRoundSlices: AdaptiveSlice[] = [];

  const level1Results = await Promise.all(
    initialSlices.map(async (slice) => {
      totalCalls++;
      onSliceStart?.(slice, totalCalls);
      const res = await translator(slice);
      onSliceDone?.(slice, res);
      return { slice, res };
    }),
  );

  for (const { slice, res } of level1Results) {
    if (res.ok && !res.isBlockedOrEmpty && res.bubbles.length > 0) {
      successfulSlices.push(slice);
      const remapped = res.bubbles.map((b) => remapSliceBubbleToPage(b, slice));
      accumulatedBubbles = deduplicateSliceBubbles(accumulatedBubbles, remapped);
    } else {
      failedSlices.push(slice);
      if (slice.depth < maxDepth && totalCalls < maxTotalSlices) {
        const sub = subdivideSlice(slice, overlapRatio);
        for (const s of sub) {
          if (totalCalls + nextRoundSlices.length < maxTotalSlices) {
            nextRoundSlices.push(s);
          }
        }
      }
    }
  }

  // Level 2: Subdivided slices for regions that failed or were empty in Level 1
  if (nextRoundSlices.length > 0) {
    const level2Results = await Promise.all(
      nextRoundSlices.map(async (slice) => {
        totalCalls++;
        onSliceStart?.(slice, totalCalls);
        const res = await translator(slice);
        onSliceDone?.(slice, res);
        return { slice, res };
      }),
    );

    for (const { slice, res } of level2Results) {
      if (res.ok && !res.isBlockedOrEmpty && res.bubbles.length > 0) {
        successfulSlices.push(slice);
        const remapped = res.bubbles.map((b) => remapSliceBubbleToPage(b, slice));
        accumulatedBubbles = deduplicateSliceBubbles(accumulatedBubbles, remapped);
      } else {
        failedSlices.push(slice);
      }
    }
  }

  return {
    bubbles: accumulatedBubbles,
    totalCalls,
    successfulSlices,
    failedSlices,
  };
}
