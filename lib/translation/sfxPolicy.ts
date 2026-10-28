import type { TranslatedBubble } from "@/lib/translationOverlay";
import { inferTextStyleCategory } from "@/lib/colorMatching/nearbyStyleFallback";

export type SfxMode = "ignore" | "preserve" | "translate";

/**
 * Determines whether a bubble represents a sound effect (SFX).
 * Checks explicit boolean flags, semantic style categories, and asterisk-wrapped text syntax.
 */
export function isSfxBubble(bubble: TranslatedBubble): boolean {
  if (
    bubble.isSfx === true ||
    (bubble as { is_sfx?: boolean }).is_sfx === true ||
    (bubble as { sfx?: boolean }).sfx === true
  ) {
    return true;
  }

  const rawCat = String(
    bubble.styleCategory ??
      (bubble as { category?: string }).category ??
      bubble.styleProfile?.category ??
      "",
  )
    .trim()
    .toLowerCase();

  if (
    rawCat === "sfx" ||
    rawCat === "sound" ||
    rawCat === "sound-effect" ||
    rawCat === "sound_effect" ||
    rawCat === "effect"
  ) {
    return true;
  }

  const textVal = String(
    bubble.t ?? bubble.translated ?? bubble.original_text ?? "",
  ).trim();

  // Asterisk-wrapped text e.g. *ตู้ม*, *BOOM*, *โครม*
  if (/^\*[^*\n]{1,24}\*$/u.test(textVal)) {
    return true;
  }

  // Fallback to visual and semantic category classification
  const inferred = inferTextStyleCategory(bubble);
  return inferred === "sfx";
}

/**
 * Applies the SFX policy reactively across bubbles in-place without data loss.
 *
 * - "ignore": Marks SFX bubbles as `hidden: true` so they disappear from the active canvas
 *   and export without destroying their underlying text data.
 * - "preserve": Restores `hidden: false` and sets bubble text to the original source text (`original_text`).
 * - "translate": Restores `hidden: false` and displays the translated sound effect text.
 */
export function applyLiveSfxPolicy(
  bubbles: TranslatedBubble[],
  mode: SfxMode,
): TranslatedBubble[] {
  for (const b of bubbles) {
    const isSfx = isSfxBubble(b);
    if (!isSfx) continue;

    b.isSfx = true;
    const currentText = String(b.t ?? b.translated ?? "").trim();
    const origText = String(b.original_text ?? "").trim();

    // Cache the translated version if not yet recorded
    if (!b.sfxTranslated && currentText && currentText !== origText) {
      b.sfxTranslated = currentText;
    }
    // Cache the original version if not yet recorded
    if (!b.sfxOriginal && origText) {
      b.sfxOriginal = origText;
    }

    if (mode === "ignore") {
      b.hidden = true;
    } else if (mode === "preserve") {
      b.hidden = false;
      const targetText = b.sfxOriginal || origText || currentText;
      if (targetText) {
        b.t = targetText;
        b.translated = targetText;
      }
    } else if (mode === "translate") {
      b.hidden = false;
      const targetText = b.sfxTranslated || currentText;
      if (targetText) {
        b.t = targetText;
        b.translated = targetText;
      }
    }
  }
  return bubbles;
}
