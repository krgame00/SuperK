/**
 * SuperK Thai Manga Text Normalizer & Spellcheck Engine.
 * Fixes common LLM tokenization glitches, vowel stacking,
 * manga slang typos (นะค่ะ -> นะคะ), and punctuation spacing.
 */

// Common Thai word dictionary mappings (frequent AI translation misspellings).
// The optional third element marks FRAGMENT patterns — the matched text is not
// a standalone Thai word (คระ, คร่า), so it is only fixed word-finally; applied
// anywhere it would corrupt real words that begin with it (คระหนัก, คร่าว).
const THAI_SPELLCHECK_DICTIONARY: Array<[RegExp, string, boolean?]> = [
  // 1. Classic Particle / Ending Typos
  [/นะค่ะ/g, "นะคะ"],
  [/นะค้ะ/g, "นะคะ"],
  [/คระ/g, "ค่ะ", true],
  [/คร่า/g, "ค่า", true],

  // 2. Common Vowel / Consonant Confusion
  [/ไกล้/g, "ใกล้"],
  [/ไคร/g, "ใคร"],
  [/สัมผัด/g, "สัมผัส"],
  [/สังเกตุ/g, "สังเกต"],
  [/โอกาศ/g, "โอกาส"],
  [/อนุญาติ/g, "อนุญาต"],
  [/กาละเทศะ/g, "กาลเทศะ"],
  [/น่ารำคาน/g, "น่ารำคาญ"],
  [/ลายเซ็นต์/g, "ลายเซ็น"],
  [/มุขตลก/g, "มุกตลก"],
  [/เล่นมุข/g, "เล่นมุก"],
  [/ตบมุข/g, "ตบมุก"],
  [/ผูกพันธ์/g, "ผูกพัน"],
  [/อารมย์/g, "อารมณ์"],
  [/เวทย์มนต์/g, "เวทมนตร์"],
  [/เวทมนต์/g, "เวทมนตร์"],
  [/กรรไก/g, "กรรไกร"],
  [/คลีนิก/g, "คลินิก"],
  [/คลีนิค/g, "คลินิก"],
  [/กระเพรา/g, "กะเพรา"],
  [/กะเพาะ/g, "กระเพาะ"],
  [/เปอเซนต์/g, "เปอร์เซ็นต์"],
  [/เปอร์เซนต์/g, "เปอร์เซ็นต์"],
  [/อินเตอร์เน็ต/g, "อินเทอร์เน็ต"],
  [/บล็อค/g, "บล็อก"],
  [/สเน่ห์/g, "เสน่ห์"],
  [/ปราถนา/g, "ปรารถนา"],
  [/กระทันหัน/g, "กะทันหัน"],
  [/บรรได/g, "บันได"],
  [/เบรค/g, "เบรก"],
  [/ออฟฟิต/g, "ออฟฟิศ"],
  [/ศรีษะ/g, "ศีรษะ"],
  [/พะแนง/g, "พะแนง"],
  [/แพนง/g, "พะแนง"],
  [/ผัดกระเพรา/g, "ผัดกะเพรา"],
];

/**
 * Clean up redundant Thai tone marks and vowel stacking.
 * e.g. accidental duplicate marks like สระอิ + สระอี or double tone marks
 */
export function cleanThaiVowelStacking(text: string): string {
  if (!text) return "";

  return text
    // Remove zero-width characters (ZWSP, BOM)
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    // Normalize decomposed Sara Am (ํ + า -> ำ)
    .replace(/\u0E4D\u0E32/g, "\u0E33")
    // Remove duplicate upper vowels (ิ ี ึ ื ั ็)
    .replace(/([\u0E31\u0E34-\u0E37\u0E47])[\u0E31\u0E34-\u0E37\u0E47]+/g, "$1")
    // Remove duplicate lower vowels (ุ ู)
    .replace(/([\u0E38\u0E39])[\u0E38\u0E39]+/g, "$1")
    // Remove duplicate tone marks (่ ้ ๊ ๋ ์)
    .replace(/([\u0E48-\u0E4C])[\u0E48-\u0E4C]+/g, "$1")
    // Fix vowel placed after tone mark (e.g. ก้ิ -> กิ้)
    .replace(/([\u0E48-\u0E4C])([\u0E31\u0E34-\u0E39\u0E47])/g, "$2$1");
}

/**
 * Clean up punctuation, spaces, and manga dialogue formatting.
 */
