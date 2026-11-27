/**
 * Balloon snapping: refines translated-bubble boxes against the actual
 * balloon shapes in the cleaned page image. The organize optimizer anchors
 * every bubble to its detected box, so when the detection box is tight,
 * shifted or split the translated text lands next to the balloon instead of
 * inside it. This unit measures the white balloon region around each box
 * directly from pixels (flood fill bounded by the balloon outline) and
 * returns an expanded box that covers the real balloon.
 *
 * Pure numeric module: input is raw pixel data, so behavior is fully
 * verifiable from synthetic buffers without a DOM or the original artwork.
 */

import type { TranslatedBubble } from "./overlay/overlayTypes";

export interface RawImageData {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

/** A bubble box in 0-1000 normalized [ymin, xmin, ymax, xmax] form. */
export type NormalizedBox = [number, number, number, number];

// Balloon interiors on a cleaned page are near-white; the outline ring and
// artwork fall well below. Fill threshold sits slightly under the seed
// threshold so JPEG artifacts cannot strand a seed pocket.
const SEED_LUM = 195;
const FILL_LUM = 185;
const MIN_SEEDS = 2;
const MIN_REGION_AREA_PX = 200;
// Conservative growth caps: a true balloon is at most a few times the text
// box; anything larger means the fill escaped onto the page background.
const MAX_DIM_GROWTH = 2.65;
const MAX_AREA_GROWTH = 7;
// A genuine balloon never reaches the search-region border (the outline stops
// the fill well inside); border contact means the fill leaked onto paper.
const BORDER_CONTACT_RATIO = 0.05;
const SEARCH_GROWTH_RATIO = 1.2;
const MIN_SEARCH_GROWTH_PX = 32;

const luminanceAt = (image: RawImageData, x: number, y: number): number => {
  const i = (y * image.width + x) * 4;
  return (
    0.299 * image.data[i] + 0.587 * image.data[i + 1] + 0.114 * image.data[i + 2]
  );
};

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

function snapOneBox(image: RawImageData, box: NormalizedBox): NormalizedBox | null {
  const w = image.width;
  const h = image.height;
  const xminPx = clamp(Math.round((box[1] / 1000) * w), 0, w - 1);
  const xmaxPx = clamp(Math.round((box[3] / 1000) * w), 0, w - 1);
  const yminPx = clamp(Math.round((box[0] / 1000) * h), 0, h - 1);
  const ymaxPx = clamp(Math.round((box[2] / 1000) * h), 0, h - 1);
  const boxW = xmaxPx - xminPx + 1;
  const boxH = ymaxPx - yminPx + 1;
  if (boxW < 4 || boxH < 4) return null;

  // Search region: generous growth so the balloon body around a partial box
  // is fully inside the region (the border-contact guard relies on this).
  const gx = Math.max(MIN_SEARCH_GROWTH_PX, Math.round(boxW * SEARCH_GROWTH_RATIO));
  const gy = Math.max(MIN_SEARCH_GROWTH_PX, Math.round(boxH * SEARCH_GROWTH_RATIO));
  const rx0 = clamp(xminPx - gx, 0, w - 1);
  const rx1 = clamp(xmaxPx + gx, 0, w - 1);
  const ry0 = clamp(yminPx - gy, 0, h - 1);
  const ry1 = clamp(ymaxPx + gy, 0, h - 1);
  const rw = rx1 - rx0 + 1;
  const rh = ry1 - ry0 + 1;

  // Seed points: center plus an inset grid over the box. Balloons whose
  // interior is not white (dark artwork, dense screentone) yield no seeds.
  const seeds: Array<[number, number]> = [];
  for (const fy of [0.5, 0.2, 0.8]) {
    for (const fx of [0.5, 0.2, 0.8]) {
      const sx = clamp(Math.round(xminPx + fx * (boxW - 1)), rx0, rx1);
      const sy = clamp(Math.round(yminPx + fy * (boxH - 1)), ry0, ry1);
      if (luminanceAt(image, sx, sy) >= SEED_LUM) seeds.push([sx, sy]);
    }
  }
  if (seeds.length < MIN_SEEDS) return null;

  // Flood fill the white region bounded by the balloon outline.
  const fill = new Uint8Array(rw * rh);
  const queue: number[] = [];
  for (const [sx, sy] of seeds) {
    const li = (sy - ry0) * rw + (sx - rx0);
    if (!fill[li]) {
      fill[li] = 1;
      queue.push(li);
    }
  }
  let area = 0;
  let minX = rw;
  let maxX = -1;
  let minY = rh;
  let maxY = -1;
  while (queue.length > 0) {
    const li = queue.pop() as number;
    const lx = li % rw;
    const ly = (li - lx) / rw;
    area++;
    if (lx < minX) minX = lx;
    if (lx > maxX) maxX = lx;
    if (ly < minY) minY = ly;
    if (ly > maxY) maxY = ly;
    const x = rx0 + lx;
    const y = ry0 + ly;
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ]) {
      if (nx < rx0 || nx > rx1 || ny < ry0 || ny > ry1) continue;
      const nli = (ny - ry0) * rw + (nx - rx0);
      if (fill[nli]) continue;
      if (luminanceAt(image, nx, ny) < FILL_LUM) continue;
      fill[nli] = 1;
      queue.push(nli);
    }
  }

  if (area < MIN_REGION_AREA_PX || maxX < 0) return null;

  // Leak guard: count bright pixels along the search-region border. A real
  // balloon stops the fill far inside; paper leaks touch the border.
  const perimeter = 2 * (rw + rh);
  let contact = 0;
  for (let x = rx0; x <= rx1; x++) {
    if (luminanceAt(image, x, ry0) >= FILL_LUM) contact++;
    if (luminanceAt(image, x, ry1) >= FILL_LUM) contact++;
  }
  for (let y = ry0 + 1; y <= ry1 - 1; y++) {
    if (luminanceAt(image, rx0, y) >= FILL_LUM) contact++;
    if (luminanceAt(image, rx1, y) >= FILL_LUM) contact++;
  }
  if (contact > perimeter * BORDER_CONTACT_RATIO) return null;

  // Union with the original box so snapping can only grow, never shrink.
  const ux0 = Math.min(rx0 + minX, xminPx);
  const ux1 = Math.max(rx0 + maxX, xmaxPx);
  const uy0 = Math.min(ry0 + minY, yminPx);
  const uy1 = Math.max(ry0 + maxY, ymaxPx);
  const uw = ux1 - ux0 + 1;
  const uh = uy1 - uy0 + 1;
  if (uw > boxW * MAX_DIM_GROWTH || uh > boxH * MAX_DIM_GROWTH) return null;
  if (uw * uh > boxW * boxH * MAX_AREA_GROWTH) return null;

  return [
    Math.round((uy0 / h) * 1000),
    Math.round((ux0 / w) * 1000),
    Math.round((uy1 / h) * 1000),
    Math.round((ux1 / w) * 1000),
  ];
}

