import { describe, expect, it } from "vitest";
import {
  buildPronounMatrixDirectives,
  mergePronounRelations,
  COMMON_PRONOUN_PRESETS,
  type PronounRelation,
} from "@/lib/translation/pronounMatrix";

describe("pronounMatrix domain & prompt generation", () => {
  it("returns empty string when matrix is null, undefined, or empty", () => {
    expect(buildPronounMatrixDirectives(null)).toBe("");
    expect(buildPronounMatrixDirectives(undefined)).toBe("");
    expect(buildPronounMatrixDirectives([])).toBe("");
  });

  it("filters out invalid or incomplete entries", () => {
    const incomplete: any[] = [
      null,
      {},
      { speaker: "Naruto" }, // missing listener and pronouns
      { speaker: "Naruto", listener: "Sasuke" }, // missing both pronouns
      { speaker: "", listener: "Sasuke", firstPerson: "ฉัน" }, // missing speaker
    ];
    expect(buildPronounMatrixDirectives(incomplete)).toBe("");
  });

  it("generates deterministic mandatory prompt instructions for valid relationships", () => {
    const matrix: PronounRelation[] = [
      {
        speaker: "นารูโตะ",
        listener: "ซาสึเกะ",
        firstPerson: "ฉัน",
        secondPerson: "นาย",
        note: "เพื่อนสนิทกึ่งคู่แข่ง",
      },
      {
        speaker: "ซาสึเกะ",
        listener: "นารูโตะ",
        firstPerson: "ฉัน",
        secondPerson: "นาย",
        note: "เยือกเย็นแต่ใส่ใจ",
      },
    ];

    const directive = buildPronounMatrixDirectives(matrix);
    expect(directive).toContain("CHARACTER PRONOUN & RELATIONSHIP MATRIX (MANDATORY CONSISTENCY):");
    expect(directive).toContain('- When "นารูโตะ" speaks to "ซาสึเกะ": MUST use 1st-person self: "ฉัน", 2nd-person addressee: "นาย", Tone/Nuance: เพื่อนสนิทกึ่งคู่แข่ง');
    expect(directive).toContain('- When "ซาสึเกะ" speaks to "นารูโตะ": MUST use 1st-person self: "ฉัน", 2nd-person addressee: "นาย", Tone/Nuance: เยือกเย็นแต่ใส่ใจ');
  });

  it("handles relations with only 1st-person or only 2nd-person pronoun", () => {
    const matrix: PronounRelation[] = [
      {
        speaker: "ลูกศิษย์",
        listener: "อาจารย์",
        firstPerson: "ผม",
        secondPerson: "",
        note: "เคารพ",
      },
      {
        speaker: "อาจารย์",
        listener: "ลูกศิษย์",
        firstPerson: "",
        secondPerson: "เธอ",
      },
    ];

    const directive = buildPronounMatrixDirectives(matrix);
    expect(directive).toContain('- When "ลูกศิษย์" speaks to "อาจารย์": MUST use 1st-person self: "ผม", Tone/Nuance: เคารพ');
    expect(directive).toContain('- When "อาจารย์" speaks to "ลูกศิษย์": MUST use 2nd-person addressee: "เธอ"');
  });

  it("merges incoming relations deduplicating by speaker and listener", () => {
    const existing: PronounRelation[] = [
      { speaker: "A", listener: "B", firstPerson: "ฉัน", secondPerson: "เธอ" },
    ];
    const incoming: PronounRelation[] = [
      { speaker: "a", listener: "b", firstPerson: "ข้า", secondPerson: "เจ้า", note: "อัปเดตใหม่" }, // same speaker/listener
      { speaker: "B", listener: "A", firstPerson: "ฉัน", secondPerson: "นาย" }, // new
    ];

    const { merged, addedCount, updatedCount } = mergePronounRelations(existing, incoming);
    expect(addedCount).toBe(1);
    expect(updatedCount).toBe(1);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual({
      speaker: "a",
      listener: "b",
      firstPerson: "ข้า",
      secondPerson: "เจ้า",
      note: "อัปเดตใหม่",
    });
    expect(merged[1]).toEqual({
      speaker: "B",
      listener: "A",
      firstPerson: "ฉัน",
      secondPerson: "นาย",
    });
  });

  it("provides ready-to-use common presets", () => {
    expect(COMMON_PRONOUN_PRESETS.length).toBeGreaterThanOrEqual(5);
    const friendPreset = COMMON_PRONOUN_PRESETS.find((p) => p.label.includes("ฉัน / นาย"));
    expect(friendPreset).toBeDefined();
    expect(friendPreset?.firstPerson).toBe("ฉัน");
    expect(friendPreset?.secondPerson).toBe("นาย");
  });
});
