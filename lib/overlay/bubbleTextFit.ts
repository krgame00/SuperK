// Text fitting for overlay bubbles. Extracted from translationOverlay so
// bubbleLayoutOptimizer can consume these helpers without importing the
// overlay painter, which breaks the module cycle at its only value edge.

import {
  formatStructuredMangaText,
  isStructuredMangaList,
  layoutTextAtFixedFont,
  segmentTextIntoWords,
  type FixedFontWidthResult,
} from "../textBoxWidthLayout";
import { fitTextToBubbleContour } from "../typeset/BubbleTypesetEngine";

export interface BubbleTextFit {
  fontSize: number;
  lines: string[];
  lineHeight: number;
  fits: boolean;
}

// One shared measuring context for text fitting — creating a fresh canvas
// per wrap/fit iteration churned dozens of canvases per bubble render.
let sharedMeasureCtx: CanvasRenderingContext2D | null | undefined;
export const getSharedMeasureCtx = (): CanvasRenderingContext2D | null => {
  if (typeof document === "undefined") return null;
  if (sharedMeasureCtx === undefined) {
    sharedMeasureCtx = document.createElement("canvas").getContext("2d");
  }
  return sharedMeasureCtx;
};

export const wrapTextForBubble = (
  text: string,
  maxW: number,
  maxH: number,
  fs: number,
  fontFamily: string = "sans-serif",
  isOval: boolean = true,
  locale: string = "th",
  scanlineRatios?: number[],
): string[] => {
  if (!text || !text.trim()) return [];

  const structuredList = isStructuredMangaList(text);
  const effectiveText = structuredList ? formatStructuredMangaText(text) : text;
  const effectiveIsOval = isOval && !structuredList;

  let measureFn: (str: string) => number;
  const tempCtx = getSharedMeasureCtx();
  if (tempCtx) {
    tempCtx.font = `bold ${fs}px ${fontFamily}`;
    measureFn = (str: string) => tempCtx.measureText(str).width;
  } else {
    measureFn = (str: string) => str.length * (fs * 0.6);
  }

  if (effectiveText.includes("\n")) {
    const outLines: string[] = [];
    const bulletIndentReserve = structuredList ? Math.round(fs * 0.9) : 0;
    for (const rawParagraph of effectiveText.split(/\r?\n/)) {
      const paragraph = rawParagraph.trim();
      if (!paragraph) continue;
      const isBulletPara = structuredList && (paragraph.startsWith("•") || paragraph.startsWith("-"));
      let isContinuation = false;
      const limitForLine = () =>
        isBulletPara && isContinuation ? Math.max(fs * 2, maxW - bulletIndentReserve) : maxW;
      const paraWords = segmentTextIntoWords(paragraph, locale);
      let cur = "";
      for (const w of paraWords) {
        if (/^\s+$/u.test(w)) {
          if (!cur) continue;
          if (measureFn(cur + w) > limitForLine()) {
            outLines.push(cur.trimEnd());
            cur = "";
            if (isBulletPara) isContinuation = true;
          } else {
            cur += w;
          }
          continue;
        }
        const test = cur ? cur + w : w;
        if (measureFn(test) > limitForLine() && cur) {
          outLines.push(cur.trimEnd());
          cur = w.trimStart();
          if (isBulletPara) isContinuation = true;
        } else {
          cur = test;
        }
      }
      if (cur) outLines.push(cur.trimEnd());
    }
    return outLines.length > 0 ? outLines : [text];
  }

  const wds = segmentTextIntoWords(effectiveText, locale);
  const lineH = fs * 1.35;
  const estimatedLineCount = Math.max(1, Math.round(maxH / lineH));

  const getLineMaxW = (lineIndex: number, totalLines: number): number => {
    if (!effectiveIsOval || totalLines <= 1) return maxW;
    const yCenter = (lineIndex + 0.5) / totalLines;
    if (Array.isArray(scanlineRatios) && scanlineRatios.length > 0) {
      const sliceIdx = Math.min(
        scanlineRatios.length - 1,
        Math.max(0, Math.floor(yCenter * scanlineRatios.length)),
      );
      const chordRatio = Math.max(0.25, Math.min(1.0, scanlineRatios[sliceIdx] ?? 0.85));
      return Math.min(maxW, Math.max(Math.min(maxW, fs * 1.5), maxW * chordRatio));
    }
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

export function layoutBubbleAtFixedFont(
  text: string,
  widthPx: number,
  fontSizePx: number,
  fontFamily: string,
  isOval: boolean,
  manualMinHeightPx: number,
  availableHeightPx: number,
  locale = "th",
  enableHyphenation = false,
  scanlineRatios?: number[],
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
    enableHyphenation,
    scanlineRatios,
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
  enableHyphenation = false,
  scanlineRatios?: number[],
): BubbleTextFit {
  const effectiveIsOval = isOval && !isStructuredMangaList(text);
  const safeW = width * 0.88;
  const safeH = height * 0.88;
  const maxFs = Math.max(minFontSize, Math.round(Math.min(height * 0.55, width * 0.55, 96) * fontSizeMultiplier));

  const tempCtx = getSharedMeasureCtx();

  // If authentic contour scanlineRatios are provided, delegate to BubbleTypesetEngine
  if (effectiveIsOval && Array.isArray(scanlineRatios) && scanlineRatios.length > 0) {
    const measureFn = tempCtx
      ? (str: string, fs: number, fam: string) => {
          tempCtx.font = `bold ${fs}px ${fam}`;
          return tempCtx.measureText(str).width;
        }
      : (str: string, fs: number) => str.length * (fs * 0.6);
    const contourRes = fitTextToBubbleContour(
      measureFn,
      text,
      { x: 0, y: 0, width: safeW, height: safeH, scanlineRatios },
      fontFamily,
      minFontSize,
      maxFs,
      1.30,
    );
    const lines = contourRes.lines.map((l) => l.text);
    const totalH = lines.length * contourRes.lineHeight;
    let maxWidthOk = true;
    for (let i = 0; i < contourRes.lines.length; i++) {
      const w = measureFn(contourRes.lines[i].text, contourRes.fontSize, fontFamily);
      if (w > contourRes.lines[i].maxWidth * 1.05) {
        maxWidthOk = false;
        break;
      }
    }
    return {
      fontSize: contourRes.fontSize,
      lines: lines.length > 0 ? lines : [text],
      lineHeight: contourRes.lineHeight,
      fits: totalH <= safeH && maxWidthOk,
    };
  }

  let bestFit: BubbleTextFit = {
    fontSize: minFontSize,
    lines: wrapTextForBubble(text, safeW, safeH, minFontSize, fontFamily, effectiveIsOval, locale, scanlineRatios),
    lineHeight: minFontSize * 1.30,
    fits: false,
  };

  for (let fs = maxFs; fs >= minFontSize; fs--) {
    const lineH = fs * 1.30;
    const lines = wrapTextForBubble(text, safeW, safeH, fs, fontFamily, effectiveIsOval, locale, scanlineRatios);
    const totalH = lines.length * lineH;

    let maxWidthOk = true;
    if (tempCtx) {
      tempCtx.font = `bold ${fs}px ${fontFamily}`;
      for (let i = 0; i < lines.length; i++) {
        const allowed = effectiveIsOval && lines.length > 1
          ? safeW * Math.sqrt(Math.max(0.2, 1 - Math.pow(((i + 0.5) / lines.length - 0.5) * 2, 2)))
          : safeW;
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
