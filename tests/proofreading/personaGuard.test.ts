import { describe, it, expect } from "vitest";
import {
  auditAndCorrectDialogue,
  auditBubbleWithPersona,
  personaFromPronounMatrix,
  type CharacterPersona,
} from "@/lib/proofreading/personaGuard";
import type { PronounRelation } from "@/lib/translation/pronounMatrix";
import type { TranslatedBubble } from "@/lib/translationOverlay";

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

    it("strips stacked honorifics with loop passes", () => {
      const stackedPersona: CharacterPersona = {
        characterId: "c1",
        primaryName: "นักเลง",
        firstPersonPronouns: ["ฉัน"],
        secondPersonPronouns: ["แก"],
        forbiddenHonorifics: ["ครับ", "ผม", "นะ"],
        toneRegister: "vulgar",
      };
      const result = auditAndCorrectDialogue("หยุดเดี๋ยวนี้ครับผมนะ!", stackedPersona);
      expect(result.changed).toBe(true);
      expect(result.text).toBe("หยุดเดี๋ยวนี้!");
    });
  });

  describe("Pronoun Matrix & TranslatedBubble Integration", () => {
    const testMatrix: PronounRelation[] = [
      {
        speaker: "พระเอก",
        listener: "นางเอก",
        firstPerson: "ผม",
        secondPerson: "เธอ",
        forbiddenPronouns: ["ข้า", "กู"],
        forbiddenHonorifics: ["วะ", "เว้ย"],
      },
      {
        speaker: "ตัวร้าย",
        listener: "ทุกคน",
        firstPerson: "ข้า",
        secondPerson: "พวกเจ้า",
        forbiddenHonorifics: ["ครับ", "ค่ะ"],
      },
    ];

    it("resolves persona from pronoun matrix by speaker", () => {
      const persona = personaFromPronounMatrix("พระเอก", testMatrix);
      expect(persona).toBeDefined();
      expect(persona?.primaryName).toBe("พระเอก");
      expect(persona?.firstPersonPronouns).toContain("ผม");
      expect(persona?.forbiddenPronouns).toContain("ข้า");
      expect(persona?.forbiddenHonorifics).toContain("วะ");
    });

    it("audits TranslatedBubble with speaker", () => {
      const bubble: TranslatedBubble = {
        t: "ไปกันเถอะวะ!",
        speaker: "พระเอก",
        box: [100, 100, 200, 200],
      };
      const result = auditBubbleWithPersona(bubble, testMatrix);
      expect(result.changed).toBe(true);
      expect(result.bubble.t).toBe("ไปกันเถอะ!");
      expect(result.bubble.speaker).toBe("พระเอก");
    });

    it("leaves bubble unchanged if no violations or no matching speaker", () => {
      const bubble: TranslatedBubble = {
        t: "สวัสดีตอนเช้าครับ",
        speaker: "คนผ่านทาง",
        box: [100, 100, 200, 200],
      };
      const result = auditBubbleWithPersona(bubble, testMatrix);
      expect(result.changed).toBe(false);
      expect(result.bubble.t).toBe("สวัสดีตอนเช้าครับ");
    });
  });
});
