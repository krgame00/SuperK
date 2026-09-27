import {
  bubbleKeyOf,
  fitTextInAdaptiveBubble,
  getReadableMinimumFontSize,
  measureTextLinesWidth,
  measureBubbleRenderFit,
  readPageOverlayAdjustments,
  resolveCanvasFontFamily,
  type OverlayAdjustment,
  type OverlayTextStyle,
  type TranslatedBubble,
} from "@/lib/translationOverlay";
import { resolveBubbleTextStyle } from "@/lib/colorMatching/resolveTextStyle";
import { sampleRectRegion } from "@/lib/colorMatching/canvasSampler";
import { evaluateLocalContrast } from "./readabilityColor";

export type ReadabilityFindingKind = "overflow" | "small-text" | "color" | "color-unavailable";

export interface ReadabilityFinding {
  pageUrl: string;
  pageIndex: number;
  bubbleId: string;
  kind: ReadabilityFindingKind;
  text: string;
  fontSize?: number;
  threshold?: number;
}

export interface PageGeometryInput {
  pageUrl: string;
  pageIndex: number;
  width: number;
  height: number;
  bubbles: TranslatedBubble[];
  textStyle?: OverlayTextStyle;
  adjustments?: Record<string, OverlayAdjustment>;
  backgroundUrl?: string;
}

interface MeasuredBubble {
  bubble: TranslatedBubble;
  bubbleId: string;
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  lines: string[];
  fontSize: number;
  lineHeight: number;
}

export interface PageGeometryResult {
  findings: ReadabilityFinding[];
  unavailableReason?: string;
  measurements?: MeasuredBubble[];
}

export function assessPageGeometry(input: PageGeometryInput): PageGeometryResult {
  const findings: ReadabilityFinding[] = [];
  const measurements: MeasuredBubble[] = [];
  const { width, height, textStyle = {}, adjustments = {} } = input;
  if (!(width > 0 && height > 0)) return { findings, unavailableReason: "ไม่ทราบขนาดภาพ" };
  const fontFamily = resolveCanvasFontFamily(textStyle.fontFamily);
  const globalMultiplier = textStyle.fontSizeMultiplier || 1;
  const threshold = getReadableMinimumFontSize(width) * 0.75;
  for (const bubble of input.bubbles) {
    const text = (bubble.t || bubble.translated || "").trim();
    if (bubble.deleted || !text) continue;
    const bubbleId = bubbleKeyOf(bubble);
    const adjustment = bubble.layoutAdjustment ?? adjustments[bubbleId];
    const box = bubble.box;
    const validBox = Array.isArray(box) && box.length === 4 && box.every((value) => Number.isFinite(value))
      && !(box[0] === 0 && box[1] === 0 && box[2] === 1000 && box[3] === 1000);
    const boxWidth = validBox ? Math.max(4, (box![3] - box![1]) / 10) * width / 100 : width * 0.3;
    const boxHeight = validBox ? Math.max(2, (box![2] - box![0]) / 10) * height / 100 : height * 0.15;
    const centerX = validBox ? ((box![1] + box![3]) / 2000) * width : width / 2;
    const centerY = validBox ? ((box![0] + box![2]) / 2000) * height : height / 2;
    let drawingWidth = adjustment?.bw ?? boxWidth;
    let drawingHeight = adjustment?.bh ?? boxHeight;
    let left = adjustment?.bx ?? centerX - drawingWidth / 2;
    let top = adjustment?.by ?? centerY - drawingHeight / 2;
    if (!adjustment) {
      const adaptive = fitTextInAdaptiveBubble(
        text, drawingWidth, drawingHeight, fontFamily,
        !bubble.isInvalidBox && validBox, globalMultiplier,
        Math.max(14, getReadableMinimumFontSize(width)), 3,
      );
      drawingWidth = adaptive.width;
      drawingHeight = adaptive.height;
      left = Math.max(0, Math.min(width - drawingWidth, centerX - drawingWidth / 2));
      top = Math.max(0, Math.min(height - drawingHeight, centerY - drawingHeight / 2));
    }
    const bubbleMultiplier = typeof bubble.fontSizeMultiplier === "number" ? bubble.fontSizeMultiplier : 1;
    const fit = measureBubbleRenderFit(
      text, drawingWidth, drawingHeight, width, fontFamily,
      globalMultiplier, bubbleMultiplier, !bubble.isInvalidBox && validBox,
    );
    const base = { pageUrl: input.pageUrl, pageIndex: input.pageIndex, bubbleId, text };
    measurements.push({ bubble, bubbleId, text, left, top, width: drawingWidth, height: drawingHeight,
      lines: fit.lines, fontSize: fit.fontSize,
      lineHeight: Math.min(fit.fontSize * 1.30, drawingHeight / Math.max(1, fit.lines.length)) });
    if (!fit.fits) findings.push({ ...base, kind: "overflow", fontSize: fit.fontSize });
    if (fit.fontSize < threshold) findings.push({ ...base, kind: "small-text", fontSize: fit.fontSize, threshold });
  }
  return { findings, measurements };
}

