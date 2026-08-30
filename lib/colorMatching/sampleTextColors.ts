import {
  clampConfidence,
  createDefaultStyleProfile,
  type ColorSampleRegion,
  type TextStyleProfile,
} from "./types";

export function colorDistance(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number,
): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

export function rgbToHex(r: number, g: number, b: number): string {
  const hr = Math.max(0, Math.min(255, Math.round(r))).toString(16).padStart(2, "0");
  const hg = Math.max(0, Math.min(255, Math.round(g))).toString(16).padStart(2, "0");
  const hb = Math.max(0, Math.min(255, Math.round(b))).toString(16).padStart(2, "0");
  return `#${hr}${hg}${hb}`.toLowerCase();
}

export interface ColorBucket {
  r: number;
  g: number;
  b: number;
  chroma: number;
  count: number;
  centerScore: number;
}

export interface ColorCluster {
  r: number;
  g: number;
  b: number;
  chroma: number;
  count: number;
  centerScore: number;
}

export function clusterBuckets(
  buckets: ColorBucket[],
  threshold = 36,
): ColorCluster[] {
  const clusters: ColorCluster[] = [];
  const sorted = [...buckets].sort((a, b) => b.centerScore - a.centerScore);

  for (const b of sorted) {
    let matched: ColorCluster | null = null;
    let minDist = Infinity;

    for (const c of clusters) {
      const dist = colorDistance(b.r, b.g, b.b, c.r, c.g, c.b);
      if (dist <= threshold && dist < minDist) {
        minDist = dist;
        matched = c;
      }
    }

    if (matched) {
      const totalCount = matched.count + b.count;
      matched.r = (matched.r * matched.count + b.r * b.count) / totalCount;
      matched.g = (matched.g * matched.count + b.g * b.count) / totalCount;
      matched.b = (matched.b * matched.count + b.b * b.count) / totalCount;
      matched.chroma = Math.max(matched.chroma, b.chroma);
      matched.count += b.count;
      matched.centerScore += b.centerScore;
    } else {
      clusters.push({
        r: b.r,
        g: b.g,
        b: b.b,
        chroma: b.chroma,
        count: b.count,
        centerScore: b.centerScore,
      });
    }
  }

  return clusters;
}

export interface ExtractColorOptions {
  backgroundTolerance?: number;
  minContrast?: number;
}

/**
 * Advanced Text Style Color Extraction with Interior Mask Erosion,
 * Anti-Aliasing Rejection, and Outline Separation.
 */
