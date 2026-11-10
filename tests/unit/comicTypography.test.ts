import { describe, expect, it } from "vitest";
import {
  calculateDynamicStrokeWidth,
  classifyPolygonGeometry,
  resolveCategoryTypography,
} from "../../lib/typography/comicTypography";

describe("comicTypography Engine (Blueprint Module 3)", () => {
  it("calculates authentic dynamic stroke width per Htext / 12", () => {
    // Sw = max(1.5, floor(Htext / 12)) px
    expect(calculateDynamicStrokeWidth(12)).toBe(1.5);
    expect(calculateDynamicStrokeWidth(24)).toBe(2);
    expect(calculateDynamicStrokeWidth(36)).toBe(3);
    // Adjusted by shouting multiplier (1.35x)
    expect(calculateDynamicStrokeWidth(36, 1.35)).toBe(4.1);
  });

  it("resolves shouting bubble typography with auto Bulge warp", () => {
    const rules = resolveCategoryTypography("shouting", 24);
    expect(rules.category).toBe("shouting");
    expect(rules.fontWeight).toBe("800");
    expect(rules.fontStyle).toBe("normal");
    expect(rules.warpConfig).toEqual({ type: "bulge", bend: 0.35 });
    expect(rules.dynamicStrokeWidth).toBeGreaterThan(calculateDynamicStrokeWidth(24));
  });

  it("preserves user explicit warp over default bulge for shouting", () => {
    const rules = resolveCategoryTypography("shouting", 24, { type: "wave", bend: 0.5 });
    expect(rules.warpConfig).toEqual({ type: "wave", bend: 0.5 });
  });

  it("resolves thought bubble typography with italic font style and soft stroke", () => {
    const rules = resolveCategoryTypography("thought", 24);
    expect(rules.category).toBe("thought");
    expect(rules.fontStyle).toBe("italic");
    expect(rules.fontWeight).toBe("400");
    expect(rules.warpConfig).toBeUndefined();
    expect(rules.dynamicStrokeWidth).toBeLessThanOrEqual(calculateDynamicStrokeWidth(24));
  });

  it("resolves narration rectangle typography with formal sans/serif", () => {
    const rules = resolveCategoryTypography("narration", 20);
    expect(rules.category).toBe("narration");
    expect(rules.fontWeight).toBe("500");
    expect(rules.fontStyle).toBe("normal");
    expect(rules.fontFamilyFallback).toBe("Sarabun, sans-serif");
  });

  it("classifies pure polygon shapes client-side accurately", () => {
    // 1. Rectangle
    const rectPoly: Array<[number, number]> = [
      [10, 10],
      [110, 10],
      [110, 60],
      [10, 60],
    ];
    const rectRes = classifyPolygonGeometry(rectPoly);
    expect(rectRes.category).toBe("narration");
    expect(rectRes.extent).toBeCloseTo(1.0, 1);

    // 2. Starburst (low Q < 0.50)
    const starPoly: Array<[number, number]> = [];
    const center = [100, 100];
    for (let i = 0; i < 20; i++) {
      const angle = (i * Math.PI) / 10;
      const r = i % 2 === 0 ? 80 : 25;
      starPoly.push([center[0] + r * Math.cos(angle), center[1] + r * Math.sin(angle)]);
    }
    const starRes = classifyPolygonGeometry(starPoly);
    expect(starRes.category).toBe("shouting");
    expect(starRes.q).toBeLessThan(0.50);

    // 3. Circle / Oval
    const circlePoly: Array<[number, number]> = [];
    for (let i = 0; i < 32; i++) {
      const angle = (i * 2 * Math.PI) / 32;
      circlePoly.push([center[0] + 50 * Math.cos(angle), center[1] + 50 * Math.sin(angle)]);
    }
    const circleRes = classifyPolygonGeometry(circlePoly);
    expect(circleRes.category).toBe("normal");
    expect(circleRes.q).toBeGreaterThan(0.70);
  });
});
