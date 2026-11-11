import { describe, expect, it } from "vitest";
import {
  buildPronounMatrixDirectives,
  mergePronounRelations,
  stripForbiddenHonorifics,
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

  describe("forbiddenPronouns and forbiddenHonorifics directives", () => {
    it("includes forbidden pronouns and honorifics in prompt directives", () => {
      const matrix: PronounRelation[] = [
        {
          speaker: "เบจิต้า",
          listener: "โกคู",
          firstPerson: "ข้า",
          secondPerson: "แก",
          forbiddenPronouns: ["ผม", "คุณ"],
          forbiddenHonorifics: ["ครับ", "ค่ะ"],
          note: "หยิ่งผยอง ก้าวร้าว",
        },
      ];

      const directive = buildPronounMatrixDirectives(matrix);
      expect(directive).toContain('- When "เบจิต้า" speaks to "โกคู":');
      expect(directive).toContain('1st-person self: "ข้า"');
      expect(directive).toContain('2nd-person addressee: "แก"');
      expect(directive).toContain('FORBIDDEN pronouns: "ผม", "คุณ"');
      expect(directive).toContain('FORBIDDEN honorifics: "ครับ", "ค่ะ"');
      expect(directive).toContain('Tone/Nuance: หยิ่งผยอง ก้าวร้าว');
    });

    it("merges forbiddenPronouns and forbiddenHonorifics across updates", () => {
      const existing: PronounRelation[] = [
        {
          speaker: "a",
          listener: "b",
          firstPerson: "ฉัน",
          secondPerson: "นาย",
          forbiddenHonorifics: ["ครับ"],
        },
      ];
      const incoming: PronounRelation[] = [
        {
          speaker: "A",
          listener: "B",
          firstPerson: "ฉัน",
          secondPerson: "นาย",
          forbiddenHonorifics: ["ครับ", "ค่ะ"],
          forbiddenPronouns: ["กระผม"],
        },
      ];
      const { merged } = mergePronounRelations(existing, incoming);
      expect(merged[0].forbiddenHonorifics).toEqual(["ครับ", "ค่ะ"]);
      expect(merged[0].forbiddenPronouns).toEqual(["กระผม"]);
    });
  });

  describe("stripForbiddenHonorifics (Pre-Typesetting Layout Guard)", () => {
    it("strips trailing forbidden honorifics while preserving punctuation", () => {
      expect(stripForbiddenHonorifics("ข้าไม่ยอมแพ้หรอกครับ!", ["ครับ", "ค่ะ"])).toBe("ข้าไม่ยอมแพ้หรอก!");
      expect(stripForbiddenHonorifics("ไปตายซะเถอะค่ะ...", ["ครับ", "ค่ะ"])).toBe("ไปตายซะเถอะ...");
      expect(stripForbiddenHonorifics("เข้าใจแล้วครับ", ["ครับ"])).toBe("เข้าใจแล้ว");
      expect(stripForbiddenHonorifics("หยุดเดี๋ยวนี้นะคะ!!", ["คะ", "ค่ะ"])).toBe("หยุดเดี๋ยวนี้นะ!!");
    });

    it("handles stacked or repeated honorifics gracefully", () => {
      expect(stripForbiddenHonorifics("จริงเหรอครับผม?", ["ครับ", "ผม"])).toBe("จริงเหรอ?");
      expect(stripForbiddenHonorifics("ขอบคุณนะครับ", ["นะครับ", "ครับ"])).toBe("ขอบคุณ");
    });

    it("does not strip text if forbidden honorific list is empty or absent", () => {
      expect(stripForbiddenHonorifics("เข้าใจแล้วครับ", [])).toBe("เข้าใจแล้วครับ");
      expect(stripForbiddenHonorifics("เข้าใจแล้วครับ", undefined as any)).toBe("เข้าใจแล้วครับ");
    });

    it("does not strip substrings inside real words", () => {
      expect(stripForbiddenHonorifics("ห้องนี้คับแคบ", ["ครับ"])).toBe("ห้องนี้คับแคบ");
      expect(stripForbiddenHonorifics("กินคะน้าหมูกรอบ", ["คะ"])).toBe("กินคะน้าหมูกรอบ");
    });
  });
});
