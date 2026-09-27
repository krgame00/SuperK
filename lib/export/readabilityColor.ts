import type { ColorSampleRegion } from "@/lib/colorMatching/types";

export interface ReadabilityAppearance {
  fill: string;
  outline?: string;
  outlineRatio?: number;
  opacity?: number;
  plate?: { color: string; opacity: number };
  shadow?: { color: string; opacity: number };
}

type Rgb = [number, number, number];

function parseColor(value: string): Rgb | null {
  const hex = value.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (hex) {
    const digits = hex[1].length === 3
      ? hex[1].split("").map((digit) => digit + digit).join("")
      : hex[1];
    return [0, 2, 4].map((offset) => parseInt(digits.slice(offset, offset + 2), 16)) as Rgb;
  }
  const rgb = value.trim().match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

function luminance([r, g, b]: Rgb): number {
  const linear = [r, g, b].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function blend(foreground: Rgb, background: Rgb, opacity: number): Rgb {
  const alpha = Math.max(0, Math.min(1, opacity));
  return foreground.map((channel, index) => channel * alpha + background[index] * (1 - alpha)) as Rgb;
}

function contrast(left: Rgb, right: Rgb): number {
  const values = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

export function evaluateLocalContrast(
  sample: ColorSampleRegion | null,
  appearance: ReadabilityAppearance,
): { state: "pass" | "warning" | "unavailable"; weakFraction?: number } {
  const fill = parseColor(appearance.fill);
  const outline = appearance.outline ? parseColor(appearance.outline) : null;
  const plate = appearance.plate ? parseColor(appearance.plate.color) : null;
  const shadow = appearance.shadow ? parseColor(appearance.shadow.color) : null;
  if (!sample || !fill || sample.rgba.length < 16) return { state: "unavailable" };
  const pixelCount = sample.width * sample.height;
  if (pixelCount < 4 || sample.rgba.length < pixelCount * 4) return { state: "unavailable" };
  const step = Math.max(1, Math.floor(pixelCount / 256));
  let evaluated = 0;
  let weak = 0;
  for (let pixel = 0; pixel < pixelCount; pixel += step) {
    const offset = pixel * 4;
    if (sample.rgba[offset + 3] < 250) continue;
    const raw: Rgb = [sample.rgba[offset], sample.rgba[offset + 1], sample.rgba[offset + 2]];
    const background = plate && appearance.plate
      ? blend(plate, raw, appearance.plate.opacity)
      : raw;
    const alpha = appearance.opacity ?? 1;
    const fillContrast = contrast(blend(fill, background, alpha), background);
    const outlineContrast = outline && (appearance.outlineRatio ?? 0) >= 0.06
      ? contrast(blend(outline, background, alpha), background) : 0;
    const shadowContrast = shadow && (appearance.shadow?.opacity ?? 0) >= 0.75
      ? contrast(blend(shadow, background, appearance.shadow!.opacity), background) : 0;
    if (Math.max(fillContrast, outlineContrast, shadowContrast) < 3) weak++;
    evaluated++;
  }
  if (evaluated < 4) return { state: "unavailable" };
  const weakFraction = weak / evaluated;
  return { state: weakFraction >= 0.2 ? "warning" : "pass", weakFraction };
}
