import { describe, expect, it } from "vitest";
import {
  TYPOGRAPHY_PRESETS,
  getTypographyPreset,
  detectActiveTypographyPreset,
  type TypographyPresetId,
} from "@/lib/editing/typographyPresets";
import type { TextLayer } from "@/lib/editing/commands";

describe("Typography Presets", () => {
  it("exports all 5 standard manga typography presets with complete style definitions", () => {
    expect(TYPOGRAPHY_PRESETS).toHaveLength(5);
    const ids = TYPOGRAPHY_PRESETS.map((p) => p.id);
    expect(ids).toEqual(["dialogue", "shout", "whisper", "sfx", "narration"]);

    TYPOGRAPHY_PRESETS.forEach((preset) => {
      expect(preset.name).toBeDefined();
      expect(preset.nameTh).toBeDefined();
      expect(preset.emoji).toBeDefined();
      expect(preset.style.fontFamily).toBeDefined();
      expect(typeof preset.style.isBold).toBe("boolean");
      expect(typeof preset.style.isItalic).toBe("boolean");
      expect(preset.style.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    });
  });

  it("retrieves preset by ID correctly", () => {
    const shout = getTypographyPreset("shout");
    expect(shout).toBeDefined();
    expect(shout?.id).toBe("shout");
    expect(shout?.style.fontFamily).toContain("Chakra Petch");
    expect(shout?.style.strokeWidth).toBe(4);

    const whisper = getTypographyPreset("whisper");
    expect(whisper?.style.isItalic).toBe(true);
    expect(whisper?.style.color).toBe("#4b5563");
  });

  it("detects active typography preset from layer properties", () => {
    const dialogueLayer: Partial<TextLayer> = {
      fontFamily: "Itim, sans-serif",
      isBold: true,
      isItalic: false,
    };
    expect(detectActiveTypographyPreset(dialogueLayer)).toBe("dialogue");

    const shoutLayer: Partial<TextLayer> = {
      fontFamily: "Chakra Petch, sans-serif",
      isBold: true,
      isItalic: false,
    };
    expect(detectActiveTypographyPreset(shoutLayer)).toBe("shout");

    const whisperLayer: Partial<TextLayer> = {
      fontFamily: "Mali, sans-serif",
      isBold: false,
      isItalic: true,
    };
    expect(detectActiveTypographyPreset(whisperLayer)).toBe("whisper");

    const sfxLayer: Partial<TextLayer> = {
      fontFamily: "Sriracha, sans-serif",
      isBold: true,
      isItalic: true,
    };
    expect(detectActiveTypographyPreset(sfxLayer)).toBe("sfx");

    const narrationLayer: Partial<TextLayer> = {
      fontFamily: "Prompt, sans-serif",
      isBold: true,
      isItalic: false,
      boxFill: "#ffffff",
    };
    expect(detectActiveTypographyPreset(narrationLayer)).toBe("narration");
  });

  it("returns null for non-matching or customized style", () => {
    const customLayer: Partial<TextLayer> = {
      fontFamily: "Arial, sans-serif",
      isBold: false,
      isItalic: false,
    };
    expect(detectActiveTypographyPreset(customLayer)).toBeNull();
  });
});
