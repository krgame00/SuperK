import { describe, expect, it } from "vitest";
import { layoutTextAtFixedFont } from "@/lib/textBoxWidthLayout";

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

  it("breaks an overlong token into graphemes without losing text", () => {
    const text = "supercalifragilistic";
    const layout = layoutTextAtFixedFont({ ...base, text, fontSizePx: 10, widthPx: 45 });

    expect(layout.lines.length).toBeGreaterThan(1);
    expect(layout.lines.join("")).toBe(text);
    expect(layout.overflow).toBe(false);
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
    const text = "abcdefghij";
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
});
