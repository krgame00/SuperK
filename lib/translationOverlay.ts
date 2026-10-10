import { undoManager } from "./undoManager";
import { constrainSourceLayoutHeight } from './sourceTextSpace';
import { calibrateOutputBodyMetric, resolveSourceFontSize, sourceRegionKey, manualSourceSizing, SOURCE_SIZE_POLICY, SOURCE_SIZE_FALLBACK_LABEL, type SourceSizing } from './sourceTextSize';
import { measureTextSelection, rotateLocalPoint, type SelectionRect } from "./textSelectionBounds";
import { guardQualityReview, unavailableReview, invalidateQualityReview, isReviewCurrent } from "./translation/qualityReview";
import type { TranslationReview } from "./translation/qualityReview";
import { inspectTargetText, formatOffendingCharacters } from "./languagePolicy";
import {
  applyBwContrastModeToBubble,
  cloneTextStyleProfile,
  measureFootprintBackgroundLuminance,
  recomputeAdaptiveReadableOnLayoutCommit,
  resolveBubbleTextStyle,
} from "./colorMatching/resolveTextStyle";
import { sampleBubbleRegion, sampleRectRegion } from "./colorMatching/canvasSampler";
import { extractTextColors } from "./colorMatching/sampleTextColors";
import {
  applyNearbyStyleFallbacks,
  inferTextStyleCategory,
} from "./colorMatching/nearbyStyleFallback";
import type { BwContrastMode, TextStyleProfile } from "./colorMatching/types";
import {
  layoutTextAtFixedFont,
  minimumWidthForWholeWords,
  segmentTextIntoWords,
  type FixedFontWidthResult,
} from "./textBoxWidthLayout";
import {
  detectBubbleCollisions,
  autoOrganizePageBubbles,
  isCorruptedAutoAdjustment,
} from "./bubbleLayoutOptimizer";

const ADJ_KEY = "superk:overlay-adjustments";
const WORD_WRAP_LOCALES: Record<string, string> = {
  thai: "th",
  ไทย: "th",
  english: "en",
  japanese: "ja",
  korean: "ko",
  chinese: "zh",
};

const wordWrapLocaleOf = (language?: string): string => {
  const normalized = language?.trim().toLowerCase();
  if (!normalized) return "th";
  return WORD_WRAP_LOCALES[normalized] ?? normalized;
};

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
  translationReview?: TranslationReview;
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
  /** Persisted original-pixel measurement, distinct from style and saved manual sizes. */
  sourceSizing?: SourceSizing;
  /** User-authorized layout space in original-image pixels, never inferred from an OCR box. */
  userTextSpace?: {owner:'manual';rect:{x:number;y:number;width:number;height:number};imageWidth:number;imageHeight:number};
  /** minimum frame height preserved by content-driven width reflow */
  manualMinHeightPx?: number;
  /** persisted interactive layout; source of truth for move/resize/rotation */
  layoutAdjustment?: OverlayAdjustment;
  /** bounded proportional layout of the last render; drives bitmap previews
   *  and exact re-renders for movement/rotation/undo/reopen */
  layoutSnapshot?: BubbleProportionalLayout;
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
  /** Flag indicating this adjustment was manually moved, resized, or adjusted by the user */
  userModified?: boolean;
  /** Flag indicating this adjustment was generated by the automated bubble layout optimizer */
  isAutoOptimized?: boolean;
  /** Schema version of the automated bubble layout optimizer that produced this adjustment */
  autoOptimizeVersion?: number;
  /** Bounded proportional layout snapshot captured from the last render. */
  layoutSnapshot?: BubbleProportionalLayout;
  /** Persisted text style profile (including bwContrastMode and manual overrides). */
  styleProfile?: TextStyleProfile;
}

/**
 * Bounded proportional snapshot of one rendered bubble layout: exact text and
 * canvas font identity, the wrapped lines with their float font/line size, and
 * the tight text-block geometry inside the frame. Corner drags rescale it for
 * bitmap previews and crisp releases; re-renders reuse it verbatim for
 * movement/rotation/Undo/Redo/reopen parity. Text, font, and width edits
 * invalidate it; movement and rotation do not.
 */
export interface BubbleProportionalLayout {
  /** Exact (script-normalized) translated text the lines were laid out for. */
  text: string;
  /** Canvas font family used when the lines were measured. */
  fontFamily: string;
  /** Rendered effective font size in frame pixels (float). */
  fontSizePx: number;
  /** Rendered line height in frame pixels (float). */
  lineHeightPx: number;
  /** Wrapped lines captured from the rendered layout. */
  lines: string[];
  /** Frame size the snapshot was captured at (source-image px). */
  frameWidthPx: number;
  frameHeightPx: number;
  /** Tight text-block bounds inside the frame (source-image px, unrotated). */
  selectionX: number;
  selectionY: number;
  selectionWidth: number;
  selectionHeight: number;
  /** Bubble/global font multipliers at capture time (identity check). */
  bubbleMult: number;
  globalMult: number;
  /** Whether the captured layout overflowed its frame. */
  overflow: boolean;
}

const LAYOUT_SNAPSHOT_MAX_LINES = 400;

const isUsableLayoutSnapshot = (
  snapshot: BubbleProportionalLayout | undefined,
  text: string,
  fontFamily: string,
): snapshot is BubbleProportionalLayout =>
  !!snapshot
  && snapshot.text === text
  && snapshot.fontFamily === fontFamily
  && Array.isArray(snapshot.lines)
  && snapshot.lines.length > 0
  && snapshot.lines.length <= LAYOUT_SNAPSHOT_MAX_LINES
  && [
    snapshot.fontSizePx,
    snapshot.lineHeightPx,
    snapshot.frameWidthPx,
    snapshot.frameHeightPx,
    snapshot.selectionX,
    snapshot.selectionY,
    snapshot.selectionWidth,
    snapshot.selectionHeight,
    snapshot.bubbleMult,
    snapshot.globalMult,
  ].every((value) => typeof value === "number" && Number.isFinite(value));

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

