import { describe, expect, it } from "vitest";

import { buildResidueMask, type PromilleBox } from "@/lib/cleaning/residueMask";

function lumaWithText(): { luma: Uint8ClampedArray; w: number; h: number } {
  const w = 100;
  const h = 80;
  const luma = new Uint8ClampedArray(w * h).fill(245); // white bubble background
  // Dark "text" strokes inside box A (bubble at top-left quadrant).
  for (let y = 20; y < 24; y++) {
    for (let x = 12; x < 40; x++) {
      luma[y * w + x] = 30;
    }
  }
  return { luma, w, h };
}

describe("buildResidueMask", () => {
  it("masks leftover glyphs inside translated bubble boxes", () => {
    const { luma, w, h } = lumaWithText();
    const result = buildResidueMask(luma, w, h, [[150, 80, 400, 550]]);
    expect(result.pixels).toBeGreaterThan(80);
    expect(result.ink[22 * w + 20]).toBe(255); // inside the stroke
    expect(result.ink[5 * w + 5]).toBe(0); // outside any box
  });

  it("ignores boxes whose leftover ink is below minInkPixels", () => {
    const luma = new Uint8ClampedArray(100 * 80).fill(245);
    luma[40 * 100 + 50] = 30; // single dark pixel — noise, not text
    const result = buildResidueMask(luma, 100, 80, [[300, 400, 600, 700]]);
    expect(result.pixels).toBe(1);
    expect(result.boxesUsed).toBe(0);
  });

  it("returns an empty mask when everything is already clean", () => {
    const luma = new Uint8ClampedArray(100 * 80).fill(245);
    const result = buildResidueMask(luma, 100, 80, [[150, 80, 400, 550]]);
    expect(result.pixels).toBe(0);
    expect(result.boxesUsed).toBe(0);
  });

  it("skips malformed boxes without throwing", () => {
    const { luma, w, h } = lumaWithText();
    const result = buildResidueMask(luma, w, h, [
      [10, 10] as unknown as PromilleBox,
      [150, 80, 400, 550],
      null as unknown as PromilleBox,
    ]);
    expect(result.pixels).toBeGreaterThan(80);
  });
});
