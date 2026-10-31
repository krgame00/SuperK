import type { PixelRect } from "./types";

/**
 * Creates a binary PNG mask blob with a solid white rectangle at rect.
 * STRICTLY for action="protect" (restoring original source pixels).
 * NEVER use this for inpainting or force-clean, as filling a solid rectangle
 * causes inpainters to delete all underlying artwork/characters.
 */
export async function createRegionMaskBlob(
  width: number,
  height: number,
  rect: PixelRect,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  const cWidth = Math.max(1, Math.round(width));
  const cHeight = Math.max(1, Math.round(height));
  canvas.width = cWidth;
  canvas.height = cHeight;

  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, cWidth, cHeight);

    ctx.fillStyle = "#ffffff";
    const x = Math.max(0, Math.min(cWidth, Math.round(rect.x)));
    const y = Math.max(0, Math.min(cHeight, Math.round(rect.y)));
    const w = Math.max(1, Math.min(cWidth - x, Math.round(rect.width)));
    const h = Math.max(1, Math.min(cHeight - y, Math.round(rect.height)));
    ctx.fillRect(x, y, w, h);
  }

  return new Promise<Blob>((resolve, reject) => {
    if (typeof canvas.toBlob === "function") {
      canvas.toBlob((blob) => {
        canvas.width = 0;
        canvas.height = 0;
        if (blob) resolve(blob);
        else reject(new Error("Failed to encode mask blob."));
      }, "image/png");
    } else {
      canvas.width = 0;
      canvas.height = 0;
      resolve(new Blob(["mock-mask-png"], { type: "image/png" }));
    }
  });
}

const INK_DARK_LUMA = 155;
const KNOCKOUT_BRIGHT_LUMA = 200;
const KNOCKOUT_DARK_SHARE = 0.6;
const KNOCKOUT_BRIGHT_SHARE = 0.12;
const OTSU_MIN_SEPARATION = 20;
const MIN_INK_SHARE = 0.002;
const MAX_INK_SHARE = 0.85;
const MIN_GLYPH_FILL = 0.15;
const ULTRA_SPARSE_FILL = 0.06;
const MAX_ARTWORK_COMPONENT_SHARE = 0.35;
const CROSS_SPAN_SHARE = 0.9;
const ELONGATION_RATIO = 4;
const RULE_LINE_THICKNESS_SHARE = 0.25;

export interface GlyphInkExtraction {
  ink: Uint8Array;
  polarity: "dark-on-light" | "light-on-dark";
  droppedComponents: number;
}

/**
 * Thresholds a luma crop into text ink and strips components whose shape
 * matches character artwork instead of glyphs. A pure darkness threshold
 * cannot tell a glyph from a hair strand, contour or speed line, so each
 * connected component is judged by fill ratio, size and elongation:
 *   - huge mass (>= 35% of the crop): hair block / black fill, never text
 *   - ultra sparse (< 6% fill): thin diagonal strokes and curves
 *   - sparse + spanning/elongated (< 15% fill): hatching and long contours
 *   - rule-like bar: spans one axis while <= 25% thick on the other
 *
 * The text/background split adapts to the crop instead of using fixed cuts:
 * an Otsu threshold on the luma histogram finds the natural valley, and the
 * class holding the crop border is treated as background (bubble fill
 * surrounds the text). This catches colored text whose luma sits between
 * the legacy cuts — e.g. purple glyphs on a dark green bubble, where text
 * and background are both "dark" under 155 and a fixed threshold would
 * merge them into one giant component. When the luma separation is too
 * weak (same-luma different-hue text), the split retries on chroma
 * distance from the border-dominant color when RGBA is available.
 * Degenerate crops fall back to the legacy fixed-threshold knockout.
 */
