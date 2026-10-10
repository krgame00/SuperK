import { describe, it, expect } from "vitest";
import {
  resolveBubbleTextStyle,
  applyBwContrastModeToBubble,
  measureFootprintBackgroundLuminance,
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

  it("adds high-contrast white outline to black text on a dark monochrome background without shadow", () => {
    const bubble = makeBubble({
      isMonochromePage: true,
      monochromeConfidence: 0.95,
      backgroundLuminance: 20,
      category: "dialogue",
    });
    const resolved = resolveBubbleTextStyle(bubble);
    expect(resolved.textColor).toBe("#000000");
    expect(resolved.textOutline).toBe("#ffffff");
    expect(resolved.hasOutline).toBe(true);
    expect(resolved.outlineWidthRatio).toBeGreaterThanOrEqual(0.18);
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

  it("adds high-contrast white outline to black text on mixed grayscale background without shadow", () => {
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
    expect(resolved.hasOutline).toBe(true);
    expect(resolved.outlineWidthRatio).toBeGreaterThanOrEqual(0.18);
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

it.each(['dialogue', 'narration', 'sfx'] as const)('keeps pure black ink with high-contrast white outline on dark background and the category shadow policy for monochrome %s', category => {
  const resolved = resolveBubbleTextStyle(makeBubble({ category, isMonochromePage: true, monochromeConfidence: 0.99, fill: '#ff5500', hasOutline: true, backgroundLuminance: 20 }));
  expect(resolved.textColor).toBe('#000000');
  expect(resolved.textOutline).toBe('#ffffff');
  expect(resolved.hasOutline).toBe(true);
  expect(resolved.outlineWidthRatio).toBeGreaterThanOrEqual(0.18);
  expect(resolved.shadow).toEqual(category === 'sfx' ? SUBTLE_ARTWORK_SHADOW : undefined);
  expect(resolved.glow).toBeUndefined();
  expect(resolved.fillGradient).toBeUndefined();
  expect(resolved.backgroundPlate).toBeUndefined();
});

describe("B&W Contrast Modes (ดำ-ขาว / ขาว-ดำ / ออโต้ / ดำล้วน) & Footprint Luminance", () => {
  it("applies black_on_white (ดำ-ขาว: ตัวดำ ขอบขาวหนา) preset", () => {
    const bubble = applyBwContrastModeToBubble(makeBubble({ backgroundLuminance: 245 }), "black_on_white");
    const resolved = resolveBubbleTextStyle(bubble);
    expect(resolved.textColor).toBe("#000000");
    expect(resolved.textOutline).toBe("#ffffff");
    expect(resolved.hasOutline).toBe(true);
    expect(resolved.outlineWidthRatio).toBeGreaterThanOrEqual(0.22);
    expect(resolved.shadow).toBeUndefined();
  });

  it("applies white_on_black (ขาว-ดำ: ตัวขาว ขอบดำหนา) preset", () => {
    const bubble = applyBwContrastModeToBubble(makeBubble({ backgroundLuminance: 245 }), "white_on_black");
    const resolved = resolveBubbleTextStyle(bubble);
    expect(resolved.textColor).toBe("#ffffff");
    expect(resolved.textOutline).toBe("#000000");
    expect(resolved.hasOutline).toBe(true);
    expect(resolved.outlineWidthRatio).toBeGreaterThanOrEqual(0.20);
    expect(resolved.shadow).toBeUndefined();
  });

  it("applies pure_black (ดำล้วน) preset", () => {
    const bubble = applyBwContrastModeToBubble(makeBubble({ backgroundLuminance: 40 }), "pure_black");
    const resolved = resolveBubbleTextStyle(bubble);
    expect(resolved.textColor).toBe("#000000");
    expect(resolved.hasOutline).toBe(false);
    expect(resolved.outlineWidthRatio).toBe(0);
    expect(resolved.shadow).toBeUndefined();
  });

  it("applies auto B&W mode: pure black in white balloon, black-on-white in gray/mixed, white-on-black in very dark", () => {
    const whiteBalloon = applyBwContrastModeToBubble(
      makeBubble({ backgroundLuminance: 245, backgroundLuminanceSamples: [235, 245, 250] }),
      "auto",
    );
    const resWhite = resolveBubbleTextStyle(whiteBalloon);
    expect(resWhite.textColor).toBe("#000000");
    expect(resWhite.hasOutline).toBe(false);

    const grayScreentone = applyBwContrastModeToBubble(
      makeBubble({ backgroundLuminance: 115, backgroundLuminanceSamples: [95, 110, 120, 130] }),
      "auto",
    );
    const resGray = resolveBubbleTextStyle(grayScreentone);
    expect(resGray.textColor).toBe("#000000");
    expect(resGray.textOutline).toBe("#ffffff");
    expect(resGray.hasOutline).toBe(true);
    expect(resGray.outlineWidthRatio).toBeGreaterThanOrEqual(0.20);

    const veryDark = applyBwContrastModeToBubble(
      makeBubble({ backgroundLuminance: 30, backgroundLuminanceSamples: [15, 25, 30, 40, 50] }),
      "auto",
    );
    const resDark = resolveBubbleTextStyle(veryDark);
    expect(resDark.textColor).toBe("#ffffff");
    expect(resDark.textOutline).toBe("#000000");
    expect(resDark.hasOutline).toBe(true);
    expect(resDark.outlineWidthRatio).toBeGreaterThanOrEqual(0.20);
  });

  it("measureFootprintBackgroundLuminance detects gray screentone & dark hair while keeping white balloons clean", () => {
    const w = 20;
    const h = 20;
    // 1. Clean white balloon with 10% black glyph pixels
    const whiteRgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const isInk = i % 10 === 0;
      const v = isInk ? 10 : 250;
      whiteRgba[i * 4] = v;
      whiteRgba[i * 4 + 1] = v;
      whiteRgba[i * 4 + 2] = v;
      whiteRgba[i * 4 + 3] = 255;
    }
    const whiteMeas = measureFootprintBackgroundLuminance({ width: w, height: h, rgba: whiteRgba });
    expect(whiteMeas?.isNonWhiteFootprint).toBe(false);
    expect(whiteMeas?.backgroundLuminance).toBeGreaterThanOrEqual(240);

    // 2. Gray screentone / dark hair background (lum ~ 95)
    const darkRgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const v = i % 2 === 0 ? 75 : 115;
      darkRgba[i * 4] = v;
      darkRgba[i * 4 + 1] = v;
      darkRgba[i * 4 + 2] = v;
      darkRgba[i * 4 + 3] = 255;
    }
    const darkMeas = measureFootprintBackgroundLuminance({ width: w, height: h, rgba: darkRgba });
    expect(darkMeas?.isNonWhiteFootprint).toBe(true);
    expect(darkMeas?.backgroundLuminance).toBeLessThan(165);
  });
});

