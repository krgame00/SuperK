/**
 * Geometric Manga Reading Order Engine (RTL Bubble Sorting)
 *
 * Implements authentic Japanese Manga reading order:
 * 1. Primary Y-level Horizontal Clustering (Panels and dialogue bands from Top to Bottom).
 * 2. Secondary Column Stacking (Multi-bubble dialogue for the same character reads Top to Bottom).
 * 3. Tertiary X-descending (Right-to-Left within each horizontal band).
 *
 * Designed according to SuperK Architectural Blueprint Section 5.5 and pstack principles:
 * - principle-model-the-domain: Explicit geometric coordinate normalization and typed reading bands.
 * - principle-fix-root-causes: Prevents naive Y-sort regressions (staggered bubbles) and transitive chaining.
 * - principle-laziness-protocol: Pure mathematical algorithm without external dependencies.
 */

export interface NormalizedBox {
  top: number;
  left: number;
  bottom: number;
  right: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export interface RTLReadingOrderOptions {
  /** Vertical tolerance for clustering boxes into horizontal dialogue bands (in 0-1000 scale). Default: 65 */
  bandTolerance?: number;
  /** Minimum vertical overlap ratio (0-1) to consider two bubbles in the same dialogue band. Default: 0.35 */
  overlapThreshold?: number;
  /** Horizontal column overlap ratio (0-1) to consider two bubbles in the same character stack. Default: 0.35 */
  columnOverlapThreshold?: number;
  /** Max vertical span ratio of a band relative to average bubble height to prevent transitive chaining. Default: 2.2 */
  maxBandHeightMultiplier?: number;
  /** Reading direction. Default: 'rtl' (Right-to-Left manga). 'ltr' supported for western comics/manhwa. */
  direction?: "rtl" | "ltr";
}

interface BoxEntry<T> {
  item: T;
  box: NormalizedBox;
  originalIndex: number;
}

interface ReadingBand<T> {
  ymin: number;
  ymax: number;
  entries: BoxEntry<T>[];
}

interface ColumnCluster<T> {
  xmin: number;
  xmax: number;
  centerX: number;
  entries: BoxEntry<T>[];
}

/**
 * Safely extracts normalized bounding coordinates from a [ymin, xmin, ymax, xmax] array.
 * Tolerates inverted coordinates, floats, and pixel scales.
 */
export function extractNormalizedBox(box: unknown): NormalizedBox | null {
  if (!Array.isArray(box) || box.length < 4) return null;
  const [ymin, xmin, ymax, xmax] = box;
  if (
    typeof ymin !== "number" ||
    typeof xmin !== "number" ||
    typeof ymax !== "number" ||
    typeof xmax !== "number" ||
    !Number.isFinite(ymin) ||
    !Number.isFinite(xmin) ||
    !Number.isFinite(ymax) ||
    !Number.isFinite(xmax)
  ) {
    return null;
  }
  const top = Math.min(ymin, ymax);
  const bottom = Math.max(ymin, ymax);
  const left = Math.min(xmin, xmax);
  const right = Math.max(xmin, xmax);
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const centerX = left + width / 2;
  const centerY = top + height / 2;

  return { top, left, bottom, right, width, height, centerX, centerY };
}

/**
 * Sorts speech bubbles in authentic Japanese Manga reading order (RTL, Top-to-Bottom).
 * Returns a new sorted array without mutating input.
 */
export function sortBubblesRTL<T>(
  bubbles: readonly T[],
  options?: RTLReadingOrderOptions,
): T[] {
  if (!bubbles || bubbles.length <= 1) {
    return bubbles ? [...bubbles] : [];
  }

  const bandTolerance = options?.bandTolerance ?? 65;
  const overlapThreshold = options?.overlapThreshold ?? 0.35;
  const columnOverlapThreshold = options?.columnOverlapThreshold ?? 0.35;
  const maxBandHeightMultiplier = options?.maxBandHeightMultiplier ?? 2.2;
  const direction = options?.direction ?? "rtl";

  const validEntries: BoxEntry<T>[] = [];
  const invalidItems: T[] = [];

  for (let i = 0; i < bubbles.length; i++) {
    const item = bubbles[i];
    const box = typeof item === "object" && item !== null && "box" in item
      ? (item as { box: unknown }).box
      : undefined;
    const norm = extractNormalizedBox(box);
    if (norm) {
      validEntries.push({ item, box: norm, originalIndex: i });
    } else {
      invalidItems.push(item);
    }
  }

  if (validEntries.length <= 1) {
    return [...validEntries.map((e) => e.item), ...invalidItems];
  }

  // 1. Sort entries initially by vertical center (Top-to-Bottom)
  validEntries.sort((a, b) => {
    if (a.box.centerY !== b.box.centerY) {
      return a.box.centerY - b.box.centerY;
    }
    return a.box.top - b.box.top;
  });

  // 2. Partition into horizontal reading bands
  const bands: ReadingBand<T>[] = [];

  for (const entry of validEntries) {
    let bestBandIndex = -1;
    let minCenterDistance = Infinity;

    for (let bIdx = 0; bIdx < bands.length; bIdx++) {
      const band = bands[bIdx];
      const bandHeight = Math.max(1, band.ymax - band.ymin);
      const overlap =
        Math.min(band.ymax, entry.box.bottom) - Math.max(band.ymin, entry.box.top);
      const minHeight = Math.min(bandHeight, entry.box.height);
      const centerDist = Math.abs(
        entry.box.centerY - (band.ymin + bandHeight / 2),
      );
      const combinedHeight =
        Math.max(band.ymax, entry.box.bottom) - Math.min(band.ymin, entry.box.top);
      const maxAllowedHeight =
        Math.max(bandHeight, entry.box.height) * maxBandHeightMultiplier;

      const hasSufficientOverlap =
        overlap > 0 && overlap / minHeight >= overlapThreshold;
      const isWithinTolerance = centerDist <= bandTolerance;

      if (
        combinedHeight <= maxAllowedHeight &&
        (hasSufficientOverlap || isWithinTolerance)
      ) {
        if (centerDist < minCenterDistance) {
          minCenterDistance = centerDist;
          bestBandIndex = bIdx;
        }
      }
    }

    if (bestBandIndex >= 0) {
      const targetBand = bands[bestBandIndex];
      targetBand.entries.push(entry);
      targetBand.ymin = Math.min(targetBand.ymin, entry.box.top);
      targetBand.ymax = Math.max(targetBand.ymax, entry.box.bottom);
    } else {
      bands.push({
        ymin: entry.box.top,
        ymax: entry.box.bottom,
        entries: [entry],
      });
    }
  }

  // 3. Sort bands Top to Bottom
  bands.sort((a, b) => a.ymin - b.ymin);

  // 4. Within each band, cluster into columns and sort
  const sortedResult: T[] = [];

  for (const band of bands) {
    const columns: ColumnCluster<T>[] = [];

    // Sort band entries by X ascending for column grouping
    const bandEntries = [...band.entries].sort((a, b) => a.box.centerX - b.box.centerX);

    for (const entry of bandEntries) {
      let matchedColumnIndex = -1;

      for (let cIdx = 0; cIdx < columns.length; cIdx++) {
        const col = columns[cIdx];
        const colWidth = Math.max(1, col.xmax - col.xmin);
        const xOverlap =
          Math.min(col.xmax, entry.box.right) - Math.max(col.xmin, entry.box.left);
        const minW = Math.min(colWidth, entry.box.width);

        if (xOverlap > 0 && xOverlap / minW >= columnOverlapThreshold) {
          matchedColumnIndex = cIdx;
          break;
        }
      }

      if (matchedColumnIndex >= 0) {
        const col = columns[matchedColumnIndex];
        col.entries.push(entry);
        col.xmin = Math.min(col.xmin, entry.box.left);
        col.xmax = Math.max(col.xmax, entry.box.right);
        col.centerX = (col.xmin + col.xmax) / 2;
      } else {
        columns.push({
          xmin: entry.box.left,
          xmax: entry.box.right,
          centerX: entry.box.centerX,
          entries: [entry],
        });
      }
    }

    // Sort columns horizontally:
    // RTL: Right to Left (centerX descending)
    // LTR: Left to Right (centerX ascending)
    columns.sort((a, b) => {
      if (direction === "rtl") {
        return b.centerX - a.centerX;
      } else {
        return a.centerX - b.centerX;
      }
    });

    // Within each column, sort bubbles vertically from Top to Bottom
    for (const col of columns) {
      col.entries.sort((a, b) => {
        if (a.box.top !== b.box.top) {
          return a.box.top - b.box.top;
        }
        if (a.box.centerY !== b.box.centerY) {
          return a.box.centerY - b.box.centerY;
        }
        return a.originalIndex - b.originalIndex;
      });

      for (const entry of col.entries) {
        sortedResult.push(entry.item);
      }
    }
  }

  // Append invalid/unpositioned items at the end
  sortedResult.push(...invalidItems);

  return sortedResult;
}

/**
 * Assigns a 1-based sequential `readingOrder` integer to each bubble matching authentic RTL flow.
 */
export function assignReadingOrderIndices<T>(
  bubbles: readonly T[],
  options?: RTLReadingOrderOptions,
): Array<T & { readingOrder: number }> {
  const sorted = sortBubblesRTL(bubbles, options);
  return sorted.map((item, index) => ({
    ...item,
    readingOrder: index + 1,
  }));
}

/**
 * Checks if an array of bubbles is already in canonical RTL reading order.
 */
export function isRTLReadingOrder<T>(
  bubbles: readonly T[],
  options?: RTLReadingOrderOptions,
): boolean {
  if (!bubbles || bubbles.length <= 1) return true;
  const sorted = sortBubblesRTL(bubbles, options);
  for (let i = 0; i < bubbles.length; i++) {
    if (bubbles[i] !== sorted[i]) {
      return false;
    }
  }
  return true;
}

export {
  sortBubblesHierarchicalDAG,
  computeIntraPanelScore,
  panelSpatialDominates,
  buildSpatialDominanceDAG,
  topologicalSortPanels,
  autoClusterPanelsFromBubbles,
  type PanelBox,
  type HierarchicalDAGOptions,
} from "./panelReadingFlowDAG";

