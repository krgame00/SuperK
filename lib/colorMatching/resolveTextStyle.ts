import type { OverlayTextStyle, TranslatedBubble } from "@/lib/translationOverlay";
import { inferTextStyleCategory } from "./nearbyStyleFallback";
import { colorDistance, extractTextColors } from "./sampleTextColors";
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

  // Candidate evaluation:
  // For bright backgrounds (bgLum >= 150, or default for dialogue in speech balloons):
  // Dark fill (#000000) with Light outline (#ffffff) ensures strong readability.
  // For dark backgrounds (bgLum < 150):
  // Light fill (#ffffff) with Dark outline (#000000) ensures strong readability.
  const isDarkBg = bgLum !== undefined ? bgLum < 150 : (options.category === "overlay_subtitle");

  const textColor = isDarkBg ? "#ffffff" : "#000000";
  const textOutline = isDarkBg ? "#000000" : "#ffffff";

  // Outline Escalation for Mixed or Difficult Backgrounds:
  // When the text crosses mixed tones or local weak regions (contrast near/below 3:1),
  // escalate the outline thickness from normal (0.10–0.14) toward 0.16–0.20,
  // capped at 0.20 to prevent Thai glyph counters from clogging.
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

  // Readability Halo Escalation:
  // Introduced only when ordinary outlined text still fails on severe contrast collision.
  // Kept distinct from recovered decorative source glow/shadow.
  let readabilityHalo: TextShadowStyle | undefined = undefined;
  if (options.requiresHaloEscalation) {
    readabilityHalo = {
      color: isDarkBg ? "#000000" : "#ffffff",
      opacity: 0.75,
      blurRatio: 0.25,
      offsetXRatio: 0,
      offsetYRatio: 0,
    };
  }

  // Background Plate Escalation:
  // Strictly permitted ONLY for overlay_subtitle as a last resort.
  // Dialogue and Narration NEVER receive automatic plates; they are marked reviewRequired.
  let backgroundPlate: { color: string; opacity: number; paddingRatio?: number } | undefined = undefined;
  let reviewRequired = false;

  if (options.requiresPlateEscalation) {
    if (options.category === "overlay_subtitle") {
      backgroundPlate = {
        color: isDarkBg ? "#000000" : "#ffffff",
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
  };
}

const GLOBAL_OUTLINE_RATIO = 0.16;

function resolveOutlinePresence(profile: TextStyleProfile): boolean {
  if (profile.hasOutline !== undefined) return profile.hasOutline;
  if (profile.outlineWidthRatio !== undefined) return profile.outlineWidthRatio > 0;
  if (profile.outlineWidth !== undefined) return profile.outlineWidth > 0;
  // Saved projects created before source-faithful profiles always rendered a stroke.
  return true;
}

function resolveOutlineRatio(profile: TextStyleProfile, hasOutline: boolean): number {
  if (!hasOutline) return 0;
  if (typeof profile.outlineWidthRatio === "number") {
    return Math.max(0, Math.min(0.5, profile.outlineWidthRatio));
  }
  return GLOBAL_OUTLINE_RATIO * Math.max(0, profile.outlineWidth ?? 1.0);
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
  };
}

function resolvedFromProfile(
  profile: TextStyleProfile,
  globalStyle: OverlayTextStyle,
  autoOutlineEnabled: boolean,
): ResolvedTextStyle {
  const hasSourceOutline = resolveOutlinePresence(profile);
  const hasOutline = autoOutlineEnabled ? hasSourceOutline : true;
  const outlineWidthRatio = autoOutlineEnabled
    ? resolveOutlineRatio(profile, hasSourceOutline)
    : GLOBAL_OUTLINE_RATIO;

  return {
    textColor: profile.fill || globalStyle.textColor || "#000000",
    textOutline: autoOutlineEnabled
      ? profile.outline || globalStyle.textOutline || "#ffffff"
      : globalStyle.textOutline || "#ffffff",
    outlineWidth: hasOutline ? profile.outlineWidth ?? 1.0 : 0,
    hasOutline,
    outlineWidthRatio: hasOutline ? outlineWidthRatio : 0,
    opacity: profile.opacity ?? 1.0,
    source: profile.source,
    fillConfidence: profile.fillConfidence ?? 1.0,
    outlineConfidence: profile.outlineConfidence ?? 1.0,
    fillGradient: profile.fillGradient,
    shadow: profile.shadow,
    glow: profile.glow,
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
  const autoOutlineEnabled = options.autoMatchOutline ?? true;
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

  // Explicit user-selected readable preset
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
    });
  }

  // Manual user styling is authoritative until the user explicitly returns to Auto/Original.
  if (profile.ownershipMode === "manual" || profile.source === "manual") {
    return resolvedFromProfile(profile, globalStyle, true);
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

  // Source fidelity wins here. Do not contrast-correct or invent an outline for a
  // high-confidence source profile; those changes are visibly wrong in manga art.
  return resolvedFromProfile(profile, globalStyle, autoOutlineEnabled);
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
            readabilityHalo: adaptive.readabilityHalo,
            backgroundPlate: adaptive.backgroundPlate,
            reviewRequired: adaptive.reviewRequired,
          }
        : {}),
    };
  }

  return bubble;
}

