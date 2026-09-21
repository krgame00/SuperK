import type { OverlayTextStyle, TranslatedBubble } from "@/lib/translationOverlay";
import { inferTextStyleCategory } from "./nearbyStyleFallback";
import { colorDistance, extractTextColors, rgbToHex } from "./sampleTextColors";
import {
  createDefaultStyleProfile,
  type ColorSampleRegion,
  type StyleSource,
  type TextGradientStyle,
  type TextShadowStyle,
  type TextStyleCategory,
  type TextStyleProfile,
} from "./types";

export interface ResolveStyleOptions {
  autoMatchColors?: boolean;
  autoMatchOutline?: boolean;
  /** High-confidence threshold. Medium-confidence profiles must be re-analyzed before rendering. */
  minConfidence?: number;
}

export interface ResolvedTextStyle {
  textColor: string;
  textOutline: string;
  /** Backward-compatible outline scale. */
  outlineWidth: number;
  /** Exact source-style outline presence. */
  hasOutline: boolean;
  /** Stroke width as a fraction of the rendered font size. */
  outlineWidthRatio: number;
  opacity: number;
  source: StyleSource;
  fillConfidence: number;
  outlineConfidence: number;
  fillGradient?: TextGradientStyle;
  shadow?: TextShadowStyle;
  glow?: TextShadowStyle;
  backgroundLuminance?: number;
  backgroundLuminanceSamples?: number[];
  backgroundColor?: string;
  isAdaptiveReadable?: boolean;
  readabilityHalo?: TextShadowStyle;
  backgroundPlate?: {
    color: string;
    opacity: number;
    paddingRatio?: number;
  };
  reviewRequired?: boolean;
}

export interface AdaptiveReadableOptions {
  backgroundLuminance?: number;
  backgroundColor?: string;
  backgroundLuminanceSamples?: number[];
  category?: TextStyleCategory;
  fillConfidence?: number;
  outlineConfidence?: number;
  preferredOutlineRatio?: number;
  requiresHaloEscalation?: boolean;
  requiresPlateEscalation?: boolean;
  sourceAccentColor?: string;
  sourceProfile?: TextStyleProfile;
}

export type AccentLuminanceClass = "bright" | "dark" | "ambiguous";

export const STANDARD_TRANSLATED_TEXT_SHADOW: TextShadowStyle = Object.freeze({
  color: "#1e1e1e",
  opacity: 0.80,
  blurRatio: 0.15,
  offsetXRatio: 0.08,
  offsetYRatio: 0.08,
});

function cloneStandardShadow(): TextShadowStyle {
  return { ...STANDARD_TRANSLATED_TEXT_SHADOW };
}

export function shouldUseMonochromeMangaStyle(
  profile: TextStyleProfile,
  category: TextStyleCategory,
): boolean {
  return (
    profile.isMonochromePage === true &&
    (profile.monochromeConfidence ?? 0) >= 0.85 &&
    (category === "dialogue" || category === "narration")
  );
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      case bn:
        h = (rn - gn) / d + 4;
        break;
    }
    h /= 6;
  }
  return { h: h * 360, s, l };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  let r: number, g: number, b: number;
  const hNorm = (((h % 360) + 360) % 360) / 360;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      let tAdj = t;
      if (tAdj < 0) tAdj += 1;
      if (tAdj > 1) tAdj -= 1;
      if (tAdj < 1 / 6) return p + (q - p) * 6 * tAdj;
      if (tAdj < 1 / 2) return q;
      if (tAdj < 2 / 3) return p + (q - p) * (2 / 3 - tAdj) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, hNorm + 1 / 3);
    g = hue2rgb(p, q, hNorm);
    b = hue2rgb(p, q, hNorm - 1 / 3);
  }
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

export function calculateColorLuminance(hex: string): number {
  const rgb = parseHexColor(hex);
  if (!rgb) return 0;
  return 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
}

export function classifyAccentLuminance(accentHex: string): AccentLuminanceClass {
  const lum = calculateColorLuminance(accentHex);
  if (lum >= 160) return "bright";
  if (lum <= 90) return "dark";
  return "ambiguous";
}

