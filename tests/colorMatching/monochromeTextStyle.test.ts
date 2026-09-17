import { describe, it, expect } from "vitest";
import {
  resolveBubbleTextStyle,
  STANDARD_TRANSLATED_TEXT_SHADOW,
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

  it("resolves black/dark bubble on monochrome page to white text without shadow", () => {
    const bubble = makeBubble({
      isMonochromePage: true,
      monochromeConfidence: 0.95,
      backgroundLuminance: 20,
      category: "dialogue",
    });
    const resolved = resolveBubbleTextStyle(bubble);
    expect(resolved.textColor).toBe("#ffffff");
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

  it("resolves mixed grayscale background on monochrome page with contrasting outline and no shadow", () => {
    const bubble = makeBubble({
      isMonochromePage: true,
      monochromeConfidence: 0.95,
      backgroundLuminance: 120,
      backgroundLuminanceSamples: [40, 180, 50, 190],
      category: "dialogue",
    });
    const resolved = resolveBubbleTextStyle(bubble);
    expect(resolved.hasOutline).toBe(true);
    expect(resolved.outlineWidthRatio).toBeGreaterThanOrEqual(0.10);
    expect(resolved.shadow).toBeUndefined();
  });

  it("preserves color page uniform shadow under ADR 0015", () => {
    const colorBubble = makeBubble({
      isMonochromePage: false,
      monochromeConfidence: 0.95,
      backgroundLuminance: 245,
      category: "dialogue",
    });
    const resolvedColor = resolveBubbleTextStyle(colorBubble);
    expect(resolvedColor.shadow).toEqual(STANDARD_TRANSLATED_TEXT_SHADOW);

    const unknownBubble = makeBubble({
      backgroundLuminance: 245,
      category: "dialogue",
    });
    const resolvedUnknown = resolveBubbleTextStyle(unknownBubble);
    expect(resolvedUnknown.shadow).toEqual(STANDARD_TRANSLATED_TEXT_SHADOW);
  });

  it("falls back to standard shadow if monochrome confidence is below 0.85", () => {
    const bubble = makeBubble({
      isMonochromePage: true,
      monochromeConfidence: 0.70,
      backgroundLuminance: 245,
      category: "dialogue",
    });
    const resolved = resolveBubbleTextStyle(bubble);
    expect(resolved.shadow).toEqual(STANDARD_TRANSLATED_TEXT_SHADOW);
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

  it("preserves admitted SFX source effects on monochrome page", () => {
    const bubble = makeBubble({
      isMonochromePage: true,
      monochromeConfidence: 0.95,
      category: "sfx",
      fill: "#ff5500",
      outline: "#000000",
      evidenceState: "admitted",
    });
    const resolved = resolveBubbleTextStyle(bubble);
    expect(resolved.textColor).toBe("#ff5500");
  });

  it("preserves source-faithful dialogue style on monochrome page but removes automatic shadow", () => {
    const bubble = makeBubble({
      isMonochromePage: true,
      monochromeConfidence: 0.95,
      ownershipMode: "source_faithful",
      fill: "#ffffff",
      outline: "#111111",
      evidenceState: "admitted",
      category: "dialogue",
    });
    const resolved = resolveBubbleTextStyle(bubble);
    expect(resolved.textColor).toBe("#ffffff");
    expect(resolved.textOutline).toBe("#111111");
    expect(resolved.shadow).toBeUndefined();
  });

  it("keeps explicit Readable dialogue shadowless on a confirmed monochrome page", () => {
    const bubble = makeBubble({
      isMonochromePage: true,
      monochromeConfidence: 0.95,
      ownershipMode: "readable",
      backgroundLuminance: 225,
      category: "dialogue",
    });
    const resolved = resolveBubbleTextStyle(bubble);
    expect(resolved.isAdaptiveReadable).toBe(true);
    expect(resolved.shadow).toBeUndefined();
    expect(resolved.glow).toBeUndefined();
    expect(resolved.readabilityHalo).toBeUndefined();
  });
});
