import type { OverlayTextStyle, TranslatedBubble } from "@/lib/translationOverlay";
import type {
  StyleSource,
  TextGradientStyle,
  TextShadowStyle,
  TextStyleProfile,
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

export function resolveBubbleTextStyle(
  bubble: TranslatedBubble,
  globalStyle: OverlayTextStyle = {},
  options: ResolveStyleOptions = {},
): ResolvedTextStyle {
  const minConfidence = options.minConfidence ?? 0.80;
  const autoMatchEnabled = options.autoMatchColors ?? true;
  const autoOutlineEnabled = options.autoMatchOutline ?? true;
  const profile = bubble.styleProfile as TextStyleProfile | undefined;

  if (!profile) return globalResolvedStyle(globalStyle);

  const fillConf = profile.fillConfidence ?? 1.0;
  const outlineConf = profile.outlineConfidence ?? 1.0;

  // Manual user styling is authoritative until the user explicitly returns to Auto/Original.
  if (profile.source === "manual") {
    return resolvedFromProfile(profile, globalStyle, true);
  }

  if (!autoMatchEnabled) {
    return globalResolvedStyle(globalStyle, fillConf, outlineConf);
  }

  // Nearby fallback is already constrained by category and is deliberately usable
  // below the high-confidence source threshold. Exact auto profiles require >= 0.80.
  const isEligible = profile.source === "fallback" || fillConf >= minConfidence;
  if (!isEligible) {
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
    (bubble) => !bubble.deleted && bubble.styleProfile?.source === "manual",
  );
  if (manual.length === 0) return nextBubbles;

  const used = new Set<TranslatedBubble>();
  for (const next of nextBubbles) {
    if (next.styleProfile?.source === "manual") continue;
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
