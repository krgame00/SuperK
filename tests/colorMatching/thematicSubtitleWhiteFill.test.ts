import { describe, expect, it } from "vitest";
import { resolveBubbleTextStyle } from "@/lib/colorMatching/resolveTextStyle";
import type { TranslatedBubble, OverlayTextStyle } from "@/lib/translationOverlay";
import type { TextStyleProfile } from "@/lib/colorMatching/types";

describe("ADR 0011: Thematic Subtitle Pattern (White Fill + Chromatic Outline)", () => {
  const globalStyle: OverlayTextStyle = {
    textColor: "#000000",
    textOutline: "#ffffff",
  };

  it("converts chromatic text over artwork (cyan dialogue) to white fill with chromatic outline", () => {
    // The exact case from "ANYONE COULD SEE US FROM HERE"
    const cyanProfile: TextStyleProfile = {
      fill: "#65aad6",
      outline: "#ffffff",
      hasOutline: true,
      outlineWidthRatio: 0.12,
      source: "auto",
      evidenceState: "admitted",
      fillConfidence: 0.95,
      outlineConfidence: 0.90,
      backgroundLuminance: 88,
      backgroundColor: "#77475c",
    };

    const bubble: TranslatedBubble = {
      box: [520, 800, 640, 960],
      original_text: "ANYONE COULD SEE US FROM HERE",
      translated: "ใครๆ ก็มองเห็นพวกเราได้จากตรงนี้นะ",
      styleProfile: cyanProfile,
    };

    const resolved = resolveBubbleTextStyle(bubble, globalStyle);

    // White fill for maximum readability, cyan outline for character identity
    expect(resolved.textColor).toBe("#ffffff");
    expect(resolved.textOutline).toBe("#65aad6");
    expect(resolved.hasOutline).toBe(true);
    expect(resolved.outlineWidthRatio).toBeGreaterThanOrEqual(0.14);
  });

  it("converts conversational dialogue misclassified as sfx to white fill with chromatic outline", () => {
    // OCR/LLM often tags floating dialogue without balloon boundary as 'sfx'
    const sfxDialogueProfile: TextStyleProfile = {
      fill: "#00a2ff",
      outline: "#ffffff",
      hasOutline: true,
      outlineWidthRatio: 0.12,
      source: "auto",
      evidenceState: "admitted",
      fillConfidence: 0.95,
      outlineConfidence: 0.90,
      backgroundLuminance: 25,
      category: "sfx",
    };

    const bubble: TranslatedBubble = {
      box: [100, 100, 300, 300],
      original_text: "Hi there gorgeous~ Surprise!",
      translated: "ไฮจ้า คนสวย~ เซอร์ไพรส์! ทายสิว่าใครเล่นหมดหน้าตักจนเสียเงินของคณะทูตไปเกลี้ยงเลย~",
      styleProfile: sfxDialogueProfile,
      styleCategory: "sfx",
    };

    const resolved = resolveBubbleTextStyle(bubble, globalStyle);

    expect(resolved.textColor).toBe("#ffffff");
    expect(resolved.textOutline).toBe("#00a2ff");
    expect(resolved.hasOutline).toBe(true);
    expect(resolved.outlineWidthRatio).toBeGreaterThanOrEqual(0.14);
  });

  it("converts chromatic text with matching/missing outline to white fill with chromatic outline", () => {
    // Text where outline was not separated or legacy identical
    const magentaProfile: TextStyleProfile = {
      fill: "#ff3399",
      outline: "#ff3399",
      hasOutline: false,
      source: "auto",
      evidenceState: "admitted",
      fillConfidence: 0.90,
      backgroundLuminance: 45,
    };

    const bubble: TranslatedBubble = {
      box: [200, 600, 300, 800],
      translated: "พวกแกห่วงชื่อเสียงของนางกันเหรอเนี่ย?",
      styleProfile: magentaProfile,
    };

    const resolved = resolveBubbleTextStyle(bubble, globalStyle);

    expect(resolved.textColor).toBe("#ffffff");
    expect(resolved.textOutline).toBe("#ff3399");
    expect(resolved.hasOutline).toBe(true);
    expect(resolved.outlineWidthRatio).toBeGreaterThanOrEqual(0.14);
  });

  it("preserves white text with chromatic outline as white fill + chromatic outline", () => {
    // White text with blue outline from artwork
    const whiteBlueProfile: TextStyleProfile = {
      fill: "#ffffff",
      outline: "#0088ff",
      hasOutline: true,
      outlineWidthRatio: 0.15,
      source: "auto",
      evidenceState: "admitted",
      backgroundLuminance: 60,
    };

    const bubble: TranslatedBubble = {
      box: [100, 700, 200, 900],
      translated: "ไฮจ้า คนสวย~ เซอร์ไพรส์!",
      styleProfile: whiteBlueProfile,
    };

    const resolved = resolveBubbleTextStyle(bubble, globalStyle);

    expect(resolved.textColor).toBe("#ffffff");
    expect(resolved.textOutline).toBe("#0088ff");
    expect(resolved.hasOutline).toBe(true);
    expect(resolved.outlineWidthRatio).toBe(0.15);
  });

  it("preserves standard dark text in white speech balloons (no conversion to white)", () => {
    const whiteBalloonProfile: TextStyleProfile = {
      fill: "#000000",
      outline: "#ffffff",
      hasOutline: true,
      outlineWidthRatio: 0.12,
      source: "auto",
      evidenceState: "admitted",
      backgroundLuminance: 245,
      backgroundColor: "#ffffff",
      category: "dialogue",
    };

    const bubble: TranslatedBubble = {
      box: [100, 100, 250, 250],
      translated: "บทพูดในบอลลูนขาวปกติ",
      styleProfile: whiteBalloonProfile,
    };

    const resolved = resolveBubbleTextStyle(bubble, globalStyle);

    // Standard dialogue inside white balloon MUST remain dark text
    expect(resolved.textColor).toBe("#000000");
  });

  it("preserves authored high-contrast dark outline around bright fills", () => {
    // Bright yellow with solid black outline
    const yellowBlackProfile: TextStyleProfile = {
      fill: "#ffee00",
      outline: "#000000",
      hasOutline: true,
      outlineWidthRatio: 0.18,
      source: "auto",
      evidenceState: "admitted",
      category: "overlay_subtitle",
    };

    const bubble: TranslatedBubble = {
      box: [800, 100, 860, 600],
      category: "overlay_subtitle",
      styleProfile: yellowBlackProfile,
    };

    const resolved = resolveBubbleTextStyle(bubble, globalStyle);

    expect(resolved.textColor).toBe("#ffee00");
    expect(resolved.textOutline).toBe("#000000");
  });

  it("strictly preserves manual user override", () => {
    const manualBubble: TranslatedBubble = {
      box: [100, 100, 200, 200],
      translated: "ข้อความกำหนดเอง",
      styleProfile: {
        fill: "#22c55e",
        outline: "#3b82f6",
        hasOutline: true,
        outlineWidthRatio: 0.10,
        source: "manual",
        ownershipMode: "manual",
      },
    };

    const resolved = resolveBubbleTextStyle(manualBubble, globalStyle);

    expect(resolved.textColor).toBe("#22c55e");
    expect(resolved.textOutline).toBe("#3b82f6");
    expect(resolved.outlineWidthRatio).toBe(0.10);
  });
});
