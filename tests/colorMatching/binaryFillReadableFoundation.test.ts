import { describe, expect, it } from "vitest";
import { resolveBubbleTextStyle, selectAdaptiveReadableStyle } from "@/lib/colorMatching/resolveTextStyle";
import type { TranslatedBubble } from "@/lib/translationOverlay";
import type { TextStyleProfile } from "@/lib/colorMatching/types";

describe("Ticket 18: Binary Fill Readable Foundation", () => {
  it("emits only pure white or pure black glyph fill in selectAdaptiveReadableStyle", () => {
    const darkBgStyle = selectAdaptiveReadableStyle({
      backgroundLuminance: 40,
    });
    expect(darkBgStyle.textColor).toBe("#ffffff");
    expect(darkBgStyle.hasOutline).toBe(true);

    const brightBgStyle = selectAdaptiveReadableStyle({
      backgroundLuminance: 220,
    });
    expect(brightBgStyle.textColor).toBe("#000000");
    expect(brightBgStyle.hasOutline).toBe(true);
  });

  it("never emits chromatic fill in Readable fallback even if source profile has chromatic fill", () => {
    const bubble: TranslatedBubble = {
      id: 1,
      t: "ข้อความทดสอบ",
      styleProfile: {
        fill: "#ff0077", // Chromatic pink
        outline: "#ffffff",
        source: "fallback",
        fallbackReason: "background-contamination",
        evidenceState: "rejected",
        backgroundLuminance: 240,
      } as TextStyleProfile,
    };

    const resolved = resolveBubbleTextStyle(bubble);
    expect(["#000000", "#ffffff"]).toContain(resolved.textColor);
    expect(resolved.hasOutline).toBe(true);
  });

  it("preserves authored fill and no-outline for validated source-faithful text", () => {
    const bubble: TranslatedBubble = {
      id: 2,
      t: "คำพูดธรรมดา",
      styleProfile: {
        fill: "#123456",
        outline: "#ffffff",
        hasOutline: false,
        outlineWidthRatio: 0,
        source: "auto",
        fillConfidence: 0.95,
        outlineConfidence: 0.95,
        evidenceState: "admitted",
      } as TextStyleProfile,
    };

    const resolved = resolveBubbleTextStyle(bubble, {}, { minConfidence: 0.8 });
    expect(resolved.textColor).toBe("#123456");
    expect(resolved.hasOutline).toBe(false);
    expect(resolved.outlineWidthRatio).toBe(0);
  });

  it("preserves manual ownership without converting to Binary Fill or forcing outline", () => {
    const bubble: TranslatedBubble = {
      id: 3,
      t: "ข้อความกำหนดเอง",
      styleProfile: {
        fill: "#e91e63",
        outline: "#000000",
        hasOutline: false,
        outlineWidthRatio: 0,
        source: "manual",
        ownershipMode: "manual",
      } as TextStyleProfile,
    };

    const resolved = resolveBubbleTextStyle(bubble);
    expect(resolved.textColor).toBe("#e91e63");
    expect(resolved.hasOutline).toBe(false);
  });

  it("explicit Readable mode emits pure white or pure black and always has an outline", () => {
    const bubble: TranslatedBubble = {
      id: 4,
      t: "โหมดอ่านง่าย",
      styleProfile: {
        fill: "#4caf50",
        outline: "#000000",
        ownershipMode: "readable",
        source: "auto",
        backgroundLuminance: 50,
      } as TextStyleProfile,
    };

    const resolved = resolveBubbleTextStyle(bubble);
    expect(resolved.textColor).toBe("#ffffff");
    expect(resolved.hasOutline).toBe(true);
    expect(resolved.isAdaptiveReadable).toBe(true);
  });

  it("preserves validated decorative effects for admitted source profiles", () => {
    const bubble: TranslatedBubble = {
      id: 5,
      t: "เอฟเฟกต์พิเศษ",
      styleProfile: {
        fill: "#ff5722",
        outline: "#ffffff",
        hasOutline: true,
        source: "auto",
        fillConfidence: 0.92,
        outlineConfidence: 0.92,
        evidenceState: "admitted",
        glow: {
          color: "#ffeb3b",
          opacity: 0.8,
          blurRatio: 0.3,
          offsetXRatio: 0,
          offsetYRatio: 0,
        },
      } as TextStyleProfile,
    };

    const resolved = resolveBubbleTextStyle(bubble);
    expect(resolved.textColor).toBe("#ff5722");
    expect(resolved.glow).toBeDefined();
    expect(resolved.glow?.color).toBe("#ffeb3b");
  });
});