export const syncPageOverlayAdjustments = (pageKey: string, bubbles: TranslatedBubble[]): void => {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const storagePageKey = compactOverlayPageKey(pageKey);
    const all = readOverlayAdjustments();
    if (!all[storagePageKey]) all[storagePageKey] = {};
    for (const b of bubbles) {
      if (!b || b.deleted || !b.layoutAdjustment) continue;
      const bubbleId = bubbleKeyOf(b);
      all[storagePageKey][bubbleId] = { ...b.layoutAdjustment };
    }
    saveOverlayAdjustments(all);
  } catch {}
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

  try {
    const dataUrl = exportCanvas.toDataURL("image/jpeg", 0.9);
    exportCanvas.width = 0;
    exportCanvas.height = 0;
    if (returnDataUrl) return dataUrl;

    const link = document.createElement("a");
    link.download = defaultFilename;
    link.href = dataUrl;
    link.click();
    return dataUrl;
  } catch (err) {
    console.error("downloadTranslatedImage canvas export failed", err);
    exportCanvas.width = 0;
    exportCanvas.height = 0;
    return null;
  }
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
  locale = "th",
): BubbleTextFit {
  if (typeof targetFontSize === "number" && targetFontSize > 0) {
    const effectiveFs = Math.max(8, Math.round(targetFontSize * globalMultiplier * bubbleMultiplier));
    const layout = layoutBubbleAtFixedFont(
      text, width, effectiveFs, fontFamily, isOval, 0, height, locale,
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
    locale,
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
  locale = "th",
): { width: number; height: number } {
  const maxWidth = lockWidth ? baseWidth : Math.min(pageWidth, baseWidth * 1.4);
  const maxHeight = Math.min(pageHeight, baseHeight * 2.5);
  let width = baseWidth;
  let height = baseHeight;
  if (measureBubbleRenderFit(text, width, height, pageWidth, fontFamily, globalMultiplier, bubbleMultiplier, isOval, targetFontSize, locale).fits) {
    return { width, height };
  }
  for (let guard = 0; guard < 30; guard++) {
    const nextWidth = lockWidth ? width : Math.min(maxWidth, width * 1.12);
    const nextHeight = Math.min(maxHeight, height * 1.12);
    if (nextWidth <= width + 0.5 && nextHeight <= height + 0.5) break;
    width = nextWidth;
    height = nextHeight;
    if (measureBubbleRenderFit(text, width, height, pageWidth, fontFamily, globalMultiplier, bubbleMultiplier, isOval, targetFontSize, locale).fits) break;
  }
  return { width, height };
}

export const wrapTextForBubble = (
  text: string,
  maxW: number,
  maxH: number,
  fs: number,
  fontFamily: string = "sans-serif",
  isOval: boolean = true,
  locale: string = "th",
): string[] => {
  if (!text || !text.trim()) return [];

  const wds = segmentTextIntoWords(text, locale);

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
      if (/^\s+$/u.test(w)) {
        if (!cur) continue;
        if (measureFn(cur + w) > allowedW) {
          lines.push(cur.trimEnd());
          cur = "";
          lineIdx++;
          allowedW = getLineMaxW(lineIdx, tryLines);
        } else {
          cur += w;
        }
        continue;
      }

      const test = cur ? (cur + w) : w;
      if (measureFn(test) > allowedW && cur) {
        lines.push(cur.trimEnd());
        cur = "";
        lineIdx++;
        allowedW = getLineMaxW(lineIdx, tryLines);
      }

      cur = cur ? (cur + w) : w;
    }
    if (cur) lines.push(cur.trimEnd());

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

interface WidthLayoutPreview {
  layout: FixedFontWidthResult;
  text: string;
  widthPx: number;
  fontSizePx: number;
  fontFamily: string;
  isOval: boolean;
  manualMinHeightPx: number;
  availableHeightPx: number;
  locale: string;
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
  locale = "th",
): FixedFontWidthResult {
  const measureContext = getSharedMeasureCtx();
  if (measureContext) measureContext.font = `bold ${fontSizePx}px ${fontFamily}`;
  return layoutTextAtFixedFont({
    text,
    widthPx,
    fontSizePx,
    fontFamily,
    locale,
    manualMinHeightPx,
    availableHeightPx,
    isOval,
    measureText: measureContext
      ? (value) => measureContext.measureText(value).width
      : (value) => value.length * (fontSizePx * 0.6),
  });
}

function minimumBubbleWidthAtFixedFont(
  text: string,
  fontSizePx: number,
  fontFamily: string,
  isOval: boolean,
  locale: string,
): number {
  const measureContext = getSharedMeasureCtx();
  if (measureContext) measureContext.font = `bold ${fontSizePx}px ${fontFamily}`;
  return minimumWidthForWholeWords({
    text,
    fontSizePx,
    isOval,
    locale,
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
  locale = "th",
): BubbleTextFit {
  const safeW = width * 0.88;
  const safeH = height * 0.88;
  const maxFs = Math.max(minFontSize, Math.round(Math.min(height * 0.55, width * 0.55, 96) * fontSizeMultiplier));
  
  let bestFit: BubbleTextFit = {
    fontSize: minFontSize,
    lines: wrapTextForBubble(text, safeW, safeH, minFontSize, fontFamily, isOval, locale),
    lineHeight: minFontSize * 1.30,
    fits: false,
  };

  for (let fs = maxFs; fs >= minFontSize; fs--) {
    const lineH = fs * 1.30;
    const lines = wrapTextForBubble(text, safeW, safeH, fs, fontFamily, isOval, locale);
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
  locale = "th",
): AdaptiveBubbleLayout {
  let curW = width;
  let curH = height;
  const maxW = width * maxScale;
  const maxH = height * maxScale;

  let fit = fitTextForBubble(text, curW, curH, fontFamily, isOval, fontSizeMultiplier, minFontSize, locale);

  while ((curW < maxW || curH < maxH) && !fit.fits) {
    curW = Math.min(maxW, curW * 1.25);
    curH = Math.min(maxH, curH * 1.25);
    fit = fitTextForBubble(text, curW, curH, fontFamily, isOval, fontSizeMultiplier, minFontSize, locale);
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
  targetLanguage?: string,
) => {
  const wordWrapLocale = wordWrapLocaleOf(targetLanguage);
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
    if (onComplete) {
      setTimeout(() => {
        const url = downloadTranslatedImage(viewMode, currentPage, "", true, container);
        if (url) onComplete(url);
      }, 0);
    }
    return;
  }

  const paint = async (attempt = 0) => {
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
    let sourceFontLoaded = false;
    try {
      await document.fonts.load(`bold 16px ${resolvedFontFam}`);
      sourceFontLoaded = typeof document.fonts.check === 'function' && document.fonts.check(`bold 100px ${resolvedFontFam}`);
    } catch {
      // Font loading is best-effort; measurement falls back below.
    }
    if (isStaleOverlay()) return;
    if (!img.naturalWidth && !img.complete && attempt < 25) {
      img.addEventListener("load", () => void paint(attempt + 1), { once: true });
      setTimeout(() => paint(attempt + 1), 50);
      return;
    }
    const iw = img.naturalWidth || img.offsetWidth;
    const ih = img.naturalHeight || img.offsetHeight;
    if (!iw || !ih) {
      // Undecodable images never gain dimensions — retry briefly, then give
      // up instead of looping forever (callers re-render on the next change).
      if (attempt < 50) setTimeout(() => paint(attempt + 1), 100);
      return;
    }

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
    const cancelDragPreviews: Array<() => void> = [];

    let fallbackY2 = 10;

    let selectedBubbleWrapper: HTMLElement | null = null;
    const setSelectedBubble = (wrapper: HTMLElement | null) => {
      (chromeRoot ?? tlContainer).querySelectorAll<HTMLElement>("[data-bubble-more-menu]").forEach((menu) => {
        menu.style.display = "none";
      });
      if (selectedBubbleWrapper && selectedBubbleWrapper !== wrapper) {
        const oldFrame = selectedBubbleWrapper.querySelector<HTMLElement>(".bubble-text-selection");
        if (oldFrame) oldFrame.style.outline = "none";
        selectedBubbleWrapper.style.zIndex = "10";
        selectedBubbleWrapper.removeAttribute("data-selected");
        chromeControlsByWrapper.get(selectedBubbleWrapper)?.setVisible(false);
      }
      selectedBubbleWrapper = wrapper;
      if (!wrapper) return;

      const selectedFrame = wrapper.querySelector<HTMLElement>(".bubble-text-selection");
      if (selectedFrame) selectedFrame.style.outline = "1.5px dashed #3b82f6";
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

    // Auto-organize: detect and resolve any bubble collisions or unconstrained overlaps
    if (real.length > 0) {
      const hasCorrupted = real.some((b) => {
        const bKey = bubbleKeyOf(b);
        return (
          isCorruptedAutoAdjustment(b, iw, ih, b.layoutAdjustment) ||
          isCorruptedAutoAdjustment(b, iw, ih, savedAdj[bKey])
        );
      });
      if (hasCorrupted) {
        for (const b of real) {
          const bKey = bubbleKeyOf(b);
          if (b.layoutAdjustment && isCorruptedAutoAdjustment(b, iw, ih, b.layoutAdjustment)) {
            delete b.layoutAdjustment;
          }
          if (savedAdj[bKey] && isCorruptedAutoAdjustment(b, iw, ih, savedAdj[bKey])) {
            delete savedAdj[bKey];
          }
        }
      }
      const collisions = real.length > 1 ? detectBubbleCollisions(real, iw, ih) : [];
      if (collisions.length > 0 || hasCorrupted || viewMode === "offscreen") {
        const organized = autoOrganizePageBubbles(real, iw, ih, {
          fontFamily: resolvedFontFam,
          fontSizeMultiplier: currentTextStyle.fontSizeMultiplier || 1.0,
          locale: wordWrapLocale,
        });
        for (let i = 0; i < real.length; i++) {
          const opt = organized.optimizedBubbles[i];
          if (opt && opt.layoutAdjustment) {
            real[i].layoutAdjustment = opt.layoutAdjustment;
            real[i].targetFontSize = opt.targetFontSize;
          }
        }
        if (hasCorrupted) {
          syncPageOverlayAdjustments(pageKey, real);
        }
      }
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
      const rawLegacyAdj = savedAdj[bubbleId] ?? savedAdj[legacyBubbleId];
      const legacyAdj = rawLegacyAdj && !isCorruptedAutoAdjustment(b, iw, ih, rawLegacyAdj)
        ? rawLegacyAdj
        : undefined;
      if (b.layoutAdjustment && isCorruptedAutoAdjustment(b, iw, ih, b.layoutAdjustment)) {
        delete b.layoutAdjustment;
      }
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
      const persistedStyleProfile = adj?.styleProfile ?? legacyAdj?.styleProfile;
      if (
        persistedStyleProfile &&
        (persistedStyleProfile.bwContrastMode ||
          persistedStyleProfile.ownershipMode === "manual" ||
          persistedStyleProfile.source === "manual") &&
        !b.styleProfile?.bwContrastMode &&
        b.styleProfile?.ownershipMode !== "manual" &&
        b.styleProfile?.source !== "manual"
      ) {
        b.styleProfile = cloneTextStyleProfile(persistedStyleProfile);
      }

      const adjSx = adj?.isAutoOptimized && adj.iw > 0 ? iw / adj.iw : 1;
      const adjSy = adj?.isAutoOptimized && adj.ih > 0 ? ih / adj.ih : 1;
      let currentBx = adj ? adj.bx * adjSx : (rawX / 100) * iw - ((rawW / 100) * iw) / 2;
      let currentBy = adj ? adj.by * adjSy : (rawY / 100) * ih - ((rawH / 100) * ih) / 2;
      let currentBw = adj ? adj.bw * adjSx : (rawW / 100) * iw;
      let currentBh = adj ? adj.bh * adjSy : (rawH / 100) * ih;
      let currentRotation = adj?.rotation !== undefined ? adj.rotation : ((b.rotation as number) || 0);
      let manualMinHeightPx = typeof adj?.manualMinHeightPx === "number"
        && Number.isFinite(adj.manualMinHeightPx)
        ? Math.max(0, adj.manualMinHeightPx)
        : undefined;
      // The bubble object is the authoritative layout state; adopt a
      // proportional snapshot persisted in the legacy localStorage index so
      // reopen parity does not depend on the app-state round trip.
      if (!b.layoutSnapshot && !adj?.isAutoOptimized) {
        const persistedSnapshot = adj?.layoutSnapshot ?? legacyAdj?.layoutSnapshot;
        if (persistedSnapshot) b.layoutSnapshot = persistedSnapshot;
      }
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
          userModified: true,
          ...(typeof b.fontSizeMultiplier === "number" ? { fontSizeMultiplier: b.fontSizeMultiplier } : {}),
          ...(typeof b.targetFontSize === "number" ? { targetFontSize: b.targetFontSize } : {}),
          ...(typeof manualMinHeightPx === "number" ? { manualMinHeightPx } : {}),
          ...(b.layoutSnapshot ? { layoutSnapshot: b.layoutSnapshot } : {}),
          ...(b.styleProfile ? { styleProfile: cloneTextStyleProfile(b.styleProfile) } : {}),
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
      wrapper.style.cssText = `position:absolute; box-sizing:border-box; cursor:grab; pointer-events:none; touch-action:none; border-radius:4px; z-index:10; transform-origin:center center;`;
      
      const bCanvas = document.createElement("canvas");
      bCanvas.style.cssText = `display:block; width:100%; height:100%; pointer-events:none;`;
      wrapper.appendChild(bCanvas);
      const selectionFrame = document.createElement("div");
      selectionFrame.className = "bubble-text-selection";
      selectionFrame.style.cssText = `position:absolute; pointer-events:${viewMode === "offscreen" ? "none" : "auto"}; cursor:grab; touch-action:none; border-radius:4px;`;
      wrapper.appendChild(selectionFrame);
      let textSelection: SelectionRect = { x: 0, y: 0, width: currentBw, height: currentBh };
      let widthSelectionPreview = false;
      const visibleSelection = (): SelectionRect => widthSelectionPreview
        ? { x: 0, y: 0, width: currentBw, height: currentBh } : textSelection;
      const updateSelectionFrame = () => {
        const bounds = visibleSelection();
        selectionFrame.style.left = `${bounds.x / currentBw * 100}%`;
        selectionFrame.style.top = `${bounds.y / currentBh * 100}%`;
        selectionFrame.style.width = `${bounds.width / currentBw * 100}%`;
        selectionFrame.style.height = `${bounds.height / currentBh * 100}%`;
      };
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

      if (!adj && !(b.sourceSizing?.mode === 'auto' && b.sourceSizing.status === 'matched')) {
        const text = (b.t || b.translated || "").trim();
        if (text) {
          const adaptiveMinFs = Math.max(10, Math.round(minReadableFs * 0.75));
          const maxAdaptiveScale = viewMode === "offscreen" ? 1.25 : 1.5;
          const layout = fitTextInAdaptiveBubble(
            text,
            currentBw,
            currentBh,
            fontFam,
            !b.isInvalidBox,
            fontMult,
            adaptiveMinFs,
            maxAdaptiveScale,
            wordWrapLocale,
          );
          const origCx = currentBx + currentBw / 2;
          const origCy = currentBy + currentBh / 2;
          currentBw = layout.width;
          currentBh = layout.height;
          currentBx = Math.max(0, Math.min(iw - currentBw, origCx - currentBw / 2));
          currentBy = Math.max(0, Math.min(ih - currentBh, origCy - currentBh / 2));
        }
      }

      // Measure actual rendered footprint luminance on the live background image (`img`, which is the cleaned image)
      // so bubbles whose original English white halo was erased by inpainting get their true dark/gray background luminance.
      if (
        img &&
        (img.naturalWidth > 0 || img.width > 0) &&
        b.styleProfile &&
        (b.styleProfile.bwContrastMode === "auto" ||
          (b.styleProfile.ownershipMode !== "manual" &&
            b.styleProfile.source !== "manual" &&
            !b.styleProfile.bwContrastMode))
      ) {
        const footprintSample = sampleRectRegion(img, {
          x: currentBx,
          y: currentBy,
          width: currentBw,
          height: currentBh,
        });
        const footprint = measureFootprintBackgroundLuminance(footprintSample);
        if (footprint && footprint.isNonWhiteFootprint) {
          b.styleProfile = {
            ...b.styleProfile,
            backgroundLuminance: footprint.backgroundLuminance,
            backgroundLuminanceSamples: footprint.backgroundLuminanceSamples,
          };
        }
      }

      let renderedFontSize = 0;
      let textLayoutOverflow = false;
      let scriptNotice = "";
      // Moving/rotating changes placement only. Reuse the existing glyph bitmap.
      const updateBubbleFrame = () => {
        layoutOverflow = textLayoutOverflow || currentBx < 0 || currentBx + currentBw > iw ||
          currentBy < 0 || currentBy + currentBh > ih;
        wrapper.dataset.layoutOverflow = layoutOverflow ? "true" : "false";
        overflowNotice.hidden = !layoutOverflow;
        wrapper.title = [scriptNotice, layoutOverflow ? "ข้อความล้นพื้นที่หน้า กรุณาขยายพื้นที่หรือแก้ข้อความ" : ""].filter(Boolean).join('; ');
        wrapper.setAttribute("aria-label", [baseAriaLabel, scriptNotice, layoutOverflow ? "ข้อความล้นพื้นที่หน้า" : ""].filter(Boolean).join('; '));
        const sizingNotice = b.sourceSizing?.status === 'fallback' ? b.sourceSizing.fallbackLabel : b.sourceSizing?.readabilityWarning;
        if (b.sourceSizing) {
          wrapper.dataset.sourceSizingStatus = b.sourceSizing.status;
          wrapper.dataset.sourceSizingMode = b.sourceSizing.mode;
        }
        if (sizingNotice) {
          wrapper.title = [wrapper.title, sizingNotice].filter(Boolean).join('; ');
          wrapper.setAttribute('aria-label', `${wrapper.getAttribute('aria-label')}; ${sizingNotice}`);
        }
        wrapper.style.left = `${(currentBx / iw) * 100}%`;
        wrapper.style.top = `${(currentBy / ih) * 100}%`;
        wrapper.style.width = `${(currentBw / iw) * 100}%`;
        wrapper.style.height = `${(currentBh / ih) * 100}%`;
        wrapper.style.transform = currentRotation ? `rotate(${currentRotation.toFixed(1)}deg)` : "";
        updateSelectionFrame();
        chromeControlsByWrapper.get(wrapper)?.position();
      };
      const renderBubble = (
        availableHeight = Math.max(0, ih - currentBy),
        snapshotScale = 1,
        widthLayoutPreview?: WidthLayoutPreview,
      ) => {
        const currentStyle = textStyleRef?.current || ts;
        const rawText = b.t || b.translated || "";
        const scriptInspection = inspectTargetText(rawText, targetLanguage);
        const text = scriptInspection.status === "eligible" ? scriptInspection.normalizedText.trim() : scriptInspection.normalizedText;
        wrapper.dataset.scriptStatus = scriptInspection.status;
        scriptNotice = scriptInspection.status === "blocked"
          ? scriptInspection.reason === "excluded-script"
            ? `ซ่อนคำแปลที่ผิดอักษร: ${formatOffendingCharacters(scriptInspection.offendingCharacters)} — เปิดแก้ไขข้อความ`
            : "ยังไม่ยืนยันภาษาของหน้า — เปิดแก้ไขข้อความ"
          : scriptInspection.normalizedText !== rawText ? "แสดงตัวเลขในรูปแบบที่รองรับ โดยเก็บข้อความเดิมไว้" : "";
        wrapper.title = scriptNotice;
        wrapper.setAttribute("aria-label", [baseAriaLabel, scriptNotice].filter(Boolean).join("; "));
        const currentFontFam = resolveCanvasFontFamily(currentStyle.fontFamily);
        const isExplicitlyLaidOut = Boolean(
          b.layoutAdjustment?.isAutoOptimized
          || b.layoutAdjustment?.userModified
          || adj?.isAutoOptimized
          || adj?.userModified,
        );
        const autoSizing = !isExplicitlyLaidOut && b.sourceSizing?.mode === 'auto' ? b.sourceSizing : undefined;
        const discardDerivedSize = () => {
          if (b.targetFontSize === autoSizing?.baseFontSizePx) delete b.targetFontSize;
          if (adj && autoSizing?.baseFontSizePx !== undefined && adj.targetFontSize === autoSizing.baseFontSizePx) delete adj.targetFontSize;
          if (legacyAdj && autoSizing?.baseFontSizePx !== undefined && legacyAdj.targetFontSize === autoSizing.baseFontSizePx) delete legacyAdj.targetFontSize;
        };
        if (autoSizing) {
          const evidence = autoSizing.evidence;
          if (evidence.regionKey !== sourceRegionKey(b.box) || evidence.policyVersion !== SOURCE_SIZE_POLICY) {
            b.sourceSizing = { mode: 'auto', status: 'fallback',
              evidence: { ...evidence, quality: 'unreliable', confidence: 0, reason: 'stale-source-region-or-policy' },
              fallbackLabel: SOURCE_SIZE_FALLBACK_LABEL };
            discardDerivedSize();
          } else if (autoSizing.font?.family !== currentFontFam || autoSizing.font?.textKey !== text || !sourceFontLoaded) {
            const metricContext = bCanvas.getContext('2d');
            if (metricContext) {
              b.sourceSizing = { ...autoSizing, ...resolveSourceFontSize(evidence, calibrateOutputBodyMetric(metricContext, evidence, currentFontFam, text, sourceFontLoaded)) };
              if (b.sourceSizing.status === 'matched') b.targetFontSize = b.sourceSizing.baseFontSizePx;
              else discardDerivedSize();
            }
          }
        }
        const bubbleMult = typeof b.fontSizeMultiplier === "number" ? b.fontSizeMultiplier : 1.0;
        const globalMult = currentStyle.fontSizeMultiplier || 1.0;
        const rawLockedFs = typeof b.targetFontSize === "number" && Number.isFinite(b.targetFontSize) && b.targetFontSize > 0
          ? b.targetFontSize
          : (typeof adj?.targetFontSize === "number" && Number.isFinite(adj.targetFontSize) && adj.targetFontSize > 0
            ? adj.targetFontSize
            : undefined);
        const lockedFs = typeof rawLockedFs === "number" && adjSx !== 1
          ? Math.max(8, Math.round(rawLockedFs * adjSx))
          : rawLockedFs;
        let fixedLayout: FixedFontWidthResult | null = null;
        let legacyFit: BubbleTextFit | null = null;
        let snapshotFit: { layout: BubbleProportionalLayout; scale: number } | null = null;

        // A usable proportional snapshot replaces re-wrapping: movement,
        // rotation, Undo/Redo and reopening re-render the committed layout
        // exactly (float font size, same lines). A corner release passes an
        // explicit scale to rescale the captured layout crisply in one pass.
        // Matched-auto bubbles always keep the fresh constrained layout so
        // source-space evidence and neighbor caps govern every render.
        const isMatchedAuto = !isExplicitlyLaidOut && b.sourceSizing?.mode === "auto" && b.sourceSizing.status === "matched";
        if (text && !isMatchedAuto && isUsableLayoutSnapshot(b.layoutSnapshot, text, currentFontFam)) {
          if (snapshotScale !== 1) {
            snapshotFit = { layout: b.layoutSnapshot, scale: snapshotScale };
          } else if (
            b.layoutSnapshot.globalMult === globalMult
            && b.layoutSnapshot.bubbleMult === bubbleMult
            && Math.abs(currentBw - b.layoutSnapshot.frameWidthPx) < 0.5
            && Math.abs(currentBh - b.layoutSnapshot.frameHeightPx) < 0.5
          ) {
            snapshotFit = { layout: b.layoutSnapshot, scale: 1 };
          }
        }

        if (snapshotFit) {
          textLayoutOverflow = snapshotFit.layout.overflow === true;
        } else {
        if (text && typeof lockedFs === "number") {
          const matchedAuto = !isExplicitlyLaidOut && b.sourceSizing?.mode === 'auto' && b.sourceSizing.status === 'matched';
          const scaledFs = lockedFs * (currentStyle.fontSizeMultiplier || 1.0) * bubbleMult;
          const effectiveFs = matchedAuto ? scaledFs : Math.max(8, Math.round(scaledFs));
          const savedManualMinimum = manualMinHeightPx
            ?? adj?.manualMinHeightPx
            ?? (adj ? currentBh : 25);
          const canReuseWidthPreview = widthLayoutPreview
            && widthLayoutPreview.text === text
            && widthLayoutPreview.widthPx === currentBw
            && widthLayoutPreview.fontSizePx === effectiveFs
            && widthLayoutPreview.fontFamily === currentFontFam
            && widthLayoutPreview.isOval === !b.isInvalidBox
            && widthLayoutPreview.manualMinHeightPx === savedManualMinimum
            && widthLayoutPreview.availableHeightPx === availableHeight
            && widthLayoutPreview.locale === wordWrapLocale;
          fixedLayout = canReuseWidthPreview
            ? widthLayoutPreview.layout
            : layoutBubbleAtFixedFont(
                text,
                currentBw,
                effectiveFs,
                currentFontFam,
                !b.isInvalidBox,
                savedManualMinimum,
                availableHeight,
                wordWrapLocale,
              );
          if (matchedAuto) {
            const neighbors = real.filter(other => other !== b && !other.deleted).flatMap(other => {
              const layout = other.layoutAdjustment;
              if (!layout) return [];
              const sx = iw / layout.iw, sy = ih / layout.ih;
              const width = layout.bw * sx, height = layout.bh * sy;
              const radians = (layout.rotation || 0) * Math.PI / 180;
              const boundWidth = Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians));
              const boundHeight = Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians));
              return [{ x: layout.bx * sx + (width - boundWidth) / 2,
                y: layout.by * sy + (height - boundHeight) / 2, width: boundWidth, height: boundHeight }];
            });
            const space = b.sourceSizing?.space;
            const evidence = space && space.sourceRevision === b.sourceSizing?.evidence.sourceRevision &&
              space.regionKey === b.sourceSizing?.evidence.regionKey ? space : undefined;
            const constrained = constrainSourceLayoutHeight({x: currentBx, y: currentBy, width: currentBw, height: currentBh},
              Math.max(fixedLayout.requiredHeightPx, savedManualMinimum), evidence,
              b.userTextSpace && b.userTextSpace.imageWidth === iw && b.userTextSpace.imageHeight === ih ? b.userTextSpace.rect : undefined, neighbors);
            currentBh = constrained.height;
            fixedLayout = {...fixedLayout, heightPx: currentBh, overflow: fixedLayout.overflow || constrained.overflow};
          } else currentBh = fixedLayout.heightPx;
        } else {
          legacyFit = null;
        }

        // Frame floor: when the font has already reached its floor and the
        // text still cannot fit, grow the frame around its center instead of
        // letting the text overflow the bubble. Growth is anchored to the
        // last committed/fitting size (floorBase) so re-renders never
        // compound it, and it pauses entirely while a resize drag is live —
        // otherwise dragging smaller made the frame snap back and balloon.
        if (text && !resizeDragActive && !fixedLayout) {
          legacyFit = measureBubbleRenderFit(
            text, currentBw, currentBh, iw, currentFontFam,
            currentStyle.fontSizeMultiplier || 1.0, bubbleMult, !b.isInvalidBox,
            lockedFs,
            wordWrapLocale,
          );
          if (legacyFit.fits) {
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
              wordWrapLocale,
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
            legacyFit = measureBubbleRenderFit(
              text, currentBw, currentBh, iw, currentFontFam,
              currentStyle.fontSizeMultiplier || 1.0, bubbleMult, !b.isInvalidBox,
              lockedFs, wordWrapLocale,
            );
          }
        }

        if (text && !fixedLayout && !legacyFit) {
          legacyFit = measureBubbleRenderFit(
            text, currentBw, currentBh, iw, currentFontFam,
            currentStyle.fontSizeMultiplier || 1.0, bubbleMult, !b.isInvalidBox,
            lockedFs, wordWrapLocale,
          );
        }
        textLayoutOverflow = fixedLayout ? fixedLayout.overflow : Boolean(text && !legacyFit?.fits);
        }
        bCanvas.width = Math.round(currentBw);
        bCanvas.height = Math.round(currentBh);
        const ctx = bCanvas.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, currentBw, currentBh);
        if (!text || scriptInspection.status === "blocked") {
          textSelection = { x: 0, y: 0, width: currentBw, height: currentBh };
          // An empty frame has no proportional layout to reuse later.
          if (!text) delete b.layoutSnapshot;
          updateBubbleFrame();
          return;
        }
        const resolvedStyle = resolveBubbleTextStyle(b, currentStyle);
        const textColor = resolvedStyle.textColor;
        const outlineColor = resolvedStyle.textOutline;
        const opacity = resolvedStyle.opacity ?? 1.0;
        const fit = snapshotFit
          ? {
              fontSize: snapshotFit.layout.fontSizePx * snapshotFit.scale,
              lines: snapshotFit.layout.lines,
              lineHeight: snapshotFit.layout.lineHeightPx * snapshotFit.scale,
              fits: true,
            }
          : fixedLayout
          ? {
              fontSize: fixedLayout.fontSizePx,
              lines: fixedLayout.lines,
              lineHeight: fixedLayout.fontSizePx * 1.30,
              fits: !layoutOverflow,
            }
          : legacyFit ?? measureBubbleRenderFit(
              text,
              currentBw,
              currentBh,
              iw,
              currentFontFam,
              currentStyle.fontSizeMultiplier || 1.0,
              bubbleMult,
              !b.isInvalidBox,
              lockedFs,
              wordWrapLocale,
            );
        const fontSize = fit.fontSize;
        renderedFontSize = fontSize;
        const lines = fit.lines;
        const lineH = snapshotFit
          ? snapshotFit.layout.lineHeightPx * snapshotFit.scale
          : fixedLayout ? fontSize * 1.30 : Math.min(fontSize * 1.30, currentBh / Math.max(1, lines.length));

        ctx.globalAlpha = opacity;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `bold ${fontSize}px ${currentFontFam}`;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.miterLimit = 2;
        ctx.strokeStyle = outlineColor;
        ctx.lineWidth = resolvedStyle.hasOutline
          ? Math.max(resolvedStyle.outlineWidthRatio >= 0.18 ? 3.2 : 1, fontSize * resolvedStyle.outlineWidthRatio)
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
        // Overflow frames anchor the first line to the top padding so the
        // leading lines stay readable instead of symmetric clipping that can
        // hide both the first and last lines behind the frame edges.
        const startY = textLayoutOverflow
          ? lineH / 2
          : (currentBh / 2) - (totalH / 2);
        lines.forEach((l, i) => {
          const yPos = startY + i * lineH;
          if (resolvedStyle.hasOutline && ctx.lineWidth > 0) {
            ctx.strokeText(l, currentBw / 2, yPos);
          }
          ctx.fillStyle = fillPaint;
          ctx.fillText(l, currentBw / 2, yPos);
        });
        // Snapshot renders keep the captured selection (scaled for a corner
        // release) so the crisp redraw, reopening, and Undo/Redo all show the
        // exact previewed geometry; its padding is additive while scaling is
        // proportional, so re-measuring would shift the anchor between the
        // previewed and committed states. Fresh renders take the measurement.
        textSelection = snapshotFit
          ? { x: snapshotFit.layout.selectionX * snapshotFit.scale,
              y: snapshotFit.layout.selectionY * snapshotFit.scale,
              width: snapshotFit.layout.selectionWidth * snapshotFit.scale,
              height: snapshotFit.layout.selectionHeight * snapshotFit.scale }
          : measureTextSelection(ctx, lines, fontSize, lineH, currentBw, currentBh);
        // Capture the bounded proportional layout of this render so corner
        // drags preview with this bitmap and later re-renders (movement,
        // rotation, Undo/Redo, reopen) reproduce it exactly.
        if (lines.length > 0 && lines.length <= LAYOUT_SNAPSHOT_MAX_LINES) {
          b.layoutSnapshot = {
            text,
            fontFamily: currentFontFam,
            fontSizePx: fontSize,
            lineHeightPx: lineH,
            lines: [...lines],
            frameWidthPx: currentBw,
            frameHeightPx: currentBh,
            selectionX: textSelection.x,
            selectionY: textSelection.y,
            selectionWidth: textSelection.width,
            selectionHeight: textSelection.height,
            bubbleMult,
            globalMult,
            overflow: textLayoutOverflow,
          };
        }
        updateBubbleFrame();
      };

      b.render = renderBubble;

      if (viewMode !== "offscreen") {
        wrapper.addEventListener('mouseenter', () => { if (selectedBubbleWrapper !== wrapper) selectionFrame.style.outline = "1.5px dashed rgba(249,115,22,0.65)"; });
      wrapper.addEventListener('mouseleave', () => { if (selectedBubbleWrapper !== wrapper) selectionFrame.style.outline = "none"; });

      let isDragging = false;
      let dragStartX = 0, dragStartY = 0;
      let initialBx = 0, initialBy = 0;
      let initialBw = 0, initialBh = 0;
      let pendingMoveFrame: number | null = null;
      let pendingMovePointer: {clientX:number;clientY:number} | null = null;
      const cancelMovePreview = () => {
        if (pendingMoveFrame !== null) window.cancelAnimationFrame(pendingMoveFrame);
        pendingMoveFrame = null;
        pendingMovePointer = null;
      };
      cancelDragPreviews.push(cancelMovePreview);
      const applyMovePosition = (clientX:number,clientY:number) => {
        const rect = tlContainer.getBoundingClientRect();
        if (!(rect.width > 0 && rect.height > 0)) return;
        currentBx = initialBx + (clientX - dragStartX) * (iw / rect.width);
        currentBy = initialBy + (clientY - dragStartY) * (ih / rect.height);
        updateBubbleFrame();
      };

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
        initialBw = currentBw;
        initialBh = currentBh;
        try {
          wrapper.setPointerCapture(e.pointerId);
        } catch {
          // ignore
        }
      });

      wrapper.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        e.stopPropagation();
        pendingMovePointer = {clientX:e.clientX,clientY:e.clientY};
        if (pendingMoveFrame === null) pendingMoveFrame = window.requestAnimationFrame(() => {
          pendingMoveFrame = null;
          const latest = pendingMovePointer;
          pendingMovePointer = null;
          if (latest && isDragging && !isStaleOverlay()) applyMovePosition(latest.clientX,latest.clientY);
        });
      });

      wrapper.addEventListener('pointerup', (e) => {
        if (isDragging) {
          e.stopPropagation();
          cancelMovePreview();
          applyMovePosition(e.clientX,e.clientY);
          isDragging = false;
          try {
            wrapper.releasePointerCapture(e.pointerId);
          } catch {
            // ignore
          }
          // A selection click must leave legacy layout and adaptive styles untouched.
          if (currentBx === initialBx && currentBy === initialBy) return;
          // One final layout settles page-edge constraints for preview/export parity.
          renderBubble();
          saveAdjustment();
          if (currentBx !== initialBx || currentBy !== initialBy) {
            const finalBx = currentBx, finalBy = currentBy, finalBw = currentBw, finalBh = currentBh;
            const startBx = initialBx, startBy = initialBy, startBw = initialBw, startBh = initialBh;
            undoManager.push({
              label: "ย้ายตำแหน่งกล่องข้อความ",
              undo: () => {
                currentBx = startBx;
                currentBy = startBy;
                currentBw = startBw;
                currentBh = startBh;
                renderBubble();
                saveAdjustment();
              },
              redo: () => {
                currentBx = finalBx;
                currentBy = finalBy;
                currentBw = finalBw;
                currentBh = finalBh;
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
          cancelMovePreview();
          try {
            wrapper.releasePointerCapture(e.pointerId);
          } catch {
            // ignore
          }
          currentBx = initialBx;
          currentBy = initialBy;
          currentBw = initialBw;
          currentBh = initialBh;
          renderBubble();
          saveAdjustment();
        }
      });

      const openLiveEditor = () => {
        chromeControlsByWrapper.get(wrapper)?.setVisible(false);
        const editorHost = chromeRoot ?? tlContainer;
        editorHost.querySelectorAll("[data-translation-editor]").forEach((el) => el.remove());

        const openingText = b.t || b.translated || "";
        const openingReview = b.translationReview ? { ...b.translationReview } : undefined;
        const restoreReview = (review: TranslationReview | undefined) => {
          if (review) b.translationReview = { ...review };
          else delete b.translationReview;
        };
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
          invalidateQualityReview(b);
          const finalReview = b.translationReview ? { ...b.translationReview } : undefined;
          renderBubble();
          saveAdjustment();
          if (finalVal !== openingText || JSON.stringify(finalReview) !== JSON.stringify(openingReview)) {
            onBubblesMutated?.();
            undoManager.push({
              label: "แก้ไขข้อความ",
              undo: () => {
                b.t = openingText;
                b.translated = openingText;
                restoreReview(openingReview);
                renderBubble();
                saveAdjustment();
                onBubblesMutated?.();
              },
              redo: () => {
                b.t = finalVal;
                b.translated = finalVal;
                restoreReview(finalReview);
                renderBubble();
                saveAdjustment();
                onBubblesMutated?.();
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
          const discardedDraft = (b.t || b.translated || "") !== openingText ||
            JSON.stringify(b.translationReview) !== JSON.stringify(openingReview);
          b.t = openingText;
          b.translated = openingText;
          restoreReview(openingReview);
          renderBubble();
          if (discardedDraft) {
            saveAdjustment();
          }
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

        const reviewPanel = document.createElement("div");
        reviewPanel.style.cssText = "display:grid; gap:6px; color:#e4e4e7; font-size:13px; line-height:1.45; overflow-wrap:anywhere; max-height:240px; overflow-y:auto;";
        editor.insertBefore(reviewPanel, textarea);
        const source = document.createElement("div");
        source.setAttribute("data-review-source", "true");
        const reviewStatus = document.createElement("div");
        reviewStatus.setAttribute("role", "status");
        const suggestion = document.createElement("div");
        const reviewActions = document.createElement("div");
        reviewActions.style.cssText = "display:flex; flex-wrap:wrap; gap:6px;";
        reviewPanel.append(source, reviewStatus, suggestion, reviewActions);
        const reviewLabels: Record<TranslationReview["status"], string> = {
          ok: "ตรวจแล้ว", suggested: "มีคำแปลที่แนะนำ", needs_review: "ควรตรวจสอบคำแปล",
          accepted: "ใช้คำแปลที่แนะนำแล้ว", dismissed: "เก็บคำแปลปัจจุบันแล้ว",
          unavailable: "ยังตรวจสอบคำแปลไม่ได้", stale: "ข้อความเปลี่ยนแล้ว ต้องตรวจสอบใหม่",
        };
        const reviewAction = (name: string, label: string, onClick: () => void) => {
          const button = createEditorAction(label, label, onClick);
          button.setAttribute("data-review-action", name);
          button.style.width = "auto";
          button.style.padding = "0 8px";
          button.style.fontSize = "12px";
          reviewActions.appendChild(button);
          return button;
        };
        const displayedReview = () => {
          const text = b.t || b.translated || "";
          if (inspectTargetText(text, targetLanguage).status === "blocked") {
            return guardQualityReview(unavailableReview({id:"",sourceText:b.original_text ?? "",translatedText:text}),targetLanguage ?? "");
          }
          if (b.translationReview && isReviewCurrent(b)) return guardQualityReview(b.translationReview, targetLanguage ?? "");
          return b.translationReview;
        };
        const updateReviewPanel = () => {
          const review = displayedReview();
          reviewPanel.hidden = !review && !b.original_text;
          reviewPanel.style.display = reviewPanel.hidden ? "none" : "grid";
          source.textContent = b.original_text ? `ต้นฉบับ: ${b.original_text}` : "ไม่มีข้อความต้นฉบับ";
          reviewStatus.textContent = review ? `${reviewLabels[review.status]}${review.reason ? `: ${review.reason}` : ""}` : "";
          suggestion.textContent = review?.suggestion ? `คำแปลที่แนะนำ: ${review.suggestion}` : "";
          const current = isReviewCurrent(b) && review?.status !== "stale";
          acceptReview.hidden = !review?.suggestion;
          acceptReview.disabled = !current || review?.status !== "suggested";
          dismissReview.hidden = !review;
          dismissReview.disabled = !current || !["suggested", "needs_review", "unavailable"].includes(review?.status ?? "");
          restoreOriginal.hidden = review?.status !== "accepted" || review.originalTranslation === undefined;
          restoreOriginal.disabled = !current;
          for (const button of [acceptReview, dismissReview, restoreOriginal]) {
            button.style.display = button.hidden ? "none" : "flex";
            button.style.opacity = button.disabled ? "0.5" : "1";
            button.style.cursor = button.disabled ? "default" : "pointer";
          }
        };
        const checkReviewSnapshot = () => {
          invalidateQualityReview(b);
          updateReviewPanel();
          return isReviewCurrent(b) && b.translationReview?.status !== "stale";
        };
        const updateReviewText = (value: string) => {
          textarea.value = value;
          b.t = value;
          b.translated = value;
          renderBubble();
          updateReviewPanel();
          autoGrowEditor();
        };
        const acceptReview = reviewAction("accept", "ใช้คำแปลที่แนะนำ", () => {
          if (!checkReviewSnapshot()) return;
          const review = displayedReview();
          if (review?.status !== "suggested" || !review.suggestion) return;
          b.translationReview = { ...review, status: "accepted", reviewedText: review.suggestion, originalTranslation: review.originalTranslation ?? (b.t || b.translated || "") };
          updateReviewText(review.suggestion);
        });
        const dismissReview = reviewAction("dismiss", "เก็บคำแปลปัจจุบัน", () => {
          if (!checkReviewSnapshot()) return;
          const review = b.translationReview;
          if (!review || !["suggested", "needs_review", "unavailable"].includes(review.status)) return;
          b.translationReview = { ...review, status: "dismissed" };
          updateReviewPanel();
        });
        const restoreOriginal = reviewAction("restore", "คืนคำแปลก่อนหน้า", () => {
          if (!checkReviewSnapshot()) return;
          const review = b.translationReview;
          if (review?.status !== "accepted" || review.originalTranslation === undefined) return;
          b.translationReview = { ...review, status: "suggested", reviewedText: review.originalTranslation };
          updateReviewText(review.originalTranslation);
        });
        invalidateQualityReview(b);
        updateReviewPanel();

        const autoGrowEditor = () => {
          textarea.style.height = "auto";
          textarea.style.height = `${Math.min(160, Math.max(48, textarea.scrollHeight || 48))}px`;
          positionEditor();
        };

        textarea.addEventListener("input", () => {
          b.t = textarea.value;
          b.translated = textarea.value;
          invalidateQualityReview(b);
          updateReviewPanel();
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
        const snapshotBefore = b.layoutSnapshot;
        const sizingBefore = b.sourceSizing;
        b.sourceSizing = manualSourceSizing(b.sourceSizing,b.box);
        const sizingAfter = b.sourceSizing;
        b.fontSizeMultiplier = newMult;
        onBubblesMutated?.();
        renderBubble();
        const snapshotAfter = b.layoutSnapshot;
        saveAdjustment();
        undoManager.push({
          label: delta > 0 ? "เพิ่มขนาดข้อความ" : "ลดขนาดข้อความ",
          undo: () => {
            b.fontSizeMultiplier = oldMult;
            b.sourceSizing = sizingBefore;
            b.layoutSnapshot = snapshotBefore;
            renderBubble();
            saveAdjustment();
          },
          redo: () => {
            b.fontSizeMultiplier = newMult;
            b.sourceSizing = sizingAfter;
            b.layoutSnapshot = snapshotAfter;
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
          const initSnapshot = b.layoutSnapshot;

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
            const committedSnapshot = b.layoutSnapshot;
            saveAdjustment();
            const newBx = currentBx, newBy = currentBy, newBw = currentBw, newBh = currentBh;
            undoManager.push({
              label: e.altKey ? "ปรับขนาดกล่องข้อความ" : "ย้ายตำแหน่งกล่องข้อความ",
              undo: () => {
                currentBx = initBx; currentBy = initBy; currentBw = initBw; currentBh = initBh;
                b.layoutSnapshot = initSnapshot;
                renderBubble();
                saveAdjustment();
              },
              redo: () => {
                currentBx = newBx; currentBy = newBy; currentBw = newBw; currentBh = newBh;
                b.layoutSnapshot = committedSnapshot;
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
        let rInitRenderedFontSize = 0;
        let rInitTargetFs: number | undefined = undefined;
        let rDragTargetFs: number | undefined = undefined;
        let rInitManualMinHeightPx: number | undefined = undefined;
        let rMinimumWordWidth = 30;
        let widthDragDidMove = false;
        let handleDidMove = false;
        let lastAppliedPreviewPointer: { clientX: number; clientY: number } | null = null;
        let scaleAnchor = { x: 0, y: 0 };
        // Proportional layout captured once at corner pointerdown: the drawn
        // bitmap, wrapped lines, font and selection stay frozen for the whole
        // drag and are rescaled through CSS; only this snapshot is reused.
        let scaleDragSnapshot: { layout: BubbleProportionalLayout; selection: SelectionRect } | null = null;
        let rInitSnapshot: BubbleProportionalLayout | undefined = undefined;
        let rInitSizing: SourceSizing | undefined;
        let rInitUserSpace: TranslatedBubble['userTextSpace'];
        const pinScaleAnchor = () => {
          const point = rotateLocalPoint(textSelection.x, textSelection.y + textSelection.height,
            currentBw, currentBh, currentRotation);
          currentBx = scaleAnchor.x - point.x;
          currentBy = scaleAnchor.y - point.y;
        };

        const widthGeometryForDrag = (dx: number): { width: number; left: number } => {
          const requestedWidth = Math.max(30, rInitBw + dx);
          const minimumWidth = Math.max(30, rMinimumWordWidth);
          if (dx < 0 && minimumWidth > iw) {
            return { width: rInitBw, left: rInitBx };
          }
          if (dx < 0 && rInitBw < minimumWidth) {
            return { width: rInitBw, left: rInitBx };
          }
          if (dx < 0 && requestedWidth <= minimumWidth) {
            const width = Math.min(minimumWidth, iw);
            return {
              width,
              left: Math.max(0, Math.min(rInitBx, iw - width)),
            };
          }
          return { width: requestedWidth, left: rInitBx };
        };

        handle.addEventListener('pointerdown', (e) => {
          widthDragDidMove = false;
          handleDidMove = false;
          lastAppliedPreviewPointer = null;
          rStartX = e.clientX; rStartY = e.clientY;
          rInitBx = currentBx; rInitBy = currentBy;
          rDragInitBy = currentBy;
          rInitBw = currentBw; rInitBh = currentBh;
          rInitRot = currentRotation;
          rInitSnapshot = b.layoutSnapshot;
          rInitSizing = b.sourceSizing;
          rInitUserSpace = b.userTextSpace;
          // Corner drags freeze the rendered layout once, here: the drawn
          // canvas, lines, font and selection are reused for every preview
          // frame and rescaled proportionally on release.
          scaleDragSnapshot = id === 'scale' && b.layoutSnapshot
            ? { layout: b.layoutSnapshot, selection: { ...textSelection } }
            : null;
          const anchor = rotateLocalPoint(textSelection.x, textSelection.y + textSelection.height,
            currentBw, currentBh, currentRotation);
          scaleAnchor = { x: currentBx + anchor.x, y: currentBy + anchor.y };
          rInitFontMult = typeof b.fontSizeMultiplier === "number" ? b.fontSizeMultiplier : 1;
          rInitRenderedFontSize = (b.t || b.translated || '').trim() ? renderedFontSize : 0;
          rInitTargetFs = typeof b.targetFontSize === "number" && Number.isFinite(b.targetFontSize) && b.targetFontSize > 0
            ? b.targetFontSize
            : (typeof adj?.targetFontSize === "number" && Number.isFinite(adj.targetFontSize) && adj.targetFontSize > 0
              ? adj.targetFontSize
              : undefined);
          rDragTargetFs = rInitTargetFs;
          rInitManualMinHeightPx = manualMinHeightPx;
          resizeDragActive = id === 'width' || id === 'scale';
          widthSelectionPreview = id === 'width';
          updateBubbleFrame();

          if (id === 'scale' && rInitRenderedFontSize > 0) {
            const currentStyle = textStyleRef?.current || ts;
            rDragTargetFs = rInitRenderedFontSize / ((currentStyle.fontSizeMultiplier || 1) * rInitFontMult);
          }

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
            if (text) {
              const currentStyle = textStyleRef?.current || ts;
              const currentFontFam = resolveCanvasFontFamily(currentStyle.fontFamily);
              const bubbleMult = typeof b.fontSizeMultiplier === "number" ? b.fontSizeMultiplier : 1.0;
              const globalMult = currentStyle.fontSizeMultiplier || 1.0;
              if (typeof rInitTargetFs !== "number") {
                const prevFit = measureBubbleRenderFit(
                  text,
                  currentBw,
                  currentBh,
                  iw,
                  currentFontFam,
                  globalMult,
                  bubbleMult,
                  !b.isInvalidBox,
                  undefined,
                  wordWrapLocale,
                );
                const multiplier = bubbleMult * globalMult;
                rDragTargetFs = multiplier > 0 ? prevFit.fontSize / multiplier : prevFit.fontSize;
                b.targetFontSize = rDragTargetFs;
              }
              const targetFs = typeof b.targetFontSize === "number" ? b.targetFontSize : (rDragTargetFs || 16);
              const effectiveFs = Math.max(8, Math.round(targetFs * globalMult * bubbleMult));
              rMinimumWordWidth = Math.max(
                30,
                minimumBubbleWidthAtFixedFont(
                  text, effectiveFs, currentFontFam, !b.isInvalidBox, wordWrapLocale,
                ),
              );
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
          lastAppliedPreviewPointer = { clientX, clientY };
          const previousScale = { bx: currentBx, by: currentBy, bw: currentBw, bh: currentBh,
            font: b.fontSizeMultiplier, target: b.targetFontSize, minimum: manualMinHeightPx };
          let widthLayoutPreview: WidthLayoutPreview | undefined;
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
            const widthGeometry = widthGeometryForDrag(dx);
            currentBw = widthGeometry.width;
            currentBx = widthGeometry.left;
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
                wordWrapLocale,
              );
              widthLayoutPreview = {
                layout,
                text,
                widthPx: currentBw,
                fontSizePx: effectiveFs,
                fontFamily: currentFontFam,
                isOval: isOvalBox,
                manualMinHeightPx: manualMinHeightPx ?? 25,
                availableHeightPx: Math.max(0, ih - rDragInitBy),
                locale: wordWrapLocale,
              };
              currentBh = layout.heightPx;
              currentBy = rDragInitBy;
            }
          } else if (id === 'scale') {
            // Project onto the corner diagonal: one scale controls both axes
            // and the font, including horizontal-only or vertical-only drags.
            const angle = rInitRot * Math.PI / 180;
            const localDx = dx * Math.cos(angle) + dy * Math.sin(angle);
            const localDy = -dx * Math.sin(angle) + dy * Math.cos(angle);
            const requestedScale = 1 + (localDx*rInitBw-localDy*rInitBh)/(rInitBw*rInitBw+rInitBh*rInitBh);
            const minScale = Math.max(20/rInitBw,25/rInitBh,.4/rInitFontMult,
              rInitRenderedFontSize > 0 ? 8/rInitRenderedFontSize : 0);
            const scale = Math.max(minScale,Math.min(3/rInitFontMult,requestedScale));
            currentBw = rInitBw * scale;
            const newBh = rInitBh * scale;
            currentBy = rInitBy + (rInitBh - newBh);
            currentBh = newBh;
            b.fontSizeMultiplier = rInitFontMult * scale;
            if (Math.abs(scale-1) > .000001 && typeof rDragTargetFs === 'number') {
              b.targetFontSize = rDragTargetFs;
            }
            manualMinHeightPx = currentBh;
          } else if (id === 'move') {
            currentBx = rInitBx + dx;
            currentBy = rInitBy + dy;
          }
          if (id === "move" || id === "rotate") {
            updateBubbleFrame();
          } else if (id === "scale" && scaleDragSnapshot) {
            // Bitmap corner preview: scale the captured selection and rescale
            // the same canvas bitmap via proportional CSS sizing — zero
            // retypesetting, canvas resets or re-measuring during the drag.
            const previewScale = rInitBw > 0 ? currentBw / rInitBw : 1;
            const scaleSelection = (k: number): SelectionRect => {
              const captured = scaleDragSnapshot!.selection;
              return { x: captured.x * k, y: captured.y * k,
                width: captured.width * k, height: captured.height * k };
            };
            textSelection = scaleSelection(previewScale);
            // Resolve the anchor before page constraints. Keep the last valid
            // scale when growth would cross an edge, rather than clipping its
            // height differently on redo, reopening, or export.
            pinScaleAnchor();
            if (currentBx < 0 || currentBy < 0 || currentBx + currentBw > iw || currentBy + currentBh > ih) {
              currentBx = previousScale.bx; currentBy = previousScale.by;
              currentBw = previousScale.bw; currentBh = previousScale.bh;
              b.fontSizeMultiplier = previousScale.font; b.targetFontSize = previousScale.target;
              manualMinHeightPx = previousScale.minimum;
              textSelection = scaleSelection(rInitBw > 0 ? currentBw / rInitBw : 1);
            }
            updateBubbleFrame();
          } else {
            renderBubble(id === "scale" ? ih : undefined, 1, id === "width" ? widthLayoutPreview : undefined);
            if (id === "scale") {
              pinScaleAnchor();
              if (currentBx < 0 || currentBy < 0 || currentBx + currentBw > iw || currentBy + currentBh > ih) {
                currentBx = previousScale.bx; currentBy = previousScale.by;
                currentBw = previousScale.bw; currentBh = previousScale.bh;
                b.fontSizeMultiplier = previousScale.font; b.targetFontSize = previousScale.target;
                manualMinHeightPx = previousScale.minimum;
                renderBubble();
              } else {
                updateBubbleFrame();
              }
            }
          }
        };

        const cancelPendingWidthPreview = (): void => {
          if (pendingWidthPreviewFrame !== null) {
            window.cancelAnimationFrame(pendingWidthPreviewFrame);
            pendingWidthPreviewFrame = null;
          }
          pendingWidthPointer = null;
        };
        cancelDragPreviews.push(cancelPendingWidthPreview);

        const flushPendingWidthPreview = (pointer?: { pointerId: number; clientX: number; clientY: number }): void => {
          if (pendingWidthPreviewFrame !== null) {
            window.cancelAnimationFrame(pendingWidthPreviewFrame);
            pendingWidthPreviewFrame = null;
          }
          const latest = pointer ?? pendingWidthPointer;
          pendingWidthPointer = null;
          if (latest && handle.hasPointerCapture(latest.pointerId)
            && (latest.clientX !== lastAppliedPreviewPointer?.clientX || latest.clientY !== lastAppliedPreviewPointer?.clientY)) {
            applyPointerMove(latest.clientX, latest.clientY);
          }
        };

        handle.addEventListener('pointermove', (e) => {
          if (!handle.hasPointerCapture(e.pointerId)) return;
          if (e.clientX === rStartX && e.clientY === rStartY && !handleDidMove) return;
          handleDidMove = true;
          if (id === "width") {
            const rect = tlContainer.getBoundingClientRect();
            const dx = (e.clientX - rStartX) * (iw / rect.width);
            const widthGeometry = widthGeometryForDrag(dx);
            if (Math.abs(widthGeometry.width - rInitBw) < 0.001 && Math.abs(widthGeometry.left - rInitBx) < 0.001) return;
            widthDragDidMove = true;
          }
          pendingWidthPointer = { pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY };
          if (pendingWidthPreviewFrame === null) {
            pendingWidthPreviewFrame = window.requestAnimationFrame(() => {
              pendingWidthPreviewFrame = null;
              const latest = pendingWidthPointer;
              pendingWidthPointer = null;
              if (latest && !isStaleOverlay() && handle.hasPointerCapture(latest.pointerId)) {
                applyPointerMove(latest.clientX, latest.clientY);
              }
            });
          }
        });

        handle.addEventListener('pointerup', (e) => {
          e.stopPropagation();
          if (id === "width" ? widthDragDidMove : handleDidMove || e.clientX !== rStartX || e.clientY !== rStartY) {
            flushPendingWidthPreview({ pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY });
          }
          try {
            handle.releasePointerCapture(e.pointerId);
          } catch {
            // ignore
          }
          const unchangedScale = id === "scale"
            && Math.abs(currentBx - rInitBx) < .001 && Math.abs(currentBy - rInitBy) < .001
            && Math.abs(currentBw - rInitBw) < .001 && Math.abs(currentBh - rInitBh) < .001
            && (b.fontSizeMultiplier ?? 1) === rInitFontMult && b.targetFontSize === rInitTargetFs;
          if ((id === "width" && !widthDragDidMove) || unchangedScale) {
            resizeDragActive = false;
            widthSelectionPreview = false;
            currentBx = rInitBx;
            currentBy = rInitBy;
            currentBw = rInitBw;
            currentBh = rInitBh;
            currentRotation = rInitRot;
            b.targetFontSize = rInitTargetFs;
            manualMinHeightPx = rInitManualMinHeightPx;
            if (scaleDragSnapshot) textSelection = { ...scaleDragSnapshot.selection };
            scaleDragSnapshot = null;
            floorBase = { w: rInitBw, h: rInitBh };
            updateBubbleFrame();
            return;
          }
          const wasResizing = resizeDragActive;
          resizeDragActive = false;
          widthSelectionPreview = false;
          if (id === "scale") manualMinHeightPx = currentBh;
          // Re-apply the frame floor once, now that the drag has ended. A
          // corner drag redraws crisply in a single pass: the captured layout
          // is rescaled by the committed drag scale (same lines, float font).
          if (wasResizing || id === "move") {
            if (id === "scale" && scaleDragSnapshot && rInitBw > 0) {
              renderBubble(undefined, currentBw / rInitBw);
            } else if (id === "width") {
              // The latest width preview already drew the exact committed layout.
            } else {
              renderBubble();
            }
          }
          if (id === "scale") {
            pinScaleAnchor();
            updateBubbleFrame();
          }
          scaleDragSnapshot = null;
          saveAdjustment();

          if (id === 'scale' && Math.abs((b.fontSizeMultiplier ?? 1)-rInitFontMult) > .000001) b.sourceSizing = manualSourceSizing(b.sourceSizing,b.box);
          if (id === 'scale' || id === 'width') b.userTextSpace = {owner:'manual',rect:{x:currentBx,y:currentBy,width:currentBw,height:currentBh},imageWidth:iw,imageHeight:ih};
          const finalUserSpace = b.userTextSpace;
          const finalSizing = b.sourceSizing;
          const finalBx = currentBx, finalBy = currentBy, finalBw = currentBw, finalBh = currentBh, finalRot = currentRotation;
          const finalFontMult = typeof b.fontSizeMultiplier === "number" ? b.fontSizeMultiplier : 1.0;
          const finalTargetFs = b.targetFontSize;
          const finalManualMinHeight = manualMinHeightPx;
          const finalSnapshot = b.layoutSnapshot;
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
                b.sourceSizing = rInitSizing;
                b.userTextSpace = rInitUserSpace;
                b.targetFontSize = rInitTargetFs;
                manualMinHeightPx = rInitManualMinHeightPx;
                b.layoutSnapshot = rInitSnapshot;
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
                b.sourceSizing = finalSizing;
                b.userTextSpace = finalUserSpace;
                b.targetFontSize = finalTargetFs;
                manualMinHeightPx = finalManualMinHeight;
                b.layoutSnapshot = finalSnapshot;
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
          widthSelectionPreview = false;
          currentBx = rInitBx;
          currentBy = rInitBy;
          currentBw = rInitBw;
          currentBh = rInitBh;
          currentRotation = rInitRot;
          b.fontSizeMultiplier = rInitFontMult;
          b.targetFontSize = rInitTargetFs;
          manualMinHeightPx = rInitManualMinHeightPx;
          b.layoutSnapshot = rInitSnapshot;
          if (scaleDragSnapshot) textSelection = { ...scaleDragSnapshot.selection };
          scaleDragSnapshot = null;
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
            shadowBtn.setAttribute("aria-label", shadowLabel());
            shadowBtn.title = shadowLabel();
            onBubblesMutated?.();
            renderBubble();
            saveAdjustment();
          }
        }
      );

      const shadowLabel = () => {
        const profile = b.styleProfile;
        if (profile?.source === "manual" || profile?.ownershipMode === "manual" ||
            profile?.ownershipMode === "source_faithful") {
          return resolveBubbleTextStyle(b, textStyleRef?.current || ts).shadow ? "เงา: มาตรฐาน" : "เงา: ปิด";
        }
        return resolveBubbleTextStyle(b, textStyleRef?.current || ts).shadow ? "เงา: Auto (บาง)" : "เงา: Auto (ปิด)";
      };
      const shadowBtn = createToolBtn(
        shadowLabel(),
        `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="6"/><path d="M14 14l6 6"/><path d="M15 7a6 6 0 0 1 2 8"/></svg>`,
        () => {
          const existing = b.styleProfile;
          const resolved = resolveBubbleTextStyle(b, textStyleRef?.current || ts);
          const nextMode = resolved.shadow ? "off" : "standard";
          const alreadyManual = existing?.source === "manual" || existing?.ownershipMode === "manual";
          b.styleProfile = {
            ...(existing ?? {}),
            fill: alreadyManual ? existing!.fill : resolved.textColor,
            outline: alreadyManual ? existing!.outline : resolved.textOutline,
            hasOutline: alreadyManual ? existing!.hasOutline : resolved.hasOutline,
            outlineWidth: alreadyManual ? existing!.outlineWidth : resolved.outlineWidth,
            outlineWidthRatio: alreadyManual ? existing!.outlineWidthRatio : resolved.outlineWidthRatio,
            fillGradient: alreadyManual ? existing!.fillGradient : resolved.fillGradient,
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
          applyNearbyStyleFallbacks(real);
          shadowBtn.setAttribute("aria-label", shadowLabel());
          shadowBtn.title = shadowLabel();
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

      const bwContrastLabel = () => {
        const mode = b.styleProfile?.bwContrastMode;
        if (mode === "black_on_white") return "โหมดขาว-ดำ: ดำ-ขาว (ตัวดำ ขอบขาวหนา)";
        if (mode === "white_on_black") return "โหมดขาว-ดำ: ขาว-ดำ (ตัวขาว ขอบดำหนา)";
        if (mode === "pure_black") return "โหมดขาว-ดำ: ดำล้วน";
        if (mode === "auto") return "โหมดขาว-ดำ: ออโต้";
        return "สลับโหมดสี ขาว-ดำ / ดำ-ขาว";
      };

      const bwContrastBtn = createToolBtn(
        bwContrastLabel(),
        `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/></svg>`,
        () => {
          const currentMode = b.styleProfile?.bwContrastMode;
          const nextMode: BwContrastMode =
            currentMode === "black_on_white"
              ? "white_on_black"
              : currentMode === "white_on_black"
                ? "pure_black"
                : currentMode === "pure_black"
                  ? "auto"
                  : "black_on_white";
          const prevProfile = cloneTextStyleProfile(b.styleProfile);
          const updated = applyBwContrastModeToBubble(b, nextMode);
          b.styleProfile = updated.styleProfile;
          bwContrastBtn.setAttribute("aria-label", bwContrastLabel());
          bwContrastBtn.title = bwContrastLabel();
          shadowBtn.setAttribute("aria-label", shadowLabel());
          shadowBtn.title = shadowLabel();
          onBubblesMutated?.();
          renderBubble();
          saveAdjustment();
          const nextProfile = cloneTextStyleProfile(b.styleProfile);
          undoManager.push({
            label: `สลับโหมดขาว-ดำ (${nextMode})`,
            undo: () => {
              b.styleProfile = cloneTextStyleProfile(prevProfile);
              bwContrastBtn.setAttribute("aria-label", bwContrastLabel());
              bwContrastBtn.title = bwContrastLabel();
              shadowBtn.setAttribute("aria-label", shadowLabel());
              shadowBtn.title = shadowLabel();
              renderBubble();
              saveAdjustment();
            },
            redo: () => {
              b.styleProfile = cloneTextStyleProfile(nextProfile);
              bwContrastBtn.setAttribute("aria-label", bwContrastLabel());
              bwContrastBtn.title = bwContrastLabel();
              shadowBtn.setAttribute("aria-label", shadowLabel());
              shadowBtn.title = shadowLabel();
              renderBubble();
              saveAdjustment();
            },
          });
        },
      );

      const moreMenu = document.createElement("div");
      moreMenu.setAttribute("data-bubble-more-menu", "true");
      moreMenu.style.cssText = `position:absolute; top:calc(100% + 8px); right:0; display:none; align-items:center; gap:2px; padding:5px; background:rgba(24,24,27,0.98); border:1px solid rgba(255,255,255,0.2); border-radius:10px; box-shadow:0 10px 28px rgba(0,0,0,0.5); z-index:45;`;
      moreMenu.appendChild(decreaseFontBtn);
      moreMenu.appendChild(increaseFontBtn);
      moreMenu.appendChild(shadowBtn);
      moreMenu.appendChild(originalStyleBtn);
      moreMenu.appendChild(fillBtn);
      moreMenu.appendChild(layerBtn);
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
      toolbar.appendChild(bwContrastBtn);
      toolbar.appendChild(moreBtn);
      toolbar.appendChild(createDivider());
      toolbar.appendChild(deleteBtn);
      toolbar.appendChild(moreMenu);
      (chromeRoot ?? wrapper).appendChild(toolbar);

      const positionChromeControls = () => {
        if (wrapper.style.display === "none") return;
        const selection = visibleSelection();
        const localPoints: Record<string, [number, number]> = {
          nw: [selection.x, selection.y],
          ne: [selection.x + selection.width, selection.y],
          e: [selection.x + selection.width, selection.y + selection.height / 2],
          sw: [selection.x, selection.y + selection.height],
        };

        if (!chromeRoot) {
          chromeHandles.forEach((handle) => {
            const [left, top] = localPoints[handle.dataset.handlePosition ?? "nw"];
            handle.style.left = `${left / currentBw * 100}%`;
            handle.style.top = `${top / currentBh * 100}%`;
          });
          const wrapperChromeScale = Math.max(
            0.6,
            Math.min(1, wrapper.offsetWidth / 220, wrapper.offsetHeight / 100),
          );
          toolbar.style.zoom = String(wrapperChromeScale);
          chromeHandles.forEach((handle) => {
            handle.style.zoom = String(wrapperChromeScale);
          });
          toolbar.style.left = `${(selection.x + selection.width / 2) / currentBw * 100}%`;
          toolbar.style.top = `calc(${selection.y / currentBh * 100}% - 10px)`;
          toolbar.style.transform = "translate(-50%, -100%)";
          activeEditorPosition?.();
          return;
        }

        const rootRect = chromeRoot.getBoundingClientRect();
        const stageRect = tlContainer.getBoundingClientRect();
        // The normal path derives rotated page bounds from the stage rect
        // alone; the per-bubble wrapper rect is read lazily only when the
        // stage has no measurable dimensions yet.
        const stageReady = stageRect.width > 0 && stageRect.height > 0;
        const bubbleRect = stageReady ? null : wrapper.getBoundingClientRect();
        const scaleX = stageRect.width > 0 ? stageRect.width / iw : (bubbleRect ? bubbleRect.width : 0) / currentBw;
        const scaleY = stageRect.height > 0 ? stageRect.height / ih : (bubbleRect ? bubbleRect.height : 0) / currentBh;
        const originX = stageRect.width > 0 ? stageRect.left + currentBx * scaleX : (bubbleRect ? bubbleRect.left : 0);
        const originY = stageRect.height > 0 ? stageRect.top + currentBy * scaleY : (bubbleRect ? bubbleRect.top : 0);
        const pointInChrome = (x: number, y: number) => {
          const point = rotateLocalPoint(x, y, currentBw, currentBh, currentRotation);
          return { x: originX - rootRect.left + point.x * scaleX, y: originY - rootRect.top + point.y * scaleY };
        };
        const corners = [localPoints.nw, localPoints.ne, localPoints.sw,
          [selection.x + selection.width, selection.y + selection.height]];
        const points = corners.map(([x, y]) => pointInChrome(x, y));
        const left = Math.min(...points.map(point => point.x));
        const top = Math.min(...points.map(point => point.y));
        const right = Math.max(...points.map(point => point.x));
        const bottom = Math.max(...points.map(point => point.y));
        const centerX = (left + right) / 2;

        // Chrome (toolbar + handles) must not dwarf small bubbles: shrink it
        // as the bubble shrinks, floored so buttons stay grabbable. `zoom`
        // keeps the translate(-50%, …) anchors intact while scaling the whole
        // rendered chrome — but it also multiplies the element's own left/top
        // lengths, so every offset written below is pre-divided by the scale
        // to stay anchored on the bubble.
        const chromeScale = Math.max(
          0.6,
          Math.min(1, (right - left) / 220, (bottom - top) / 100),
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
          const local = localPoints[handle.dataset.handlePosition ?? "nw"];
          const { x, y } = pointInChrome(...local);
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
      for (const cancelPreview of cancelDragPreviews) cancelPreview();
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

  const paintWhenReady = () => {
    if (img.complete && img.naturalWidth) paint();
    else img.onload = () => paint();
  };
  document.fonts
    .load(`1em ${resolveCanvasFontFamily(textStyleRef?.current?.fontFamily)}`)
    .then(paintWhenReady)
    .catch(paintWhenReady);
};

export {
  detectBubbleCollisions,
  autoOrganizePageBubbles,
  autoOrganizeAllPagesBubbles,
  fitBubbleTextWithinBounds,
  resolveBubbleCollisions,
} from "./bubbleLayoutOptimizer";

