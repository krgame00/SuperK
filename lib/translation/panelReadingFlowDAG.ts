/**
 * Manga Panel Segmentation & Topological Reading Flow DAG Engine
 *
 * Implements Section 2 of the SuperK Next-Gen Architectural Blueprint:
 * - 2.1 Solves naive Y-sort context desynchronization in staggered panels.
 * - 2.2 Two-Tier Hierarchical Directed Acyclic Graph (DAG):
 *     Step 1: Panel Topological Sorting with Spatial Dominance Matrix:
 *             P_i > P_j <=> (X_i,min > X_j,max) or (Y_i,max < Y_j,min and Overlap_X(P_i, P_j) > tau)
 *     Step 2: Intra-Panel Bubble Sorting with RTL Distance Metric:
 *             Score(B_k) = alpha * (W_page - X_k) + beta * Y_k  (alpha = 1.5, beta = 1.0)
 *
 * Grounded in pstack principles:
 * - principle-model-the-domain: Explicit PanelBox, DominanceMatrix, and Graph Adjacency representation.
 * - principle-fix-root-causes: Addresses reading order errors at the panel topology level.
 * - principle-laziness-protocol: Pure closed-form 2D computational geometry with Kahn's algorithm.
 */

import { extractNormalizedBox, type NormalizedBox } from "./bubbleReadingOrder";

export interface PanelBox {
  id: string | number;
  top: number;
  left: number;
  bottom: number;
  right: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export interface HierarchicalDAGOptions {
  /** Relative horizontal dominance weight for intra-panel bubble sorting. Default: 1.5 */
  alpha?: number;
  /** Relative vertical weight for intra-panel bubble sorting. Default: 1.0 */
  beta?: number;
  /** Minimum X-overlap ratio (0-1) between vertically stacked panels. Default: 0.25 */
  overlapTau?: number;
  /** Canvas coordinate width scale (0-1000 scale). Default: 1000 */
  pageWidth?: number;
  /** Canvas coordinate height scale (0-1000 scale). Default: 1000 */
  pageHeight?: number;
  /** Optional explicit panels if detected externally. If omitted, automatically clustered. */
  panels?: PanelBox[];
}

export interface PanelClusterResult {
  panels: PanelBox[];
  bubbleToPanelIndex: number[];
}

/**
 * Computes the intra-panel bubble score per Blueprint Section 2.2:
 * Score(B_k) = alpha * (W_page - X_k) + beta * Y_k
 */
export function computeIntraPanelScore(
  box: NormalizedBox,
  pageWidth = 1000,
  alpha = 1.5,
  beta = 1.0,
): number {
  return alpha * (pageWidth - box.centerX) + beta * box.centerY;
}

/**
 * Checks if Panel A dominates Panel B in authentic Japanese Manga reading order (A is read before B).
 *
 * Grounded in Blueprint Section 2.2 Spatial Dominance Matrix:
 * P_i > P_j <=> (Upper Tier Dominance) or (Same Tier Right-to-Left Dominance)
 */
export function panelSpatialDominates(
  panelA: PanelBox,
  panelB: PanelBox,
  tau = 0.25,
): boolean {
  if (panelA.id === panelB.id) return false;

  // Calculate vertical overlap
  const yOverlap =
    Math.min(panelA.bottom, panelB.bottom) - Math.max(panelA.top, panelB.top);
  const minHeight = Math.min(panelA.height, panelB.height);
  const verticalOverlapRatio = minHeight > 0 ? Math.max(0, yOverlap) / minHeight : 0;

  // 1. Strict Upper-Tier Dominance: Panel A is completely above Panel B
  if (panelA.bottom <= panelB.top) {
    return true;
  }

  // 2. Intra-Tier Right-to-Left Dominance: Panels share vertical band/tier
  if (verticalOverlapRatio > tau) {
    // Panel A is strictly to the right of Panel B
    if (panelA.left >= panelB.right) {
      return true;
    }
    // Panel A is substantially right of Panel B within the same tier
    if (panelA.centerX > panelB.centerX && panelA.top <= panelB.centerY) {
      return true;
    }
  }

  // 3. Diagonal fallback: Panel A is above and to the right
  if (panelA.bottom <= panelB.centerY && panelA.centerX >= panelB.centerX) {
    return true;
  }

  return false;
}

/**
 * Builds the Spatial Dominance Adjacency Matrix and in-degree counts for a set of panels.
 */
export function buildSpatialDominanceDAG(
  panels: PanelBox[],
  tau = 0.25,
): { adjacency: number[][]; inDegree: number[] } {
  const n = panels.length;
  const adjacency: number[][] = Array.from({ length: n }, () => []);
  const inDegree: number[] = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (panelSpatialDominates(panels[i], panels[j], tau)) {
        // Directed edge: i -> j (read panel i before panel j)
        adjacency[i].push(j);
        inDegree[j]++;
      }
    }
  }

  return { adjacency, inDegree };
}