export function isChromatic(hex?: string, bgHex?: string): boolean {
  if (!hex) return false;
  const clean = hex.toLowerCase();
  if (bgHex && clean === bgHex.toLowerCase()) return false;
  const rgb = parseHexColor(clean);
  if (!rgb) return false;
  const max = Math.max(rgb.r, rgb.g, rgb.b);
  const min = Math.min(rgb.r, rgb.g, rgb.b);
  return max - min >= 20;
}

export function deriveSourceAccentColor(
  profile?: TextStyleProfile,
): string | undefined {
  if (!profile) return undefined;
  if (profile.sourceAccentColor) {
    return profile.sourceAccentColor;
  }
  // If the profile was rejected due to background contamination or insufficient evidence,
  // or is already a generic fallback/global/readable profile, its fill/outline colors are not trustworthy source accents.
  if (
    profile.evidenceState === "rejected" ||
    profile.fallbackReason === "background-contamination" ||
    profile.fallbackReason === "insufficient-evidence" ||
    profile.source === "fallback" ||
    profile.source === "global" ||
    profile.ownershipMode === "readable"
  ) {
    return undefined;
  }

  const bgHex = profile.backgroundColor?.toLowerCase();
  const outlineHex = profile.outline;
  const fillHex = profile.fill;

  if (isChromatic(outlineHex, bgHex)) return outlineHex;
  if (isChromatic(fillHex, bgHex)) return fillHex;

  return undefined;
}

export function strengthenSourceAccentOutline(
  accentHex: string,
  targetFill: string,
): string {
  const rgb = parseHexColor(accentHex);
  if (!rgb) return targetFill.toLowerCase() === "#ffffff" ? "#000000" : "#ffffff";

  const isWhiteFill = targetFill.toLowerCase() === "#ffffff";
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);

  if (hsl.s < 0.12) {
    if (isWhiteFill) {
      return hsl.l > 0.4 ? "#000000" : rgbToHex(rgb.r, rgb.g, rgb.b);
    } else {
      return hsl.l < 0.6 ? "#ffffff" : rgbToHex(rgb.r, rgb.g, rgb.b);
    }
  }

  if (isWhiteFill) {
    let targetL = hsl.l;
    let targetS = hsl.s;

    if (targetL > 0.40) {
      targetL = 0.35;
    }
    if (targetS < 0.60) {
      targetS = Math.min(1.0, targetS + 0.35);
    }

    const newRgb = hslToRgb(hsl.h, targetS, targetL);
    return rgbToHex(newRgb.r, newRgb.g, newRgb.b);
  } else {
    let targetL = hsl.l;
    const targetS = hsl.s;

    if (targetL < 0.60) {
      targetL = 0.70;
    }
    const newRgb = hslToRgb(hsl.h, targetS, targetL);
    return rgbToHex(newRgb.r, newRgb.g, newRgb.b);
  }
}

