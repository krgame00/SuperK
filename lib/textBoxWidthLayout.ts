import { breakWordIntoHyphenatedLines, canHyphenateWord, splitWordByHyphen } from "./text/hyphenation";

export interface FixedFontWidthInput {
  text: string;
  widthPx: number;
  fontSizePx: number;
  fontFamily: string;
  locale?: string;
  manualMinHeightPx: number;
  availableHeightPx: number;
  isOval: boolean;
  enableHyphenation?: boolean;
  scanlineRatios?: number[];
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
  scanlineRatios?: number[],
): number {
  if (scanlineRatios && scanlineRatios.length > 0) {
    if (lineCount <= 1) {
      const midSlice = Math.floor(scanlineRatios.length / 2);
      const ratio = scanlineRatios[midSlice] ?? 1.0;
      return Math.min(
        safeWidthPx,
        Math.max(Math.min(safeWidthPx, fontSizePx * 1.5), safeWidthPx * ratio * 0.95),
      );
    }
    const verticalProgress = (lineIndex + 0.5) / lineCount;
    const sliceIdx = Math.min(
      scanlineRatios.length - 1,
      Math.max(0, Math.floor(verticalProgress * scanlineRatios.length)),
    );
    const chordRatio = scanlineRatios[sliceIdx] ?? 1.0;
    return Math.min(
      safeWidthPx,
      Math.max(Math.min(safeWidthPx, fontSizePx * 1.5), safeWidthPx * chordRatio * 0.95),
    );
  }
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
  scanlineRatios?: number[],
): number {
  if (!isOval && (!scanlineRatios || scanlineRatios.length === 0)) return safeWidthPx;
  return allowedWidthAt(0, 2, safeWidthPx, fontSizePx, true, scanlineRatios);
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

const THAI_PRE_PROTECT_RE = /(ด้วยเนี่ย|รึเปล่า|หรือเปล่า|เหรอ|รึยัง|รึไง|แม่วัวนม|วัวนม|เรือนร่าง|อวบอั๋น|อวบอั้น|จอมเวท|พรสวรรค์|ลักษณะนิสัย|ตระกูลขุนนาง|จักรวรรดิ|ระดับสูงสุด|ระดับเอส|ระดับเอ|พิกัดมิติ|เคลื่อนย้าย|ความเข้ากันได้)/gu;
const THAI_STOLEN_CODA_PARTICLE_RE = /^([งกนมดบยว])(ด้วยเนี่ย|เนี่ย|มั้ง|มั้ย|งี้|งั้น|รึเปล่า|รึยัง|รึไง|รึ|น่ะ|ล่ะ|อ่ะ|อะ|วะ|เว้ย|โว้ย|ฟะ|เฟ้ย|แฮะ|แหละ|จัง|จ้ะ|จ๋า|ฮะ)[\p{P}\s]*$/u;

const STRUCTURED_HEADER_PREFIX_RE = "(?:สกิล|เวทมนตร์|พลัง|ความสามารถ|ข้อมูล|ประวัติ|ลักษณะ|พรสวรรค์|ฉายา|อาชีพ|เผ่าพันธุ์|สังกัด|ตำแหน่ง|อาวุธ|ธาตุ|ระดับ|จุดเด่น|จุดอ่อน|งานอดิเรก|สิ่งที่ชอบ|สิ่งที่เกลียด|สถานะ|ค่าสถานะ|Skill|Skills|Talent|Talents|Trait|Traits|Personality|Status|Title|Class|Magic|Ability|Abilities)";

export function isStructuredMangaList(text?: string | null): boolean {
  if (!text || typeof text !== "string") return false;
  const bulletMatches = text.match(/(?:^|\n|\s)[•-]\s+\S/gu);
  return (bulletMatches?.length ?? 0) >= 2;
}

export function isStructuredSectionHeaderLine(line?: string | null): boolean {
  if (!line || typeof line !== "string") return false;
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("•") || trimmed.startsWith("-")) return false;
  return trimmed.endsWith(":") && trimmed.length <= 36;
}

