export interface FixedFontWidthInput {
  text: string;
  widthPx: number;
  fontSizePx: number;
  fontFamily: string;
  locale?: string;
  manualMinHeightPx: number;
  availableHeightPx: number;
  isOval: boolean;
  measureText: (value: string) => number;
}

export interface FixedFontWidthResult {
  lines: string[];
  fontSizePx: number;
  requiredHeightPx: number;
  heightPx: number;
  overflow: boolean;
}

const MAX_OVAL_LINE_CANDIDATES = 256;

function allowedWidthAt(
  lineIndex: number,
  lineCount: number,
  safeWidthPx: number,
  fontSizePx: number,
  isOval: boolean,
): number {
  if (!isOval || lineCount <= 1) return safeWidthPx;
  const vertical = ((lineIndex + 0.5) / lineCount - 0.5) * 2;
  const chordRatio = Math.sqrt(Math.max(0.2, 1 - vertical * vertical));
  return Math.min(
    safeWidthPx,
    Math.max(Math.min(safeWidthPx, fontSizePx * 1.5), safeWidthPx * chordRatio * 0.95),
  );
}

function singleWordAllowedWidth(
  safeWidthPx: number,
  fontSizePx: number,
  isOval: boolean,
): number {
  if (!isOval) return safeWidthPx;
  return allowedWidthAt(0, 2, safeWidthPx, fontSizePx, true);
}

const graphemesOf = (value: string): string[] => {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    try {
      const segmenter = new Intl.Segmenter("th", { granularity: "grapheme" });
      return Array.from(segmenter.segment(value), (part) => part.segment);
    } catch {
      // Older runtimes can expose Intl.Segmenter without supporting graphemes.
    }
  }
  return Array.from(value);
};

export const segmentTextIntoWords = (value: string, locale = "th"): string[] => {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    try {
      const segmenter = new Intl.Segmenter(locale, { granularity: "word" });
      const segments: string[] = [];
      const rawParts = Array.from(segmenter.segment(value));
      for (let index = 0; index < rawParts.length; index += 1) {
        const part = rawParts[index];
        const segment = part.segment;
        const nextPart = rawParts[index + 1];
        const isInternalConnector = /^[\p{Pd}\p{Pc}'’]+$/u.test(segment);
        if (
          isInternalConnector
          && nextPart?.isWordLike
          && segments.length > 0
          && !/^\s+$/u.test(segments[segments.length - 1])
        ) {
          segments[segments.length - 1] += segment + nextPart.segment;
          index += 1;
          continue;
        }
        const isTrailingPunctuation = /^[\p{Pd}\p{Pe}\p{Pf}\p{Po}]+$/u.test(segment);
        if (isTrailingPunctuation && segments.length > 0 && !/^\s+$/u.test(segments[segments.length - 1])) {
          segments[segments.length - 1] += segment;
        } else {
          segments.push(segment);
        }
      }
      return segments;
    } catch {
      // Fall back to whitespace boundaries in older runtimes.
    }
  }
  return value.split(/(\s+)/).filter(Boolean);
};

function wrapForCandidate(
  text: string,
  candidateLineCount: number,
  safeWidthPx: number,
  fontSizePx: number,
  isOval: boolean,
  locale: string,
  measureText: (value: string) => number,
): { lines: string[]; wordOverflow: boolean } {
  const lines: string[] = [];
  let current = "";
  let wordOverflow = false;
  const singleWordLimit = singleWordAllowedWidth(safeWidthPx, fontSizePx, isOval);

  const candidateWidthAt = (lineIndex: number): number =>
    allowedWidthAt(lineIndex, candidateLineCount, safeWidthPx, fontSizePx, isOval);

  const pushLine = (): void => {
    lines.push(current.trimEnd());
    current = "";
  };

  const appendToken = (token: string): void => {
    let remaining = current ? token : token.trimStart();
    if (!remaining) return;

    if (current && measureText(current + remaining) > candidateWidthAt(lines.length)) {
      pushLine();
      remaining = token.trimStart();
    }

    if (!remaining) return;
    const wordLimit = current
      ? candidateWidthAt(lines.length)
      : Math.max(candidateWidthAt(lines.length), singleWordLimit);
    if (measureText(remaining) > wordLimit * 1.05) wordOverflow = true;
    current += remaining;
  };

  for (const part of text.split(/(\n)/)) {
    if (part === "\n") {
      pushLine();
      continue;
    }

    for (const token of segmentTextIntoWords(part, locale)) {
      if (/^\s+$/.test(token)) {
        if (!current) continue;
        if (measureText(current + token) > candidateWidthAt(lines.length)) {
          pushLine();
        } else {
          current += token;
        }
      } else {
        appendToken(token);
      }
    }
  }

  if (current || lines.length === 0 || text.endsWith("\n")) pushLine();
  return { lines, wordOverflow };
}

type MinimumWordWidthInput = Pick<FixedFontWidthInput, "text" | "fontSizePx" | "locale" | "isOval" | "measureText">;

