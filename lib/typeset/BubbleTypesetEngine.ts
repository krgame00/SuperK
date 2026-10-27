import { canHyphenateWord, splitWordByHyphen } from "../text/hyphenation";

export interface BubbleShapeInput {
  x: number;
  y: number;
  width: number;
  height: number;
  scanlineRatios: number[];
}

export interface TypesetLine {
  text: string;
  x: number;
  y: number;
  maxWidth: number;
}

export interface TypesetResult {
  fontSize: number;
  lineHeight: number;
  lines: TypesetLine[];
}

export type MeasureWidthFn = (
  text: string,
  fontSize: number,
  fontFamily: string,
) => number;

const THAI_STICKY_PUNCTUATION = /^([!?:;.,…ๆฯ"')\]]+)$/u;

export function segmentThaiAwareTokens(
  text: string,
  locale = "th",
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  let rawSegments: string[];
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    try {
      const segmenter = new Intl.Segmenter(locale, { granularity: "word" });
      rawSegments = Array.from(segmenter.segment(trimmed), (s) => s.segment);
    } catch {
      rawSegments = trimmed.split(/(\s+)/);
    }
  } else {
    rawSegments = trimmed.split(/(\s+)/);
  }

  const tokens: string[] = [];
  for (const seg of rawSegments) {
    if (!seg) continue;
    if (tokens.length > 0 && THAI_STICKY_PUNCTUATION.test(seg.trim())) {
      tokens[tokens.length - 1] += seg;
    } else {
      tokens.push(seg);
    }
  }
  return tokens;
}

export function resolveMeasureFn(
  ctxOrFn:
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | MeasureWidthFn
    | ((text: string, fontSize?: number) => number),
): MeasureWidthFn {
  if (typeof ctxOrFn === "function") {
    return (text: string, fontSize: number, fontFamily: string) => {
      if (ctxOrFn.length === 1) {
        return (ctxOrFn as (text: string) => number)(text);
      }
      return (ctxOrFn as MeasureWidthFn)(text, fontSize, fontFamily);
    };
  }
  return (text: string, fontSize: number, fontFamily: string) => {
    ctxOrFn.font = `${fontSize}px ${fontFamily}`;
    return ctxOrFn.measureText(text).width;
  };
}

export function fitTextToBubbleContour(
  ctxOrFn:
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | MeasureWidthFn
    | ((text: string, fontSize?: number) => number),
  text: string,
  bubble: BubbleShapeInput,
  fontFamily = "Itim, WildWords, Noto Sans Thai, sans-serif",
  minFontSize = 10,
  maxFontSize = 64,
  lineHeightRatio = 1.28,
): TypesetResult {
  const measure = resolveMeasureFn(ctxOrFn);
  const tokens = segmentThaiAwareTokens(text);
  if (tokens.length === 0) {
    return {
      fontSize: minFontSize,
      lineHeight: minFontSize * lineHeightRatio,
      lines: [],
    };
  }

  let low = minFontSize;
  let high = maxFontSize;
  let bestResult: TypesetResult | null = null;

  while (low <= high) {
    const midFont = Math.floor((low + high) / 2);
    const attempt = layoutAtFontSize(
      measure,
      tokens,
      bubble,
      fontFamily,
      midFont,
      lineHeightRatio,
      false,
    );

    if (attempt !== null) {
      bestResult = attempt;
      low = midFont + 1; // Try larger font size
    } else {
      high = midFont - 1; // Too big, reduce font size
    }
  }

  if (bestResult) return bestResult;

  // Fallback with force-fit at minFontSize
  return (
    layoutAtFontSize(
      measure,
      tokens,
      bubble,
      fontFamily,
      minFontSize,
      lineHeightRatio,
      true,
    ) ?? {
      fontSize: minFontSize,
      lineHeight: minFontSize * lineHeightRatio,
      lines: [],
    }
  );
}

function layoutAtFontSize(
  measure: MeasureWidthFn,
  tokens: string[],
  bubble: BubbleShapeInput,
  fontFamily: string,
  fontSize: number,
  lineHeightRatio: number,
  forceFit = false,
): TypesetResult | null {
  const lineHeight = fontSize * lineHeightRatio;
  const maxLinesPossible = Math.max(1, Math.floor(bubble.height / lineHeight));
  const ratios =
    bubble.scanlineRatios.length > 0 ? bubble.scanlineRatios : [1.0];

  const workingTokens = [...tokens];
  const linesText: string[] = [];
  let tokenIdx = 0;

  for (
    let lineIdx = 0;
    lineIdx < maxLinesPossible && tokenIdx < workingTokens.length;
    lineIdx++
  ) {
    const verticalProgress = (lineIdx + 0.5) / maxLinesPossible;
    const sliceIdx = Math.min(
      ratios.length - 1,
      Math.floor(verticalProgress * ratios.length),
    );
    const allowedWidth = bubble.width * (ratios[sliceIdx] ?? 0.85);

    let currentLine = "";
    while (tokenIdx < workingTokens.length) {
      const nextTok = workingTokens[tokenIdx];
      if (!currentLine && /^\s+$/.test(nextTok)) {
        tokenIdx++;
        continue;
      }
      const candidate = currentLine + nextTok;
      const candidateWidth = measure(candidate, fontSize, fontFamily);

      if (candidateWidth <= allowedWidth) {
        currentLine = candidate;
        tokenIdx++;
      } else {
        // Attempt Latin/English syllable hyphenation if the token can be hyphenated
        const trimmedTok = nextTok.trim();
        const leadingSpace = nextTok.startsWith(" ") && currentLine.length > 0 ? " " : "";
        const prefixWidth = measure(currentLine + leadingSpace, fontSize, fontFamily);
        const remainingWidth = allowedWidth - prefixWidth;

        if (remainingWidth > fontSize * 1.5 && canHyphenateWord(trimmedTok)) {
          const split = splitWordByHyphen(
            trimmedTok,
            remainingWidth,
            (val) => measure(val, fontSize, fontFamily),
          );
          if (split) {
            currentLine = currentLine + leadingSpace + split.head;
            workingTokens[tokenIdx] = split.tail;
            break;
          }
        }

        if (currentLine === "") {
          if (!forceFit) {
            return null;
          }
          currentLine = candidate;
          tokenIdx++;
        }
        break;
      }
    }
    if (currentLine.trim()) {
      linesText.push(currentLine.trim());
    }
  }

  if (tokenIdx < workingTokens.length && !forceFit) {
    return null;
  }

  const totalBlockHeight = linesText.length * lineHeight;
  const startY =
    bubble.y + (bubble.height - totalBlockHeight) / 2 + fontSize * 0.82;

  const lines: TypesetLine[] = linesText.map((lineStr, idx) => {
    const yPos = startY + idx * lineHeight;
    const relY = Math.max(
      0,
      Math.min(0.999, (yPos - bubble.y) / Math.max(1, bubble.height)),
    );
    const sliceIdx = Math.floor(relY * ratios.length);
    const maxWidth = bubble.width * (ratios[sliceIdx] ?? 1.0);
    return {
      text: lineStr,
      x: bubble.x + bubble.width / 2,
      y: yPos,
      maxWidth,
    };
  });

  return { fontSize, lineHeight, lines };
}