/**
 * Snaps each normalized box to the white balloon region measured from the
 * image. Returns one entry per input: the expanded box, or null when the
 * box has no trustworthy balloon around it (dark artwork, paper leak,
 * oversized growth). Callers keep the original box for null entries.
 */
export function snapBoxesToImageBalloons(
  image: RawImageData,
  boxes: Array<NormalizedBox | null>,
): Array<NormalizedBox | null> {
  return boxes.map((box) => {
    if (!box || box.length !== 4 || !box.every((v) => Number.isFinite(v))) {
      return null;
    }
    if (box[0] === 0 && box[1] === 0 && box[2] === 1000 && box[3] === 1000) {
      return null;
    }
    return snapOneBox(image, box);
  });
}

/**
 * Builds the snap input for a page: normalized boxes for regular dialogue
 * bubbles, null for SFX bubbles (stylized text on artwork, not in balloons),
 * invalid/deleted entries and bubbles without a usable box.
 */
export function boxesFromBubbles(
  bubbles: Array<TranslatedBubble | null | undefined>,
): Array<NormalizedBox | null> {
  return bubbles.map((b) => {
    if (!b || b.deleted) return null;
    if (b.isSfx || b.sfx || b.is_sfx) return null;
    const box = b.box;
    if (!box || !Array.isArray(box) || box.length !== 4) return null;
    if (!box.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
    if (box[0] === 0 && box[1] === 0 && box[2] === 1000 && box[3] === 1000) return null;
    if (b.isInvalidBox) return null;
    return [box[0], box[1], box[2], box[3]] as NormalizedBox;
  });
}