function linesFitTheirChords(
  lines: string[],
  widthPx: number,
  fontSizePx: number,
  isOval: boolean,
  locale: string,
  measureText: (value: string) => number,
): boolean {
  const safeWidthPx = Math.max(1, widthPx * 0.88);
  const singleWordLimit = singleWordAllowedWidth(safeWidthPx, fontSizePx, isOval);
  return lines.every((line, lineIndex) => {
    if (!isOval || lines.length <= 1) return measureText(line) <= safeWidthPx * 1.05;
    const chordWidth = allowedWidthAt(lineIndex, lines.length, safeWidthPx, fontSizePx, isOval);
    const wordCount = segmentTextIntoWords(line, locale).filter((segment) => !/^\s+$/u.test(segment)).length;
    const effectiveChord = wordCount <= 1 ? Math.max(chordWidth, singleWordLimit) : chordWidth;
    return measureText(line) <= effectiveChord * 1.05;
  });
}

/** Smallest frame width whose complete words can fit with the selected bubble shape. */
export function minimumWidthForWholeWords(input: MinimumWordWidthInput): number {
  const locale = input.locale || "th";
  const words = segmentTextIntoWords(input.text, locale).filter((segment) => !/^\s+$/u.test(segment));
  if (words.length === 0) return 30;

  const widestWordPx = words.reduce((widest, word) => Math.max(widest, input.measureText(word)), 0);
  const rectWidthPx = Math.max(1, Math.ceil(widestWordPx / 0.88));
  if (!input.isOval) return rectWidthPx;

  const fitsSingleWordOval = (widthPx: number): boolean => {
    const safeWidthPx = Math.max(1, widthPx * 0.88);
    return widestWordPx <= singleWordAllowedWidth(safeWidthPx, input.fontSizePx, true) * 1.05;
  };

  const twoLineChordFactor = 0.88 * Math.sqrt(0.75) * 0.95;
  let low = rectWidthPx;
  let high = Math.max(low + 1, Math.ceil(widestWordPx / twoLineChordFactor) + 2);
  while (!fitsSingleWordOval(high)) high *= 2;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const middle = (low + high) / 2;
    if (fitsSingleWordOval(middle)) high = middle;
    else low = middle;
  }
  return Math.max(rectWidthPx + 1, Math.ceil(high));
}

/** Wrap content at a fixed visible font size, with bounded oval fitting. */
export function layoutTextAtFixedFont(input: FixedFontWidthInput): FixedFontWidthResult {
  const finiteWidth = Number.isFinite(input.widthPx) ? input.widthPx : 1;
  const finiteFontSize = Number.isFinite(input.fontSizePx) ? input.fontSizePx : 8;
  const finiteAvailableHeight = Number.isFinite(input.availableHeightPx)
    ? Math.max(0, input.availableHeightPx)
    : Number.MAX_SAFE_INTEGER;
  const manualMinHeight = Number.isFinite(input.manualMinHeightPx)
    ? Math.max(0, input.manualMinHeightPx)
    : 0;
  if (!input.text.trim()) {
    return {
      lines: [],
      fontSizePx: input.fontSizePx,
      requiredHeightPx: 0,
      heightPx: Math.min(finiteAvailableHeight, Math.max(manualMinHeight, 25)),
      overflow: manualMinHeight > finiteAvailableHeight,
    };
  }
  const locale = input.locale || "th";
  const safeWidthPx = Math.max(1, finiteWidth * 0.88);
  const graphemeCount = graphemesOf(input.text).length;
  const maxCandidates = input.isOval
    ? Math.min(MAX_OVAL_LINE_CANDIDATES, Math.max(1, graphemeCount + 1))
    : 1;

  let chosenLines: string[] = [];
  let fallbackLines: string[] | null = null;
  let fallbackWordOverflow = false;
  let crossoverCandidate: number | null = null;
  let wordOverflow = false;
  let settled = false;

  for (let candidateLineCount = 1; candidateLineCount <= maxCandidates; candidateLineCount += 1) {
    const attempt = wrapForCandidate(
      input.text,
      candidateLineCount,
      safeWidthPx,
      finiteFontSize,
      input.isOval,
      locale,
      input.measureText,
    );
    chosenLines = attempt.lines;
    wordOverflow = attempt.wordOverflow;

    if (fallbackLines === null && (!input.isOval || chosenLines.length <= candidateLineCount)) {
      fallbackLines = chosenLines;
      fallbackWordOverflow = wordOverflow;
      crossoverCandidate = candidateLineCount;
    }

    const actualChordsFit = linesFitTheirChords(
      chosenLines,
      finiteWidth,
      finiteFontSize,
      input.isOval,
      locale,
      input.measureText,
    );

    if ((!input.isOval || chosenLines.length <= candidateLineCount) && actualChordsFit && !wordOverflow) {
      settled = true;
      break;
    }

    if (crossoverCandidate !== null && candidateLineCount >= crossoverCandidate + 1) {
      break;
    }
  }

  if (!settled && fallbackLines !== null) {
    chosenLines = fallbackLines;
    wordOverflow = fallbackWordOverflow;
    if (!wordOverflow) {
      settled = true;
    }
  }

  const requiredHeightPx = chosenLines.length === 0
    ? 0
    : Math.ceil((chosenLines.length * finiteFontSize * 1.30) / 0.88);
  const requestedHeight = Math.max(requiredHeightPx, manualMinHeight, 25);
  const heightPx = Math.min(finiteAvailableHeight, requestedHeight);

  return {
    lines: chosenLines,
    fontSizePx: input.fontSizePx,
    requiredHeightPx,
    heightPx,
    overflow: !settled
      || wordOverflow
      || requiredHeightPx > finiteAvailableHeight
      || manualMinHeight > finiteAvailableHeight,
  };
}
