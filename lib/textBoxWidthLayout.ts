export interface FixedFontWidthInput {
  text: string;
  widthPx: number;
  fontSizePx: number;
  fontFamily: string;
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

const wordSegmentsOf = (value: string): string[] => {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    try {
      const segmenter = new Intl.Segmenter("th", { granularity: "word" });
      return Array.from(segmenter.segment(value), (part) => part.segment);
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
  measureText: (value: string) => number,
): { lines: string[]; glyphOverflow: boolean } {
  const lines: string[] = [];
  let current = "";
  let glyphOverflow = false;

  const candidateWidthAt = (lineIndex: number): number =>
    allowedWidthAt(lineIndex, candidateLineCount, safeWidthPx, fontSizePx, isOval);

  const pushLine = (): void => {
    lines.push(current);
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
    if (measureText(remaining) <= candidateWidthAt(lines.length)) {
      current += remaining;
      return;
    }

    for (const grapheme of graphemesOf(remaining)) {
      const allowedWidth = candidateWidthAt(lines.length);
      if (current && measureText(current + grapheme) > allowedWidth) pushLine();
      if (measureText(grapheme) > candidateWidthAt(lines.length)) glyphOverflow = true;
      current += grapheme;
    }
  };

  for (const part of text.split(/(\n)/)) {
    if (part === "\n") {
      pushLine();
      continue;
    }

    for (const token of wordSegmentsOf(part)) {
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
  return { lines, glyphOverflow };
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
  const safeWidthPx = Math.max(1, finiteWidth * 0.88);
  const graphemeCount = graphemesOf(input.text).length;
  const maxCandidates = input.isOval
    ? Math.min(MAX_OVAL_LINE_CANDIDATES, Math.max(1, graphemeCount + 1))
    : 1;

  let chosenLines: string[] = [];
  let glyphOverflow = false;
  let settled = false;

  for (let candidateLineCount = 1; candidateLineCount <= maxCandidates; candidateLineCount += 1) {
    const attempt = wrapForCandidate(
      input.text,
      candidateLineCount,
      safeWidthPx,
      finiteFontSize,
      input.isOval,
      input.measureText,
    );
    chosenLines = attempt.lines;
    glyphOverflow = attempt.glyphOverflow;

    const actualChordsFit = chosenLines.every((line, lineIndex) => {
      if (!input.isOval || chosenLines.length <= 1) {
        return input.measureText(line) <= safeWidthPx * 1.05;
      }
      const chordWidth = allowedWidthAt(
        lineIndex,
        chosenLines.length,
        safeWidthPx,
        finiteFontSize,
        input.isOval,
      );
      return input.measureText(line) <= chordWidth * 1.05;
    });

    if ((!input.isOval || chosenLines.length <= candidateLineCount) && actualChordsFit) {
      settled = true;
      break;
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
      || glyphOverflow
      || requiredHeightPx > finiteAvailableHeight
      || manualMinHeight > finiteAvailableHeight,
  };
}
