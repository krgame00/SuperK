/**
 * Double Bubble Voronoi Splitting Engine
 *
 * Implements Section 3.2 of the SuperK Architectural Blueprint:
 * Partitions conjoined twin speech balloons using Voronoi diagrams
 * to bisect overlapping speech areas along the perpendicular bisector plane.
 *
 * Grounded in pstack principles:
 * - principle-model-the-domain: Explicit geometric Voronoi bisector and convex cell representation.
 * - principle-fix-root-causes: Eliminates artificial collision repulsion drifting bubbles out of artwork.
 * - principle-laziness-protocol: Pure closed-form 2D computational geometry with zero external dependencies.
 */

import type { TranslatedBubble } from "@/lib/translationOverlay";

export interface Point2D {
  x: number;
  y: number;
}

export interface BoundingBoxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VoronoiBisector {
  midpoint: Point2D;
  normal: Point2D;
  axis: "horizontal" | "vertical";
  constant: number;
}

export interface VoronoiSplitOptions {
  /** Visual separator gap between partitioned lobes in pixels. Default: 4 */
  gutter?: number;
  /** Minimum overlap ratio to consider as double bubble. Default: 0.15 */
  minOverlapRatio?: number;
  /** Number of vertical scanline chord slices for contour layout. Default: 20 */
  numScanlines?: number;
}

export interface VoronoiSplitResult {
  boxA: BoundingBoxRect;
  boxB: BoundingBoxRect;
  polygonA: Point2D[];
  polygonB: Point2D[];
  midpoint: Point2D;
  normal: Point2D;
  axis: "horizontal" | "vertical";
}

/**
 * Computes the perpendicular bisector plane between two seed centers.
 */
export function computeVoronoiBisector(seedA: Point2D, seedB: Point2D): VoronoiBisector {
  const midpoint: Point2D = {
    x: (seedA.x + seedB.x) / 2,
    y: (seedA.y + seedB.y) / 2,
  };
  const normal: Point2D = {
    x: seedB.x - seedA.x,
    y: seedB.y - seedA.y,
  };
  const axis: "horizontal" | "vertical" =
    Math.abs(normal.y) > Math.abs(normal.x) ? "horizontal" : "vertical";
  const constant = normal.x * midpoint.x + normal.y * midpoint.y;

  return { midpoint, normal, axis, constant };
}

/**
 * Computes the signed area of a 2D polygon using the Shoelace formula.
 */
export function computePolygonArea(polygon: Point2D[]): number {
  const n = polygon.length;
  if (n < 3) return 0;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += polygon[i].x * polygon[j].y - polygon[j].x * polygon[i].y;
  }
  return Math.abs(area) / 2;
}

/**
 * Clips a polygon by a half-plane defined by (P - M) . normal <= 0 (if keepLower is true)
 * or (P - M) . normal >= 0 (if keepLower is false).
 * Implements Sutherland-Hodgman convex polygon clipping in O(N).
 */
export function clipPolygonByHalfPlane(
  polygon: Point2D[],
  midpoint: Point2D,
  normal: Point2D,
  keepLower: boolean,
): Point2D[] {
  if (polygon.length < 3) return [];
  const out: Point2D[] = [];

  const side = (p: Point2D) => {
    const val = (p.x - midpoint.x) * normal.x + (p.y - midpoint.y) * normal.y;
    return keepLower ? val <= 0 : val >= 0;
  };

  const lineIntersection = (p1: Point2D, p2: Point2D): Point2D => {
    const val1 = (p1.x - midpoint.x) * normal.x + (p1.y - midpoint.y) * normal.y;
    const val2 = (p2.x - midpoint.x) * normal.x + (p2.y - midpoint.y) * normal.y;
    const t = val1 / (val1 - val2);
    return {
      x: p1.x + t * (p2.x - p1.x),
      y: p1.y + t * (p2.y - p1.y),
    };
  };

  for (let i = 0; i < polygon.length; i++) {
    const curr = polygon[i];
    const prev = polygon[(i + polygon.length - 1) % polygon.length];

    const currIn = side(curr);
    const prevIn = side(prev);

    if (currIn) {
      if (!prevIn) {
        out.push(lineIntersection(prev, curr));
      }
      out.push(curr);
    } else if (prevIn) {
      out.push(lineIntersection(prev, curr));
    }
  }

  return out;
}

