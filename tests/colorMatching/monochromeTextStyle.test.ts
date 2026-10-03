import { describe, it, expect } from "vitest";
import {
  resolveBubbleTextStyle,
  STANDARD_TRANSLATED_TEXT_SHADOW,
  SUBTLE_ARTWORK_SHADOW,
} from "@/lib/colorMatching/resolveTextStyle";
import type { TranslatedBubble } from "@/lib/translationOverlay";
import type { TextStyleProfile } from "@/lib/colorMatching/types";

function makeBubble(profile: Partial<TextStyleProfile>, extra?: Partial<TranslatedBubble>): TranslatedBubble {
  return {
    id: "test-bubble",
    box: [100, 100, 200, 300],
    styleProfile: {
      fill: "#000000",
      outline: "#ffffff",
      source: "auto",
      ownershipMode: "auto",
      evidenceState: "admitted",
      fillConfidence: 0.95,
      outlineConfidence: 0.95,
      ...profile,
    },
    ...extra,
  };
}

describe("Monochrome Manga Text Style Policy (Task 3 - ADR 0016)", () => {
  it("resolves white/light speech balloon on monochrome page to black text without shadow", () => {
    const bubble = makeBubble({
      isMonochromePage: true,
      monochromeConfidence: 0.95,
      backgroundLuminance: 245,
      category: "dialogue",
    });
    const resolved = resolveBubbleTextStyle(bubble);
    expect(resolved.textColor).toBe("#000000");
    expect(resolved.hasOutline).toBe(false);
    expect(resolved.shadow).toBeUndefined();
    expect(resolved.glow).toBeUndefined();
  });

  it("keeps black text on a dark monochrome background without outline or shadow", () => {
    const bubble = makeBubble({
      isMonochromePage: true,
      monochromeConfidence: 0.95,
      backgroundLuminance: 20,
      category: "dialogue",
    });
    const resolved = resolveBubbleTextStyle(bubble);
    expect(resolved.textColor).toBe("#000000");
    expect(resolved.textOutline).toBe("#ffffff");
    expect(resolved.hasOutline).toBe(false);
    expect(resolved.outlineWidthRatio).toBeLessThanOrEqual(0.08);
    expect(resolved.shadow).toBeUndefined();
    expect(resolved.glow).toBeUndefined();
  });

  it("resolves narration on light background on monochrome page to black text without shadow", () => {
    const bubble = makeBubble({
      isMonochromePage: true,
      monochromeConfidence: 0.90,
      backgroundLuminance: 220,
      category: "narration",
    });
    const resolved = resolveBubbleTextStyle(bubble);
    expect(resolved.textColor).toBe("#000000");
    expect(resolved.shadow).toBeUndefined();
  });

  it("keeps black text on mixed grayscale background without outline or shadow", () => {
    const bubble = makeBubble({
      isMonochromePage: true,
      monochromeConfidence: 0.95,
      backgroundLuminance: 120,
      backgroundLuminanceSamples: [40, 180, 50, 190],
      category: "dialogue",
    });
    const resolved = resolveBubbleTextStyle(bubble);
    expect(resolved.textColor).toBe("#000000");
    expect(resolved.textOutline).toBe("#ffffff");
    expect(resolved.hasOutline).toBe(false);
    expect(resolved.outlineWidthRatio).toBe(0);
    expect(resolved.outlineWidthRatio).toBeLessThanOrEqual(0.08);
    expect(resolved.shadow).toBeUndefined();
  });

  it("keeps color and unknown page dialogue free of shadows", () => {
    const colorBubble = makeBubble({
      isMonochromePage: false,
      monochromeConfidence: 0.95,
      backgroundLuminance: 245,
      category: "dialogue",
    });
    const resolvedColor = resolveBubbleTextStyle(colorBubble);
    expect(resolvedColor.shadow).toBeUndefined();

    const unknownBubble = makeBubble({
      backgroundLuminance: 245,
      category: "dialogue",
    });
    const resolvedUnknown = resolveBubbleTextStyle(unknownBubble);
    expect(resolvedUnknown.shadow).toBeUndefined();
  });

  it("keeps plain dialogue clean even below monochrome confidence threshold", () => {
    const bubble = makeBubble({
      isMonochromePage: true,
      monochromeConfidence: 0.70,
      backgroundLuminance: 245,
      category: "dialogue",
    });
    const resolved = resolveBubbleTextStyle(bubble);
    expect(resolved.shadow).toBeUndefined();
  });

  it("honors Manual Standard shadow mode even on monochrome pages", () => {
    const bubble = makeBubble({
      isMonochromePage: true,
      monochromeConfidence: 0.98,
      source: "manual",
      ownershipMode: "manual",
      manualShadowMode: "standard",
      category: "dialogue",
    });
    const resolved = resolveBubbleTextStyle(bubble);
    expect(resolved.shadow).toEqual(STANDARD_TRANSLATED_TEXT_SHADOW);
  });

  it("honors Manual Off shadow mode on monochrome pages", () => {
    const bubble = makeBubble({
      isMonochromePage: true,
      monochromeConfidence: 0.98,
      source: "manual",
      ownershipMode: "manual",
      manualShadowMode: "off",
      category: "dialogue",
    });
    const resolved = resolveBubbleTextStyle(bubble);
    expect(resolved.shadow).toBeUndefined();
  });

  it("removes admitted SFX source effects on monochrome page", () => {
    const bubble = makeBubble({
      isMonochromePage: true,
      monochromeConfidence: 0.95,
      category: "sfx",
      fill: "#ff5500",
      outline: "#000000",
      evidenceState: "admitted",
    });
    const resolved = resolveBubbleTextStyle(bubble);
    expect(resolved.textColor).toBe("#000000");
  });

  it("preserves explicit Original styling on a monochrome page", () => {
    const bubble = makeBubble({
      isMonochromePage: true,
      monochromeConfidence: 0.95,
      ownershipMode: "source_faithful",
      fill: "#ffffff",
      outline: "#111111",
      evidenceState: "admitted",
      backgroundLuminance: 235,
      category: "dialogue",
    });
    const resolved = resolveBubbleTextStyle(bubble);
    expect(resolved.textColor).toBe("#ffffff");
    expect(resolved.hasOutline).toBe(true);
    expect(resolved.shadow).toEqual(STANDARD_TRANSLATED_TEXT_SHADOW);
  });

  it("preserves explicit Readable dialogue on a confirmed monochrome page", () => {
    const bubble = makeBubble({
      isMonochromePage: true,
      monochromeConfidence: 0.95,
      ownershipMode: "readable",
      backgroundLuminance: 225,
      category: "dialogue",
    });
    const resolved = resolveBubbleTextStyle(bubble);
    expect(resolved.textColor).toBe("#ffffff");
    expect(resolved.hasOutline).toBe(true);
    expect(resolved.shadow).toBeUndefined();
    expect(resolved.glow).toBeUndefined();
    expect(resolved.readabilityHalo).toBeUndefined();
  });
});

it.each(['dialogue', 'narration', 'sfx'] as const)('keeps pure black ink and the category shadow policy for monochrome %s', category => {
 const resolved = resolveBubbleTextStyle(makeBubble({ category, isMonochromePage: true, monochromeConfidence: 0.99, fill: '#ff5500', hasOutline: true, backgroundLuminance: 20 }));
 expect(resolved.textColor).toBe('#000000');
 expect(resolved.hasOutline).toBe(false);
 expect(resolved.outlineWidthRatio).toBe(0);
 expect(resolved.shadow).toEqual(category === 'sfx' ? SUBTLE_ARTWORK_SHADOW : undefined);
 expect(resolved.glow).toBeUndefined();
 expect(resolved.fillGradient).toBeUndefined();
 expect(resolved.backgroundPlate).toBeUndefined();
});
