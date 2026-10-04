import { describe, expect, it } from "vitest";
import { TARGET_LANGUAGES, inspectTargetText, resolveTargetLanguage, normalizeTargetTranslationPayload } from "@/lib/languagePolicy";

describe("canonical language catalog", () => {
  it("enumerates broad writing systems with exact, unambiguous aliases", () => {
    expect(TARGET_LANGUAGES.length).toBeGreaterThanOrEqual(60);
    for (const profile of TARGET_LANGUAGES) {
      for (const alias of [profile.id, profile.label, ...profile.aliases]) {
        expect(resolveTargetLanguage(alias)).toMatchObject({ status: "resolved", profile: { id: profile.id } });
      }
      expect(inspectTargetText(profile.fixture, profile.id).status).toBe("eligible");
      expect(inspectTargetText(`${profile.fixture}𐐀`, profile.id).status).toBe("blocked");
    }
  });
  it.each(["", "unknown", "Thai-ish", "Serbian", "Chinese", "Punjabi", "Kurdish", "Azerbaijani", "Uzbek"])("blocks unknown or ambiguous %s", (target) => {
    expect(resolveTargetLanguage(target).status).toBe("blocked");
    expect(inspectTargetText("hello", target).status).toBe("blocked");
  });
  it("normalizes exact locale aliases only", () => {
    expect(resolveTargetLanguage(" TH_th ")).toMatchObject({ status: "resolved", profile: { id: "th" } });
    expect(resolveTargetLanguage("fr-CA")).toMatchObject({ status: "resolved", profile: { id: "fr" } });
    expect(resolveTargetLanguage("fr-made-up").status).toBe("blocked");
  });
});
describe("target-specific payload normalization", () => {
  it("keeps excluded Thai prefixes and mixed lettering available for diagnosis", () => {
    expect(normalizeTargetTranslationPayload({bubbles:[{t:"A: สวัสดี"},{t:"กאา"}]},"th").bubbles).toEqual([{t:"A: สวัสดี"},{t:"กאา"}]);
  });
  it("only runs Thai spelling/spacing cleanup on eligible Thai output", () => {
    expect(normalizeTargetTranslationPayload({bubbles:[{t:"ไกล้ ١٢"}]},"th").bubbles[0].t).toBe("ใกล้ 12");
    expect(normalizeTargetTranslationPayload({bubbles:[{t:"می‌خواهم\nسلام"}]},"fa").bubbles[0].t).toBe("می‌خواهم\nسلام");
    expect(normalizeTargetTranslationPayload({bubbles:[{t:"e\u0301\nBonjour"}]},"fr").bubbles[0].t).toBe("e\u0301\nBonjour");
  });
  it("rejects malformed rows rather than manufacturing empty points", () => {
    expect(()=>normalizeTargetTranslationPayload({bubbles:[null]},"th")).toThrow("Malformed bubble");
  });
});

describe("strict script eligibility", () => {
  it.each(["\u0378", "\uE000", "\u{F0000}", "\uD800", "\uDC00", "\u0000", "\u0001", "\u000B", "\u007F"])("blocks unverifiable code points and controls %j", character => {
    const result = inspectTargetText(`สวัสดี${character}`, "th");
    expect(result.status).toBe("blocked");
    expect(result.offendingCharacters).toContain(character);
    expect(result.normalizedText).toBe(`สวัสดี${character}`);
  });
  it("preserves explicit spacing, punctuation, symbols and supported formatting", () => {
    const text = "สวัสดี\n\t\r \u00A0\u2028\u2029\u200B\uFEFF!? + ฿";
    expect(inspectTargetText(text, "th")).toMatchObject({status:"eligible",normalizedText:text});
  });
  it.each(["ja", "zh-Hans", "zh-Hant", "ko"])("preserves Han ideographic variation selectors for %s", target => {
    for (const text of ["漢\uFE00", "漢\u{E0100}", "漢\u{E01EF}"]) {
      expect(inspectTargetText(text, target)).toMatchObject({status:"eligible",normalizedText:text});
    }
  });
  it.each([["ja", "か\u{E0100}"], ["zh-Hans", "\u{E0100}漢"], ["th", "ก\u{E0100}"], ["en", "a\uFE00"], ["ja", "漢\u{E0100}\u{E0101}"]])("rejects variation selectors outside native Han base context for %s", (target, text) => {
    expect(inspectTargetText(text, target).status).toBe("blocked");
  });
  it.each(["Hello", "BOOM", "Naruto", "กאา", "ก𐐀า", "กاา", "ก漢า", "ก\u0301า", "ก\u05B0า", "ก\u200Dา", "ⓐ", "Ⓐ", "𝐀", "ก᷀า", "กͅา"])("rejects excluded lettering/marks without deleting %s", (text) => {
    const result = inspectTargetText(text, "th");
    expect(result.status).toBe("blocked");
    expect(result.offendingCharacters.length).toBeGreaterThan(0);
    expect(result.normalizedText).toBe(text);
  });
  it("retains Thai, ASCII/Thai digits, punctuation, symbols and emoji", () => {
    expect(inspectTargetText("สวัสดี 12 ๑๒!? ฿ + © 😀 ❤️ 👩‍💻 1️⃣", "th").status).toBe("eligible");
  });
  it("normalizes known foreign numeral values for Thai only", () => {
    expect(inspectTargetText("๑ ١٢ १२ １２ ² ½", "th").normalizedText).toBe("๑ 12 12 12 2 1⁄2");
    expect(inspectTargetText("١٢", "ar").normalizedText).toBe("١٢");
    expect(inspectTargetText("Ⅳ", "th").status).toBe("blocked");
  });
  it.each(["en","ar","ja"])("preserves ordinary Common-script fractions and powers for %s",target=>{
    expect(inspectTargetText("½ ²",target)).toMatchObject({status:"eligible",normalizedText:"½ ²"});
  });
  it.each([["fr", "e\u0301"], ["fr", "e\u0301\u0308"], ["ar", "عَرَبِيّ"], ["ar", "\u061Cسلام\u200F"], ["fa", "می‌خواهم"], ["hi", "क्‍ष"], ["ja", "か\u3099"], ["ko", "한글"]])("preserves native marks/joiners for %s", (target, text) => {
    expect(inspectTargetText(text, target)).toMatchObject({ status: "eligible", normalizedText: text });
  });
  it.each([["en", "\u0301hello"], ["en", "a\u200Db"], ["ar", "ع\u0301"], ["ja", "か\u0301"], ["fr", "a\u05B0"], ["th", "ก\uFE0F"], ["en", "a\u0345"], ["ru", "а\u0363"]])("rejects incompatible/orphan marks for %s", (target, text) => {
    expect(inspectTargetText(text, target).status).toBe("blocked");
  });
});