/**
 * Clips a bounding rectangle into two complementary Voronoi polygons.
 */
export function clipRectByVoronoiPlane(
  rect: BoundingBoxRect,
  seedA: Point2D,
  seedB: Point2D,
): { polygonA: Point2D[]; polygonB: Point2D[]; areaA: number; areaB: number } {
  const rectPoly: Point2D[] = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];

  const { midpoint, normal } = computeVoronoiBisector(seedA, seedB);

  const polygonA = clipPolygonByHalfPlane(rectPoly, midpoint, normal, true);
  const polygonB = clipPolygonByHalfPlane(rectPoly, midpoint, normal, false);

  return {
    polygonA,
    polygonB,
    areaA: computePolygonArea(polygonA),
    areaB: computePolygonArea(polygonB),
  };
}

/**
 * Computes axis-aligned bounding box from polygon vertices.
 */
export function getPolygonBounds(polygon: Point2D[]): BoundingBoxRect {
  if (polygon.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const pt of polygon) {
    minX = Math.min(minX, pt.x);
    minY = Math.min(minY, pt.y);
    maxX = Math.max(maxX, pt.x);
    maxY = Math.max(maxY, pt.y);
  }

  return {
    x: Math.round(minX),
    y: Math.round(minY),
    width: Math.max(1, Math.round(maxX - minX)),
    height: Math.max(1, Math.round(maxY - minY)),
  };
}

/**
 * Determines whether two speech bubble rectangles form a conjoined double bubble pair.
 */
export function isDoubleBubblePair(
  boxA: BoundingBoxRect,
  boxB: BoundingBoxRect,
  options?: VoronoiSplitOptions,
): boolean {
  const minOverlapRatio = options?.minOverlapRatio ?? 0.15;

  const xOverlap = Math.min(boxA.x + boxA.width, boxB.x + boxB.width) - Math.max(boxA.x, boxB.x);
  const yOverlap = Math.min(boxA.y + boxA.height, boxB.y + boxB.height) - Math.max(boxA.y, boxB.y);

  if (xOverlap <= 0 || yOverlap <= 0) return false;

  const overlapArea = xOverlap * yOverlap;
  const areaA = boxA.width * boxA.height;
  const areaB = boxB.width * boxB.height;
  const minArea = Math.min(areaA, areaB);

  return minArea > 0 && overlapArea / minArea >= minOverlapRatio;
}

/**
 * Bisects two conjoined bubble rectangles using a Voronoi diagram.
 * Guarantees zero overlap between resulting safe bounding boxes.
 */
