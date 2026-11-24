/**
 * Ladder Plan Phase 2 — Bubble Crop Pack planning (pure, no DOM).
 *
 * When a whole-page translation is safety-blocked on every model (Phase 1
 * hop chain exhausted), the next-cheapest rung is ONE request containing:
 *   - a low-resolution thumbnail of the full page (layout context only), and
 *   - one tight crop per detected text region (from the cleaning pipeline's
 *     CTD regions, which the client already holds before translation).
 *
 * The model is asked to translate only the crops and to report each bubble's
 * box relative to its crop (0–1000, [ymin, xmin, ymax, xmax] — the same
 * convention as whole-page responses). This module plans the crops and
 * remaps crop-relative boxes back to page coordinates.
 *
 * Cost shape: 1 request, image tokens ≈ thumbnail + sum of small crops,
 * versus adaptive slicing's up-to-6 full-prompt calls.
 */

export interface PixelRectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BubbleCropPlanItem {
  /** 1-based index matching the order crops are sent to the model. */
  index: number;
  rect: PixelRectLike;
}

export interface BubbleCropPlan {
  crops: BubbleCropPlanItem[];
  pageWidth: number;
  pageHeight: number;
}

/** Hard cap on crops per request; above this, slicing is the better rung. */
export const MAX_BUBBLE_CROPS = 24;

/** Minimum region size (px) worth cropping; smaller detections are noise. */
const MIN_REGION_PX = 10;
/** Two padded rects closer than this (px) are merged into one crop. */
const MERGE_GAP_PX = 10;

function clampRect(rect: PixelRectLike, pageWidth: number, pageHeight: number): PixelRectLike {
  const x = Math.max(0, Math.min(rect.x, pageWidth - 1));
  const y = Math.max(0, Math.min(rect.y, pageHeight - 1));
  const width = Math.max(1, Math.min(rect.width, pageWidth - x));
  const height = Math.max(1, Math.min(rect.height, pageHeight - y));
  return { x, y, width, height };
}

function padRect(rect: PixelRectLike, pageWidth: number, pageHeight: number): PixelRectLike {
  const pad = Math.max(10, Math.round(0.18 * Math.max(rect.width, rect.height)));
  return clampRect(
    {
      x: rect.x - pad,
      y: rect.y - pad,
      width: rect.width + pad * 2,
      height: rect.height + pad * 2,
    },
    pageWidth,
    pageHeight,
  );
}

function rectsNear(a: PixelRectLike, b: PixelRectLike, gap: number): boolean {
  return (
    a.x - gap < b.x + b.width &&
    b.x - gap < a.x + a.width &&
    a.y - gap < b.y + b.height &&
    b.y - gap < a.y + a.height
  );
}

function unionRect(a: PixelRectLike, b: PixelRectLike): PixelRectLike {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

function mergeNearbyRects(rects: PixelRectLike[]): PixelRectLike[] {
  const merged = [...rects];
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < merged.length; i++) {
      for (let j = i + 1; j < merged.length; j++) {
        if (rectsNear(merged[i], merged[j], MERGE_GAP_PX)) {
          merged[i] = unionRect(merged[i], merged[j]);
          merged.splice(j, 1);
          changed = true;
          break outer;
        }
      }
    }
  }
  return merged;
}

/** Reading order: group into horizontal bands (rows), left-to-right per row. */
function sortReadingOrder(rects: PixelRectLike[]): PixelRectLike[] {
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: PixelRectLike[][] = [];
  for (const rect of sorted) {
    const row = rows.find((candidate) => {
      const anchor = candidate[0];
      const overlapTop = Math.max(anchor.y, rect.y);
      const overlapBottom = Math.min(anchor.y + anchor.height, rect.y + rect.height);
      const overlap = overlapBottom - overlapTop;
      return overlap > 0.4 * Math.min(anchor.height, rect.height);
    });
    if (row) row.push(rect);
    else rows.push([rect]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x));
}

/**
 * Plan crops for a page from detected text regions (pixel rects in page
 * space). Returns null when a crop pack is not viable (no usable regions,
 * or too many crops after merging — the caller should fall through to
 * adaptive slicing instead).
 */
export function planBubbleCrops(
  regions: readonly PixelRectLike[],
  pageWidth: number,
  pageHeight: number,
): BubbleCropPlan | null {
  if (!Number.isFinite(pageWidth) || !Number.isFinite(pageHeight) || pageWidth <= 0 || pageHeight <= 0) {
    return null;
  }
  const usable = regions
    .filter(
      (r) =>
        Number.isFinite(r.x) &&
        Number.isFinite(r.y) &&
        Number.isFinite(r.width) &&
        Number.isFinite(r.height) &&
        r.width >= MIN_REGION_PX &&
        r.height >= MIN_REGION_PX,
    )
    .map((r) => padRect(r, pageWidth, pageHeight));
  if (usable.length === 0) return null;
  const merged = mergeNearbyRects(usable);
  if (merged.length === 0 || merged.length > MAX_BUBBLE_CROPS) return null;
  const ordered = sortReadingOrder(merged);
  return {
    pageWidth,
    pageHeight,
    crops: ordered.map((rect, i) => ({ index: i + 1, rect })),
  };
}

/**
 * Remap a crop-relative box ([ymin, xmin, ymax, xmax], 0–1000 within the
 * crop) to a page-relative box in the same convention.
 */
export function remapCropBubbleBox(
  box: readonly number[],
  crop: PixelRectLike,
  pageWidth: number,
  pageHeight: number,
): [number, number, number, number] {
  const [ymin, xmin, ymax, xmax] = box;
  const px0 = crop.x + (xmin / 1000) * crop.width;
  const px1 = crop.x + (xmax / 1000) * crop.width;
  const py0 = crop.y + (ymin / 1000) * crop.height;
  const py1 = crop.y + (ymax / 1000) * crop.height;
  const clamp1000 = (v: number) => Math.max(0, Math.min(1000, Math.round(v)));
  const outYmin = clamp1000((py0 / pageHeight) * 1000);
  const outYmax = clamp1000((py1 / pageHeight) * 1000);
  const outXmin = clamp1000((px0 / pageWidth) * 1000);
  const outXmax = clamp1000((px1 / pageWidth) * 1000);
  return [
    Math.min(outYmin, outYmax),
    Math.min(outXmin, outXmax),
    Math.max(outYmin, outYmax),
    Math.max(outXmin, outXmax),
  ];
}
