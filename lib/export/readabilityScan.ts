import {
  bubbleKeyOf,
  fitTextInAdaptiveBubble,
  getReadableMinimumFontSize,
  measureBubbleRenderFit,
  readPageOverlayAdjustments,
  resolveCanvasFontFamily,
  type OverlayAdjustment,
  type OverlayTextStyle,
  type TranslatedBubble,
} from "@/lib/translationOverlay";

export type ReadabilityFindingKind = "overflow" | "small-text";

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
}

export interface PageGeometryResult {
  findings: ReadabilityFinding[];
  unavailableReason?: string;
}

export function assessPageGeometry(input: PageGeometryInput): PageGeometryResult {
  const findings: ReadabilityFinding[] = [];
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
    let drawingWidth = adjustment?.bw ?? boxWidth;
    let drawingHeight = adjustment?.bh ?? boxHeight;
    if (!adjustment) {
      const adaptive = fitTextInAdaptiveBubble(
        text, drawingWidth, drawingHeight, fontFamily,
        !bubble.isInvalidBox && validBox, globalMultiplier,
        Math.max(14, getReadableMinimumFontSize(width)), 3,
      );
      drawingWidth = adaptive.width;
      drawingHeight = adaptive.height;
    }
    const bubbleMultiplier = typeof bubble.fontSizeMultiplier === "number" ? bubble.fontSizeMultiplier : 1;
    const fit = measureBubbleRenderFit(
      text, drawingWidth, drawingHeight, width, fontFamily,
      globalMultiplier, bubbleMultiplier, !bubble.isInvalidBox && validBox,
    );
    const base = { pageUrl: input.pageUrl, pageIndex: input.pageIndex, bubbleId, text };
    if (!fit.fits) findings.push({ ...base, kind: "overflow", fontSize: fit.fontSize });
    if (fit.fontSize < threshold) findings.push({ ...base, kind: "small-text", fontSize: fit.fontSize, threshold });
  }
  return { findings };
}

export async function scanPageGeometry(input: Omit<PageGeometryInput, "width" | "height" | "adjustments">): Promise<PageGeometryResult> {
  if (!input.bubbles.some((bubble) => !bubble.deleted && (bubble.t || bubble.translated || "").trim())) {
    return { findings: [] };
  }
  const dimensions = await new Promise<{ width: number; height: number }>((resolve) => {
    const image = new Image();
    const timeout = window.setTimeout(() => resolve({ width: 0, height: 0 }), 5000);
    image.onload = () => {
      window.clearTimeout(timeout);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      window.clearTimeout(timeout);
      resolve({ width: 0, height: 0 });
    };
    image.src = input.pageUrl;
  });
  const { width, height } = dimensions;
  if (document.fonts?.load) {
    try {
      const fontFamily = resolveCanvasFontFamily(input.textStyle?.fontFamily);
      await document.fonts.load(`bold 16px ${fontFamily}`);
    } catch {
      return { findings: [], unavailableReason: "โหลดฟอนต์สำหรับตรวจการจัดข้อความไม่ได้" };
    }
  }
  return assessPageGeometry({
    ...input, width, height,
    adjustments: readPageOverlayAdjustments(input.pageUrl),
  });
}
