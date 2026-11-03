const CJK_REGEX = /[\u4e00-\u9fa5\u3040-\u309f\u30a0-\u30ff]/g;

export interface SanitizedTranslation {
  cleanedText: string;
  hasStrippedSourceEcho: boolean;
}

/**
 * Sanitizes model translation text by stripping foreign CJK echo leakage.
 * Pure boundary guard preventing raw Japanese/Chinese source text from leaking into Thai/English dialogue.
 */
export function sanitizeMangaTranslation(
  rawText: string,
  targetLang?: string,
): SanitizedTranslation {
  if (targetLang && /^(ja|zh|ko|japanese|chinese|korean)/i.test(targetLang.trim())) {
    return {
      cleanedText: rawText,
      hasStrippedSourceEcho: false,
    };
  }

  CJK_REGEX.lastIndex = 0;
  const hasEcho = CJK_REGEX.test(rawText);
  if (!hasEcho) {
    return {
      cleanedText: rawText,
      hasStrippedSourceEcho: false,
    };
  }

  CJK_REGEX.lastIndex = 0;
  let cleanedText = rawText.replace(CJK_REGEX, "").trim();
  cleanedText = cleanedText.replace(/^[-–—>\s:]+/, "").trim();

  return {
    cleanedText: cleanedText || rawText,
    hasStrippedSourceEcho: true,
  };
}

/**
 * Pure JSON transformer that parses translation response text and applies CJK sanitization to every bubble.
 */
export function sanitizeTranslationPayloadJson(
  rawJson: string,
  targetLang?: string,
): string {
  try {
    const parsed = JSON.parse(rawJson);
    if (!parsed || !Array.isArray(parsed.bubbles)) {
      return rawJson;
    }
    const sanitizedBubbles = parsed.bubbles.map((b: unknown) => {
      if (typeof b === "object" && b !== null && "t" in b && typeof (b as { t: unknown }).t === "string") {
        const { cleanedText } = sanitizeMangaTranslation((b as { t: string }).t, targetLang);
        return { ...b, t: cleanedText };
      }
      return b;
    });
    return JSON.stringify({ ...parsed, bubbles: sanitizedBubbles });
  } catch {
    return rawJson;
  }
}