export function formatStructuredMangaText(text: string): string {
  if (!isStructuredMangaList(text)) return text;
  let formatted = text.replace(/\r\n/g, "\n");

  // 1. Multi-word section headers starting with a known header keyword (e.g. "สกิลที่ครอบครอง:", "เวทมนตร์ที่ใช้ได้:")
  const multiWordHeaderRe = new RegExp(
    `\\s+(${STRUCTURED_HEADER_PREFIX_RE}[^\\s\\n:•-]*(?:\\s+[^\\s\\n:•-]{1,20})?:)\\s*(?=[•-]\\s+\\S|$|\\n)`,
    "gu",
  );
  formatted = formatted.replace(multiWordHeaderRe, "\n$1\n");

  // 2. Single-token section headers immediately preceding a bullet marker or newline (e.g. "พรสวรรค์:", "ลักษณะนิสัย:")
  // Never match across spaces so preceding sentence clauses (like "แต่เธอก็ไม่ได้ใส่ใจ") stay on the bullet line!
  formatted = formatted.replace(
    /\s+([^\s\n:•-]{2,26}:)\s*(?=[•-]\s+\S|\n|$)/gu,
    "\n$1\n",
  );

  // 3. Turn inline bullet markers (" - item" or " • item") into explicit newline bullets
  formatted = formatted.replace(/(?:^|\s+)[•-]\s+(?=\S)/gu, (match) =>
    match === "• " || match === "- " ? "• " : "\n• ",
  );

  // 4. If a line still has a trailing section header at the very end after a sentence (e.g. "...แต่เธอก็ไม่ได้ใส่ใจ พรสวรรค์:")
  formatted = formatted
    .split("\n")
    .flatMap((rawLine) => {
      const line = rawLine.trim();
      if (!line) return [];
      const trailingHeaderMatch = line.match(
        new RegExp(
          `^(.+?\\S)\\s+((?:${STRUCTURED_HEADER_PREFIX_RE}[^\\s:•-]*(?:\\s+[^\\s:•-]{1,18})?|[^\\s:•-]{2,24}):)$`,
          "u",
        ),
      );
      if (trailingHeaderMatch) {
        return [trailingHeaderMatch[1].trim(), trailingHeaderMatch[2].trim()];
      }
      return [line];
    })
    .filter(Boolean)
    .join("\n");
  return formatted;
}

export function hasBrokenThaiLineBreak(lines?: string[] | null): boolean {
  if (!Array.isArray(lines) || lines.length <= 1) return false;
  const joined = lines.join(" ");
  if (isStructuredMangaList(joined) || /(?:^|\s)[•-]\s+\S/u.test(joined)) {
    for (const rawLine of lines) {
      const line = (rawLine || "").trim();
      if (/\S\s+[•-]\s+\S/u.test(line)) return true;
      // Also detect a sentence glued onto a trailing section header like "แต่เธอก็ไม่ได้ใส่ใจ พรสวรรค์:"
      if (/\S\s+[^\s:•-]{2,24}:$/u.test(line) && !new RegExp(`^${STRUCTURED_HEADER_PREFIX_RE}`, "u").test(line)) {
        return true;
      }
    }
  }
  for (let i = 1; i < lines.length; i++) {
    const line = (lines[i] || "").trim();
    if (!line) continue;
    if (THAI_STOLEN_CODA_PARTICLE_RE.test(line)) return true;
    if (/^รอ/u.test(line) && /เห$/u.test((lines[i - 1] || "").trim())) {
      return true;
    }
  }
  return false;
}