export function selectAdaptiveReadableStyle(
  options: AdaptiveReadableOptions = {},
): ResolvedTextStyle {
  const samples = options.backgroundLuminanceSamples?.filter(
    (s) => typeof s === "number" && !isNaN(s),
  ) ?? [];

  let bgLum = options.backgroundLuminance;
  if (bgLum === undefined && samples.length > 0) {
    bgLum = samples.reduce((sum, s) => sum + s, 0) / samples.length;
  }
  if (bgLum === undefined && options.backgroundColor) {
    const rgb = parseHexColor(options.backgroundColor);
    if (rgb) {
      bgLum = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
    }
  }

  const defaultOutlineRatio = options.category === "overlay_subtitle" ? 0.18 : 0.12;
  let outlineWidthRatio = options.preferredOutlineRatio ?? defaultOutlineRatio;

  const isDarkBg = bgLum !== undefined ? bgLum < 150 : (options.category === "overlay_subtitle");

  // White Fill Policy: All readable and adaptive fallback modes strictly use 100% Pure White Fill (#ffffff).
  const textColor = "#ffffff";
  let textOutline: string;

  // Source-Colored Outline with Hue Preservation & Safe Dark Outline Fallback
  const sourceProfile = options.sourceProfile;
  const sourceColorRejected = Boolean(
    sourceProfile &&
    (sourceProfile.evidenceState === "rejected" ||
      sourceProfile.fallbackReason === "background-contamination" ||
      sourceProfile.fallbackReason === "insufficient-evidence" ||
      (sourceProfile.fillConfidence ?? 0) < 0.65),
  );
  const accentColor = sourceColorRejected
    ? undefined
    : options.sourceAccentColor ?? deriveSourceAccentColor(sourceProfile);
  if (accentColor) {
    const rgb = parseHexColor(accentColor);
    if (!rgb) {
      textOutline = "#000000";
    } else {
      const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
      // If the accent is neutral/gray (low saturation) or extremely light:
      if (hsl.s < 0.12) {
        // Low chroma / gray: on white text, light gray has zero contrast -> safe dark outline
        textOutline = hsl.l > 0.4 ? "#000000" : rgbToHex(rgb.r, rgb.g, rgb.b);
      } else {
        // Chromatic accent: strengthen outline for white text
        textOutline = strengthenSourceAccentOutline(accentColor, "#ffffff");
      }
    }
  } else {
    // No reliable source accent detected -> Safe Dark Outline
    textOutline = "#000000";
  }

  // Outline Escalation for Mixed or Difficult Backgrounds:
  if (samples.length > 0 && options.preferredOutlineRatio === undefined) {
    const sorted = [...samples].sort((a, b) => a - b);
    const minLum = sorted[0];
    const maxLum = sorted[sorted.length - 1];
    const p15 = sorted[Math.floor(sorted.length * 0.15)];
    const p85 = sorted[Math.floor(sorted.length * 0.85)];

    const isMixed = (maxLum - minLum >= 90) || (minLum < 80 && maxLum > 160);
    const hasWeakRegion = isDarkBg
      ? (p85 > 175 || maxLum >= 210)
      : (p15 < 50 || minLum <= 35);

    if (isMixed || hasWeakRegion) {
      outlineWidthRatio = Math.min(0.20, Math.max(0.16, defaultOutlineRatio + 0.05));
    }
  }

  // ADR 0015: automatic readability never adds a per-region halo. The
  // uniform proportional shadow is the only automatic shadow treatment.
  const readabilityHalo: TextShadowStyle | undefined = undefined;

  let backgroundPlate: { color: string; opacity: number; paddingRatio?: number } | undefined = undefined;
  let reviewRequired = options.sourceProfile?.reviewRequired ?? false;

  if (options.requiresPlateEscalation) {
    if (options.category === "overlay_subtitle") {
      backgroundPlate = {
        color: "#000000",
        opacity: 0.70,
        paddingRatio: 0.15,
      };
    } else {
      reviewRequired = true;
    }
  }

  return {
    textColor,
    textOutline,
    outlineWidth: 1.0,
    hasOutline: true,
    outlineWidthRatio,
    opacity: 1.0,
    source: "fallback",
    fillConfidence: options.fillConfidence ?? 1.0,
    outlineConfidence: options.outlineConfidence ?? 1.0,
    backgroundLuminance: bgLum,
    backgroundLuminanceSamples: samples.length > 0 ? samples : undefined,
    backgroundColor: options.backgroundColor,
    isAdaptiveReadable: true,
    readabilityHalo,
    backgroundPlate,
    reviewRequired: reviewRequired ? true : undefined,
    glow: undefined,
    shadow: cloneStandardShadow(),
  };
}

const GLOBAL_OUTLINE_RATIO = 0.13;

function resolveOutlinePresence(profile: TextStyleProfile): boolean {
  // Manual user styles take precedence: if user explicitly sets hasOutline to false or outlineWidth to 0, respect it.
  if (profile.ownershipMode === "manual" || profile.source === "manual") {
    if (profile.hasOutline !== undefined) return profile.hasOutline;
    if (profile.outlineWidthRatio !== undefined) return profile.outlineWidthRatio > 0;
    if (profile.outlineWidth !== undefined) return profile.outlineWidth > 0;
    return true;
  }
  // ADR 0012: Validated source profiles preserve authored outline presence or absence (including legitimate no-outline)
  if (profile.evidenceState === "admitted" || profile.source === "auto") {
    if (profile.hasOutline !== undefined) return profile.hasOutline;
    if (profile.outlineWidthRatio !== undefined) return profile.outlineWidthRatio > 0;
    if (profile.outlineWidth !== undefined) return profile.outlineWidth > 0;
  }
  // Fallback / unverified styles always have an outline
  return true;
}