export function extractGlyphInk(
  luma: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
  rgba?: Uint8ClampedArray | Uint8Array,
): GlyphInkExtraction {
  const ink = new Uint8Array(w * h);
  const total = w * h;
  if (w <= 0 || h <= 0 || luma.length < total) {
    return { ink, polarity: "dark-on-light", droppedComponents: 0 };
  }

  const hist = new Float64Array(256);
  let darkCount = 0;
  let brightCount = 0;
  for (let i = 0; i < total; i++) {
    hist[luma[i]]++;
    if (luma[i] < INK_DARK_LUMA) darkCount++;
    else if (luma[i] > KNOCKOUT_BRIGHT_LUMA) brightCount++;
  }

  let candidate = otsuInkCandidate(luma, w, h, hist, total);
  if (!candidate && rgba && rgba.length >= total * 4) {
    candidate = chromaInkCandidate(rgba, luma, w, h);
  }
  if (!candidate) {
    const knockout = darkCount >= KNOCKOUT_DARK_SHARE * total && brightCount >= KNOCKOUT_BRIGHT_SHARE * total;
    const polarity: GlyphInkExtraction["polarity"] = knockout ? "light-on-dark" : "dark-on-light";
    for (let i = 0; i < total; i++) {
      const isInk = knockout ? luma[i] > KNOCKOUT_BRIGHT_LUMA : luma[i] < INK_DARK_LUMA;
      if (isInk) ink[i] = 1;
    }
    candidate = { ink, polarity };
  }

  let dropped = 0;
  const work = candidate.ink;
  const label = new Int32Array(total);
  const stack: number[] = [];
  const comp: number[] = [];
  for (let start = 0; start < total; start++) {
    if (work[start] !== 1 || label[start] !== 0) continue;
    comp.length = 0;
    stack.length = 0;
    stack.push(start);
    label[start] = 1;
    let area = 0;
    let minx = w;
    let maxx = -1;
    let miny = h;
    let maxy = -1;
    while (stack.length > 0) {
      const p = stack.pop()!;
      comp.push(p);
      const py = (p / w) | 0;
      const px = p - py * w;
      area++;
      if (px < minx) minx = px;
      if (px > maxx) maxx = px;
      if (py < miny) miny = py;
      if (py > maxy) maxy = py;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          if (nx < 0 || nx >= w) continue;
          const np = ny * w + nx;
          if (work[np] === 1 && label[np] === 0) {
            label[np] = 1;
            stack.push(np);
          }
        }
      }
    }
    const bw = maxx - minx + 1;
    const bh = maxy - miny + 1;
    const fill = area / (bw * bh);
    const isArtwork =
      area >= MAX_ARTWORK_COMPONENT_SHARE * total ||
      fill < ULTRA_SPARSE_FILL ||
      (fill < MIN_GLYPH_FILL &&
        (bw >= CROSS_SPAN_SHARE * w ||
          bh >= CROSS_SPAN_SHARE * h ||
          bw >= ELONGATION_RATIO * bh ||
          bh >= ELONGATION_RATIO * bw)) ||
      (bw >= CROSS_SPAN_SHARE * w && bh <= RULE_LINE_THICKNESS_SHARE * h) ||
      (bh >= CROSS_SPAN_SHARE * h && bw <= RULE_LINE_THICKNESS_SHARE * w);
    if (isArtwork) {
      dropped++;
      for (const p of comp) work[p] = 0;
    }
  }
  return { ink: work, polarity: candidate.polarity, droppedComponents: dropped };
}

interface InkCandidate {
  ink: Uint8Array;
  polarity: GlyphInkExtraction["polarity"];
}

interface OtsuSplit {
  threshold: number;
  countLow: number;
  meanLow: number;
  meanHigh: number;
}

function otsuSplit(hist: Float64Array, bins: number, total: number): OtsuSplit | null {
  let sumAll = 0;
  for (let i = 0; i < bins; i++) sumAll += i * hist[i];
  let wLow = 0;
  let sumLow = 0;
  let bestVar = -1;
  let best: OtsuSplit | null = null;
  for (let t = 0; t < bins - 1; t++) {
    wLow += hist[t];
    if (wLow === 0) continue;
    const wHigh = total - wLow;
    if (wHigh === 0) break;
    sumLow += t * hist[t];
    const meanLow = sumLow / wLow;
    const meanHigh = (sumAll - sumLow) / wHigh;
    const d = meanLow - meanHigh;
    const varBetween = wLow * wHigh * d * d;
    if (varBetween > bestVar) {
      bestVar = varBetween;
      best = { threshold: t, countLow: wLow, meanLow, meanHigh };
    }
  }
  return best;
}

