/**
 * Image De-scrambler & Extension Interceptor Engine
 *
 * Implements Section 1 of the SuperK Next-Gen Architectural Blueprint:
 * - 1.1 GigaViewer Permutation Inversion & Remainder Edge Padding
 * - 1.2 Canvas Hooking coordinate inversion
 *
 * Grounded in pstack principles:
 * - principle-model-the-domain: Explicit Permutation, Grid, and RemainderPadding models.
 * - principle-fix-root-causes: Solves image scrambling at source tile coordinates rather than patching screenshots.
 * - principle-laziness-protocol: Pure closed-form 2D arithmetic with zero external dependencies.
 */

export interface DescrambleGrid {
  cols: number; // N, typically 4
  rows: number; // M, typically 4
}

export interface RemainderPadding {
  blockW: number;
  blockH: number;
  rw: number;
  rh: number;
}

export interface DescrambleOptions {
  grid?: DescrambleGrid;
  /** Explicit destination-to-source mapping: dstIndex -> srcIndex */
  tileMap?: number[];
  /** Seed key parameters: P(i) = (i * k + c) mod (N * M) */
  seedKey?: { k: number; c: number };
}

export interface TileSliceMapping {
  srcX: number;
  srcY: number;
  dstX: number;
  dstY: number;
  width: number;
  height: number;
}

/**
 * Computes block size and remainder edges for N x M grid.
 */
export function computeRemainderPadding(
  width: number,
  height: number,
  cols = 4,
  rows = 4,
): RemainderPadding {
  const safeCols = Math.max(1, Math.floor(cols));
  const safeRows = Math.max(1, Math.floor(rows));
  const blockW = Math.floor(width / safeCols);
  const blockH = Math.floor(height / safeRows);
  const rw = width - blockW * safeCols;
  const rh = height - blockH * safeRows;
  return { blockW, blockH, rw, rh };
}

/**
 * Computes permutation mapping from a linear congruential seed key:
 * P(i) = (i * k + c) mod (N * M)
 */
export function computePermutationFromSeed(
  cols: number,
  rows: number,
  k: number,
  c = 0,
): number[] {
  const total = Math.max(1, cols * rows);
  const permutation: number[] = new Array(total);
  for (let i = 0; i < total; i++) {
    permutation[i] = ((i * k + c) % total + total) % total;
  }
  return permutation;
}

/**
 * Inverts a permutation array so that if map[src] = dst, inverted[dst] = src.
 */
export function invertPermutation(permutation: number[]): number[] {
  const n = permutation.length;
  const inverted = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const target = permutation[i];
    if (target >= 0 && target < n) {
      inverted[target] = i;
    }
  }
  return inverted;
}

/**
 * Resolves full list of tile slice mappings (main grid + 3 remainder edge strips).
 */
export function generateTileMappings(
  width: number,
  height: number,
  options?: DescrambleOptions,
): TileSliceMapping[] {
  const cols = options?.grid?.cols ?? 4;
  const rows = options?.grid?.rows ?? 4;
  const totalTiles = cols * rows;

  const { blockW, blockH, rw, rh } = computeRemainderPadding(width, height, cols, rows);

  // Determine effective tile map: tileMap[dstIdx] = srcIdx
  let effectiveMap: number[];
  if (Array.isArray(options?.tileMap) && options.tileMap.length === totalTiles) {
    effectiveMap = options.tileMap;
  } else if (options?.seedKey) {
    effectiveMap = computePermutationFromSeed(
      cols,
      rows,
      options.seedKey.k,
      options.seedKey.c ?? 0,
    );
  } else {
    // Default GigaViewer standard 4x4 permutation
    effectiveMap = computePermutationFromSeed(cols, rows, 5, 0);
  }

  const mappings: TileSliceMapping[] = [];

  // 1. Main NxM Grid Tiles
  for (let dstIdx = 0; dstIdx < totalTiles; dstIdx++) {
    const srcIdx = effectiveMap[dstIdx] ?? dstIdx;

    const dstCol = dstIdx % cols;
    const dstRow = Math.floor(dstIdx / cols);

    const srcCol = srcIdx % cols;
    const srcRow = Math.floor(srcIdx / cols);

    mappings.push({
      srcX: srcCol * blockW,
      srcY: srcRow * blockH,
      dstX: dstCol * blockW,
      dstY: dstRow * blockH,
      width: blockW,
      height: blockH,
    });
  }

  // 2. Remainder Edge Padding (Section 1.1 of blueprint)
  const mainGridW = cols * blockW;
  const mainGridH = rows * blockH;

  // Right vertical remainder strip
  if (rw > 0) {
    mappings.push({
      srcX: mainGridW,
      srcY: 0,
      dstX: mainGridW,
      dstY: 0,
      width: rw,
      height: mainGridH,
    });
  }

  // Bottom horizontal remainder strip
  if (rh > 0) {
    mappings.push({
      srcX: 0,
      srcY: mainGridH,
      dstX: 0,
      dstY: mainGridH,
      width: mainGridW,
      height: rh,
    });
  }

  // Bottom-right corner remainder piece
  if (rw > 0 && rh > 0) {
    mappings.push({
      srcX: mainGridW,
      srcY: mainGridH,
      dstX: mainGridW,
      dstY: mainGridH,
      width: rw,
      height: rh,
    });
  }

  return mappings;
}

/**
 * Known GigaViewer / Web Reader domains that utilize image scrambling.
 */
export const GIGAVIEWER_DOMAINS = [
  "shonenjump.com",
  "shonenjumpplus.com",
  "comic-days.com",
  "comic-gardo.com",
  "tonarinoyj.jp",
  "kuragebunch.com",
  "magapoke.com",
  "comic-action.com",
  "comic-walker.com",
  "bookwalker.jp",
];

export function isKnownScrambledDomain(urlOrHostname: string): boolean {
  const lower = urlOrHostname.toLowerCase();
  return GIGAVIEWER_DOMAINS.some(d => lower.includes(d));
}