function resolveOutlineRatio(profile: TextStyleProfile, hasOutline: boolean): number {
  if (!hasOutline) return 0;
  if (typeof profile.outlineWidthRatio === "number" && profile.outlineWidthRatio > 0) {
    return Math.max(0, Math.min(0.5, profile.outlineWidthRatio));
  }
  const scale = (typeof profile.outlineWidth === "number" && profile.outlineWidth > 0)
    ? profile.outlineWidth
    : 1.0;
  return GLOBAL_OUTLINE_RATIO * scale;
}

function globalResolvedStyle(
  globalStyle: OverlayTextStyle,
  fillConfidence = 1,
  outlineConfidence = 1,
): ResolvedTextStyle {
  return {
    textColor: globalStyle.textColor || "#000000",
    textOutline: globalStyle.textOutline || "#ffffff",
    outlineWidth: 1.0,
    hasOutline: true,
    outlineWidthRatio: GLOBAL_OUTLINE_RATIO,
    opacity: 1.0,
    source: "global",
    fillConfidence,
    outlineConfidence,
    shadow: cloneStandardShadow(),
  };
}

function resolvedFromProfile(
  profile: TextStyleProfile,
  globalStyle: OverlayTextStyle,
): ResolvedTextStyle {
  const isManual = profile.ownershipMode === "manual" || profile.source === "manual";
  const isValidatedSource = profile.evidenceState === "admitted";
  const hasOutline = resolveOutlinePresence(profile);
  const outlineWidthRatio = hasOutline
    ? resolveOutlineRatio(profile, hasOutline)
    : 0;

  const textColor = profile.fill || globalStyle.textColor || "#000000";
  let textOutline = hasOutline
    ? profile.outline || globalStyle.textOutline || "#ffffff"
    : globalStyle.textOutline || "#ffffff";

  // Readable/unverified styles may strengthen an unsafe outline, but a validated
  // source profile must keep the authored outline exactly as admitted.
  if (hasOutline && !isManual && !isValidatedSource) {
    const rgbFill = parseHexColor(textColor);
    const rgbOutline = parseHexColor(textOutline);
    const dist = rgbFill && rgbOutline
      ? colorDistance(rgbFill.r, rgbFill.g, rgbFill.b, rgbOutline.r, rgbOutline.g, rgbOutline.b)
      : 0;

    if (dist < 35 || textOutline.toLowerCase() === textColor.toLowerCase()) {
      const bgLum = profile.backgroundLuminance;
      const fillLum = rgbFill ? 0.299 * rgbFill.r + 0.587 * rgbFill.g + 0.114 * rgbFill.b : 0;
      if (typeof bgLum === "number") {
        textOutline = bgLum < 140 ? "#ffffff" : (fillLum > 140 ? "#000000" : "#ffffff");
      } else {
        textOutline = fillLum > 140 ? "#000000" : "#ffffff";
      }
    }
  }

  return {
    textColor,
    textOutline,
    outlineWidth: hasOutline ? profile.outlineWidth ?? 1.0 : 0,
    hasOutline,
    outlineWidthRatio: hasOutline ? outlineWidthRatio : 0,
    opacity: profile.opacity ?? 1.0,
    source: profile.source,
    fillConfidence: profile.fillConfidence ?? 1.0,
    outlineConfidence: profile.outlineConfidence ?? 1.0,
    fillGradient: profile.fillGradient,
    shadow: isManual && profile.manualShadowMode === "off"
      ? undefined
      : cloneStandardShadow(),
    glow: undefined,
    readabilityHalo: undefined,
    reviewRequired: profile.reviewRequired ? true : undefined,
  };
}

function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace(/^#/, "");
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16),
      g: parseInt(clean[1] + clean[1], 16),
      b: parseInt(clean[2] + clean[2], 16),
    };
  }
  if (clean.length === 6) {
    return {
      r: parseInt(clean.substring(0, 2), 16),
      g: parseInt(clean.substring(2, 4), 16),
      b: parseInt(clean.substring(4, 6), 16),
    };
  }
  return null;
}

