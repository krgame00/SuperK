import { describe, expect, it } from "vitest";
import { evaluateLocalContrast } from "@/lib/export/readabilityColor";

const pixels = (colors: Array<[number, number, number]>) => ({
  width: colors.length, height: 1,
  rgba: new Uint8ClampedArray(colors.flatMap(([r, g, b]) => [r, g, b, 255])),
});

describe("local translated-text contrast", () => {
  it("warns when a meaningful part of the glyph footprint is below 3:1", () => {
    const background = pixels(Array.from({ length: 20 }, (_, i) => i < 5 ? [0, 0, 0] : [255, 255, 255]));
    expect(evaluateLocalContrast(background, { fill: "#000000" }).state).toBe("warning");
  });

  it("does not warn for a single anomalous pixel or a readable outline", () => {
    const background = pixels(Array.from({ length: 20 }, (_, i) => i === 0 ? [0, 0, 0] : [255, 255, 255]));
    expect(evaluateLocalContrast(background, { fill: "#000000" }).state).toBe("pass");
    const dark = pixels(Array.from({ length: 20 }, () => [0, 0, 0]));
    expect(evaluateLocalContrast(dark, { fill: "#000000", outline: "#ffffff", outlineRatio: 0.08 }).state).toBe("pass");
  });

  it("reports unavailable when background pixels cannot be trusted", () => {
    expect(evaluateLocalContrast(null, { fill: "#ffffff" }).state).toBe("unavailable");
  });
});