export function extractTextColors(
  sample: ColorSampleRegion,
  options: ExtractColorOptions = {},
): TextStyleProfile {
  const { width, height, rgba } = sample;
  const totalPixels = width * height;

  if (!rgba || totalPixels === 0 || width === 0 || height === 0) {
    return createDefaultStyleProfile("global");
  }

  const bgTolerance = options.backgroundTolerance ?? 28;

  // 1. Step 1: Estimate Background Color from outer border pixels
  let bgRSum = 0;
  let bgGSum = 0;
  let bgBSum = 0;
  let bgCount = 0;

  const borderWidth = Math.max(1, Math.min(3, Math.floor(Math.min(width, height) / 6)));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isBorder = x < borderWidth || x >= width - borderWidth || y < borderWidth || y >= height - borderWidth;
      if (isBorder) {
        const idx = (y * width + x) * 4;
        const a = rgba[idx + 3];
        if (a >= 64) {
          bgRSum += rgba[idx];
          bgGSum += rgba[idx + 1];
          bgBSum += rgba[idx + 2];
          bgCount++;
        }
      }
    }
  }

  const bgR = bgCount > 0 ? bgRSum / bgCount : 255;
  const bgG = bgCount > 0 ? bgGSum / bgCount : 255;
  const bgB = bgCount > 0 ? bgBSum / bgCount : 255;

  // 2. Step 2: Build Foreground Binary Map
  const isFg = new Uint8Array(totalPixels);
  let totalFgCount = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const a = rgba[idx + 3];
      if (a < 64) continue;

      const r = rgba[idx];
      const g = rgba[idx + 1];
      const b = rgba[idx + 2];

      const distFromBg = colorDistance(r, g, b, bgR, bgG, bgB);
      if (distFromBg >= bgTolerance) {
        isFg[y * width + x] = 1;
        totalFgCount++;
      }
    }
  }

  const fgRatio = totalFgCount / totalPixels;
  if (totalFgCount < 4 || fgRatio < 0.008) {
    return {
      fill: "#000000",
      outline: "#ffffff",
      outlineWidth: 1.0,
      fillConfidence: 0.3,
      outlineConfidence: 0.3,
      source: "global",
    };
  }

  // 3. Step 3: Interior Erosion (Distinguish Core Interior from Edge / Transition Ring)
  const isCoreInterior = new Uint8Array(totalPixels);
  let coreCount = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x;
      if (isFg[p]) {
        // Check 4 direct neighbors
        if (
          isFg[p - 1] &&
          isFg[p + 1] &&
          isFg[p - width] &&
          isFg[p + width]
        ) {
          isCoreInterior[p] = 1;
          coreCount++;
        }
      }
    }
  }

  // If erosion removed all pixels (very small/thin text), fallback to all foreground pixels
  const useErodedCore = coreCount >= 4;
  const coreMap = useErodedCore ? isCoreInterior : isFg;

  // 4. Step 4: Histogram & Color Clustering for Core Interior (Determines Fill Color)
  const coreBuckets = new Map<string, ColorBucket>();
  const edgeBuckets = new Map<string, ColorBucket>();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const idx = p * 4;
      const a = rgba[idx + 3];
      if (a < 64) continue;

      const r = rgba[idx];
      const g = rgba[idx + 1];
      const b = rgba[idx + 2];
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);

      const qr = Math.floor(r / 16) * 16 + 8;
      const qg = Math.floor(g / 16) * 16 + 8;
      const qb = Math.floor(b / 16) * 16 + 8;
      const key = `${qr},${qg},${qb}`;

      const nx = (x - width / 2) / Math.max(1, width / 2);
      const ny = (y - height / 2) / Math.max(1, height / 2);
      const distFromCenter = Math.sqrt(nx * nx + ny * ny);
      const centerWeight = distFromCenter <= 0.6 ? 2.5 : 1.0;

      if (coreMap[p]) {
        const existing = coreBuckets.get(key);
        if (existing) {
          existing.r = (existing.r * existing.count + r) / (existing.count + 1);
          existing.g = (existing.g * existing.count + g) / (existing.count + 1);
          existing.b = (existing.b * existing.count + b) / (existing.count + 1);
          existing.chroma = Math.max(existing.chroma, chroma);
          existing.count++;
          existing.centerScore += centerWeight;
        } else {
          coreBuckets.set(key, { r, g, b, chroma, count: 1, centerScore: centerWeight });
        }
      } else if (isFg[p]) {
        // Edge / transition pixel
        const existing = edgeBuckets.get(key);
        if (existing) {
          existing.r = (existing.r * existing.count + r) / (existing.count + 1);
          existing.g = (existing.g * existing.count + g) / (existing.count + 1);
          existing.b = (existing.b * existing.count + b) / (existing.count + 1);
          existing.chroma = Math.max(existing.chroma, chroma);
          existing.count++;
          existing.centerScore += centerWeight;
        } else {
          edgeBuckets.set(key, { r, g, b, chroma, count: 1, centerScore: centerWeight });
        }
      }
    }
  }

  const coreClusters = clusterBuckets(Array.from(coreBuckets.values()), 36);
  const edgeClusters = clusterBuckets(Array.from(edgeBuckets.values()), 36);

  // 5. Step 5: Fill Color Determination
  // A. Chromatic Core Cluster Priority (e.g. Pink, Cyan, Yellow, Red fill)
  const chromaticCore = coreClusters
    .filter((c) => c.chroma >= 18 && c.count >= Math.max(3, totalFgCount * 0.03))
    .sort((a, b) => b.centerScore - a.centerScore);

  let fillR = 0, fillG = 0, fillB = 0;
  let fillHex = "#000000";
  let fillConfidence = 0.85;

  if (chromaticCore.length > 0) {
    const topChromatic = chromaticCore[0];
    fillR = topChromatic.r;
    fillG = topChromatic.g;
    fillB = topChromatic.b;
    fillHex = rgbToHex(fillR, fillG, fillB);
    fillConfidence = 0.95;
  } else if (coreClusters.length > 0) {
    const sortedCore = coreClusters.sort((a, b) => b.centerScore - a.centerScore);
    const topCluster = sortedCore[0];
    fillR = topCluster.r;
    fillG = topCluster.g;
    fillB = topCluster.b;
    fillHex = rgbToHex(fillR, fillG, fillB);
    const contrastFromBg = colorDistance(fillR, fillG, fillB, bgR, bgG, bgB);
    fillConfidence = clampConfidence(0.65 + (contrastFromBg / 441.67) * 0.3);
  } else {
    fillHex = "#000000";
    fillConfidence = 0.5;
  }

  // 6. Step 6: Outline Color & Width Separation from Edge Transition Ring
  let outlineHex = "";
  let outlineConfidence = 0.75;
  let outlineWidth = 1.0;

  // Search edge clusters for a distinct outline color that differs from fill and background
  const candidateOutlineClusters = [...edgeClusters, ...coreClusters].filter((c) => {
    const distToFill = colorDistance(c.r, c.g, c.b, fillR, fillG, fillB);
    const distToBg = colorDistance(c.r, c.g, c.b, bgR, bgG, bgB);
    return distToFill > 42 && distToBg > 30 && c.count >= Math.max(2, totalFgCount * 0.04);
  }).sort((a, b) => b.centerScore - a.centerScore);

  if (candidateOutlineClusters.length > 0) {
    const bestOutline = candidateOutlineClusters[0];
    outlineHex = rgbToHex(bestOutline.r, bestOutline.g, bestOutline.b);
    outlineConfidence = 0.90;
    const edgeRatio = (totalFgCount - coreCount) / Math.max(1, totalFgCount);
    outlineWidth = edgeRatio > 0.4 ? 1.3 : 1.0;
  } else {
    // Contrast-based fallback outline (white for dark text, dark for light text)
    const fillLum = 0.299 * fillR + 0.587 * fillG + 0.114 * fillB;
    const bgLum = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;

    if (bgLum > 180) {
      outlineHex = fillLum < 128 ? "#ffffff" : "#000000";
    } else {
      outlineHex = fillLum < 128 ? "#ffffff" : "#000000";
    }
    outlineConfidence = 0.80;
    outlineWidth = 1.0;
  }

  // If core interior is very small (< 6 pixels) or fill confidence is low, clamp confidence appropriately
  if (coreCount < 6) {
    fillConfidence = Math.min(fillConfidence, 0.55);
  }

  return {
    fill: fillHex,
    outline: outlineHex,
    outlineWidth,
    opacity: 1.0,
    fillConfidence: clampConfidence(fillConfidence),
    outlineConfidence: clampConfidence(outlineConfidence),
    source: fillConfidence >= 0.60 ? "auto" : "global",
  };
}
