import type { OverlayTextStyle, TranslatedBubble } from "@/lib/translationOverlay";
import type { StyleSource, TextStyleProfile } from "./types";

export interface ResolveStyleOptions {
  autoMatchColors?: boolean;
  autoMatchOutline?: boolean;
  minConfidence?: number;
}

export interface ResolvedTextStyle {
  textColor: string;
  textOutline: string;
  source: StyleSource;
  fillConfidence: number;
  outlineConfidence: number;
}

export function resolveBubbleTextStyle(
  bubble: TranslatedBubble,
  globalStyle: OverlayTextStyle = {},
  options: ResolveStyleOptions = {},
): ResolvedTextStyle {
  const defaultFill = globalStyle.textColor || "#000000";
  const defaultOutline = globalStyle.textOutline || "#ffffff";
  const minConfidence = options.minConfidence ?? 0.65;
  const autoMatchEnabled = options.autoMatchColors ?? true;
  const autoOutlineEnabled = options.autoMatchOutline ?? true;

  const profile = bubble.styleProfile as TextStyleProfile | undefined;

  if (!profile) {
    return {
      textColor: defaultFill,
      textOutline: defaultOutline,
      source: "global",
      fillConfidence: 1.0,
      outlineConfidence: 1.0,
    };
  }

  // 1. Manual user override always wins
  if (profile.source === "manual") {
    return {
      textColor: profile.fill || defaultFill,
      textOutline: profile.outline || defaultOutline,
      source: "manual",
      fillConfidence: profile.fillConfidence ?? 1.0,
      outlineConfidence: profile.outlineConfidence ?? 1.0,
    };
  }

  // 2. Auto-matching disabled
  if (!autoMatchEnabled) {
    return {
      textColor: defaultFill,
      textOutline: defaultOutline,
      source: "global",
      fillConfidence: profile.fillConfidence,
      outlineConfidence: profile.outlineConfidence,
    };
  }

  // 3. Auto-matched color with confidence check
  const hasHighFillConfidence = profile.fillConfidence >= minConfidence;
  const hasHighOutlineConfidence = profile.outlineConfidence >= minConfidence;

  const resolvedFill = hasHighFillConfidence ? profile.fill : defaultFill;
  const resolvedOutline =
    autoOutlineEnabled && hasHighOutlineConfidence ? profile.outline : defaultOutline;

  return {
    textColor: resolvedFill,
    textOutline: resolvedOutline,
    source: hasHighFillConfidence ? "auto" : "global",
    fillConfidence: profile.fillConfidence,
    outlineConfidence: profile.outlineConfidence,
  };
}
