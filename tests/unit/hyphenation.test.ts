import { describe, expect, it } from "vitest";
import {
  breakWordIntoHyphenatedLines,
  canHyphenateWord,
  hyphenateWord,
  splitWordByHyphen,
} from "@/lib/text/hyphenation";

describe("hyphenation domain", () => {
  describe("canHyphenateWord", () => {
    it("accepts Latin alphabetic words with length of 5 or more", () => {
      expect(canHyphenateWord("transformation")).toBe(true);
      expect(canHyphenateWord("EXTRAORDINARY")).toBe(true);
      expect(canHyphenateWord("Hello")).toBe(true);
    });

    it("rejects words shorter than 5 characters", () => {
      expect(canHyphenateWord("that")).toBe(false);
      expect(canHyphenateWord("and")).toBe(false);
      expect(canHyphenateWord("a")).toBe(false);
    });

    it("rejects Thai and non-Latin words", () => {
      expect(canHyphenateWord("สวัสดี")).toBe(false);
      expect(canHyphenateWord("ข้อความ")).toBe(false);
      expect(canHyphenateWord("12345")).toBe(false);
    });
  });

  describe("hyphenateWord", () => {
    it("hyphenates known compound and multisyllabic words into syllable chunks", () => {
      expect(hyphenateWord("transformation")).toEqual(["trans", "for", "ma", "tion"]);
      expect(hyphenateWord("congratulations")).toEqual(["con", "grat", "u", "la", "tions"]);
      expect(hyphenateWord("extraordinary")).toEqual(["ex", "traor", "di", "nary"]);
      expect(hyphenateWord("supercalifragilistic")).toEqual(["su", "per", "cal", "i", "frag", "i", "lis", "tic"]);
      expect(hyphenateWord("international")).toEqual(["in", "ter", "na", "tion", "al"]);
    });

    it("preserves uppercase casing across all syllables", () => {
      expect(hyphenateWord("TRANSFORMATION")).toEqual(["TRANS", "FOR", "MA", "TION"]);
      expect(hyphenateWord("CONGRATULATIONS")).toEqual(["CON", "GRAT", "U", "LA", "TIONS"]);
    });

    it("preserves title case on the leading syllable", () => {
      expect(hyphenateWord("Transformation")).toEqual(["Trans", "for", "ma", "tion"]);
    });

    it("preserves attached trailing punctuation on the final syllable", () => {
      expect(hyphenateWord("transformation!")).toEqual(["trans", "for", "ma", "tion!"]);
      expect(hyphenateWord("extraordinary,")).toEqual(["ex", "traor", "di", "nary,"]);
    });
  });

  describe("splitWordByHyphen", () => {
    const measureByLength = (val: string) => val.length * 10;

    it("finds the largest syllable prefix that fits within maxWidth with a hyphen attached", () => {
      // "trans-" is 6 chars = 60px. "trans-for-" is 10 chars = 100px.
      // With maxWidth 70px, "trans-" fits, but "trans-for-" does not.
      const split = splitWordByHyphen("transformation", 70, measureByLength);
      expect(split).not.toBeNull();
      expect(split?.head).toBe("trans-");
      expect(split?.tail).toBe("formation");
    });

    it("returns multiple syllables in head if they fit within maxWidth", () => {
      // With maxWidth 95px, "transfor-" (90px) fits, but "transforma-" (110px) does not.
      const split = splitWordByHyphen("transformation", 95, measureByLength);
      expect(split).not.toBeNull();
      expect(split?.head).toBe("transfor-");
      expect(split?.tail).toBe("mation");
    });

    it("returns null if even the first syllable with a hyphen exceeds maxWidth", () => {
      // "trans-" is 60px. With maxWidth 40px, it cannot fit.
      const split = splitWordByHyphen("transformation", 40, measureByLength);
      expect(split).toBeNull();
    });
  });

  describe("breakWordIntoHyphenatedLines", () => {
    const measureByLength = (val: string) => val.length * 10;
    const limit = () => 65 * 0.88; // 57.2px

    it("breaks a word across multiple lines using valid syllable hyphenation", () => {
      const res = breakWordIntoHyphenatedLines("supercalifragilistic", measureByLength, limit, 0);
      expect(res.lines.length).toBeGreaterThan(1);
      expect(res.lines[0].endsWith("-")).toBe(true);
      expect(res.lines.join("").replace(/-/g, "")).toBe("supercalifragilistic");
      expect(res.overflow).toBe(false);
    });
  });
});
