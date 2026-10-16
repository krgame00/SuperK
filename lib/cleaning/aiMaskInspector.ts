import type { PixelRect } from "./types";

export type AiMaskVerdict = "good" | "under_masked" | "over_masked" | "adjusted";
export type AiMaskViewMode = "diff" | "current" | "ai";

/** Normalized [ymin, xmin, ymax, xmax] in 0..1000 within the selected region rect. */
export type NormalizedRegionBox = [number, number, number, number];

export interface AiMaskDiffStats {
  currentPixels: number;
  suggestedPixels: number;
  addedCount: number;
  removedCount: number;
  keptCount: number;
  matchPercent: number;
}

export interface AiMaskAuditResult {
  regionId: string;
  rect: PixelRect;
  baseMask: ImageData;
  suggestedMask: ImageData;
  diffMask: ImageData;
  stats: AiMaskDiffStats;
  verdict: AiMaskVerdict;
  summary: string;
  source: "local" | "hybrid-gemini";
  geminiSummary?: string;
}

export interface GeminiMaskReviewPayload {
  verdict: AiMaskVerdict;
  summary: string;
  addBoxes: NormalizedRegionBox[];
  protectBoxes: NormalizedRegionBox[];
}

function cloneImageData(source: ImageData): ImageData {
  return new ImageData(
    new Uint8ClampedArray(source.data),
    source.width,
    source.height,
  );
}

function clampRect(rect: PixelRect, width: number, height: number): PixelRect {
  const x = Math.max(0, Math.min(width, Math.round(rect.x)));
  const y = Math.max(0, Math.min(height, Math.round(rect.y)));
  const w = Math.max(0, Math.min(width - x, Math.round(rect.width)));
  const h = Math.max(0, Math.min(height - y, Math.round(rect.height)));
  return { x, y, width: w, height: h };
}

function isMaskPixelActive(data: Uint8ClampedArray, index: number): boolean {
  return data[index + 3] > 0 && data[index + 2] !== 255;
}

function computeMedian(values: number[]): number {
  if (values.length === 0) return 240;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) * 0.5
    : sorted[mid];
}

/**
 * Build the visual diff ImageData and pixel counts between baseMask and suggestedMask
 * inside the given region rect.
 * - Red (255, 55, 80, 150) = Kept mask pixel (both base and AI agree)
 * - Green (16, 235, 130, 215) = AI Added pixel (under-masked text/remnant)
 * - Sky Blue (45, 185, 255, 205) = AI Removed/Protected pixel (over-masked border/art)
 */
export function buildMaskDiffOverlay(
  baseMask: ImageData,
  suggestedMask: ImageData,
  rect: PixelRect,
): { diffMask: ImageData; stats: AiMaskDiffStats } {
  const diffMask = cloneImageData(baseMask);
  const bData = baseMask.data;
  const sData = suggestedMask.data;
  const dData = diffMask.data;
  const width = baseMask.width;
  const height = baseMask.height;
  const clamped = clampRect(rect, width, height);

  let currentPixels = 0;
  let suggestedPixels = 0;
  let addedCount = 0;
  let removedCount = 0;
  let keptCount = 0;

  for (let y = clamped.y; y < clamped.y + clamped.height; y++) {
    const rowOffset = y * width;
    for (let x = clamped.x; x < clamped.x + clamped.width; x++) {
      const idx = (rowOffset + x) * 4;
      const wasActive = isMaskPixelActive(bData, idx);
      const nowActive = isMaskPixelActive(sData, idx);
      if (wasActive) currentPixels += 1;
      if (nowActive) suggestedPixels += 1;

      if (wasActive && nowActive) {
        keptCount += 1;
        dData[idx] = 255;
        dData[idx + 1] = 55;
        dData[idx + 2] = 80;
        dData[idx + 3] = 145;
      } else if (!wasActive && nowActive) {
        addedCount += 1;
        dData[idx] = 16;
        dData[idx + 1] = 235;
        dData[idx + 2] = 130;
        dData[idx + 3] = 215;
      } else if (wasActive && !nowActive) {
        removedCount += 1;
        dData[idx] = 45;
        dData[idx + 1] = 185;
        dData[idx + 2] = 255;
        dData[idx + 3] = 205;
      } else {
        dData[idx] = 255;
        dData[idx + 1] = 55;
        dData[idx + 2] = 80;
        dData[idx + 3] = 0;
      }
    }
  }

  const union = keptCount + addedCount + removedCount;
  const matchPercent = union > 0 ? Math.round((keptCount / union) * 100) : 100;

  return {
    diffMask,
    stats: {
      currentPixels,
      suggestedPixels,
      addedCount,
      removedCount,
      keptCount,
      matchPercent,
    },
  };
}

