import { describe, it, expect, vi, beforeEach } from "vitest";
import { enrichBubblesWithColorProfiles } from "@/hooks/useTranslation";
import type { TranslatedBubble } from "@/lib/translationOverlay";
import * as monochromeModule from "@/lib/colorMatching/monochromePage";
import * as canvasSamplerModule from "@/lib/colorMatching/canvasSampler";

describe("Monochrome Evidence Enrichment (Task 2)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("analyzes the original page once and attaches isMonochromePage=true to all bubbles on a monochrome page", async () => {
    const analyzeSpy = vi.spyOn(monochromeModule, "analyzeImageElementMonochrome").mockReturnValue({
      isMonochrome: true,
      confidence: 0.96,
      chromaticPixelRatio: 0.001,
      strongChromaticPixelRatio: 0,
      sampledPixelCount: 15000,
    });

    vi.spyOn(canvasSamplerModule, "sampleBubbleRegion").mockReturnValue({
      width: 100,
      height: 100,
      rgba: new Uint8ClampedArray(100 * 100 * 4).fill(255),
    });

    const bubbles: TranslatedBubble[] = [
      { box: [10, 10, 50, 50], t: "Bubble 1", translated: "Bubble 1" },
      { box: [60, 60, 90, 90], t: "Bubble 2", translated: "Bubble 2" },
    ];

    const result = await enrichBubblesWithColorProfiles(bubbles, "data:image/png;base64,dummy");

    expect(analyzeSpy).toHaveBeenCalledTimes(1);
    expect(result[0].styleProfile).toMatchObject({
      isMonochromePage: true,
      monochromeConfidence: 0.96,
    });
    expect(result[1].styleProfile).toMatchObject({
      isMonochromePage: true,
      monochromeConfidence: 0.96,
    });
  });

  it("attaches isMonochromePage=false to bubbles on a color page", async () => {
    vi.spyOn(monochromeModule, "analyzeImageElementMonochrome").mockReturnValue({
      isMonochrome: false,
      confidence: 0.1,
      chromaticPixelRatio: 0.25,
      strongChromaticPixelRatio: 0.08,
      sampledPixelCount: 15000,
    });

    vi.spyOn(canvasSamplerModule, "sampleBubbleRegion").mockReturnValue({
      width: 100,
      height: 100,
      rgba: new Uint8ClampedArray(100 * 100 * 4).fill(255),
    });

    const bubbles: TranslatedBubble[] = [
      { box: [10, 10, 50, 50], t: "Color Bubble", translated: "Color Bubble" },
    ];

    const result = await enrichBubblesWithColorProfiles(bubbles, "data:image/png;base64,dummy");

    expect(result[0].styleProfile).toMatchObject({
      isMonochromePage: false,
    });
  });

  it("does not overwrite manual style profile on a bubble", async () => {
    vi.spyOn(monochromeModule, "analyzeImageElementMonochrome").mockReturnValue({
      isMonochrome: true,
      confidence: 0.99,
      chromaticPixelRatio: 0,
      strongChromaticPixelRatio: 0,
      sampledPixelCount: 15000,
    });

    const bubbles: TranslatedBubble[] = [
      {
        box: [10, 10, 50, 50],
        t: "Manual Bubble",
        translated: "Manual Bubble",
        styleProfile: {
          fill: "#ff0000",
          outline: "#000000",
          source: "manual",
          ownershipMode: "manual",
        },
      },
    ];

    const result = await enrichBubblesWithColorProfiles(bubbles, "data:image/png;base64,dummy");

    expect(result[0].styleProfile?.fill).toBe("#ff0000");
    expect(result[0].styleProfile?.source).toBe("manual");
  });
});
