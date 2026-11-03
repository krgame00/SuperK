import { describe, expect, it } from "vitest";
import {
  sanitizeMangaTranslation,
  sanitizeTranslationPayloadJson,
} from "@/lib/translation/sanitizer";

describe("sanitizeMangaTranslation", () => {
  it("strips CJK echo from Thai translation", () => {
    const result = sanitizeMangaTranslation("สวัสดี (你好)");
    expect(result.hasStrippedSourceEcho).toBe(true);
    expect(result.cleanedText).toBe("สวัสดี ()");
  });

  it("handles prompt echo arrow prefix with CJK", () => {
    const result = sanitizeMangaTranslation("你好 -> สวัสดี (你好)");
    expect(result.hasStrippedSourceEcho).toBe(true);
    expect(result.cleanedText).toBe("สวัสดี ()");
  });

  it("leaves clean text untouched", () => {
    const result = sanitizeMangaTranslation("ข้อความภาษาไทยล้วน ไม่มีภาษาอื่นปน");
    expect(result.hasStrippedSourceEcho).toBe(false);
    expect(result.cleanedText).toBe("ข้อความภาษาไทยล้วน ไม่มีภาษาอื่นปน");
  });

  it("preserves CJK when target language is Japanese", () => {
    const result = sanitizeMangaTranslation("こんにちは世界", "ja");
    expect(result.hasStrippedSourceEcho).toBe(false);
    expect(result.cleanedText).toBe("こんにちは世界");
  });

  it("preserves CJK when target language is Chinese", () => {
    const result = sanitizeMangaTranslation("你好世界", "zh");
    expect(result.hasStrippedSourceEcho).toBe(false);
    expect(result.cleanedText).toBe("你好世界");
  });

  it("sanitizes JSON payload containing translation bubbles", () => {
    const input = JSON.stringify({
      bubbles: [
        { id: 1, t: "さようなら ลาก่อน" },
        { id: 2, t: "ยินดีที่ได้รู้จัก" },
      ],
    });
    const output = sanitizeTranslationPayloadJson(input, "th");
    const parsed = JSON.parse(output);
    expect(parsed.bubbles[0].t).toBe("ลาก่อน");
    expect(parsed.bubbles[1].t).toBe("ยินดีที่ได้รู้จัก");
  });
});
