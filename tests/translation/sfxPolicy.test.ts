import { describe, expect, it } from "vitest";
import { isSfxBubble, applyLiveSfxPolicy, type SfxMode } from "@/lib/translation/sfxPolicy";
import type { TranslatedBubble } from "@/lib/translationOverlay";

describe("sfxPolicy - isSfxBubble", () => {
  it("detects explicit boolean isSfx flags", () => {
    expect(isSfxBubble({ t: "เสียงดัง", isSfx: true })).toBe(true);
    expect(isSfxBubble({ t: "เสียงดัง", is_sfx: true } as TranslatedBubble)).toBe(true);
    expect(isSfxBubble({ t: "เสียงดัง", sfx: true } as TranslatedBubble)).toBe(true);
  });

  it("detects category and styleProfile metadata indicating SFX", () => {
    expect(isSfxBubble({ t: "ตึง", styleCategory: "sfx" } as TranslatedBubble)).toBe(true);
    expect(isSfxBubble({ t: "เปรี้ยง", category: "sound_effect" } as TranslatedBubble)).toBe(true);
    expect(
      isSfxBubble({
        t: "ฟิ้ว",
        styleProfile: { source: "auto", category: "sfx", fill: "#000", outline: "#fff", hasOutline: true },
      }),
    ).toBe(true);
  });

  it("detects asterisk-wrapped text syntax", () => {
    expect(isSfxBubble({ t: "*ตู้ม*" })).toBe(true);
    expect(isSfxBubble({ t: "*BOOM*", translated: "*BOOM*" })).toBe(true);
    expect(isSfxBubble({ t: "*โครม*" })).toBe(true);
  });

  it("does not classify normal conversational dialogue as SFX", () => {
    expect(isSfxBubble({ t: "สวัสดีครับ วันนี้อากาศดีจังเลยนะ" })).toBe(false);
    expect(isSfxBubble({ t: "เธอจะไปไหนเหรอ?" })).toBe(false);
    expect(isSfxBubble({ t: "เรื่องนั้นฉันไม่รู้หรอกนะ" })).toBe(false);
  });
});

describe("sfxPolicy - applyLiveSfxPolicy", () => {
  const createSampleBubbles = (): TranslatedBubble[] => [
    {
      id: "bubble-1",
      t: "สวัสดีครับ คุณสบายดีไหม?",
      translated: "สวัสดีครับ คุณสบายดีไหม?",
      original_text: "こんにちは、お元気ですか？",
      box: [100, 100, 200, 300],
    },
    {
      id: "bubble-2",
      t: "*ตู้ม*",
      translated: "*ตู้ม*",
      original_text: "ドカーン",
      isSfx: true,
      box: [300, 300, 450, 450],
    },
    {
      id: "bubble-3",
      t: "*ฟิ้ว*",
      translated: "*ฟิ้ว*",
      original_text: "シュッ",
      styleCategory: "sfx",
      box: [500, 500, 600, 600],
    },
  ];

  it("immediately hides SFX bubbles in ignore mode without destroying data", () => {
    const bubbles = createSampleBubbles();
    const result = applyLiveSfxPolicy(bubbles, "ignore");

    // Dialogue bubble remains visible and intact
    expect(result[0].hidden).toBeFalsy();
    expect(result[0].t).toBe("สวัสดีครับ คุณสบายดีไหม?");

    // SFX bubbles are hidden
    expect(result[1].hidden).toBe(true);
    expect(result[1].sfxTranslated).toBe("*ตู้ม*");
    expect(result[1].sfxOriginal).toBe("ドカーン");

    expect(result[2].hidden).toBe(true);
    expect(result[2].sfxTranslated).toBe("*ฟิ้ว*");
    expect(result[2].sfxOriginal).toBe("シュッ");
  });

  it("restores original source text in preserve mode", () => {
    const bubbles = createSampleBubbles();
    // Switch to ignore first
    applyLiveSfxPolicy(bubbles, "ignore");
    // Then switch to preserve
    const result = applyLiveSfxPolicy(bubbles, "preserve");

    expect(result[0].hidden).toBeFalsy();
    expect(result[0].t).toBe("สวัสดีครับ คุณสบายดีไหม?");

    expect(result[1].hidden).toBe(false);
    expect(result[1].t).toBe("ドカーン");
    expect(result[1].translated).toBe("ドカーン");
    expect(result[1].sfxTranslated).toBe("*ตู้ม*");

    expect(result[2].hidden).toBe(false);
    expect(result[2].t).toBe("シュッ");
    expect(result[2].translated).toBe("シュッ");
    expect(result[2].sfxTranslated).toBe("*ฟิ้ว*");
  });

  it("restores translated text in translate mode after being preserved or ignored", () => {
    const bubbles = createSampleBubbles();
    applyLiveSfxPolicy(bubbles, "ignore");
    applyLiveSfxPolicy(bubbles, "preserve");
    const result = applyLiveSfxPolicy(bubbles, "translate");

    expect(result[0].hidden).toBeFalsy();
    expect(result[0].t).toBe("สวัสดีครับ คุณสบายดีไหม?");

    expect(result[1].hidden).toBe(false);
    expect(result[1].t).toBe("*ตู้ม*");
    expect(result[1].translated).toBe("*ตู้ม*");

    expect(result[2].hidden).toBe(false);
    expect(result[2].t).toBe("*ฟิ้ว*");
    expect(result[2].translated).toBe("*ฟิ้ว*");
  });

  it("handles repeated multi-cycle toggles seamlessly without drift", () => {
    const bubbles = createSampleBubbles();
    const modes: SfxMode[] = ["ignore", "preserve", "translate", "ignore", "translate", "preserve"];

    for (const mode of modes) {
      applyLiveSfxPolicy(bubbles, mode);
      if (mode === "ignore") {
        expect(bubbles[1].hidden).toBe(true);
        expect(bubbles[2].hidden).toBe(true);
      } else if (mode === "preserve") {
        expect(bubbles[1].hidden).toBe(false);
        expect(bubbles[1].t).toBe("ドカーン");
        expect(bubbles[2].hidden).toBe(false);
        expect(bubbles[2].t).toBe("シュッ");
      } else if (mode === "translate") {
        expect(bubbles[1].hidden).toBe(false);
        expect(bubbles[1].t).toBe("*ตู้ม*");
        expect(bubbles[2].hidden).toBe(false);
        expect(bubbles[2].t).toBe("*ฟิ้ว*");
      }
    }
  });
});
