import { extractGlyphInk } from "./maskUtils";

/** Box in 0-1000 promille coordinates: [ymin, xmin, ymax, xmax]. */
export type PromilleBox = readonly [number, number, number, number];

export interface ResidueMaskResult {
  /** Full-page mask: 255 = residual glyph pixel. */
  ink: Uint8Array;
  width: number;
  height: number;
  /** Total masked pixels across all boxes. */
  pixels: number;
  /** Boxes whose ink count reached minInkPixels. */
  boxesUsed: number;
}

/**
 * Build a page-level residue mask from translated-bubble boxes: for each box,
 * run glyph extraction on the (already cleaned) luma and keep whatever text
 * the detector-based pass left behind. Pure — no DOM.
 */
export function buildResidueMask(
  luma: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  boxes: readonly PromilleBox[],
  options?: { minInkPixels?: number },
): ResidueMaskResult {
  const minInkPixels = options?.minInkPixels ?? 120;
  const ink = new Uint8Array(width * height);
  let pixels = 0;
  let boxesUsed = 0;
  for (const box of boxes) {
    if (!Array.isArray(box) || box.length !== 4) continue;
    const [ymin, xmin, ymax, xmax] = box;
    const x0 = Math.max(0, Math.floor((xmin / 1000) * width));
    const x1 = Math.min(width, Math.ceil((xmax / 1000) * width));
    const y0 = Math.max(0, Math.floor((ymin / 1000) * height));
    const y1 = Math.min(height, Math.ceil((ymax / 1000) * height));
    const cw = x1 - x0;
    const ch = y1 - y0;
    if (cw < 4 || ch < 4) continue;
    const crop = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        crop[y * cw + x] = luma[(y0 + y) * width + (x0 + x)];
      }
    }
    const { ink: cropInk } = extractGlyphInk(crop, cw, ch);
    let count = 0;
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        if (!cropInk[y * cw + x]) continue;
        count++;
        const idx = (y0 + y) * width + (x0 + x);
        if (!ink[idx]) {
          ink[idx] = 255;
          pixels++;
        }
      }
    }
    if (count >= minInkPixels) boxesUsed++;
  }
  return { ink, width, height, pixels, boxesUsed };
}
