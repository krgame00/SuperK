import { describe, expect, it } from "vitest";
import { outsideProtectedAreas, translationScope, withinTranslationScope } from "@/lib/cleaning/textAuthorization";
import type { CleaningResult } from "@/lib/cleaning/types";

describe("translation response authorization", () => {
  const scope = { allowed: [[0, 0, 400, 400]], excluded: [[100, 100, 150, 150]] };
  it("keeps confirmed text but rejects returned uncertain artwork", () => {
    expect(withinTranslationScope([200, 200, 300, 300], scope)).toBe(true);
    expect(withinTranslationScope([100, 100, 150, 150], scope)).toBe(false);
    expect(withinTranslationScope([600, 600, 700, 700], scope)).toBe(false);
    expect(withinTranslationScope(undefined, scope)).toBe(false);
    expect(withinTranslationScope([0, 0, 0, 0], scope)).toBe(false);
  });
});

describe("outsideProtectedAreas", () => {
  const scope = { allowed: [[0, 0, 400, 400]], excluded: [[100, 100, 150, 150]] };
  it("trusts model-found bubbles outside the detector scope", () => {
    expect(outsideProtectedAreas([600, 600, 700, 700], scope)).toBe(true);
    expect(outsideProtectedAreas([200, 200, 300, 300], scope)).toBe(true);
  });
  it("still blocks protected/withheld regions and invalid boxes", () => {
    expect(outsideProtectedAreas([100, 100, 150, 150], scope)).toBe(false);
    expect(outsideProtectedAreas([140, 140, 200, 200], scope)).toBe(false);
    expect(outsideProtectedAreas(undefined, scope)).toBe(false);
    expect(outsideProtectedAreas([0, 0, 0, 0], scope)).toBe(false);
    expect(outsideProtectedAreas([600, 600, 700, 700], undefined)).toBe(true);
  });
});

describe("sfx-policy regions under ignore mode", () => {
  // 1000x1000 page: dialogue bubble top-left, SFX-lettered artwork right,
  // user-protected region bottom-left.
  const result = {
    width: 1000,
    height: 1000,
    regions: [
      { id: "r1", rect: { x: 0, y: 0, width: 400, height: 400 }, textRole: "dialogue", protectionReasons: [] },
      { id: "r2", rect: { x: 500, y: 0, width: 400, height: 400 }, textRole: "sfx", protectionReasons: ["sfx-policy"] },
      { id: "r3", rect: { x: 0, y: 500, width: 400, height: 400 }, textRole: "protected", protectionReasons: ["user-confirmed"] },
    ],
  } as unknown as CleaningResult;

  it("buckets sfx-policy regions separately from the protected veto", () => {
    const scope = translationScope(result, "ignore");
    expect(scope.allowed).toEqual([[0, 0, 400, 400]]);
    expect(scope.sfxExcluded).toEqual([[0, 500, 400, 900]]);
    expect(scope.excluded).toEqual([[500, 0, 900, 400]]);
    expect(scope.allowedRoles).toEqual(["dialogue"]);
  });

  it("keeps dialogue bubbles found inside sfx regions translatable", () => {
    const scope = translationScope(result, "ignore");
    const sfxBubble = [100, 550, 300, 750];
    expect(
      withinTranslationScope(sfxBubble, scope) || outsideProtectedAreas(sfxBubble, scope),
    ).toBe(true);
  });

  it("still vetoes bubbles overlapping user-protected regions", () => {
    const scope = translationScope(result, "ignore");
    const protectedBubble = [550, 50, 750, 250];
    expect(
      withinTranslationScope(protectedBubble, scope) || outsideProtectedAreas(protectedBubble, scope),
    ).toBe(false);
  });

  it("keeps translate-mode sfx regions inside the allowed scope", () => {
    const scope = translationScope(result, "translate");
    expect(scope.allowed).toEqual([[0, 0, 400, 400], [0, 500, 400, 900]]);
    expect(scope.sfxExcluded ?? []).toEqual([]);
    expect(scope.excluded).toEqual([[500, 0, 900, 400]]);
  });
});
