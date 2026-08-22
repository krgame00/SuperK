import { describe, it, expect } from "vitest";
import {
  normalizeThaiText,
  cleanThaiVowelStacking,
  cleanPunctuationAndSpacing,
  normalizeTranslationPayload,
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