function summarizeMaskStats(stats: AiMaskDiffStats): {
  verdict: AiMaskVerdict;
  summary: string;
} {
  const { addedCount, removedCount } = stats;
  if (addedCount < 8 && removedCount < 8) {
    return {
      verdict: "good",
      summary: "Mask เดิมคลุมพื้นที่ตัวอักษรได้พอดีแล้ว ไม่พบจุดตกหล่นหรือล้ำขอบที่มีนัยสำคัญ",
    };
  }
  if (addedCount >= 8 && removedCount >= 8) {
    return {
      verdict: "adjusted",
      summary: `AI แนะนำเก็บขอบตัวอักษรเพิ่ม +${addedCount.toLocaleString()} px (สีเขียว) และเว้นขอบที่กินเกิน -${removedCount.toLocaleString()} px (สีฟ้า)`,
    };
  }
  if (addedCount >= 8) {
    return {
      verdict: "under_masked",
      summary: `AI พบขอบตัวอักษรหรือเศษหมึกที่ Mask เดิมยังคลุมไม่หมด +${addedCount.toLocaleString()} px (สีเขียว)`,
    };
  }
  return {
    verdict: "over_masked",
    summary: `AI พบจุดที่ Mask เดิมล้ำเส้นกรอบหรือพื้นหลังเกินจำเป็น -${removedCount.toLocaleString()} px (สีฟ้า)`,
  };
}

/**
 * Local Smart Mask Auditor:
 * Inspects the original image crop, optional cleaned image crop, and current mask
 * within `rect` to propose pixel-accurate additions (under-masked glyph strokes/halos)
 * and removals (over-masked perimeter/border bleed).
 */
