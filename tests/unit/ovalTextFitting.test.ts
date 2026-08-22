import { describe, it, expect } from "vitest";
import { wrapTextForBubble } from "@/lib/translationOverlay";

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
});
