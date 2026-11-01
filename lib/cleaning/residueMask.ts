/** Box in 0-1000 promille coordinates: [ymin, xmin, ymax, xmax]. */
export type PromilleBox = readonly [number, number, number, number];

export interface ResidueMaskResult {
  /** Full-page mask: 255 = residual text pixel. */
  mask: Uint8Array;
  width: number;
  height: number;
  /** Total masked pixels across all boxes. */
  pixels: number;
  /** Components large enough to count as text. */
  components: number;
}

export interface ResidueMaskOptions {
  /** |clean - source| tolerance for "untouched by cleaning" (default 6). */
  unchangedTolerance?: number;
  /** Source luma below this counts as text-dark (default 120). */
  darkThreshold?: number;
  /** Connected components smaller than this are screentone/noise (default 40). */
  minComponentPixels?: number;
}

/**
 * Build a page-level residue mask by diffing the cleaned image against the
 * source: leftover text is still pixel-identical to the source and dark, and
 * forms components too large to be screentone dots. Model-independent — this
 * works even when the CTD mask head under-segments non-Japanese text.
 * Pure — no DOM.
 */
export function buildResidueMask(
  cleanLuma: Uint8ClampedArray | Uint8Array,
  sourceLuma: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  boxes: readonly PromilleBox[],
  options?: ResidueMaskOptions,
): ResidueMaskResult {
  const tolerance = options?.unchangedTolerance ?? 6;
  const darkThreshold = options?.darkThreshold ?? 120;
  const minComponentPixels = options?.minComponentPixels ?? 40;
  const mask = new Uint8Array(width * height);
  const cover = new Uint8Array(width * height);
  for (const box of boxes) {
    if (!Array.isArray(box) || box.length !== 4) continue;
    const [ymin, xmin, ymax, xmax] = box;
    const x0 = Math.max(0, Math.floor((xmin / 1000) * width));
    const x1 = Math.min(width, Math.ceil((xmax / 1000) * width));
    const y0 = Math.max(0, Math.floor((ymin / 1000) * height));
    const y1 = Math.min(height, Math.ceil((ymax / 1000) * height));
    for (let y = y0; y < y1; y++) {
      cover.fill(255, y * width + x0, y * width + x1);
    }
  }
  const candidate = new Uint8Array(width * height);
  for (let i = 0; i < candidate.length; i++) {
    if (
      cover[i]
      && Math.abs(cleanLuma[i] - sourceLuma[i]) <= tolerance
      && sourceLuma[i] < darkThreshold
    ) {
      candidate[i] = 255;
    }
  }
  // Keep only components large enough to be glyph strokes (screentone dots
  // and single-pixel noise are smaller).
  const visited = new Uint8Array(candidate.length);
  const queue = new Int32Array(candidate.length);
  let pixels = 0;
  let components = 0;
  for (let start = 0; start < candidate.length; start++) {
    if (!candidate[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    const component: number[] = [];
    while (head < tail) {
      const idx = queue[head++];
      component.push(idx);
      const x = idx % width;
      const y = (idx / width) | 0;
      if (x > 0 && candidate[idx - 1] && !visited[idx - 1]) {
        visited[idx - 1] = 1;
        queue[tail++] = idx - 1;
      }
      if (x < width - 1 && candidate[idx + 1] && !visited[idx + 1]) {
        visited[idx + 1] = 1;
        queue[tail++] = idx + 1;
      }
      if (y > 0 && candidate[idx - width] && !visited[idx - width]) {
        visited[idx - width] = 1;
        queue[tail++] = idx - width;
      }
      if (y < height - 1 && candidate[idx + width] && !visited[idx + width]) {
        visited[idx + width] = 1;
        queue[tail++] = idx + width;
      }
    }
    if (component.length >= minComponentPixels) {
      components++;
      for (const idx of component) {
        mask[idx] = 255;
        pixels++;
      }
    }
  }
  return { mask, width, height, pixels, components };
}