function borderMajorityIsLow(
  luma: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
  threshold: number,
): boolean | null {
  let low = 0;
  let high = 0;
  const bump = (x: number, y: number) => {
    if (luma[y * w + x] <= threshold) low++;
    else high++;
  };
  for (let x = 0; x < w; x++) {
    bump(x, 0);
    bump(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    bump(0, y);
    bump(w - 1, y);
  }
  if (low === high) return null;
  return low > high;
}

function otsuInkCandidate(
  luma: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
  hist: Float64Array,
  total: number,
): InkCandidate | null {
  const split = otsuSplit(hist, 256, total);
  if (!split || split.meanHigh - split.meanLow < OTSU_MIN_SEPARATION) return null;
  const borderLow = borderMajorityIsLow(luma, w, h, split.threshold);
  if (borderLow === null) return null;
  const inkIsHigh = borderLow;
  const inkCount = inkIsHigh ? total - split.countLow : split.countLow;
  const share = inkCount / total;
  if (share < MIN_INK_SHARE || share > MAX_INK_SHARE) return null;
  const ink = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const isInk = inkIsHigh ? luma[i] > split.threshold : luma[i] <= split.threshold;
    if (isInk) ink[i] = 1;
  }
  return { ink, polarity: inkIsHigh ? "light-on-dark" : "dark-on-light" };
}