export function cleanPunctuationAndSpacing(text: string): string {
  if (!text) return "";

  return text
    // Replace multiple newlines inside a single bubble with a space
    .replace(/\r?\n+/g, " ")
    // Collapse 4+ periods into standard ellipsis (...)
    .replace(/\.{4,}/g, "...")
    .replace(/…+/g, "...")
    // Clean up spaces before Thai punctuation / particles like ? ! ~
    .replace(/\s+([?!~]+)/g, "$1")
    // Ensure space after punctuation if followed by Thai / English word
    .replace(/([?!~]+)([A-Za-z\u0E01-\u0E5B])/g, "$1 $2")
    // Normalize maiyamok (ๆ) - attach to preceding word or clean spacing
    .replace(/\s+ๆ/g, "ๆ")
    .replace(/ๆ([A-Za-z\u0E01-\u0E5B])/g, "ๆ $1")
    // Remove duplicate spaces
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Thai has no space-delimited words, so a bare substring replace corrupts
 * real words that merely contain the typo ("อักขระ" contains คระ, "คร่าว"
 * contains คร่า). Dictionary matches are therefore applied only when they
 * align with word boundaries from Intl.Segmenter: the match must start at a
 * word-like token's start and end at one's end — "นะค่ะ" spanning the tokens
 * นะ|ค่ะ still counts, while a match inside a single token does not. Without
 * Intl.Segmenter we fall back to the old substring behavior.
 */
type WordBounds = { starts: Set<number>; ends: Set<number> };

const thaiWordSegmenter: Intl.Segmenter | undefined =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter("th", { granularity: "word" })
    : undefined;

function segmentWordBounds(text: string): WordBounds | null {
  if (!thaiWordSegmenter) return null;
  const starts = new Set<number>();
  const ends = new Set<number>();
  for (const part of thaiWordSegmenter.segment(text)) {
    if (part.isWordLike) {
      starts.add(part.index);
      ends.add(part.index + part.segment.length);
    }
  }
  return { starts, ends };
}

function replaceAtWordBounds(
  text: string,
  pattern: RegExp,
  replacement: string,
  bounds: WordBounds,
  wordFinal: boolean,
): string {
  let result = "";
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (!bounds.starts.has(start) || !bounds.ends.has(end)) continue;
    // Fragment patterns must end the word: a directly following Thai letter
    // means the fragment is the prefix of a longer real word.
    if (wordFinal && /^[\u0E01-\u0E3A\u0E40-\u0E4E]/.test(text.slice(end))) {
      continue;
    }
    result += text.slice(last, start) + replacement;
    last = end;
  }
  return result + text.slice(last);
}

/**
 * Primary normalization function for a single translated Thai sentence.
 */
export function normalizeThaiText(text: string): string {
  if (!text || typeof text !== "string") return "";

  let cleaned = text;

  // 1. Strip dialogue speaker prefix hallucinations e.g. "Cหึๆ", "C: ", "C1: ", "A: ", "B: "
  cleaned = cleaned.replace(/^[A-Za-z][0-9]*[:：\s]?\s*(?=[\u0E00-\u0E7F])/g, "");

  // 2. Clean Unicode & Vowel Stacking
  cleaned = cleanThaiVowelStacking(cleaned);

  // 3. Apply Thai Spellcheck Dictionary (word-boundary aligned)
  for (const [pattern, replacement, wordFinal] of THAI_SPELLCHECK_DICTIONARY) {
    const bounds = segmentWordBounds(cleaned);
    cleaned = bounds
      ? replaceAtWordBounds(cleaned, pattern, replacement, bounds, wordFinal === true)
      : cleaned.replace(pattern, replacement);
  }

  // 4. Punctuation & Manga Layout Formatting
  cleaned = cleanPunctuationAndSpacing(cleaned);

  return cleaned;
}

/**
 * Gemini occasionally leaks foreign-script characters into the translation:
 * Japanese kana/kanji carried over from the source page, Cyrillic glitch
 * runs, or Hangul. Latin letters stay allowed (names, SFX, brand words).
 */
const FOREIGN_SCRIPT_PATTERNS: Array<[RegExp, string]> = [
  [/[\u3040-\u30FF\u31F0-\u31FF]/g, "Japanese kana"],
  [/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g, "CJK kanji"],
  [/[\u0400-\u04FF]/g, "Cyrillic"],
  [/[\uAC00-\uD7AF\u1100-\u11FF]/g, "Hangul"],
];

export function countForeignScriptChars(text: string): number {
  if (!text) return 0;
  let count = 0;
  for (const [pattern] of FOREIGN_SCRIPT_PATTERNS) {
    count += (text.match(pattern) ?? []).length;
  }
  return count;
}

export function describeForeignScripts(text: string): string[] {
  if (!text) return [];
  // `.match` (not `.test`) — global regexes keep lastIndex state between tests.
  return FOREIGN_SCRIPT_PATTERNS
    .filter(([pattern]) => text.match(pattern) !== null)
    .map(([, name]) => name);
}

/** How many bubbles carry foreign-script characters in their translation. */
export function countContaminatedBubbles(
  bubbles: Array<{ t?: unknown }>,
): number {
  return bubbles.reduce(
    (total, b) =>
      total +
      (typeof b?.t === "string" && countForeignScriptChars(b.t) > 0 ? 1 : 0),
    0,
  );
}

/**
 * Normalize and spell-check all bubble texts in a parsed translation object.
 */
export function normalizeTranslationPayload<T extends { bubbles?: unknown[] }>(payload: T): T {
  if (!payload || typeof payload !== "object") return payload;

  if (Array.isArray(payload.bubbles)) {
    return {
      ...payload,
      bubbles: payload.bubbles.map((b: unknown) => {
        // Malformed elements (null / primitives) must hard-fail the
        // translation so callers fall into retry/error handling instead of
        // rendering an empty ghost bubble.
        if (typeof b !== "object" || b === null) {
          throw new Error("Malformed bubble element in translation response");
        }
        const entry = b as { t?: unknown };
        return {
          ...entry,
          t: typeof entry.t === "string" ? normalizeThaiText(entry.t) : entry.t,
        };
      }),
    };
  }

  return payload;
}