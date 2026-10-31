import { describe, expect, it } from "vitest";
import { outsideProtectedAreas, withinTranslationScope } from "@/lib/cleaning/textAuthorization";

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
