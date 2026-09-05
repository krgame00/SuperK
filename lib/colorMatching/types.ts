/**
 * Style Profile and Color Matching Contract for Manga Text
 */

export type StyleSource = "auto" | "manual" | "global" | "fallback";

export interface TextStyleProfile {
  fill: string;
  outline: string;
  outlineWidth?: number;
  opacity?: number;
  fillConfidence?: number;
  outlineConfidence?: number;
  source: StyleSource;
  nearbySourceId?: string;
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

export function createDefaultStyleProfile(source: StyleSource = "global"): TextStyleProfile {
  return {
    fill: "#000000",
    outline: "#ffffff",
    fillConfidence: 1.0,
    outlineConfidence: 1.0,
    source,
  };
}
