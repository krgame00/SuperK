import type { WarpConfig } from "../tools/TextWarpRenderer";

export type BubbleCategory = "normal" | "shouting" | "thought" | "narration";

export interface ComicTypographyRules {
  category: BubbleCategory;
  fontWeight: string;
  fontStyle: "normal" | "italic";
  dynamicStrokeWidth: number;
  warpConfig?: WarpConfig;
  fontFamilyFallback?: string;
}

/**
 * Calculates authentic dynamic stroke width per Blueprint Section 3.3:
 * Sw = max(1.5, floor(Htext / 12)) px, adjusted by an archetype multiplier.
 */
export function calculateDynamicStrokeWidth(
  fontSizePx: number,
  strokeMultiplier = 1.0,
): number {
  const baseStroke = Math.max(1.5, Math.floor(fontSizePx / 12));
  return Math.max(1.0, Math.round(baseStroke * strokeMultiplier * 10) / 10);
}

/**
 * Resolves comic typography rules, font weights, and auto-warp configuration
 * based on the 4 architectural bubble archetypes (CAT-01 to CAT-04).
 */
export function resolveCategoryTypography(
  category?: BubbleCategory | string,
  baseFontSize = 18,
  userWarp?: WarpConfig,
): ComicTypographyRules {
  const normalizedCategory: BubbleCategory =
    category === "shouting" || category === "thought" || category === "narration"
      ? category
      : "normal";

  switch (normalizedCategory) {
    case "shouting":
      return {
        category: "shouting",
        fontWeight: "800",
        fontStyle: "normal",
        dynamicStrokeWidth: calculateDynamicStrokeWidth(baseFontSize, 1.35),
        // Auto Bulge Warp (k=0.35) per blueprint Section 3.3 unless user specified explicit non-none warp
        warpConfig:
          userWarp && userWarp.type !== "none"
            ? userWarp
            : { type: "bulge", bend: 0.35 },
        fontFamilyFallback: "Prompt, sans-serif",
      };

    case "thought":
      return {
        category: "thought",
        fontWeight: "400",
        fontStyle: "italic",
        dynamicStrokeWidth: calculateDynamicStrokeWidth(baseFontSize, 0.85),
        warpConfig: userWarp && userWarp.type !== "none" ? userWarp : undefined,
        fontFamilyFallback: "Kanit, sans-serif",
      };

    case "narration":
      return {
        category: "narration",
        fontWeight: "500",
        fontStyle: "normal",
        dynamicStrokeWidth: calculateDynamicStrokeWidth(baseFontSize, 1.0),
        warpConfig: userWarp && userWarp.type !== "none" ? userWarp : undefined,
        fontFamilyFallback: "Sarabun, sans-serif",
      };

    case "normal":
    default:
      return {
        category: "normal",
        fontWeight: "bold",
        fontStyle: "normal",
        dynamicStrokeWidth: calculateDynamicStrokeWidth(baseFontSize, 1.0),
        warpConfig: userWarp && userWarp.type !== "none" ? userWarp : undefined,
      };
  }
}

/**
 * Pure geometric polygon classifier for client-side evaluation (Shoelace area & Perimeter).
 * Used when bubbles are generated client-side (e.g. Voronoi bisector cells or manual edits).
 */
export function classifyPolygonGeometry(
  polygon: Array<[number, number]>,
  explicitBbox?: { width: number; height: number },
): { category: BubbleCategory; q: number; extent: number } {
  const n = polygon.length;
  if (n < 3) {
    return { category: "normal", q: 1.0, extent: 1.0 };
  }

  // 1. Shoelace Formula for Area
  let areaSum = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < n; i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % n];
    areaSum += x1 * y2 - x2 * y1;

    if (x1 < minX) minX = x1;
    if (x1 > maxX) maxX = x1;
    if (y1 < minY) minY = y1;
    if (y1 > maxY) maxY = y1;
  }
  const area = Math.abs(areaSum) * 0.5;

  // 2. Perimeter
  let perimeter = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % n];
    perimeter += Math.hypot(x2 - x1, y2 - y1);
  }

  // 3. Isoperimetric Quotient Q = 4*pi*Area / P^2
  const q = perimeter > 0 ? (4 * Math.PI * area) / (perimeter * perimeter) : 0;

  // 4. Extent = Area / (BBox_W * BBox_H)
  const bw = explicitBbox ? explicitBbox.width : Math.max(1, maxX - minX);
  const bh = explicitBbox ? explicitBbox.height : Math.max(1, maxY - minY);
  const extent = area / Math.max(1, bw * bh);

  let category: BubbleCategory = "normal";
  if (extent >= 0.85) {
    category = "narration";
  } else if (q < 0.50) {
    category = "shouting";
  } else if (q >= 0.50 && q <= 0.72) {
    category = "thought";
  }

  return {
    category,
    q: Math.round(q * 1000) / 1000,
    extent: Math.round(extent * 1000) / 1000,
  };
}