/**
 * Topologically sorts panels using Kahn's algorithm with tie-breaking and cycle prevention.
 */
export function topologicalSortPanels(
  panels: PanelBox[],
  tau = 0.25,
  pageWidth = 1000,
): PanelBox[] {
  const n = panels.length;
  if (n <= 1) return [...panels];

  const { adjacency, inDegree } = buildSpatialDominanceDAG(panels, tau);

  // Tie-breaker comparator: prioritize rightmost, then topmost
  const panelComparator = (idxA: number, idxB: number): number => {
    const scoreA = 1.5 * (pageWidth - panels[idxA].centerX) + 1.0 * panels[idxA].centerY;
    const scoreB = 1.5 * (pageWidth - panels[idxB].centerX) + 1.0 * panels[idxB].centerY;
    return scoreA - scoreB;
  };

  // Ready queue with inDegree = 0
  const readyQueue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (inDegree[i] === 0) {
      readyQueue.push(i);
    }
  }
  readyQueue.sort(panelComparator);

  const sortedIndices: number[] = [];

  while (readyQueue.length > 0) {
    const current = readyQueue.shift()!;
    sortedIndices.push(current);

    for (const neighbor of adjacency[current]) {
      inDegree[neighbor]--;
      if (inDegree[neighbor] === 0) {
        readyQueue.push(neighbor);
        readyQueue.sort(panelComparator);
      }
    }
  }

  // If a cycle was detected (rare in non-convex panel layouts), append remaining panels using score
  if (sortedIndices.length < n) {
    const visited = new Set(sortedIndices);
    const unvisited: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!visited.has(i)) unvisited.push(i);
    }
    unvisited.sort(panelComparator);
    sortedIndices.push(...unvisited);
  }

  return sortedIndices.map((idx) => panels[idx]);
}

/**
 * Automatically clusters bubbles into panel boxes when explicit panels are not provided.
 * Uses bounding box expansion and gutter detection to group dialogue belonging to the same panel.
 */
export function autoClusterPanelsFromBubbles(
  boxes: NormalizedBox[],
  pageWidth = 1000,
  pageHeight = 1000,
): PanelClusterResult {
  const n = boxes.length;
  if (n === 0) {
    return { panels: [], bubbleToPanelIndex: [] };
  }

  // Initial candidate panels: each bubble starts in its own bounding box padded by typical manga gutter
  const gutterX = Math.round(pageWidth * 0.08); // 8% page width gutter
  const gutterY = Math.round(pageHeight * 0.08); // 8% page height gutter

  // Simple disjoint-set / connected components based on gutter proximity
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i: number, j: number) => {
    const rootI = find(i);
    const rootJ = find(j);
    if (rootI !== rootJ) parent[rootI] = rootJ;
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = boxes[i];
      const b = boxes[j];

      const xDist = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
      const yDist = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));

      // If bubbles are within conversational gutter proximity, cluster into the same panel
      if (xDist <= gutterX && yDist <= gutterY) {
        union(i, j);
      }
    }
  }

  // Aggregate clusters
  const clusters = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root)!.push(i);
  }

  const panels: PanelBox[] = [];
  const bubbleToPanelIndex = new Array<number>(n);

  let panelIdCounter = 1;
  for (const bubbleIndices of clusters.values()) {
    let top = Infinity;
    let left = Infinity;
    let bottom = -Infinity;
    let right = -Infinity;

    for (const bIdx of bubbleIndices) {
      const b = boxes[bIdx];
      if (b.top < top) top = b.top;
      if (b.left < left) left = b.left;
      if (b.bottom > bottom) bottom = b.bottom;
      if (b.right > right) right = b.right;
    }

    const panelIdx = panels.length;
    panels.push({
      id: `auto-panel-${panelIdCounter++}`,
      top,
      left,
      bottom,
      right,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
      centerX: (left + right) / 2,
      centerY: (top + bottom) / 2,
    });

    for (const bIdx of bubbleIndices) {
      bubbleToPanelIndex[bIdx] = panelIdx;
    }
  }

  return { panels, bubbleToPanelIndex };
}

