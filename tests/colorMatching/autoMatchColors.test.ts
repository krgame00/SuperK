import { describe, expect, it } from "vitest";
import { resolveBubbleTextStyle } from "@/lib/colorMatching/resolveTextStyle";
import type { TranslatedBubble, OverlayTextStyle } from "@/lib/translationOverlay";

describe("autoMatchColors style resolution", () => {
  const globalStyle: OverlayTextStyle = {
    textColor: "#000000",
    textOutline: "#ffffff",
  };

  it("returns global style when auto-matching is disabled", () => {
    const bubble: TranslatedBubble = {
      box: [100, 100, 200, 200],
      original_text: "テキスト",
      translated_text: "ข้อความ",
      styleProfile: {
        fill: "#ff0077",
        outline: "#ffffff",
        fillConfidence: 0.95,
        outlineConfidence: 0.9,
        source: "auto",
      },
    };

    const resolved = resolveBubbleTextStyle(bubble, globalStyle, {
      autoMatchColors: false,
    });

    expect(resolved.textColor).toBe("#000000");
    expect(resolved.textOutline).toBe("#ffffff");
    expect(resolved.source).toBe("global");
  });

  it("applies matched color when confidence is high (>= 0.65)", () => {
    const bubble: TranslatedBubble = {
      box: [100, 100, 200, 200],
      original_text: "ピンク",
      translated_text: "สีชมพู",
      styleProfile: {
        fill: "#ff0077",
        outline: "#000000",
        fillConfidence: 0.88,
        outlineConfidence: 0.82,
        source: "auto",
      },
    };

    const resolved = resolveBubbleTextStyle(bubble, globalStyle, {
      autoMatchColors: true,
      autoMatchOutline: true,
    });

    expect(resolved.textColor).toBe("#ff0077");
    expect(resolved.textOutline).toBe("#000000");
    expect(resolved.source).toBe("auto");
  });

  it("falls back to global style when confidence is low (< 0.65)", () => {
    const bubble: TranslatedBubble = {
      box: [100, 100, 200, 200],
      original_text: "不確か",
      translated_text: "ไม่แน่ใจ",
      styleProfile: {
        fill: "#334455",
        outline: "#ffffff",
        fillConfidence: 0.45,
        outlineConfidence: 0.5,
        source: "auto",
      },
    };

    const resolved = resolveBubbleTextStyle(bubble, globalStyle, {
      autoMatchColors: true,
    });

    expect(resolved.textColor).toBe("#000000");
    expect(resolved.textOutline).toBe("#ffffff");
    expect(resolved.source).toBe("global");
  });

  it("prioritizes manual user styling regardless of confidence", () => {
    const bubble: TranslatedBubble = {
      box: [100, 100, 200, 200],
      original_text: "マニュアル",
      translated_text: "กำหนดเอง",
      styleProfile: {
        fill: "#00cc88",
        outline: "#111111",
        fillConfidence: 0.5, // low confidence
        source: "manual", // but explicitly manual
      },
    };

    const resolved = resolveBubbleTextStyle(bubble, globalStyle, {
      autoMatchColors: true,
    });

    expect(resolved.textColor).toBe("#00cc88");
    expect(resolved.textOutline).toBe("#111111");
    expect(resolved.source).toBe("manual");
  });
});
