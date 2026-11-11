/**
 * Vertical Typography Engine (Tate-chū-gaki / 縦書き)
 *
 * Implements Item 3 of the Torii Competitive Analysis & Blueprint Roadmap:
 * - Typesets text vertically from Top to Bottom, with columns advancing from Right to Left.
 * - Handles Japanese, Chinese, and Korean (CJK) punctuation transformations:
 *     - Chōonpu (ー) prolonged sound mark mapping/rotation
 *     - Vertical ellipsis (…), parenthesis (), and bracket (「」) alignment
 * - Calculates column heights and widths constrained by contour scanline chords.
 * - Performs binary search for optimal vertical font size fitting within speech balloon bounds.
 *
 * Grounded in pstack principles:
 * - principle-model-the-domain: Typed VerticalColumn, VerticalGlyph, and VerticalTypesetResult.
 * - principle-fix-root-causes: Solves awkward horizontal text squishing in tall vertical manga balloons.
 * - principle-laziness-protocol: Pure closed-form 2D layout with zero external layout libraries.
 */

import { type BubbleShapeInput } from "./BubbleTypesetEngine";

export interface VerticalGlyph {
  char: string;
  y: number;
  rotateDeg?: number;
  offsetX?: number;
}

export interface VerticalColumn {
  index: number;
  x: number;
  startY: number;
  height: number;
  text: string;
  glyphs: VerticalGlyph[];
}

export interface VerticalTypesetResult {
  orientation: "vertical";
  fontSize: number;
  columnWidth: number;
  columns: VerticalColumn[];
  totalWidth: number;
  totalHeight: number;
}

/** Punctuation characters that rotate 90 degrees clockwise in vertical CJK text */
const ROTATED_PUNCTUATION = new Set([
  "ー", // U+30FC Katakana-Hiragana Prolonged Sound Mark
  "―", // U+2015 Horizontal Bar
  "-", // U+002D Hyphen
  "—", // U+2014 Em Dash
  "–", // U+2013 En Dash
  "…", // U+2026 Horizontal Ellipsis
  "(",
  ")",
  "（",
  "）",
  "[",
  "]",
  "【",
  "】",
  "{",
  "}",
  "~",
  "～",
]);

/** Punctuation characters that shift top-right in vertical text */
const TOP_RIGHT_PUNCTUATION = new Set([
  "、",
  "。",
  ",",
  ".",
]);

/**
 * Checks if a target language code typically benefits from vertical typesetting.
 */
export function isCJKLanguage(lang?: string): boolean {
  if (!lang) return false;
  const l = lang.toLowerCase().trim();
  return l === "ja" || l === "japanese" || l === "zh" || l === "chinese" || l === "ko" || l === "korean";
}

/**
 * Determines whether a speech bubble's aspect ratio suggests vertical text orientation.
 * Tall vertical bubbles (Height / Width >= 1.35) in CJK are traditionally vertical.
 */
export function shouldPreferVerticalTypesetting(
  bubbleWidth: number,
  bubbleHeight: number,
  targetLang?: string,
): boolean {
  if (!isCJKLanguage(targetLang)) {
    return false;
  }
  if (bubbleWidth <= 0) return false;
  const aspectRatio = bubbleHeight / bubbleWidth;
  return aspectRatio >= 1.35;
}

/**
 * Typesets CJK text vertically within a bubble contour.
 * Columns advance from Right to Left; characters within each column advance Top to Bottom.
 */
export function fitTextVertically(
  text: string,
  bubble: BubbleShapeInput,
  minFontSize = 10,
  maxFontSize = 48,
  columnWidthRatio = 1.3,
  charSpacingRatio = 1.05,
): VerticalTypesetResult {
  const cleanText = text.trim();
  if (!cleanText) {
    return {
      orientation: "vertical",
      fontSize: minFontSize,
      columnWidth: minFontSize * columnWidthRatio,
      columns: [],
      totalWidth: 0,
      totalHeight: 0,
    };
  }

  let low = minFontSize;
  let high = maxFontSize;
  let bestResult: VerticalTypesetResult | null = null;

  while (low <= high) {
    const midFont = Math.floor((low + high) / 2);
    const attempt = layoutVerticalAtFontSize(
      cleanText,
      bubble,
      midFont,
      columnWidthRatio,
      charSpacingRatio,
      false,
    );

    if (attempt !== null) {
      bestResult = attempt;
      low = midFont + 1; // Try larger font size
    } else {
      high = midFont - 1; // Reduce font size
    }
  }

  if (bestResult) return bestResult;

  // Fallback with force-fit at minFontSize
  return (
    layoutVerticalAtFontSize(
      cleanText,
      bubble,
      minFontSize,
      columnWidthRatio,
      charSpacingRatio,
      true,
    ) ?? {
      orientation: "vertical",
      fontSize: minFontSize,
      columnWidth: minFontSize * columnWidthRatio,
      columns: [],
      totalWidth: 0,
      totalHeight: 0,
    }
  );
}

