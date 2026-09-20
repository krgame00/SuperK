import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ColorMatchStatus } from "@/components/colorMatching/ColorMatchStatus";
import {
  preserveManualStyleProfiles,
  recomputeAdaptiveReadableOnLayoutCommit,
  resolveBubbleTextStyle,
} from "@/lib/colorMatching/resolveTextStyle";
import type { TranslatedBubble } from "@/lib/translationOverlay";
import type { ColorSampleRegion, TextStyleProfile } from "@/lib/colorMatching/types";

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

describe("Ticket 21: Binary Fill Ownership, UI State & Persistence", () => {
  describe("Auto Ownership & Fallback Provenance", () => {
    it("preserves ownershipMode: 'auto' when Binary Fill fallback occurs and exposes concise provenance", () => {
      const profile: TextStyleProfile = {
        fill: "#ff007f",
        outline: "#ffffff",
        source: "fallback",
        ownershipMode: "auto",
        evidenceState: "rejected",
        fallbackReason: "background-contamination",
        backgroundLuminance: 245,
      };

      const bubble: TranslatedBubble = {
        id: 1,
        t: "ข้อความ",
        styleProfile: profile,
      };

      const resolved = resolveBubbleTextStyle(bubble);
      expect(resolved.textColor).toBe("#ffffff"); // White fill on bright bg
      expect(resolved.hasOutline).toBe(true);
      expect(resolved.source).toBe("fallback");
      expect(profile.ownershipMode).toBe("auto");

      // UI status renders Auto -> Readable fallback
      render(<ColorMatchStatus profile={profile} />);
      expect(screen.getByText("Auto → สีอ่านง่าย (Readable Fallback)")).toBeDefined();
      expect(screen.getByText(/ตรวจพบสีพื้นหลังปนเปื้อน/)).toBeDefined();
    });
  });

  describe("Explicit Readable Mode UX", () => {
    it("enters Binary Fill directly and renders explicit readable status without presenting as recovered style", () => {
      const readableProfile: TextStyleProfile = {
        fill: "#ffffff",
        outline: "#000000",
        hasOutline: true,
        ownershipMode: "readable",
        source: "fallback",
        backgroundLuminance: 40,
      };

      const bubble: TranslatedBubble = {
        id: 2,
        t: "อ่านง่าย",
        styleProfile: readableProfile,
      };

      const resolved = resolveBubbleTextStyle(bubble);
      expect(resolved.textColor).toBe("#ffffff");
      expect(resolved.hasOutline).toBe(true);
      expect(resolved.isAdaptiveReadable).toBe(true);

      render(<ColorMatchStatus profile={readableProfile} />);
      expect(screen.getByText("โหมดอ่านง่าย (Readable)")).toBeDefined();
    });
  });

  describe("Manual Ownership Immunity", () => {
    it("never mutates user-authored manual styles during classification or layout recalculation", () => {
      const manualProfile: TextStyleProfile = {
        fill: "#8e24aa", // custom purple
        outline: "#ffeb3b", // custom yellow
        hasOutline: true,
        outlineWidthRatio: 0.08,
        ownershipMode: "manual",
        source: "manual",
      };

      const bubble: TranslatedBubble = {
        id: "manual_bubble_1",
        box: [100, 100, 200, 300],
        t: "สไตล์ของผู้ใช้",
        styleProfile: manualProfile,
      };

      // 1. Resolve style
      const resolved = resolveBubbleTextStyle(bubble);
      expect(resolved.textColor).toBe("#8e24aa");
      expect(resolved.textOutline).toBe("#ffeb3b");
      expect(resolved.outlineWidthRatio).toBe(0.08);

      // 2. Drag/Move onto dark artwork background
      const darkBg = createSolidSample(20, 20, 20);
      recomputeAdaptiveReadableOnLayoutCommit(bubble, darkBg);

      // Style remains 100% unchanged
      expect(bubble.styleProfile?.fill).toBe("#8e24aa");
      expect(bubble.styleProfile?.outline).toBe("#ffeb3b");
      expect(bubble.styleProfile?.ownershipMode).toBe("manual");
    });
  });

  describe("Re-translation Persistence & Matching", () => {
    it("preserves manual and readable styles when wording is re-translated", () => {
      const prevBubbles: TranslatedBubble[] = [
        {
          id: "b1",
          box: [100, 100, 200, 300],
          original_text: "こんにちは",
          t: "สวัสดี",
          styleProfile: {
            ownershipMode: "manual",
            source: "manual",
            fill: "#e91e63",
            outline: "#000000",
            hasOutline: true,
          },
        },
        {
          id: "b2",
          box: [400, 400, 500, 600],
          original_text: "さようなら",
          t: "ลาก่อน",
          styleProfile: {
            ownershipMode: "readable",
            source: "fallback",
            fill: "#ffffff",
            outline: "#000000",
            hasOutline: true,
          },
        },
      ];

      const nextBubbles: TranslatedBubble[] = [
        {
          id: "b1",
          box: [100, 100, 200, 300],
          original_text: "こんにちは",
          t: "สวัสดีครับ (แปลใหม่)",
        },
        {
          id: "b2",
          box: [400, 400, 500, 600],
          original_text: "さようなら",
          t: "ลาก่อนนะ (แปลใหม่)",
        },
      ];

      const preserved = preserveManualStyleProfiles(nextBubbles, prevBubbles);
      expect(preserved[0].styleProfile?.ownershipMode).toBe("manual");
      expect(preserved[0].styleProfile?.fill).toBe("#e91e63");
      expect(preserved[1].styleProfile?.ownershipMode).toBe("readable");
    });
  });

  describe("Save / Load & Serialization Parity", () => {
    it("survives serialization and deserialization without losing binary fill resolution or provenance", () => {
      const originalBubble: TranslatedBubble = {
        id: "persist_bubble",
        box: [150, 150, 300, 450],
        t: "ข้อความบันทึก",
        styleProfile: {
          ownershipMode: "auto",
          source: "fallback",
          fill: "#ffffff",
          outline: "#000000",
          hasOutline: true,
          outlineWidthRatio: 0.16,
          backgroundLuminance: 240,
          fallbackReason: "low-readability",
          reviewRequired: true,
          isAdaptiveReadable: true,
        },
      };

      const json = JSON.stringify(originalBubble);
      const deserialized: TranslatedBubble = JSON.parse(json);

      expect(deserialized.styleProfile?.ownershipMode).toBe("auto");
      expect(deserialized.styleProfile?.fallbackReason).toBe("low-readability");
      expect(deserialized.styleProfile?.reviewRequired).toBe(true);

      const resolved = resolveBubbleTextStyle(deserialized);
      expect(resolved.textColor).toBe("#ffffff");
      expect(resolved.textOutline).toBe("#000000");
      expect(resolved.hasOutline).toBe(true);
      expect(resolved.reviewRequired).toBe(true);
    });

    it("loads legacy profiles safely with backward-compatible defaults", () => {
      const legacyBubble: TranslatedBubble = {
        id: "legacy_bubble",
        box: [100, 100, 200, 200],
        t: "โปรเจกต์เก่า",
        // Old bubble with no styleProfile
      };

      const resolved = resolveBubbleTextStyle(legacyBubble, { textColor: "#000000", textOutline: "#ffffff" });
      expect(resolved.textColor).toBe("#000000");
      expect(resolved.textOutline).toBe("#ffffff");
      expect(resolved.hasOutline).toBe(true);
      expect(resolved.source).toBe("global");
    });
  });
});
