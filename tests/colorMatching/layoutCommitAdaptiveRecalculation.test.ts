import { describe, it, expect } from "vitest";
import {
  recomputeAdaptiveReadableOnLayoutCommit,
  resolveBubbleTextStyle,
  preserveManualStyleProfiles,
} from "@/lib/colorMatching/resolveTextStyle";
import type { TranslatedBubble } from "@/lib/translationOverlay";
import type { ColorSampleRegion } from "@/lib/colorMatching/types";

function createSolidSample(r: number, g: number, b: number, width = 50, height = 50): ColorSampleRegion {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, rgba };
}

describe("Ticket 16: Layout-Commit Adaptive Recalculation & Ownership Persistence", () => {
  it("recomputes Adaptive Readable when moved from bright background to dark background on layout commit", () => {
    // Bubble starts on bright speech balloon
    const bubble: TranslatedBubble = {
      id: "bubble_moving",
      box: [100, 100, 200, 300],
      t: "ข้อความย้ายตำแหน่ง",
      styleProfile: {
        ownershipMode: "auto",
        source: "fallback",
        fill: "#000000",
        outline: "#ffffff",
        hasOutline: true,
        backgroundLuminance: 245,
        backgroundColor: "#ffffff",
      },
    };

    // User finishes dragging to a dark artwork background (e.g. night sky, rgb(20, 25, 30))
    const darkBackgroundSample = createSolidSample(20, 25, 30);
    recomputeAdaptiveReadableOnLayoutCommit(bubble, darkBackgroundSample);

    expect(bubble.styleProfile?.ownershipMode).toBe("auto");
    expect(bubble.styleProfile?.backgroundLuminance).toBeLessThan(50);

    const resolved = resolveBubbleTextStyle(bubble);
    // Dark background resolves to light fill with dark outline
    expect(resolved.textColor).toBe("#ffffff");
    expect(resolved.textOutline).toBe("#000000");
    expect(resolved.hasOutline).toBe(true);
  });

  it("recomputes explicit Readable mode against new background on layout commit while keeping ownershipMode: 'readable'", () => {
    const readableBubble: TranslatedBubble = {
      id: "bubble_readable_move",
      box: [100, 100, 200, 300],
      t: "โหมดอ่านง่ายย้ายที่",
      styleProfile: {
        ownershipMode: "readable",
        source: "fallback",
        fill: "#ffffff",
        outline: "#000000",
        hasOutline: true,
        backgroundLuminance: 30,
        backgroundColor: "#1e1e1e",
      },
    };

    // Moved to bright white balloon
    const brightSample = createSolidSample(250, 250, 250);
    recomputeAdaptiveReadableOnLayoutCommit(readableBubble, brightSample);

    expect(readableBubble.styleProfile?.ownershipMode).toBe("readable");
    expect(readableBubble.styleProfile?.backgroundLuminance).toBeGreaterThan(200);

    const resolved = resolveBubbleTextStyle(readableBubble);
    expect(resolved.textColor).toBe("#000000");
    expect(resolved.textOutline).toBe("#ffffff");
    expect(resolved.hasOutline).toBe(true);
  });

  it("NEVER recolors or re-outlines user Manual styles on layout commit", () => {
    const manualBubble: TranslatedBubble = {
      id: "bubble_manual_user",
      box: [100, 100, 200, 300],
      t: "ผู้ใช้เลือกสีชมพูขอบทองไว้",
      styleProfile: {
        ownershipMode: "manual",
        source: "manual",
        fill: "#ff0077",
        outline: "#ffd700",
        hasOutline: true,
        outlineWidthRatio: 0.12,
        backgroundLuminance: 250,
      },
    };

    // User moves manual bubble onto pure black artwork
    const darkSample = createSolidSample(0, 0, 0);
    recomputeAdaptiveReadableOnLayoutCommit(manualBubble, darkSample);

    // Style must remain 100% unchanged
    expect(manualBubble.styleProfile?.ownershipMode).toBe("manual");
    expect(manualBubble.styleProfile?.fill).toBe("#ff0077");
    expect(manualBubble.styleProfile?.outline).toBe("#ffd700");

    const resolved = resolveBubbleTextStyle(manualBubble);
    expect(resolved.textColor).toBe("#ff0077");
    expect(resolved.textOutline).toBe("#ffd700");
    expect(resolved.source).toBe("manual");
  });

  it("preserves ownership and adaptive state across serialization and re-translation", () => {
    const previousBubbles: TranslatedBubble[] = [
      {
        id: "bubble_manual_persisted",
        box: [100, 100, 200, 300],
        original_text: "こんにちは",
        t: "สวัสดี",
        styleProfile: {
          ownershipMode: "manual",
          source: "manual",
          fill: "#00ffcc",
          outline: "#000000",
          hasOutline: true,
        },
      },
    ];

    const nextBubbles: TranslatedBubble[] = [
      {
        id: "bubble_manual_persisted",
        box: [105, 100, 205, 300],
        original_text: "こんにちは",
        t: "สวัสดีครับ",
      },
    ];

    const preserved = preserveManualStyleProfiles(nextBubbles, previousBubbles);
    expect(preserved[0].styleProfile?.ownershipMode).toBe("manual");
    expect(preserved[0].styleProfile?.fill).toBe("#00ffcc");
  });
});
