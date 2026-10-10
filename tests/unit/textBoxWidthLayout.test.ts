import { describe, expect, it } from "vitest";
import {
  layoutTextAtFixedFont,
  minimumWidthForWholeWords,
} from "@/lib/textBoxWidthLayout";

const measureByGrapheme = (value: string) => [...value].length * 10;

describe("layoutTextAtFixedFont", () => {
  const base = {
    text: "หนึ่งสองสามสี่ห้าหก",
    fontSizePx: 20,
    fontFamily: "sans-serif",
    manualMinHeightPx: 0,
    availableHeightPx: 500,
    isOval: false,
    measureText: measureByGrapheme,
  };

  it("reflows by width while keeping font size fixed and deriving height from line count", () => {
    const wide = layoutTextAtFixedFont({ ...base, widthPx: 240 });
    const narrow = layoutTextAtFixedFont({ ...base, widthPx: 60 });
    const wideAgain = layoutTextAtFixedFont({ ...base, widthPx: 240 });

    expect(narrow.fontSizePx).toBe(wide.fontSizePx);
    expect(narrow.lines.length).toBeGreaterThan(wide.lines.length);
    expect(narrow.heightPx).toBeGreaterThan(wide.heightPx);
    expect(wideAgain.lines).toEqual(wide.lines);
    expect(wideAgain.heightPx).toBe(wide.heightPx);
    expect(narrow.overflow).toBe(false);
  });

  it("keeps an overlong token intact and reports overflow", () => {
    const text = "supercalifragilistic";
    const layout = layoutTextAtFixedFont({ ...base, text, fontSizePx: 10, widthPx: 45 });

    expect(layout.lines).toEqual([text]);
    expect(layout.overflow).toBe(true);
  });

  it("wraps at language-aware word boundaries and keeps trailing punctuation attached", () => {
    const layout = layoutTextAtFixedFont({
      ...base,
      text: "one, two three",
      fontSizePx: 10,
      widthPx: 65,
      locale: "en",
    });

    expect(layout.lines).toEqual(["one,", "two", "three"]);
    expect(layout.overflow).toBe(false);
  });

  it("measures the minimum rectangular width from the widest complete word", () => {
    const minimumWidth = minimumWidthForWholeWords({
      text: "tiny longest",
      fontSizePx: 10,
      isOval: false,
      locale: "en",
      measureText: measureByGrapheme,
    });

    expect(minimumWidth).toBe(80);
  });

  it("accounts for the oval chord when measuring the word-width floor", () => {
    const input = {
      text: "abc def",
      fontSizePx: 10,
      locale: "en",
      measureText: measureByGrapheme,
    };
    const rectangularFloor = minimumWidthForWholeWords({ ...input, isOval: false });
    const ovalFloor = minimumWidthForWholeWords({ ...input, isOval: true });

    expect(ovalFloor).toBeGreaterThan(rectangularFloor);
  });

  it("keeps whitespace tokens whole when language segmentation is unavailable", () => {
    const layout = layoutTextAtFixedFont({
      ...base,
      text: "alpha,beta gamma",
      fontSizePx: 10,
      widthPx: 45,
      locale: "not_a_locale",
    });

    expect(layout.lines).toEqual(["alpha,beta", "gamma"]);
    expect(layout.overflow).toBe(true);
  });

  it("uses a bounded oval chord calculation for each resulting line", () => {
    const layout = layoutTextAtFixedFont({ ...base, widthPx: 120, isOval: true });
    const safeWidth = 120 * 0.88;
    const allLinesFitTheirChords = layout.lines.every((line, index) => {
      const vertical = ((index + 0.5) / layout.lines.length - 0.5) * 2;
      const chordWidth = safeWidth * Math.sqrt(Math.max(0.2, 1 - vertical * vertical)) * 0.95;
      return measureByGrapheme(line) <= chordWidth * 1.05;
    });

    expect(layout.lines.length).toBeLessThanOrEqual(256);
    expect(allLinesFitTheirChords).toBe(true);
  });

  it("preserves a manual minimum height and reports page-bottom overflow", () => {
    const text = "abc def ghi";
    const manualHeight = layoutTextAtFixedFont({
      ...base, text, fontSizePx: 10, widthPx: 40, manualMinHeightPx: 120,
    });
    const pageClipped = layoutTextAtFixedFont({
      ...base, text, fontSizePx: 10, widthPx: 40, manualMinHeightPx: 120, availableHeightPx: 30,
    });

    expect(manualHeight.heightPx).toBe(120);
    expect(manualHeight.overflow).toBe(false);
    expect(pageClipped.heightPx).toBe(30);
    expect(pageClipped.overflow).toBe(true);
    expect(pageClipped.requiredHeightPx).toBeGreaterThan(30);
  });

  it("preserves explicit line breaks", () => {
    const text = "first\nsecond";
    const layout = layoutTextAtFixedFont({ ...base, text, fontSizePx: 10, widthPx: 200 });

    expect(layout.lines).toEqual(["first", "second"]);
  });

  it("keeps empty text empty and marks a grapheme wider than the column as overflow", () => {
    const empty = layoutTextAtFixedFont({ ...base, text: "  \n", widthPx: 120 });
    const tooWide = layoutTextAtFixedFont({
      ...base,
      text: "a",
      fontSizePx: 20,
      widthPx: 30,
      measureText: (value) => [...value].length * 30,
    });

    expect(empty.lines).toEqual([]);
    expect(empty.requiredHeightPx).toBe(0);
    expect(tooWide.overflow).toBe(true);
  });

  it("does not inflate oval whole-word minimum width or fail to settle on long multi-line Thai dialogue", () => {
    const text =
      "เปลี่ยน บรรยากาศจากตัว ตนที่ยอมจำนนของเธอ บ้างสิ! หลังจากนี้ เดี๋ยว เธอจะได้เป็นแม่คนใน พริบตาเดียวแน่ เชื่อฉันสิ!";
    const measureThai = (value: string) => [...value].length * 8.8;

    const rectFloor = minimumWidthForWholeWords({
      text,
      fontSizePx: 16,
      isOval: false,
      locale: "th",
      measureText: measureThai,
    });
    const ovalFloor = minimumWidthForWholeWords({
      text,
      fontSizePx: 16,
      isOval: true,
      locale: "th",
      measureText: measureThai,
    });

    expect(ovalFloor).toBeGreaterThan(rectFloor);
    expect(ovalFloor).toBeLessThanOrEqual(Math.ceil(rectFloor * 1.3));

    const wideLayout = layoutTextAtFixedFont({
      ...base,
      text,
      fontSizePx: 16,
      widthPx: 180,
      availableHeightPx: 1000,
      isOval: true,
      measureText: measureThai,
    });
    const narrowLayout = layoutTextAtFixedFont({
      ...base,
      text,
      fontSizePx: 16,
      widthPx: 120,
      availableHeightPx: 1000,
      isOval: true,
      measureText: measureThai,
    });

    expect(wideLayout.overflow).toBe(false);
    expect(narrowLayout.overflow).toBe(false);
    expect(narrowLayout.lines.length).toBeGreaterThan(wideLayout.lines.length);
    expect(narrowLayout.lines.every((line) => !line.includes("ตนที่ยอมจำนนของเธอ"))).toBe(true);
  });
});