export function splitConjoinedPairVoronoi(
  rectA: BoundingBoxRect,
  rectB: BoundingBoxRect,
  options?: VoronoiSplitOptions,
): VoronoiSplitResult {
  const gutter = options?.gutter ?? 4;

  const seedA: Point2D = {
    x: rectA.x + rectA.width / 2,
    y: rectA.y + rectA.height / 2,
  };
  const seedB: Point2D = {
    x: rectB.x + rectB.width / 2,
    y: rectB.y + rectB.height / 2,
  };

  const distSq = (seedB.x - seedA.x) ** 2 + (seedB.y - seedA.y) ** 2;

  // Union bounding box enclosing both lobes
  const unionX = Math.min(rectA.x, rectB.x);
  const unionY = Math.min(rectA.y, rectB.y);
  const unionR = Math.max(rectA.x + rectA.width, rectB.x + rectB.width);
  const unionB = Math.max(rectA.y + rectA.height, rectB.y + rectB.height);
  const unionRect: BoundingBoxRect = {
    x: unionX,
    y: unionY,
    width: unionR - unionX,
    height: unionB - unionY,
  };

  // Fallback for identical centers: split along the larger union dimension
  if (distSq < 1e-4) {
    const isVertical = unionRect.height >= unionRect.width;
    if (isVertical) {
      const halfH = Math.max(10, Math.floor((unionRect.height - gutter) / 2));
      return {
        boxA: { x: unionRect.x, y: unionRect.y, width: unionRect.width, height: halfH },
        boxB: { x: unionRect.x, y: unionRect.y + halfH + gutter, width: unionRect.width, height: halfH },
        polygonA: [],
        polygonB: [],
        midpoint: { x: unionRect.x + unionRect.width / 2, y: unionRect.y + unionRect.height / 2 },
        normal: { x: 0, y: 1 },
        axis: "horizontal",
      };
    } else {
      const halfW = Math.max(10, Math.floor((unionRect.width - gutter) / 2));
      return {
        boxA: { x: unionRect.x, y: unionRect.y, width: halfW, height: unionRect.height },
        boxB: { x: unionRect.x + halfW + gutter, y: unionRect.y, width: halfW, height: unionRect.height },
        polygonA: [],
        polygonB: [],
        midpoint: { x: unionRect.x + unionRect.width / 2, y: unionRect.y + unionRect.height / 2 },
        normal: { x: 1, y: 0 },
        axis: "vertical",
      };
    }
  }

  const bisector = computeVoronoiBisector(seedA, seedB);
  const { polygonA, polygonB } = clipRectByVoronoiPlane(unionRect, seedA, seedB);

  const rawBoxA = getPolygonBounds(polygonA);
  const rawBoxB = getPolygonBounds(polygonB);

  // Apply gutter separation along the bisector axis
  let boxA = { ...rawBoxA };
  let boxB = { ...rawBoxB };

  if (bisector.axis === "horizontal") {
    // Top-to-Bottom division
    const isATop = seedA.y <= seedB.y;
    const topBox = isATop ? boxA : boxB;
    const btmBox = isATop ? boxB : boxA;

    const splitY = bisector.midpoint.y;
    topBox.height = Math.max(10, Math.round(splitY - topBox.y - gutter / 2));
    const newBtmY = Math.round(splitY + gutter / 2);
    btmBox.height = Math.max(10, Math.round(btmBox.y + btmBox.height - newBtmY));
    btmBox.y = newBtmY;

    boxA = isATop ? topBox : btmBox;
    boxB = isATop ? btmBox : topBox;
  } else {
    // Left-to-Right division
    const isALeft = seedA.x <= seedB.x;
    const lftBox = isALeft ? boxA : boxB;
    const rgtBox = isALeft ? boxB : boxA;

    const splitX = bisector.midpoint.x;
    lftBox.width = Math.max(10, Math.round(splitX - lftBox.x - gutter / 2));
    const newRgtX = Math.round(splitX + gutter / 2);
    rgtBox.width = Math.max(10, Math.round(rgtBox.x + rgtBox.width - newRgtX));
    rgtBox.x = newRgtX;

    boxA = isALeft ? lftBox : rgtBox;
    boxB = isALeft ? rgtBox : lftBox;
  }

  return {
    boxA,
    boxB,
    polygonA,
    polygonB,
    midpoint: bisector.midpoint,
    normal: bisector.normal,
    axis: bisector.axis,
  };
}

/**
 * Applies Voronoi diagram double-bubble splitting to two TranslatedBubble objects.
 */
