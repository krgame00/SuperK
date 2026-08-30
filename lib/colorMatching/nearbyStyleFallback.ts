import type { TranslatedBubble } from "@/lib/translationOverlay";
import type { TextStyleProfile } from "./types";

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

/**
 * Enriches low-confidence bubbles with style inheritance from spatially nearby
 * high-confidence bubbles on the same page (Section 9 in Style Preservation Plan).
 */
export function applyNearbyStyleFallbacks(
  bubbles: TranslatedBubble[],
  options: NearbyFallbackOptions = {},
): TranslatedBubble[] {
  const minConfidence = options.minConfidenceThreshold ?? 0.60;
  const maxDistance = options.maxDistanceThreshold ?? 350; // 35% of page dimension in 0-1000 scale

  // 1. Gather all high-confidence anchor styles
  const highConfidenceAnchors: Array<{
    bubble: TranslatedBubble;
    profile: TextStyleProfile;
  }> = [];

  for (const b of bubbles) {
    if (b.deleted) continue;
    const profile = b.styleProfile as TextStyleProfile | undefined;
    if (
      profile &&
      (profile.source === "manual" ||
        (profile.source === "auto" && (profile.fillConfidence ?? 1.0) >= 0.70))
    ) {
      highConfidenceAnchors.push({ bubble: b, profile });
    }
  }

  // 2. Apply fallback to low-confidence or unstyled bubbles
  for (const b of bubbles) {
    if (b.deleted) continue;
    const profile = b.styleProfile as TextStyleProfile | undefined;
    const isLowConfidence =
      !profile ||
      profile.source === "global" ||
      (profile.fillConfidence ?? 0) < minConfidence;

    if (isLowConfidence && highConfidenceAnchors.length > 0) {
      let nearestAnchor: {
        bubble: TranslatedBubble;
        profile: TextStyleProfile;
      } | null = null;
      let minDistance = Infinity;

      for (const anchor of highConfidenceAnchors) {
        if (anchor.bubble === b) continue;
        const dist = calculateBoxDistance(b.box, anchor.bubble.box);
        if (dist < minDistance && dist <= maxDistance) {
          minDistance = dist;
          nearestAnchor = anchor;
        }
      }

      if (nearestAnchor) {
        b.styleProfile = {
          fill: nearestAnchor.profile.fill,
          outline: nearestAnchor.profile.outline,
          outlineWidth: nearestAnchor.profile.outlineWidth ?? 1.0,
          opacity: nearestAnchor.profile.opacity ?? 1.0,
          fillConfidence: 0.75, // inherited confidence
          outlineConfidence: nearestAnchor.profile.outlineConfidence ?? 0.75,
          source: "fallback",
          nearbySourceId: nearestAnchor.bubble.id ? String(nearestAnchor.bubble.id) : undefined,
        };
      }
    }
  }

  return bubbles;
}
