import { describe, expect, it } from "vitest";
import { withinTranslationScope } from "@/lib/cleaning/textAuthorization";

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