export function splitDoubleBubble(
  bubbleA: TranslatedBubble,
  bubbleB: TranslatedBubble,
  iw: number,
  ih: number,
  options?: VoronoiSplitOptions,
): { bubbleA: TranslatedBubble; bubbleB: TranslatedBubble } {
  const getPixelRect = (b: TranslatedBubble): BoundingBoxRect => {
    if (b.layoutAdjustment) {
      return {
        x: b.layoutAdjustment.bx,
        y: b.layoutAdjustment.by,
        width: b.layoutAdjustment.bw,
        height: b.layoutAdjustment.bh,
      };
    }
    const box = b.box ?? [100, 100, 200, 200];
    const ymin = (box[0] / 1000) * ih;
    const xmin = (box[1] / 1000) * iw;
    const ymax = (box[2] / 1000) * ih;
    const xmax = (box[3] / 1000) * iw;
    return {
      x: Math.round(xmin),
      y: Math.round(ymin),
      width: Math.max(10, Math.round(xmax - xmin)),
      height: Math.max(10, Math.round(ymax - ymin)),
    };
  };

  const rectA = getPixelRect(bubbleA);
  const rectB = getPixelRect(bubbleB);

  const split = splitConjoinedPairVoronoi(rectA, rectB, options);

  const scanlinesA = generateVoronoiScanlineRatios(split.polygonA);
  const scanlinesB = generateVoronoiScanlineRatios(split.polygonB);

  const updatedA: TranslatedBubble = {
    ...bubbleA,
    scanlineRatios: scanlinesA,
    box: [
      Math.round((split.boxA.y / ih) * 1000),
      Math.round((split.boxA.x / iw) * 1000),
      Math.round(((split.boxA.y + split.boxA.height) / ih) * 1000),
      Math.round(((split.boxA.x + split.boxA.width) / iw) * 1000),
    ],
    layoutAdjustment: {
      ...bubbleA.layoutAdjustment,
      bx: split.boxA.x,
      by: split.boxA.y,
      bw: split.boxA.width,
      bh: split.boxA.height,
      iw,
      ih,
      userModified: false,
      isAutoOptimized: true,
      autoOptimizeVersion: 4,
    },
  };

  const updatedB: TranslatedBubble = {
    ...bubbleB,
    scanlineRatios: scanlinesB,
    box: [
      Math.round((split.boxB.y / ih) * 1000),
      Math.round((split.boxB.x / iw) * 1000),
      Math.round(((split.boxB.y + split.boxB.height) / ih) * 1000),
      Math.round(((split.boxB.x + split.boxB.width) / iw) * 1000),
    ],
    layoutAdjustment: {
      ...bubbleB.layoutAdjustment,
      bx: split.boxB.x,
      by: split.boxB.y,
      bw: split.boxB.width,
      bh: split.boxB.height,
      iw,
      ih,
      userModified: false,
      isAutoOptimized: true,
      autoOptimizeVersion: 4,
    },
  };

  return { bubbleA: updatedA, bubbleB: updatedB };
}

/**
 * Splits a single conjoined twin bubble with multi-line text into two distinct bubbles.
 */
