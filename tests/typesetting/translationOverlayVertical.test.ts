import { describe, expect, it } from "vitest";
import {
  fitTextVertically,
  isCJKLanguage,
  shouldPreferVerticalTypesetting,
} from "@/lib/translationOverlay";

describe("TranslationOverlay Vertical Typography Integration", () => {
  it("re-exports vertical typography helpers from translationOverlay module", () => {
    expect(typeof fitTextVertically).toBe("function");
    expect(typeof isCJKLanguage).toBe("function");
    expect(typeof shouldPreferVerticalTypesetting).toBe("function");
  });

  it("determines vertical orientation for tall Japanese speech balloons", () => {
    // Tall Japanese speech bubble (H=300, W=120, ratio=2.5) -> should be vertical
    expect(shouldPreferVerticalTypesetting(120, 300, "ja")).toBe(true);

    // Wide Japanese bubble (H=100, W=250, ratio=0.4) -> should be horizontal
    expect(shouldPreferVerticalTypesetting(250, 100, "ja")).toBe(false);

    // Tall Thai bubble (H=300, W=120) -> should be horizontal (Thai is not vertical)
    expect(shouldPreferVerticalTypesetting(120, 300, "th")).toBe(false);
  });

  it("computes vertical layout coordinates for canvas rendering", () => {
    const bubble = {
      x: 0,
      y: 0,
      width: 120,
      height: 350,
      scanlineRatios: [0.95, 1.0, 0.95],
    };
    const result = fitTextVertically("やっぱり…無理だったー！", bubble, 14, 28);

    expect(result.orientation).toBe("vertical");
    expect(result.columns.length).toBeGreaterThanOrEqual(1);

    // Check that glyphs have valid y and rotation coordinates
    const allGlyphs = result.columns.flatMap((c) => c.glyphs);
    expect(allGlyphs.length).toBeGreaterThan(0);

    // Check that '…' or 'ー' receives 90 degree rotation
    const prolonged = allGlyphs.find((g) => g.char === "ー");
    expect(prolonged?.rotateDeg).toBe(90);

    const ellipsis = allGlyphs.find((g) => g.char === "…");
    expect(ellipsis?.rotateDeg).toBe(90);
  });
});
