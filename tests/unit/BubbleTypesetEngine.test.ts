import { describe, expect, it } from "vitest";
import {
  fitTextToBubbleContour,
  segmentThaiAwareTokens,
  type BubbleShapeInput,
} from "../../lib/typeset/BubbleTypesetEngine";

describe("BubbleTypesetEngine", () => {
  it("segments Thai text and binds sticky punctuation to the preceding token", () => {
    const raw = "พูดอะไรน่ะ!? ไม่จริงใช่ไหม...";
    const tokens = segmentThaiAwareTokens(raw);

    // Sticky punctuation like !? and ... should attach to the word preceding them
    expect(tokens.some((t) => t.includes("!?"))).toBe(true);
    expect(tokens.some((t) => t.includes("..."))).toBe(true);
    // Punctuation should not exist as a standalone token
    expect(tokens.includes("!?")).toBe(false);
    expect(tokens.includes("...")).toBe(false);
  });

  it("fits text into a circular/oval bubble using scanline chord ratios", () => {
    // 100x100 oval bubble: slices in the middle are wide (1.0), top and bottom are narrow (0.4)
    const bubble: BubbleShapeInput = {
      x: 50,
      y: 50,
      width: 100,
      height: 100,
      scanlineRatios: [
        0.4, 0.5, 0.7, 0.85, 0.95, 1.0, 1.0, 0.95, 0.85, 0.7, 0.5, 0.4,
      ],
    };

    // Mock measurement function: each char takes ~0.6 * fontSize in width
    const measureFn = (text: string, fontSize: number, _fontFamily?: string) => text.length * fontSize * 0.6;

    const result = fitTextToBubbleContour(
      measureFn,
      "นี่คือการทดสอบจัดหน้าตามทรงบอลลูนจริง",
      bubble,
      "Noto Sans Thai",
      12,
      36
    );

    expect(result.fontSize).toBeGreaterThanOrEqual(12);
    expect(result.fontSize).toBeLessThanOrEqual(36);
    expect(result.lines.length).toBeGreaterThan(0);

    // Each line should not exceed its slice's allowed maxWidth
    for (const line of result.lines) {
      const lineW = measureFn(line.text, result.fontSize, "Noto Sans Thai");
      expect(lineW).toBeLessThanOrEqual(line.maxWidth + 1.0);
    }
  });

  it("centers formatted text lines within the bubble geometry", () => {
    const bubble: BubbleShapeInput = {
      x: 100,
      y: 200,
      width: 150,
      height: 120,
      scanlineRatios: [1.0, 1.0, 1.0, 1.0],
    };

    const measureFn = (text: string, fontSize: number) => text.length * fontSize * 0.5;

    const result = fitTextToBubbleContour(
      measureFn,
      "ทดสอบการจัดกึ่งกลาง",
      bubble,
      "Noto Sans Thai",
      16,
      24
    );

    expect(result.lines.length).toBeGreaterThan(0);
    // X center should match bubble horizontal center (100 + 150 / 2 = 175)
    for (const line of result.lines) {
      expect(line.x).toBe(175);
    }
    // Y coordinates should be inside bubble vertical span [200, 320]
    for (const line of result.lines) {
      expect(line.y).toBeGreaterThanOrEqual(200);
      expect(line.y).toBeLessThanOrEqual(320);
    }
  });
});
