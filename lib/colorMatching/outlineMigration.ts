import { normalizeCssColor, type ColorSampleRegion } from "./types";
import type { TranslatedBubble } from "../translationOverlay";
import { colorDistance, extractTextColors } from "./sampleTextColors";
import { SOURCE_OUTLINE_VERSION } from "./sourceOutlineEvidence";

/** Only recovered source styles own an outline that can be migrated. */
export function needsSourceOutlineRefresh(bubble: TranslatedBubble): boolean {
  const profile = bubble.styleProfile;
  if (!profile || bubble.deleted || profile.sourceOutlineVersion ||
      profile.source !== "auto" || profile.ownershipMode === "manual" || profile.ownershipMode === "readable") {
    return false;
  }
  return profile.evidenceState === "admitted" &&
    (profile.ownershipMode === "source_faithful" || (profile.fillConfidence ?? 1) >= .80) &&
    !["background-contamination", "insufficient-evidence", "low-readability"].includes(profile.fallbackReason ?? "");
}

/** Refresh outline measurements from original pixels, retaining recovered fill and user choices. */
export function refreshSourceOutline(bubble: TranslatedBubble, sample: ColorSampleRegion | null): TranslatedBubble {
  if (!needsSourceOutlineRefresh(bubble) || !sample || sample.width <= 0 || sample.height <= 0 ||
      sample.rgba.length < sample.width * sample.height * 4) return bubble;
  const recovered = extractTextColors(sample);
  if (recovered.source !== "auto" || recovered.evidenceState !== "admitted" ||
      recovered.sourceOutlineVersion !== SOURCE_OUTLINE_VERSION) return bubble;
  const storedFill = normalizeCssColor(bubble.styleProfile!.fill, "");
  const recoveredFill = normalizeCssColor(recovered.fill, "");
  if (!/^#[0-9a-f]{6}$/.test(storedFill) || !/^#[0-9a-f]{6}$/.test(recoveredFill)) return bubble;
  // Contour measurements belong to the sampled fill. A different fill may identify another
  // glyph or background plane, so keep the prior style and render until reliable reanalysis.
  if (colorDistance(
    parseInt(storedFill.slice(1, 3), 16), parseInt(storedFill.slice(3, 5), 16), parseInt(storedFill.slice(5, 7), 16),
    parseInt(recoveredFill.slice(1, 3), 16), parseInt(recoveredFill.slice(3, 5), 16), parseInt(recoveredFill.slice(5, 7), 16),
  ) > 40) return bubble;
  return { ...bubble, styleProfile: { ...bubble.styleProfile!,
    outline: recovered.outline,
    hasOutline: recovered.hasOutline,
    outlineWidth: recovered.outlineWidth,
    outlineWidthRatio: recovered.outlineWidthRatio,
    outlineConfidence: recovered.outlineConfidence,
    sourceOutlineVersion: SOURCE_OUTLINE_VERSION,
  } };
}
