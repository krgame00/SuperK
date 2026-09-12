import { describe, it, expect } from "vitest";
import {
  resolveBubbleTextStyle,
  selectAdaptiveReadableStyle,
} from "@/lib/colorMatching/resolveTextStyle";
import type { TranslatedBubble } from "@/lib/translationOverlay";
import type { TextStyleProfile } from "@/lib/colorMatching/types";

describe("Ticket 15: Readability Halo, Overlay Plate & Review Escalation", () => {
  it("introduces readability halo only on severe contrast failure and distinguishes it from source decorative effects", () => {
    // Extreme high-frequency / severe contrast collision
    const severeCollision = selectAdaptiveReadableStyle({
      backgroundLuminance: 120,
      backgroundLuminanceSamples: [10, 240, 15, 235, 12, 245, 18, 250],
      requiresHaloEscalation: true,
    });

    expect(severeCollision.hasOutline).toBe(true);
    expect(severeCollision.readabilityHalo).toBeDefined();
    expect(severeCollision.readabilityHalo?.blurRatio).toBeGreaterThan(0);
    // Must NOT confuse readability aid with recovered decorative source glow
    expect(severeCollision.glow).toBeUndefined();
  });

  it("escalates to background plate for overlay_subtitle as a last resort on unresolvable backgrounds", () => {
    const subtitleBubble: TranslatedBubble = {
      id: "subtitle_extreme_chaos",
      box: [800, 100, 860, 600],
      category: "subtitle",
      t: "คำบรรยายใต้ภาพบนฉากลายตามาก",
      styleProfile: {
        ownershipMode: "auto",
        source: "auto",
        fill: "#ffffff",
        outline: "#000000",
        hasOutline: false,
        evidenceState: "rejected",
        fallbackReason: "low-readability",
        backgroundLuminance: 128,
        backgroundLuminanceSamples: [0, 255, 0, 255, 0, 255, 0, 255],
        requiresPlateEscalation: true,
      },
    };

    const resolved = resolveBubbleTextStyle(subtitleBubble);
    expect(resolved.backgroundPlate).toBeDefined();
    expect(resolved.backgroundPlate?.opacity).toBeGreaterThan(0.4);
    expect(resolved.reviewRequired).toBeFalsy();
  });

  it("NEVER creates automatic background plates for Dialogue, but marks it reviewRequired", () => {
    const dialogueBubble: TranslatedBubble = {
      id: "dialogue_extreme_chaos",
      box: [200, 200, 400, 400],
      category: "dialogue",
      t: "บทพูดบนฉากระเบิดลายตา",
      styleProfile: {
        ownershipMode: "auto",
        source: "auto",
        fill: "#000000",
        outline: "#ffffff",
        hasOutline: false,
        evidenceState: "rejected",
        fallbackReason: "low-readability",
        backgroundLuminance: 128,
        backgroundLuminanceSamples: [0, 255, 0, 255, 0, 255, 0, 255],
        requiresPlateEscalation: true,
      },
    };

    const resolved = resolveBubbleTextStyle(dialogueBubble);
    // Dialogue MUST NEVER have an automatic background plate
    expect(resolved.backgroundPlate).toBeUndefined();
    // Instead, Dialogue gets strongest non-plate candidate and review-required flag
    expect(resolved.hasOutline).toBe(true);
    expect(resolved.reviewRequired).toBe(true);
    expect(dialogueBubble.styleProfile?.ownershipMode).toBe("auto");
  });

  it("NEVER creates automatic background plates for Narration, but marks it reviewRequired", () => {
    const narrationBubble: TranslatedBubble = {
      id: "narration_extreme_chaos",
      box: [50, 50, 150, 300],
      category: "narration",
      t: "กล่องบรรยายบนฉากซับซ้อน",
      styleProfile: {
        ownershipMode: "auto",
        source: "auto",
        fill: "#ffffff",
        outline: "#000000",
        hasOutline: false,
        evidenceState: "rejected",
        fallbackReason: "low-readability",
        backgroundLuminance: 128,
        backgroundLuminanceSamples: [0, 255, 0, 255, 0, 255, 0, 255],
        requiresPlateEscalation: true,
      },
    };

    const resolved = resolveBubbleTextStyle(narrationBubble);
    // Narration MUST NEVER have an automatic background plate
    expect(resolved.backgroundPlate).toBeUndefined();
    // Instead, Narration gets review-required flag
    expect(resolved.hasOutline).toBe(true);
    expect(resolved.reviewRequired).toBe(true);
  });

  it("never forces halo or plate on user Manual styles", () => {
    const manualBubble: TranslatedBubble = {
      id: "manual_user_style",
      box: [200, 200, 400, 400],
      category: "dialogue",
      t: "ผู้ใช้กำหนดเองบนฉากยาก",
      styleProfile: {
        ownershipMode: "manual",
        source: "manual",
        fill: "#ffff00",
        outline: "#ffff00",
        hasOutline: false,
        backgroundLuminance: 128,
        backgroundLuminanceSamples: [0, 255, 0, 255, 0, 255, 0, 255],
      },
    };

    const resolved = resolveBubbleTextStyle(manualBubble);
    expect(resolved.textColor).toBe("#ffff00");
    expect(resolved.hasOutline).toBe(false);
    expect(resolved.backgroundPlate).toBeUndefined();
    expect(resolved.readabilityHalo).toBeUndefined();
    expect(resolved.reviewRequired).toBeFalsy();
    expect(resolved.source).toBe("manual");
  });
});
