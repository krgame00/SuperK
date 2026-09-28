import { undoManager } from "./undoManager";
import {
  recomputeAdaptiveReadableOnLayoutCommit,
  resolveBubbleTextStyle,
} from "./colorMatching/resolveTextStyle";
import { sampleBubbleRegion, sampleRectRegion } from "./colorMatching/canvasSampler";
import { extractTextColors } from "./colorMatching/sampleTextColors";
import {
  applyNearbyStyleFallbacks,
  inferTextStyleCategory,
} from "./colorMatching/nearbyStyleFallback";
import type { TextStyleProfile } from "./colorMatching/types";
import { layoutTextAtFixedFont, type FixedFontWidthResult } from "./textBoxWidthLayout";

const ADJ_KEY = "superk:overlay-adjustments";

// next/font registers its families under build-hashed names, so canvas
// `ctx.font = "16px Itim"` silently falls back to generic sans-serif.
// Resolve the selected family through the CSS variable next/font set on <html>.
const CANVAS_FONT_VARS: Record<string, string> = {
  itim: "--font-itim",
  prompt: "--font-prompt",
  kanit: "--font-kanit",
  sarabun: "--font-sarabun",
  mitr: "--font-mitr",
  "chakra petch": "--font-chakra-petch",
};

const canvasShadowColor = (color: string, opacity: number): string => {
  const hex = color.trim().match(/^#([0-9a-f]{6})$/i);
  if (!hex) return color;
  const value = hex[1];
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, opacity))})`;
};

export const resolveCanvasFontFamily = (fontFamily?: string): string => {
  const fallback = fontFamily || "Itim, sans-serif";
  if (typeof window === "undefined" || typeof document === "undefined") {
    return fallback;
  }
  try {
    const primary = fallback
      .split(",")[0]
      .trim()
      .replace(/^["']|["']$/g, "")
      .toLowerCase();
    const varName = CANVAS_FONT_VARS[primary];
    if (!varName) return fallback;
    const resolved = getComputedStyle(document.documentElement)
      .getPropertyValue(varName)
      .trim();
    return resolved || fallback;
  } catch {
    return fallback;
  }
};

/** A translated bubble produced by the LLM / manual editor.
 *  Loose by design: carries optional rendering metadata added at runtime. */
export interface TranslatedBubble {
  t?: string;
  translated?: string;
  original_text?: string;
  /** bounding box [ymin, xmin, ymax, xmax] in 0-1000 scale */
  box?: number[];
  isManual?: boolean;
  isInvalidBox?: boolean;
  /** runtime flag set once the user has manually resized a bubble */
  __resized?: boolean;
  /** runtime flag set once the user has deleted a bubble */
  deleted?: boolean;
  /** runtime font size multiplier for this bubble */
  fontSizeMultiplier?: number;
  /** locked base font size for width reflow and editing */
  targetFontSize?: number;
  /** minimum frame height preserved by content-driven width reflow */
  manualMinHeightPx?: number;
  /** persisted interactive layout; source of truth for move/resize/rotation */
  layoutAdjustment?: OverlayAdjustment;
  /** redraw callback attached to overlay bubbles */
  render?: () => void;
  styleProfile?: TextStyleProfile;
  [key: string]: unknown;
}

/** Style options for the translation text overlay. */
export interface OverlayTextStyle {
  fontFamily?: string;
  fontSizeMultiplier?: number;
  textColor?: string;
  textOutline?: string;
  [key: string]: unknown;
}

export interface OverlayAdjustment {
  bx: number;
  by: number;
  bw: number;
  bh: number;
  iw: number;
  ih: number;
  rotation?: number;
  fontSizeMultiplier?: number;
  targetFontSize?: number;
  manualMinHeightPx?: number;
}

/**
 * Snaps a rotation angle (in degrees) to cardinal right angles (0, 90, 180, 270)
 * if within thresholdDeg (default 6 degrees), matching Torii Translate scanlation ergonomics.
 * Angles outside the threshold are normalized to [0, 360) and preserved.
 */
export function snapRotationToRightAngle(deg: number, thresholdDeg = 6): number {
  const normalized = ((deg % 360) + 360) % 360;
  const nearestQuarter = Math.round(normalized / 90) * 90;
  if (Math.abs(normalized - nearestQuarter) <= thresholdDeg) {
    return nearestQuarter % 360;
  }
  return deg >= 0 && deg < 360 ? deg : parseFloat(normalized.toFixed(6));
}



export const bubbleKeyOf = (bubble: TranslatedBubble): string => {
  if (bubble.id !== undefined && bubble.id !== null) {
    return `id-${String(bubble.id)}`;
  }

  const boxKey = Array.isArray(bubble.box)
    && bubble.box.length === 4
    && bubble.box.every((value) => typeof value === "number" && Number.isFinite(value))
    ? bubble.box.map((value) => Number(value).toFixed(3)).join("-")
    : "";
  const sourceText = (bubble.original_text || "").trim().slice(0, 40);

  if (sourceText && boxKey) return `source-${sourceText}-${boxKey}`;
  if (boxKey) return `box-${boxKey}`;

  const fallbackText = (bubble.original_text || bubble.t || bubble.translated || "")
    .trim()
    .slice(0, 40);
  return `text-${fallbackText || "unknown"}`;
};

// Document-level overlay listeners must not outlive their container —
// #pageContainer remounts on page switches, orphaning the previous
// generation's listeners. Registry keyed by container; stale (disconnected)
// entries are pruned and cleaned up on the next apply.
const overlayCleanups = new Map<Element, () => void>();

// Each applyTranslationOverlay bumps its container's generation; a paint
// whose generation is no longer current (page switched underneath it) must
// bail instead of repainting the previous page over the current one.
const overlayGenerations = new WeakMap<Element, number>();

const pruneOverlayCleanups = (): void => {
  for (const [element, cleanup] of overlayCleanups) {
    if (!element.isConnected) {
      cleanup();
      overlayCleanups.delete(element);
    }
  }
};

export const readOverlayAdjustments = (): Record<string, Record<string, OverlayAdjustment>> => {
  if (typeof window === "undefined" || !window.localStorage) return {};
  try {
    return JSON.parse(localStorage.getItem(ADJ_KEY) || "{}");
  } catch {
    return {};
  }
};

export const saveOverlayAdjustments = (adjustments: Record<string, Record<string, OverlayAdjustment>>): void => {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    localStorage.setItem(ADJ_KEY, JSON.stringify(adjustments));
  } catch {}
};

const compactOverlayPageKey = (pageKey: string): string => {
  if (pageKey.length <= 512) return pageKey;

  // Imported pages are durable data URLs. Using the full base64 payload as a
  // localStorage object key can consume megabytes per page and silently hit
  // browser quota. Keep localStorage as a compact legacy/fallback index only;
  // the bubble itself owns the authoritative layout state.
  let hash = 0x811c9dc5;
  for (let i = 0; i < pageKey.length; i += 1) {
    hash ^= pageKey.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `page-${(hash >>> 0).toString(36)}-${pageKey.length}`;
};

export const readPageOverlayAdjustments = (pageKey: string): Record<string, OverlayAdjustment> => {
  const all = readOverlayAdjustments();
  return all[compactOverlayPageKey(pageKey)] ?? all[pageKey] ?? {};
};

export const clearPageAdjustments = (pageIndex: number): void => {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const all = readOverlayAdjustments();
    const pageKey = `page-${pageIndex}`;
    if (all[pageKey]) {
      delete all[pageKey];
      localStorage.setItem(ADJ_KEY, JSON.stringify(all));
    }
  } catch {}
};

export const clearAllAdjustments = (): void => {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    localStorage.removeItem(ADJ_KEY);
  } catch {}
};

export const downloadTranslatedImage = (
  viewMode: "single" | "scroll" | "offscreen",
  currentPage: number,
  defaultFilename = "translated.png",
  returnDataUrl = false,
  containerOverride?: Element,
) => {
  let container: Element | null | undefined = containerOverride;
  if (!container && viewMode === "offscreen") {
    container = document.getElementById("offscreen-container");
  } else if (!container && viewMode === "scroll") {
    container = document.querySelector(`#spage-${currentPage}`);
  } else if (!container) {
    container = document.getElementById("pageContainer");
  }
  if (!container) return null;

  const img = container.querySelector("img");
  if (!img) return null;

  const iw = img.naturalWidth || img.offsetWidth;
  const ih = img.naturalHeight || img.offsetHeight;

  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = iw;
  exportCanvas.height = ih;
  const ctx = exportCanvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(img, 0, 0, iw, ih);

  const wrappers = container.querySelectorAll(".tl-canvas > div");
  wrappers.forEach((wrapperEl) => {
    const wrapper = wrapperEl as HTMLElement;
    // A Deleted bubble stays in the DOM for undo but must never reach the export.
    if (wrapper.dataset.deleted === "true" || wrapper.style.display === "none") return;
    const leftPercent = parseFloat(wrapper.style.left) || 0;
    const topPercent = parseFloat(wrapper.style.top) || 0;
    const widthPercent = parseFloat(wrapper.style.width) || 0;
    const heightPercent = parseFloat(wrapper.style.height) || 0;
    
    const bCanvas = wrapper.querySelector("canvas");
    if (bCanvas) {
      const pLeftPercent = parseFloat(bCanvas.style.left) || 0;
      const pTopPercent = parseFloat(bCanvas.style.top) || 0;
      
      const absLeft = (leftPercent / 100) * iw;
      const absTop = (topPercent / 100) * ih;
      
      const wrapperAbsW = (widthPercent / 100) * iw;
      const wrapperAbsH = (heightPercent / 100) * ih;
      
      const bCanvasAbsLeft = absLeft + (pLeftPercent / 100) * wrapperAbsW;
      const bCanvasAbsTop = absTop + (pTopPercent / 100) * wrapperAbsH;
      
      const rotMatch = wrapper.style.transform.match(/rotate\(([-\d.]+)deg\)/);
      const rotDeg = rotMatch ? parseFloat(rotMatch[1]) : 0;
      if (rotDeg) {
        ctx.save();
        const centerX = bCanvasAbsLeft + bCanvas.width / 2;
        const centerY = bCanvasAbsTop + bCanvas.height / 2;
        ctx.translate(centerX, centerY);
        ctx.rotate((rotDeg * Math.PI) / 180);
        ctx.drawImage(bCanvas, -bCanvas.width / 2, -bCanvas.height / 2, bCanvas.width, bCanvas.height);
        ctx.restore();
      } else {
        ctx.drawImage(bCanvas, bCanvasAbsLeft, bCanvasAbsTop, bCanvas.width, bCanvas.height);
      }
    }
  });

  const dataUrl = exportCanvas.toDataURL("image/jpeg", 0.9);
  exportCanvas.width = 0;
  exportCanvas.height = 0;
  if (returnDataUrl) return dataUrl;

  const link = document.createElement("a");
  link.download = defaultFilename;
  link.href = dataUrl;
  link.click();
  return dataUrl;
};

export const getReadableMinimumFontSize = (pageWidth: number): number => {
  if (!pageWidth || pageWidth <= 0) return 14;
  return Math.max(14, Math.round(pageWidth * 0.0225));
};