function chromaInkCandidate(
  rgba: Uint8ClampedArray | Uint8Array,
  luma: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
): InkCandidate | null {
  const total = w * h;
  // Dominant border color (4-bit quantized, averaged per bin) = background.
  const bins = new Map<number, { count: number; r: number; g: number; b: number }>();
  const notePixel = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    const key = ((rgba[i] >> 4) << 8) | ((rgba[i + 1] >> 4) << 4) | (rgba[i + 2] >> 4);
    const e = bins.get(key);
    if (e) {
      e.count++;
      e.r += rgba[i];
      e.g += rgba[i + 1];
      e.b += rgba[i + 2];
    } else {
      bins.set(key, { count: 1, r: rgba[i], g: rgba[i + 1], b: rgba[i + 2] });
    }
  };
  for (let x = 0; x < w; x++) {
    notePixel(x, 0);
    notePixel(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    notePixel(0, y);
    notePixel(w - 1, y);
  }
  let best: { count: number; r: number; g: number; b: number } | null = null;
  for (const e of bins.values()) {
    if (!best || e.count > best.count) best = e;
  }
  if (!best) return null;
  const dr = best.r / best.count;
  const dg = best.g / best.count;
  const db = best.b / best.count;

  const dist = new Uint16Array(total);
  const distHist = new Float64Array(256);
  for (let i = 0; i < total; i++) {
    const d =
      Math.abs(rgba[i * 4] - dr) + Math.abs(rgba[i * 4 + 1] - dg) + Math.abs(rgba[i * 4 + 2] - db);
    const bin = Math.min(255, d >> 1);
    dist[i] = d;
    distHist[bin]++;
  }
  const split = otsuSplit(distHist, 256, total);
  if (!split) return null;

  // The border must back the near-background (low distance) class, else the
  // dominant color itself is suspect.
  let low = 0;
  let high = 0;
  const bump = (x: number, y: number) => {
    if (dist[y * w + x] >> 1 <= split.threshold) low++;
    else high++;
  };
  for (let x = 0; x < w; x++) {
    bump(x, 0);
    bump(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    bump(0, y);
    bump(w - 1, y);
  }
  if (low <= high) return null;

  const inkCount = total - split.countLow;
  const share = inkCount / total;
  if (share < MIN_INK_SHARE || share > MAX_INK_SHARE) return null;
  const ink = new Uint8Array(total);
  let inkLuma = 0;
  let bgLuma = 0;
  for (let i = 0; i < total; i++) {
    if (dist[i] >> 1 > split.threshold) {
      ink[i] = 1;
      inkLuma += luma[i];
    } else {
      bgLuma += luma[i];
    }
  }
  const polarity: GlyphInkExtraction["polarity"] =
    inkLuma / inkCount >= bgLuma / (total - inkCount) ? "light-on-dark" : "dark-on-light";
  return { ink, polarity };
}

/**
 * Creates a binary PNG mask blob that ONLY masks text-glyph pixels inside
 * rect (via extractGlyphInk: polarity-aware thresholding plus glyph-shape
 * filtering), with a tight 2px dilation.
 * Used for action="force-clean" (inpainting) so that background, screentones,
 * and character artwork inside or around speech balloons are NEVER deleted.
 */
export async function createInkMaskBlob(
  sourceUrl: string,
  width: number,
  height: number,
  rect: PixelRect,
  dilation = 2,
): Promise<Blob> {
  const cWidth = Math.max(1, Math.round(width));
  const cHeight = Math.max(1, Math.round(height));

  const canvas = document.createElement("canvas");
  canvas.width = cWidth;
  canvas.height = cHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) ?? canvas.getContext("2d");
  if (!ctx) {
    // Without a 2d context we cannot inspect pixels — return the untouched
    // (empty) canvas instead of a solid rect, so the server rejects the
    // retry instead of the inpainter erasing the whole rect.
    return new Promise<Blob>((resolve) => {
      if (typeof canvas.toBlob === "function") {
        canvas.toBlob((blob) => {
          canvas.width = 0;
          canvas.height = 0;
          resolve(blob ?? new Blob([], { type: "image/png" }));
        }, "image/png");
      } else {
        resolve(new Blob([], { type: "image/png" }));
      }
    });
  }

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, cWidth, cHeight);

  const x0 = Math.max(0, Math.min(cWidth, Math.round(rect.x)));
  const y0 = Math.max(0, Math.min(cHeight, Math.round(rect.y)));
  const x1 = Math.max(x0, Math.min(cWidth, Math.round(rect.x + rect.width)));
  const y1 = Math.max(y0, Math.min(cHeight, Math.round(rect.y + rect.height)));
  const rw = x1 - x0;
  const rh = y1 - y0;

  if (rw <= 0 || rh <= 0) {
    return createRegionMaskBlob(cWidth, cHeight, rect);
  }

  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout loading image for ink mask")), 3000);
      img.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      img.onerror = () => {
        clearTimeout(timer);
        reject(new Error("Failed to load image for ink mask"));
      };
      img.src = sourceUrl;
    });

    // Draw source crop
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = rw;
    cropCanvas.height = rh;
    const cropCtx = cropCanvas.getContext("2d", { willReadFrequently: true });
    if (!cropCtx) throw new Error("Crop canvas context is unavailable");

    cropCtx.drawImage(img, x0, y0, rw, rh, 0, 0, rw, rh);
    const srcData = cropCtx.getImageData(0, 0, rw, rh);
    const sPixels = srcData.data;

    // Luma plus RGBA; extractGlyphInk adapts the text/background split
    // (Otsu/border rule, chroma fallback) and filters glyph-shaped
    // components so character strokes are not masked as text.
    const luma = new Uint8Array(rw * rh);
    for (let i = 0; i < rw * rh; i++) {
      const idx = i * 4;
      luma[i] = 0.299 * sPixels[idx] + 0.587 * sPixels[idx + 1] + 0.114 * sPixels[idx + 2];
    }
    const { ink } = extractGlyphInk(luma, rw, rh, sPixels);

    // Dilate ink by `dilation` pixels to cover anti-aliased character edges
    const maskData = ctx.createImageData(cWidth, cHeight);
    const mData = maskData.data;

    for (let y = 0; y < rh; y++) {
      const dstY = y0 + y;
      const rowOffset = dstY * cWidth;
      for (let x = 0; x < rw; x++) {
        let isInk = false;
        for (let dy = -dilation; dy <= dilation && !isInk; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= rh) continue;
          const nRow = ny * rw;
          for (let dx = -dilation; dx <= dilation; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= rw) continue;
            if (ink[nRow + nx] === 1) {
              isInk = true;
              break;
            }
          }
        }
        if (isInk) {
          const dstX = x0 + x;
          const idx = (rowOffset + dstX) * 4;
          mData[idx] = 255;
          mData[idx + 1] = 255;
          mData[idx + 2] = 255;
          mData[idx + 3] = 255;
        }
      }
    }

    ctx.putImageData(maskData, 0, 0);
  } catch (error) {
    // Never fall back to a solid rect: without source pixels we cannot tell
    // text from artwork, and a solid rect makes the inpainter erase the
    // character underneath. An empty mask fails the retry loudly instead
    // (the server rejects it with "authorized mask is empty").
    console.warn("[SuperK] ink mask extraction failed; sending empty mask", error);
  }

  return new Promise<Blob>((resolve, reject) => {
    if (typeof canvas.toBlob === "function") {
      canvas.toBlob((blob) => {
        canvas.width = 0;
        canvas.height = 0;
        if (blob) resolve(blob);
        else reject(new Error("Failed to encode ink mask blob."));
      }, "image/png");
    } else {
      canvas.width = 0;
      canvas.height = 0;
      resolve(new Blob(["mock-ink-mask-png"], { type: "image/png" }));
    }
  });
}