export function analyzeRegionMaskLocally(params: {
  regionId: string;
  rect: PixelRect;
  baseMask: ImageData;
  originalCrop?: ImageData | null;
  cleanedCrop?: ImageData | null;
}): AiMaskAuditResult {
  const { regionId, rect, baseMask, originalCrop, cleanedCrop } = params;
  const width = baseMask.width;
  const height = baseMask.height;
  const clamped = clampRect(rect, width, height);
  const rw = clamped.width;
  const rh = clamped.height;

  const suggestedMask = cloneImageData(baseMask);
  if (rw <= 4 || rh <= 4) {
    const { diffMask, stats } = buildMaskDiffOverlay(baseMask, suggestedMask, clamped);
    const { verdict, summary } = summarizeMaskStats(stats);
    return {
      regionId,
      rect: clamped,
      baseMask: cloneImageData(baseMask),
      suggestedMask,
      diffMask,
      stats,
      verdict,
      summary,
      source: "local",
    };
  }

  const bData = baseMask.data;
  const sData = suggestedMask.data;
  const curGrid = new Uint8Array(rw * rh);
  for (let ly = 0; ly < rh; ly++) {
    const gy = clamped.y + ly;
    const rowOff = gy * width;
    for (let lx = 0; lx < rw; lx++) {
      const gx = clamped.x + lx;
      const idx = (rowOff + gx) * 4;
      curGrid[ly * rw + lx] = isMaskPixelActive(bData, idx) ? 1 : 0;
    }
  }

  const nextGrid = new Uint8Array(curGrid);

  if (originalCrop && originalCrop.width === rw && originalCrop.height === rh) {
    const oData = originalCrop.data;
    const cData =
      cleanedCrop && cleanedCrop.width === rw && cleanedCrop.height === rh
        ? cleanedCrop.data
        : null;

    const luma = new Float32Array(rw * rh);
    const cleanLuma = cData ? new Float32Array(rw * rh) : null;
    const bgSamples: number[] = [];
    const inkSamples: number[] = [];

    const marginX = Math.min(4, Math.floor(rw * 0.1));
    const marginY = Math.min(4, Math.floor(rh * 0.1));

    for (let ly = 0; ly < rh; ly++) {
      for (let lx = 0; lx < rw; lx++) {
        const i = ly * rw + lx;
        const p = i * 4;
        const yVal =
          0.299 * oData[p] + 0.587 * oData[p + 1] + 0.114 * oData[p + 2];
        luma[i] = yVal;
        if (cleanLuma && cData) {
          cleanLuma[i] =
            0.299 * cData[p] + 0.587 * cData[p + 1] + 0.114 * cData[p + 2];
        }
        const insideMargin =
          lx >= marginX &&
          lx < rw - marginX &&
          ly >= marginY &&
          ly < rh - marginY;
        if (insideMargin) {
          if (curGrid[i] === 1) {
            if (inkSamples.length < 1200) inkSamples.push(yVal);
          } else if (bgSamples.length < 1500) {
            bgSamples.push(yVal);
          }
        }
      }
    }

    const bgMedian = computeMedian(bgSamples);
    const inkMedian = inkSamples.length > 0 ? computeMedian(inkSamples) : bgMedian > 128 ? 35 : 220;
    const contrastSpan = Math.max(28, Math.abs(bgMedian - inkMedian));
    const strokeThreshold = Math.max(24, contrastSpan * 0.42);
    const haloThreshold = Math.max(18, contrastSpan * 0.28);

    // Find bounding box of existing mask inside the region (or fall back to inner 76% box)
    let minMaskX = rw;
    let minMaskY = rh;
    let maxMaskX = -1;
    let maxMaskY = -1;
    for (let ly = 0; ly < rh; ly++) {
      for (let lx = 0; lx < rw; lx++) {
        if (curGrid[ly * rw + lx] === 1) {
          if (lx < minMaskX) minMaskX = lx;
          if (lx > maxMaskX) maxMaskX = lx;
          if (ly < minMaskY) minMaskY = ly;
          if (ly > maxMaskY) maxMaskY = ly;
        }
      }
    }

    const hasExistingMask = maxMaskX >= minMaskX && maxMaskY >= minMaskY;
    const envX0 = hasExistingMask
      ? Math.max(2, minMaskX - 8)
      : Math.max(2, Math.floor(rw * 0.12));
    const envY0 = hasExistingMask
      ? Math.max(2, minMaskY - 8)
      : Math.max(2, Math.floor(rh * 0.12));
    const envX1 = hasExistingMask
      ? Math.min(rw - 2, maxMaskX + 9)
      : Math.min(rw - 2, Math.ceil(rw * 0.88));
    const envY1 = hasExistingMask
      ? Math.min(rh - 2, maxMaskY + 9)
      : Math.min(rh - 2, Math.ceil(rh * 0.88));

    // Distance-1 and Distance-2 dilation of current mask for halo/stroke growth
    const nearMask = new Uint8Array(rw * rh);
    for (let ly = 1; ly < rh - 1; ly++) {
      for (let lx = 1; lx < rw - 1; lx++) {
        const i = ly * rw + lx;
        if (curGrid[i] === 1) {
          nearMask[i] = 2;
          continue;
        }
        let touches1 = false;
        let touches2 = false;
        for (let dy = -2; dy <= 2; dy++) {
          const ny = ly + dy;
          if (ny < 0 || ny >= rh) continue;
          for (let dx = -2; dx <= 2; dx++) {
            const nx = lx + dx;
            if (nx < 0 || nx >= rw) continue;
            if (curGrid[ny * rw + nx] === 1) {
              if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) touches1 = true;
              touches2 = true;
            }
          }
        }
        if (touches1) nearMask[i] = 2;
        else if (touches2) nearMask[i] = 1;
      }
    }

    // 1. Detect Under-Masked pixels (glyph halos & uncleaned text strokes inside envelope)
    for (let ly = envY0; ly < envY1; ly++) {
      for (let lx = envX0; lx < envX1; lx++) {
        const i = ly * rw + lx;
        if (curGrid[i] === 1) continue;
        const origDiff = Math.abs(luma[i] - bgMedian);
        const cleanDiff = cleanLuma ? Math.abs(cleanLuma[i] - bgMedian) : origDiff;

        if (nearMask[i] === 2 && (origDiff >= haloThreshold || cleanDiff >= haloThreshold)) {
          nextGrid[i] = 1;
        } else if (nearMask[i] === 1 && origDiff >= strokeThreshold) {
          nextGrid[i] = 1;
        } else if (origDiff >= strokeThreshold * 1.18 && cleanDiff >= strokeThreshold * 0.85) {
          // Check 3x3 neighborhood for connected stroke pixels so we don't pick up single-pixel noise
          let strongNeighbors = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nIdx = (ly + dy) * rw + (lx + dx);
              if (Math.abs(luma[nIdx] - bgMedian) >= strokeThreshold) {
                strongNeighbors += 1;
              }
            }
          }
          if (strongNeighbors >= 2) {
            nextGrid[i] = 1;
          }
        }
      }
    }

    // 2. Detect Over-Masked pixels:
    // (a) Perimeter bleed (within 2px of region boundary where mask touches region edge)
    // (b) Masked background pixels on outer fringe of mask that are already pure background color
    const borderMargin = 2;
    for (let ly = 0; ly < rh; ly++) {
      for (let lx = 0; lx < rw; lx++) {
        const i = ly * rw + lx;
        if (curGrid[i] === 0) continue;
        const onPerimeter =
          lx < borderMargin ||
          lx >= rw - borderMargin ||
          ly < borderMargin ||
          ly >= rh - borderMargin;
        if (onPerimeter) {
          nextGrid[i] = 0;
          continue;
        }
        // Check if this pixel is on the outer edge of the current mask and has almost zero contrast with background
        const origDiff = Math.abs(luma[i] - bgMedian);
        if (origDiff < haloThreshold * 0.45) {
          let unmaskedNeighbors = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (curGrid[(ly + dy) * rw + (lx + dx)] === 0) {
                unmaskedNeighbors += 1;
              }
            }
          }
          if (unmaskedNeighbors >= 5) {
            nextGrid[i] = 0;
          }
        }
      }
    }
  } else {
    // Fallback when image pixel readback isn't available (e.g. unit test mock):
    // dilate existing interior mask by 1px while trimming 1px perimeter bleed.
    for (let ly = 0; ly < rh; ly++) {
      for (let lx = 0; lx < rw; lx++) {
        const i = ly * rw + lx;
        const onEdge = lx === 0 || lx === rw - 1 || ly === 0 || ly === rh - 1;
        if (onEdge) {
          nextGrid[i] = 0;
          continue;
        }
        if (curGrid[i] === 1) continue;
        if (
          curGrid[ly * rw + (lx - 1)] === 1 ||
          curGrid[ly * rw + (lx + 1)] === 1 ||
          curGrid[(ly - 1) * rw + lx] === 1 ||
          curGrid[(ly + 1) * rw + lx] === 1
        ) {
          nextGrid[i] = 1;
        }
      }
    }
  }

  // Write nextGrid back into suggestedMask inside clamped rect
  for (let ly = 0; ly < rh; ly++) {
    const gy = clamped.y + ly;
    const rowOff = gy * width;
    for (let lx = 0; lx < rw; lx++) {
      const gx = clamped.x + lx;
      const idx = (rowOff + gx) * 4;
      const active = nextGrid[ly * rw + lx] === 1;
      sData[idx] = 255;
      sData[idx + 1] = 55;
      sData[idx + 2] = 80;
      sData[idx + 3] = active ? 150 : 0;
    }
  }

  const { diffMask, stats } = buildMaskDiffOverlay(baseMask, suggestedMask, clamped);
  const { verdict, summary } = summarizeMaskStats(stats);

  return {
    regionId,
    rect: clamped,
    baseMask: cloneImageData(baseMask),
    suggestedMask,
    diffMask,
    stats,
    verdict,
    summary,
    source: "local",
  };
}