async function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    const timeout = window.setTimeout(() => resolve(null), 5000);
    image.onload = () => { window.clearTimeout(timeout); resolve(image); };
    image.onerror = () => { window.clearTimeout(timeout); resolve(null); };
    image.src = url;
  });
}

export async function scanPageGeometry(input: Omit<PageGeometryInput, "width" | "height" | "adjustments">): Promise<PageGeometryResult> {
  if (!input.bubbles.some((bubble) => !bubble.deleted && (bubble.t || bubble.translated || "").trim())) {
    return { findings: [] };
  }
  const sourceImage = await loadImage(input.pageUrl);
  const width = sourceImage?.naturalWidth ?? 0;
  const height = sourceImage?.naturalHeight ?? 0;
  if (document.fonts?.load) {
    try {
      const fontFamily = resolveCanvasFontFamily(input.textStyle?.fontFamily);
      await document.fonts.load(`bold 16px ${fontFamily}`);
    } catch {
      return { findings: [], unavailableReason: "โหลดฟอนต์สำหรับตรวจการจัดข้อความไม่ได้" };
    }
  }
  const result = assessPageGeometry({
    ...input, width, height,
    adjustments: readPageOverlayAdjustments(input.pageUrl),
  });
  if (result.unavailableReason || !result.measurements?.length) return result;
  const backgroundImage = !input.backgroundUrl || input.backgroundUrl === input.pageUrl
    ? sourceImage : await loadImage(input.backgroundUrl);
  if (!backgroundImage) return { ...result, unavailableReason: "ตรวจสีไม่ได้: โหลดภาพพื้นหลังไม่สำเร็จ" };
  const fontFamily = resolveCanvasFontFamily(input.textStyle?.fontFamily);
  for (const measurement of result.measurements) {
    const style = resolveBubbleTextStyle(measurement.bubble, input.textStyle);
    const base = { pageUrl: input.pageUrl, pageIndex: input.pageIndex,
      bubbleId: measurement.bubbleId, text: measurement.text };
    if (style.fillGradient) {
      result.findings.push({ ...base, kind: "color-unavailable" });
      continue;
    }
    const pixels: number[] = [];
    const startY = measurement.top + measurement.height / 2
      - ((measurement.lines.length - 1) * measurement.lineHeight) / 2;
    measurement.lines.forEach((line, index) => {
      const textWidth = measureTextLinesWidth([line], measurement.fontSize, fontFamily);
      const sample = sampleRectRegion(backgroundImage, {
        x: measurement.left + (measurement.width - textWidth) / 2,
        y: startY + index * measurement.lineHeight - measurement.fontSize * 0.6,
        width: textWidth,
        height: measurement.fontSize * 1.2,
      });
      if (!sample) return;
      const count = sample.width * sample.height;
      const step = Math.max(1, Math.floor(count / 256));
      for (let pixel = 0; pixel < count; pixel += step) {
        const offset = pixel * 4;
        pixels.push(...sample.rgba.slice(offset, offset + 4));
      }
    });
    const colorResult = evaluateLocalContrast(pixels.length >= 16
      ? { width: pixels.length / 4, height: 1, rgba: new Uint8ClampedArray(pixels) } : null,
    {
      fill: style.textColor,
      outline: style.hasOutline ? style.textOutline : undefined,
      outlineRatio: style.hasOutline ? style.outlineWidthRatio : 0,
      opacity: style.opacity,
      plate: style.backgroundPlate,
      shadow: style.shadow,
    });
    if (colorResult.state === "warning") result.findings.push({ ...base, kind: "color" });
    if (colorResult.state === "unavailable") result.findings.push({ ...base, kind: "color-unavailable" });
  }
  return result;
}