function segmentRawWithThaiFix(
  value: string,
  segmenter: Intl.Segmenter,
  locale: string,
): Array<{ segment: string; isWordLike?: boolean }> {
  if (!locale.toLowerCase().startsWith("th")) {
    return Array.from(segmenter.segment(value));
  }

  const rawParts: Array<{ segment: string; isWordLike?: boolean }> = [];
  let lastIdx = 0;
  for (const m of value.matchAll(THAI_PRE_PROTECT_RE)) {
    const idx = m.index ?? 0;
    if (idx > lastIdx) {
      for (const p of segmenter.segment(value.slice(lastIdx, idx))) {
        rawParts.push({ segment: p.segment, isWordLike: p.isWordLike });
      }
    }
    const token = m[0];
    if (token === "ด้วยเนี่ย") {
      rawParts.push({ segment: "ด้วย", isWordLike: true }, { segment: "เนี่ย", isWordLike: true });
    } else if (token === "รึเปล่า") {
      rawParts.push({ segment: "รึ", isWordLike: true }, { segment: "เปล่า", isWordLike: true });
    } else if (token === "หรือเปล่า") {
      rawParts.push({ segment: "หรือ", isWordLike: true }, { segment: "เปล่า", isWordLike: true });
    } else if (token === "รึยัง") {
      rawParts.push({ segment: "รึ", isWordLike: true }, { segment: "ยัง", isWordLike: true });
    } else if (token === "รึไง") {
      rawParts.push({ segment: "รึ", isWordLike: true }, { segment: "ไง", isWordLike: true });
    } else {
      rawParts.push({ segment: token, isWordLike: true });
    }
    lastIdx = idx + token.length;
  }
  if (lastIdx < value.length) {
    for (const p of segmenter.segment(value.slice(lastIdx))) {
      rawParts.push({ segment: p.segment, isWordLike: p.isWordLike });
    }
  }

  const repaired: Array<{ segment: string; isWordLike?: boolean }> = [];
  for (let i = 0; i < rawParts.length; i++) {
    const cur = rawParts[i];
    const prev = repaired[repaired.length - 1];
    const match = cur.segment.match(THAI_STOLEN_CODA_PARTICLE_RE);
    if (match && prev && prev.isWordLike && /[\u0E01-\u0E4E]$/u.test(prev.segment)) {
      const coda = match[1];
      const particle = match[2];
      const candidateWord = prev.segment + coda;
      if (Array.from(segmenter.segment(candidateWord)).length === 1) {
        prev.segment = candidateWord;
        repaired.push({ segment: particle, isWordLike: true });
        continue;
      }
    }
    repaired.push(cur);
  }

  return repaired;
}

