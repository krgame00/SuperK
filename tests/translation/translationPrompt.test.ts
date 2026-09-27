import { describe, expect, it } from "vitest";

import { buildTranslationPrompt } from "@/src/app/api/translate/route";

describe("buildTranslationPrompt script directive", () => {
  it("forbids foreign-script leakage for Thai targets", () => {
    const prompt = buildTranslationPrompt({ targetLang: "Thai" });
    expect(prompt).toContain("ENTIRELY in Thai script");
    expect(prompt).toContain("Do NOT leave any Japanese kana/kanji");
  });

  it("defaults to the Thai directive when no target language is given", () => {
    expect(buildTranslationPrompt({})).toContain("ENTIRELY in Thai script");
  });

  it("skips the Thai directive for non-Thai targets", () => {
    const prompt = buildTranslationPrompt({ targetLang: "Japanese" });
    expect(prompt).not.toContain("ENTIRELY in Thai script");
  });
});
