import { describe, expect, it } from "vitest";
import { clampToViewport } from "@/lib/layout/viewportClamp";

describe("clampToViewport", () => {
  it("clamps top boundary below headerOffset", () => {
    const clamped = clampToViewport({
      targetY: 0,
      elementHeight: 40,
      viewportHeight: 800,
      headerOffset: 64,
      bottomOffset: 80,
    });
    // minY = 64 + 8 = 72
    expect(clamped).toBe(72);
  });

  it("clamps bottom boundary above bottomOffset", () => {
    const clamped = clampToViewport({
      targetY: 2000,
      elementHeight: 50,
      viewportHeight: 900,
      headerOffset: 64,
      bottomOffset: 80,
    });
    // maxY = 900 - 80 - 50 - 8 = 762
    expect(clamped).toBe(762);
  });

  it("preserves targetY when comfortably inside bounds", () => {
    const clamped = clampToViewport({
      targetY: 300,
      elementHeight: 50,
      viewportHeight: 900,
      headerOffset: 64,
      bottomOffset: 80,
    });
    expect(clamped).toBe(300);
  });

  it("handles small viewports safely without inverted bounds", () => {
    const clamped = clampToViewport({
      targetY: 100,
      elementHeight: 100,
      viewportHeight: 150,
      headerOffset: 64,
      bottomOffset: 80,
    });
    // Clamps to at least minY (72)
    expect(clamped).toBe(72);
  });
});
