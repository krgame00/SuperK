import { describe, it, expect } from "vitest";
import {
  resolveBubbleTextStyle,
  selectAdaptiveReadableStyle,
  strengthenSourceAccentOutline,
  deriveSourceAccentColor,
  STANDARD_TRANSLATED_TEXT_SHADOW,
} from "../../lib/colorMatching/resolveTextStyle";
import type { TranslatedBubble } from "../../lib/translationOverlay";
import type { TextStyleProfile } from "../../lib/colorMatching/types";

describe("White Fill + Source-Colored Outline Architecture", () => {
  describe("Phase 1 & 2: White Fill Policy & Source Accent Recovery", () => {
    it("resolves pure white fill (#ffffff) with purple source accent outline", () => {
      const purpleAccent = "#9c27b0";
      const resolved = selectAdaptiveReadableStyle({
        sourceAccentColor: purpleAccent,
        backgroundLuminance: 240, // White balloon / light background
      });

      expect(resolved.textColor.toLowerCase()).toBe("#ffffff");
      expect(resolved.hasOutline).toBe(true);
      // Outline should be strengthened purple (preserving hue)
      expect(resolved.textOutline.toLowerCase()).not.toBe("#ffffff");
      expect(resolved.textOutline.toLowerCase()).not.toBe("#000000");
    });

    it("resolves pure white fill (#ffffff) with pink source accent outline", () => {
      const pinkAccent = "#e91e63";
      const resolved = selectAdaptiveReadableStyle({
        sourceAccentColor: pinkAccent,
        backgroundLuminance: 250,
      });

      expect(resolved.textColor.toLowerCase()).toBe("#ffffff");
      expect(resolved.hasOutline).toBe(true);
      expect(resolved.textOutline.toLowerCase()).not.toBe("#ffffff");
    });

    it("resolves pure white fill (#ffffff) with cyan source accent outline", () => {
      const cyanAccent = "#00bcd4";
      const resolved = selectAdaptiveReadableStyle({
        sourceAccentColor: cyanAccent,
        backgroundLuminance: 200,
      });

      expect(resolved.textColor.toLowerCase()).toBe("#ffffff");
      expect(resolved.hasOutline).toBe(true);
      expect(resolved.textOutline.toLowerCase()).not.toBe("#ffffff");
    });

    it("falls back to safe dark outline for light gray / low-chroma source accent", () => {
      const lightGrayAccent = "#d0d0d0";
      const resolved = selectAdaptiveReadableStyle({
        sourceAccentColor: lightGrayAccent,
        backgroundLuminance: 240,
      });

      expect(resolved.textColor.toLowerCase()).toBe("#ffffff");
      expect(resolved.hasOutline).toBe(true);
      // Light gray cannot contrast against white fill or light background, so must fallback to safe dark outline
      expect(resolved.textOutline.toLowerCase()).toBe("#000000");
    });

    it("falls back to safe dark outline when no source accent is detected", () => {
      const resolved = selectAdaptiveReadableStyle({
        sourceAccentColor: undefined,
        backgroundLuminance: 240,
      });

      expect(resolved.textColor.toLowerCase()).toBe("#ffffff");
      expect(resolved.hasOutline).toBe(true);
      expect(resolved.textOutline.toLowerCase()).toBe("#000000");
    });
  });

  describe("Phase 3 & 4: Outline Strengthening & Background Readability Gate", () => {
    it("strengthens light purple/pink outline so it remains readable against white text and bright background", () => {
      const palePurple = "#ce93d8"; // Light pastel purple (L ~ 71%)
      const strengthened = strengthenSourceAccentOutline(palePurple, "#ffffff");

      expect(strengthened.toLowerCase()).not.toBe(palePurple.toLowerCase());
      // Strengthened color should be dark enough to outline white text
      const resolved = selectAdaptiveReadableStyle({
        sourceAccentColor: palePurple,
        backgroundLuminance: 255,
      });

      expect(resolved.textColor.toLowerCase()).toBe("#ffffff");
      expect(resolved.textOutline.toLowerCase()).toBe(strengthened.toLowerCase());
    });

    it("uses white fill + dark outline on mixed / high-variance backgrounds", () => {
      const resolved = selectAdaptiveReadableStyle({
        sourceAccentColor: "#ab47bc",
        backgroundLuminanceSamples: [20, 240, 50, 220, 30], // High variance
      });

      expect(resolved.textColor.toLowerCase()).toBe("#ffffff");
      expect(resolved.hasOutline).toBe(true);
      expect(resolved.outlineWidthRatio).toBeGreaterThanOrEqual(0.16);
    });
  });

  describe("Phase 5: Auto -> Readable Fallback vs Source-Faithful vs Manual", () => {
    it("enforces white fill for explicit Readable mode on bubble", () => {
      const bubble: TranslatedBubble = {
        bubble_id: "b1",
        page_num: 1,
        box_2d: [100, 100, 200, 200],
        original_text: "テスト",
        translated_text: "ทดสอบ",
        styleProfile: {
          fill: "#e91e63",
          outline: "#000000",
          ownershipMode: "readable",
          evidenceState: "rejected",
          fallbackReason: "background-contamination",
          source: "fallback",
        } as TextStyleProfile,
      };

      const resolved = resolveBubbleTextStyle(bubble);
      expect(resolved.textColor.toLowerCase()).toBe("#ffffff");
      expect(resolved.hasOutline).toBe(true);
    });

    it("preserves source-faithful black text in admitted dialogue balloon", () => {
      const bubble: TranslatedBubble = {
        bubble_id: "b2",
        page_num: 1,
        box_2d: [100, 100, 200, 200],
        original_text: "セリフ",
        translated_text: "บทสนทนา",
        styleProfile: {
          fill: "#000000",
          outline: "#ffffff",
          ownershipMode: "auto",
          evidenceState: "admitted",
          source: "auto",
          fillConfidence: 0.95,
          outlineConfidence: 0.90,
          hasOutline: false,
        } as TextStyleProfile,
      };

      const resolved = resolveBubbleTextStyle(bubble);
      // Source-faithful dialogue must keep its admitted black fill, NOT forced to white
      expect(resolved.textColor.toLowerCase()).toBe("#000000");
    });

    it("preserves manual user overrides without rewriting to white", () => {
      const bubble: TranslatedBubble = {
        bubble_id: "b3",
        page_num: 1,
        box_2d: [100, 100, 200, 200],
        original_text: "セリフ",
        translated_text: "บทสนทนา",
        styleProfile: {
          fill: "#ff0000", // User custom red fill
          outline: "#00ff00", // User custom green outline
          ownershipMode: "manual",
          source: "manual",
          hasOutline: true,
          outlineWidthRatio: 0.20,
        } as TextStyleProfile,
      };

      const resolved = resolveBubbleTextStyle(bubble);
      expect(resolved.textColor.toLowerCase()).toBe("#ff0000");
      expect(resolved.textOutline.toLowerCase()).toBe("#00ff00");
      expect(resolved.source).toBe("manual");
    });
  });

  describe("Phase 6: Parity across Preview, Export, and Batch Translation", () => {
    it("produces identical resolved style for workspace preview and batch export", () => {
      const bubble: TranslatedBubble = {
        bubble_id: "b4",
        page_num: 1,
        box_2d: [50, 50, 150, 150],
        original_text: "タイトル",
        translated_text: "ชื่อเรื่อง",
        styleProfile: {
          fill: "#8e24aa",
          ownershipMode: "auto",
          evidenceState: "rejected",
          fallbackReason: "insufficient-evidence",
          source: "fallback",
          backgroundLuminance: 230,
        } as TextStyleProfile,
      };

      const previewStyle = resolveBubbleTextStyle(bubble);
      const exportStyle = resolveBubbleTextStyle(bubble);

      expect(previewStyle).toEqual(exportStyle);
      expect(previewStyle.textColor.toLowerCase()).toBe("#ffffff");
      expect(previewStyle.hasOutline).toBe(true);
    });
  });

  describe("Phase 7: Option A — Neon Glow Preservation with White Fill + Chromatic Outline in Auto Mode", () => {
    it("resolves admitted purple dialogue to pure white fill (#ffffff) + strengthened purple outline", () => {
      const bubble: TranslatedBubble = {
        bubble_id: "purple_dialogue",
        page_num: 1,
        box_2d: [100, 100, 300, 400],
        original_text: "เหมือนฉันจะหยิบเครื่องดื่มผิดสินะ",
        translated_text: "เหมือนฉันจะหยิบเครื่องดื่มผิดสินะ",
        styleProfile: {
          fill: "#874384", // Chromatic purple detected from original manga
          outline: "#ffffff",
          ownershipMode: "auto",
          evidenceState: "admitted",
          source: "auto",
          fillConfidence: 0.90,
          outlineConfidence: 0.85,
          backgroundLuminance: 70,
        } as TextStyleProfile,
      };

      const resolved = resolveBubbleTextStyle(bubble);
      expect(resolved.textColor.toLowerCase()).toBe("#ffffff");
      expect(resolved.hasOutline).toBe(true);
      expect(resolved.textOutline.toLowerCase()).not.toBe("#ffffff");
      expect(resolved.textOutline.toLowerCase()).not.toBe("#000000");
    });

    it("resolves admitted yellow dialogue to pure white fill (#ffffff) + strengthened outline", () => {
      const bubble: TranslatedBubble = {
        bubble_id: "yellow_dialogue",
        page_num: 1,
        box_2d: [100, 500, 300, 800],
        original_text: "โอเปอเรเตอร์ ซูซูรัน นำเครื่องเซ่นมาถวายแด่ท่าน",
        translated_text: "โอเปอเรเตอร์ ซูซูรัน นำเครื่องเซ่นมาถวายแด่ท่าน",
        styleProfile: {
          fill: "#ffcc00", // Bright yellow
          outline: "#000000",
          ownershipMode: "auto",
          evidenceState: "admitted",
          source: "auto",
          fillConfidence: 0.92,
          backgroundLuminance: 120,
        } as TextStyleProfile,
      };

      const resolved = resolveBubbleTextStyle(bubble);
      expect(resolved.textColor.toLowerCase()).toBe("#ffffff");
      expect(resolved.hasOutline).toBe(true);
    });

    it("resolves admitted red dialogue to pure white fill (#ffffff) + red outline", () => {
      const bubble: TranslatedBubble = {
        bubble_id: "red_dialogue",
        page_num: 1,
        box_2d: [600, 100, 800, 400],
        original_text: "เธอไม่ใช่ซีบอร์น... แกเป็นใครกันแน่?",
        translated_text: "เธอไม่ใช่ซีบอร์น... แกเป็นใครกันแน่?",
        styleProfile: {
          fill: "#d32f2f", // Red
          outline: "#ffffff",
          ownershipMode: "auto",
          evidenceState: "admitted",
          source: "auto",
          fillConfidence: 0.88,
          backgroundLuminance: 90,
        } as TextStyleProfile,
      };

      const resolved = resolveBubbleTextStyle(bubble);
      expect(resolved.textColor.toLowerCase()).toBe("#ffffff");
      expect(resolved.hasOutline).toBe(true);
      expect(resolved.textOutline.toLowerCase()).toBe("#d32f2f");
    });

    it("uses the exact detected source accent as outline when evidence confidence is high", () => {
      const bubble: TranslatedBubble = {
        bubble_id: "trusted_source_accent",
        page_num: 1,
        box_2d: [100, 100, 250, 450],
        original_text: "SOURCE",
        translated_text: "ต้นฉบับ",
        styleProfile: {
          fill: "#7b3fa1",
          outline: "#ffffff",
          sourceAccentColor: "#7b3fa1",
          ownershipMode: "auto",
          evidenceState: "admitted",
          source: "auto",
          fillConfidence: 0.94,
          outlineConfidence: 0.91,
          backgroundLuminance: 80,
        } as TextStyleProfile,
      };

      const resolved = resolveBubbleTextStyle(bubble);
      expect(resolved.textColor.toLowerCase()).toBe("#ffffff");
      expect(resolved.textOutline.toLowerCase()).toBe("#7b3fa1");
    });

    it("rejects contaminated detected color and falls back to a safe dark outline", () => {
      const bubble: TranslatedBubble = {
        bubble_id: "contaminated_source_accent",
        page_num: 1,
        box_2d: [100, 100, 250, 450],
        original_text: "SOURCE",
        translated_text: "ต้นฉบับ",
        styleProfile: {
          fill: "#ff1744",
          outline: "#ffffff",
          sourceAccentColor: "#ff1744",
          ownershipMode: "auto",
          evidenceState: "rejected",
          fallbackReason: "background-contamination",
          source: "fallback",
          fillConfidence: 0.52,
          outlineConfidence: 0.48,
          backgroundLuminance: 235,
        } as TextStyleProfile,
      };

      const resolved = resolveBubbleTextStyle(bubble);
      expect(resolved.textColor.toLowerCase()).toBe("#ffffff");
      expect(resolved.textOutline.toLowerCase()).toBe("#000000");
    });

    it("preserves neon diffuse glow (Option A) with white inner fill and cyan outline", () => {
      const bubble: TranslatedBubble = {
        bubble_id: "neon_glow_bubble",
        page_num: 1,
        box_2d: [600, 500, 800, 800],
        original_text: "อยากให้ฉันจูบตรงนี้ไหม หืม? หืม?",
        translated_text: "อยากให้ฉันจูบตรงนี้ไหม หืม? หืม?",
        styleProfile: {
          fill: "#00e5ff", // Neon cyan
          outline: "#00e5ff",
          ownershipMode: "auto",
          evidenceState: "admitted",
          source: "auto",
          fillConfidence: 0.95,
          backgroundLuminance: 40,
          glow: {
            color: "#00e5ff",
            opacity: 0.85,
            blurRatio: 0.35,
            offsetXRatio: 0,
            offsetYRatio: 0,
          },
        } as TextStyleProfile,
      };

      const resolved = resolveBubbleTextStyle(bubble);
      // Inner text fill must be pure white
      expect(resolved.textColor.toLowerCase()).toBe("#ffffff");
      expect(resolved.hasOutline).toBe(true);
      // Outline should be strengthened cyan
      expect(resolved.textOutline.toLowerCase()).not.toBe("#ffffff");
      // ADR 0015 keeps detected glow as source evidence but renders one uniform shadow.
      expect(resolved.glow).toBeUndefined();
      expect(resolved.shadow).toEqual(STANDARD_TRANSLATED_TEXT_SHADOW);
      expect(bubble.styleProfile?.glow?.color).toBe("#00e5ff");
      expect(bubble.styleProfile?.glow?.opacity).toBe(0.85);
    });
  });
});
