/**
 * Hyphenation engine for Latin/English words in speech balloon layouts.
 * Breaks multisyllabic words at natural boundaries to prevent balloon overflow.
 */

const LATIN_WORD_RE = /^[A-Za-z\u00C0-\u024F]+$/;
const TRAILING_PUNCTUATION_RE = /([\p{P}\p{S}]+)$/u;

const COMMON_HYPHENATION_DICT: Record<string, string[]> = {
  supercalifragilistic: ["su", "per", "cal", "i", "frag", "i", "lis", "tic"],
  congratulations: ["con", "grat", "u", "la", "tions"],
  transformation: ["trans", "for", "ma", "tion"],
  extraordinary: ["ex", "traor", "di", "nary"],
  international: ["in", "ter", "na", "tion", "al"],
  teleportation: ["tel", "e", "por", "ta", "tion"],
  resurrection: ["res", "ur", "rec", "tion"],
  reincarnation: ["re", "in", "car", "na", "tion"],
  necromancer: ["nec", "ro", "man", "cer"],
  apocalypse: ["a", "poc", "a", "lypse"],
  understandable: ["un", "der", "stand", "a", "ble"],
  understanding: ["un", "der", "stand", "ing"],
  conversation: ["con", "ver", "sa", "tion"],
  communication: ["com", "mu", "ni", "ca", "tion"],
  environment: ["en", "vi", "ron", "ment"],
  relationship: ["re", "la", "tion", "ship"],
  development: ["de", "vel", "op", "ment"],
  immediately: ["im", "me", "di", "ate", "ly"],
  impossible: ["im", "pos", "si", "ble"],
  adventurer: ["ad", "ven", "tur", "er"],
  adventure: ["ad", "ven", "ture"],
  mysterious: ["mys", "te", "ri", "ous"],
  information: ["in", "for", "ma", "tion"],
  disappeared: ["dis", "ap", "peared"],
};

const COMMON_PREFIXES = [
  "anti", "auto", "circum", "contra", "counter", "extra", "hyper", "inter",
  "intra", "intro", "macro", "micro", "multi", "over", "photo", "poly",
  "pseudo", "retro", "semi", "sub", "super", "tele", "trans", "ultra",
  "under", "dis", "mis", "pre", "pro", "non", "con", "com",
];

const COMMON_SUFFIXES = [
  "action", "ation", "ition", "ution", "able", "ible", "ably", "ibly",
  "ance", "ence", "fully", "ingly", "ment", "ness", "ship", "sion",
  "tion", "ture", "ward", "wise", "less", "hood", "ing", "ful", "ous",
  "ist", "ity", "ive", "ize", "ise",
];

const UNSPLITTABLE_BLENDS = new Set([
  "ch", "sh", "th", "wh", "ph", "gh", "qu", "ck",
  "bl", "cl", "fl", "gl", "pl", "sl",
  "br", "cr", "dr", "fr", "gr", "pr", "tr",
  "sc", "sk", "sm", "sn", "sp", "st", "sw",
]);

const VOWEL_RE = /[aeiouy]/i;

export function canHyphenateWord(token: string): boolean {
  if (!token) return false;
  const match = token.match(TRAILING_PUNCTUATION_RE);
  const core = match ? token.slice(0, token.length - match[1].length) : token;
  return core.length >= 5 && LATIN_WORD_RE.test(core);
}

function ruleBasedSyllables(wordLower: string): string[] {
  if (wordLower.length < 5) return [wordLower];

  const prefix = COMMON_PREFIXES.find(
    (p) => wordLower.startsWith(p) && wordLower.length - p.length >= 3,
  );
  if (prefix) {
    const remainder = wordLower.slice(prefix.length);
    return [prefix, ...ruleBasedSyllables(remainder)];
  }

  const suffix = COMMON_SUFFIXES.find(
    (s) => wordLower.endsWith(s) && wordLower.length - s.length >= 3,
  );
  if (suffix) {
    const stem = wordLower.slice(0, wordLower.length - suffix.length);
    return [...ruleBasedSyllables(stem), suffix];
  }

  const syllables: string[] = [];
  let curStart = 0;
  const len = wordLower.length;

  for (let i = 1; i < len - 2; i++) {
    const c1 = wordLower[i];
    const c2 = wordLower[i + 1];
    const isC1Consonant = !VOWEL_RE.test(c1);
    const isC2Consonant = !VOWEL_RE.test(c2);

    if (c1 === c2 && isC1Consonant) {
      syllables.push(wordLower.slice(curStart, i + 1));
      curStart = i + 1;
      i++;
      continue;
    }

    if (isC1Consonant && isC2Consonant) {
      const blend = c1 + c2;
      if (!UNSPLITTABLE_BLENDS.has(blend)) {
        syllables.push(wordLower.slice(curStart, i + 1));
        curStart = i + 1;
        i++;
        continue;
      }
    }
  }

  if (curStart < len) {
    syllables.push(wordLower.slice(curStart));
  }

  return syllables.length > 0 ? syllables : [wordLower];
}

