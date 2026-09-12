/**
 * Style Profile and Color Matching Contract for Manga Text
 */

export type StyleSource = "auto" | "manual" | "global" | "fallback";
export type TextStyleCategory = "dialogue" | "narration" | "sfx" | "unknown";
export type StyleConfidenceBand = "high" | "medium" | "low";

export interface TextGradientStop {
  offset: number;
  color: string;
}

export interface TextGradientStyle {
  angleDeg: number;
  stops: TextGradientStop[];
}

export interface TextShadowStyle {
  color: string;
  opacity: number;
  blurRatio: number;
  offsetXRatio: number;
  offsetYRatio: number;
}

export interface TextStyleProfile {
  fill: string;
  outline: string;
  /** Backward-compatible scale used by older saved projects. */
  outlineWidth?: number;
  /** Whether the source glyph visibly contains a stroke/outline. */
  hasOutline?: boolean;
  /** Source stroke thickness expressed relative to rendered font size. */
  outlineWidthRatio?: number;
  opacity?: number;
  fillConfidence?: number;
  outlineConfidence?: number;
  confidenceBand?: StyleConfidenceBand;
  /** True when a medium-confidence sample already received its bounded local refinement pass. */
  refinementAttempted?: boolean;
  source: StyleSource;
  category?: TextStyleCategory;
  fillGradient?: TextGradientStyle;
  shadow?: TextShadowStyle;
  glow?: TextShadowStyle;
  nearbySourceId?: string;
  fallbackReason?: "low-confidence" | "medium-unresolved" | "nearby" | "global";
}

export interface ColorSampleRegion {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  glyphMask?: Uint8ClampedArray;
}

export function clampConfidence(val: number): number {
  if (typeof val !== "number" || Number.isNaN(val)) return 0.0;
  return Math.max(0.0, Math.min(1.0, val));
}

export function normalizeCssColor(color: string, fallback = "#000000"): string {
  if (!color || typeof color !== "string") return fallback;
  const trimmed = color.trim().toLowerCase();

  // 3-digit hex: #rgb -> #rrggbb
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const r = trimmed[1];
    const g = trimmed[2];
    const b = trimmed[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }

  // 6-digit hex: #rrggbb
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
    return trimmed;
  }

  // rgb(r, g, b) -> #rrggbb
  const rgbMatch = trimmed.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
  if (rgbMatch) {
    const r = Math.min(255, Math.max(0, parseInt(rgbMatch[1], 10))).toString(16).padStart(2, "0");
    const g = Math.min(255, Math.max(0, parseInt(rgbMatch[2], 10))).toString(16).padStart(2, "0");
    const b = Math.min(255, Math.max(0, parseInt(rgbMatch[3], 10))).toString(16).padStart(2, "0");
    return `#${r}${g}${b}`;
  }

  // rgba(r, g, b, a)
  if (/^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*([01]?(\.\d+)?)\s*\)$/i.test(trimmed)) {
    return trimmed;
  }

  return fallback;
}

export function getStyleConfidenceBand(confidence: number): StyleConfidenceBand {
  const value = clampConfidence(confidence);
  if (value >= 0.80) return "high";
  if (value >= 0.60) return "medium";
  return "low";
}

export function createDefaultStyleProfile(source: StyleSource = "global"): TextStyleProfile {
  return {
    fill: "#000000",
    outline: "#ffffff",
    hasOutline: true,
    outlineWidthRatio: 0.16,
    fillConfidence: 1.0,
    outlineConfidence: 1.0,
    confidenceBand: source === "global" ? "low" : "high",
    source,
    category: "unknown",
    fallbackReason: source === "global" ? "global" : undefined,
  };
}
