import { describe, it, expect } from "vitest";
import {
  auditAndCorrectDialogue,
  type CharacterPersona,
} from "@/lib/proofreading/personaGuard";

describe("PersonaGuard & Proofreading Linter", () => {
  it("auto-corrects common Thai typos without persona", () => {
    const result = auditAndCorrectDialogue("ขอบคุณนะค่ะ ขออนุญาติทดสอบ");
    expect(result.changed).toBe(true);
    expect(result.text).toBe("ขอบคุณนะคะ ขออนุญาตทดสอบ");
    expect(result.corrections.length).toBeGreaterThan(0);
    expect(result.corrections.some((c) => c.rule === "orthography")).toBe(true);
  });

  it("collapses repeated question marks (??+ -> ?)", () => {
    const result = auditAndCorrectDialogue("เกิดอะไรขึ้น???");
    expect(result.changed).toBe(true);
    expect(result.text).toBe("เกิดอะไรขึ้น?");
  });

  it("preserves already correct sentences with zero corrections", () => {
    const result = auditAndCorrectDialogue("สวัสดีตอนเช้า สบายดีไหม?");
    expect(result.changed).toBe(false);
    expect(result.text).toBe("สวัสดีตอนเช้า สบายดีไหม?");
    expect(result.corrections).toHaveLength(0);
  });

  describe("Character Persona Enforcement", () => {
    const aggressivePersona: CharacterPersona = {
      characterId: "char_01",
      primaryName: "บาคุโก",
      firstPersonPronouns: ["ฉัน", "กู"],
      secondPersonPronouns: ["แก", "มึง"],
      forbiddenPronouns: ["ข้า", "กระผม", "เรา"],
      forbiddenHonorifics: ["ครับ", "ค่ะ", "นะจ๊ะ", "ขอรับ"],
      toneRegister: "vulgar",
    };

    it("strips forbidden polite honorifics from dialogue endings", () => {
      const result = auditAndCorrectDialogue(
        "ไปตายซะครับ!",
        aggressivePersona,
      );
      expect(result.changed).toBe(true);
      expect(result.text).toBe("ไปตายซะ!");
      expect(
        result.corrections.some((c) => c.type === "honorific" && c.original === "ครับ"),
      ).toBe(true);
    });

    it("strips forbidden honorifics without trailing punctuation", () => {
      const result = auditAndCorrectDialogue(
        "ยอมแพ้ไปเถอะครับ",
        aggressivePersona,
      );
      expect(result.changed).toBe(true);
      expect(result.text).toBe("ยอมแพ้ไปเถอะ");
    });

    it("replaces forbidden pronouns with the character's primary pronoun", () => {
      const result = auditAndCorrectDialogue(
        "ข้าไม่ยอมรับแกหรอก!",
        aggressivePersona,
      );
      expect(result.changed).toBe(true);
      expect(result.text).toBe("ฉันไม่ยอมรับแกหรอก!");
      expect(
        result.corrections.some(
          (c) => c.type === "pronoun" && c.original === "ข้า" && c.corrected === "ฉัน",
        ),
      ).toBe(true);
    });

    it("handles multiple violations in a single dialogue bubble", () => {
      const result = auditAndCorrectDialogue(
        "ข้าไม่ยกโทษให้นะค่ะครับ!",
        aggressivePersona,
      );
      expect(result.changed).toBe(true);
      expect(result.text).toBe("ฉันไม่ยกโทษให้นะคะ!");
    });
  });
});
