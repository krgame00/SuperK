import {
  clampConfidence,
  createDefaultStyleProfile,
  getStyleConfidenceBand,
  type ColorSampleRegion,
  type EvidenceAdmissionState,
  type StyleFallbackReason,
  type TextGradientStyle,
  type TextShadowStyle,
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

function estimateOutlineWidthRatio(fillPixels: number, outlinePixels: number): number {
  if (fillPixels <= 0 || outlinePixels <= 0) return 0;
  const total = fillPixels + outlinePixels;
  const innerLinearScale = Math.sqrt(fillPixels / total);
  // Approximate stroke thickness relative to the outer glyph diameter.
  return Math.max(0.02, Math.min(0.30, (1 - innerLinearScale) / 2));
}

function finalizeRecoveredProfile(
  profile: Omit<TextStyleProfile, "source" | "fillConfidence" | "confidenceBand"> & {
    source?: TextStyleProfile["source"];
    fillConfidence?: number;
    confidenceBand?: TextStyleProfile["confidenceBand"];
    evidenceState?: EvidenceAdmissionState;
    fallbackReason?: StyleFallbackReason;
  },
  baseConfidence: number,
  evidenceStrength: number,
): TextStyleProfile {
  let confidence = clampConfidence(baseConfidence);
  let band = getStyleConfidenceBand(confidence);
  let refinementAttempted = false;

  if (band === "medium") {
    refinementAttempted = true;
    const evidence = clampConfidence(evidenceStrength);
    if (evidence >= 0.65) {
      confidence = clampConfidence(confidence + Math.min(0.14, (evidence - 0.55) * 0.35));
      band = getStyleConfidenceBand(confidence);
    }
  }

  const isRejected = profile.evidenceState === "rejected" || band === "low";
  const source = isRejected
    ? (profile.evidenceState === "rejected" ? "fallback" : "global")
    : (band === "high" ? "auto" : "global");

  const evidenceState: EvidenceAdmissionState =
    profile.evidenceState ?? (source === "auto" ? "admitted" : "unverified");

  let fallbackReason = profile.fallbackReason;
  if (!fallbackReason && source !== "auto") {
    fallbackReason = band === "medium" ? "medium-unresolved" : "low-confidence";
  }

  return {
    ...profile,
    fillConfidence: confidence,
    outlineConfidence: Math.min(profile.outlineConfidence ?? confidence, confidence),
    confidenceBand: band,
    refinementAttempted,
    source,
    evidenceState,
    fallbackReason,
  };
}

export interface ColorBucket {
  r: number;
  g: number;
  b: number;
  chroma: number;
  count: number;
  centerScore: number;
  borderTouchCount?: number;
  outerMarginCount?: number;
  innerCoreCount?: number;
  sumX?: number;
  sumY?: number;
  minX?: number;
  maxX?: number;
  minY?: number;
  maxY?: number;
}

export interface ColorCluster {
  r: number;
  g: number;
  b: number;
  chroma: number;
  count: number;
  centerScore: number;
  borderTouchCount?: number;
  outerMarginCount?: number;
  innerCoreCount?: number;
  sumX?: number;
  sumY?: number;
  minX?: number;
  maxX?: number;
  minY?: number;
  maxY?: number;
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
      matched.borderTouchCount = (matched.borderTouchCount ?? 0) + (b.borderTouchCount ?? 0);
      matched.outerMarginCount = (matched.outerMarginCount ?? 0) + (b.outerMarginCount ?? 0);
      matched.innerCoreCount = (matched.innerCoreCount ?? 0) + (b.innerCoreCount ?? 0);
      matched.sumX = (matched.sumX ?? 0) + (b.sumX ?? 0);
      matched.sumY = (matched.sumY ?? 0) + (b.sumY ?? 0);
      matched.minX = Math.min(matched.minX ?? (b.minX ?? 0), b.minX ?? 0);
      matched.maxX = Math.max(matched.maxX ?? (b.maxX ?? 0), b.maxX ?? 0);
      matched.minY = Math.min(matched.minY ?? (b.minY ?? 0), b.minY ?? 0);
      matched.maxY = Math.max(matched.maxY ?? (b.maxY ?? 0), b.maxY ?? 0);
    } else {
      clusters.push({
        r: b.r,
        g: b.g,
        b: b.b,
        chroma: b.chroma,
        count: b.count,
        centerScore: b.centerScore,
        borderTouchCount: b.borderTouchCount ?? 0,
        outerMarginCount: b.outerMarginCount ?? 0,
        innerCoreCount: b.innerCoreCount ?? 0,
        sumX: b.sumX,
        sumY: b.sumY,
        minX: b.minX,
        maxX: b.maxX,
        minY: b.minY,
        maxY: b.maxY,
      });
    }
  }

  return clusters;
}

