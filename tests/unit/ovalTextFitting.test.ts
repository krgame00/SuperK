import { describe, expect, it } from "vitest";
import {
  fitTextForBubble,
  fitTextInAdaptiveBubble,
  getReadableMinimumFontSize,
  wrapTextForBubble,
} from "@/lib/translationOverlay";

describe("wrapTextForBubble (Oval Text Fitting)", () => {
  it("wraps short text into single centered line", () => {
    const lines = wrapTextForBubble("สวัสดีครับ", 150, 80, 16, "sans-serif", true);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines.join("")).toContain("สวัสดีครับ");
  });

  it("wraps multi-word text into oval balanced lines", () => {
    const text = "นี่คือการทดสอบการจัดข้อความแบบทรงวงรีสำหรับมังงะและคอมมิค";
    const lines = wrapTextForBubble(text, 200, 150, 16, "sans-serif", true);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("").length).toBeGreaterThan(10);
  });

  it("handles rectangular fallback when oval is false", () => {
    const text = "คำอธิบายกล่องสี่เหลี่ยมแนวยาวแบบ Narration";
    const lines = wrapTextForBubble(text, 300, 60, 16, "sans-serif", false);
    expect(lines.length).toBeGreaterThanOrEqual(1);
  });

  it("keeps an oversized Thai word intact instead of splitting it", () => {
    const text = "อาจารย์";
    const lines = wrapTextForBubble(text, 15, 200, 16, "sans-serif", true);
    expect(lines).toEqual(["อาจารย์"]);
  });

  it("wraps multi-word Thai text at word boundaries without breaking words", () => {
    const text = "อาจารย์ครับ";
    const lines = wrapTextForBubble(text, 15, 200, 16, "sans-serif", true);
    expect(lines).toEqual(["อาจารย์", "ครับ"]);
  });

  it("preserves complete Thai words on narrow bubble without grapheme splitting", () => {
    const text = "ข้อความภาษาไทยในกล่องแคบ";
    const narrowWidth = 40;
    const lines = wrapTextForBubble(text, narrowWidth, 120, 18, "sans-serif", true);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("")).toBe(text);

    // Verify every line is an intact word segment from Intl.Segmenter
    const segmenter = new Intl.Segmenter("th", { granularity: "word" });
    const validWords = new Set(Array.from(segmenter.segment(text), s => s.segment));
    for (const line of lines) {
      expect(validWords.has(line) || line === text).toBe(true);
    }
  });

  it("wraps natural Thai sentences strictly at word segment boundaries", () => {
    const text = "ฉันไม่อยากให้ประโยคนี้ขาดกลางคำ";
    const segmenter = new Intl.Segmenter("th", { granularity: "word" });
    const validWords = new Set(Array.from(segmenter.segment(text), s => s.segment));
    const lines = wrapTextForBubble(text, 80, 150, 16, "sans-serif", true);

    expect(lines.join("")).toBe(text);
    for (const line of lines) {
      // Each line must be a whole word or a concatenation of whole words
      let remaining = line;
      while (remaining.length > 0) {
        let matched = false;
        for (const w of validWords) {
          if (remaining.startsWith(w)) {
            remaining = remaining.slice(w.length);
            matched = true;
            break;
          }
        }
        expect(matched).toBe(true);
      }
    }
  });

  it("keeps punctuation attached to preceding word where practical", () => {
    const text = "ฉันไม่รู้จริงๆ...";
    const lines = wrapTextForBubble(text, 100, 150, 16, "sans-serif", true);
    expect(lines.includes("...")).toBe(false);
  });

  it("keeps long unbroken Latin tokens intact as overflow without grapheme fragmentation", () => {
    const text = "SUPERLONGUNBREAKABLETOKEN";
    const lines = wrapTextForBubble(text, 20, 100, 16, "sans-serif", true);
    expect(lines).toEqual([text]);
  });
});

describe("fitTextForBubble", () => {
  it("grows short Thai text beyond the old height-based starting size", () => {
    const fit = fitTextForBubble("ครับ", 240, 120, "sans-serif", true, 1);

    expect(fit.fontSize).toBeGreaterThan(Math.round(120 * 0.35));
    expect(fit.lines).toEqual(["ครับ"]);
  });

  it("keeps long Thai text inside the padded bubble height", () => {
    const fit = fitTextForBubble(
      "นี่คือประโยคภาษาไทยที่ยาวและต้องตัดเป็นหลายบรรทัดให้อยู่ภายในบับเบิลโดยไม่ล้นออกมา",
      220,
      140,
      "sans-serif",
      true,
      1,
    );

    expect(fit.lines.length).toBeGreaterThan(1);
    expect(fit.lines.length * fit.lineHeight).toBeLessThanOrEqual(140 * 0.88);
  });

  it("preserves the font-size multiplier as a user-controlled cap", () => {
    const normal = fitTextForBubble("ครับ", 240, 120, "sans-serif", true, 1);
    const smaller = fitTextForBubble("ครับ", 240, 120, "sans-serif", true, 0.5);

    expect(smaller.fontSize).toBeLessThan(normal.fontSize);
  });

  it("fails fit (fits: false) when a line exceeds safe width even if height fits", () => {
    // Very narrow bubble with long single word
    const fit = fitTextForBubble(
      "คำยาวมากที่ไม่สามารถยัดลงกล่องแคบได้เลย",
      20,
      200,
      "sans-serif",
      true,
      1,
      16,
    );

    // Because width is 20 and minFontSize is 16, line width will exceed safeW (20 * 0.88 = 17.6)
    expect(fit.fits).toBe(false);
  });

  it("prefers Thai word overflow over splitting at minimum font size", () => {
    const fit = fitTextForBubble(
      "อาจารย์",
      20,
      200,
      "sans-serif",
      true,
      1,
      16,
    );

    expect(fit.fontSize).toBe(16);
    expect(fit.lines).toEqual(["อาจารย์"]);
    expect(fit.fits).toBe(false);
  });

  it("expands the bubble without fragmenting Thai words", () => {
    const text = "อาจารย์";
    const layout = fitTextInAdaptiveBubble(
      text,
      25,
      100,
      "sans-serif",
      true,
      1,
      16,
      2.5,
    );

    expect(layout.lines).toEqual([text]);
    expect(layout.width).toBeGreaterThanOrEqual(25);
  });

  it("expands a small OCR text box and keeps text readable on a high-resolution page", () => {
    const minimumFontSize = getReadableMinimumFontSize(1600);
    const layout = fitTextInAdaptiveBubble(
      "ฉันไล่ตามสิ่งที่สำคัญมานานแล้ว",
      120,
      100,
      "sans-serif",
      true,
      1,
      minimumFontSize,
    );

    expect(minimumFontSize).toBe(36);
    expect(layout.fontSize).toBeGreaterThanOrEqual(minimumFontSize);
    expect(layout.fits).toBe(true);
    expect(layout.width).toBeGreaterThan(120);
    expect(layout.height).toBeGreaterThan(100);
    expect(layout.width).toBeLessThanOrEqual(120 * 2.5);
    expect(layout.height).toBeLessThanOrEqual(100 * 2.5);
  });

  it("expands narrow vertical bubble adaptively instead of horizontal glyph compression", () => {
    const layout = fitTextInAdaptiveBubble(
      "ข้อความภาษาไทยในกล่องแนวตั้งแคบ",
      35,
      140,
      "sans-serif",
      true,
      1,
      14,
    );

    expect(layout.fits).toBe(true);
    expect(layout.width).toBeGreaterThan(35);
  });
});
