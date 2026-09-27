import { describe, expect, it } from "vitest";
import {
  fitTextForBubble,
  measureBubbleRenderFit,
  wrapTextForBubble,
} from "../../lib/translationOverlay";

describe("Text Fitting Narrow-Width & Word-Break (Ticket 01)", () => {
  it("reflows dialogue text into more lines as width is narrowed", () => {
    const text = "ทั้งที่ข้าอุตส่าห์แต่งตัวในแบบที่เจ้าชอบแท้ๆ";
    
    // Wide bubble (e.g. 240px)
    const wideFit = fitTextForBubble(text, 240, 100, "sans-serif", false, 1, 14);
    expect(wideFit.lines.length).toBeLessThanOrEqual(3);

    // Narrow bubble (e.g. 80px) with tall height (e.g. 300px)
    const narrowFit = fitTextForBubble(text, 80, 300, "sans-serif", false, 1, 14);
    expect(narrowFit.lines.length).toBeGreaterThanOrEqual(4);
    expect(narrowFit.lines.join("")).toBe(text);
  });

  it("breaks an individual long word when line width is narrower than the word", () => {
    // Single long Thai token
    const longWord = "มหาวิทยาลัย";
    // Narrow width (e.g. 35px) where full word cannot fit on a single line at 14px font
    const lines = wrapTextForBubble(longWord, 35, 200, 14, "sans-serif", false);
    
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe(longWord);
  });

  it("handles mixed English and Thai text in narrow vertical balloons", () => {
    const text = "Hello น้องสาว";
    const lines = wrapTextForBubble(text, 50, 150, 14, "sans-serif", false);
    
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.join("")).toContain("Hello");
  });

  it("keeps font size strictly locked when targetFontSize is specified, reflowing lines only", () => {
    const text = "ทั้งที่ข้าอุตส่าห์แต่งตัวในแบบที่เจ้าชอบแท้ๆ";
    const lockedFs = 16;
    
    // Narrow box: reflows into more lines
    const narrowFit = measureBubbleRenderFit(text, 80, 400, 1000, "sans-serif", 1, 1, false, lockedFs);
    expect(narrowFit.fontSize).toBe(lockedFs);
    expect(narrowFit.lines.length).toBeGreaterThanOrEqual(4);

    // Wide box: reflows into fewer lines without ballooning font size
    const wideFit = measureBubbleRenderFit(text, 300, 400, 1000, "sans-serif", 1, 1, false, lockedFs);
    expect(wideFit.fontSize).toBe(lockedFs);
    expect(wideFit.lines.length).toBeLessThan(narrowFit.lines.length);
  });
});