export function hyphenateWord(token: string): string[] {
  if (!token) return [];
  const punctMatch = token.match(TRAILING_PUNCTUATION_RE);
  const trailingPunct = punctMatch ? punctMatch[1] : "";
  const core = trailingPunct ? token.slice(0, token.length - trailingPunct.length) : token;

  if (!canHyphenateWord(core)) return [token];

  const lower = core.toLowerCase();
  const rawSyllables = COMMON_HYPHENATION_DICT[lower] ?? ruleBasedSyllables(lower);

  const isAllUpper = core === core.toUpperCase();
  const isTitle = core[0] === core[0].toUpperCase() && core.slice(1) === core.slice(1).toLowerCase();

  let offset = 0;
  const result: string[] = [];

  for (let idx = 0; idx < rawSyllables.length; idx++) {
    const sylLen = rawSyllables[idx].length;
    let syl = core.slice(offset, offset + sylLen);
    offset += sylLen;

    if (isAllUpper) {
      syl = syl.toUpperCase();
    } else if (isTitle && idx === 0) {
      syl = syl.charAt(0).toUpperCase() + syl.slice(1).toLowerCase();
    } else if (isTitle) {
      syl = syl.toLowerCase();
    }

    if (idx === rawSyllables.length - 1 && trailingPunct) {
      syl += trailingPunct;
    }
    result.push(syl);
  }

  return result.length > 0 ? result : [token];
}

export function splitWordByHyphen(
  token: string,
  maxWidth: number,
  measureText: (val: string) => number,
  hyphen = "-",
): { head: string; tail: string } | null {
  const syllables = hyphenateWord(token);
  if (syllables.length <= 1) return null;

  let bestSplit: { head: string; tail: string } | null = null;

  for (let i = 0; i < syllables.length - 1; i++) {
    const headCandidate = syllables.slice(0, i + 1).join("") + hyphen;
    const width = measureText(headCandidate);
    if (width <= maxWidth) {
      bestSplit = {
        head: headCandidate,
        tail: syllables.slice(i + 1).join(""),
      };
    } else {
      break;
    }
  }

  return bestSplit;
}

export function breakWordIntoHyphenatedLines(
  token: string,
  measureText: (val: string) => number,
  limitAtLine: (lineIndex: number) => number,
  startLineIndex: number,
  hyphen = "-",
): { lines: string[]; overflow: boolean } {
  const syllables = hyphenateWord(token);
  if (syllables.length <= 1) {
    const limit = limitAtLine(startLineIndex);
    return {
      lines: [token],
      overflow: measureText(token) > limit * 1.05,
    };
  }

  const resultLines: string[] = [];
  let curLineIdx = startLineIndex;
  let sylIdx = 0;

  while (sylIdx < syllables.length) {
    const limit = limitAtLine(curLineIdx);
    let bestHead = "";
    let nextSylIdx = sylIdx;

    for (let end = sylIdx + 1; end <= syllables.length; end++) {
      const isLastChunk = end === syllables.length;
      const candidate = syllables.slice(sylIdx, end).join("") + (isLastChunk ? "" : hyphen);
      if (measureText(candidate) <= limit * 1.05) {
        bestHead = candidate;
        nextSylIdx = end;
      } else {
        break;
      }
    }

    if (nextSylIdx > sylIdx) {
      resultLines.push(bestHead);
      sylIdx = nextSylIdx;
      curLineIdx++;
    } else {
      const isLastChunk = sylIdx === syllables.length - 1;
      const fallback = syllables[sylIdx] + (isLastChunk ? "" : hyphen);
      resultLines.push(fallback);
      sylIdx++;
      curLineIdx++;
    }
  }

  const overflow = resultLines.some(
    (line, idx) => measureText(line) > limitAtLine(startLineIndex + idx) * 1.05,
  );
  return { lines: resultLines, overflow };
}
