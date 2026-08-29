import { describe, expect, it } from "vitest";
import {
  clampConfidence,
  createDefaultStyleProfile,
  normalizeCssColor,
  type ColorSampleRegion,
  type TextStyleProfile,
} from "@/lib/colorMatching/types";
import type { TranslatedBubble } from "@/lib/translationOverlay";

describe("Color Matching Types & Normalization Contract", () => {
  it("normalizes hex and rgb/rgba colors accurately", () => {
    expect(normalizeCssColor("#fff")).toBe("#ffffff");
    expect(normalizeCssColor("#FF00aa")).toBe("#ff00aa");
    expect(normalizeCssColor("rgb(255, 0, 128)")).toBe("#ff0080");
    expect(normalizeCssColor("rgba(0, 255, 0, 0.5)")).toBe("rgba(0, 255, 0, 0.5)");
    expect(normalizeCssColor("invalid-color", "#000000")).toBe("#000000");
  });

  it("clamps confidence values between 0.0 and 1.0", () => {
    expect(clampConfidence(1.2)).toBe(1.0);
    expect(clampConfidence(-0.5)).toBe(0.0);
    expect(clampConfidence(0.854)).toBe(0.854);
    expect(clampConfidence(Number.NaN)).toBe(0.0);
  });

  it("creates a valid default TextStyleProfile", () => {
    const profile: TextStyleProfile = createDefaultStyleProfile("global");
    expect(profile.fill).toBe("#000000");
    expect(profile.outline).toBe("#ffffff");
    expect(profile.fillConfidence).toBe(1.0);
    expect(profile.outlineConfidence).toBe(1.0);
    expect(profile.source).toBe("global");
  });

  it("supports TranslatedBubble without styleProfile backwards-compatibly", () => {
    const legacyBubble: TranslatedBubble = {
      box: [100, 100, 200, 200],
      original_text: "テスト",
      translated_text: "ทดสอบ",
    };
    expect(legacyBubble.styleProfile).toBeUndefined();

    const profiledBubble: TranslatedBubble = {
      ...legacyBubble,
      styleProfile: {
        fill: "#ff3366",
        outline: "#ffffff",
        fillConfidence: 0.95,
        outlineConfidence: 0.88,
        source: "auto",
      },
    };
    expect(profiledBubble.styleProfile?.fill).toBe("#ff3366");
    expect(profiledBubble.styleProfile?.source).toBe("auto");
  });

  it("validates ColorSampleRegion typed structure", () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
    const region: ColorSampleRegion = {
      width: 2,
      height: 1,
      rgba,
    };
    expect(region.width).toBe(2);
    expect(region.height).toBe(1);
    expect(region.rgba.length).toBe(8);
  });
});
