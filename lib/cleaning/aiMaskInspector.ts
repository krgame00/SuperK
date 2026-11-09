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
    for (let i = 0; i < rw * rh; i++) {
      const p = i * 4;
      luma[i] = 0.299 * oData[p] + 0.587 * oData[p + 1] + 0.114 * oData[p + 2];
      if (cleanLuma && cData) {
        cleanLuma[i] =
          0.299 * cData[p] + 0.587 * cData[p + 1] + 0.114 * cData[p + 2];
      }
    }

    // Compute distance band around existing text mask:
    // nearMask[i] = 3 (inside curGrid), 2 (dist 1), 1 (dist 2)
    // textBand[i] = 1 if within 8px of existing text mask (never scan character art far from text!)
    const nearMask = new Uint8Array(rw * rh);
    const textBand = new Uint8Array(rw * rh);
    let currentMaskCount = 0;

    for (let ly = 0; ly < rh; ly++) {
      for (let lx = 0; lx < rw; lx++) {
        const i = ly * rw + lx;
        if (curGrid[i] === 1) {
          nearMask[i] = 3;
          textBand[i] = 1;
          currentMaskCount += 1;
        }
      }
    }

    // Populate nearMask (dist 1..2) and textBand (dist 1..6) around masked text pixels only
    for (let ly = 1; ly < rh - 1; ly++) {
      for (let lx = 1; lx < rw - 1; lx++) {
        const i = ly * rw + lx;
        if (curGrid[i] !== 1) continue;
        // Only propagate from boundary pixels of curGrid for speed
        if (
          curGrid[i - 1] === 1 &&
          curGrid[i + 1] === 1 &&
          curGrid[i - rw] === 1 &&
          curGrid[i + rw] === 1
        ) {
          continue;
        }
        const y0 = Math.max(1, ly - 6);
        const y1 = Math.min(rh - 2, ly + 6);
        const x0 = Math.max(1, lx - 6);
        const x1 = Math.min(rw - 2, lx + 6);
        for (let ny = y0; ny <= y1; ny++) {
          const dy = Math.abs(ny - ly);
          const rowOff = ny * rw;
          for (let nx = x0; nx <= x1; nx++) {
            const ni = rowOff + nx;
            if (curGrid[ni] === 1) continue;
            const dx = Math.abs(nx - lx);
            const cheb = Math.max(dx, dy);
            if (cheb <= 1) {
              if (nearMask[ni] < 2) nearMask[ni] = 2;
              textBand[ni] = 1;
            } else if (cheb === 2) {
              if (nearMask[ni] < 1) nearMask[ni] = 1;
              textBand[ni] = 1;
            } else if (dx * dx + dy * dy <= 36) {
              textBand[ni] = 1;
            }
          }
        }
      }
    }

    // Sample ink luma ONLY from existing text mask and background luma ONLY from the 2..6px ring
    // immediately surrounding the text mask (so character bodies/clothes never skew bgMedian!).
    const bgSamples: number[] = [];
    const inkSamples: number[] = [];
    const step = Math.max(1, Math.floor((rw * rh) / 16000));
    for (let i = 0; i < rw * rh; i += step) {
      if (curGrid[i] === 1) {
        if (inkSamples.length < 1500) inkSamples.push(luma[i]);
      } else if (textBand[i] === 1 && nearMask[i] === 0) {
        if (bgSamples.length < 1500) bgSamples.push(luma[i]);
      }
    }
    if (bgSamples.length === 0) {
      for (let i = 0; i < rw * rh; i += Math.max(1, step * 2)) {
        if (curGrid[i] === 0 && bgSamples.length < 800) bgSamples.push(luma[i]);
      }
    }

    const bgMedian = computeMedian(bgSamples);
    const inkMedian =
      inkSamples.length > 0 ? computeMedian(inkSamples) : bgMedian > 128 ? 35 : 220;
    const contrastSpan = Math.max(28, Math.abs(bgMedian - inkMedian));
    const strokeThreshold = Math.max(26, contrastSpan * 0.48);
    const haloThreshold = Math.max(20, contrastSpan * 0.34);

    // Helper: estimate local background paper luma in a local window (80th percentile of unmasked pixels)
    const localBgAt = (cx: number, cy: number): number => {
      const vals: number[] = [];
      const y0 = Math.max(0, cy - 5);
      const y1 = Math.min(rh - 1, cy + 5);
      const x0 = Math.max(0, cx - 5);
      const x1 = Math.min(rw - 1, cx + 5);
      for (let ny = y0; ny <= y1; ny += 2) {
        const rOff = ny * rw;
        for (let nx = x0; nx <= x1; nx += 2) {
          const ni = rOff + nx;
          if (curGrid[ni] === 0 && nearMask[ni] === 0) {
            vals.push(luma[ni]);
          }
        }
      }
      if (vals.length < 2) return bgMedian;
      vals.sort((a, b) => a - b);
      const highIdx = Math.floor(vals.length * 0.8);
      return vals[highIdx];
    };

    // 1. Detect Under-Masked text stroke / glyph pixels:
    // A) Pixels within textBand of existing masks (halo / stroke extension)
    // B) Inpainting remnant specks on bright paper (only where inpainting occurred / modified pixels!)
    // C) Unmasked speech balloon text glyphs on bright white paper
    const candidateAdd = new Uint8Array(rw * rh);
    for (let ly = 2; ly < rh - 2; ly++) {
      const rOff = ly * rw;
      for (let lx = 2; lx < rw - 2; lx++) {
        const i = rOff + lx;
        if (curGrid[i] === 1) continue;
        const locBg = localBgAt(lx, ly);
        const origDiff = Math.abs(luma[i] - locBg);
        const cleanDiff = cleanLuma ? Math.abs(cleanLuma[i] - locBg) : origDiff;
        const isCleanModified = cleanLuma ? Math.abs(cleanLuma[i] - luma[i]) >= 18 : false;
        const isNearMaskOrBand = nearMask[i] > 0 || textBand[i] === 1;

        if (textBand[i] === 1) {
          if (nearMask[i] === 2 && origDiff >= haloThreshold && cleanDiff >= 12) {
            candidateAdd[i] = 1;
          } else if (nearMask[i] === 1 && origDiff >= strokeThreshold && cleanDiff >= 12) {
            candidateAdd[i] = 1;
          } else if (origDiff >= strokeThreshold * 1.25 && cleanDiff >= 12) {
            // Detached glyph stroke candidate inside textBand (within 6px of text mask)
            candidateAdd[i] = 1;
          }
        } else if (locBg >= 200) {
          if (cleanLuma && (isCleanModified || isNearMaskOrBand)) {
            // A) Leftover inpainting residue specks: must be modified by inpainting or near mask
            if (cleanDiff >= 12 && cleanDiff <= 140 && cleanLuma[i] < locBg - 8) {
              candidateAdd[i] = 1;
            }
          } else if (luma[i] <= 145 && origDiff >= 28) {
            // B) Unmasked speech balloon text glyphs on bright white paper (locBg >= 210)
            if (locBg >= 210 && (!cleanLuma || cleanDiff >= 24)) {
              candidateAdd[i] = 1;
            }
          }
        }
      }
    }

    // Connected Component Extraction & Filtering on candidateAdd:
    // Rejects components that are too large (character line-art/shading), too elongated (borders/hair),
    // touch outer region borders, or are isolated drawing strokes (wrinkles/sweat drops on clothing/skin),
    // while approving text glyphs in both existing and unmasked speech balloons.
    const visited = new Uint8Array(rw * rh);
    const maxTotalAdded = Math.max(
      1600,
      Math.min(15000, Math.round(Math.max(currentMaskCount * 0.8, rw * rh * 0.35))),
    );
    let totalAddedSoFar = 0;
    const queue = new Int32Array(rw * rh);

    interface CompInfo {
      pixels: number[];
      minX: number;
      maxX: number;
      minY: number;
      maxY: number;
      compArea: number;
      compW: number;
      compH: number;
      aspect: number;
      fillRatio: number;
      touchesExistingMask: boolean;
      touchesBorder: boolean;
      hasCleanModified: boolean;
      centerX: number;
      centerY: number;
      surroundBg: number;
    }

    const comps: CompInfo[] = [];

    for (let ly = 2; ly < rh - 2; ly++) {
      for (let lx = 2; lx < rw - 2; lx++) {
        const startIdx = ly * rw + lx;
        if (candidateAdd[startIdx] === 0 || visited[startIdx] === 1) continue;

        let head = 0;
        let tail = 0;
        queue[tail++] = startIdx;
        visited[startIdx] = 1;

        let minX = lx;
        let maxX = lx;
        let minY = ly;
        let maxY = ly;
        let touchesExistingMask = false;
        let touchesBorder = false;
        let hasCleanModified = false;

        while (head < tail) {
          const curr = queue[head++];
          const cy = Math.floor(curr / rw);
          const cx = curr - cy * rw;
          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;
          if (nearMask[curr] >= 2) touchesExistingMask = true;
          if (cx <= 2 || cx >= rw - 3 || cy <= 2 || cy >= rh - 3) touchesBorder = true;
          if (cleanLuma && Math.abs(cleanLuma[curr] - luma[curr]) >= 18) hasCleanModified = true;

          for (let dy = -1; dy <= 1; dy++) {
            const ny = cy + dy;
            if (ny < 1 || ny >= rh - 1) continue;
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = cx + dx;
              if (nx < 1 || nx >= rw - 1) continue;
              const nIdx = ny * rw + nx;
              if (candidateAdd[nIdx] === 1 && visited[nIdx] === 0) {
                visited[nIdx] = 1;
                queue[tail++] = nIdx;
              }
            }
          }
        }

        const compArea = tail;
        const compW = maxX - minX + 1;
        const compH = maxY - minY + 1;
        const aspect = compW / Math.max(1, compH);
        const fillRatio = compArea / Math.max(1, compW * compH);
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        let surroundSum = 0;
        let surroundCount = 0;
        const sY0 = Math.max(0, minY - 4);
        const sY1 = Math.min(rh - 1, maxY + 4);
        const sX0 = Math.max(0, minX - 4);
        const sX1 = Math.min(rw - 1, maxX + 4);
        for (let sy = sY0; sy <= sY1; sy += 2) {
          const rOff = sy * rw;
          for (let sx = sX0; sx <= sX1; sx += 2) {
            if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) continue;
            surroundSum += luma[rOff + sx];
            surroundCount += 1;
          }
        }
        const surroundBg = surroundCount > 0 ? surroundSum / surroundCount : localBgAt(Math.round(centerX), Math.round(centerY));

        const pixelList: number[] = new Array(tail);
        for (let k = 0; k < tail; k++) {
          pixelList[k] = queue[k];
        }

        comps.push({
          pixels: pixelList,
          minX,
          maxX,
          minY,
          maxY,
          compArea,
          compW,
          compH,
          aspect,
          fillRatio,
          touchesExistingMask,
          touchesBorder,
          hasCleanModified,
          centerX,
          centerY,
          surroundBg,
        });
      }
    }

    for (const c of comps) {
      if (c.touchesBorder) continue;

      // 1. Existing mask text halo extension (sub-pixel anti-aliasing edge):
      const isGlyphHalo =
        c.touchesExistingMask &&
        c.compArea >= 2 &&
        c.compArea <= 280 &&
        c.compW <= 38 &&
        c.compH <= 38;

      // 2. Inpainting remnant speck in previously cleaned balloon area:
      const isRemnantSpeck =
        cleanLuma !== null &&
        (c.touchesExistingMask || c.hasCleanModified) &&
        c.compArea >= 2 &&
        c.compArea <= 280 &&
        c.compW <= 38 &&
        c.compH <= 38 &&
        c.surroundBg >= 180;

      // 3. Speech balloon / dialogue box text glyph verification:
      // Ensures candidate is an actual text character enclosed within a bright balloon interior,
      // and not an isolated drawing stroke (sweat drop, shirt fold, face hatching).
      let isSpeechBalloonTextGlyph = false;
      if (
        c.compArea >= 4 &&
        c.compArea <= 700 &&
        c.compW >= 2 &&
        c.compW <= 42 &&
        c.compH >= 3 &&
        c.compH <= 45 &&
        c.aspect >= 0.18 &&
        c.aspect <= 5.5
      ) {
        // Reject 1px-thin needle strokes (sweat drops, shading lines, hair strands):
        const isNeedleStroke = (c.compW <= 1 && c.compH >= 6) || (c.compH <= 1 && c.compW >= 6);
        const isStrokeOrGlyphFill = c.compW <= 24 || c.compH <= 24 || c.fillRatio <= 0.88;

        if (!isNeedleStroke && isStrokeOrGlyphFill && c.fillRatio >= 0.08 && c.surroundBg >= 210) {
          // Clustering Check: dialogue text characters exist in words or lines with neighboring glyphs.
          // Require at least one sibling candidate within dialogue pitch (<= 42px),
          // OR an established standalone text character block (compArea >= 45, surroundBg >= 225).
          const hasSibling = comps.some(
            (other) =>
              other !== c &&
              !other.touchesBorder &&
              other.surroundBg >= 200 &&
              Math.hypot(c.centerX - other.centerX, c.centerY - other.centerY) <= 42,
          );
          if (hasSibling || (c.compArea >= 45 && c.surroundBg >= 225 && c.aspect >= 0.22 && c.aspect <= 4.0)) {
            isSpeechBalloonTextGlyph = true;
          }
        }
      }

      if (
        (isGlyphHalo || isRemnantSpeck || isSpeechBalloonTextGlyph) &&
        totalAddedSoFar + c.compArea <= maxTotalAdded
      ) {
        for (let k = 0; k < c.pixels.length; k++) {
          const pIdx = c.pixels[k];
          nextGrid[pIdx] = 1;
          if (isSpeechBalloonTextGlyph) {
            const py = Math.floor(pIdx / rw);
            const px = pIdx - py * rw;
            for (let dy = -1; dy <= 1; dy++) {
              const ny = py + dy;
              if (ny < 1 || ny >= rh - 1) continue;
              for (let dx = -1; dx <= 1; dx++) {
                const nx = px + dx;
                if (nx < 1 || nx >= rw - 1) continue;
                const ni = ny * rw + nx;
                if (nextGrid[ni] === 0 && luma[ni] >= 140) {
                  nextGrid[ni] = 1;
                }
              }
            }
          }
        }
        totalAddedSoFar += c.compArea;
      }
    }

    // 2. Detect Over-Masked pixels (protect character art & background where mask bled out):
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
        const locBg = localBgAt(lx, ly);
        const origDiff = Math.abs(luma[i] - locBg);
        if (origDiff < haloThreshold * 0.45) {
          let unmaskedNeighbors = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (curGrid[(ly + dy) * rw + (lx + dx)] === 0) {
                unmaskedNeighbors += 1;
              }
            }
          }
          if (unmaskedNeighbors >= 4) {
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
    const boxAreaRatio = ((ymax - ymin) * (xmax - xmin)) / 1_000_000;
    // If originalCrop is present and the region is large, ignore overly broad boxes (> 85% of region)
    // that accidentally enclose the entire panel frame instead of specific missed text glyphs.
    if (luma && rw * rh > 20_000 && boxAreaRatio > 0.85) {
      continue;
    }
    const lx0 = Math.max(1, Math.floor((xmin / 1000) * rw));
    const ly0 = Math.max(1, Math.floor((ymin / 1000) * rh));
    const lx1 = Math.min(rw - 1, Math.ceil((xmax / 1000) * rw));
    const ly1 = Math.min(rh - 1, Math.ceil((ymax / 1000) * rh));
    if (!luma) {
      for (let ly = ly0; ly < ly1; ly++) {
        const rowOff = (rect.y + ly) * width;
        for (let lx = lx0; lx < lx1; lx++) {
          const idx = (rowOff + rect.x + lx) * 4;
          sData[idx] = 255;
          sData[idx + 1] = 55;
          sData[idx + 2] = 80;
          sData[idx + 3] = 150;
        }
      }
      continue;
    }
    // Compute local background median inside this specific addBox so only high-contrast text strokes are masked
    const boxSamples: number[] = [];
    for (let ly = ly0; ly < ly1; ly++) {
      for (let lx = lx0; lx < lx1; lx++) {
        boxSamples.push(luma[ly * rw + lx]);
      }
    }
    const localBoxBg = computeMedian(boxSamples);
    for (let ly = ly0; ly < ly1; ly++) {
      const rowOff = (rect.y + ly) * width;
      for (let lx = lx0; lx < lx1; lx++) {
        const shouldAdd = Math.abs(luma[ly * rw + lx] - localBoxBg) >= 28;
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
 * Extract a cropped region from a full-canvas mask ImageData.
 */
export function extractMaskRegionCrop(
  mask: ImageData | null | undefined,
  rect: PixelRect,
): ImageData | null {
  if (!mask || mask.width <= 0 || mask.height <= 0) return null;
  const clamped = clampRect(rect, mask.width, mask.height);
  if (clamped.width <= 0 || clamped.height <= 0) return null;
  const cw = clamped.width;
  const ch = clamped.height;
  const mw = mask.width;
  const mData = mask.data;
  const cropData = new Uint8ClampedArray(cw * ch * 4);
  for (let cy = 0; cy < ch; cy++) {
    const gy = clamped.y + cy;
    const srcRow = gy * mw;
    const dstRow = cy * cw;
    for (let cx = 0; cx < cw; cx++) {
      const gx = clamped.x + cx;
      const srcIdx = (srcRow + gx) * 4;
      const dstIdx = (dstRow + cx) * 4;
      cropData[dstIdx] = mData[srcIdx];
      cropData[dstIdx + 1] = mData[srcIdx + 1];
      cropData[dstIdx + 2] = mData[srcIdx + 2];
      cropData[dstIdx + 3] = mData[srcIdx + 3];
    }
  }
  return new ImageData(cropData, cw, ch);
}

/**
 * Splice a cropped mask ImageData back into a full-canvas mask ImageData within `rect`.
 */
export function spliceMaskRegionCrop(
  fullMask: ImageData,
  cropMask: ImageData,
  rect: PixelRect,
): ImageData {
  const result = cloneImageData(fullMask);
  const clamped = clampRect(rect, fullMask.width, fullMask.height);
  const cw = Math.min(clamped.width, cropMask.width);
  const ch = Math.min(clamped.height, cropMask.height);
  const mw = fullMask.width;
  const cropW = cropMask.width;
  const fData = result.data;
  const cData = cropMask.data;
  for (let cy = 0; cy < ch; cy++) {
    const gy = clamped.y + cy;
    const srcRow = cy * cropW;
    const dstRow = gy * mw;
    for (let cx = 0; cx < cw; cx++) {
      const gx = clamped.x + cx;
      const srcIdx = (srcRow + cx) * 4;
      const dstIdx = (dstRow + gx) * 4;
      fData[dstIdx] = cData[srcIdx];
      fData[dstIdx + 1] = cData[srcIdx + 1];
      fData[dstIdx + 2] = cData[srcIdx + 2];
      fData[dstIdx + 3] = cData[srcIdx + 3];
    }
  }
  return result;
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