export function detectDirectionalGradient(
  clusters: ColorCluster[],
  totalChromatic: number,
): TextGradientStyle | undefined {
  const valid = clusters.filter((c) => c.count >= 4 && c.chroma >= 25);
  if (valid.length < 2) return undefined;

  const sorted = [...valid].sort((a, b) => b.count - a.count);
  const c1 = sorted[0];
  const c2 = sorted[1];

  const dist = colorDistance(c1.r, c1.g, c1.b, c2.r, c2.g, c2.b);
  if (dist < 35) return undefined;

  // The two clusters must account for at least 50% of chromatic pixels.
  if ((c1.count + c2.count) < totalChromatic * 0.50) return undefined;

  const meanX1 = (c1.sumX ?? 0) / c1.count;
  const meanY1 = (c1.sumY ?? 0) / c1.count;
  const meanX2 = (c2.sumX ?? 0) / c2.count;
  const meanY2 = (c2.sumY ?? 0) / c2.count;

  const spanY = Math.max(1, Math.max(c1.maxY ?? 0, c2.maxY ?? 0) - Math.min(c1.minY ?? 0, c2.minY ?? 0));
  const spanX = Math.max(1, Math.max(c1.maxX ?? 0, c2.maxX ?? 0) - Math.min(c1.minX ?? 0, c2.minX ?? 0));

  const dy = (meanY2 - meanY1) / spanY;
  const dx = (meanX2 - meanX1) / spanX;

  // Vertical gradient (top to bottom)
  if (Math.abs(dy) >= 0.20 && Math.abs(dy) >= Math.abs(dx) * 1.2) {
    const top = dy > 0 ? c1 : c2;
    const bottom = dy > 0 ? c2 : c1;
    return {
      angleDeg: 90,
      stops: [
        { offset: 0, color: rgbToHex(top.r, top.g, top.b) },
        { offset: 1, color: rgbToHex(bottom.r, bottom.g, bottom.b) },
      ],
    };
  }

  // Horizontal gradient (left to right)
  if (Math.abs(dx) >= 0.20 && Math.abs(dx) >= Math.abs(dy) * 1.2) {
    const left = dx > 0 ? c1 : c2;
    const right = dx > 0 ? c2 : c1;
    return {
      angleDeg: 0,
      stops: [
        { offset: 0, color: rgbToHex(left.r, left.g, left.b) },
        { offset: 1, color: rgbToHex(right.r, right.g, right.b) },
      ],
    };
  }

  return undefined;
}

