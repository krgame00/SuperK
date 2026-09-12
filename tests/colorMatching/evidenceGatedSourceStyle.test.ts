import { describe, expect, it } from "vitest";
import { extractTextColors } from "@/lib/colorMatching/sampleTextColors";
import { resolveBubbleTextStyle } from "@/lib/colorMatching/resolveTextStyle";
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

describe("Ticket 08: Evidence-Gated Source Style on Complex Backgrounds (Seam 1)", () => {
  it("rejects surrounding floor/artwork from becoming text fill in a wide region over complex background", () => {
    // Wide text region (100x24) representing the reported failure shape:
    // A bottom/overlay subtitle text region over a multicolor floor with wooden/orange trim lines.
    // Background: Floor with brown wood planks (140, 80, 40) and dark grooves (40, 30, 25) at the edges.
    // Orange decorative floor trim (220, 110, 20) runs along the bottom and sides.
    // Text: White subtitle characters (255, 255, 255) localized in the center (x: 25..75, y: 7..17).
    const sample = createSyntheticRegion(100, 24, (x, y) => {
      // White subtitle text in the middle
      if (x >= 25 && x <= 75 && y >= 7 && y <= 17) {
        // Form discrete letter strokes
        const isLetterStroke = (x % 7 < 4) && (y >= 8 && y <= 16);
        if (isLetterStroke) return [255, 255, 255, 255];
      }
      // Orange trim along the bottom border
      if (y >= 20) return [220, 110, 20, 255];
      // Dark grooves in floor
      if (x % 20 === 0) return [40, 30, 25, 255];
      // Brown wood floor
      return [140, 80, 40, 255];
    });

    const profile = extractTextColors(sample);

    // The floor/trim colors (brown #8c5028 or orange #dc6e14) MUST NOT be accepted as text fill!
    expect(profile.fill).not.toBe("#8c5028");
    expect(profile.fill).not.toBe("#dc6e14");
    // Should recover the white text, or if rejected due to contamination, should be explicitly marked as fallback
    if (profile.fill !== "#ffffff") {
      expect(profile.evidenceState).toBe("rejected");
      expect(profile.fallbackReason).toBe("background-contamination");
      expect(profile.source).toBe("fallback");
    } else {
      expect(profile.fill).toBe("#ffffff");
    }
  });

  it("does not accept background/artwork color solely because that color dominates the crop", () => {
    // 60x30 crop where purple carpet/artwork (120, 30, 160) covers 75% of the region and touches all borders.
    // Thin dark text (15, 15, 15) is placed in the center (x: 20..40, y: 10..20).
    const sample = createSyntheticRegion(60, 30, (x, y) => {
      if (x >= 22 && x <= 38 && y >= 11 && y <= 19) {
        if ((x % 4 < 2) && (y % 4 < 3)) return [15, 15, 15, 255]; // Text glyph
      }
      // Purple artwork/carpet covering the rest and touching borders
      return [120, 30, 160, 255];
    });

    const profile = extractTextColors(sample);

    // Purple carpet (#781ea0) MUST NOT become the text fill!
    expect(profile.fill).not.toBe("#781ea0");
  });

  it("treats pixels connected to outer region boundaries as background rather than trusted glyph evidence", () => {
    // 40x40 region: Cyan character hair/artwork (0, 200, 255) enters from the top and left borders
    // and covers a large area.
    // Center text is black dialogue (0, 0, 0) on a light speech background (245, 245, 245).
    const sample = createSyntheticRegion(40, 40, (x, y) => {
      // Cyan artwork entering from border
      if (x < 12 || y < 10) return [0, 200, 255, 255];
      // Text in center
      if (x >= 20 && x <= 28 && y >= 20 && y <= 28) return [0, 0, 0, 255];
      return [245, 245, 245, 255];
    });

    const profile = extractTextColors(sample);

    // The cyan artwork touching borders must be rejected; black text must be preserved
    expect(profile.fill).toBe("#000000");
    expect(profile.hasOutline).toBe(false);
  });

  it("does not allow a high numeric confidence score alone to bypass evidence admission", () => {
    // Create a scenario where a contaminated candidate would normally compute high confidence
    // because of high cluster density and contrast from one border pixel,
    // but the cluster fails evidence validation because it is border-contaminated.
    const sample = createSyntheticRegion(50, 20, (x, y) => {
      // Border is black (0, 0, 0)
      if (x === 0 || y === 0) return [0, 0, 0, 255];
      // Large green banner covering most of the crop (0, 180, 80)
      if (x < 35) return [0, 180, 80, 255];
      // Small white text in center
      if (x >= 40 && x <= 45 && y >= 8 && y <= 12) return [255, 255, 255, 255];
      return [0, 0, 0, 255];
    });

    const profile = extractTextColors(sample);

    // Green banner (#00b450) must NOT be admitted as source text fill despite high pixel count
    expect(profile.fill).not.toBe("#00b450");
    if (profile.fill === "#00b450") {
      // If it somehow picked green, it must NOT be admitted
      expect(profile.evidenceState).toBe("rejected");
    }
  });

  it("rejection is structural and does NOT blacklist legitimate brown or orange text", () => {
    // 30x30 region: White speech balloon (255, 255, 255).
    // Text in the center is deliberately authored in brown ink (140, 80, 40) = #8c5028.
    // The brown pixels are strictly central (x: 10..20, y: 10..20) and do NOT touch borders.
    const sample = createSyntheticRegion(30, 30, (x, y) => {
      if (x >= 10 && x <= 20 && y >= 10 && y <= 20) {
        // Inner glyph
        return [140, 80, 40, 255];
      }
      return [255, 255, 255, 255];
    });

    const profile = extractTextColors(sample);

    // Legitimate brown text SHOULD be admitted because it has clean, centered text-local evidence!
    expect(profile.fill).toBe("#8c5028");
    expect(profile.source).toBe("auto");
    expect(profile.evidenceState).toBe("admitted");
  });

  it("rejection is structural and does NOT blacklist legitimate orange text", () => {
    // 30x30 region: Dark background (20, 20, 20).
    // Text in the center is vivid orange (255, 120, 0) = #ff7800.
    const sample = createSyntheticRegion(30, 30, (x, y) => {
      if (x >= 10 && x <= 20 && y >= 10 && y <= 20) {
        return [255, 120, 0, 255];
      }
      return [20, 20, 20, 255];
    });

    const profile = extractTextColors(sample);

    expect(profile.fill).toBe("#ff7800");
    expect(profile.source).toBe("auto");
    expect(profile.evidenceState).toBe("admitted");
  });

  it("admits valid plain black dialogue on white balloon with explicit no-outline", () => {
    const sample = createSyntheticRegion(25, 25, (x, y) => {
      if (x >= 10 && x <= 15 && y >= 8 && y <= 17) return [0, 0, 0, 255];
      return [255, 255, 255, 255];
    });

    const profile = extractTextColors(sample);
    expect(profile.fill).toBe("#000000");
    expect(profile.hasOutline).toBe(false);
    expect(profile.evidenceState).toBe("admitted");
    expect(profile.source).toBe("auto");
  });

  it("admits valid plain white dialogue on dark background with explicit no-outline", () => {
    const sample = createSyntheticRegion(25, 25, (x, y) => {
      if (x >= 10 && x <= 15 && y >= 8 && y <= 17) return [255, 255, 255, 255];
      return [25, 25, 25, 255];
    });

    const profile = extractTextColors(sample);
    expect(profile.fill).toBe("#ffffff");
    expect(profile.hasOutline).toBe(false);
    expect(profile.evidenceState).toBe("admitted");
    expect(profile.source).toBe("auto");
  });

  it("admits genuinely colored text with outline when evidence is trustworthy", () => {
    // 30x30: Light grey background (220, 220, 220).
    // Central text: Yellow fill (255, 220, 0) with dark outline (10, 10, 10).
    const sample = createSyntheticRegion(30, 30, (x, y) => {
      if (x < 6 || x > 24 || y < 6 || y > 24) return [220, 220, 220, 255];
      if (x < 9 || x > 21 || y < 9 || y > 21) return [10, 10, 10, 255]; // Outline
      return [255, 220, 0, 255]; // Yellow fill
    });

    const profile = extractTextColors(sample);
    expect(profile.fill).toBe("#ffdc00");
    expect(profile.outline).toBe("#0a0a0a");
    expect(profile.hasOutline).toBe(true);
    expect(profile.evidenceState).toBe("admitted");
    expect(profile.source).toBe("auto");
  });

  it("gives precise Glyph mask preference over surrounding artwork", () => {
    // 40x40 region: surrounding red artwork (230, 20, 20) everywhere.
    // Glyph mask marks exact white letters (255, 255, 255) with blue outline (0, 100, 255).
    const sample = createSyntheticRegion(40, 40, (x, y) => {
      if (x >= 15 && x <= 25 && y >= 15 && y <= 25) {
        if (x < 17 || x > 23 || y < 17 || y > 23) return [0, 100, 255, 255]; // Blue outline
        return [255, 255, 255, 255]; // White fill
      }
      return [230, 20, 20, 255]; // Red artwork background
    });
    sample.glyphMask = new Uint8ClampedArray(40 * 40);
    for (let y = 15; y <= 25; y++) {
      for (let x = 15; x <= 25; x++) {
        sample.glyphMask[y * 40 + x] = 255;
      }
    }

    const profile = extractTextColors(sample);
    expect(profile.fill).toBe("#ffffff");
    expect(profile.outline).toBe("#0064ff");
    expect(profile.evidenceState).toBe("admitted");
  });

  it("handles extreme background chaos gracefully without failing or throwing", () => {
    // Noise region where every pixel is random noise
    const sample = createSyntheticRegion(30, 30, (x, y) => {
      const r = (x * 37 + y * 53) % 256;
      const g = (x * 17 + y * 71) % 256;
      const b = (x * 43 + y * 29) % 256;
      return [r, g, b, 255];
    });

    expect(() => extractTextColors(sample)).not.toThrow();
    const profile = extractTextColors(sample);
    expect(profile).toBeDefined();
    // In heavy noise, it should safely fall back
    expect(["fallback", "global"]).toContain(profile.source);
  });

  it("resolves a rejected contaminated profile to readable fallback instead of using contaminated fill", () => {
    const rejectedProfile: TextStyleProfile = {
      fill: "#8c5028", // Contaminated brown floor color
      outline: "#8c5028",
      source: "fallback",
      evidenceState: "rejected",
      fallbackReason: "background-contamination",
      fillConfidence: 0.90, // Even with high numeric confidence!
      outlineConfidence: 0.90,
      confidenceBand: "high",
    };

    const bubble: TranslatedBubble = {
      box: [10, 10, 100, 100],
      t: "คำแปลบทสนทนา",
      styleProfile: rejectedProfile,
    };

    const resolved = resolveBubbleTextStyle(bubble, { textColor: "#000000", textOutline: "#ffffff" });

    // Must NOT render the contaminated brown fill #8c5028!
    expect(resolved.textColor).not.toBe("#8c5028");
    expect(resolved.source).toBe("fallback");
  });
});
