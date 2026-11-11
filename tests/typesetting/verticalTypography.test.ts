import { describe, expect, it } from "vitest";
import {
  fitTextVertically,
  isCJKLanguage,
  shouldPreferVerticalTypesetting,
} from "@/lib/typeset/verticalTypography";

describe("Vertical Typography Engine (Tate-chū-gaki / 縦書き)", () => {
  describe("isCJKLanguage", () => {
    it("recognizes Japanese, Chinese, and Korean language identifiers", () => {
      expect(isCJKLanguage("ja")).toBe(true);
      expect(isCJKLanguage("Japanese")).toBe(true);
      expect(isCJKLanguage("zh")).toBe(true);
      expect(isCJKLanguage("ko")).toBe(true);
      expect(isCJKLanguage("th")).toBe(false);
      expect(isCJKLanguage("en")).toBe(false);
      expect(isCJKLanguage(undefined)).toBe(false);
    });
  });

  describe("shouldPreferVerticalTypesetting", () => {
    it("prefers vertical typesetting for tall bubbles in CJK target languages", () => {
      // Tall bubble: Width 100, Height 200 (aspect ratio 2.0 >= 1.35)
      expect(shouldPreferVerticalTypesetting(100, 200, "ja")).toBe(true);
      expect(shouldPreferVerticalTypesetting(100, 200, "zh")).toBe(true);
      // Wide bubble: Width 200, Height 100 (aspect ratio 0.5 < 1.35)
      expect(shouldPreferVerticalTypesetting(200, 100, "ja")).toBe(false);
      // Non-CJK language (Thai) keeps horizontal even for tall bubbles
      expect(shouldPreferVerticalTypesetting(100, 200, "th")).toBe(false);
    });
  });

  describe("fitTextVertically", () => {
    it("typesets text with columns advancing Right-to-Left and glyphs Top-to-Bottom", () => {
      const bubble = {
        x: 50,
        y: 50,
        width: 150,
        height: 300,
        scanlineRatios: [0.9, 0.95, 1.0, 0.95, 0.9],
      };

      // Multi-column vertical Japanese text
      const text = "こんにちは\nさようなら";
      const result = fitTextVertically(text, bubble, 12, 32);

      expect(result.orientation).toBe("vertical");
      expect(result.columns.length).toBeGreaterThanOrEqual(2);

      // In Japanese RTL column progression:
      // Column 0 is to the RIGHT of Column 1 (X_0 > X_1)
      expect(result.columns[0].x).toBeGreaterThan(result.columns[1].x);

      // Glyphs inside Column 0 advance Top-to-Bottom (Y increases)
      const glyphsCol0 = result.columns[0].glyphs;
      expect(glyphsCol0.length).toBeGreaterThan(1);
      for (let i = 1; i < glyphsCol0.length; i++) {
        expect(glyphsCol0[i].y).toBeGreaterThan(glyphsCol0[i - 1].y);
      }
    });

    it("applies 90-degree rotation to prolonged sound marks (ー) and dashes", () => {
      const bubble = {
        x: 10,
        y: 10,
        width: 80,
        height: 250,
        scanlineRatios: [1.0],
      };

      const result = fitTextVertically("コーヒー", bubble, 14, 24);
      expect(result.columns).toHaveLength(1);

      const glyphs = result.columns[0].glyphs;
      // "コ", "ー", "ヒ", "ー"
      expect(glyphs[0].char).toBe("コ");
      expect(glyphs[0].rotateDeg).toBeUndefined();

      expect(glyphs[1].char).toBe("ー");
      expect(glyphs[1].rotateDeg).toBe(90);

      expect(glyphs[3].char).toBe("ー");
      expect(glyphs[3].rotateDeg).toBe(90);
    });

    it("shifts comma and period punctuation to top-right corner", () => {
      const bubble = {
        x: 10,
        y: 10,
        width: 80,
        height: 200,
        scanlineRatios: [1.0],
      };

      const result = fitTextVertically("はい、そうです。", bubble, 12, 20);
      const glyphs = result.columns[0].glyphs;

      // Find comma '、' and period '。'
      const comma = glyphs.find((g) => g.char === "、");
      const period = glyphs.find((g) => g.char === "。");

      expect(comma?.offsetX).toBeGreaterThan(0);
      expect(period?.offsetX).toBeGreaterThan(0);
    });

    it("handles empty or blank string gracefully", () => {
      const bubble = { x: 0, y: 0, width: 100, height: 100, scanlineRatios: [] };
      const result = fitTextVertically("", bubble);
      expect(result.columns).toHaveLength(0);
    });
  });
});