function overlaySubtitleReadableFallback(
  fillConfidence = 1,
  outlineConfidence = 1,
): ResolvedTextStyle {
  return {
    textColor: "#ffffff",
    textOutline: "#000000",
    outlineWidth: 1.0,
    hasOutline: true,
    outlineWidthRatio: 0.18,
    opacity: 1.0,
    source: "fallback",
    fillConfidence,
    outlineConfidence,
    shadow: cloneStandardShadow(),
  };
}

export function validateOverlaySubtitleReadability(
  fill: string,
  outline: string,
  hasOutline: boolean,
): boolean {
  if (!hasOutline) return false;
  const rgbFill = parseHexColor(fill);
  const rgbOutline = parseHexColor(outline);
  if (!rgbFill || !rgbOutline) return false;
  const dist = colorDistance(
    rgbFill.r,
    rgbFill.g,
    rgbFill.b,
    rgbOutline.r,
    rgbOutline.g,
    rgbOutline.b,
  );
  return dist >= 60;
}

export function resolveBubbleTextStyle(
  bubble: TranslatedBubble,
  globalStyle: OverlayTextStyle = {},
  options: ResolveStyleOptions = {},
): ResolvedTextStyle {
  const minConfidence = options.minConfidence ?? 0.80;
  const autoMatchEnabled = options.autoMatchColors ?? true;
  const profile = bubble.styleProfile as TextStyleProfile | undefined;
  const category = inferTextStyleCategory(bubble);

  if (!profile) {
    if (category === "overlay_subtitle") {
      return overlaySubtitleReadableFallback(1, 1);
    }
    return globalResolvedStyle(globalStyle);
  }

  const fillConf = profile.fillConfidence ?? 1.0;
  const outlineConf = profile.outlineConfidence ?? 1.0;

  // Manual user styling is authoritative until the user explicitly returns to Auto/Original.
  // This is the only mode allowed to override the monochrome page policy.
  if (profile.ownershipMode === "manual" || profile.source === "manual") {
    return resolvedFromProfile(profile, globalStyle);
  }

  // Monochrome Manga Text Style Policy:
  // Confirmed B&W dialogue/narration always uses black fill with no shadow/glow.
  // A thin white outline is added only when the local grayscale background is
  // dark or strongly mixed, preserving readability without turning the fill white.
  if (shouldUseMonochromeMangaStyle(profile, category)) {
    const bgLum = profile.backgroundLuminance;
    const samples = profile.backgroundLuminanceSamples ?? [];
    const mixed = samples.length > 0 && Math.max(...samples) - Math.min(...samples) >= 90;
    const needsOutline = mixed || (bgLum !== undefined && bgLum < 155);
    const outlineWidthRatio = needsOutline
      ? Math.min(0.08, Math.max(0.04, resolveOutlineRatio(profile, true)))
      : 0;

    return {
      textColor: "#000000",
      textOutline: "#ffffff",
      outlineWidth: needsOutline ? Math.min(0.75, profile.outlineWidth ?? 0.75) : 0,
      hasOutline: needsOutline,
      outlineWidthRatio,
      opacity: profile.opacity ?? 1.0,
      source: profile.source ?? "auto",
      fillConfidence: fillConf,
      outlineConfidence: outlineConf,
      fillGradient: undefined,
      shadow: undefined,
      glow: undefined,
      readabilityHalo: undefined,
      backgroundLuminance: profile.backgroundLuminance,
      backgroundLuminanceSamples: profile.backgroundLuminanceSamples,
      backgroundColor: profile.backgroundColor,
      isAdaptiveReadable: needsOutline || undefined,
      reviewRequired: profile.reviewRequired ? true : undefined,
    };
  }

  // Explicit user-selected readable preset.
  if (profile.ownershipMode === "readable") {
    return selectAdaptiveReadableStyle({
      backgroundLuminance: profile.backgroundLuminance,
      backgroundLuminanceSamples: profile.backgroundLuminanceSamples,
      backgroundColor: profile.backgroundColor,
      category,
      fillConfidence: fillConf,
      outlineConfidence: outlineConf,
      requiresHaloEscalation: profile.requiresHaloEscalation,
      requiresPlateEscalation: profile.requiresPlateEscalation,
      sourceProfile: profile,
    });
  }

  // Explicit Source-faithful mode for non-monochrome pages.
  if (profile.ownershipMode === "source_faithful") {
    return resolvedFromProfile(profile, globalStyle);
  }

  // If candidate was rejected by evidence gate or background contamination,
  // do not render the rejected candidate color; degrade safely to adaptive readable fallback.
  if (
    profile.evidenceState === "rejected" ||
    profile.fallbackReason === "background-contamination" ||
    profile.fallbackReason === "insufficient-evidence" ||
    profile.fallbackReason === "low-readability"
  ) {
    return selectAdaptiveReadableStyle({
      backgroundLuminance: profile.backgroundLuminance,
      backgroundLuminanceSamples: profile.backgroundLuminanceSamples,
      backgroundColor: profile.backgroundColor,
      category,
      fillConfidence: fillConf,
      outlineConfidence: outlineConf,
      requiresHaloEscalation: profile.requiresHaloEscalation,
      requiresPlateEscalation: profile.requiresPlateEscalation,
      sourceProfile: profile,
    });
  }

  // Overlay Subtitle readability validation:
  // On variable artwork, overlay subtitles require explicit outline and adequate contrast
  if (category === "overlay_subtitle") {
    const hasSourceOutline = resolveOutlinePresence(profile);
    const outlineColor = profile.outline || profile.fill || "#000000";
    const fillColor = profile.fill || "#ffffff";
    const isReadable = validateOverlaySubtitleReadability(
      fillColor,
      outlineColor,
      hasSourceOutline,
    );
    if (!isReadable) {
      return selectAdaptiveReadableStyle({
        backgroundLuminance: profile.backgroundLuminance,
        backgroundLuminanceSamples: profile.backgroundLuminanceSamples,
        backgroundColor: profile.backgroundColor,
        category: "overlay_subtitle",
        fillConfidence: fillConf,
        outlineConfidence: outlineConf,
        requiresHaloEscalation: profile.requiresHaloEscalation,
        requiresPlateEscalation: profile.requiresPlateEscalation,
        sourceProfile: profile,
      });
    }
  }

  if (!autoMatchEnabled) {
    if (category === "overlay_subtitle") {
      return overlaySubtitleReadableFallback(fillConf, outlineConf);
    }
    return globalResolvedStyle(globalStyle, fillConf, outlineConf);
  }

  // Nearby fallback is already constrained by category and is deliberately usable
  // below the high-confidence source threshold. Exact auto profiles require >= 0.80.
  const isEligible = profile.source === "fallback" || fillConf >= minConfidence;
  if (!isEligible) {
    if (category === "overlay_subtitle") {
      return overlaySubtitleReadableFallback(fillConf, outlineConf);
    }
    return globalResolvedStyle(globalStyle, fillConf, outlineConf);
  }

  // 1. Decorative SFX (onomatopoeia sound effects) admitted with authored effects remain source-faithful
  if (category === "sfx" && profile.evidenceState === "admitted") {
    return resolvedFromProfile(profile, globalStyle);
  }

  // 2. Standard dark dialogue in a white speech balloon remains dark text
  const rgbFill = parseHexColor(profile.fill || "#000000");
  const fillLum = rgbFill ? 0.299 * rgbFill.r + 0.587 * rgbFill.g + 0.114 * rgbFill.b : 0;
  const isDarkAchromatic = rgbFill
    ? fillLum < 60 && Math.max(rgbFill.r, rgbFill.g, rgbFill.b) - Math.min(rgbFill.r, rgbFill.g, rgbFill.b) < 25
    : true;
  const isWhiteBalloon = typeof profile.backgroundLuminance === "number" && profile.backgroundLuminance >= 160;

  if (isDarkAchromatic && isWhiteBalloon) {
    return resolvedFromProfile(profile, globalStyle);
  }

  // 3. Authored high-contrast dark outline around bright fills (e.g. yellow subtitle with solid black outline)
  const hasSourceOutline = resolveOutlinePresence(profile);
  const rgbOutline = parseHexColor(profile.outline || "");
  const outlineFillDist = rgbFill && rgbOutline
    ? colorDistance(rgbFill.r, rgbFill.g, rgbFill.b, rgbOutline.r, rgbOutline.g, rgbOutline.b)
    : 0;
  if (
    category === "overlay_subtitle" &&
    hasSourceOutline &&
    outlineFillDist >= 120 &&
    rgbOutline &&
    0.299 * rgbOutline.r + 0.587 * rgbOutline.g + 0.114 * rgbOutline.b < 40
  ) {
    return resolvedFromProfile(profile, globalStyle);
  }

  // 4. White text with chromatic or dark outline (already white fill)
  if (profile.fill?.toLowerCase() === "#ffffff") {
    return resolvedFromProfile(profile, globalStyle);
  }

  // 5. White Fill + Source-Colored Outline Architecture (white-fill-source-outline-plan.md)
  // For all chromatic or artwork text in Auto mode:
  // Strictly enforce 100% Pure White Fill (#ffffff) and map the detected source color to outline.
  // Preserve neon / diffuse glow (Option A) if detected from original manga artwork.
  const accentColor = profile.sourceAccentColor ?? deriveSourceAccentColor(profile);
  if (accentColor || isChromatic(profile.fill) || isChromatic(profile.outline)) {
    const effectiveAccent = accentColor ?? (isChromatic(profile.fill) ? profile.fill : profile.outline);
    const sourceColorConfidence = Math.min(
      profile.fillConfidence ?? 0,
      profile.outlineConfidence ?? profile.fillConfidence ?? 0,
    );
    const useSourceOutline = Boolean(
      effectiveAccent &&
      sourceColorConfidence >= 0.80 &&
      profile.evidenceState === "admitted",
    );
    const strengthenedOutline = useSourceOutline && effectiveAccent
      ? effectiveAccent
      : effectiveAccent && sourceColorConfidence >= 0.65
        ? strengthenSourceAccentOutline(effectiveAccent, "#ffffff")
        : "#000000";

    const defaultOutlineRatio = category === "overlay_subtitle" ? 0.18 : 0.13;
    const outlineRatio = Math.max(
      defaultOutlineRatio,
      resolveOutlineRatio(profile, true),
    );

    return {
      textColor: "#ffffff",
      textOutline: strengthenedOutline,
      outlineWidth: profile.outlineWidth ?? 1.0,
      hasOutline: true,
      outlineWidthRatio: outlineRatio,
      opacity: profile.opacity ?? 1.0,
      source: profile.source ?? "auto",
      fillConfidence: fillConf,
      outlineConfidence: outlineConf,
      fillGradient: undefined,
      shadow: cloneStandardShadow(),
      glow: undefined,
      readabilityHalo: undefined,
      backgroundLuminance: profile.backgroundLuminance,
      backgroundLuminanceSamples: profile.backgroundLuminanceSamples,
      backgroundColor: profile.backgroundColor,
      isAdaptiveReadable: true,
      reviewRequired: profile.reviewRequired ? true : undefined,
    };
  }

  return resolvedFromProfile(profile, globalStyle);
}

