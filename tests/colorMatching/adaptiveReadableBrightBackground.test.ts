import { describe, it, expect } from "vitest";
import {
  resolveBubbleTextStyle,
  selectAdaptiveReadableStyle,
} from "@/lib/colorMatching/resolveTextStyle";
import type { TranslatedBubble } from "@/lib/translationOverlay";
import type { TextStyleProfile } from "@/lib/colorMatching/types";

describe("Ticket 13: Adaptive Readable on Bright & White Backgrounds", () => {
  it("selects dark fill with light outline on bright/white backgrounds for Adaptive Readable fallback", () => {
    const adaptive = selectAdaptiveReadableStyle({
      backgroundLuminance: 245,
      backgroundColor: "#ffffff",
    });

    expect(adaptive.textColor).toBe("#000000");
    expect(adaptive.textOutline).toBe("#ffffff");
    expect(adaptive.hasOutline).toBe(true);
    expect(adaptive.outlineWidthRatio).toBeGreaterThanOrEqual(0.10);
    expect(adaptive.source).toBe("fallback");
  });

  it("selects light fill with dark outline on dark backgrounds for Adaptive Readable fallback", () => {
    const adaptive = selectAdaptiveReadableStyle({
      backgroundLuminance: 35,
      backgroundColor: "#1e2820",
    });

    expect(adaptive.textColor).toBe("#ffffff");
    expect(adaptive.textOutline).toBe("#000000");
    expect(adaptive.hasOutline).toBe(true);
    expect(adaptive.outlineWidthRatio).toBeGreaterThanOrEqual(0.10);
    expect(adaptive.source).toBe("fallback");
  });

  it("resolves Auto → Readable fallback on bright/white speech balloons to dark-fill outlined text", () => {
    const bubble: TranslatedBubble = {
      id: "bubble_white_balloon",
      box: [100, 300, 250, 500],
      t: "บทพูดในบอลลูนขาว",
      styleProfile: {
        fill: "#ffffff",
        outline: "#ffffff",
        hasOutline: false,
        source: "auto",
        evidenceState: "rejected",
        fallbackReason: "background-contamination",
        backgroundLuminance: 250,
        backgroundColor: "#ffffff",
      },
    };

    const resolved = resolveBubbleTextStyle(bubble);
    expect(resolved.textColor).toBe("#000000");
    expect(resolved.textOutline).toBe("#ffffff");
    expect(resolved.hasOutline).toBe(true);
    expect(resolved.source).toBe("fallback");
  });

  it("resolves Auto → Readable fallback on dark artwork to light-fill outlined text", () => {
    const bubble: TranslatedBubble = {
      id: "bubble_dark_art",
      box: [600, 100, 750, 400],
      t: "คำบรรยายบนฉากมืด",
      styleProfile: {
        fill: "#101010",
        outline: "#101010",
        hasOutline: false,
        source: "auto",
        evidenceState: "rejected",
        fallbackReason: "background-contamination",
        backgroundLuminance: 25,
        backgroundColor: "#151815",
      },
    };

    const resolved = resolveBubbleTextStyle(bubble);
    expect(resolved.textColor).toBe("#ffffff");
    expect(resolved.textOutline).toBe("#000000");
    expect(resolved.hasOutline).toBe(true);
    expect(resolved.source).toBe("fallback");
  });

  it("applies adaptive readable selection to explicit Readable mode (ownershipMode: 'readable')", () => {
    const bubbleBright: TranslatedBubble = {
      id: "bubble_readable_bright",
      box: [100, 300, 250, 500],
      t: "ข้อความโหมด Readable บนพื้นสว่าง",
      styleProfile: {
        ownershipMode: "readable",
        source: "fallback",
        fill: "#ffffff",
        outline: "#000000",
        hasOutline: true,
        backgroundLuminance: 230,
        backgroundColor: "#f5f5f5",
      },
    };

    const resolvedBright = resolveBubbleTextStyle(bubbleBright);
    expect(resolvedBright.textColor).toBe("#000000");
    expect(resolvedBright.textOutline).toBe("#ffffff");
    expect(resolvedBright.hasOutline).toBe(true);

    const bubbleDark: TranslatedBubble = {
      id: "bubble_readable_dark",
      box: [100, 300, 250, 500],
      t: "ข้อความโหมด Readable บนพื้นมืด",
      styleProfile: {
        ownershipMode: "readable",
        source: "fallback",
        fill: "#000000",
        outline: "#ffffff",
        hasOutline: true,
        backgroundLuminance: 30,
        backgroundColor: "#202020",
      },
    };

    const resolvedDark = resolveBubbleTextStyle(bubbleDark);
    expect(resolvedDark.textColor).toBe("#ffffff");
    expect(resolvedDark.textOutline).toBe("#000000");
    expect(resolvedDark.hasOutline).toBe(true);
  });

  it("preserves validated source-faithful no-outline text without forcing an outline", () => {
    const sourceFaithfulDialogue: TranslatedBubble = {
      id: "bubble_source_faithful",
      box: [100, 300, 250, 500],
      t: "บทพูดต้นฉบับไม่มีขอบ",
      styleProfile: {
        fill: "#000000",
        outline: "#000000",
        hasOutline: false,
        outlineWidthRatio: 0,
        outlineWidth: 0,
        source: "auto",
        evidenceState: "admitted",
        fillConfidence: 0.95,
        outlineConfidence: 0.95,
        confidenceBand: "high",
        backgroundLuminance: 255,
      },
    };

    const resolved = resolveBubbleTextStyle(sourceFaithfulDialogue);
    expect(resolved.textColor).toBe("#000000");
    expect(resolved.hasOutline).toBe(false);
    expect(resolved.outlineWidthRatio).toBe(0);
    expect(resolved.source).toBe("auto");
  });

  it("never recolors or forces outline on user Manual styles", () => {
    const manualWhiteNoOutline: TranslatedBubble = {
      id: "bubble_manual",
      box: [100, 300, 250, 500],
      t: "ผู้ใช้ตั้งใจปรับสีขาวไม่มีขอบเอง",
      styleProfile: {
        ownershipMode: "manual",
        source: "manual",
        fill: "#ffffff",
        outline: "#ffffff",
        hasOutline: false,
        outlineWidthRatio: 0,
        outlineWidth: 0,
        backgroundLuminance: 255,
      },
    };

    const resolved = resolveBubbleTextStyle(manualWhiteNoOutline);
    expect(resolved.textColor).toBe("#ffffff");
    expect(resolved.hasOutline).toBe(false);
    expect(resolved.source).toBe("manual");
  });

  it("preserves ownershipMode: 'auto' when falling back to adaptive readable style", () => {
    const autoBubble: TranslatedBubble = {
      id: "bubble_auto_fallback",
      box: [100, 300, 250, 500],
      t: "Auto ตก fallback",
      styleProfile: {
        ownershipMode: "auto",
        source: "auto",
        fill: "#ffffff",
        outline: "#ffffff",
        hasOutline: false,
        evidenceState: "rejected",
        fallbackReason: "insufficient-evidence",
        backgroundLuminance: 255,
      },
    };

    const resolved = resolveBubbleTextStyle(autoBubble);
    expect(resolved.source).toBe("fallback");
    expect(resolved.textColor).toBe("#000000");
    expect(resolved.hasOutline).toBe(true);
    // Profile preserves ownershipMode: "auto"
    expect(autoBubble.styleProfile?.ownershipMode).toBe("auto");
  });

  it("handles legacy profiles missing background metadata safely", () => {
    const legacyBubble: TranslatedBubble = {
      id: "bubble_legacy",
      box: [100, 300, 250, 500],
      t: "ข้อมูลโปรไฟล์แบบเก่า",
      styleProfile: {
        source: "fallback",
        fill: "#ffffff",
        outline: "#000000",
        hasOutline: true,
      },
    };

    const resolved = resolveBubbleTextStyle(legacyBubble);
    expect(resolved.textColor).toBeDefined();
    expect(resolved.textOutline).toBeDefined();
    expect(resolved.hasOutline).toBe(true);
  });
});
