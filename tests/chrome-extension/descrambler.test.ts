import { describe, expect, it } from "vitest";
import {
  computePermutationFromSeed,
  computeRemainderPadding,
  generateTileMappings,
  invertPermutation,
  isKnownScrambledDomain,
} from "../../lib/extension/descrambler";

describe("Image De-scrambler Engine (Blueprint Module 1)", () => {
  it("calculates exact block size and remainder edge padding", () => {
    // Non-divisible: 803 x 1205 on 4x4 grid (803 = 200*4 + 3; 1205 = 301*4 + 1)
    const pad = computeRemainderPadding(803, 1205, 4, 4);
    expect(pad.blockW).toBe(200);
    expect(pad.blockH).toBe(301);
    expect(pad.rw).toBe(3);
    expect(pad.rh).toBe(1);

    // Divisible: 800 x 1200
    const exact = computeRemainderPadding(800, 1200, 4, 4);
    expect(exact.blockW).toBe(200);
    expect(exact.blockH).toBe(300);
    expect(exact.rw).toBe(0);
    expect(exact.rh).toBe(0);
  });

  it("computes and inverts linear congruential seed permutations", () => {
    // 4x4 grid = 16 tiles
    const perm = computePermutationFromSeed(4, 4, 5, 3);
    expect(perm.length).toBe(16);
    // Unique permutation of all 16 integers
    const unique = new Set(perm);
    expect(unique.size).toBe(16);

    // Inversion
    const inv = invertPermutation(perm);
    for (let i = 0; i < 16; i++) {
      expect(inv[perm[i]]).toBe(i);
    }
  });

  it("generates 16 tiles plus 3 remainder padding strips for non-divisible dimensions", () => {
    const mappings = generateTileMappings(803, 1205, {
      grid: { cols: 4, rows: 4 },
      seedKey: { k: 5, c: 0 },
    });

    // 16 main grid tiles + 1 right strip + 1 bottom strip + 1 corner
    expect(mappings.length).toBe(19);

    // Every slice must be within 803 x 1205
    for (const m of mappings) {
      expect(m.srcX + m.width).toBeLessThanOrEqual(803);
      expect(m.srcY + m.height).toBeLessThanOrEqual(1205);
      expect(m.dstX + m.width).toBeLessThanOrEqual(803);
      expect(m.dstY + m.height).toBeLessThanOrEqual(1205);
    }

    // Check right strip remainder (width=3, height=1204)
    const rightStrip = mappings.find(m => m.width === 3 && m.height === 1204);
    expect(rightStrip).toBeDefined();
    expect(rightStrip?.srcX).toBe(800);
    expect(rightStrip?.dstX).toBe(800);

    // Check bottom strip remainder (width=800, height=1)
    const bottomStrip = mappings.find(m => m.width === 800 && m.height === 1);
    expect(bottomStrip).toBeDefined();
    expect(bottomStrip?.srcY).toBe(1204);
    expect(bottomStrip?.dstY).toBe(1204);

    // Check corner piece (width=3, height=1)
    const corner = mappings.find(m => m.width === 3 && m.height === 1);
    expect(corner).toBeDefined();
    expect(corner?.srcX).toBe(800);
    expect(corner?.srcY).toBe(1204);
  });

  it("detects known GigaViewer and scrambled manga domains", () => {
    expect(isKnownScrambledDomain("https://shonenjumpplus.com/episode/123")).toBe(true);
    expect(isKnownScrambledDomain("https://comic-days.com/episode/456")).toBe(true);
    expect(isKnownScrambledDomain("https://bookwalker.jp/series/789")).toBe(true);
    expect(isKnownScrambledDomain("https://example.com/test.png")).toBe(false);
  });
});
