import { describe, expect, it } from "vitest";
import {
  resolveBubbleTextStyle,
  STANDARD_TRANSLATED_TEXT_SHADOW,
  SUBTLE_ARTWORK_SHADOW,
} from "@/lib/colorMatching/resolveTextStyle";
import type { TranslatedBubble } from "@/lib/translationOverlay";

const expectSubtleShadow = (bubble: TranslatedBubble) => {
  const resolved = resolveBubbleTextStyle(bubble);
  expect(resolved.shadow).toEqual(SUBTLE_ARTWORK_SHADOW);
  expect(resolved.glow).toBeUndefined();
  expect(resolved.readabilityHalo).toBeUndefined();
  return resolved;
};

describe("ADR 0015 Uniform translated text shadow", () => {
  it("uses subtle artwork shadows, clean dialogue, and authoritative Original styling", () => {
    const bubbles: TranslatedBubble[] = [
      {
        id: "auto",
        box: [100, 100, 200, 300],
        styleProfile: {
          fill: "#ffffff",
          outline: "#ff3366",
          source: "auto",
          ownershipMode: "auto",
          evidenceState: "admitted",
          fillConfidence: 0.95,
          outlineConfidence: 0.95,
          sourceAccentColor: "#ff3366",
          shadow: { color: "#00ff00", opacity: 1, blurRatio: 0.5, offsetXRatio: 0.3, offsetYRatio: 0.3 },
          glow: { color: "#00ffff", opacity: 1, blurRatio: 0.5, offsetXRatio: 0, offsetYRatio: 0 },
        },
      },
      {
        id: "fallback",
        box: [100, 100, 200, 300],
        styleProfile: {
          fill: "#aaaaaa",
          outline: "#aaaaaa",
          source: "fallback",
          ownershipMode: "auto",
          evidenceState: "rejected",
          fallbackReason: "low-readability",
          requiresHaloEscalation: true,
        },
      },
      {
        id: "readable",
        box: [100, 100, 200, 300],
        styleProfile: {
          fill: "#ffffff",
          outline: "#000000",
          source: "fallback",
          ownershipMode: "readable",
          requiresHaloEscalation: true,
        },
      },
      {
        id: "source-faithful",
        box: [100, 100, 200, 300],
        styleProfile: {
          fill: "#ffee00",
          outline: "#111111",
          source: "auto",
          ownershipMode: "source_faithful",
          evidenceState: "admitted",
          glow: { color: "#ffee00", opacity: 0.9, blurRatio: 0.4, offsetXRatio: 0, offsetYRatio: 0 },
        },
      },
      {
        id: "plain-dialogue",
        box: [100, 100, 200, 300],
        styleProfile: {
          fill: "#111111",
          outline: "#ffffff",
          source: "auto",
          ownershipMode: "auto",
          evidenceState: "admitted",
          backgroundLuminance: 255,
        },
      },
    ];

    const expected = [SUBTLE_ARTWORK_SHADOW, undefined, undefined, STANDARD_TRANSLATED_TEXT_SHADOW, undefined];
    bubbles.forEach((bubble,index) => expect(resolveBubbleTextStyle(bubble).shadow).toEqual(expected[index]));
  });

  it("keeps legacy source effects as metadata while automatic rendering ignores them", () => {
    const shadow = { color: "#123456", opacity: 0.2, blurRatio: 0.6, offsetXRatio: 0.4, offsetYRatio: 0.4 };
    const glow = { color: "#abcdef", opacity: 0.9, blurRatio: 0.8, offsetXRatio: 0, offsetYRatio: 0 };
    const bubble: TranslatedBubble = {
      styleProfile: {
        fill: "#ffffff",
        outline: "#ff00aa",
        source: "auto",
        ownershipMode: "auto",
        evidenceState: "admitted",
        fillConfidence: 0.95,
        outlineConfidence: 0.95,
        sourceAccentColor: "#ff00aa",
        shadow,
        glow,
        readabilityHalo: { color: "#000000", opacity: 0.5, blurRatio: 0.5, offsetXRatio: 0, offsetYRatio: 0 },
      },
    };

    expectSubtleShadow(bubble);
    expect(bubble.styleProfile?.shadow).toEqual(shadow);
    expect(bubble.styleProfile?.glow).toEqual(glow);
    expect(bubble.styleProfile?.readabilityHalo).toBeDefined();
  });

  it("defaults Manual to Standard and respects explicit Manual Off", () => {
    const manualBase: TranslatedBubble = {
      styleProfile: {
        fill: "#123456",
        outline: "#ffffff",
        source: "manual",
        ownershipMode: "manual",
      },
    };
    expect(resolveBubbleTextStyle(manualBase).shadow).toEqual(STANDARD_TRANSLATED_TEXT_SHADOW);

    const manualOff: TranslatedBubble = {
      styleProfile: {
        ...manualBase.styleProfile!,
        manualShadowMode: "off",
      },
    };
    expect(resolveBubbleTextStyle(manualOff).shadow).toBeUndefined();
  });

  it("keeps plain dialogue clean on both color and monochrome pages", () => {
    const colorBubble: TranslatedBubble = {
      styleProfile: {
        fill: "#111111",
        outline: "#ffffff",
        source: "auto",
        ownershipMode: "auto",
        evidenceState: "admitted",
        backgroundLuminance: 255,
        isMonochromePage: false,
      },
    };
    expect(resolveBubbleTextStyle(colorBubble).shadow).toBeUndefined();

    const monoBubble: TranslatedBubble = {
      styleProfile: {
        fill: "#111111",
        outline: "#ffffff",
        source: "auto",
        ownershipMode: "auto",
        evidenceState: "admitted",
        backgroundLuminance: 255,
        isMonochromePage: true,
        monochromeConfidence: 0.95,
        category: "dialogue",
      },
    };
    expect(resolveBubbleTextStyle(monoBubble).shadow).toBeUndefined();
  });
});
