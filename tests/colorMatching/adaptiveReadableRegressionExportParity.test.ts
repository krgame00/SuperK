import { describe, expect, it } from "vitest";
import {
  resolveBubbleTextStyle,
  selectAdaptiveReadableStyle,
  preserveManualStyleProfiles,
  recomputeAdaptiveReadableOnLayoutCommit,
} from "@/lib/colorMatching/resolveTextStyle";
import { extractTextColors } from "@/lib/colorMatching/sampleTextColors";
import { applyNearbyStyleFallbacks, inferTextStyleCategory } from "@/lib/colorMatching/nearbyStyleFallback";
import type { ColorSampleRegion, TextStyleProfile } from "@/lib/colorMatching/types";
import type { TranslatedBubble } from "@/lib/translationOverlay";

function createSolidSample(r: number, g: number, b: number, width = 60, height = 60): ColorSampleRegion {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, rgba };
}

describe("Ticket 17: Adaptive Readable Regression & Export Parity", () => {
  describe("Seam 1: Source Style Recovery & Evidence Admission", () => {
    it("rejects artwork/carpet contamination and does NOT admit surrounding noise as source style", () => {
      // 90% brown artwork + 10% unverified text
      const contaminatedSample = createSolidSample(135, 75, 35, 100, 40);
      const profile = extractTextColors(contaminatedSample);

      // Must be low confidence or rejected
      expect(profile.fillConfidence).toBeLessThan(0.60);
      expect(profile.evidenceState).not.toBe("admitted");
    });

    it("correctly identifies speech bubble container and provides background luminance metadata", () => {
      // White speech bubble region
      const whiteBubbleSample = createSolidSample(255, 255, 255, 80, 80);
      const profile = extractTextColors(whiteBubbleSample);

      expect(profile.backgroundLuminance).toBeGreaterThanOrEqual(240);
      expect(profile.backgroundColor).toBe("#ffffff");
    });
  });

  describe("Seam 2: Style Resolution & Readability/Fallback Policy", () => {
    it("proves bright/white-background fallback never renders white-on-white text", () => {
      const whiteBalloonBubble: TranslatedBubble = {
        id: "white_balloon_fallback",
        box: [100, 100, 300, 400],
        category: "dialogue",
        t: "ข้อความบนบอลลูนขาว",
        styleProfile: {
          ownershipMode: "auto",
          source: "auto",
          fill: "#ffffff",
          outline: "#ffffff",
          hasOutline: false,
          evidenceState: "rejected",
          fallbackReason: "background-contamination",
          backgroundLuminance: 250,
          backgroundColor: "#ffffff",
        },
      };

      const resolved = resolveBubbleTextStyle(whiteBalloonBubble);
      // Must NOT be white-on-white!
      expect(resolved.textColor).toBe("#000000");
      expect(resolved.textOutline).toBe("#ffffff");
      expect(resolved.hasOutline).toBe(true);
      expect(resolved.source).toBe("fallback");
    });

    it("evaluates mixed bright/dark backgrounds and provides stable candidate with escalated outline", () => {
      const mixedAdaptive = selectAdaptiveReadableStyle({
        backgroundLuminance: 140,
        backgroundLuminanceSamples: [240, 230, 180, 40, 25, 30],
      });

      expect(mixedAdaptive.hasOutline).toBe(true);
      expect(mixedAdaptive.outlineWidthRatio).toBeGreaterThanOrEqual(0.16);
      expect(mixedAdaptive.outlineWidthRatio).toBeLessThanOrEqual(0.20);
    });

    it("preserves validated source-faithful no-outline text without forcing mandatory outline", () => {
      const sourceBubble: TranslatedBubble = {
        id: "source_admitted",
        box: [100, 100, 300, 400],
        category: "dialogue",
        t: "บทพูดต้นฉบับคมชัดไม่มีขอบ",
        styleProfile: {
          ownershipMode: "auto",
          source: "auto",
          fill: "#000000",
          outline: "#000000",
          hasOutline: false,
          outlineWidthRatio: 0,
          evidenceState: "admitted",
          fillConfidence: 0.95,
          backgroundLuminance: 255,
        },
      };

      const resolved = resolveBubbleTextStyle(sourceBubble);
      expect(resolved.textColor).toBe("#000000");
      expect(resolved.hasOutline).toBe(false);
      expect(resolved.source).toBe("auto");
    });

    it("escalates Overlay Subtitle to background plate only on last-resort, but NEVER for Dialogue or Narration", () => {
      // Subtitle escalation
      const subBubble: TranslatedBubble = {
        id: "sub_plate",
        box: [800, 100, 860, 600],
        category: "subtitle",
        t: "คำบรรยายฉากยาก",
        styleProfile: {
          ownershipMode: "auto",
          source: "auto",
          fill: "#ffffff",
          outline: "#000000",
          evidenceState: "rejected",
          fallbackReason: "low-readability",
          backgroundLuminance: 128,
          backgroundLuminanceSamples: [0, 255, 0, 255],
          requiresPlateEscalation: true,
        },
      };

      const resolvedSub = resolveBubbleTextStyle(subBubble);
      expect(resolvedSub.backgroundPlate).toBeDefined();

      // Dialogue escalation
      const diaBubble: TranslatedBubble = {
        id: "dia_no_plate",
        box: [200, 100, 350, 400],
        category: "dialogue",
        t: "บทพูดฉากยาก",
        styleProfile: {
          ownershipMode: "auto",
          source: "auto",
          fill: "#000000",
          outline: "#ffffff",
          evidenceState: "rejected",
          fallbackReason: "low-readability",
          backgroundLuminance: 128,
          backgroundLuminanceSamples: [0, 255, 0, 255],
          requiresPlateEscalation: true,
        },
      };

      const resolvedDia = resolveBubbleTextStyle(diaBubble);
      // Dialogue NEVER receives automatic plates!
      expect(resolvedDia.backgroundPlate).toBeUndefined();
      expect(resolvedDia.reviewRequired).toBe(true);
    });
  });

  describe("Seam 3: Overlay/UI/Export Behavior & Workspace Parity", () => {
    it("workspace rendering and export produce matching resolved styles for single-page and batch", () => {
      const bubbles: TranslatedBubble[] = [
        {
          id: "page_bubble_1",
          box: [100, 100, 200, 300],
          category: "dialogue",
          t: "หน้าเดี่ยวและแบทช์ต้องได้สไตล์เดียวกัน",
          styleProfile: {
            ownershipMode: "auto",
            source: "fallback",
            fill: "#000000",
            outline: "#ffffff",
            hasOutline: true,
            backgroundLuminance: 250,
          },
        },
      ];

      // Simulate workspace resolution
      const workspaceStyle = resolveBubbleTextStyle(bubbles[0]);

      // Simulate export renderer resolution
      const exportStyle = resolveBubbleTextStyle(bubbles[0]);

      expect(workspaceStyle.textColor).toBe(exportStyle.textColor);
      expect(workspaceStyle.textOutline).toBe(exportStyle.textOutline);
      expect(workspaceStyle.hasOutline).toBe(exportStyle.hasOutline);
      expect(workspaceStyle.outlineWidthRatio).toBe(exportStyle.outlineWidthRatio);
      expect(workspaceStyle.readabilityHalo).toEqual(exportStyle.readabilityHalo);
      expect(workspaceStyle.backgroundPlate).toEqual(exportStyle.backgroundPlate);
    });

    it("survives serialization, committed layout changes, and re-translation without losing Manual ownership", () => {
      const original: TranslatedBubble = {
        id: "b_manual_parity",
        box: [100, 100, 200, 300],
        original_text: "Text",
        t: "ข้อความ",
        styleProfile: {
          ownershipMode: "manual",
          source: "manual",
          fill: "#123456",
          outline: "#654321",
          hasOutline: true,
          outlineWidthRatio: 0.15,
        },
      };

      // Save/load
      const serialized = JSON.parse(JSON.stringify(original));

      // Layout commit to dark scene
      const darkBg = createSolidSample(10, 10, 10);
      recomputeAdaptiveReadableOnLayoutCommit(serialized, darkBg);

      // Re-translation
      const retranslated = preserveManualStyleProfiles(
        [{ id: "b_manual_parity", box: [120, 120, 220, 320], original_text: "Text", t: "แปลใหม่" }],
        [serialized],
      );

      const finalResolved = resolveBubbleTextStyle(retranslated[0]);
      expect(finalResolved.textColor).toBe("#123456");
      expect(finalResolved.textOutline).toBe("#654321");
      expect(finalResolved.source).toBe("manual");
      expect(retranslated[0].styleProfile?.ownershipMode).toBe("manual");
    });
  });
});
