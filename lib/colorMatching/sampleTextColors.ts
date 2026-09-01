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
 * Topologically Accurate Text Style & Color Extraction
 * Uses multi-pass Distance Transform to separate the innermost core (FILL)
 * from the surrounding stroke/contour (OUTLINE), preventing color inversion.
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

  const bgTolerance = options.backgroundTolerance ?? 26;

  // 1. Modal Background Estimation from Perimeter Border (Prevents Muddy Border Averages)
  const borderWidth = Math.max(1, Math.min(3, Math.floor(Math.min(width, height) / 6)));
  const perimBuckets = new Map<string, { r: number; g: number; b: number; count: number }>();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isBorder = x < borderWidth || x >= width - borderWidth || y < borderWidth || y >= height - borderWidth;
      if (isBorder) {
        const idx = (y * width + x) * 4;
        const a = rgba[idx + 3];
        if (a >= 64) {
          const r = rgba[idx];
          const g = rgba[idx + 1];
          const b = rgba[idx + 2];
          const qr = Math.floor(r / 16) * 16 + 8;
          const qg = Math.floor(g / 16) * 16 + 8;
          const qb = Math.floor(b / 16) * 16 + 8;
          const key = `${qr},${qg},${qb}`;
          const existing = perimBuckets.get(key);
          if (existing) {
            existing.r = (existing.r * existing.count + r) / (existing.count + 1);
            existing.g = (existing.g * existing.count + g) / (existing.count + 1);
            existing.b = (existing.b * existing.count + b) / (existing.count + 1);
            existing.count++;
          } else {
            perimBuckets.set(key, { r, g, b, count: 1 });
          }
        }
      }
    }
  }

  const sortedPerim = Array.from(perimBuckets.values()).sort((a, b) => b.count - a.count);
  const dominantPerim = sortedPerim[0] ?? { r: 255, g: 255, b: 255, count: 1 };
  const bgR = dominantPerim.r;
  const bgG = dominantPerim.g;
  const bgB = dominantPerim.b;
  const bgLum = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;

  // 2. Identify Non-Background (Foreground Candidate) pixels & Color Distributions
  const isFg = new Uint8Array(totalPixels);
  let totalFgCount = 0;
  let chromaticCount = 0;
  let whiteCount = 0;
  let darkInkCount = 0;

  const chromaticBuckets = new Map<string, ColorBucket>();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const a = rgba[idx + 3];
      if (a < 64) continue;

      const r = rgba[idx];
      const g = rgba[idx + 1];
      const b = rgba[idx + 2];
      const maxVal = Math.max(r, g, b);
      const minVal = Math.min(r, g, b);
      const chroma = maxVal - minVal;
      const saturation = maxVal > 0 ? chroma / maxVal : 0;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      const distFromBg = colorDistance(r, g, b, bgR, bgG, bgB);
      if (distFromBg >= bgTolerance) {
        isFg[y * width + x] = 1;
        totalFgCount++;

        // Real manga colored text has high saturation (>= 40%) or high chroma (>= 70)
        // This strictly rejects pale skin tones, paper texture, and neutral shadows
        const isMangaColoredText = (saturation >= 0.38 && chroma >= 35) || chroma >= 70;

        if (isMangaColoredText) {
          chromaticCount++;
          const qr = Math.floor(r / 16) * 16 + 8;
          const qg = Math.floor(g / 16) * 16 + 8;
          const qb = Math.floor(b / 16) * 16 + 8;
          const key = `${qr},${qg},${qb}`;

          const nx = (x - width / 2) / Math.max(1, width / 2);
          const ny = (y - height / 2) / Math.max(1, height / 2);
          const distFromCenter = Math.sqrt(nx * nx + ny * ny);
          const centerWeight = distFromCenter <= 0.65 ? 2.5 : 1.0;

          const existing = chromaticBuckets.get(key);
          if (existing) {
            existing.r = (existing.r * existing.count + r) / (existing.count + 1);
            existing.g = (existing.g * existing.count + g) / (existing.count + 1);
            existing.b = (existing.b * existing.count + b) / (existing.count + 1);
            existing.chroma = Math.max(existing.chroma, chroma);
            existing.count++;
            existing.centerScore += centerWeight;
          } else {
            chromaticBuckets.set(key, { r, g, b, chroma, count: 1, centerScore: centerWeight });
          }
        } else if (lum >= 210) {
          whiteCount++;
        } else if (lum <= 65) {
          darkInkCount++;
        }
      }
    }
  }

  const fgRatio = totalFgCount / totalPixels;
  if (totalFgCount < 4 || fgRatio < 0.005) {
    return {
      fill: bgLum > 128 ? "#000000" : "#ffffff",
      outline: bgLum > 128 ? "#ffffff" : "#000000",
      outlineWidth: 1.0,
      opacity: 1.0,
      fillConfidence: 0.35,
      outlineConfidence: 0.35,
      source: "global",
    };
  }

  // 3. Manga Archetype Detection: Chromatic Text & Glowing Outlines
  const hasStrongChromatic = chromaticCount >= Math.max(6, totalFgCount * 0.025);
  const chromaticClusters = clusterBuckets(Array.from(chromaticBuckets.values()), 36);
  const topChromatic = chromaticClusters.sort((a, b) => (b.count * (1 + b.chroma / 80)) - (a.count * (1 + a.chroma / 80)))[0];

  if (hasStrongChromatic && topChromatic) {
    const chromHex = rgbToHex(topChromatic.r, topChromatic.g, topChromatic.b);

    // Case 3A: White core text with vibrant chromatic outline/glow (e.g. White text with Pink/Red/Purple/Cyan stroke)
    if (whiteCount >= Math.max(8, totalFgCount * 0.08)) {
      return {
        fill: "#ffffff",
        outline: chromHex,
        outlineWidth: 1.25,
        opacity: 1.0,
        fillConfidence: 0.95,
        outlineConfidence: 0.95,
        source: "auto",
      };
    }

    // Case 3B: Solid Chromatic Text (e.g. Red handwriting, Pink thoughts, Blue SFX)
    let outlineHex = "#ffffff";
    if (darkInkCount >= Math.max(4, totalFgCount * 0.03) && bgLum >= 120) {
      outlineHex = "#0a0a0a";
    } else if (bgLum < 128) {
      outlineHex = "#ffffff";
    }
    return {
      fill: chromHex,
      outline: outlineHex,
      outlineWidth: 1.0,
      opacity: 1.0,
      fillConfidence: 0.95,
      outlineConfidence: 0.90,
      source: "auto",
    };
  }

  // 4. Manga Archetype Detection: High-Contrast Monochrome Speech Bubbles
  if (bgLum >= 135 && darkInkCount >= 4) {
    // Standard Black Dialogue on White/Light Bubble -> Strictly #000000 fill with #ffffff outline
    return {
      fill: "#000000",
      outline: "#ffffff",
      outlineWidth: 1.0,
      opacity: 1.0,
      fillConfidence: 0.95,
      outlineConfidence: 0.95,
      source: "auto",
    };
  }

  if (bgLum <= 90 && whiteCount >= 4) {
    // Dark/Night Bubble or Dark Panel -> Strictly #ffffff fill with #000000 outline
    return {
      fill: "#ffffff",
      outline: "#000000",
      outlineWidth: 1.0,
      opacity: 1.0,
      fillConfidence: 0.95,
      outlineConfidence: 0.95,
      source: "auto",
    };
  }

  // 5. Multi-pass Distance Transform Core / Contour Extraction
  const dist = new Int32Array(totalPixels);
  const queue: number[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (!isFg[p] || x === 0 || x === width - 1 || y === 0 || y === height - 1) {
        dist[p] = 0;
      } else {
        dist[p] = -1; // Unvisited foreground
      }
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (dist[p] === 0) {
        if (x > 0 && dist[p - 1] === -1) { dist[p - 1] = 1; queue.push(p - 1); }
        if (x < width - 1 && dist[p + 1] === -1) { dist[p + 1] = 1; queue.push(p + 1); }
        if (y > 0 && dist[p - width] === -1) { dist[p - width] = 1; queue.push(p - width); }
        if (y < height - 1 && dist[p + width] === -1) { dist[p + width] = 1; queue.push(p + width); }
      }
    }
  }

  let head = 0;
  let maxDist = 1;

  while (head < queue.length) {
    const p = queue[head++];
    const d = dist[p];
    if (d > maxDist) maxDist = d;

    const x = p % width;
    const y = Math.floor(p / width);

    if (x > 0 && dist[p - 1] === -1) { dist[p - 1] = d + 1; queue.push(p - 1); }
    if (x < width - 1 && dist[p + 1] === -1) { dist[p + 1] = d + 1; queue.push(p + 1); }
    if (y > 0 && dist[p - width] === -1) { dist[p - width] = d + 1; queue.push(p - width); }
    if (y < height - 1 && dist[p + width] === -1) { dist[p + width] = d + 1; queue.push(p + width); }
  }

  const coreThreshold = maxDist <= 2 ? 1 : Math.max(2, Math.floor(maxDist * 0.45));
  const coreBuckets = new Map<string, ColorBucket>();
  const outlineBuckets = new Map<string, ColorBucket>();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (!isFg[p]) continue;

      const idx = p * 4;
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
      const centerWeight = distFromCenter <= 0.65 ? 2.5 : 1.0;

      if (dist[p] >= coreThreshold) {
        const existing = coreBuckets.get(key);
        if (existing) {
          existing.r = (existing.r * existing.count + r) / (existing.count + 1);
          existing.g = (existing.g * existing.count + g) / (existing.count + 1);
          existing.b = (existing.b * existing.count + b) / (existing.count + 1);
          existing.chroma = Math.max(existing.chroma, chroma);
          existing.count++;
          existing.centerScore += centerWeight * (1 + dist[p] * 0.5);
        } else {
          coreBuckets.set(key, { r, g, b, chroma, count: 1, centerScore: centerWeight * (1 + dist[p] * 0.5) });
        }
      } else {
        const existing = outlineBuckets.get(key);
        if (existing) {
          existing.r = (existing.r * existing.count + r) / (existing.count + 1);
          existing.g = (existing.g * existing.count + g) / (existing.count + 1);
          existing.b = (existing.b * existing.count + b) / (existing.count + 1);
          existing.chroma = Math.max(existing.chroma, chroma);
          existing.count++;
          existing.centerScore += centerWeight;
        } else {
          outlineBuckets.set(key, { r, g, b, chroma, count: 1, centerScore: centerWeight });
        }
      }
    }
  }

  const coreClusters = clusterBuckets(Array.from(coreBuckets.values()), 36);
  const outlineClusters = clusterBuckets(Array.from(outlineBuckets.values()), 36);

  const sortedCore = coreClusters.sort((a, b) => b.centerScore - a.centerScore);
  const topCore = sortedCore[0] ?? { r: 0, g: 0, b: 0, chroma: 0, count: 0, centerScore: 0 };

  const fillR = topCore.r;
  const fillG = topCore.g;
  const fillB = topCore.b;
  const fillHex = rgbToHex(fillR, fillG, fillB);

  // Reject muddy skin tone outlines (low-chroma brownish-gray artwork edges)
  const candidateOutlines = outlineClusters
    .filter((c) => {
      const distToFill = colorDistance(c.r, c.g, c.b, fillR, fillG, fillB);
      const distToBg = colorDistance(c.r, c.g, c.b, bgR, bgG, bgB);
      const isMuddySkin = c.chroma < 26 && c.r > 120 && c.g > 80 && c.b > 70;
      return distToFill >= 40 && distToBg >= 25 && !isMuddySkin && c.count >= Math.max(2, totalFgCount * 0.03);
    })
    .sort((a, b) => {
      if (b.chroma >= 25 && a.chroma < 25) return 1;
      if (a.chroma >= 25 && b.chroma < 25) return -1;
      return b.centerScore - a.centerScore;
    });

  let outlineHex = "";
  let outlineConfidence = 0.80;
  let outlineWidth = 1.0;

  if (candidateOutlines.length > 0) {
    const topOutline = candidateOutlines[0];
    outlineHex = rgbToHex(topOutline.r, topOutline.g, topOutline.b);
    outlineConfidence = 0.92;
    outlineWidth = maxDist >= 3 ? 1.25 : 1.0;
  } else {
    const fillLum = 0.299 * fillR + 0.587 * fillG + 0.114 * fillB;
    outlineHex = fillLum < 128 ? "#ffffff" : "#000000";
    outlineConfidence = 0.85;
    outlineWidth = 1.0;
  }

  const contrastFromBg = colorDistance(fillR, fillG, fillB, bgR, bgG, bgB);
  let fillConfidence = 0.70 + Math.min(0.25, (contrastFromBg / 441.67) * 0.35);
  if (topCore.count < 5 || maxDist < 2) {
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

