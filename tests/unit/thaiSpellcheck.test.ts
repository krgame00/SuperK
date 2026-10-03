import { describe, it, expect } from "vitest";
import {
  normalizeThaiText,
  cleanThaiVowelStacking,
  cleanPunctuationAndSpacing,
  normalizeTranslationPayload,
  countForeignScriptChars,
  describeForeignScripts,
  countContaminatedBubbles,
} from "@/lib/thaiSpellcheck";

describe("Thai Spellcheck & Normalizer", () => {
  it("strips dialogue speaker prefix hallucinations (e.g. Cหึๆ -> หึๆ)", () => {
    expect(normalizeThaiText("Cหึๆ...ไม่ลืมหรอกนะ♥")).toBe("หึๆ...ไม่ลืมหรอกนะ♥");
    expect(normalizeThaiText("C: รางวัลช่วยงาน")).toBe("รางวัลช่วยงาน");
    expect(normalizeThaiText("Cทั้งที่ข้าอุตส่าห์")).toBe("ทั้งที่ข้าอุตส่าห์");
  });

  it("corrects classic ending particle typos (นะค่ะ -> นะคะ)", () => {
    expect(normalizeThaiText("ขอบคุณนะค่ะ")).toBe("ขอบคุณนะคะ");
    expect(normalizeThaiText("ไปไหนกันนะค้ะ")).toBe("ไปไหนกันนะคะ");
    expect(normalizeThaiText("ใช่คระ")).toBe("ใช่ค่ะ");
  });

  it("corrects common AI misspelled words", () => {
    expect(normalizeThaiText("บ้านอยู่ไกล้")).toBe("บ้านอยู่ใกล้");
    expect(normalizeThaiText("สังเกตุ")).toBe("สังเกต");
    expect(normalizeThaiText("ขออนุญาติ")).toBe("ขออนุญาต");
    expect(normalizeThaiText("กินข้าวกะเพรา หรือ กระเพรา")).toBe("กินข้าวกะเพรา หรือ กะเพรา");
    expect(normalizeThaiText("เวทย์มนต์แห่งความผูกพันธ์")).toBe("เวทมนตร์แห่งความผูกพัน");
    expect(normalizeThaiText("ปวดศรีษะมาก")).toBe("ปวดศีรษะมาก");
  });

  it("cleans redundant vowel & tone mark stacking", () => {
    expect(cleanThaiVowelStacking("กิิิน")).toBe("กิน");
    expect(cleanThaiVowelStacking("กุุก")).toBe("กุก");
    expect(cleanThaiVowelStacking("ไมไ่่")).toBe("ไมไ่");
  });

  it("cleans manga punctuation, spaces, and maiyamok", () => {
    expect(cleanPunctuationAndSpacing("อะไร นะ ? ! !")).toBe("อะไร นะ?!!");
    expect(cleanPunctuationAndSpacing("รอเดี๋ยว.....")).toBe("รอเดี๋ยว...");
    expect(cleanPunctuationAndSpacing("เร็วๆเข้าสิ")).toBe("เร็วๆ เข้าสิ");
    expect(cleanPunctuationAndSpacing("บรรทัดหนึ่ง\nบรรทัดสอง")).toBe("บรรทัดหนึ่ง บรรทัดสอง");
  });

  it("normalizes a full translation payload object", () => {
    const payload = {
      bubbles: [
        { id: 1, t: "Cขอบคุณนะค่ะ ที่ช่วยสังเกตุ" },
        { id: 2, t: "ไม่เป็นไรคระ ไกล้ถึงแล้ว" },
      ],
    };
    const normalized = normalizeTranslationPayload(payload);
    expect(normalized.bubbles[0].t).toBe("ขอบคุณนะคะ ที่ช่วยสังเกต");
    expect(normalized.bubbles[1].t).toBe("ไม่เป็นไรค่ะ ใกล้ถึงแล้ว");
  });
});

describe("Foreign-script contamination guard", () => {
  it.each([
    ["กลิ่นนี่มันมีมนמהขลังอะไรกันแน่...", 2],
    ["สวัสดีمرحبا", 5], ["สวัสดีΩ", 1], ["สวัสดีမ", 1],
    ["สวัสดี𠀀", 1], ["สวัสดีｶﾅ", 2], ["สวัสดีאְ", 2],
    ["ไทย\u064e\u0652", 2],
  ])("detects extended Unicode foreign lettering: %s", (text, count) => {
    expect(countForeignScriptChars(text)).toBe(count);
    expect(describeForeignScripts(text).length).toBeGreaterThan(0);
  });
  it("allows Thai accents, Latin accents and common symbols", () => {
    expect(countForeignScriptChars("ที่นี่ café cafe\u0301 A\u0308 Zoro!? ๑๒๓ 123 ❤️ © ☆…")).toBe(0);
  });
  it("does not reject Unicode numbers or script-specific punctuation", () => {
    expect(countForeignScriptChars("๑๒๓ ١٢٣ 〇 Ⅷ ・゠ ׀־ ، ©" )).toBe(0);
  });
  it("counts Japanese kana/kanji, Cyrillic, and Hangul as foreign", () => {
    expect(countForeignScriptChars("สวัสดีこんにちは")).toBe(5);
    expect(countForeignScriptChars("俺はゴムだ")).toBe(5);
    expect(countForeignScriptChars("Привет")).toBe(6);
    expect(countForeignScriptChars("안녕")).toBe(2);
  });

  it("allows Thai, Latin, digits, and punctuation", () => {
    expect(countForeignScriptChars("สวัสดีครับ! Zoro ล่ะ? ... 123")).toBe(0);
    expect(countForeignScriptChars("")).toBe(0);
  });

  it("describes which scripts leaked, statelessly", () => {
    const text = "สวัสดีこんにちは俺Привет";
    expect(describeForeignScripts(text)).toEqual(["Japanese kana", "CJK kanji", "Cyrillic"]);
    expect(describeForeignScripts(text)).toEqual(describeForeignScripts(text));
    expect(describeForeignScripts("สวัสดี")).toEqual([]);
  });

  it("counts only bubbles whose translation carries foreign script", () => {
    expect(
      countContaminatedBubbles([
        { t: "สวัสดี" },
        { t: "こんにちは" },
        { t: "Привет" },
        { t: 123 },
        {},
      ]),
    ).toBe(2);
  });
  it("scans legacy translated fields and skips deleted text", () => {
    expect(countContaminatedBubbles([{translated:"מה"},{t:"מה",deleted:true}])).toBe(1);
  });
});

describe("B7 Thai word-boundary spellcheck", () => {
  it("does not corrupt real words that merely contain the typo substring", () => {
    expect(normalizeThaiText("อักขระ")).toBe("อักขระ");
    expect(normalizeThaiText("คระหนัก")).toBe("คระหนัก");
    expect(normalizeThaiText("คร่าวๆ")).toBe("คร่าวๆ");
  });

  it("still fixes genuine typos at word boundaries", () => {
    expect(normalizeThaiText("ใช่คระ")).toBe("ใช่ค่ะ");
    expect(normalizeThaiText("บ้านอยู่ไกล้")).toBe("บ้านอยู่ใกล้");
    expect(normalizeThaiText("ขอบคุณนะค่ะ")).toBe("ขอบคุณนะคะ");
  });
});
