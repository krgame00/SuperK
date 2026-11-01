import { describe, expect, it } from "vitest";

import { buildResidueMask } from "@/lib/cleaning/residueMask";

function scene(): {
  source: Uint8ClampedArray;
  clean: Uint8ClampedArray;
  w: number;
  h: number;
} {
  const w = 100;
  const h = 80;
  const source = new Uint8ClampedArray(w * h).fill(245); // white page
  const clean = source.slice();
  // Bubble A: dark text in source, fully cleaned (clean = white).
  for (let y = 20; y < 26; y++) {
    for (let x = 12; x < 44; x++) source[y * w + x] = 30;
  }
  // Bubble B: dark text in source, NOT cleaned (clean identical to source).
  for (let y = 50; y < 56; y++) {
    for (let x = 20; x < 60; x++) {
      source[y * w + x] = 30;
      clean[y * w + x] = 30;
    }
  }
  // Screentone-ish speckle outside any box: tiny dark dots, unchanged.
  for (let y = 70; y < 74; y += 2) {
    for (let x = 70; x < 74; x += 2) {
      source[y * w + x] = 40;
      clean[y * w + x] = 40;
    }
  }
  return { source, clean, w, h };
}

describe("buildResidueMask", () => {
  it("masks only uncleaned dark text inside translated boxes", () => {
    const { source, clean, w, h } = scene();
    const result = buildResidueMask(clean, source, w, h, [[620, 150, 710, 700]]);
    expect(result.components).toBeGreaterThanOrEqual(1);
    expect(result.pixels).toBeGreaterThanOrEqual(36 * 6);
    expect(result.mask[52 * w + 40]).toBe(255); // inside leftover bubble-B text
    expect(result.mask[22 * w + 20]).toBe(0); // bubble-A text was cleaned
    expect(result.mask[71 * w + 71]).toBe(0); // screentone dot outside boxes
  });

  it("ignores screentone-sized specks inside boxes", () => {
    const w = 100;
    const h = 80;
    const source = new Uint8ClampedArray(w * h).fill(245);
    const clean = source.slice();
    source[40 * w + 50] = 30; // single dark pixel, unchanged
    clean[40 * w + 50] = 30;
    const result = buildResidueMask(clean, source, w, h, [[400, 400, 600, 700]]);
    expect(result.pixels).toBe(0);
    expect(result.components).toBe(0);
  });

  it("ignores cleaned pixels even when they were dark in the source", () => {
    const w = 100;
    const h = 80;
    const source = new Uint8ClampedArray(w * h).fill(245);
    const clean = source.slice();
    for (let y = 40; y < 46; y++) {
      for (let x = 40; x < 70; x++) source[y * w + x] = 30; // dark in source
    }
    // clean stays 245 there — cleaning succeeded, so nothing is residue.
    const result = buildResidueMask(clean, source, w, h, [[350, 350, 550, 750]]);
    expect(result.pixels).toBe(0);
  });

  it("skips malformed boxes without throwing", () => {
    const { source, clean, w, h } = scene();
    const result = buildResidueMask(clean, source, w, h, [
      [10, 10] as unknown as [number, number, number, number],
      [620, 150, 710, 700],
      null as unknown as [number, number, number, number],
    ]);
    expect(result.pixels).toBeGreaterThan(200);
  });
});