export function cloneTextStyleProfile(
  profile?: TextStyleProfile,
): TextStyleProfile | undefined {
  if (!profile) return undefined;
  return {
    ...profile,
    fillGradient: profile.fillGradient
      ? {
          ...profile.fillGradient,
          stops: profile.fillGradient.stops.map((stop) => ({ ...stop })),
        }
      : undefined,
    shadow: profile.shadow ? { ...profile.shadow } : undefined,
    glow: profile.glow ? { ...profile.glow } : undefined,
  };
}

function normalizedSourceText(bubble: TranslatedBubble): string {
  return String(bubble.original_text ?? "").trim().replace(/\s+/g, " ");
}

function boxIoU(a?: number[], b?: number[]): number {
  if (!a || !b || a.length < 4 || b.length < 4) return 0;
  const [ay1, ax1, ay2, ax2] = a;
  const [by1, bx1, by2, bx2] = b;
  const intersectionW = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
  const intersectionH = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
  const intersection = intersectionW * intersectionH;
  if (intersection <= 0) return 0;
  const areaA = Math.max(0, ax2 - ax1) * Math.max(0, ay2 - ay1);
  const areaB = Math.max(0, bx2 - bx1) * Math.max(0, by2 - by1);
  const union = areaA + areaB - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Re-translation is allowed to replace wording and boxes, but never silently
 * takes ownership of a user-authored style. Match the previous manual bubble by
 * stable id first, then by source text + geometry, then by strong geometric overlap.
 */
export function preserveManualStyleProfiles(
  nextBubbles: TranslatedBubble[],
  previousBubbles: TranslatedBubble[],
): TranslatedBubble[] {
  const manual = previousBubbles.filter(
    (bubble) =>
      !bubble.deleted &&
      (bubble.styleProfile?.source === "manual" ||
        bubble.styleProfile?.ownershipMode === "manual" ||
        bubble.styleProfile?.ownershipMode === "readable"),
  );
  if (manual.length === 0) return nextBubbles;

  const used = new Set<TranslatedBubble>();
  for (const next of nextBubbles) {
    if (
      next.styleProfile?.source === "manual" ||
      next.styleProfile?.ownershipMode === "manual" ||
      next.styleProfile?.ownershipMode === "readable"
    ) {
      continue;
    }
    const nextId = next.id == null ? "" : String(next.id);
    const nextSource = normalizedSourceText(next);

    let best: TranslatedBubble | undefined;
    let bestScore = -1;
    for (const previous of manual) {
      if (used.has(previous)) continue;
      const previousId = previous.id == null ? "" : String(previous.id);
      const overlap = boxIoU(next.box, previous.box);
      const sameId = Boolean(nextId && previousId && nextId === previousId);
      const previousSource = normalizedSourceText(previous);
      const sameSource = Boolean(
        nextSource && previousSource && nextSource === previousSource,
      );

      if (!sameId && !(sameSource && overlap >= 0.25) && overlap < 0.55) continue;
      const score = (sameId ? 3 : 0) + (sameSource ? 1 : 0) + overlap;
      if (score > bestScore) {
        bestScore = score;
        best = previous;
      }
    }

    if (best?.styleProfile) {
      next.styleProfile = cloneTextStyleProfile(best.styleProfile);
      used.add(best);
    }
  }
  return nextBubbles;
}

/**
 * Recomputes Adaptive Readable style when a bubble layout change commits
 * (move, resize, text edit), without dragging/resizing per-frame flicker.
 * Manual user styling is 100% authoritative and is NEVER mutated.
 */
export function recomputeAdaptiveReadableOnLayoutCommit(
  bubble: TranslatedBubble,
  backgroundSample?: ColorSampleRegion | null,
): TranslatedBubble {
  const profile = bubble.styleProfile;
  if (profile?.source === "manual" || profile?.ownershipMode === "manual") {
    return bubble;
  }

  if (
    backgroundSample &&
    backgroundSample.rgba &&
    backgroundSample.width > 0 &&
    backgroundSample.height > 0
  ) {
    const extracted = extractTextColors(backgroundSample);
    const newBgLum = extracted.backgroundLuminance;
    const newBgSamples = extracted.backgroundLuminanceSamples;
    const newBgColor = extracted.backgroundColor;

    const ownershipMode =
      profile?.ownershipMode ?? (profile?.source === "auto" ? "auto" : "auto");

    const category = profile?.category ?? inferTextStyleCategory(bubble);

    const adaptive = selectAdaptiveReadableStyle({
      backgroundLuminance: newBgLum,
      backgroundLuminanceSamples: newBgSamples,
      backgroundColor: newBgColor,
      category,
      fillConfidence: profile?.fillConfidence,
      outlineConfidence: profile?.outlineConfidence,
      requiresHaloEscalation: profile?.requiresHaloEscalation,
      requiresPlateEscalation: profile?.requiresPlateEscalation,
      sourceProfile: profile,
    });

    const isFallbackOrReadable =
      ownershipMode === "readable" ||
      profile?.source === "fallback" ||
      profile?.evidenceState === "rejected";

    bubble.styleProfile = {
      ...(profile ?? createDefaultStyleProfile("auto")),
      ownershipMode,
      backgroundLuminance: newBgLum,
      backgroundLuminanceSamples: newBgSamples,
      backgroundColor: newBgColor,
      isAdaptiveReadable: true,
      ...(isFallbackOrReadable
        ? {
            fill: adaptive.textColor,
            outline: adaptive.textOutline,
            hasOutline: adaptive.hasOutline,
            outlineWidthRatio: adaptive.outlineWidthRatio,
            outlineWidth: adaptive.outlineWidth,
            source: "fallback",
            backgroundPlate: adaptive.backgroundPlate,
            reviewRequired: adaptive.reviewRequired,
          }
        : {}),
    };
  }

  return bubble;
}