export function measureBubbleRenderFit(
  text: string,
  width: number,
  height: number,
  pageWidth: number,
  fontFamily: string,
  globalMultiplier: number,
  bubbleMultiplier: number,
  isOval: boolean,
  targetFontSize?: number,
): BubbleTextFit {
  if (typeof targetFontSize === "number" && targetFontSize > 0) {
    const effectiveFs = Math.max(8, Math.round(targetFontSize * globalMultiplier * bubbleMultiplier));
    const layout = layoutBubbleAtFixedFont(
      text, width, effectiveFs, fontFamily, isOval, 0, height,
    );
    return {
      fontSize: effectiveFs,
      lines: layout.lines,
      lineHeight: effectiveFs * 1.30,
      fits: !layout.overflow,
    };
  }
  const targetMinimum = Math.max(14, Math.round(getReadableMinimumFontSize(pageWidth) * 0.75));
  const allowedMinimum = Math.max(8, Math.round(targetMinimum * Math.min(1, bubbleMultiplier)));
  return fitTextForBubble(
    text,
    width * 0.92,
    height * 0.92,
    fontFamily,
    isOval,
    globalMultiplier * bubbleMultiplier,
    allowedMinimum,
  );
}

/** The export overlay may grow a non-fitting frame up to 2.5x before drawing. */
export function growBubbleFrameToFit(
  text: string,
  baseWidth: number,
  baseHeight: number,
  pageWidth: number,
  pageHeight: number,
  fontFamily: string,
  globalMultiplier: number,
  bubbleMultiplier: number,
  isOval: boolean,
  lockWidth = false,
  targetFontSize?: number,
): { width: number; height: number } {
  const maxWidth = lockWidth ? baseWidth : Math.min(pageWidth, baseWidth * 2.5);
  const maxHeight = Math.min(pageHeight, baseHeight * 2.5);
  let width = baseWidth;
  let height = baseHeight;
  if (measureBubbleRenderFit(text, width, height, pageWidth, fontFamily, globalMultiplier, bubbleMultiplier, isOval, targetFontSize).fits) {
    return { width, height };
  }
  for (let guard = 0; guard < 30; guard++) {
    const nextWidth = lockWidth ? width : Math.min(maxWidth, width * 1.12);
    const nextHeight = Math.min(maxHeight, height * 1.12);
    if (nextWidth <= width + 0.5 && nextHeight <= height + 0.5) break;
    width = nextWidth;
    height = nextHeight;
    if (measureBubbleRenderFit(text, width, height, pageWidth, fontFamily, globalMultiplier, bubbleMultiplier, isOval, targetFontSize).fits) break;
  }
  return { width, height };
}

function splitLongTokenIntoLines(
  token: string,
  allowedW: number,
  measureFn: (str: string) => number,
  locale = "th",
): string[] {
  const graphemes =
    typeof Intl !== "undefined" && Intl.Segmenter
      ? Array.from(
          new Intl.Segmenter(locale, { granularity: "grapheme" }).segment(token),
        ).map((s) => s.segment)
      : Array.from(token);

  const tokenLines: string[] = [];
  let current = "";
  for (const g of graphemes) {
    const next = current + g;
    if (measureFn(next) > allowedW && current) {
      tokenLines.push(current);
      current = g;
    } else {
      current = next;
    }
  }
  if (current) tokenLines.push(current);
  return tokenLines.length > 0 ? tokenLines : [token];
}

export const wrapTextForBubble = (
  text: string,
  maxW: number,
  maxH: number,
  fs: number,
  fontFamily: string = "sans-serif",
  isOval: boolean = true,
  locale: string = "th",
  allowWordBreak: boolean = !isOval,
): string[] => {
  if (!text || !text.trim()) return [];
  
  let wds: string[] = [];
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    try {
      const segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
      const rawSegments = Array.from(segmenter.segment(text)).map(s => s.segment);
      for (const seg of rawSegments) {
        if (/^[.,!?:;...]+$/.test(seg) && wds.length > 0) {
          wds[wds.length - 1] += seg;
        } else {
          wds.push(seg);
        }
      }
    } catch {
      wds = text.split(/\s+/);
    }
  } else {
    wds = text.split(/\s+/);
  }

  let measureFn: (str: string) => number;
  const tempCtx = getSharedMeasureCtx();
  if (tempCtx) {
    tempCtx.font = `bold ${fs}px ${fontFamily}`;
    measureFn = (str: string) => tempCtx.measureText(str).width;
  } else {
    measureFn = (str: string) => str.length * (fs * 0.6);
  }

  const lineH = fs * 1.35;
  const estimatedLineCount = Math.max(1, Math.round(maxH / lineH));

  const getLineMaxW = (lineIndex: number, totalLines: number): number => {
    if (!isOval || totalLines <= 1) return maxW;
    const yCenter = (lineIndex + 0.5) / totalLines;
    const v = (yCenter - 0.5) * 2;
    const chordRatio = Math.sqrt(Math.max(0.2, 1 - v * v));
    return Math.min(maxW, Math.max(Math.min(maxW, fs * 1.5), maxW * chordRatio * 0.95));
  };

  let bestLines: string[] = [];

  for (let tryLines = Math.max(1, estimatedLineCount - 1); tryLines <= estimatedLineCount + 3; tryLines++) {
    const lines: string[] = [];
    let cur = "";
    let lineIdx = 0;

    for (const w of wds) {
      let allowedW = getLineMaxW(lineIdx, tryLines);
      const test = cur ? (cur + w) : w;
      if (measureFn(test) > allowedW && cur) {
        lines.push(cur);
        cur = "";
        lineIdx++;
        allowedW = getLineMaxW(lineIdx, tryLines);
      }

      if (allowWordBreak && measureFn(w) > allowedW && maxW >= 25) {
        const subLines = splitLongTokenIntoLines(w, allowedW, measureFn, locale);
        for (let i = 0; i < subLines.length - 1; i++) {
          lines.push(subLines[i]);
          lineIdx++;
        }
        cur = subLines[subLines.length - 1];
      } else {
        cur = cur ? (cur + w) : w;
      }
    }
    if (cur) lines.push(cur);

    bestLines = lines;
    if (lines.length * lineH <= maxH * 1.15) {
      break;
    }
  }

  return bestLines.length > 0 ? bestLines : [text];
};

export interface BubbleTextFit {
  fontSize: number;
  lines: string[];
  lineHeight: number;
  fits: boolean;
}

// One shared measuring context for text fitting — creating a fresh canvas
// per wrap/fit iteration churned dozens of canvases per bubble render.
let sharedMeasureCtx: CanvasRenderingContext2D | null | undefined;
const getSharedMeasureCtx = (): CanvasRenderingContext2D | null => {
  if (typeof document === "undefined") return null;
  if (sharedMeasureCtx === undefined) {
    sharedMeasureCtx = document.createElement("canvas").getContext("2d");
  }
  return sharedMeasureCtx;
};

export function layoutBubbleAtFixedFont(
  text: string,
  widthPx: number,
  fontSizePx: number,
  fontFamily: string,
  isOval: boolean,
  manualMinHeightPx: number,
  availableHeightPx: number,
): FixedFontWidthResult {
  const measureContext = getSharedMeasureCtx();
  if (measureContext) measureContext.font = `bold ${fontSizePx}px ${fontFamily}`;
  return layoutTextAtFixedFont({
    text,
    widthPx,
    fontSizePx,
    fontFamily,
    manualMinHeightPx,
    availableHeightPx,
    isOval,
    measureText: measureContext
      ? (value) => measureContext.measureText(value).width
      : (value) => value.length * (fontSizePx * 0.6),
  });
}

export function fitTextForBubble(
  text: string,
  width: number,
  height: number,
  fontFamily: string = "sans-serif",
  isOval: boolean = true,
  fontSizeMultiplier = 1,
  minFontSize = 14,
): BubbleTextFit {
  const safeW = width * 0.88;
  const safeH = height * 0.88;
  const maxFs = Math.max(minFontSize, Math.round(Math.min(height * 0.55, width * 0.55, 96) * fontSizeMultiplier));
  
  let bestFit: BubbleTextFit = {
    fontSize: minFontSize,
    lines: wrapTextForBubble(text, safeW, safeH, minFontSize, fontFamily, isOval),
    lineHeight: minFontSize * 1.30,
    fits: false,
  };

  for (let fs = maxFs; fs >= minFontSize; fs--) {
    const lineH = fs * 1.30;
    const lines = wrapTextForBubble(text, safeW, safeH, fs, fontFamily, isOval);
    const totalH = lines.length * lineH;
    
    let maxWidthOk = true;
    const tempCtx = getSharedMeasureCtx();
    if (tempCtx) {
      tempCtx.font = `bold ${fs}px ${fontFamily}`;
      for (let i = 0; i < lines.length; i++) {
        const allowed = isOval && lines.length > 1 ? safeW * Math.sqrt(Math.max(0.2, 1 - Math.pow(((i + 0.5) / lines.length - 0.5) * 2, 2))) : safeW;
        if (tempCtx.measureText(lines[i]).width > allowed * 1.05) {
          maxWidthOk = false;
          break;
        }
      }
    } else {
      for (const l of lines) {
        if (l.length * (fs * 0.6) > safeW * 1.05) {
          maxWidthOk = false;
          break;
        }
      }
    }

    if (totalH <= safeH && maxWidthOk) {
      return {
        fontSize: fs,
        lines,
        lineHeight: lineH,
        fits: true,
      };
    }
    if (fs === minFontSize) {
      bestFit = {
        fontSize: fs,
        lines,
        lineHeight: lineH,
        fits: totalH <= safeH && maxWidthOk,
      };
    }
  }

  return bestFit;
}

export function measureTextLinesWidth(
  lines: string[],
  fontSize: number,
  fontFamily: string = "sans-serif",
): number {
  if (!lines || lines.length === 0) return 0;
  const tempCtx = getSharedMeasureCtx();
  if (tempCtx) {
    tempCtx.font = `bold ${fontSize}px ${fontFamily}`;
    let maxW = 0;
    for (const line of lines) {
      const w = tempCtx.measureText(line).width;
      if (w > maxW) maxW = w;
    }
    return maxW;
  }
  let maxLen = 0;
  for (const line of lines) {
    if (line.length > maxLen) maxLen = line.length;
  }
  return maxLen * (fontSize * 0.6);
}

export interface AdaptiveBubbleLayout extends BubbleTextFit {
  width: number;
  height: number;
}

export function fitTextInAdaptiveBubble(
  text: string,
  width: number,
  height: number,
  fontFamily: string = "sans-serif",
  isOval: boolean = true,
  fontSizeMultiplier = 1,
  minFontSize = 14,
  maxScale = 3.0,
): AdaptiveBubbleLayout {
  let curW = width;
  let curH = height;
  const maxW = width * maxScale;
  const maxH = height * maxScale;

  let fit = fitTextForBubble(text, curW, curH, fontFamily, isOval, fontSizeMultiplier, minFontSize);

  while ((curW < maxW || curH < maxH) && !fit.fits) {
    curW = Math.min(maxW, curW * 1.25);
    curH = Math.min(maxH, curH * 1.25);
    fit = fitTextForBubble(text, curW, curH, fontFamily, isOval, fontSizeMultiplier, minFontSize);
    if (fit.fits) break;
  }

  if (fit.lines.length > 0) {
    const textH = (fit.lines.length - 1) * fit.lineHeight + fit.fontSize * 1.25;
    const textW = measureTextLinesWidth(fit.lines, fit.fontSize, fontFamily);
    const snugW = Math.max(28, Math.min(curW, Math.ceil(textW * 1.22)));
    const snugH = Math.max(20, Math.min(curH, Math.ceil(textH * 1.22)));
    return {
      ...fit,
      width: snugW,
      height: snugH,
    };
  }

  return { ...fit, width: curW, height: curH };
}

