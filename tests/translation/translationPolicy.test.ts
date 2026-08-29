import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRANSLATION_POLICY,
  buildPolicyDirectives,
  resolveTranslationPolicy,
} from "@/lib/translationPolicy";

describe("translationPolicy", () => {
  it("defaults to ignoring SFX and credits while translating dialogue and narration", () => {
    expect(DEFAULT_TRANSLATION_POLICY).toEqual({
      dialogue: "translate",
      narration: "translate",
      sfx: "ignore",
      credits: "ignore",
      uncertainText: "translate",
    });
  });

  it("resolves partial policy with default fallbacks", () => {
    const resolved = resolveTranslationPolicy({ sfx: "translate" });
    expect(resolved).toEqual({
      dialogue: "translate",
      narration: "translate",
      sfx: "translate",
      credits: "ignore",
      uncertainText: "translate",
    });
  });

  it("builds prompt directives with default ignore-SFX rules", () => {
    const directives = buildPolicyDirectives();
    expect(directives).toContain("Translate ONLY story-bearing dialogue");
    expect(directives).toContain("IGNORE interface text");
    expect(directives).toContain("IGNORE all Sound Effects (SFX). Do NOT translate them.");
    expect(directives).toContain("DO NOT hallucinate text");
  });

  it("builds prompt directives when SFX translation is enabled", () => {
    const directives = buildPolicyDirectives({ sfx: "translate" });
    expect(directives).toContain("Translate Sound Effects (SFX) and wrap them in asterisks");
    expect(directives).not.toContain("IGNORE all Sound Effects (SFX)");
  });

  it("builds prompt directives when SFX preservation is requested", () => {
    const directives = buildPolicyDirectives({ sfx: "preserve" });
    expect(directives).toContain("PRESERVE Sound Effects (SFX)");
    expect(directives).not.toContain("IGNORE all Sound Effects (SFX)");
  });
});
