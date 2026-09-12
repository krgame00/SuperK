import { describe, it, expect } from "vitest";
import {
  resolveBubbleTextStyle,
  selectAdaptiveReadableStyle,
} from "@/lib/colorMatching/resolveTextStyle";
import type { TranslatedBubble } from "@/lib/translationOverlay";

describe("Ticket 14: Mixed-Background Readability Scoring & Outline Escalation", () => {
  it("uses normal outline ratio (0.10–0.14) on uniform simple backgrounds", () => {
    // Uniform bright background (e.g. speech balloon)
    const simpleBright = selectAdaptiveReadableStyle({
      backgroundLuminance: 245,
      backgroundLuminanceSamples: [240, 245, 250, 248, 242],
    });

    expect(simpleBright.hasOutline).toBe(true);
    expect(simpleBright.outlineWidthRatio).toBeGreaterThanOrEqual(0.10);
    expect(simpleBright.outlineWidthRatio).toBeLessThanOrEqual(0.14);

    // Uniform dark background
    const simpleDark = selectAdaptiveReadableStyle({
      backgroundLuminance: 30,
      backgroundLuminanceSamples: [25, 30, 35, 28, 32],
    });

    expect(simpleDark.hasOutline).toBe(true);
    expect(simpleDark.outlineWidthRatio).toBeGreaterThanOrEqual(0.10);
    expect(simpleDark.outlineWidthRatio).toBeLessThanOrEqual(0.14);
  });

  it("escalates outline ratio toward 0.16–0.20 on difficult mixed bright/dark backgrounds", () => {
    // Mixed background crossing a high-contrast panel edge or explosion
    const mixedBg = selectAdaptiveReadableStyle({
      backgroundLuminance: 140,
      backgroundLuminanceSamples: [240, 230, 180, 45, 25, 30],
    });

    expect(mixedBg.hasOutline).toBe(true);
    expect(mixedBg.outlineWidthRatio).toBeGreaterThanOrEqual(0.16);
    expect(mixedBg.outlineWidthRatio).toBeLessThanOrEqual(0.20);
  });

  it("caps outline escalation at 0.20 to prevent Thai glyph counter clogging", () => {
    // Extreme high-frequency chaos / checkerboard background
    const extremeBg = selectAdaptiveReadableStyle({
      backgroundLuminance: 128,
      backgroundLuminanceSamples: [0, 255, 0, 255, 0, 255, 0, 255],
    });

    expect(extremeBg.outlineWidthRatio).toBeLessThanOrEqual(0.20);
    expect(extremeBg.outlineWidthRatio).toBeGreaterThanOrEqual(0.16);
  });

  it("evaluates lower-percentile weak-region contrast instead of trusting average brightness alone", () => {
    // Average luminance is 196 (looks bright overall), but a prominent dark patch exists at 30
    const weakRegionBg = selectAdaptiveReadableStyle({
      backgroundLuminance: 196,
      backgroundLuminanceSamples: [245, 250, 240, 235, 30, 25],
    });

    // Despite average being bright (> 150), the presence of the dark patch requires escalated outline
    // to keep the dark-fill text readable across the dark patch
    expect(weakRegionBg.outlineWidthRatio).toBeGreaterThanOrEqual(0.16);
  });

  it("resolves Auto → Readable bubble with mixed background samples into escalated outline", () => {
    const bubble: TranslatedBubble = {
      id: "bubble_mixed_panel",
      box: [200, 100, 350, 500],
      t: "ข้อความบนฉากครึ่งสว่างครึ่งมืด",
      styleProfile: {
        ownershipMode: "auto",
        source: "auto",
        fill: "#ffffff",
        outline: "#ffffff",
        hasOutline: false,
        evidenceState: "rejected",
        fallbackReason: "background-contamination",
        backgroundLuminance: 130,
        backgroundLuminanceSamples: [230, 240, 220, 40, 35, 30],
      },
    };

    const resolved = resolveBubbleTextStyle(bubble);
    expect(resolved.hasOutline).toBe(true);
    expect(resolved.outlineWidthRatio).toBeGreaterThanOrEqual(0.16);
    expect(resolved.outlineWidthRatio).toBeLessThanOrEqual(0.20);
    expect(resolved.source).toBe("fallback");
  });

  it("preserves validated source profiles with no-outline even when background is mixed", () => {
    // Evidence-admitted source profile from original art
    const admittedBubble: TranslatedBubble = {
      id: "bubble_admitted_no_outline",
      box: [200, 100, 350, 500],
      t: "ข้อความต้นฉบับไม่มีขอบ",
      styleProfile: {
        ownershipMode: "auto",
        source: "auto",
        fill: "#000000",
        outline: "#000000",
        hasOutline: false,
        outlineWidthRatio: 0,
        evidenceState: "admitted",
        fillConfidence: 0.95,
        backgroundLuminance: 130,
        backgroundLuminanceSamples: [230, 240, 220, 40, 35, 30],
      },
    };

    const resolved = resolveBubbleTextStyle(admittedBubble);
    expect(resolved.hasOutline).toBe(false);
    expect(resolved.outlineWidthRatio).toBe(0);
    expect(resolved.source).toBe("auto");
  });

  it("preserves user manual style without forcing outline escalation on mixed backgrounds", () => {
    const manualBubble: TranslatedBubble = {
      id: "bubble_manual_mixed",
      box: [200, 100, 350, 500],
      t: "ผู้ใช้กำหนดเอง",
      styleProfile: {
        ownershipMode: "manual",
        source: "manual",
        fill: "#ff0000",
        outline: "#000000",
        hasOutline: true,
        outlineWidthRatio: 0.08,
        backgroundLuminance: 130,
        backgroundLuminanceSamples: [230, 240, 220, 40, 35, 30],
      },
    };

    const resolved = resolveBubbleTextStyle(manualBubble);
    expect(resolved.textColor).toBe("#ff0000");
    expect(resolved.outlineWidthRatio).toBe(0.08);
    expect(resolved.source).toBe("manual");
  });
});