export const segmentTextIntoWords = (value: string, locale = "th"): string[] => {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    try {
      const segmenter = new Intl.Segmenter(locale, { granularity: "word" });
      const segments: string[] = [];
      const rawParts = segmentRawWithThaiFix(value, segmenter, locale);

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
  enableHyphenation = false,
  scanlineRatios?: number[],
): { lines: string[]; wordOverflow: boolean } {
  const lines: string[] = [];
  let current = "";
  let wordOverflow = false;
  const singleWordLimit = singleWordAllowedWidth(safeWidthPx, fontSizePx, isOval, scanlineRatios);

  const candidateWidthAt = (lineIndex: number): number =>
    allowedWidthAt(lineIndex, candidateLineCount, safeWidthPx, fontSizePx, isOval, scanlineRatios);

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

  const isStructured = isStructuredMangaList(text);
  const bulletContinuationReservePx = isStructured ? Math.round(fontSizePx * 0.9) : 0;

  for (const part of text.split(/(\n)/)) {
    if (part === "\n") {
      pushLine();
      continue;
    }

    const trimmedPart = part.trimStart();
    const isBulletParagraph = isStructured && (trimmedPart.startsWith("•") || trimmedPart.startsWith("-"));
    let isContinuationLine = false;

    const effectiveLimitAt = (lineIdx: number): number => {
      const base = candidateWidthAt(lineIdx);
      return isBulletParagraph && isContinuationLine
        ? Math.max(fontSizePx * 2, base - bulletContinuationReservePx)
        : base;
    };

    for (const token of segmentTextIntoWords(part, locale)) {
      if (/^\s+$/.test(token)) {
        if (!current) continue;
        if (measureText(current + token) > effectiveLimitAt(lines.length)) {
          pushLine();
          if (isBulletParagraph) isContinuationLine = true;
        } else {
          current += token;
        }
      } else {
        let remaining = current ? token : token.trimStart();
        if (!remaining) continue;
        if (current && measureText(current + remaining) > effectiveLimitAt(lines.length)) {
          pushLine();
          if (isBulletParagraph) isContinuationLine = true;
          remaining = token.trimStart();
        }
        if (!remaining) continue;
        const limit = current
          ? effectiveLimitAt(lines.length)
          : Math.max(effectiveLimitAt(lines.length), singleWordLimit);
        if (enableHyphenation && canHyphenateWord(remaining) && measureText(remaining) > limit * 1.05) {
          if (current) pushLine();
          const broken = breakWordIntoHyphenatedLines(
            remaining,
            measureText,
            effectiveLimitAt,
            lines.length,
          );
          if (broken.overflow) wordOverflow = true;
          for (let i = 0; i < broken.lines.length - 1; i++) {
            current = broken.lines[i];
            pushLine();
            if (isBulletParagraph) isContinuationLine = true;
          }
          current = broken.lines[broken.lines.length - 1];
          continue;
        }
        if (measureText(remaining) > limit * 1.05) wordOverflow = true;
        current += remaining;
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
  enableHyphenation = false,
  scanlineRatios?: number[],
): boolean {
  const hasScanlines = Boolean(scanlineRatios && scanlineRatios.length > 0);
  const safeWidthPx = Math.max(1, widthPx * 0.88);
  const singleWordLimit = singleWordAllowedWidth(safeWidthPx, fontSizePx, isOval, scanlineRatios);
  return lines.every((line, lineIndex) => {
    if ((!isOval && !hasScanlines) || (lines.length <= 1 && !hasScanlines)) return measureText(line) <= safeWidthPx * 1.05;
    const chordWidth = allowedWidthAt(lineIndex, lines.length, safeWidthPx, fontSizePx, isOval, scanlineRatios);
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
  const structuredList = isStructuredMangaList(input.text);
  const effectiveText = structuredList ? formatStructuredMangaText(input.text) : input.text;
  const hasScanlines = Boolean(input.scanlineRatios && input.scanlineRatios.length > 0);
  const effectiveIsOval = (input.isOval || hasScanlines) && !structuredList;
  const safeWidthPx = Math.max(1, finiteWidth * 0.88);
  const graphemeCount = graphemesOf(effectiveText).length;
  const maxCandidates = effectiveIsOval
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
      effectiveText,
      candidateLineCount,
      safeWidthPx,
      finiteFontSize,
      effectiveIsOval,
      locale,
      input.measureText,
      input.enableHyphenation,
      input.scanlineRatios,
    );
    chosenLines = attempt.lines;
    wordOverflow = attempt.wordOverflow;

    if (fallbackLines === null && (!effectiveIsOval || chosenLines.length <= candidateLineCount)) {
      fallbackLines = chosenLines;
      fallbackWordOverflow = wordOverflow;
      crossoverCandidate = candidateLineCount;
    }

    const actualChordsFit = linesFitTheirChords(
      chosenLines,
      finiteWidth,
      finiteFontSize,
      effectiveIsOval,
      locale,
      input.measureText,
      input.enableHyphenation,
      input.scanlineRatios,
    );

    if ((!effectiveIsOval || chosenLines.length <= candidateLineCount) && actualChordsFit && !wordOverflow) {
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

  const extraSectionGapPx = structuredList
    ? chosenLines.reduce((sum, line, idx) => {
        if (idx > 0 && isStructuredSectionHeaderLine(line)) {
          return sum + finiteFontSize * 0.35;
        }
        return sum;
      }, 0)
    : 0;
  const requiredHeightPx = chosenLines.length === 0
    ? 0
    : Math.ceil(((chosenLines.length * finiteFontSize * (structuredList ? 1.38 : 1.30)) + extraSectionGapPx) / 0.88);
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
