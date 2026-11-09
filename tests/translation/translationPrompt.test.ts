import { describe, expect, it } from "vitest";

import { buildTranslationPrompt } from "@/src/app/api/translate/handler";

describe("buildTranslationPrompt script directive", () => {
  it("forbids foreign-script leakage for Thai targets", () => {
    const prompt = buildTranslationPrompt({ targetLang: "Thai" });
    expect(prompt).toContain("ENTIRELY in Thai script");
    expect(prompt).toContain("Do NOT leave any Chinese characters (simplified or traditional");
    expect(prompt).toContain("Japanese kana/kanji");
    // Chinese-source echo guard: the model must never copy the source back.
    expect(prompt).toContain("never copy, echo, or transliterate it back as Chinese");
  });

  it("defaults to the Thai directive when no target language is given", () => {
    expect(buildTranslationPrompt({})).toContain("ENTIRELY in Thai script");
  });

  it("applies the Thai script directive when targetLang is ISO code 'th' and forbids Latin letters in 't'", () => {
    const prompt = buildTranslationPrompt({ targetLang: "th" });
    expect(prompt).toContain("Translate this manga page to Thai.");
    expect(prompt).toContain("ENTIRELY in Thai script");
    expect(prompt).not.toContain("Latin letters are allowed");
  });

  it("skips the Thai directive for non-Thai targets", () => {
    const prompt = buildTranslationPrompt({ targetLang: "Japanese" });
    expect(prompt).not.toContain("ENTIRELY in Thai script");
  });

  it("explicitly instructs detection of rectangular, trapezoidal, slanted, and narrative dialogue boxes", () => {
    const prompt = buildTranslationPrompt({ targetLang: "Thai" });
    expect(prompt).toContain("rectangular or trapezoidal boxes");
    expect(prompt).toContain("slanted/tilted dialogue boxes");
    expect(prompt).toContain("floating text outside bubbles");
    expect(prompt).toContain("small handwritten text beside panels or character faces");
  });

  it("injects pronoun matrix instructions when pronounMatrix is passed", () => {
    const prompt = buildTranslationPrompt({
      targetLang: "Thai",
      pronounMatrix: [
        {
          speaker: "ลอยด์",
          listener: "ยอร์",
          firstPerson: "ผม",
          secondPerson: "คุณ",
          note: "คู่แต่งงานปลอมๆ สุภาพ",
        },
      ],
    });
    expect(prompt).toContain("CHARACTER PRONOUN & RELATIONSHIP MATRIX (MANDATORY CONSISTENCY):");
    expect(prompt).toContain('- When "ลอยด์" speaks to "ยอร์": MUST use 1st-person self: "ผม", 2nd-person addressee: "คุณ", Tone/Nuance: คู่แต่งงานปลอมๆ สุภาพ');
  });

  it("omits pronoun matrix section when pronounMatrix is empty or undefined", () => {
    const prompt = buildTranslationPrompt({ targetLang: "Thai", pronounMatrix: [] });
    expect(prompt).not.toContain("CHARACTER PRONOUN & RELATIONSHIP MATRIX");
  });
});
