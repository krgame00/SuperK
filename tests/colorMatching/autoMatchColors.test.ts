import { describe, expect, it } from "vitest";
import {
  preserveManualStyleProfiles,
  resolveBubbleTextStyle,
} from "@/lib/colorMatching/resolveTextStyle";
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

  it("applies matched color when confidence is high (>= 0.80)", () => {
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

  it("does not render a medium-confidence source guess before refinement has promoted it", () => {
    const bubble: TranslatedBubble = {
      box: [100, 100, 200, 200],
      styleProfile: {
        fill: "#774455",
        outline: "#332233",
        fillConfidence: 0.72,
        outlineConfidence: 0.70,
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

  it("falls back to global style when confidence is low (< 0.60)", () => {
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

  it("preserves a high-confidence source style without readability contrast correction", () => {
    const bubble: TranslatedBubble = {
      box: [100, 100, 200, 200],
      styleProfile: {
        fill: "#202020",
        outline: "#2a2a2a",
        hasOutline: false,
        outlineWidthRatio: 0,
        fillConfidence: 0.96,
        outlineConfidence: 0.94,
        source: "auto",
      },
    };

    const resolved = resolveBubbleTextStyle(bubble, globalStyle);

    expect(resolved.textColor).toBe("#202020");
    expect(resolved.textOutline).toBe("#2a2a2a");
    expect(resolved.hasOutline).toBe(false);
    expect(resolved.outlineWidthRatio).toBe(0);
    expect(resolved.source).toBe("auto");
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

  it("preserves manual style profile across re-translation by stable ID or geometric overlap", () => {
    const previousBubbles: TranslatedBubble[] = [
      {
        id: "bubble-1",
        box: [100, 100, 200, 200],
        original_text: "こんにちは",
        t: "สวัสดี",
        styleProfile: {
          fill: "#ff0088",
          outline: "#000000",
          hasOutline: true,
          outlineWidthRatio: 0.15,
          source: "manual",
          category: "dialogue",
        },
      },
    ];

    const nextBubbles: TranslatedBubble[] = [
      {
        id: "bubble-1",
        box: [102, 98, 204, 202],
        original_text: "こんにちは",
        t: "สวัสดีครับ", // re-translated text
        styleProfile: {
          fill: "#000000",
          outline: "#ffffff",
          source: "auto",
        },
      },
    ];

    const preserved = preserveManualStyleProfiles(nextBubbles, previousBubbles);
    expect(preserved[0].styleProfile?.source).toBe("manual");
    expect(preserved[0].styleProfile?.fill).toBe("#ff0088");
    expect(preserved[0].styleProfile?.outline).toBe("#000000");
  });
});
