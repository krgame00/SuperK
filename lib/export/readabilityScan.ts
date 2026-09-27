import {
  bubbleKeyOf,
  fitTextInAdaptiveBubble,
  getReadableMinimumFontSize,
  growBubbleFrameToFit,
  measureBubbleRenderFit,
  readPageOverlayAdjustments,
  resolveCanvasFontFamily,
  type OverlayAdjustment,
  type OverlayTextStyle,
  type TranslatedBubble,
} from "@/lib/translationOverlay";
import { resolveBubbleTextStyle } from "@/lib/colorMatching/resolveTextStyle";
import { evaluateLocalContrast } from "./readabilityColor";
import { sampleGlyphBackground } from "./readabilityGlyphSampler";

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
  rotation: number;
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
  let fallbackY = 10;
  for (const bubble of input.bubbles) {
    const text = (bubble.t || bubble.translated || "").trim();
    if (bubble.deleted || !text) continue;
    const bubbleId = bubbleKeyOf(bubble);
    const box = bubble.box;
    const validBox = Array.isArray(box) && box.length === 4 && box.every((value) => Number.isFinite(value))
      && !(box[0] === 0 && box[1] === 0 && box[2] === 1000 && box[3] === 1000);
    const invalidBox = Array.isArray(box) && box.length === 4
      && box[0] === 0 && box[1] === 0 && box[2] === 1000 && box[3] === 1000;
    let rawX = validBox ? (box![1] + box![3]) / 20 : 50;
    let rawY = validBox ? (box![0] + box![2]) / 20 : 50;
    let rawW = validBox ? Math.max(4, (box![3] - box![1]) / 10) : 20;
    let rawH = validBox ? Math.max(2, (box![2] - box![0]) / 10) : 10;
    if (invalidBox) {
      rawX = 50; rawY = fallbackY; rawW = 30; rawH = 15;
      fallbackY = fallbackY + 15 > 85 ? 8 : fallbackY + 12;
    }
    const legacyId = bubble.id !== undefined
      ? `id-${bubble.id}`
      : `text-${(bubble.t || bubble.translated || "").slice(0, 10)}-${rawX.toFixed(1)}-${rawY.toFixed(1)}`;
    const legacyAdjustment = adjustments[bubbleId] ?? adjustments[legacyId];
    const adjustment = bubble.layoutAdjustment ?? legacyAdjustment;
    const boxWidth = rawW / 100 * width;
    const boxHeight = rawH / 100 * height;
    const centerX = rawX / 100 * width;
    const centerY = rawY / 100 * height;
    let drawingWidth = adjustment?.bw ?? boxWidth;
    let drawingHeight = adjustment?.bh ?? boxHeight;
    let left = adjustment?.bx ?? centerX - drawingWidth / 2;
    let top = adjustment?.by ?? centerY - drawingHeight / 2;
    if (!adjustment) {
      const adaptive = fitTextInAdaptiveBubble(
        text, drawingWidth, drawingHeight, fontFamily,
        !bubble.isInvalidBox && !invalidBox, globalMultiplier,
        Math.max(14, getReadableMinimumFontSize(width)), 3,
      );
      drawingWidth = adaptive.width;
      drawingHeight = adaptive.height;
      left = Math.max(0, Math.min(width - drawingWidth, centerX - drawingWidth / 2));
      top = Math.max(0, Math.min(height - drawingHeight, centerY - drawingHeight / 2));
    }
    const bubbleMultiplier = typeof bubble.fontSizeMultiplier === "number" ? bubble.fontSizeMultiplier
      : legacyAdjustment?.fontSizeMultiplier ?? 1;
    const targetFs = bubble.targetFontSize ?? adjustment?.targetFontSize;
    const lockWidth = Boolean(adjustment || targetFs);
    const grown = growBubbleFrameToFit(
      text, drawingWidth, drawingHeight, width, height, fontFamily,
      globalMultiplier, bubbleMultiplier, !bubble.isInvalidBox && !invalidBox,
      lockWidth,
      targetFs,
    );
    if (!lockWidth) {
      const growthCenterX = left + drawingWidth / 2;
      const growthCenterY = top + drawingHeight / 2;
      left = Math.max(0, Math.min(width - grown.width, growthCenterX - grown.width / 2));
      top = Math.max(0, Math.min(height - grown.height, growthCenterY - grown.height / 2));
    }
    drawingWidth = grown.width;
    drawingHeight = grown.height;
    const fit = measureBubbleRenderFit(
      text, drawingWidth, drawingHeight, width, fontFamily,
      globalMultiplier, bubbleMultiplier, !bubble.isInvalidBox && !invalidBox,
      targetFs,
    );
    const base = { pageUrl: input.pageUrl, pageIndex: input.pageIndex, bubbleId, text };
    measurements.push({ bubble, bubbleId, text, left, top, width: drawingWidth, height: drawingHeight,
      lines: fit.lines, fontSize: fit.fontSize,
      rotation: adjustment?.rotation ?? (bubble.rotation as number) ?? 0,
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
  if (!document.fonts?.load) return { findings: [], unavailableReason: "ตรวจสถานะฟอนต์ไม่ได้" };
  try {
    const fontFamily = resolveCanvasFontFamily(input.textStyle?.fontFamily);
    const loaded = await document.fonts.load(`bold 16px ${fontFamily}`);
    if (loaded.length === 0 || !document.fonts.check(`bold 16px ${fontFamily}`)) {
      return { findings: [], unavailableReason: "โหลดฟอนต์สำหรับตรวจการจัดข้อความไม่ได้" };
    }
  } catch {
    return { findings: [], unavailableReason: "โหลดฟอนต์สำหรับตรวจการจัดข้อความไม่ได้" };
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
    const glyphSample = sampleGlyphBackground(backgroundImage, {
      left: measurement.left, top: measurement.top,
      width: measurement.width, height: measurement.height,
      rotation: measurement.rotation, lines: measurement.lines,
      fontSize: measurement.fontSize, lineHeight: measurement.lineHeight, fontFamily,
    });
    const colorResult = evaluateLocalContrast(glyphSample,
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
