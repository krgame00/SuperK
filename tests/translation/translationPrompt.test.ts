import { describe, expect, it } from "vitest";

import { buildTranslationPrompt } from "@/src/app/api/translate/handler";

describe("buildTranslationPrompt script directive", () => {
  it("forbids foreign-script leakage for Thai targets", () => {
    const prompt = buildTranslationPrompt({ targetLang: "Thai" });
    expect(prompt).toContain("ENTIRELY in Thai script");
    expect(prompt).toContain("Do NOT leave any Japanese kana/kanji");
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
});