export const applyTranslationOverlay = async (
  bubbles: TranslatedBubble[],
  viewMode: "single" | "scroll" | "offscreen",
  currentPage: number,
  setTranslationResult: (msg: string | null) => void,
  onComplete?: (dataUrl: string) => void,
  textStyleRef?: React.MutableRefObject<OverlayTextStyle>,
  containerOverride?: Element,
  pageKeyOverride?: string,
  onBubblesMutated?: () => void,
) => {
  let container: Element | null | undefined = containerOverride;
  if (!container && viewMode === "offscreen") {
    container = document.getElementById("offscreen-container");
  } else if (!container && viewMode === "scroll") {
    container = document.querySelector(`#spage-${currentPage}`);
  } else if (!container) {
    container = document.getElementById("pageContainer");
  }

  if (!container) return;

  const generation = (overlayGenerations.get(container) ?? 0) + 1;
  overlayGenerations.set(container, generation);
  const isStaleOverlay = () => overlayGenerations.get(container) !== generation;

  // Detach document listeners left behind by overlays whose containers were
  // removed (page switches remount #pageContainer).
  pruneOverlayCleanups();

  container.querySelectorAll(".tl-overlay,.tl-canvas").forEach((el) => {
    if (typeof (el as unknown as { _cleanupListeners?: () => void })._cleanupListeners === "function") {
      (el as unknown as { _cleanupListeners: () => void })._cleanupListeners();
    }
    el.remove();
  });
  const img = container.querySelector("img");
  if (!img) return;
  img.ondragstart = (e) => e.preventDefault();

  // Saved empty edits retain their geometry so users can select and refill them.
  const real = bubbles.filter(b => b && !b.deleted && (
    (b.t ?? b.translated ?? "").trim() || b.layoutAdjustment
  ));
  if (real.length === 0) {
    return;
  }

  const paint = async () => {
    // A newer apply on this container must win — bail without touching the DOM.
    if (isStaleOverlay()) return;
    // Repaints (duplicate bubble, style change) must replace the previous
    // layer — otherwise every duplicate click stacks another full overlay
    // and leaks its document-level listeners.
    container.querySelectorAll(".tl-overlay,.tl-canvas").forEach((el) => {
      const cleanup = (el as unknown as { _cleanupListeners?: () => void })._cleanupListeners;
      if (typeof cleanup === "function") cleanup();
      el.remove();
    });

    const currentTextStyle = textStyleRef?.current || { fontFamily: "Itim, sans-serif", textColor: "#000000", textOutline: "#FFFFFF", fontSizeMultiplier: 1.0 };
    const resolvedFontFam = resolveCanvasFontFamily(currentTextStyle.fontFamily);
    try {
      await document.fonts.load(`bold 16px ${resolvedFontFam}`);
    } catch {
      // Font loading is best-effort; measurement falls back below.
    }
    if (isStaleOverlay()) return;
    const iw = img.naturalWidth || img.offsetWidth;
    const ih = img.naturalHeight || img.offsetHeight;
    if (!iw || !ih) { setTimeout(paint, 100); return; }

    // Adjustments are keyed by page URL — keying by array index re-mapped
    // every saved position whenever pages were reordered or deleted.
    const pageKey = pageKeyOverride ?? `page-${currentPage}`;
    const storagePageKey = compactOverlayPageKey(pageKey);
    const savedAdj = readPageOverlayAdjustments(pageKey);

    const tlContainer = document.createElement("div");
    tlContainer.className = "tl-canvas";
    tlContainer.style.cssText = `position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:10;`;
    container.appendChild(tlContainer);

    const chromeRoot =
      viewMode === "single"
        ? (container.parentElement?.querySelector<HTMLElement>("[data-overlay-chrome-layer]")
          ?? document.getElementById("overlayChromeLayer"))
        : null;
    chromeRoot?.querySelectorAll("[data-translation-chrome]").forEach((el) => el.remove());

    type BubbleChromeControls = {
      toolbar: HTMLElement;
      handles: HTMLElement[];
      position: () => void;
      setVisible: (visible: boolean) => void;
    };
    const chromeControlsByWrapper = new WeakMap<HTMLElement, BubbleChromeControls>();

    let fallbackY2 = 10;

    let selectedBubbleWrapper: HTMLElement | null = null;
    const setSelectedBubble = (wrapper: HTMLElement | null) => {
      (chromeRoot ?? tlContainer).querySelectorAll<HTMLElement>("[data-bubble-more-menu]").forEach((menu) => {
        menu.style.display = "none";
      });
      if (selectedBubbleWrapper && selectedBubbleWrapper !== wrapper) {
        selectedBubbleWrapper.style.outline = "none";
        selectedBubbleWrapper.style.zIndex = "10";
        selectedBubbleWrapper.removeAttribute("data-selected");
        chromeControlsByWrapper.get(selectedBubbleWrapper)?.setVisible(false);
      }
      selectedBubbleWrapper = wrapper;
      if (!wrapper) return;

      wrapper.style.outline = "1.5px dashed #3b82f6";
      wrapper.style.zIndex = "30";
      wrapper.setAttribute("data-selected", "true");
      const controls = chromeControlsByWrapper.get(wrapper);
      controls?.position();
      controls?.setVisible(true);
    };

    if (img && (img.naturalWidth > 0 || img.width > 0)) {
      real.forEach((b) => {
        if (!b.styleProfile && b.box && b.box.length === 4 && !b.isInvalidBox) {
          const sample = sampleBubbleRegion(img, b.box);
          if (sample) {
            const profile = extractTextColors(sample);
            profile.category = inferTextStyleCategory(b);
            if (profile.source === "global" && !profile.fallbackReason) {
              profile.fallbackReason = "low-confidence";
            }
            b.styleProfile = profile;
          }
        }
      });
      applyNearbyStyleFallbacks(real);
    }

    real.forEach((b) => {
      let rawX = 50, rawY = 50, rawW = 20, rawH = 10;
      let isInvalidBox = false;

      if (b.box && Array.isArray(b.box) && b.box.length === 4) {
        const [ymin, xmin, ymax, xmax] = b.box;
        if (typeof ymin === 'number' && typeof xmin === 'number' && typeof ymax === 'number' && typeof xmax === 'number') {
          if (xmin === 0 && ymin === 0 && xmax === 1000 && ymax === 1000) {
            isInvalidBox = true;
          } else {
            rawX = (xmin + xmax) / 2 / 10;
            rawY = (ymin + ymax) / 2 / 10;
            rawW = Math.max(4, (xmax - xmin) / 10);
            rawH = Math.max(2, (ymax - ymin) / 10);
          }
        }
      }

      if (isInvalidBox) {
        rawX = 50; rawY = fallbackY2;
        fallbackY2 = (fallbackY2 + 15 > 85) ? 8 : fallbackY2 + 12;
        rawW = 30; rawH = 15;
        b.isInvalidBox = true;
      }

      const bubbleId = bubbleKeyOf(b);
      const legacyBubbleId = b.id !== undefined
        ? `id-${b.id}`
        : `text-${(b.t || b.translated || "").slice(0, 10)}-${rawX.toFixed(1)}-${rawY.toFixed(1)}`;
      const legacyAdj = savedAdj[bubbleId] ?? savedAdj[legacyBubbleId];
      let adj = b.layoutAdjustment ?? legacyAdj;
      const hasSavedWidthFont = [b.targetFontSize, adj?.targetFontSize, legacyAdj?.targetFontSize].some(
        (targetFontSize) => typeof targetFontSize === "number"
          && Number.isFinite(targetFontSize)
          && targetFontSize > 0,
      );

      // Repair layout adjustments inflated by the old frame-floor bug: a
      // saved legacy frame far larger than the detected bubble box balloons
      // the whole wrapper. Width-managed frames can grow legitimately with
      // wrapped content, so preserve those saved source-pixel dimensions.
      if (adj && !b.isInvalidBox && !hasSavedWidthFont) {
        const rawPxW = (rawW / 100) * iw;
        const rawPxH = (rawH / 100) * ih;
        if (adj.bw > rawPxW * 4 || adj.bh > rawPxH * 4) {
          const cx = Math.max(0, Math.min(iw, adj.bx + adj.bw / 2));
          const cy = Math.max(0, Math.min(ih, adj.by + adj.bh / 2));
          const repairedW = adj.bw > rawPxW * 4 ? rawPxW * 4 : adj.bw;
          const repairedH = adj.bh > rawPxH * 4 ? rawPxH * 4 : adj.bh;
          adj = {
            ...adj,
            bw: repairedW,
            bh: repairedH,
            bx: Math.max(0, Math.min(iw - repairedW, cx - repairedW / 2)),
            by: Math.max(0, Math.min(ih - repairedH, cy - repairedH / 2)),
          };
        }
      }

      if (legacyAdj?.fontSizeMultiplier !== undefined && b.fontSizeMultiplier === undefined) {
        b.fontSizeMultiplier = legacyAdj.fontSizeMultiplier;
      }
      if (legacyAdj?.targetFontSize !== undefined && b.targetFontSize === undefined) {
        b.targetFontSize = legacyAdj.targetFontSize;
      }
      if (adj?.targetFontSize !== undefined && b.targetFontSize === undefined) {
        b.targetFontSize = adj.targetFontSize;
      }

      let currentBx = adj ? adj.bx : (rawX / 100) * iw - ((rawW / 100) * iw) / 2;
      let currentBy = adj ? adj.by : (rawY / 100) * ih - ((rawH / 100) * ih) / 2;
      let currentBw = adj ? adj.bw : (rawW / 100) * iw;
      let currentBh = adj ? adj.bh : (rawH / 100) * ih;
      let currentRotation = adj?.rotation !== undefined ? adj.rotation : ((b.rotation as number) || 0);
      let manualMinHeightPx = typeof adj?.manualMinHeightPx === "number"
        && Number.isFinite(adj.manualMinHeightPx)
        ? Math.max(0, adj.manualMinHeightPx)
        : undefined;
      let layoutOverflow = false;
      // Frame-floor bookkeeping: the size the floor grows from (so repeated
      // re-renders cannot compound it) and whether a resize drag is live.
      let resizeDragActive = false;
      let floorBase: { w: number; h: number } | null = null;

      const saveAdjustment = () => {
        floorBase = { w: currentBw, h: currentBh };
        const persistedLayout: OverlayAdjustment = {
          bx: currentBx,
          by: currentBy,
          bw: currentBw,
          bh: currentBh,
          iw,
          ih,
          rotation: currentRotation,
          ...(typeof b.fontSizeMultiplier === "number" ? { fontSizeMultiplier: b.fontSizeMultiplier } : {}),
          ...(typeof b.targetFontSize === "number" ? { targetFontSize: b.targetFontSize } : {}),
          ...(typeof manualMinHeightPx === "number" ? { manualMinHeightPx } : {}),
        };
        b.layoutAdjustment = persistedLayout;

        const all = readOverlayAdjustments();
        if (!all[storagePageKey]) all[storagePageKey] = {};
        all[storagePageKey][bubbleId] = {
          ...persistedLayout,
        };
        saveOverlayAdjustments(all);

        if (img && (img.naturalWidth > 0 || img.width > 0)) {
          const sample = sampleRectRegion(img, {
            x: currentBx,
            y: currentBy,
            width: currentBw,
            height: currentBh,
          });
          if (sample) {
            recomputeAdaptiveReadableOnLayoutCommit(b, sample);
          }
        }

        onBubblesMutated?.();
      };

      const wrapper = document.createElement("div");
      wrapper.className = "translation-bubble translation-bubble-wrapper";
      wrapper.tabIndex = 0;
      const shortText = (b.t || b.translated || "").replace(/\s+/g, " ").trim().slice(0, 60);
      const baseAriaLabel = `กล่องข้อความ: ${shortText}`;
      wrapper.setAttribute("aria-label", baseAriaLabel);
      wrapper.setAttribute("data-bubble-id", bubbleId);
      wrapper.style.cssText = `position:absolute; box-sizing:border-box; cursor:grab; pointer-events:auto; touch-action:none; border-radius:4px; z-index:10; transform-origin:center center;`;
      
      const bCanvas = document.createElement("canvas");
      bCanvas.style.cssText = `display:block; width:100%; height:100%; pointer-events:none;`;
      wrapper.appendChild(bCanvas);
      const overflowNotice = document.createElement("span");
      overflowNotice.className = "bubble-layout-overflow";
      overflowNotice.setAttribute("role", "status");
      overflowNotice.style.cssText = `position:absolute; right:2px; bottom:2px; z-index:20; max-width:calc(100% - 4px); padding:2px 5px; border-radius:4px; background:rgba(180,83,9,0.96); color:#fff; font:600 11px/1.3 sans-serif; pointer-events:none;`;
      overflowNotice.textContent = "ข้อความล้นพื้นที่หน้า";
      overflowNotice.hidden = true;
      wrapper.appendChild(overflowNotice);
      let activeEditorPosition: (() => void) | null = null;
      const ts = textStyleRef?.current || { fontFamily: "Itim, sans-serif", textColor: "#000000", textOutline: "#FFFFFF", fontSizeMultiplier: 1.0 };
      const fontFam = resolvedFontFam;
      const fontMult = ts.fontSizeMultiplier || 1.0;
      const minReadableFs = Math.max(14, getReadableMinimumFontSize(iw));

      if (!adj) {
        const text = (b.t || b.translated || "").trim();
        if (text) {
          const layout = fitTextInAdaptiveBubble(
            text,
            currentBw,
            currentBh,
            fontFam,
            !b.isInvalidBox,
            fontMult,
            minReadableFs,
            3.0
          );
          const origCx = currentBx + currentBw / 2;
          const origCy = currentBy + currentBh / 2;
          currentBw = layout.width;
          currentBh = layout.height;
          currentBx = Math.max(0, Math.min(iw - currentBw, origCx - currentBw / 2));
          currentBy = Math.max(0, Math.min(ih - currentBh, origCy - currentBh / 2));
        }
      }

      const renderBubble = () => {
        const currentStyle = textStyleRef?.current || ts;
        const text = (b.t || b.translated || "").trim();
        const currentFontFam = resolveCanvasFontFamily(currentStyle.fontFamily);
        const bubbleMult = typeof b.fontSizeMultiplier === "number" ? b.fontSizeMultiplier : 1.0;
        const lockedFs = typeof b.targetFontSize === "number" && Number.isFinite(b.targetFontSize) && b.targetFontSize > 0
          ? b.targetFontSize
          : (typeof adj?.targetFontSize === "number" && Number.isFinite(adj.targetFontSize) && adj.targetFontSize > 0
            ? adj.targetFontSize
            : undefined);
        let fixedLayout: FixedFontWidthResult | null = null;

        if (text && typeof lockedFs === "number") {
          const effectiveFs = Math.max(8, Math.round(
            lockedFs * (currentStyle.fontSizeMultiplier || 1.0) * bubbleMult,
          ));
          const savedManualMinimum = manualMinHeightPx
            ?? adj?.manualMinHeightPx
            ?? (adj ? currentBh : 25);
          fixedLayout = layoutBubbleAtFixedFont(
            text,
            currentBw,
            effectiveFs,
            currentFontFam,
            !b.isInvalidBox,
            savedManualMinimum,
            Math.max(0, ih - currentBy),
          );
          currentBh = fixedLayout.heightPx;
          layoutOverflow = fixedLayout.overflow
            || currentBx < 0
            || currentBx + currentBw > iw
            || currentBy < 0
            || currentBy + currentBh > ih;
        } else {
          layoutOverflow = false;
        }

        wrapper.dataset.layoutOverflow = layoutOverflow ? "true" : "false";
        overflowNotice.hidden = !layoutOverflow;
        wrapper.title = layoutOverflow ? "ข้อความล้นพื้นที่หน้า กรุณาขยายพื้นที่หรือแก้ข้อความ" : "";
        wrapper.setAttribute(
          "aria-label",
          layoutOverflow ? `${baseAriaLabel}; ข้อความล้นพื้นที่หน้า` : baseAriaLabel,
        );

        // Frame floor: when the font has already reached its floor and the
        // text still cannot fit, grow the frame around its center instead of
        // letting the text overflow the bubble. Growth is anchored to the
        // last committed/fitting size (floorBase) so re-renders never
        // compound it, and it pauses entirely while a resize drag is live —
        // otherwise dragging smaller made the frame snap back and balloon.
        if (text && !resizeDragActive && !fixedLayout) {
          if (measureBubbleRenderFit(
            text, currentBw, currentBh, iw, currentFontFam,
            currentStyle.fontSizeMultiplier || 1.0, bubbleMult, !b.isInvalidBox,
            lockedFs,
          ).fits) {
            floorBase = { w: currentBw, h: currentBh };
          } else {
            if (!floorBase) floorBase = { w: currentBw, h: currentBh };
            const lockWidth = Boolean(adj || b.layoutAdjustment || lockedFs);
            const baseW = lockWidth ? currentBw : floorBase.w;
            const grown = growBubbleFrameToFit(
              text, baseW, floorBase.h, iw, ih, currentFontFam,
              currentStyle.fontSizeMultiplier || 1.0, bubbleMult, !b.isInvalidBox,
              lockWidth,
              lockedFs,
            );
            currentBw = grown.width;
            currentBh = grown.height;
            floorBase = { w: currentBw, h: currentBh };
            if (!lockWidth) {
              const cx = currentBx + currentBw / 2;
              const cy = currentBy + currentBh / 2;
              currentBx = Math.max(0, Math.min(iw - currentBw, cx - currentBw / 2));
              currentBy = Math.max(0, Math.min(ih - currentBh, cy - currentBh / 2));
            }
          }
        }

        wrapper.style.left = `${(currentBx / iw) * 100}%`;
        wrapper.style.top = `${(currentBy / ih) * 100}%`;
        wrapper.style.width = `${(currentBw / iw) * 100}%`;
        wrapper.style.height = `${(currentBh / ih) * 100}%`;
        wrapper.style.transform = currentRotation ? `rotate(${currentRotation.toFixed(1)}deg)` : "";
        bCanvas.width = Math.round(currentBw);
        bCanvas.height = Math.round(currentBh);
        const ctx = bCanvas.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, currentBw, currentBh);
        if (!text) return;
        const resolvedStyle = resolveBubbleTextStyle(b, currentStyle);
        const textColor = resolvedStyle.textColor;
        const outlineColor = resolvedStyle.textOutline;
        const opacity = resolvedStyle.opacity ?? 1.0;
        const fit = fixedLayout
          ? {
              fontSize: fixedLayout.fontSizePx,
              lines: fixedLayout.lines,
              lineHeight: fixedLayout.fontSizePx * 1.30,
              fits: !layoutOverflow,
            }
          : measureBubbleRenderFit(
              text,
              currentBw,
              currentBh,
              iw,
              currentFontFam,
              currentStyle.fontSizeMultiplier || 1.0,
              bubbleMult,
              !b.isInvalidBox,
              lockedFs,
            );
        const fontSize = fit.fontSize;
        const lines = fit.lines;
        const lineH = Math.min(fontSize * 1.30, currentBh / Math.max(1, lines.length));

        ctx.globalAlpha = opacity;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `bold ${fontSize}px ${currentFontFam}`;
        ctx.strokeStyle = outlineColor;
        ctx.lineWidth = resolvedStyle.hasOutline
          ? Math.max(1, fontSize * resolvedStyle.outlineWidthRatio)
          : 0;

        let fillPaint: string | CanvasGradient = textColor;
        const gradient = resolvedStyle.fillGradient;
        if (gradient && gradient.stops.length >= 2) {
          const angle = (gradient.angleDeg * Math.PI) / 180;
          const half = Math.max(currentBw, currentBh) / 2;
          const cx = currentBw / 2;
          const cy = currentBh / 2;
          const dx = Math.cos(angle) * half;
          const dy = Math.sin(angle) * half;
          const canvasGradient = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
          for (const stop of gradient.stops) {
            canvasGradient.addColorStop(Math.max(0, Math.min(1, stop.offset)), stop.color);
          }
          fillPaint = canvasGradient;
        }

        const visualEffect = resolvedStyle.shadow;
        if (visualEffect) {
          ctx.shadowColor = canvasShadowColor(visualEffect.color, visualEffect.opacity);
          ctx.shadowBlur = Math.max(0, fontSize * visualEffect.blurRatio);
          ctx.shadowOffsetX = fontSize * visualEffect.offsetXRatio;
          ctx.shadowOffsetY = fontSize * visualEffect.offsetYRatio;
        } else {
          ctx.shadowColor = "rgba(0,0,0,0)";
          ctx.shadowBlur = 0;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 0;
        }

        const totalH = (lines.length - 1) * lineH;
        const startY = (currentBh / 2) - (totalH / 2);
        lines.forEach((l, i) => {
          const yPos = startY + i * lineH;
          if (resolvedStyle.hasOutline && ctx.lineWidth > 0) {
            ctx.strokeText(l, currentBw / 2, yPos);
          }
          ctx.fillStyle = fillPaint;
          ctx.fillText(l, currentBw / 2, yPos);
        });
        chromeControlsByWrapper.get(wrapper)?.position();
      };

      b.render = renderBubble;

      if (viewMode !== "offscreen") {
        wrapper.addEventListener('mouseenter', () => { if (selectedBubbleWrapper !== wrapper) wrapper.style.outline = "1.5px dashed rgba(249,115,22,0.65)"; });
      wrapper.addEventListener('mouseleave', () => { if (selectedBubbleWrapper !== wrapper) wrapper.style.outline = "none"; });

      let isDragging = false;
      let dragStartX = 0, dragStartY = 0;
      let initialBx = 0, initialBy = 0;

      wrapper.addEventListener('pointerdown', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('.action-handle') || target.closest('.delete-btn') || target.closest('.edit-btn')) return;
        e.stopPropagation();
        setSelectedBubble(wrapper);
        isDragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        initialBx = currentBx;
        initialBy = currentBy;
        try {
          wrapper.setPointerCapture(e.pointerId);
        } catch {
          // ignore
        }
      });

      wrapper.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        e.stopPropagation();
        const rect = tlContainer.getBoundingClientRect();
        currentBx = initialBx + (e.clientX - dragStartX) * (iw / rect.width);
        currentBy = initialBy + (e.clientY - dragStartY) * (ih / rect.height);
        renderBubble();
      });

      wrapper.addEventListener('pointerup', (e) => {
        if (isDragging) {
          e.stopPropagation();
          isDragging = false;
          try {
            wrapper.releasePointerCapture(e.pointerId);
          } catch {
            // ignore
          }
          saveAdjustment();
          if (currentBx !== initialBx || currentBy !== initialBy) {
            const finalBx = currentBx, finalBy = currentBy;
            undoManager.push({
              label: "ย้ายตำแหน่งกล่องข้อความ",
              undo: () => {
                currentBx = initialBx;
                currentBy = initialBy;
                renderBubble();
                saveAdjustment();
              },
              redo: () => {
                currentBx = finalBx;
                currentBy = finalBy;
                renderBubble();
                saveAdjustment();
              },
            });
          }
        }
      });

      wrapper.addEventListener('pointercancel', (e) => {
        if (isDragging) {
          isDragging = false;
          try {
            wrapper.releasePointerCapture(e.pointerId);
          } catch {
            // ignore
          }
          saveAdjustment();
        }
      });

      const openLiveEditor = () => {
        chromeControlsByWrapper.get(wrapper)?.setVisible(false);
        const editorHost = chromeRoot ?? tlContainer;
        editorHost.querySelectorAll("[data-translation-editor]").forEach((el) => el.remove());

        const openingText = (b.t || b.translated || "").trim();
        const editor = document.createElement("div");
        editor.setAttribute("data-translation-editor", "true");
        editor.setAttribute("data-translation-chrome", "true");
        editor.className = "translation-editor-bubble";
        editor.style.cssText = `position:absolute; z-index:60; pointer-events:auto; display:grid; gap:7px; box-sizing:border-box; background:rgba(24,24,27,0.98); backdrop-filter:blur(14px); border:1px solid rgba(255,255,255,0.22); border-radius:11px; padding:7px; box-shadow:0 12px 32px rgba(0,0,0,0.55);`;

        const textarea = document.createElement("textarea");
        textarea.rows = 2;
        textarea.value = openingText;
        textarea.setAttribute("aria-label", "แก้ไขข้อความแปล");
        textarea.className = "translation-editor-input";
        textarea.style.cssText = `display:block; width:100%; min-width:320px; min-height:48px; max-height:160px; box-sizing:border-box; resize:none; overflow-y:auto; background:#27272a; color:#f4f4f5; border:1px solid #52525b; border-radius:9px; padding:10px 12px; font-size:16px; line-height:1.45; font-family:inherit; outline:none;`;

        editor.appendChild(textarea);

        const editorActions = document.createElement("div");
        editorActions.style.cssText = `display:flex; justify-content:flex-end; align-items:center; gap:6px;`;
        editor.appendChild(editorActions);

        const positionEditor = () => {
          const hostRect = editorHost.getBoundingClientRect();
          const stageRect = tlContainer.getBoundingClientRect();
          const hostScale = chromeRoot
            ? 1
            : (stageRect.width > 0 ? Math.max(0.01, stageRect.width / iw) : 1);
          const viewportWidth = (hostRect.width || iw * hostScale) / hostScale;
          const viewportHeight = (hostRect.height || ih * hostScale) / hostScale;
          const editorWidth = Math.max(220, Math.min(320, viewportWidth - 16));
          const bubbleRect = wrapper.getBoundingClientRect();
          const bubbleLeft = bubbleRect.width > 0
            ? (bubbleRect.left - hostRect.left) / hostScale
            : currentBx;
          const bubbleTop = bubbleRect.height > 0
            ? (bubbleRect.top - hostRect.top) / hostScale
            : currentBy;
          const bubbleWidth = bubbleRect.width > 0 ? bubbleRect.width / hostScale : currentBw;
          const bubbleHeight = bubbleRect.height > 0 ? bubbleRect.height / hostScale : currentBh;
          const editorHeight = (editor.offsetHeight || 108) / (chromeRoot ? 1 : hostScale);
          const aboveTop = bubbleTop - editorHeight - 10;
          const belowTop = bubbleTop + bubbleHeight + 10;
          const top = aboveTop >= 8
            ? aboveTop
            : Math.max(8, Math.min(viewportHeight - editorHeight - 8, belowTop));
          const preferredLeft = bubbleLeft + bubbleWidth / 2 - editorWidth / 2;
          const left = Math.max(8, Math.min(viewportWidth - editorWidth - 8, preferredLeft));

          editor.style.width = `${editorWidth}px`;
          editor.style.maxWidth = "calc(100% - 16px)";
          textarea.style.minWidth = `${Math.min(300, editorWidth)}px`;
          editor.style.left = `${left}px`;
          editor.style.top = `${top}px`;
        };
        activeEditorPosition = positionEditor;

        let isCommitted = false;

        const commit = (restoreFocus = true) => {
          if (isCommitted) return;
          isCommitted = true;
          const finalVal = textarea.value.trim();
          b.t = finalVal;
          b.translated = finalVal;
          renderBubble();
          saveAdjustment();
          if (finalVal !== openingText) {
            onBubblesMutated?.();
            undoManager.push({
              label: "แก้ไขข้อความ",
              undo: () => {
                b.t = openingText;
                b.translated = openingText;
                renderBubble();
                saveAdjustment();
              },
              redo: () => {
                b.t = finalVal;
                b.translated = finalVal;
                renderBubble();
                saveAdjustment();
              },
            });
          }
          activeEditorPosition = null;
          editor.remove();
          if (restoreFocus) wrapper.focus();
        };

        const cancel = () => {
          if (isCommitted) return;
          isCommitted = true;
          b.t = openingText;
          b.translated = openingText;
          renderBubble();
          activeEditorPosition = null;
          editor.remove();
          wrapper.focus();
        };

        const createEditorAction = (label: string, glyph: string, onClick: () => void, primary = false) => {
          const button = document.createElement("button");
          button.type = "button";
          button.setAttribute("aria-label", label);
          button.title = label;
          button.textContent = glyph;
          button.style.cssText = `width:40px; height:36px; display:flex; align-items:center; justify-content:center; border-radius:8px; border:1px solid ${primary ? "#3b82f6" : "#52525b"}; background:${primary ? "#2563eb" : "#27272a"}; color:#fff; font-size:18px; font-weight:700; cursor:pointer;`;
          button.addEventListener("pointerdown", (event) => {
            event.preventDefault();
            event.stopPropagation();
          });
          button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            onClick();
          });
          return button;
        };

        editorActions.appendChild(createEditorAction("ยกเลิกการแก้ไข", "×", cancel));
        editorActions.appendChild(createEditorAction("บันทึกข้อความ", "✓", commit, true));

        const autoGrowEditor = () => {
          textarea.style.height = "auto";
          textarea.style.height = `${Math.min(160, Math.max(48, textarea.scrollHeight || 48))}px`;
          positionEditor();
        };

        textarea.addEventListener("input", () => {
          b.t = textarea.value;
          b.translated = textarea.value;
          renderBubble();
          autoGrowEditor();
        });

        textarea.addEventListener("keydown", (e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            commit();
          }
        });

        editor.addEventListener("focusout", () => {
          queueMicrotask(() => {
            if (!isCommitted && !editor.contains(document.activeElement)) commit(false);
          });
        });

        editorHost.appendChild(editor);
        positionEditor();
        autoGrowEditor();
        textarea.focus();
        textarea.select();
      };

      const deleteBubbleWithUndo = () => {
        b.deleted = true;
        onBubblesMutated?.();
        wrapper.style.display = "none";
        wrapper.dataset.deleted = "true";
        setSelectedBubble(null);
        undoManager.push({
          label: "ลบกล่องข้อความ",
          undo: () => {
            b.deleted = false;
            wrapper.style.display = "block";
            delete wrapper.dataset.deleted;
            renderBubble();
            onBubblesMutated?.();
          },
          redo: () => {
            b.deleted = true;
            wrapper.style.display = "none";
            wrapper.dataset.deleted = "true";
            setSelectedBubble(null);
            onBubblesMutated?.();
          },
        });
      };

      wrapper.addEventListener("focus", () => {
        setSelectedBubble(wrapper);
      });

      wrapper.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        openLiveEditor();
      });

      const adjustBubbleFontSize = (delta: number) => {
        const oldMult = typeof b.fontSizeMultiplier === "number" ? b.fontSizeMultiplier : 1.0;
        const newMult = Math.max(0.4, Math.min(3.0, Number((oldMult + delta).toFixed(2))));
        if (newMult === oldMult) return;
        b.fontSizeMultiplier = newMult;
        onBubblesMutated?.();
        renderBubble();
        saveAdjustment();
        undoManager.push({
          label: delta > 0 ? "เพิ่มขนาดข้อความ" : "ลดขนาดข้อความ",
          undo: () => {
            b.fontSizeMultiplier = oldMult;
            renderBubble();
            saveAdjustment();
          },
          redo: () => {
            b.fontSizeMultiplier = newMult;
            renderBubble();
            saveAdjustment();
          },
        });
      };

      wrapper.addEventListener("keydown", (e) => {
        if (e.target !== wrapper) return;

        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          openLiveEditor();
          return;
        }

        if (e.key === "+" || e.key === "=") {
          e.preventDefault();
          e.stopPropagation();
          adjustBubbleFontSize(0.12);
          return;
        }

        if (e.key === "-" || e.key === "_") {
          e.preventDefault();
          e.stopPropagation();
          adjustBubbleFontSize(-0.12);
          return;
        }

        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          e.stopPropagation();
          deleteBubbleWithUndo();
          return;
        }

        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setSelectedBubble(null);
          tlContainer.focus();
          return;
        }

        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
          e.preventDefault();
          e.stopPropagation();

          const delta = e.shiftKey ? 10 : 1;
          const initBx = currentBx;
          const initBy = currentBy;
          const initBw = currentBw;
          const initBh = currentBh;

          if (e.altKey) {
            if (e.key === "ArrowRight") {
              currentBw = Math.max(20, Math.min(iw - currentBx, currentBw + delta));
            } else if (e.key === "ArrowLeft") {
              currentBw = Math.max(20, currentBw - delta);
            } else if (e.key === "ArrowDown") {
              currentBh = Math.max(20, Math.min(ih - currentBy, currentBh + delta));
            } else if (e.key === "ArrowUp") {
              currentBh = Math.max(20, currentBh - delta);
            }
          } else {
            if (e.key === "ArrowRight") {
              currentBx = Math.max(0, Math.min(iw - currentBw, currentBx + delta));
            } else if (e.key === "ArrowLeft") {
              currentBx = Math.max(0, Math.min(iw - currentBw, currentBx - delta));
            } else if (e.key === "ArrowDown") {
              currentBy = Math.max(0, Math.min(ih - currentBh, currentBy + delta));
            } else if (e.key === "ArrowUp") {
              currentBy = Math.max(0, Math.min(ih - currentBh, currentBy - delta));
            }
          }

          if (currentBx !== initBx || currentBy !== initBy || currentBw !== initBw || currentBh !== initBh) {
            renderBubble();
            saveAdjustment();
            const newBx = currentBx, newBy = currentBy, newBw = currentBw, newBh = currentBh;
            undoManager.push({
              label: e.altKey ? "ปรับขนาดกล่องข้อความ" : "ย้ายตำแหน่งกล่องข้อความ",
              undo: () => {
                currentBx = initBx; currentBy = initBy; currentBw = initBw; currentBh = initBh;
                renderBubble();
                saveAdjustment();
              },
              redo: () => {
                currentBx = newBx; currentBy = newBy; currentBw = newBw; currentBh = newBh;
                renderBubble();
                saveAdjustment();
              },
            });
          }
        }
      });

      // 1. Interactive handles live in the unscaled chrome layer.
      const chromeHandles: HTMLElement[] = [];
      const handlesConfig = [
        {
          id: 'rotate',
          pos: 'nw',
          cursor: 'grab',
          title: 'หมุนข้อความ (ดูดมุมฉาก 90° อัตโนมัติ)',
          size: 36,
          icon: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>`
        },
        {
          id: 'scale',
          pos: 'ne',
          cursor: 'nesw-resize',
          title: 'ปรับขนาดเฉียง (ย่อ-ขยายทั้งกล่องและตัวหนังสือ)',
          size: 36,
          icon: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/></svg>`
        },
        {
          id: 'width',
          pos: 'e',
          cursor: 'ew-resize',
          title: 'ปรับความกว้าง (ลากซ้าย-ขวา เพื่อตัดบรรทัดใหม่ ขนาดตัวหนังสือเท่าเดิม)',
          size: 36,
          icon: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="6,8 2,12 6,16" fill="#2563eb"/><polygon points="18,8 22,12 18,16" fill="#2563eb"/><line x1="4" y1="12" x2="20" y2="12"/></svg>`
        },
        {
          id: 'move',
          pos: 'sw',
          cursor: 'move',
          title: 'ย้ายตำแหน่ง (ลากเพื่อย้ายกล่อง)',
          size: 36,
          icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="22"/></svg>`
        }
      ];

      handlesConfig.forEach(({ id, pos, cursor, title, icon, size }) => {
        const handle = document.createElement("div");
        handle.className = `action-handle action-handle--${id}`;
        handle.setAttribute("data-translation-chrome", "true");
        handle.setAttribute("data-handle-position", pos);
        handle.title = title;
        const handleSize = size || 36;
        handle.style.cssText = `position:absolute; width:${handleSize}px; height:${handleSize}px; background:#ffffff; border:2.5px solid #3b82f6; border-radius:50%; z-index:45; opacity:0; pointer-events:none; display:flex; align-items:center; justify-content:center; color:#2563eb; cursor:${cursor}; box-shadow:0 3px 10px rgba(0,0,0,0.35); transition:opacity 120ms ease, box-shadow 120ms ease, filter 120ms ease, transform 120ms ease; touch-action:none; user-select:none; transform:translate(-50%, -50%) scale(1);`;
        handle.innerHTML = icon;

        handle.addEventListener('mouseenter', () => {
          handle.style.filter = 'brightness(1.05)';
          handle.style.boxShadow = '0 6px 16px rgba(37,99,235,0.45)';
          handle.style.borderColor = '#1d4ed8';
          handle.style.transform = 'translate(-50%, -50%) scale(1.06)';
        });
        handle.addEventListener('mouseleave', () => {
          handle.style.filter = '';
          handle.style.boxShadow = '0 3px 10px rgba(0,0,0,0.35)';
          handle.style.borderColor = '#3b82f6';
          handle.style.transform = 'translate(-50%, -50%) scale(1)';
        });

        let rStartX = 0, rStartY = 0;
        let rInitBx = 0, rInitBy = 0, rInitBw = 0, rInitBh = 0;
        let rDragInitBy = 0;
        let rCenterX = 0, rCenterY = 0;
        let rStartAngle = 0;
        let rInitRot = 0;
        let rInitFontMult = 1;
        let rInitTargetFs: number | undefined = undefined;
        let rDragTargetFs: number | undefined = undefined;
        let rInitManualMinHeightPx: number | undefined = undefined;
        let widthDragDidMove = false;

        handle.addEventListener('pointerdown', (e) => {
          widthDragDidMove = false;
          rStartX = e.clientX; rStartY = e.clientY;
          rInitBx = currentBx; rInitBy = currentBy;
          rDragInitBy = currentBy;
          rInitBw = currentBw; rInitBh = currentBh;
          rInitRot = currentRotation;
          rInitFontMult = typeof b.fontSizeMultiplier === "number" ? b.fontSizeMultiplier : 1;
          rInitTargetFs = typeof b.targetFontSize === "number" && Number.isFinite(b.targetFontSize) && b.targetFontSize > 0
            ? b.targetFontSize
            : (typeof adj?.targetFontSize === "number" && Number.isFinite(adj.targetFontSize) && adj.targetFontSize > 0
              ? adj.targetFontSize
              : undefined);
          rDragTargetFs = rInitTargetFs;
          rInitManualMinHeightPx = manualMinHeightPx;
          resizeDragActive = id === 'width' || id === 'scale';

          if (id === 'width') {
            if (currentBy < 0 || currentBy + currentBh > ih) {
              currentBy = Math.max(0, Math.min(Math.max(0, ih - Math.min(currentBh, ih)), currentBy));
              rDragInitBy = currentBy;
            }
            if (manualMinHeightPx === undefined) {
              manualMinHeightPx = adj
                ? (typeof adj.manualMinHeightPx === "number" && Number.isFinite(adj.manualMinHeightPx)
                  ? Math.max(0, adj.manualMinHeightPx)
                  : adj.bh)
                : 25;
            }
            const text = (b.t || b.translated || "").trim();
            if (text && typeof rInitTargetFs !== "number") {
              const currentStyle = textStyleRef?.current || ts;
              const currentFontFam = resolveCanvasFontFamily(currentStyle.fontFamily);
              const bubbleMult = typeof b.fontSizeMultiplier === "number" ? b.fontSizeMultiplier : 1.0;
              const globalMult = currentStyle.fontSizeMultiplier || 1.0;
              const prevFit = measureBubbleRenderFit(
                text,
                currentBw,
                currentBh,
                iw,
                currentFontFam,
                globalMult,
                bubbleMult,
                !b.isInvalidBox,
              );
              const multiplier = bubbleMult * globalMult;
              rDragTargetFs = multiplier > 0 ? prevFit.fontSize / multiplier : prevFit.fontSize;
              b.targetFontSize = rDragTargetFs;
            }
          }

          const bRect = wrapper.getBoundingClientRect();
          rCenterX = bRect.left + bRect.width / 2;
          rCenterY = bRect.top + bRect.height / 2;
          rStartAngle = Math.atan2(e.clientY - rCenterY, e.clientX - rCenterX) * (180 / Math.PI);

          handle.setPointerCapture(e.pointerId);
          e.stopPropagation();
        });

        let pendingWidthPreviewFrame: number | null = null;
        let pendingWidthPointer: { pointerId: number; clientX: number; clientY: number } | null = null;

        const applyPointerMove = (clientX: number, clientY: number): void => {
          const rect = tlContainer.getBoundingClientRect();
          const dx = (clientX - rStartX) * (iw / rect.width);
          const dy = (clientY - rStartY) * (ih / rect.height);
          
          if (id === 'rotate') {
            const curAngle = Math.atan2(clientY - rCenterY, clientX - rCenterX) * (180 / Math.PI);
            const angleDiff = curAngle - rStartAngle;
            const rawRotation = (rInitRot + angleDiff + 360) % 360;
            currentRotation = snapRotationToRightAngle(rawRotation);
          } else if (id === 'width') {
            // Drag right (dx > 0) widens, drag left (dx < 0) narrows
            currentBw = Math.max(30, rInitBw + dx);
            currentBx = rInitBx;
            // Ticket 02: Keep b.fontSizeMultiplier locked.
            // Ticket 03: Top-anchored dynamic auto-height:
            const text = (b.t || b.translated || "").trim();
            if (text) {
              const currentStyle = textStyleRef?.current || ts;
              const currentFontFam = resolveCanvasFontFamily(currentStyle.fontFamily);
              const bubbleMult = typeof b.fontSizeMultiplier === "number" ? b.fontSizeMultiplier : 1.0;
              const globalMult = currentStyle.fontSizeMultiplier || 1.0;
              const targetFs = typeof b.targetFontSize === "number" && Number.isFinite(b.targetFontSize) && b.targetFontSize > 0
                ? b.targetFontSize
                : (rDragTargetFs || 16);
              const effectiveFs = Math.max(8, Math.round(targetFs * globalMult * bubbleMult));
              const isOvalBox = !b.isInvalidBox;
              const layout = layoutBubbleAtFixedFont(
                text,
                currentBw,
                effectiveFs,
                currentFontFam,
                isOvalBox,
                manualMinHeightPx ?? 25,
                Math.max(0, ih - rDragInitBy),
              );
              currentBh = layout.heightPx;
              currentBy = rDragInitBy;
            }
          } else if (id === 'scale') {
            currentBw = Math.max(20, rInitBw + dx);
            const newBh = Math.max(20, rInitBh - dy);
            currentBy = rInitBy + (rInitBh - newBh);
            currentBh = newBh;
            // Corner-drag scales the text with the frame (same 0.4-3.0 clamp
            // as the A+/A- buttons), so the whole bubble zooms as one unit.
            const heightRatio = newBh / rInitBh;
            b.fontSizeMultiplier = Math.max(0.4, Math.min(3.0, rInitFontMult * heightRatio));
            manualMinHeightPx = currentBh;
          } else if (id === 'move') {
            currentBx = rInitBx + dx;
            currentBy = rInitBy + dy;
          }
          renderBubble();
        };

        const cancelPendingWidthPreview = (): void => {
          if (pendingWidthPreviewFrame !== null) {
            window.cancelAnimationFrame(pendingWidthPreviewFrame);
            pendingWidthPreviewFrame = null;
          }
          pendingWidthPointer = null;
        };

        const flushPendingWidthPreview = (pointer?: { pointerId: number; clientX: number; clientY: number }): void => {
          if (pendingWidthPreviewFrame !== null) {
            window.cancelAnimationFrame(pendingWidthPreviewFrame);
            pendingWidthPreviewFrame = null;
          }
          const latest = pointer ?? pendingWidthPointer;
          pendingWidthPointer = null;
          if (latest && handle.hasPointerCapture(latest.pointerId)) {
            applyPointerMove(latest.clientX, latest.clientY);
          }
        };

        handle.addEventListener('pointermove', (e) => {
          if (!handle.hasPointerCapture(e.pointerId)) return;
          if (id !== "width") {
            applyPointerMove(e.clientX, e.clientY);
            return;
          }

          const rect = tlContainer.getBoundingClientRect();
          const dx = (e.clientX - rStartX) * (iw / rect.width);
          if (Math.abs(Math.max(30, rInitBw + dx) - rInitBw) < 0.001) return;
          widthDragDidMove = true;
          pendingWidthPointer = { pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY };
          if (pendingWidthPreviewFrame === null) {
            pendingWidthPreviewFrame = window.requestAnimationFrame(() => {
              pendingWidthPreviewFrame = null;
              const latest = pendingWidthPointer;
              pendingWidthPointer = null;
              if (latest && handle.hasPointerCapture(latest.pointerId)) {
                applyPointerMove(latest.clientX, latest.clientY);
              }
            });
          }
        });

        handle.addEventListener('pointerup', (e) => {
          e.stopPropagation();
          if (id === "width" && widthDragDidMove) {
            flushPendingWidthPreview({ pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY });
          }
          try {
            handle.releasePointerCapture(e.pointerId);
          } catch {
            // ignore
          }
          if (id === "width" && !widthDragDidMove) {
            resizeDragActive = false;
            currentBx = rInitBx;
            currentBy = rInitBy;
            currentBw = rInitBw;
            currentBh = rInitBh;
            currentRotation = rInitRot;
            b.targetFontSize = rInitTargetFs;
            manualMinHeightPx = rInitManualMinHeightPx;
            floorBase = { w: rInitBw, h: rInitBh };
            return;
          }
          const wasResizing = resizeDragActive;
          resizeDragActive = false;
          if (id === "scale") manualMinHeightPx = currentBh;
          saveAdjustment();
          // Re-apply the frame floor once, now that the drag has ended.
          if (wasResizing) renderBubble();

          const finalBx = currentBx, finalBy = currentBy, finalBw = currentBw, finalBh = currentBh, finalRot = currentRotation;
          const finalFontMult = typeof b.fontSizeMultiplier === "number" ? b.fontSizeMultiplier : 1.0;
          const finalTargetFs = b.targetFontSize;
          const finalManualMinHeight = manualMinHeightPx;
          if (
            finalBx !== rInitBx ||
            finalBy !== rInitBy ||
            finalBw !== rInitBw ||
            finalBh !== rInitBh ||
            finalRot !== rInitRot ||
            finalFontMult !== rInitFontMult ||
            finalTargetFs !== rInitTargetFs ||
            finalManualMinHeight !== rInitManualMinHeightPx
          ) {
            undoManager.push({
              label:
                id === "width"
                  ? "ปรับความกว้างกล่องข้อความ"
                  : id === "scale"
                  ? "ปรับขนาดกล่องข้อความ"
                  : id === "rotate"
                  ? "หมุนกล่องข้อความ"
                  : "ย้ายตำแหน่งกล่องข้อความ",
              undo: () => {
                currentBx = rInitBx;
                currentBy = rInitBy;
                currentBw = rInitBw;
                currentBh = rInitBh;
                currentRotation = rInitRot;
                b.fontSizeMultiplier = rInitFontMult;
                b.targetFontSize = rInitTargetFs;
                manualMinHeightPx = rInitManualMinHeightPx;
                floorBase = { w: rInitBw, h: rInitBh };
                renderBubble();
                saveAdjustment();
              },
              redo: () => {
                currentBx = finalBx;
                currentBy = finalBy;
                currentBw = finalBw;
                currentBh = finalBh;
                currentRotation = finalRot;
                b.fontSizeMultiplier = finalFontMult;
                b.targetFontSize = finalTargetFs;
                manualMinHeightPx = finalManualMinHeight;
                floorBase = { w: finalBw, h: finalBh };
                renderBubble();
                saveAdjustment();
              },
            });
          }
        });

        handle.addEventListener('pointercancel', (e) => {
          e.stopPropagation();
          cancelPendingWidthPreview();
          try {
            handle.releasePointerCapture(e.pointerId);
          } catch {
            // ignore
          }
          resizeDragActive = false;
          currentBx = rInitBx;
          currentBy = rInitBy;
          currentBw = rInitBw;
          currentBh = rInitBh;
          currentRotation = rInitRot;
          b.fontSizeMultiplier = rInitFontMult;
          b.targetFontSize = rInitTargetFs;
          manualMinHeightPx = rInitManualMinHeightPx;
          floorBase = { w: rInitBw, h: rInitBh };
          renderBubble();
        });

        chromeHandles.push(handle);
        (chromeRoot ?? wrapper).appendChild(handle);
      });

      // 2. Top Floating Quick Action Toolbar
      const toolbar = document.createElement("div");
      toolbar.className = "bubble-quick-toolbar action-handle";
      toolbar.setAttribute("data-translation-chrome", "true");
      toolbar.style.cssText = `
        position: absolute;
        left: 0;
        top: 0;
        transform: translate(-50%, -100%);
        background: rgba(24, 24, 27, 0.96);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.24);
        border-radius: 11px;
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5);
        padding: 4px 6px;
        display: flex;
        align-items: center;
        gap: 2px;
        max-width: calc(100% - 16px);
        overflow: visible;
        z-index: 50;
        opacity: 0;
        pointer-events: none;
        transition: opacity 120ms ease-out;
        user-select: none;
      `;

      const createToolBtn = (title: string, svg: string, onClick: () => void, isDanger = false) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.title = title;
        btn.setAttribute("aria-label", title);
        btn.className = "action-handle";
        btn.innerHTML = svg;
        btn.style.cssText = `
          width: 36px;
          height: 36px;
          border-radius: 8px;
          background: transparent;
          color: ${isDanger ? '#ef4444' : '#e4e4e7'};
          border: none;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          padding: 0;
          transition: background 150ms ease, color 150ms ease, transform 120ms ease;
        `;
        btn.onmouseenter = () => {
          btn.style.background = isDanger ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.15)';
          btn.style.transform = 'scale(1.08)';
          if (isDanger) btn.style.color = '#f87171';
        };
        btn.onmouseleave = () => {
          btn.style.background = 'transparent';
          btn.style.transform = 'scale(1)';
          btn.style.color = isDanger ? '#ef4444' : '#e4e4e7';
        };
        btn.onpointerdown = (e) => e.stopPropagation();
        btn.onclick = (e) => {
          e.stopPropagation();
          onClick();
        };
        return btn;
      };

      // Decrease Font Size Button [A-]
      const decreaseFontBtn = createToolBtn(
        "ลดขนาดข้อความ (A- หรือคีย์ -)",
        `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18 9 5l5 13"/><path d="M6 13h6"/><line x1="16" y1="12" x2="22" y2="12"/></svg>`,
        () => adjustBubbleFontSize(-0.12)
      );

      // Increase Font Size Button [A+]
      const increaseFontBtn = createToolBtn(
        "เพิ่มขนาดข้อความ (A+ หรือคีย์ +)",
        `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18 9 5l5 13"/><path d="M6 13h6"/><line x1="19" y1="9" x2="19" y2="15"/><line x1="16" y1="12" x2="22" y2="12"/></svg>`,
        () => adjustBubbleFontSize(0.12)
      );

      // Duplicate Button
      const duplicateBtn = createToolBtn(
        "ทำซ้ำกล่องข้อความ",
        `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`,
        () => {
          const clone = { ...b, id: `${Date.now()}` };
          real.push(clone);
          bubbles.push(clone);
          saveAdjustment();
          onBubblesMutated?.();
          paint();
        }
      );

      // Copy Text Button
      const copyBtn = createToolBtn(
        "คัดลอกข้อความ",
        `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`,
        () => {
          navigator.clipboard.writeText(b.t || b.translated || "");
          import('react-hot-toast').then(m => m.default.success("คัดลอกข้อความแล้ว"));
        }
      );

      // Text Color / Format Button
      const colorBtn = createToolBtn(
        "เปลี่ยนสีข้อความ",
        `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 2 4 4-12 12H6v-4z"/><path d="m14 6 4 4"/></svg>`,
        () => {
          const resolved = resolveBubbleTextStyle(b, textStyleRef?.current || ts);
          const newColor = prompt("ใส่รหัสสีข้อความ (เช่น #000000, #ffffff, #ef4444, #ff3399):", resolved.textColor);
          if (newColor) {
            const existing = b.styleProfile;
            b.styleProfile = {
              ...(existing ?? {}),
              fill: newColor,
              outline: existing?.outline ?? resolved.textOutline,
              hasOutline: existing?.hasOutline ?? resolved.hasOutline,
              outlineWidth: existing?.outlineWidth ?? resolved.outlineWidth,
              outlineWidthRatio: existing?.outlineWidthRatio ?? resolved.outlineWidthRatio,
              opacity: existing?.opacity ?? resolved.opacity,
              fillConfidence: 1.0,
              outlineConfidence: 1.0,
              confidenceBand: "high",
              refinementAttempted: existing?.refinementAttempted,
              source: "manual",
              ownershipMode: "manual",
              category: existing?.category ?? inferTextStyleCategory(b),
              fillGradient: existing?.fillGradient,
              shadow: existing?.shadow,
              glow: existing?.glow,
              fallbackReason: undefined,
              nearbySourceId: undefined,
            };
            onBubblesMutated?.();
            renderBubble();
            saveAdjustment();
          }
        }
      );

      const shadowBtn = createToolBtn(
        b.styleProfile?.manualShadowMode === "off" ? "เงา: ปิด" : "เงา: มาตรฐาน",
        `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="6"/><path d="M14 14l6 6"/><path d="M15 7a6 6 0 0 1 2 8"/></svg>`,
        () => {
          const existing = b.styleProfile;
          const resolved = resolveBubbleTextStyle(b, textStyleRef?.current || ts);
          const nextMode = existing?.manualShadowMode === "off" ? "standard" : "off";
          b.styleProfile = {
            ...(existing ?? {}),
            fill: existing?.fill ?? resolved.textColor,
            outline: existing?.outline ?? resolved.textOutline,
            hasOutline: existing?.hasOutline ?? resolved.hasOutline,
            outlineWidth: existing?.outlineWidth ?? resolved.outlineWidth,
            outlineWidthRatio: existing?.outlineWidthRatio ?? resolved.outlineWidthRatio,
            opacity: existing?.opacity ?? resolved.opacity,
            fillConfidence: existing?.fillConfidence ?? 1.0,
            outlineConfidence: existing?.outlineConfidence ?? 1.0,
            confidenceBand: existing?.confidenceBand ?? "high",
            source: "manual",
            ownershipMode: "manual",
            category: existing?.category ?? inferTextStyleCategory(b),
            manualShadowMode: nextMode,
          };
          shadowBtn.setAttribute("aria-label", nextMode === "off" ? "เงา: ปิด" : "เงา: มาตรฐาน");
          shadowBtn.title = nextMode === "off" ? "เงา: ปิด" : "เงา: มาตรฐาน";
          onBubblesMutated?.();
          renderBubble();
          saveAdjustment();
        },
      );

      const originalStyleBtn = createToolBtn(
        "กลับไปใช้สไตล์ต้นฉบับอัตโนมัติ",
        `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/></svg>`,
        () => {
          let recovered: TextStyleProfile | undefined;
          if (b.box && b.box.length === 4 && !b.isInvalidBox) {
            const sample = sampleBubbleRegion(img, b.box);
            if (sample) {
              recovered = extractTextColors(sample);
              recovered.category = inferTextStyleCategory(b);
              if (recovered.source === "global" && !recovered.fallbackReason) {
                recovered.fallbackReason = "low-confidence";
              }
            }
          }
          b.styleProfile = recovered;
          shadowBtn.setAttribute("aria-label", "เงา: มาตรฐาน");
          shadowBtn.title = "เงา: มาตรฐาน";
          applyNearbyStyleFallbacks(real);
          onBubblesMutated?.();
          renderBubble();
          saveAdjustment();
        },
      );

      // Background Fill / Inpaint Button
      const fillBtn = createToolBtn(
        "เติมสีพื้นหลัง",
        `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/></svg>`,
        () => {
          bCanvas.style.backgroundColor = bCanvas.style.backgroundColor ? "" : "#ffffff";
        }
      );

      // Layers / Z-Index Button
      const layerBtn = createToolBtn(
        "นำมาข้างหน้าสุด",
        `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
        () => {
          tlContainer.appendChild(wrapper);
        }
      );

      // Edit Text (Pencil) Button
      const editBtn = createToolBtn(
        "แก้ไขข้อความ",
        `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`,
        () => {
          openLiveEditor();
        }
      );

      const createDivider = () => {
        const div = document.createElement("div");
        div.style.cssText = `width:1.5px; height:24px; background:rgba(255,255,255,0.25); margin:0 4px;`;
        return div;
      };

      // Delete Button (Red Trash)
      const deleteBtn = createToolBtn(
        "ลบกล่องข้อความ",
        `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>`,
        () => {
          deleteBubbleWithUndo();
        },
        true
      );

      const moreMenu = document.createElement("div");
      moreMenu.setAttribute("data-bubble-more-menu", "true");
      moreMenu.style.cssText = `position:absolute; top:calc(100% + 8px); right:0; display:none; align-items:center; gap:2px; padding:5px; background:rgba(24,24,27,0.98); border:1px solid rgba(255,255,255,0.2); border-radius:10px; box-shadow:0 10px 28px rgba(0,0,0,0.5); z-index:45;`;
      moreMenu.appendChild(decreaseFontBtn);
      moreMenu.appendChild(increaseFontBtn);
      moreMenu.appendChild(shadowBtn);
      moreMenu.appendChild(originalStyleBtn);
      moreMenu.appendChild(fillBtn);
      moreMenu.addEventListener("click", (event) => {
        if ((event.target as HTMLElement | null)?.closest("button")) {
          moreMenu.style.display = "none";
        }
      });

      const moreBtn = createToolBtn(
        "เครื่องมือเพิ่มเติม",
        `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>`,
        () => {
          moreMenu.style.display = moreMenu.style.display === "flex" ? "none" : "flex";
        },
      );

      toolbar.appendChild(duplicateBtn);
      toolbar.appendChild(copyBtn);
      toolbar.appendChild(editBtn);
      toolbar.appendChild(colorBtn);
      toolbar.appendChild(layerBtn);
      toolbar.appendChild(moreBtn);
      toolbar.appendChild(createDivider());
      toolbar.appendChild(deleteBtn);
      toolbar.appendChild(moreMenu);
      (chromeRoot ?? wrapper).appendChild(toolbar);

      const positionChromeControls = () => {
        if (wrapper.style.display === "none") return;

        if (!chromeRoot) {
          const localPoints: Record<string, [string, string]> = {
            nw: ["0", "0"],
            ne: ["100%", "0"],
            e: ["100%", "50%"],
            sw: ["0", "100%"],
          };
          chromeHandles.forEach((handle) => {
            const [left, top] = localPoints[handle.dataset.handlePosition ?? "nw"];
            handle.style.left = left;
            handle.style.top = top;
          });
          const wrapperChromeScale = Math.max(
            0.6,
            Math.min(1, wrapper.offsetWidth / 220, wrapper.offsetHeight / 100),
          );
          toolbar.style.zoom = String(wrapperChromeScale);
          chromeHandles.forEach((handle) => {
            handle.style.zoom = String(wrapperChromeScale);
          });
          toolbar.style.left = "50%";
          toolbar.style.top = "-10px";
          toolbar.style.transform = "translate(-50%, -100%)";
          activeEditorPosition?.();
          return;
        }

        const rootRect = chromeRoot.getBoundingClientRect();
        const bubbleRect = wrapper.getBoundingClientRect();
        const left = bubbleRect.left - rootRect.left;
        const top = bubbleRect.top - rootRect.top;
        const right = bubbleRect.right - rootRect.left;
        const bottom = bubbleRect.bottom - rootRect.top;
        const centerX = left + bubbleRect.width / 2;
        const centerY = top + bubbleRect.height / 2;

        // Chrome (toolbar + handles) must not dwarf small bubbles: shrink it
        // as the bubble shrinks, floored so buttons stay grabbable. `zoom`
        // keeps the translate(-50%, …) anchors intact while scaling the whole
        // rendered chrome — but it also multiplies the element's own left/top
        // lengths, so every offset written below is pre-divided by the scale
        // to stay anchored on the bubble.
        const chromeScale = Math.max(
          0.6,
          Math.min(1, bubbleRect.width / 220, bubbleRect.height / 100),
        );
        // offsetWidth/offsetHeight already include the previous sync's zoom.
        const prevChromeZoom = Number(toolbar.style.zoom) || 1;
        const baseToolbarWidth = toolbar.offsetWidth > 0 ? toolbar.offsetWidth / prevChromeZoom : 286;
        const baseToolbarHeight = toolbar.offsetHeight > 0 ? toolbar.offsetHeight / prevChromeZoom : 46;
        toolbar.style.zoom = String(chromeScale);
        chromeHandles.forEach((handle) => {
          handle.style.zoom = String(chromeScale);
        });
        const scaledWidth = baseToolbarWidth * chromeScale;
        const scaledHeight = baseToolbarHeight * chromeScale;
        const rootWidth = rootRect.width || Math.max(right + 16, baseToolbarWidth + 16);
        const placeBelow = top < scaledHeight + 14;
        const minCenter = scaledWidth / 2 + 8;
        const maxCenter = Math.max(minCenter, rootWidth - scaledWidth / 2 - 8);
        const toolbarX = Math.max(minCenter, Math.min(maxCenter, centerX));
        const toolbarY = placeBelow ? bottom + 10 : top - 10;
        toolbar.style.left = `${toolbarX / chromeScale}px`;
        toolbar.style.top = `${toolbarY / chromeScale}px`;
        toolbar.style.transformOrigin = placeBelow ? "center top" : "center bottom";
        toolbar.style.transform = placeBelow ? "translate(-50%, 0)" : "translate(-50%, -100%)";

        chromeHandles.forEach((handle) => {
          const pos = handle.dataset.handlePosition;
          let x = left;
          let y = top;
          if (pos === "ne") x = right;
          else if (pos === "e") { x = right; y = centerY; }
          else if (pos === "sw") y = bottom;
          handle.style.left = `${x / chromeScale}px`;
          handle.style.top = `${y / chromeScale}px`;
        });
        activeEditorPosition?.();
      };

      const setChromeVisible = (visible: boolean) => {
        toolbar.style.opacity = visible ? "1" : "0";
        toolbar.style.pointerEvents = visible ? "auto" : "none";
        if (!visible) moreMenu.style.display = "none";
        chromeHandles.forEach((handle) => {
          handle.style.opacity = visible ? "1" : "0";
          handle.style.pointerEvents = visible ? "auto" : "none";
        });
      };

      chromeControlsByWrapper.set(wrapper, {
        toolbar,
        handles: chromeHandles,
        position: positionChromeControls,
        setVisible: setChromeVisible,
      });
      }

      tlContainer.appendChild(wrapper);
      renderBubble();
    });

    if (viewMode !== "offscreen") {
    const syncSelectedChrome = () => {
      if (!selectedBubbleWrapper) return;
      chromeControlsByWrapper.get(selectedBubbleWrapper)?.position();
    };
    let chromeSyncFrame: number | null = null;
    let chromeSyncFramesRemaining = 0;
    const runChromeSyncFrame = () => {
      chromeSyncFrame = null;
      syncSelectedChrome();
      chromeSyncFramesRemaining = Math.max(0, chromeSyncFramesRemaining - 1);
      if (chromeSyncFramesRemaining > 0) {
        chromeSyncFrame = requestAnimationFrame(runChromeSyncFrame);
      }
    };
    const scheduleChromeSync = (frames = 1) => {
      chromeSyncFramesRemaining = Math.max(chromeSyncFramesRemaining, frames);
      if (chromeSyncFrame === null) chromeSyncFrame = requestAnimationFrame(runChromeSyncFrame);
    };

    const stageObserver = chromeRoot && typeof MutationObserver !== "undefined"
      ? new MutationObserver(() => scheduleChromeSync(12))
      : null;
    stageObserver?.observe(container, { attributes: true, attributeFilter: ["style", "class"] });

    const chromeResizeObserver = chromeRoot && typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => scheduleChromeSync(2))
      : null;
    if (chromeRoot && chromeResizeObserver) {
      chromeResizeObserver.observe(chromeRoot);
      chromeResizeObserver.observe(container);
    }

    const handleViewportChange = () => scheduleChromeSync(2);
    const handleDocumentPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && !target.closest('.translation-bubble-wrapper') && !target.closest('.action-handle') && !target.closest('[data-translation-editor]')) {
        setSelectedBubble(null);
      }
    };
    const handleDocumentKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") setSelectedBubble(null); };
    const detachDocumentListeners = () => {
      document.removeEventListener('pointerdown', handleDocumentPointerDown);
      document.removeEventListener('keydown', handleDocumentKeyDown);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
      stageObserver?.disconnect();
      chromeResizeObserver?.disconnect();
      if (chromeSyncFrame !== null) cancelAnimationFrame(chromeSyncFrame);
      chromeRoot?.querySelectorAll('[data-translation-chrome]').forEach((el) => el.remove());
    };
    document.addEventListener('pointerdown', handleDocumentPointerDown);
    document.addEventListener('keydown', handleDocumentKeyDown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    (tlContainer as unknown as { _cleanupListeners: () => void })._cleanupListeners = detachDocumentListeners;
    overlayCleanups.set(container, detachDocumentListeners);
    }

    container.appendChild(tlContainer);

    if (onComplete) {
      setTimeout(() => {
        const url = downloadTranslatedImage(viewMode, currentPage, "", true, container);
        if (viewMode === "offscreen") {
          tlContainer.querySelectorAll("canvas").forEach((cvs) => {
            cvs.width = 0;
            cvs.height = 0;
          });
        }
        if (url) onComplete(url);
      }, 100);
    }
  };

  document.fonts
    .load(`1em ${resolveCanvasFontFamily(textStyleRef?.current?.fontFamily)}`)
    .then(() => {
      if (img.complete && img.naturalWidth) paint();
      else img.onload = paint;
    });
};
