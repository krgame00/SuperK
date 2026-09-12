import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ColorMatchStatus } from "@/components/colorMatching/ColorMatchStatus";
import { resolveBubbleTextStyle, preserveManualStyleProfiles } from "@/lib/colorMatching/resolveTextStyle";
import type { TranslatedBubble } from "@/lib/translationOverlay";
import type { TextStyleProfile } from "@/lib/colorMatching/types";

describe("Ticket 11: Auto / Readable / Manual Style Ownership UX", () => {
  describe("Ownership Mode Resolution Semantics", () => {
    it("preserves ownershipMode: 'auto' when falling back, communicating Auto -> Readable fallback", () => {
      const profile: TextStyleProfile = {
        fill: "#8c5028", // floor color
        outline: "#8c5028",
        source: "fallback",
        ownershipMode: "auto",
        evidenceState: "rejected",
        fallbackReason: "background-contamination",
        category: "overlay_subtitle",
        fillConfidence: 0.90,
      };

      const bubble: TranslatedBubble = {
        box: [800, 100, 860, 600],
        category: "overlay_subtitle",
        styleProfile: profile,
      };

      const resolved = resolveBubbleTextStyle(bubble);
      // Resolved to safe readable style
      expect(resolved.textColor).toBe("#ffffff");
      expect(resolved.textOutline).toBe("#000000");
      expect(resolved.source).toBe("fallback");
      // Ownership mode in profile is still 'auto'
      expect(profile.ownershipMode).toBe("auto");
    });

    it("applies category-appropriate readable style when ownershipMode: 'readable' is explicitly selected", () => {
      const readableProfile: TextStyleProfile = {
        fill: "#ffffff",
        outline: "#000000",
        hasOutline: true,
        ownershipMode: "readable",
        source: "fallback",
        category: "overlay_subtitle",
      };

      const bubble: TranslatedBubble = {
        box: [800, 100, 860, 600],
        category: "overlay_subtitle",
        styleProfile: readableProfile,
      };

      const resolved = resolveBubbleTextStyle(bubble);
      expect(resolved.textColor).toBe("#ffffff");
      expect(resolved.textOutline).toBe("#000000");
      expect(resolved.hasOutline).toBe(true);
      expect(resolved.source).toBe("fallback");
    });

    it("respects ownershipMode: 'manual' even if contrast is low, without automatic rewriting", () => {
      const manualProfile: TextStyleProfile = {
        fill: "#555555",
        outline: "#555555",
        hasOutline: false, // Low contrast / no outline chosen by user
        ownershipMode: "manual",
        source: "manual",
        category: "overlay_subtitle",
      };

      const bubble: TranslatedBubble = {
        box: [800, 100, 860, 600],
        category: "overlay_subtitle",
        styleProfile: manualProfile,
      };

      const resolved = resolveBubbleTextStyle(bubble);
      // Manual style MUST NOT be rewritten!
      expect(resolved.textColor).toBe("#555555");
      expect(resolved.hasOutline).toBe(false);
      expect(resolved.source).toBe("manual");
    });

    it("preserves both manual and readable ownership profiles across re-translation", () => {
      const previousBubbles: TranslatedBubble[] = [
        {
          id: "b1",
          box: [100, 100, 200, 200],
          original_text: "こんにちは",
          t: "สวัสดี",
          styleProfile: {
            fill: "#ff0000",
            outline: "#ffffff",
            hasOutline: true,
            ownershipMode: "manual",
            source: "manual",
          },
        },
        {
          id: "b2",
          box: [800, 100, 860, 600],
          original_text: "字幕テキスト",
          t: "ข้อความซับ",
          styleProfile: {
            fill: "#ffffff",
            outline: "#000000",
            hasOutline: true,
            ownershipMode: "readable",
            source: "fallback",
            category: "overlay_subtitle",
          },
        },
      ];

      const nextBubbles: TranslatedBubble[] = [
        {
          id: "b1",
          box: [100, 100, 200, 200],
          original_text: "こんにちは",
          t: "สวัสดีครับผม (คำแปลใหม่)",
        },
        {
          id: "b2",
          box: [800, 100, 860, 600],
          original_text: "字幕テキスト",
          t: "ข้อความซับใหม่",
        },
      ];

      const preserved = preserveManualStyleProfiles(nextBubbles, previousBubbles);
      expect(preserved[0].styleProfile?.ownershipMode).toBe("manual");
      expect(preserved[0].styleProfile?.fill).toBe("#ff0000");
      expect(preserved[1].styleProfile?.ownershipMode).toBe("readable");
      expect(preserved[1].styleProfile?.fill).toBe("#ffffff");
    });
  });

  describe("UI Display & Explanations (ColorMatchStatus)", () => {
    it("communicates Auto -> Readable fallback with background contamination reason", () => {
      render(
        <ColorMatchStatus
          profile={{
            fill: "#ffffff",
            outline: "#000000",
            source: "fallback",
            ownershipMode: "auto",
            evidenceState: "rejected",
            fallbackReason: "background-contamination",
            fillConfidence: 0.85,
          }}
        />,
      );

      expect(screen.getByText(/Auto → สีอ่านง่าย/)).toBeInTheDocument();
      expect(screen.getByText(/ตรวจพบสีพื้นหลังปนเปื้อน/)).toBeInTheDocument();
    });

    it("communicates Auto -> Readable fallback with insufficient evidence reason", () => {
      render(
        <ColorMatchStatus
          profile={{
            fill: "#ffffff",
            outline: "#000000",
            source: "fallback",
            ownershipMode: "auto",
            evidenceState: "rejected",
            fallbackReason: "insufficient-evidence",
            fillConfidence: 0.40,
          }}
        />,
      );

      expect(screen.getByText(/Auto → สีอ่านง่าย/)).toBeInTheDocument();
      expect(screen.getByText(/หลักฐานสีไม่เพียงพอ/)).toBeInTheDocument();
    });

    it("provides explicit mode selection buttons and allows switching to Auto, Readable, or Manual", () => {
      const onSelectMode = vi.fn();
      render(
        <ColorMatchStatus
          profile={{
            fill: "#ff2a85",
            outline: "#ffffff",
            source: "auto",
            ownershipMode: "auto",
            fillConfidence: 0.95,
          }}
          onSelectMode={onSelectMode}
        />,
      );

      const readableBtn = screen.getByRole("button", { name: /ใช้สีอ่านง่าย/i });
      fireEvent.click(readableBtn);
      expect(onSelectMode).toHaveBeenCalledWith("readable");
    });

    it("allows resetting Manual style back to Auto", () => {
      const onSelectMode = vi.fn();
      render(
        <ColorMatchStatus
          profile={{
            fill: "#123456",
            outline: "#ffffff",
            source: "manual",
            ownershipMode: "manual",
          }}
          onSelectMode={onSelectMode}
        />,
      );

      const autoBtn = screen.getByRole("button", { name: /คืนค่า Auto/i });
      fireEvent.click(autoBtn);
      expect(onSelectMode).toHaveBeenCalledWith("auto");
    });
  });
});
