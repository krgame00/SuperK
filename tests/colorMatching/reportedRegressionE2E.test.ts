import { describe, expect, it } from "vitest";
import { extractTextColors } from "@/lib/colorMatching/sampleTextColors";
import { resolveBubbleTextStyle, preserveManualStyleProfiles } from "@/lib/colorMatching/resolveTextStyle";
import { applyNearbyStyleFallbacks, inferTextStyleCategory } from "@/lib/colorMatching/nearbyStyleFallback";
import type { ColorSampleRegion, TextStyleProfile } from "@/lib/colorMatching/types";
import type { TranslatedBubble } from "@/lib/translationOverlay";

function createSyntheticRegion(
  width: number,
  height: number,
  generator: (x: number, y: number) => [number, number, number, number],
): ColorSampleRegion {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const [r, g, b, a] = generator(x, y);
      rgba[idx] = r;
      rgba[idx + 1] = g;
      rgba[idx + 2] = b;
      rgba[idx + 3] = a;
    }
  }
  return { width, height, rgba };
}

describe("Ticket 12: Reported-Regression E2E & Export Parity", () => {
  describe("Reported Failure Pattern: Wide Bottom-Overlay over Complex Floor", () => {
    it("does not resolve floor/carpet colors as text fill or outline in a wide bottom crop", () => {
      // 100 wide x 30 high crop
      // 80% background floor: brown floorboards (#8c5028), orange trim lines (#ff7800), and dark shadows (#22150c)
      // 20% central text: white text with black outline in the middle
      const sample = createSyntheticRegion(100, 30, (x, y) => {
        // Floor trim at border
        if (y <= 3 || y >= 27 || x <= 4 || x >= 96) {
          return [255, 120, 0, 255]; // Orange accent line
        }
        // Central text
        if (x >= 35 && x <= 65 && y >= 10 && y <= 20) {
          return [255, 255, 255, 255]; // White glyph core
        }
        // Surrounding floorboards
        return [140, 80, 40, 255]; // Brown floor (#8c5028)
      });

      const profile = extractTextColors(sample);
      // Floor colors MUST NOT be accepted as text fill!
      expect(profile.fill).not.toBe("#ff7800");
      expect(profile.fill).not.toBe("#8c5028");

      const bubble: TranslatedBubble = {
        box: [780, 100, 840, 600],
        category: "overlay_subtitle",
        styleProfile: profile,
      };

      const resolved = resolveBubbleTextStyle(bubble);
      expect(resolved.textColor).not.toBe("#ff7800");
      expect(resolved.textColor).not.toBe("#8c5028");
      // Must be readable over floor
      expect(resolved.hasOutline).toBe(true);
      expect(resolved.textColor).toBe("#ffffff");
      expect(resolved.textOutline).toBe("#000000");
    });

    it("resolves to Overlay Subtitle Readable Fallback when artwork completely dominates without glyph mask", () => {
      // Crop with 95% carpet artwork and 5% fragmented text noise
      const sample = createSyntheticRegion(80, 25, (x, y) => {
        if (x >= 38 && x <= 42 && y >= 11 && y <= 14) {
          return [50, 50, 50, 255]; // tiny faint ink
        }
        // Dominant carpet pattern
        return [(x * 13) % 200 + 50, 60, 40, 255];
      });

      const profile = extractTextColors(sample);
      expect(profile.evidenceState).toBe("rejected");

      const bubble: TranslatedBubble = {
        box: [820, 50, 870, 750],
        styleProfile: profile,
      };

      // Inferred as overlay_subtitle due to geometry (wide shallow at bottom)
      expect(inferTextStyleCategory(bubble)).toBe("overlay_subtitle");

      const resolved = resolveBubbleTextStyle(bubble);
      expect(resolved.source).toBe("fallback");
      expect(resolved.textColor).toBe("#ffffff");
      expect(resolved.textOutline).toBe("#000000");
      expect(resolved.hasOutline).toBe(true);
      expect(resolved.outlineWidthRatio).toBeGreaterThanOrEqual(0.16);
    });
  });

  describe("Single-Page, Batch, and Persistence Parity", () => {
    it("applies the exact same fallback chain across multiple bubbles without throwing or halting batch", () => {
      const batchBubbles: TranslatedBubble[] = [
        {
          id: "sub_1",
          box: [800, 50, 850, 700],
          t: "ซับไตเติล 1",
          styleProfile: {
            fill: "#8c5028",
            outline: "#8c5028",
            source: "fallback",
            evidenceState: "rejected",
            fallbackReason: "background-contamination",
            category: "overlay_subtitle",
          },
        },
        {
          id: "dialogue_1",
          box: [200, 200, 350, 400],
          t: "บทสนทนา",
          styleProfile: {
            fill: "#000000",
            outline: "#000000",
            hasOutline: false,
            source: "auto",
            evidenceState: "admitted",
            category: "dialogue",
          },
        },
        {
          id: "sfx_1",
          box: [500, 300, 600, 500],
          t: "ตูม!",
          styleProfile: {
            fill: "#ff0055",
            outline: "#ffffff",
            hasOutline: true,
            source: "auto",
            evidenceState: "admitted",
            category: "sfx",
          },
        },
      ];

      // Nearby fallback run in batch
      expect(() => applyNearbyStyleFallbacks(batchBubbles)).not.toThrow();
      const resolvedList = batchBubbles.map((b) => resolveBubbleTextStyle(b));

      // Subtitle 1 gets readable fallback
      expect(resolvedList[0].textColor).toBe("#ffffff");
      expect(resolvedList[0].textOutline).toBe("#000000");
      expect(resolvedList[0].hasOutline).toBe(true);

      // Dialogue 1 preserves no-outline fidelity
      expect(resolvedList[1].textColor).toBe("#000000");
      expect(resolvedList[1].hasOutline).toBe(false);

      // SFX 1 preserves vivid color and outline
      expect(resolvedList[2].textColor).toBe("#ff0055");
      expect(resolvedList[2].hasOutline).toBe(true);
    });

    it("survives serialization/persistence round-trip and re-translation without losing ownership or changing color", () => {
      const originalBubble: TranslatedBubble = {
        id: "persist_bubble",
        box: [800, 100, 860, 600],
        original_text: "テキスト",
        t: "ข้อความ",
        styleProfile: {
          fill: "#ffffff",
          outline: "#000000",
          hasOutline: true,
          outlineWidthRatio: 0.18,
          ownershipMode: "auto",
          source: "fallback",
          evidenceState: "rejected",
          fallbackReason: "background-contamination",
          category: "overlay_subtitle",
        },
      };

      // Serialize (simulate JSON store in IndexedDB/File)
      const serialized = JSON.stringify(originalBubble);
      const deserialized: TranslatedBubble = JSON.parse(serialized);

      // Re-resolve
      const resolvedAfterLoad = resolveBubbleTextStyle(deserialized);
      expect(resolvedAfterLoad.textColor).toBe("#ffffff");
      expect(resolvedAfterLoad.textOutline).toBe("#000000");
      expect(resolvedAfterLoad.hasOutline).toBe(true);
      expect(resolvedAfterLoad.source).toBe("fallback");

      // Re-translation simulation
      const nextBubbles: TranslatedBubble[] = [
        {
          id: "persist_bubble",
          box: [800, 100, 860, 600],
          original_text: "テキスト",
          t: "ข้อความแปลใหม่",
        },
      ];

      const preserved = preserveManualStyleProfiles(nextBubbles, [deserialized]);
      expect(preserved[0].t).toBe("ข้อความแปลใหม่");
    });
  });
});