export function splitSingleDoubleBubble(
  bubble: TranslatedBubble,
  iw: number,
  ih: number,
  options?: VoronoiSplitOptions,
): [TranslatedBubble, TranslatedBubble] {
  const rawText = bubble.t ?? bubble.translated ?? "";
  const lines = rawText.split(/\r?\n+/).map((s) => s.trim()).filter(Boolean);

  let text1 = rawText;
  let text2 = "";

  if (lines.length >= 2) {
    text1 = lines[0];
    text2 = lines.slice(1).join("\n");
  } else {
    // Split by sentence punctuation
    const sentenceSplit = rawText.split(/(?<=[.!?…])\s+/);
    if (sentenceSplit.length >= 2) {
      text1 = sentenceSplit[0];
      text2 = sentenceSplit.slice(1).join(" ");
    }
  }

  const box = bubble.box ?? [100, 100, 300, 300];
  const pxY = (box[0] / 1000) * ih;
  const pxX = (box[1] / 1000) * iw;
  const pxH = ((box[2] - box[0]) / 1000) * ih;
  const pxW = ((box[3] - box[1]) / 1000) * iw;

  const isVertical = pxH >= pxW;

  let rectA: BoundingBoxRect;
  let rectB: BoundingBoxRect;

  if (isVertical) {
    const halfH = pxH / 2;
    rectA = { x: pxX, y: pxY, width: pxW, height: halfH * 1.1 };
    rectB = { x: pxX, y: pxY + halfH * 0.9, width: pxW, height: halfH * 1.1 };
  } else {
    const halfW = pxW / 2;
    rectA = { x: pxX, y: pxY, width: halfW * 1.1, height: pxH };
    rectB = { x: pxX + halfW * 0.9, y: pxY, width: halfW * 1.1, height: pxH };
  }

  const split = splitConjoinedPairVoronoi(rectA, rectB, options);

  const scanlinesA = generateVoronoiScanlineRatios(split.polygonA);
  const scanlinesB = generateVoronoiScanlineRatios(split.polygonB);

  const baseId = bubble.id !== undefined ? String(bubble.id) : "double";

  const bubble1: TranslatedBubble = {
    ...bubble,
    id: `${baseId}-lobe1`,
    t: text1,
    scanlineRatios: scanlinesA,
    box: [
      Math.round((split.boxA.y / ih) * 1000),
      Math.round((split.boxA.x / iw) * 1000),
      Math.round(((split.boxA.y + split.boxA.height) / ih) * 1000),
      Math.round(((split.boxA.x + split.boxA.width) / iw) * 1000),
    ],
    layoutAdjustment: {
      bx: split.boxA.x,
      by: split.boxA.y,
      bw: split.boxA.width,
      bh: split.boxA.height,
      iw,
      ih,
      userModified: false,
      isAutoOptimized: true,
      autoOptimizeVersion: 4,
    },
  };

  const bubble2: TranslatedBubble = {
    ...bubble,
    id: `${baseId}-lobe2`,
    t: text2,
    scanlineRatios: scanlinesB,
    box: [
      Math.round((split.boxB.y / ih) * 1000),
      Math.round((split.boxB.x / iw) * 1000),
      Math.round(((split.boxB.y + split.boxB.height) / ih) * 1000),
      Math.round(((split.boxB.x + split.boxB.width) / iw) * 1000),
    ],
    layoutAdjustment: {
      bx: split.boxB.x,
      by: split.boxB.y,
      bw: split.boxB.width,
      bh: split.boxB.height,
      iw,
      ih,
      userModified: false,
      isAutoOptimized: true,
      autoOptimizeVersion: 4,
    },
  };

  return [bubble1, bubble2];
}

/**
 * Computes scanline chord width ratios across vertical slices of a Voronoi polygon cell.
 * Returned ratios (0..1) are suitable for `fitTextToBubbleContour` in BubbleTypesetEngine.
 */
export function generateVoronoiScanlineRatios(
  polygon: Point2D[],
  numSlices = 20,
): number[] {
  if (polygon.length < 3) {
    return new Array(numSlices).fill(1.0);
  }

  const bounds = getPolygonBounds(polygon);
  const ratios: number[] = [];

  for (let s = 0; s < numSlices; s++) {
    const y = bounds.y + (s + 0.5) * (bounds.height / numSlices);
    const xIntersections: number[] = [];

    for (let i = 0; i < polygon.length; i++) {
      const p1 = polygon[i];
      const p2 = polygon[(i + 1) % polygon.length];

      if ((p1.y <= y && p2.y > y) || (p2.y <= y && p1.y > y)) {
        const t = (y - p1.y) / (p2.y - p1.y);
        xIntersections.push(p1.x + t * (p2.x - p1.x));
      }
    }

    if (xIntersections.length >= 2) {
      const minX = Math.min(...xIntersections);
      const maxX = Math.max(...xIntersections);
      const chordW = Math.max(0, maxX - minX);
      const ratio = Math.min(1.0, Math.max(0, chordW / bounds.width));
      ratios.push(Number(ratio.toFixed(3)));
    } else {
      ratios.push(0.5);
    }
  }

  return ratios;
}