function discardBorderConnectedComponents(
  foreground: Uint8Array,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  const visited = new Uint8Array(foreground.length);
  const neighbors = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0],           [1, 0],
    [-1, 1],  [0, 1],  [1, 1],
  ] as const;

  for (let start = 0; start < foreground.length; start++) {
    if (!foreground[start] || visited[start]) continue;
    const component: number[] = [];
    const queue = [start];
    visited[start] = 1;
    let touchesBorder = false;

    for (let head = 0; head < queue.length; head++) {
      const pixel = queue[head];
      component.push(pixel);
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        touchesBorder = true;
      }

      for (const [dx, dy] of neighbors) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx;
        if (!foreground[next] || visited[next]) continue;
        const pixelOffset = pixel * 4;
        const nextOffset = next * 4;
        if (
          colorDistance(
            rgba[pixelOffset],
            rgba[pixelOffset + 1],
            rgba[pixelOffset + 2],
            rgba[nextOffset],
            rgba[nextOffset + 1],
            rgba[nextOffset + 2],
          ) > 48
        ) {
          continue;
        }
        visited[next] = 1;
        queue.push(next);
      }
    }

    if (touchesBorder) {
      for (const pixel of component) foreground[pixel] = 0;
    }
  }
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
  const { width, height, rgba, glyphMask } = sample;
  const totalPixels = width * height;

  if (!rgba || totalPixels === 0 || width === 0 || height === 0) {
    return createDefaultStyleProfile("global");
  }

  const bgTolerance = options.backgroundTolerance ?? 26;
  const hasGlyphMask = glyphMask?.length === totalPixels;
  const minContrast = options.minContrast ?? (hasGlyphMask ? 10 : bgTolerance);

  // 1. Modal Background Estimation from Perimeter Border & Margins
  // Sample adequate margin so thin border lines, accent trims, or frame lines do not hijack background
  const borderWidth = Math.max(2, Math.floor(Math.min(width, height) * 0.18));
  const perimBuckets = new Map<string, { r: number; g: number; b: number; count: number }>();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const isBorder = x < borderWidth || x >= width - borderWidth || y < borderWidth || y >= height - borderWidth;
      const pixel = y * width + x;
      if (isBorder && (!hasGlyphMask || glyphMask[pixel] < 32)) {
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
  const bgLuminanceSamples: number[] = sortedPerim.map((b) =>
    Math.round(0.299 * b.r + 0.587 * b.g + 0.114 * b.b),
  );

  // 2. Identify Non-Background (Foreground Candidate) pixels & Color Distributions
  const isFg = new Uint8Array(totalPixels);
  let totalFgCount = 0;
  let chromaticCount = 0;
  let whiteCount = 0;
  let darkInkCount = 0;
  let maskedPixelCount = 0;
  let foregroundAlphaSum = 0;

  let chromaticSumX = 0;
  let chromaticSumY = 0;
  let chromaticMinX = Infinity;
  let chromaticMaxX = -Infinity;
  let chromaticMinY = Infinity;
  let chromaticMaxY = -Infinity;

  let darkInkSumX = 0;
  let darkInkSumY = 0;
  let darkInkMinX = Infinity;
  let darkInkMaxX = -Infinity;
  let darkInkMinY = Infinity;
  let darkInkMaxY = -Infinity;

  let whiteSumX = 0;
  let whiteSumY = 0;
  let whiteMinX = Infinity;
  let whiteMaxX = -Infinity;
  let whiteMinY = Infinity;
  let whiteMaxY = -Infinity;

  const chromaticBuckets = new Map<string, ColorBucket>();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const pixel = y * width + x;
      const a = rgba[idx + 3];
      if (a < 64) continue;

      if (hasGlyphMask) {
        if (glyphMask[pixel] < 32) continue;
        maskedPixelCount++;
      }

      const r = rgba[idx];
      const g = rgba[idx + 1];
      const b = rgba[idx + 2];
      const distFromBg = colorDistance(r, g, b, bgR, bgG, bgB);
      if (distFromBg >= (hasGlyphMask ? minContrast : bgTolerance)) {
        isFg[pixel] = 1;
      }
    }
  }

  if (!hasGlyphMask) {
    discardBorderConnectedComponents(isFg, rgba, width, height);
  }

  const marginX = Math.max(1, Math.floor(width * 0.12));
  const marginY = Math.max(1, Math.floor(height * 0.12));
  let whiteInnerCoreCount = 0;
  let darkInkInnerCoreCount = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      if (!isFg[pixel]) continue;
      const idx = pixel * 4;
      const r = rgba[idx];
      const g = rgba[idx + 1];
      const b = rgba[idx + 2];
      const maxVal = Math.max(r, g, b);
      const minVal = Math.min(r, g, b);
      const chroma = maxVal - minVal;
      const saturation = maxVal > 0 ? chroma / maxVal : 0;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      totalFgCount++;
      foregroundAlphaSum += rgba[idx + 3];

      const isBorderTouch = x === 0 || x === width - 1 || y === 0 || y === height - 1;
      const isOuterMargin = x < marginX || x >= width - marginX || y < marginY || y >= height - marginY;
      const isInnerCore = !isOuterMargin;
      const bTouch = isBorderTouch ? 1 : 0;
      const oMargin = isOuterMargin ? 1 : 0;
      const iCore = isInnerCore ? 1 : 0;

      // Real manga colored text has high saturation (>= 40%) or high chroma (>= 70)
      // This strictly rejects pale skin tones, paper texture, and neutral shadows
      const isMangaColoredText = (saturation >= 0.38 && chroma >= 35) || chroma >= 70;

      if (isMangaColoredText) {
        chromaticCount++;
        chromaticSumX += x;
        chromaticSumY += y;
        chromaticMinX = Math.min(chromaticMinX, x);
        chromaticMaxX = Math.max(chromaticMaxX, x);
        chromaticMinY = Math.min(chromaticMinY, y);
        chromaticMaxY = Math.max(chromaticMaxY, y);

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
          existing.borderTouchCount = (existing.borderTouchCount ?? 0) + bTouch;
          existing.outerMarginCount = (existing.outerMarginCount ?? 0) + oMargin;
          existing.innerCoreCount = (existing.innerCoreCount ?? 0) + iCore;
          existing.sumX = (existing.sumX ?? 0) + x;
          existing.sumY = (existing.sumY ?? 0) + y;
          existing.minX = Math.min(existing.minX ?? x, x);
          existing.maxX = Math.max(existing.maxX ?? x, x);
          existing.minY = Math.min(existing.minY ?? y, y);
          existing.maxY = Math.max(existing.maxY ?? y, y);
        } else {
          chromaticBuckets.set(key, {
            r,
            g,
            b,
            chroma,
            count: 1,
            centerScore: centerWeight,
            borderTouchCount: bTouch,
            outerMarginCount: oMargin,
            innerCoreCount: iCore,
            sumX: x,
            sumY: y,
            minX: x,
            maxX: x,
            minY: y,
            maxY: y,
          });
        }
      } else if (lum >= 210) {
        whiteCount++;
        if (isInnerCore) whiteInnerCoreCount++;
        whiteSumX += x;
        whiteSumY += y;
        whiteMinX = Math.min(whiteMinX, x);
        whiteMaxX = Math.max(whiteMaxX, x);
        whiteMinY = Math.min(whiteMinY, y);
        whiteMaxY = Math.max(whiteMaxY, y);
      } else if (lum <= 65) {
        darkInkCount++;
        if (isInnerCore) darkInkInnerCoreCount++;
        darkInkSumX += x;
        darkInkSumY += y;
        darkInkMinX = Math.min(darkInkMinX, x);
        darkInkMaxX = Math.max(darkInkMaxX, x);
        darkInkMinY = Math.min(darkInkMinY, y);
        darkInkMaxY = Math.max(darkInkMaxY, y);
      }
    }
  }

  const fgRatio = totalFgCount / totalPixels;
  const candidateRatio = hasGlyphMask
    ? totalFgCount / Math.max(1, maskedPixelCount)
    : fgRatio;
  if (totalFgCount < 4 || candidateRatio < 0.005) {
    return {
      fill: bgLum > 128 ? "#000000" : "#ffffff",
      outline: bgLum > 128 ? "#ffffff" : "#000000",
      outlineWidth: 1.0,
      opacity: 1.0,
      fillConfidence: 0.35,
      outlineConfidence: 0.35,
      confidenceBand: "low",
      source: "global",
      fallbackReason: "low-confidence",
      backgroundLuminance: Math.round(bgLum),
      backgroundColor: rgbToHex(bgR, bgG, bgB),
    };
  }

  const maskPurity = hasGlyphMask
    ? totalFgCount / Math.max(1, maskedPixelCount)
    : 1;
  const autoConfidence = hasGlyphMask
    ? clampConfidence(0.55 + Math.min(0.45, maskPurity))
    : 0.95;

  const sourceOpacity = clampConfidence(
    foregroundAlphaSum / Math.max(1, totalFgCount * 255),
  );

  // 3. Manga archetype detection, preserving source outline presence instead of
  // inventing a readability stroke.
  const chromaticClusters = clusterBuckets(Array.from(chromaticBuckets.values()), 36);
  const sortedChromatic = chromaticClusters.sort(
    (a, b) => b.count * (1 + b.chroma / 80) - a.count * (1 + a.chroma / 80),
  );
  let topChromatic: ColorCluster | undefined = sortedChromatic[0];

  // Evidence Gate on Chromatic Candidate:
  // Reject candidate if it is contaminated by surrounding artwork / floor / trim
  if (topChromatic && !hasGlyphMask) {
    const touchCount = topChromatic.borderTouchCount ?? 0;
    const outerCount = topChromatic.outerMarginCount ?? 0;
    const innerCount = topChromatic.innerCoreCount ?? 0;
    const borderRatio = touchCount / Math.max(1, topChromatic.count);
    const outerRatio = outerCount / Math.max(1, topChromatic.count);
    const cropAreaRatio = topChromatic.count / totalPixels;

    const hasCentralTextAlternative = whiteInnerCoreCount >= 4 || darkInkInnerCoreCount >= 4;
    const chromSpanX = (topChromatic.maxX ?? width) - (topChromatic.minX ?? 0);
    const textSpanX = Math.max(whiteMaxX - whiteMinX, darkInkMaxX - darkInkMinX);
    const isSpanningArtwork =
      hasCentralTextAlternative && chromSpanX > textSpanX + Math.max(10, width * 0.20);

    const isBorderContaminated =
      (touchCount >= 2 || borderRatio > 0.08 || outerRatio > 0.35) &&
      (hasCentralTextAlternative || innerCount < 4);

    const isCropDominancePlane =
      cropAreaRatio > 0.50 ||
      (cropAreaRatio > 0.30 &&
        (touchCount > 0 || outerRatio > 0.20 || isSpanningArtwork));

    const distToBg = colorDistance(topChromatic.r, topChromatic.g, topChromatic.b, bgR, bgG, bgB);
    const resemblesBackground = distToBg < 32;

    if (isBorderContaminated || isCropDominancePlane || resemblesBackground || isSpanningArtwork) {
      topChromatic = undefined;
    }
  }

  const chromaticPurity = topChromatic ? topChromatic.count / Math.max(1, chromaticCount) : 0;
  const isChaoticChromatic =
    !hasGlyphMask &&
    ((chromaticClusters.length > 8 && chromaticPurity < 0.25) ||
      (topChromatic ? topChromatic.count < 6 : true));

  const hasStrongChromatic = Boolean(
    topChromatic &&
      !isChaoticChromatic &&
      topChromatic.count >= Math.max(6, totalFgCount * 0.025) &&
      (hasGlyphMask || chromaticPurity >= 0.20),
  );

  if (hasStrongChromatic && topChromatic) {
    const chromHex = rgbToHex(topChromatic.r, topChromatic.g, topChromatic.b);
    const fillGradient = detectDirectionalGradient(chromaticClusters, chromaticCount);

    // White core + vivid chromatic contour is strong evidence of a real outline/glow.
    // A genuine stroke/glow cannot have 3x or 5x more pixels than the core glyphs.
    const isChromaticContour =
      whiteCount >= Math.max(8, totalFgCount * 0.08) &&
      (hasGlyphMask || chromaticCount <= whiteCount * 2.2);

    if (isChromaticContour) {
      const outlineRatio = estimateOutlineWidthRatio(whiteCount, chromaticCount);
      const isDiffuseGlow = outlineRatio >= 0.08 && chromaticCount >= 8;
      const glowEffect: TextShadowStyle | undefined = isDiffuseGlow
        ? {
            color: chromHex,
            opacity: 0.85,
            blurRatio: Math.max(0.15, Math.min(0.35, outlineRatio * 1.5)),
            offsetXRatio: 0,
            offsetYRatio: 0,
          }
        : undefined;

      return finalizeRecoveredProfile(
        {
          fill: "#ffffff",
          outline: chromHex,
          hasOutline: true,
          outlineWidthRatio: outlineRatio,
          outlineWidth: 1.0,
          opacity: sourceOpacity,
          outlineConfidence: autoConfidence,
          glow: glowEffect,
          fillGradient,
          evidenceState: "admitted",
          backgroundLuminance: Math.round(bgLum),
          backgroundColor: rgbToHex(bgR, bgG, bgB),
        },
        autoConfidence,
        (whiteCount + chromaticCount) / Math.max(1, totalFgCount),
      );
    }

    // Solid chromatic lettering gets a dark outline only when dark contour pixels
    // are actually present. A light/dark background alone must not create a stroke.
    const hasDarkOutline = darkInkCount >= Math.max(4, totalFgCount * 0.03);
    let shadowEffect: TextShadowStyle | undefined;
    let isDropShadow = false;

    if (hasDarkOutline && chromaticCount > 0 && darkInkCount > 0) {
      const chromMeanX = chromaticSumX / chromaticCount;
      const chromMeanY = chromaticSumY / chromaticCount;
      const darkMeanX = darkInkSumX / darkInkCount;
      const darkMeanY = darkInkSumY / darkInkCount;

      const spanW = Math.max(1, chromaticMaxX - chromaticMinX);
      const spanH = Math.max(1, chromaticMaxY - chromaticMinY);

      const offsetX = (darkMeanX - chromMeanX) / spanW;
      const offsetY = (darkMeanY - chromMeanY) / spanH;
      const offsetDist = Math.hypot(offsetX, offsetY);

      if (offsetDist >= 0.10) {
        isDropShadow = true;
        shadowEffect = {
          color: "#1e1e1e",
          opacity: 0.85,
          blurRatio: 0.15,
          offsetXRatio: Math.max(0.04, Math.min(0.40, Math.round(offsetX * 100) / 100)),
          offsetYRatio: Math.max(0.04, Math.min(0.40, Math.round(offsetY * 100) / 100)),
        };
      }
    }

    const hasRealOutline = hasDarkOutline && !isDropShadow;
    return finalizeRecoveredProfile(
      {
        fill: chromHex,
        outline: hasRealOutline ? "#0a0a0a" : chromHex,
        hasOutline: hasRealOutline,
        outlineWidthRatio: hasRealOutline
          ? estimateOutlineWidthRatio(chromaticCount, darkInkCount)
          : 0,
        outlineWidth: hasRealOutline ? 1.0 : 0,
        opacity: sourceOpacity,
        outlineConfidence: clampConfidence(autoConfidence - 0.05),
        fillGradient,
        shadow: shadowEffect,
        evidenceState: "admitted",
        backgroundLuminance: Math.round(bgLum),
        backgroundColor: rgbToHex(bgR, bgG, bgB),
      },
      autoConfidence,
      (chromaticCount + (hasDarkOutline ? darkInkCount : 0)) / Math.max(1, totalFgCount),
    );
  }

  // 4. Speech Bubble Container vs. Text Ink Discrimination & High-contrast Dialogue
  // Text glyphs consist of thin strokes that occupy a fraction of the crop (usually < 20%).
  // A large uniform mass (e.g. whiteCount / totalPixels >= 0.20 or darkInkCount / totalPixels >= 0.20)
  // represents a speech bubble container, NOT text glyph ink.
  const whiteCropRatio = whiteCount / totalPixels;
  const darkCropRatio = darkInkCount / totalPixels;

  // Case A: White speech bubble on dark/colored panel artwork.
  // The perimeter may be dark artwork (bgLum <= 110), but the large white area is a speech bubble container.
  // The text inside a white speech bubble must be dark (#000000) to remain readable.
  if (whiteCropRatio >= 0.20) {
    const hasDarkText = darkInkCount >= 4 || darkInkInnerCoreCount >= 2;
    return finalizeRecoveredProfile(
      {
        fill: "#000000",
        outline: "#000000",
        hasOutline: false,
        outlineWidthRatio: 0,
        outlineWidth: 0,
        opacity: sourceOpacity,
        outlineConfidence: autoConfidence,
        evidenceState: hasDarkText ? "admitted" : "rejected",
        fallbackReason: hasDarkText ? undefined : "insufficient-evidence",
        backgroundLuminance: 255,
        backgroundColor: "#ffffff",
      },
      hasDarkText ? autoConfidence : 0.45,
      hasDarkText ? Math.max(0.7, darkInkCount / Math.max(1, totalFgCount)) : 0.40,
    );
  }

  // Case B: Inverted Black speech bubble containing white dialogue text.
  if (darkCropRatio >= 0.20 && (whiteCount >= 4 || whiteInnerCoreCount >= 2)) {
    return finalizeRecoveredProfile(
      {
        fill: "#ffffff",
        outline: "#ffffff",
        hasOutline: false,
        outlineWidthRatio: 0,
        outlineWidth: 0,
        opacity: sourceOpacity,
        outlineConfidence: autoConfidence,
        evidenceState: "admitted",
        backgroundLuminance: 0,
        backgroundColor: "#000000",
      },
      autoConfidence,
      Math.max(0.7, whiteCount / Math.max(1, totalFgCount)),
    );
  }

  // Case C: Standard black dialogue text on light/white background.
  const isDominantDarkInk =
    darkInkCount >= Math.max(6, totalFgCount * 0.15) && darkInkCount >= chromaticCount;

  if (
    bgLum >= 130 &&
    (isDominantDarkInk ||
      (darkInkInnerCoreCount >= 6 && darkInkCount > whiteCount && darkInkCount >= chromaticCount))
  ) {
    const contrast = colorDistance(0, 0, 0, bgR, bgG, bgB);
    if (contrast >= 40) {
      return finalizeRecoveredProfile(
        {
          fill: "#000000",
          outline: "#000000",
          hasOutline: false,
          outlineWidthRatio: 0,
          outlineWidth: 0,
          opacity: sourceOpacity,
          outlineConfidence: autoConfidence,
          evidenceState: "admitted",
          backgroundLuminance: Math.round(bgLum),
          backgroundColor: rgbToHex(bgR, bgG, bgB),
        },
        autoConfidence,
        darkInkCount / Math.max(1, totalFgCount),
      );
    }
  }

  // Case D: White text floating on dark artwork without outline.
  // Must NOT be a speech bubble container (whiteCropRatio < 0.25).
  const isDominantWhiteInk =
    whiteCropRatio < 0.25 &&
    whiteCount >= Math.max(6, totalFgCount * 0.15) &&
    whiteCount >= chromaticCount;

  if (
    bgLum <= 110 &&
    whiteCropRatio < 0.25 &&
    (isDominantWhiteInk ||
      (whiteInnerCoreCount >= 6 && whiteCount >= darkInkCount && whiteCount >= chromaticCount))
  ) {
    const contrast = colorDistance(255, 255, 255, bgR, bgG, bgB);
    if (contrast >= 40) {
      return finalizeRecoveredProfile(
        {
          fill: "#ffffff",
          outline: "#ffffff",
          hasOutline: false,
          outlineWidthRatio: 0,
          outlineWidth: 0,
          opacity: sourceOpacity,
          outlineConfidence: autoConfidence,
          evidenceState: "admitted",
          backgroundLuminance: Math.round(bgLum),
          backgroundColor: rgbToHex(bgR, bgG, bgB),
        },
        autoConfidence,
        whiteCount / Math.max(1, totalFgCount),
      );
    }
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
          existing.minX = Math.min(existing.minX ?? x, x);
          existing.maxX = Math.max(existing.maxX ?? x, x);
          existing.minY = Math.min(existing.minY ?? y, y);
          existing.maxY = Math.max(existing.maxY ?? y, y);
        } else {
          coreBuckets.set(key, {
            r,
            g,
            b,
            chroma,
            count: 1,
            centerScore: centerWeight * (1 + dist[p] * 0.5),
            minX: x,
            maxX: x,
            minY: y,
            maxY: y,
          });
        }
      } else {
        const isBorderTouch = x === 0 || x === width - 1 || y === 0 || y === height - 1;
        const isOuterMargin = x < marginX || x >= width - marginX || y < marginY || y >= height - marginY;
        const isInnerCore = !isOuterMargin;

        const existing = outlineBuckets.get(key);
        if (existing) {
          existing.r = (existing.r * existing.count + r) / (existing.count + 1);
          existing.g = (existing.g * existing.count + g) / (existing.count + 1);
          existing.b = (existing.b * existing.count + b) / (existing.count + 1);
          existing.chroma = Math.max(existing.chroma, chroma);
          existing.count++;
          existing.centerScore += centerWeight;
          if (isBorderTouch) existing.borderTouchCount = (existing.borderTouchCount ?? 0) + 1;
          if (isOuterMargin) existing.outerMarginCount = (existing.outerMarginCount ?? 0) + 1;
          if (isInnerCore) existing.innerCoreCount = (existing.innerCoreCount ?? 0) + 1;
          existing.minX = Math.min(existing.minX ?? x, x);
          existing.maxX = Math.max(existing.maxX ?? x, x);
          existing.minY = Math.min(existing.minY ?? y, y);
          existing.maxY = Math.max(existing.maxY ?? y, y);
        } else {
          outlineBuckets.set(key, {
            r,
            g,
            b,
            chroma,
            count: 1,
            centerScore: centerWeight,
            borderTouchCount: isBorderTouch ? 1 : 0,
            outerMarginCount: isOuterMargin ? 1 : 0,
            innerCoreCount: isInnerCore ? 1 : 0,
            minX: x,
            maxX: x,
            minY: y,
            maxY: y,
          });
        }
      }
    }
  }

  const coreClusters = clusterBuckets(Array.from(coreBuckets.values()), 36);
  const outlineClusters = clusterBuckets(Array.from(outlineBuckets.values()), 36);

  // Collect rejected background artwork colors identified in earlier stages
  const rejectedBgColors: Array<{ r: number; g: number; b: number }> = [];
  for (const c of chromaticClusters) {
    const cropRatio = c.count / totalPixels;
    const outerRatio = (c.outerMarginCount ?? 0) / Math.max(1, c.count);
    const spanX = (c.maxX ?? width) - (c.minX ?? 0);
    if (
      cropRatio > 0.35 ||
      ((c.borderTouchCount ?? 0) >= 2 && outerRatio > 0.15) ||
      (spanX > width * 0.70 && outerRatio > 0.10)
    ) {
      rejectedBgColors.push({ r: c.r, g: c.g, b: c.b });
    }
  }

  // If no glyph mask, reject background planes from being selected as the text core
  const validCoreClusters = coreClusters.filter((c) => {
    if (hasGlyphMask) return true;
    const outerRatio = (c.outerMarginCount ?? 0) / Math.max(1, c.count);
    const cropRatio = c.count / totalPixels;
    const spanX = (c.maxX ?? width) - (c.minX ?? 0);

    const isBackgroundPlane =
      cropRatio > 0.30 ||
      spanX > width * 0.65 ||
      ((c.borderTouchCount ?? 0) >= 2 && outerRatio > 0.15) ||
      rejectedBgColors.some((bg) => colorDistance(c.r, c.g, c.b, bg.r, bg.g, bg.b) < 35);

    return !isBackgroundPlane;
  });

  const candidateCoreClusters = validCoreClusters.length > 0 ? validCoreClusters : coreClusters;
  const sortedCore = candidateCoreClusters.sort((a, b) => b.centerScore - a.centerScore);
  const topCore = sortedCore[0] ?? { r: 0, g: 0, b: 0, chroma: 0, count: 0, centerScore: 0 };

  const fillR = topCore.r;
  const fillG = topCore.g;
  const fillB = topCore.b;
  const fillHex = rgbToHex(fillR, fillG, fillB);

  // Reject muddy skin tone outlines and artwork/floor outer contamination
  const candidateOutlines = outlineClusters
    .filter((c) => {
      const distToFill = colorDistance(c.r, c.g, c.b, fillR, fillG, fillB);
      const distToBg = colorDistance(c.r, c.g, c.b, bgR, bgG, bgB);
      const isMuddySkin = c.chroma < 26 && c.r > 120 && c.g > 80 && c.b > 70;

      // If no glyph mask, reject artwork outlines that touch borders, are outer-margin dominated,
      // or span far beyond the text core into the surrounding background
      if (!hasGlyphMask) {
        const touchCount = c.borderTouchCount ?? 0;
        const outerCount = c.outerMarginCount ?? 0;
        const outerRatio = outerCount / Math.max(1, c.count);
        const coreSpanX = (topCore.maxX ?? width) - (topCore.minX ?? 0);
        const outlineSpanX = (c.maxX ?? width) - (c.minX ?? 0);
        const isSpanningArtwork = outlineSpanX > coreSpanX + Math.max(10, width * 0.20);

        const isArtworkContamination =
          touchCount >= 2 ||
          outerRatio > 0.35 ||
          isSpanningArtwork ||
          (c.count > topCore.count * 1.5 && outerCount > 0);
        if (isArtworkContamination) return false;
      }

      return distToFill >= 40 && distToBg >= 25 && !isMuddySkin && c.count >= Math.max(2, totalFgCount * 0.03);
    })
    .sort((a, b) => {
      if (b.chroma >= 25 && a.chroma < 25) return 1;
      if (a.chroma >= 25 && b.chroma < 25) return -1;
      return b.centerScore - a.centerScore;
    });

  const hasOutline = candidateOutlines.length > 0;
  let outlineHex = fillHex;
  let outlineConfidence = 0.85;
  let outlineWidth = 0;
  let outlineWidthRatio = 0;

  if (hasOutline) {
    const topOutline = candidateOutlines[0];
    outlineHex = rgbToHex(topOutline.r, topOutline.g, topOutline.b);
    outlineConfidence = 0.92;
    outlineWidth = 1.0;
    outlineWidthRatio = estimateOutlineWidthRatio(topCore.count, topOutline.count);
  }

  const contrastFromBg = colorDistance(fillR, fillG, fillB, bgR, bgG, bgB);
  let fillConfidence = 0.70 + Math.min(0.25, (contrastFromBg / 441.67) * 0.35);
  if (topCore.count < 5 || maxDist < 2) {
    fillConfidence = Math.min(fillConfidence, 0.55);
  }

  const totalCoreCount = Math.max(1, sortedCore.reduce((sum, c) => sum + c.count, 0));
  const corePurity = topCore.count / totalCoreCount;
  fillConfidence = Math.min(fillConfidence, autoConfidence);
  outlineConfidence = Math.min(outlineConfidence, autoConfidence);

  // Evidence Gate evaluation
  let evidenceState: EvidenceAdmissionState = "unverified";
  let fallbackReason: StyleFallbackReason | undefined = undefined;

  if (hasGlyphMask) {
    // Precise glyph mask provides authoritative ground truth
    evidenceState = "admitted";
  } else {
    // Without glyph mask, require trustworthy local text evidence:
    // 1. Extreme background chaos / high fragmentation / low core purity -> reject
    const isChaotic =
      corePurity < 0.25 ||
      (sortedCore.length > 8 && corePurity < 0.35) ||
      topCore.count < 4 ||
      maxDist < 2;
    // 2. Candidate resembles background without strong contrasting outline -> reject
    const isBgResemblance = contrastFromBg < 35 && (!hasOutline || outlineConfidence < 0.80);

    if (isChaotic) {
      evidenceState = "rejected";
      fallbackReason = "insufficient-evidence";
      fillConfidence = Math.min(fillConfidence, 0.45);
    } else if (isBgResemblance) {
      evidenceState = "rejected";
      fallbackReason = "background-contamination";
      fillConfidence = Math.min(fillConfidence, 0.45);
    } else if (fillConfidence >= 0.80 && contrastFromBg >= 35) {
      evidenceState = "admitted";
    }
  }

  return finalizeRecoveredProfile(
    {
      fill: fillHex,
      outline: outlineHex,
      hasOutline,
      outlineWidthRatio,
      outlineWidth,
      opacity: sourceOpacity,
      outlineConfidence: clampConfidence(outlineConfidence),
      evidenceState,
      fallbackReason,
      backgroundLuminance: Math.round(bgLum),
      backgroundLuminanceSamples: bgLuminanceSamples.length > 0 ? bgLuminanceSamples : undefined,
      backgroundColor: rgbToHex(bgR, bgG, bgB),
    },
    fillConfidence,
    Math.min(corePurity, contrastFromBg / 120),
  );
}