function layoutVerticalAtFontSize(
  text: string,
  bubble: BubbleShapeInput,
  fontSize: number,
  columnWidthRatio: number,
  charSpacingRatio: number,
  forceFit = false,
): VerticalTypesetResult | null {
  const columnWidth = fontSize * columnWidthRatio;
  const charStep = fontSize * charSpacingRatio;

  // Maximum number of vertical columns that can fit horizontally in the bubble
  const maxColumnsPossible = Math.max(1, Math.floor(bubble.width / columnWidth));

  // Split text into characters, handling newline triggers
  const chars = Array.from(text);
  const columns: VerticalColumn[] = [];
  let charIdx = 0;

  // We lay out columns from Right to Left
  for (
    let colIdx = 0;
    colIdx < maxColumnsPossible && charIdx < chars.length;
    colIdx++
  ) {
    // Relative horizontal position for this column:
    // colIdx 0 is on the right side of the bubble
    const horizontalProgress =
      maxColumnsPossible > 1
        ? 1.0 - (colIdx + 0.5) / maxColumnsPossible
        : 0.5;

    // Scanline chord ratio at this horizontal position (or 0.85 safe ellipse padding)
    const ratioIdx = Math.min(
      bubble.scanlineRatios.length - 1,
      Math.floor(horizontalProgress * bubble.scanlineRatios.length),
    );
    const chordHeightRatio = bubble.scanlineRatios[ratioIdx] ?? 0.85;
    const availableColumnHeight = Math.max(charStep, bubble.height * chordHeightRatio);

    const maxCharsInThisColumn = Math.max(
      1,
      Math.floor(availableColumnHeight / charStep),
    );

    const columnChars: string[] = [];
    const glyphs: VerticalGlyph[] = [];

    let countInCol = 0;
    while (charIdx < chars.length && countInCol < maxCharsInThisColumn) {
      const c = chars[charIdx];
      charIdx++;

      if (c === "\n") {
        // Explicit paragraph break -> advance to next column
        if (columnChars.length === 0 && colIdx > 0) {
          // Empty column for paragraph gap
        }
        break;
      }

      if (/^\s$/.test(c) && columnChars.length === 0) {
        // Skip leading whitespace
        continue;
      }

      columnChars.push(c);
      countInCol++;
    }

    if (columnChars.length > 0) {
      const colText = columnChars.join("");
      const actualColHeight = columnChars.length * charStep;
      const startY = bubble.y + (bubble.height - actualColHeight) / 2 + charStep / 2;

      // Position each glyph in the column
      for (let i = 0; i < columnChars.length; i++) {
        const char = columnChars[i];
        const yPos = startY + i * charStep;
        let rotateDeg: number | undefined;
        let offsetX: number | undefined;

        if (ROTATED_PUNCTUATION.has(char)) {
          rotateDeg = 90;
        } else if (TOP_RIGHT_PUNCTUATION.has(char)) {
          offsetX = fontSize * 0.3;
        }

        glyphs.push({
          char,
          y: yPos,
          rotateDeg,
          offsetX,
        });
      }

      columns.push({
        index: colIdx,
        x: 0, // will be assigned after totalWidth is known
        startY,
        height: actualColHeight,
        text: colText,
        glyphs,
      });
    }
  }

  if (charIdx < chars.length && !forceFit) {
    return null;
  }

  const numColumns = columns.length;
  const totalWidth = numColumns * columnWidth;
  const totalHeight = Math.max(...columns.map((c) => c.height), charStep);

  // Center the block of columns horizontally within the bubble:
  // Rightmost column starts at bubble.x + (bubble.width + totalWidth) / 2 - columnWidth / 2
  const startX = bubble.x + (bubble.width + totalWidth) / 2 - columnWidth / 2;

  for (let i = 0; i < numColumns; i++) {
    // Columns advance from Right to Left: col 0 is at startX, col 1 is startX - columnWidth, etc.
    columns[i].x = startX - i * columnWidth;
  }

  return {
    orientation: "vertical",
    fontSize,
    columnWidth,
    columns,
    totalWidth,
    totalHeight,
  };
}