/**
 * Sorts bubbles in authentic Japanese Manga reading order using Two-Tier Hierarchical DAG:
 * 1. Step 1: Topological Sort of Panels (Right-to-Left, Top-to-Bottom).
 * 2. Step 2: Intra-Panel Sub-DAG Sort using Alpha-Beta RTL Score.
 */
export function sortBubblesHierarchicalDAG<T>(
  bubbles: readonly T[],
  options?: HierarchicalDAGOptions,
): T[] {
  if (!bubbles || bubbles.length <= 1) {
    return bubbles ? [...bubbles] : [];
  }

  const alpha = options?.alpha ?? 1.5;
  const beta = options?.beta ?? 1.0;
  const tau = options?.overlapTau ?? 0.25;
  const pageWidth = options?.pageWidth ?? 1000;
  const pageHeight = options?.pageHeight ?? 1000;

  // Extract valid boxes
  interface ValidEntry {
    item: T;
    box: NormalizedBox;
    originalIndex: number;
  }
  const validEntries: ValidEntry[] = [];
  const invalidItems: T[] = [];

  for (let i = 0; i < bubbles.length; i++) {
    const item = bubbles[i];
    const rawBox =
      typeof item === "object" && item !== null && "box" in item
        ? (item as { box: unknown }).box
        : undefined;
    const norm = extractNormalizedBox(rawBox);
    if (norm) {
      validEntries.push({ item, box: norm, originalIndex: i });
    } else {
      invalidItems.push(item);
    }
  }

  if (validEntries.length <= 1) {
    return [...validEntries.map((e) => e.item), ...invalidItems];
  }

  // 1. Resolve Panels
  let panels: PanelBox[];
  let bubbleToPanelMap: number[];

  if (Array.isArray(options?.panels) && options.panels.length > 0) {
    panels = options.panels;
    bubbleToPanelMap = validEntries.map((entry) => {
      // Find panel with maximum overlap
      let bestPanelIdx = 0;
      let maxArea = -1;
      for (let pIdx = 0; pIdx < panels.length; pIdx++) {
        const p = panels[pIdx];
        const interW = Math.max(0, Math.min(entry.box.right, p.right) - Math.max(entry.box.left, p.left));
        const interH = Math.max(0, Math.min(entry.box.bottom, p.bottom) - Math.max(entry.box.top, p.top));
        const area = interW * interH;
        if (area > maxArea) {
          maxArea = area;
          bestPanelIdx = pIdx;
        }
      }
      return bestPanelIdx;
    });
  } else {
    const clusterRes = autoClusterPanelsFromBubbles(
      validEntries.map((e) => e.box),
      pageWidth,
      pageHeight,
    );
    panels = clusterRes.panels;
    bubbleToPanelMap = clusterRes.bubbleToPanelIndex;
  }

  // 2. Step 1: Topological Sort over Panels
  const sortedPanels = topologicalSortPanels(panels, tau, pageWidth);
  const panelOrderMap = new Map<PanelBox, number>();
  sortedPanels.forEach((p, idx) => panelOrderMap.set(p, idx));

  // Group valid entries by panel
  const panelBuckets = new Map<number, ValidEntry[]>();
  for (let i = 0; i < validEntries.length; i++) {
    const pIdx = bubbleToPanelMap[i];
    if (!panelBuckets.has(pIdx)) panelBuckets.set(pIdx, []);
    panelBuckets.get(pIdx)!.push(validEntries[i]);
  }

  // 3. Step 2: Intra-Panel Sort and Emit in canonical reading flow
  const result: T[] = [];

  for (const panel of sortedPanels) {
    const originalPanelIdx = panels.indexOf(panel);
    const bucket = panelBuckets.get(originalPanelIdx) || [];

    // Sort bubbles within this panel using the RTL score metric:
    // Score(B_k) = alpha * (W_page - X_k) + beta * Y_k
    bucket.sort((a, b) => {
      const scoreA = computeIntraPanelScore(a.box, pageWidth, alpha, beta);
      const scoreB = computeIntraPanelScore(b.box, pageWidth, alpha, beta);
      if (Math.abs(scoreA - scoreB) >= 0.001) {
        return scoreA - scoreB;
      }
      return a.originalIndex - b.originalIndex;
    });

    for (const entry of bucket) {
      result.push(entry.item);
    }
  }

  // Append invalid / unpositioned items at the end
  result.push(...invalidItems);

  return result;
}
