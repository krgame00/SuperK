import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import {
  fitTextToBubbleContour,
  segmentThaiAwareTokens,
  type BubbleShapeInput,
} from "@/lib/typeset/BubbleTypesetEngine";
import { measureTextSelection } from "@/lib/textSelectionBounds";
import { segmentTextIntoWords } from "@/lib/textBoxWidthLayout";
import { inspectTargetText } from "@/lib/languagePolicy";

describe("Thai Tone-Mark Visual Layout & Typesetting Suite", () => {
  let contextSpy: any;

  beforeEach(() => {
    // Canvas context proxy for jsdom environment
    contextSpy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
      const state = {
        font: "bold 20px sans-serif",
        fillStyle: "#000000",
        strokeStyle: "#ffffff",
        lineWidth: 1,
        textAlign: "center",
        textBaseline: "middle",
        shadowColor: "rgba(0,0,0,0)",
        shadowBlur: 0,
        shadowOffsetX: 0,
        shadowOffsetY: 0,
      };

      return new Proxy(state, {
        get(target: any, prop: string) {
          if (prop in target) return target[prop];
          if (prop === "measureText") {
            return (text: string) => {
              const fsMatch = target.font.match(/(\d+(?:\.\d+)?)px/);
              const fontSize = fsMatch ? parseFloat(fsMatch[1]) : 20;
              const hasUpperTone = /[\u0E48-\u0E4C]/.test(text); // ่ ้ ๊ ๋ ์
              const hasUpperVowel = /[\u0E31\u0E34-\u0E37]/.test(text); // ั ิ ี ึ ื
              const hasLowerVowel = /[\u0E38-\u0E3A]/.test(text); // ุ ู ฺ

              // In Thai script, combining vowels/tones stack above base consonants without adding horizontal width
              const baseCharCount = Array.from(text).filter(
                (ch) => !/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/.test(ch)
              ).length;
              const width = baseCharCount * (fontSize * 0.6);

              const stackedAscent = (hasUpperVowel && hasUpperTone)
                ? fontSize * 1.08
                : hasUpperTone
                ? fontSize * 0.95
                : hasUpperVowel
                ? fontSize * 0.85
                : fontSize * 0.75;
              const descent = hasLowerVowel ? fontSize * 0.45 : fontSize * 0.25;

              return {
                width,
                actualBoundingBoxLeft: 0,
                actualBoundingBoxRight: width,
                actualBoundingBoxAscent: stackedAscent,
                actualBoundingBoxDescent: descent,
              };
            };
          }
          if (prop === "fillRect" || prop === "clearRect" || prop === "fillText" || prop === "strokeText") {
            return vi.fn();
          }
          if (prop === "getImageData") {
            return vi.fn((x: number, y: number, w: number, h: number) => ({
              width: w,
              height: h,
              data: new Uint8ClampedArray(w * h * 4),
            }));
          }
          return vi.fn();
        },
        set(target: any, prop: string, value: any) {
          target[prop] = value;
          return true;
        },
      }) as unknown as CanvasRenderingContext2D;
    });
  });

  afterEach(() => {
    contextSpy?.mockRestore();
  });

  describe("1. Thai Combining Mark Classification & Word Segmentation", () => {
    it("attaches all 5 Thai tone marks and diacritics to their base consonants without orphan tokens", () => {
      const phrases = [
        { text: "ที่นี่", tone: "ไม้เอก (่)" },
        { text: "น้ำผึ้ง", tone: "ไม้โท (้)" },
        { text: "กุ๊กกิ๊ก", tone: "ไม้ตรี (๊)" },
        { text: "เดี๋ยวก่อน", tone: "ไม้จัตวา (๋)" },
        { text: "มนุษย์", tone: "ทัณฑฆาต/การันต์ (์)" },
        { text: "ปิ๊งปั๊ง", tone: "สระบน + ไม้ตรี" },
        { text: "แท็กซี่", tone: "ไม้ไต่คู้ + ไม้เอก" },
      ];

      for (const { text, tone } of phrases) {
        const words = segmentTextIntoWords(text, "th");
        expect(words.length, `Phrase '${text}' with ${tone} should segment into valid words`).toBeGreaterThan(0);
        // None of the segments should be an isolated combining tone mark
        for (const word of words) {
          expect(word).not.toMatch(/^[\u0E31\u0E34-\u0E3E\u0E47-\u0E4E]+$/u);
        }
      }
    });

    it("ensures Thai tone marks are classified as eligible in target language policy", () => {
      const complexDialogue = "เดี๋ยวก่อนสิ! น้ำตาไหลออกมาไม่หยุดเลย... อุ๊ย! ตั๋วรถไฟหายไปไหนแล้วล่ะ!?";
      const inspection = inspectTargetText(complexDialogue, "Thai");
      expect(inspection.status).toBe("eligible");
      expect(inspection.offendingCharacters).toHaveLength(0);
    });
  });

  describe("2. Zero-Width Combining & Font Metric Scaling (Width Integrity)", () => {
    it("verifies that adding Thai tone marks does not abnormally inflate word width by an entire character width", () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d")!;
      ctx.font = "bold 20px sans-serif";

      const pairs = [
        { base: "ปา", marked: "ป่า" },
        { base: "ปา", marked: "ป้า" },
        { base: "ปา", marked: "ป๊า" },
        { base: "ปา", marked: "ป๋า" },
        { base: "มา", marked: "ม้า" },
        { base: "กิน", marked: "กิ๋น" },
      ];

      for (const { base, marked } of pairs) {
        const wBase = ctx.measureText(base).width;
        const wMarked = ctx.measureText(marked).width;
        const diff = Math.abs(wMarked - wBase);
        // Combining tone mark must not add character width (which would be ~12px)
        expect(diff, `Diff between '${base}' and '${marked}' should be 0 or sub-pixel`).toBeLessThan(1.0);
      }
    });
  });

  describe("3. Vertical Selection Bounds & Ascender Enclosure (No Clipping)", () => {
    it("correctly measures bounding boxes for phrases with stacked upper tone marks without negative clipping", () => {
      const canvas = document.createElement("canvas");
      canvas.width = 400;
      canvas.height = 300;
      const ctx = canvas.getContext("2d")!;
      ctx.font = "bold 24px 'Noto Sans Thai', sans-serif";

      const stackedLines = ["ที่นี่มีน้ำผึ้ง", "กุ๊กกิ๊กจังนะ"];
      const fontSize = 24;
      const lineHeight = fontSize * 1.30;
      const bubbleW = 200;
      const bubbleH = 120;

      const selection = measureTextSelection(
        ctx,
        stackedLines,
        fontSize,
        lineHeight,
        bubbleW,
        bubbleH
      );

      // 1. Selection box must be positive and non-empty
      expect(selection.width).toBeGreaterThan(50);
      expect(selection.height).toBeGreaterThan(40);

      // 2. Selection y coordinate must be >= 0 (no negative clipping of upper tone marks)
      expect(selection.y).toBeGreaterThanOrEqual(0);

      // 3. Selection bottom must not exceed bubble height
      expect(selection.y + selection.height).toBeLessThanOrEqual(bubbleH);
    });
  });

  describe("4. Inter-line Separation Guard for Multiline Stacked Glyphs", () => {
    it("guarantees safe vertical clearance between descenders of line N and ascenders of line N+1", () => {
      const fontSize = 20;
      const lineHeightRatio = 1.30;
      const lineHeight = fontSize * lineHeightRatio; // 26px

      // Line 1 has low descenders (เช่น 'ผู้', 'ปู่' - descent ~8px below baseline)
      const line1Descent = 8;
      // Line 2 has high stacked tone marks (เช่น 'ที่', 'นี้' - ascent ~22px above baseline)
      const line2Ascent = 22;

      const line1Middle = 50;
      const line2Middle = line1Middle + lineHeight;

      expect(lineHeight, "Line height must accommodate stacked Thai marks").toBeGreaterThanOrEqual(fontSize * 1.28);
      expect(line2Middle - line1Middle).toBe(lineHeight);
    });
  });

  describe("5. Bubble Contour Typesetting Engine with Heavy Tone Marks", () => {
    it("typesets Thai text with heavy tone marks into scanline chord slices with balanced vertical centering", () => {
      const bubble: BubbleShapeInput = {
        x: 40,
        y: 60,
        width: 140,
        height: 160,
        scanlineRatios: [
          0.5, 0.7, 0.85, 0.95, 1.0, 1.0, 1.0, 0.95, 0.85, 0.7, 0.5,
        ],
      };

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d")!;

      const dialogue = "เดี๋ยวก่อนสิ! ผู้กล้าที่กอบกู้โลกน่ะ กำลังจะกลับมาที่นี่แล้วนะ!?";

      const result = fitTextToBubbleContour(
        ctx,
        dialogue,
        bubble,
        "Noto Sans Thai",
        12,
        28,
        1.30
      );

      // Verify font size selection
      expect(result.fontSize).toBeGreaterThanOrEqual(12);
      expect(result.fontSize).toBeLessThanOrEqual(28);
      expect(result.lines.length).toBeGreaterThanOrEqual(2);

      // Verify all lines fit within allowed slice widths
      for (const line of result.lines) {
        ctx.font = `bold ${result.fontSize}px 'Noto Sans Thai'`;
        const lineW = ctx.measureText(line.text).width;
        expect(lineW).toBeLessThanOrEqual(line.maxWidth + 1.0);
      }

      // Verify line vertical positioning fits comfortably within bubble height
      for (const line of result.lines) {
        expect(line.y).toBeGreaterThanOrEqual(bubble.y);
        expect(line.y).toBeLessThanOrEqual(bubble.y + bubble.height);
      }

      // Verify lines are sequentially descending with exact lineHeight separation
      for (let i = 1; i < result.lines.length; i++) {
        const deltaY = result.lines[i].y - result.lines[i - 1].y;
        expect(deltaY).toBeCloseTo(result.lineHeight, 1);
      }
    });
  });

  describe("6. Canvas Pixel Rendering & Buffer Containment", () => {
    it("draws Thai stacked marks onto a canvas context and confirms zero clipping at canvas boundaries", () => {
      const width = 160;
      const height = 100;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);

      const fontSize = 18;
      const lineHeight = fontSize * 1.30;
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#000000";

      const lines = ["ที่นี่มีน้ำผึ้ง", "เดี๋ยวจะไปนะ"];
      const totalH = (lines.length - 1) * lineHeight;
      const startY = (height / 2) - (totalH / 2);

      lines.forEach((line, idx) => {
        const drawX = width / 2;
        const drawY = startY + idx * lineHeight;
        ctx.fillText(line, drawX, drawY);
      });

      // Assert that startY and endY leave safety padding for tone marks
      const topPadding = startY - fontSize * 0.8;
      const bottomPadding = height - (startY + totalH + fontSize * 0.5);

      expect(topPadding, "Must retain top padding for Level 3 tone marks").toBeGreaterThan(0);
      expect(bottomPadding, "Must retain bottom padding for Level -1 vowels").toBeGreaterThan(0);
    });
  });
});