/**
 * Apply Gemini Vision's normalized [ymin, xmin, ymax, xmax] (0..1000) addBoxes and protectBoxes
 * onto an existing AiMaskAuditResult and recompute the diff overlay and stats.
 */
export function applyGeminiMaskReviewToSuggestion(
  audit: AiMaskAuditResult,
  review: GeminiMaskReviewPayload,
  originalCrop?: ImageData | null,
): AiMaskAuditResult {
  const suggestedMask = cloneImageData(audit.suggestedMask);
  const sData = suggestedMask.data;
  const width = suggestedMask.width;
  const height = suggestedMask.height;
  const rect = clampRect(audit.rect, width, height);
  const rw = rect.width;
  const rh = rect.height;

  // Estimate background luma if originalCrop is available so addBoxes snap to strokes when possible
  let bgMedian = 240;
  let luma: Float32Array | null = null;
  if (originalCrop && originalCrop.width === rw && originalCrop.height === rh) {
    luma = new Float32Array(rw * rh);
    const samples: number[] = [];
    for (let i = 0; i < rw * rh; i++) {
      const p = i * 4;
      const yVal =
        0.299 * originalCrop.data[p] +
        0.587 * originalCrop.data[p + 1] +
        0.114 * originalCrop.data[p + 2];
      luma[i] = yVal;
      if (i % 4 === 0) samples.push(yVal);
    }
    bgMedian = computeMedian(samples);
  }

  for (const box of review.addBoxes) {
    const [ymin, xmin, ymax, xmax] = box;
    const lx0 = Math.max(1, Math.floor((xmin / 1000) * rw));
    const ly0 = Math.max(1, Math.floor((ymin / 1000) * rh));
    const lx1 = Math.min(rw - 1, Math.ceil((xmax / 1000) * rw));
    const ly1 = Math.min(rh - 1, Math.ceil((ymax / 1000) * rh));
    for (let ly = ly0; ly < ly1; ly++) {
      const rowOff = (rect.y + ly) * width;
      for (let lx = lx0; lx < lx1; lx++) {
        const shouldAdd =
          !luma || Math.abs(luma[ly * rw + lx] - bgMedian) >= 16;
        if (shouldAdd) {
          const idx = (rowOff + rect.x + lx) * 4;
          sData[idx] = 255;
          sData[idx + 1] = 55;
          sData[idx + 2] = 80;
          sData[idx + 3] = 150;
        }
      }
    }
  }

  for (const box of review.protectBoxes) {
    const [ymin, xmin, ymax, xmax] = box;
    const lx0 = Math.max(0, Math.floor((xmin / 1000) * rw));
    const ly0 = Math.max(0, Math.floor((ymin / 1000) * rh));
    const lx1 = Math.min(rw, Math.ceil((xmax / 1000) * rw));
    const ly1 = Math.min(rh, Math.ceil((ymax / 1000) * rh));
    for (let ly = ly0; ly < ly1; ly++) {
      const rowOff = (rect.y + ly) * width;
      for (let lx = lx0; lx < lx1; lx++) {
        const idx = (rowOff + rect.x + lx) * 4;
        sData[idx] = 255;
        sData[idx + 1] = 55;
        sData[idx + 2] = 80;
        sData[idx + 3] = 0;
      }
    }
  }

  const { diffMask, stats } = buildMaskDiffOverlay(
    audit.baseMask,
    suggestedMask,
    rect,
  );

  return {
    ...audit,
    suggestedMask,
    diffMask,
    stats,
    verdict: review.verdict,
    summary: review.summary || audit.summary,
    source: "hybrid-gemini",
    geminiSummary: review.summary,
  };
}

