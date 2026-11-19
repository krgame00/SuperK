import { describe, expect, it } from "vitest";
import { normalizeSfxPolicy, sfxPolicyToCleaningMode } from "@/lib/cleaning/sfxPolicy";
import { computeModuloAlignedCrop } from "@/lib/inpaint/DirtyRectInpainter";
import {
  applyTranscriptUpdatesToBubbles,
  formatTranscriptText,
  parseTranscriptText,
} from "@/components/editing/TranscriptModal";
import type { TranslatedBubble } from "@/lib/translationOverlay";

describe("pstack root-cause regression suite", () => {
  it("P1: aligns default null sfx-policy with safe cleaning mode so SFX artwork is never silently erased", () => {
    const policy = normalizeSfxPolicy(null);
    expect(policy).toBe("ignore");
    expect(sfxPolicyToCleaningMode(policy)).toBe("safe");
  });

  it("P3: preserves exact bubble target when an intermediate bubble is deleted before transcript edit", () => {
    const pagesData = [
      {
        pageIndex: 0,
        pageName: "01.png",
        pageUrl: "blob:p1",
        bubbles: [
          { t: "สวัสดี", translated: "สวัสดี", original_text: "안녕" } as TranslatedBubble,
          { t: "ถูกลบ", translated: "ถูกลบ", deleted: true } as TranslatedBubble,
          { t: "ประโยคสาม", translated: "ประโยคสาม", original_text: "셋" } as TranslatedBubble,
        ],
      },
    ];

    const script = formatTranscriptText(pagesData, "current", 0);
    expect(script).toContain("#1 [TRAN]: สวัสดี");
    expect(script).toContain("#3 [TRAN]: ประโยคสาม");

    const editedScript = script.replace("#3 [TRAN]: ประโยคสาม", "#3 [TRAN]: แก้ไขกล่องสามสำเร็จ");
    const parsed = parseTranscriptText(editedScript, pagesData, "current", 0);
    const idxMap = parsed.get("blob:p1")!;
    const { nextBubbles, changed } = applyTranscriptUpdatesToBubbles(pagesData[0].bubbles, idxMap);

    expect(changed).toBe(true);
    expect(nextBubbles[0].t).toBe("สวัสดี");
    expect(nextBubbles[1].deleted).toBe(true);
    expect(nextBubbles[2].t).toBe("แก้ไขกล่องสามสำเร็จ");
  });

  it("P4: enforces strict Modulo-8 dimensions even when brush touches the right/bottom page boundary", () => {
    // Canvas 1000x1500: brushing at x=940..995 used to clamp width to 1000 - 908 = 92 (92 % 8 === 4 -> crash!)
    const box = computeModuloAlignedCrop(
      { x: 940, y: 1450, width: 55, height: 45 },
      1000,
      1500,
      32,
      8,
    );
    expect(box.width % 8).toBe(0);
    expect(box.height % 8).toBe(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1000);
    expect(box.y + box.height).toBeLessThanOrEqual(1500);
  });
});
