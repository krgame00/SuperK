import { BUILTIN_CANVAS_FONT_VARS } from "../customFonts";
import { resolveCategoryTypography } from "../typography/comicTypography";
import type { OverlayTextStyle, TranslatedBubble } from "./overlayTypes";

// next/font registers its families under build-hashed names, so canvas
// `ctx.font = "16px Itim"` silently falls back to generic sans-serif.
// Resolve the selected family through the CSS variable next/font set on <html>.
const CANVAS_FONT_VARS: Record<string, string> = {
  ...BUILTIN_CANVAS_FONT_VARS,
};

export const resolveCanvasFontFamily = (fontFamily?: string): string => {
  const fallback = fontFamily || "Itim, sans-serif";
  if (typeof window === "undefined" || typeof document === "undefined") {
    return fallback;
  }
  try {
    const cleanFont = fallback.trim();
    if (cleanFont.startsWith("var(")) {
      const match = cleanFont.match(/var\(\s*(--[\w-]+)\s*\)/);
      if (match) {
        const varName = match[1];
        if (varName === "--font-manga") {
          return "Itim, sans-serif";
        }
        const resolved = getComputedStyle(document.documentElement)
          .getPropertyValue(varName)
          .trim();
        if (resolved) return resolved;
        return "Itim, sans-serif";
      }
    }
    const parts = cleanFont.split(",").map((p) => p.trim()).filter(Boolean);
    const rawPrimary = (parts[0] || "Itim").replace(/^["']|["']$/g, "").trim();
    if (rawPrimary.toLowerCase() === "manga" || rawPrimary.toLowerCase() === "--font-manga") {
      return "Itim, sans-serif";
    }
    const varName = CANVAS_FONT_VARS[rawPrimary.toLowerCase()];
    if (varName) {
      const resolved = getComputedStyle(document.documentElement)
        .getPropertyValue(varName)
        .trim();
      if (resolved) return resolved;
    }
    if (/\s|\d/.test(rawPrimary) && !/^["']/.test(parts[0] || "")) {
      const rest = parts.slice(1).join(", ") || "sans-serif";
      return `"${rawPrimary}", ${rest}`;
    }
    return cleanFont;
  } catch {
    return fallback;
  }
};

export const resolveBubbleFontFamily = (
  bubble?: TranslatedBubble,
  style?: OverlayTextStyle,
): string => {
  const customBubbleFont = (bubble as { fontFamily?: string } | undefined)?.fontFamily;
  if (typeof customBubbleFont === "string" && customBubbleFont.trim().length > 0) {
    return resolveCanvasFontFamily(customBubbleFont);
  }
  const category =
    bubble?.bubbleCategory ||
    bubble?.styleProfile?.category ||
    (bubble as { styleCategory?: string } | undefined)?.styleCategory;
  const catFont =
    category && style?.categoryFonts ? style.categoryFonts[category] : undefined;
  if (catFont && catFont.trim().length > 0) {
    return resolveCanvasFontFamily(catFont);
  }
  if (category) {
    const rules = resolveCategoryTypography(category);
    if (rules.fontFamilyFallback && !style?.fontFamily) {
      return resolveCanvasFontFamily(rules.fontFamilyFallback);
    }
  }
  return resolveCanvasFontFamily(style?.fontFamily);
};
