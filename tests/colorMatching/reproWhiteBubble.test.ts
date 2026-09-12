import { describe, it, expect } from "vitest";
import { extractTextColors } from "@/lib/colorMatching/sampleTextColors";
import { resolveBubbleTextStyle } from "@/lib/colorMatching/resolveTextStyle";
import type { ColorSampleRegion } from "@/lib/colorMatching/types";

describe("Reproduction: speech bubble on dark artwork background", () => {
  it("reproduces white bubble inside dark artwork extracting white text instead of black text", () => {
    const width = 100;
    const height = 100;
    const rgba = new Uint8ClampedArray(width * height * 4);

    // Fill with dark background (dark foliage, rgb(30, 45, 30))
    for (let i = 0; i < width * height; i++) {
      rgba[i * 4] = 30;
      rgba[i * 4 + 1] = 45;
      rgba[i * 4 + 2] = 30;
      rgba[i * 4 + 3] = 255;
    }

    // Oval speech bubble: center (50, 50), rx=38, ry=38, filled with white (255, 255, 255)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = (x - 50) / 38;
        const dy = (y - 50) / 38;
        if (dx * dx + dy * dy <= 1.0) {
          const idx = (y * width + x) * 4;
          rgba[idx] = 255;
          rgba[idx + 1] = 255;
          rgba[idx + 2] = 255;
          rgba[idx + 3] = 255;
        }
      }
    }

    // Black text inside speech bubble: x: 45..55, y: 35..65
    for (let y = 35; y <= 65; y++) {
      for (let x = 45; x <= 55; x++) {
        if (x === 50 || y % 5 === 0) {
          const idx = (y * width + x) * 4;
          rgba[idx] = 10;
          rgba[idx + 1] = 10;
          rgba[idx + 2] = 10;
          rgba[idx + 3] = 255;
        }
      }
    }

    const sample: ColorSampleRegion = {
      width,
      height,
      rgba,
    };

    const profile = extractTextColors(sample);
    console.log("Extracted profile for speech bubble on dark artwork:", {
      fill: profile.fill,
      outline: profile.outline,
      hasOutline: profile.hasOutline,
      evidenceState: profile.evidenceState,
      fallbackReason: profile.fallbackReason,
    });

    expect(profile.fill).toBe("#000000");

    const resolved = resolveBubbleTextStyle({
      box: [100, 300, 250, 500],
      t: "เนโร?",
      styleProfile: profile,
    });

    expect(resolved.textColor).toBe("#000000");
  });

  it("handles white speech bubble on dark artwork even if ink count is low (empty/cleaned bubble)", () => {
    const width = 100;
    const height = 100;
    const rgba = new Uint8ClampedArray(width * height * 4);

    // Dark foliage background
    for (let i = 0; i < width * height; i++) {
      rgba[i * 4] = 30;
      rgba[i * 4 + 1] = 45;
      rgba[i * 4 + 2] = 30;
      rgba[i * 4 + 3] = 255;
    }

    // Oval speech bubble: center (50, 50), rx=38, ry=38, filled with white
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = (x - 50) / 38;
        const dy = (y - 50) / 38;
        if (dx * dx + dy * dy <= 1.0) {
          const idx = (y * width + x) * 4;
          rgba[idx] = 255;
          rgba[idx + 1] = 255;
          rgba[idx + 2] = 255;
          rgba[idx + 3] = 255;
        }
      }
    }

    // Only 1 or 2 residual dark pixels (or 0)
    rgba[(50 * width + 50) * 4] = 10;
    rgba[(50 * width + 50) * 4 + 1] = 10;
    rgba[(50 * width + 50) * 4 + 2] = 10;

    const sample: ColorSampleRegion = { width, height, rgba };
    const profile = extractTextColors(sample);

    console.log("Empty/cleaned white bubble profile:", {
      fill: profile.fill,
      outline: profile.outline,
      hasOutline: profile.hasOutline,
    });

    // It must NEVER return white text on a white bubble!
    expect(profile.fill).toBe("#000000");

    const resolved = resolveBubbleTextStyle({
      box: [100, 300, 250, 500],
      t: "เนโร?",
      styleProfile: profile,
    });
    expect(resolved.textColor).not.toBe("#ffffff");
  });
});
