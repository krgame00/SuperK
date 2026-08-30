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
  outlineWidth: number;
  opacity: number;
  source: StyleSource;
  fillConfidence: number;
  outlineConfidence: number;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = (hex || "").replace("#", "").trim();
  if (clean.length === 3) {
    return [
      parseInt(clean[0] + clean[0], 16) || 0,
      parseInt(clean[1] + clean[1], 16) || 0,
      parseInt(clean[2] + clean[2], 16) || 0,
    ];
  }
  return [
    parseInt(clean.slice(0, 2), 16) || 0,
    parseInt(clean.slice(2, 4), 16) || 0,
    parseInt(clean.slice(4, 6), 16) || 0,
  ];
}

function getLuminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function colorDistance(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number,
): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

export function resolveBubbleTextStyle(
  bubble: TranslatedBubble,
  globalStyle: OverlayTextStyle = {},
  options: ResolveStyleOptions = {},
): ResolvedTextStyle {
  const defaultFill = globalStyle.textColor || "#000000";
  const defaultOutline = globalStyle.textOutline || "#ffffff";
  const minConfidence = options.minConfidence ?? 0.60;
  const autoMatchEnabled = options.autoMatchColors ?? true;
  const autoOutlineEnabled = options.autoMatchOutline ?? true;

  const profile = bubble.styleProfile as TextStyleProfile | undefined;

  if (!profile) {
    return {
      textColor: defaultFill,
      textOutline: defaultOutline,
      outlineWidth: 1.0,
      opacity: 1.0,
      source: "global",
      fillConfidence: 1.0,
      outlineConfidence: 1.0,
    };
  }

  const fillConf = profile.fillConfidence ?? 1.0;
  const outlineConf = profile.outlineConfidence ?? 1.0;

  // 1. Manual user override always wins
  if (profile.source === "manual") {
    return {
      textColor: profile.fill || defaultFill,
      textOutline: profile.outline || defaultOutline,
      outlineWidth: profile.outlineWidth ?? 1.0,
      opacity: profile.opacity ?? 1.0,
      source: "manual",
      fillConfidence: fillConf,
      outlineConfidence: outlineConf,
    };
  }

  // 2. Auto-matching disabled
  if (!autoMatchEnabled) {
    return {
      textColor: defaultFill,
      textOutline: defaultOutline,
      outlineWidth: 1.0,
      opacity: 1.0,
      source: "global",
      fillConfidence: fillConf,
      outlineConfidence: outlineConf,
    };
  }

  // 3. Auto-matched or nearby fallback color with confidence check
  const isEligible =
    profile.source === "fallback" || fillConf >= minConfidence;
  const hasHighOutlineConfidence = outlineConf >= minConfidence;

  const resolvedFill = isEligible ? profile.fill : defaultFill;
  let resolvedOutline =
    autoOutlineEnabled && (hasHighOutlineConfidence || profile.source === "fallback")
      ? profile.outline
      : defaultOutline;

  // 4. Enforce strong contrast between fill and outline to prevent unreadable text
  const [fr, fg, fb] = hexToRgb(resolvedFill);
  const [or, og, ob] = hexToRgb(resolvedOutline);
  const fillLum = getLuminance(fr, fg, fb);
  const dist = colorDistance(fr, fg, fb, or, og, ob);

  if (dist < 75) {
    resolvedOutline = fillLum < 128 ? "#ffffff" : "#000000";
  }

  return {
    textColor: resolvedFill,
    textOutline: resolvedOutline,
    outlineWidth: profile.outlineWidth ?? 1.0,
    opacity: profile.opacity ?? 1.0,
    source: isEligible ? profile.source : "global",
    fillConfidence: fillConf,
    outlineConfidence: outlineConf,
  };
}
