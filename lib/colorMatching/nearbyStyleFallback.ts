import type { TranslatedBubble } from "@/lib/translationOverlay";
import type { TextStyleCategory, TextStyleProfile } from "./types";

export interface NearbyFallbackOptions {
  minConfidenceThreshold?: number;
  maxDistanceThreshold?: number;
}

export function getBubbleCenter(box?: number[]): { cx: number; cy: number } | null {
  if (!box || !Array.isArray(box) || box.length < 4) return null;
  const [ymin, xmin, ymax, xmax] = box;
  return {
    cx: (xmin + xmax) / 2,
    cy: (ymin + ymax) / 2,
  };
}

export function calculateBoxDistance(box1?: number[], box2?: number[]): number {
  const c1 = getBubbleCenter(box1);
  const c2 = getBubbleCenter(box2);
  if (!c1 || !c2) return Infinity;
  const dx = c1.cx - c2.cx;
  const dy = c1.cy - c2.cy;
  return Math.sqrt(dx * dx + dy * dy);
}

function normalizeCategory(value: unknown): TextStyleCategory | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["dialogue", "dialog", "speech", "bubble"].includes(normalized)) return "dialogue";
  if (["narration", "narrator", "caption", "monologue", "thought"].includes(normalized)) return "narration";
  if (["sfx", "sound", "sound-effect", "sound_effect", "effect", "decorative"].includes(normalized)) return "sfx";
  return null;
}

/**
 * Resolve the semantic visual class using explicit profile metadata first, then
 * common translation payload fields. Unknown is intentionally not guessed from
 * spatial proximity because cross-kind inheritance is worse than global fallback.
 */
export function inferTextStyleCategory(bubble: TranslatedBubble): TextStyleCategory {
  const profileCategory = normalizeCategory(bubble.styleProfile?.category);
  if (profileCategory) return profileCategory;

  const booleanSfx = bubble.isSfx === true || bubble.is_sfx === true || bubble.sfx === true;
  if (booleanSfx) return "sfx";
  const booleanNarration =
    bubble.isNarration === true || bubble.is_narration === true || bubble.narration === true;
  if (booleanNarration) return "narration";

  const candidates = [
    bubble.styleCategory,
    bubble.category,
    bubble.type,
    bubble.kind,
    bubble.role,
    bubble.textType,
    bubble.text_type,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeCategory(candidate);
    if (normalized) return normalized;
  }

  return "unknown";
}

/**
 * Enriches low-confidence bubbles with style inheritance from spatially nearby
 * high-confidence bubbles on the same page, but only within the same known text
 * style category (Dialogue, Narration/Caption, or SFX/Decorative).
 */
export function applyNearbyStyleFallbacks(
  bubbles: TranslatedBubble[],
  options: NearbyFallbackOptions = {},
): TranslatedBubble[] {
  const minConfidence = options.minConfidenceThreshold ?? 0.60;
  const maxDistance = options.maxDistanceThreshold ?? 350;

  const highConfidenceAnchors: Array<{
    bubble: TranslatedBubble;
    profile: TextStyleProfile;
    category: TextStyleCategory;
  }> = [];

  for (const b of bubbles) {
    if (b.deleted) continue;
    const profile = b.styleProfile as TextStyleProfile | undefined;
    const category = inferTextStyleCategory(b);
    if (
      profile &&
      category !== "unknown" &&
      (profile.source === "manual" ||
        (profile.source === "auto" && (profile.fillConfidence ?? 1.0) >= 0.80))
    ) {
      highConfidenceAnchors.push({ bubble: b, profile, category });
    }
  }

  for (const b of bubbles) {
    if (b.deleted) continue;
    const profile = b.styleProfile as TextStyleProfile | undefined;
    const targetCategory = inferTextStyleCategory(b);
    const isLowConfidence =
      !profile ||
      profile.source === "global" ||
      (profile.fillConfidence ?? 0) < minConfidence;

    if (
      isLowConfidence &&
      targetCategory !== "unknown" &&
      highConfidenceAnchors.length > 0
    ) {
      let nearestAnchor: (typeof highConfidenceAnchors)[number] | null = null;
      let minDistance = Infinity;

      for (const anchor of highConfidenceAnchors) {
        if (anchor.bubble === b || anchor.category !== targetCategory) continue;
        const dist = calculateBoxDistance(b.box, anchor.bubble.box);
        if (dist < minDistance && dist <= maxDistance) {
          minDistance = dist;
          nearestAnchor = anchor;
        }
      }

      if (nearestAnchor) {
        b.styleProfile = {
          ...nearestAnchor.profile,
          fillConfidence: Math.max(0.70, Math.min(0.79, nearestAnchor.profile.fillConfidence ?? 0.75)),
          outlineConfidence: Math.max(
            0.70,
            Math.min(0.79, nearestAnchor.profile.outlineConfidence ?? 0.75),
          ),
          source: "fallback",
          category: targetCategory,
          nearbySourceId: nearestAnchor.bubble.id
            ? String(nearestAnchor.bubble.id)
            : undefined,
          fallbackReason: "nearby",
        };
      }
    }
  }

  return bubbles;
}
