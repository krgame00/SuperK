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

interface ColorBucket {
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
  threshold = 38,
): ColorCluster[] {
  const clusters: ColorCluster[] = [];

  // Sort buckets by centerScore descending so dominant core centers lead the clusters
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

export function extractTextColors(
  sample: ColorSampleRegion,
  options: ExtractColorOptions = {},
): TextStyleProfile {
  const { width, height, rgba } = sample;
  const totalPixels = width * height;

  if (!rgba || totalPixels === 0 || width === 0 || height === 0) {
    return createDefaultStyleProfile("global");
  }

  const bgTolerance = options.backgroundTolerance ?? 30;

  // 1. Build Global Histogram across all pixels with center weighting
  const allBuckets = new Map<string, ColorBucket>();
  let bgRSum = 0;
  let bgGSum = 0;
  let bgBSum = 0;
  let bgCount = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const a = rgba[idx + 3];
      if (a < 128) continue;

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

      const existing = allBuckets.get(key);
      if (existing) {
        existing.r = (existing.r * existing.count + r) / (existing.count + 1);
        existing.g = (existing.g * existing.count + g) / (existing.count + 1);
        existing.b = (existing.b * existing.count + b) / (existing.count + 1);
        existing.chroma = Math.max(existing.chroma, chroma);
        existing.count++;
        existing.centerScore += centerWeight;
      } else {
        allBuckets.set(key, { r, g, b, chroma, count: 1, centerScore: centerWeight });
      }

      // Sample outer perimeter for background estimation
      if (x < 3 || x >= width - 3 || y < 3 || y >= height - 3) {
        bgRSum += r;
        bgGSum += g;
        bgBSum += b;
        bgCount++;
      }
    }
  }

  // Determine Background Color (most frequent cluster or border average)
  const sortedAll = Array.from(allBuckets.values()).sort((a, b) => b.count - a.count);
  const mostFrequent = sortedAll[0] ?? { r: 255, g: 255, b: 255, chroma: 0, count: 0, centerScore: 0 };

  const bgR = mostFrequent.count > totalPixels * 0.3
    ? mostFrequent.r
    : bgCount > 0 ? bgRSum / bgCount : 255;
  const bgG = mostFrequent.count > totalPixels * 0.3
    ? mostFrequent.g
    : bgCount > 0 ? bgGSum / bgCount : 255;
  const bgB = mostFrequent.count > totalPixels * 0.3
    ? mostFrequent.b
    : bgCount > 0 ? bgBSum / bgCount : 255;

  // 2. Separate Foreground Buckets from Background
  const foregroundBuckets: ColorBucket[] = [];
  let totalFgCount = 0;

  for (const bucket of allBuckets.values()) {
    const distFromBg = colorDistance(bucket.r, bucket.g, bucket.b, bgR, bgG, bgB);
    if (distFromBg >= bgTolerance) {
      foregroundBuckets.push(bucket);
      totalFgCount += bucket.count;
    }
  }

  const fgRatio = totalFgCount / totalPixels;
  if (totalFgCount < 4 || fgRatio < 0.01) {
    return {
      fill: "#000000",
      outline: "#ffffff",
      fillConfidence: 0.3,
      outlineConfidence: 0.3,
      source: "global",
    };
  }

  // 3. Cluster foreground buckets to aggregate anti-aliased subpixels
  const fgClusters = clusterBuckets(foregroundBuckets, 38);

  // 4. Priority Detection for Chromatic Text (Pink, Blue, Red, Cyan, Yellow, etc.)
  const chromaticClusters = fgClusters
    .filter((c) => c.chroma >= 20 && c.count >= Math.max(3, totalFgCount * 0.04))
    .sort((a, b) => b.centerScore - a.centerScore);

  if (chromaticClusters.length > 0) {
    const dominantChromatic = chromaticClusters[0];
    const fillHex = rgbToHex(dominantChromatic.r, dominantChromatic.g, dominantChromatic.b);

    // Look for secondary foreground/outline cluster (e.g., cyan/white/dark outline around pink text)
    let outlineHex = "";
    let outlineConfidence = 0.85;

    for (const candidate of fgClusters) {
      const distToDominant = colorDistance(
        candidate.r,
        candidate.g,
        candidate.b,
        dominantChromatic.r,
        dominantChromatic.g,
        dominantChromatic.b,
      );
      if (distToDominant > 40 && candidate.count >= Math.max(3, totalFgCount * 0.04)) {
        outlineHex = rgbToHex(candidate.r, candidate.g, candidate.b);
        outlineConfidence = 0.90;
        break;
      }
    }

    if (!outlineHex) {
      const luminance = 0.299 * dominantChromatic.r + 0.587 * dominantChromatic.g + 0.114 * dominantChromatic.b;
      outlineHex = bgR > 180 ? "#ffffff" : luminance < 128 ? "#ffffff" : "#000000";
    }

    return {
      fill: fillHex,
      outline: outlineHex,
      fillConfidence: 0.95,
      outlineConfidence,
      source: "auto",
    };
  }

  // 5. Monochrome / Dominant Foreground Selection
  const sortedFg = fgClusters.sort((a, b) => b.centerScore - a.centerScore);
  const primary = sortedFg[0];
  const primaryFillHex = rgbToHex(primary.r, primary.g, primary.b);

  let outlineHex = bgR > 128 ? "#ffffff" : "#000000";
  let outlineConfidence = 0.75;

  for (let i = 1; i < sortedFg.length; i++) {
    const candidate = sortedFg[i];
    const distToPrimary = colorDistance(
      candidate.r,
      candidate.g,
      candidate.b,
      primary.r,
      primary.g,
      primary.b,
    );
    if (distToPrimary > 40 && candidate.count >= Math.max(3, totalFgCount * 0.05)) {
      outlineHex = rgbToHex(candidate.r, candidate.g, candidate.b);
      outlineConfidence = 0.85;
      break;
    }
  }

  const primaryLuminance = 0.299 * primary.r + 0.587 * primary.g + 0.114 * primary.b;
  if (outlineConfidence < 0.8) {
    outlineHex = primaryLuminance < 128 ? "#ffffff" : "#000000";
  }

  const contrast = colorDistance(primary.r, primary.g, primary.b, bgR, bgG, bgB);
  const contrastRatio = contrast / 441.67;
  const fillConfidence = clampConfidence(
    Math.min(1.0, 0.6 + contrastRatio * 0.3 + Math.min(0.1, fgRatio * 0.5)),
  );

  return {
    fill: primaryFillHex,
    outline: outlineHex,
    fillConfidence,
    outlineConfidence,
    source: "auto",
  };
}
