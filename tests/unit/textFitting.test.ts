import { describe, expect, it } from "vitest";
import {
  fitTextForBubble,
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
});