/**
 * Extract an ImageData crop for `rect` from a loaded HTMLImageElement or URL.
 * Zeroes the temporary canvas before returning to prevent memory leaks.
 */
export function extractImageRegionCrop(
  image: HTMLImageElement | null,
  rect: PixelRect,
): ImageData | null {
  if (!image || !image.naturalWidth || !image.naturalHeight) return null;
  const clamped = clampRect(rect, image.naturalWidth, image.naturalHeight);
  if (clamped.width <= 0 || clamped.height <= 0) return null;
  const canvas = document.createElement("canvas");
  canvas.width = clamped.width;
  canvas.height = clamped.height;
  try {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(
      image,
      clamped.x,
      clamped.y,
      clamped.width,
      clamped.height,
      0,
      0,
      clamped.width,
      clamped.height,
    );
    return ctx.getImageData(0, 0, clamped.width, clamped.height);
  } catch {
    return null;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * Create a compact 3-panel comparison strip (Original | Current Red Mask | Cleaned)
 * encoded as a base64 PNG string for Gemini Vision inspection.
 */
export function buildRegionComparisonStripBase64(params: {
  rect: PixelRect;
  originalCrop: ImageData | null;
  cleanedCrop: ImageData | null;
  maskData: ImageData;
}): { base64: string; mimeType: string } | null {
  const { rect, originalCrop, cleanedCrop, maskData } = params;
  if (!originalCrop || originalCrop.width <= 0 || originalCrop.height <= 0) {
    return null;
  }
  const rw = originalCrop.width;
  const rh = originalCrop.height;
  const gap = 8;
  const headerH = 22;
  const totalW = rw * 3 + gap * 2;
  const totalH = rh + headerH;

  const canvas = document.createElement("canvas");
  canvas.width = totalW;
  canvas.height = totalH;
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#111827";
    ctx.fillRect(0, 0, totalW, totalH);

    // Put Panel 1: Original
    ctx.putImageData(originalCrop, 0, headerH);

    // Put Panel 2: Original + Red Mask Overlay
    const overlayCrop = new ImageData(
      new Uint8ClampedArray(originalCrop.data),
      rw,
      rh,
    );
    const oData = overlayCrop.data;
    const mData = maskData.data;
    const fullW = maskData.width;
    for (let ly = 0; ly < rh; ly++) {
      const gy = rect.y + ly;
      if (gy < 0 || gy >= maskData.height) continue;
      for (let lx = 0; lx < rw; lx++) {
        const gx = rect.x + lx;
        if (gx < 0 || gx >= fullW) continue;
        const mIdx = (gy * fullW + gx) * 4;
        if (isMaskPixelActive(mData, mIdx)) {
          const cIdx = (ly * rw + lx) * 4;
          oData[cIdx] = Math.round(oData[cIdx] * 0.35 + 255 * 0.65);
          oData[cIdx + 1] = Math.round(oData[cIdx + 1] * 0.35 + 40 * 0.65);
          oData[cIdx + 2] = Math.round(oData[cIdx + 2] * 0.35 + 70 * 0.65);
        }
      }
    }
    ctx.putImageData(overlayCrop, rw + gap, headerH);

    // Put Panel 3: Cleaned (or Original if cleanedCrop not loaded)
    ctx.putImageData(cleanedCrop ?? originalCrop, (rw + gap) * 2, headerH);

    const dataUrl = canvas.toDataURL("image/png");
    const commaIdx = dataUrl.indexOf(",");
    if (commaIdx < 0) return null;
    return {
      base64: dataUrl.slice(commaIdx + 1),
      mimeType: "image/png",
    };
  } catch {
    return null;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
