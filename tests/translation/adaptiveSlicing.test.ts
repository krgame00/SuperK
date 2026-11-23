import { describe, expect, test, vi } from "vitest";
import {
  createInitialAdaptiveSlices,
  subdivideSlice,
  remapSliceBubbleToPage,
  deduplicateSliceBubbles,
  runAdaptiveSlicing,
  type AdaptiveSlice,
  type SliceTranslator,
} from "../../lib/translation/adaptiveSlicing";
import type { TranslatedBubble } from "../../lib/overlay/overlayTypes";

describe("Adaptive Slicing (Phase 3)", () => {
  const PAGE_WIDTH = 1000;
  const PAGE_HEIGHT = 1600;

  describe("createInitialAdaptiveSlices", () => {
    test("creates exactly 2 horizontal slices covering the page with overlap", () => {
      const slices = createInitialAdaptiveSlices(PAGE_WIDTH, PAGE_HEIGHT, 0.15);
      expect(slices).toHaveLength(2);

      const [top, bottom] = slices;
      expect(top.id).toBe("L1-top");
      expect(top.depth).toBe(1);
      expect(top.sx).toBe(0);
      expect(top.sy).toBe(0);
      expect(top.sWidth).toBe(PAGE_WIDTH);
      // Top slice height: H/2 + 15% overlap
      expect(top.sHeight).toBe(800 + 120);

      expect(bottom.id).toBe("L1-bottom");
      expect(bottom.depth).toBe(1);
      expect(bottom.sx).toBe(0);
      // Bottom slice sy: H/2 - 15% overlap
      expect(bottom.sy).toBe(800 - 120);
      expect(bottom.sWidth).toBe(PAGE_WIDTH);
      expect(bottom.sy + bottom.sHeight).toBe(PAGE_HEIGHT);
    });
  });

  describe("subdivideSlice", () => {
    test("subdivides a Level 1 slice into 2 vertical columns at depth 2", () => {
      const [top] = createInitialAdaptiveSlices(PAGE_WIDTH, PAGE_HEIGHT, 0.15);
      const subSlices = subdivideSlice(top, 0.15);

      expect(subSlices).toHaveLength(2);
      const [left, right] = subSlices;

      expect(left.id).toBe("L1-top-left");
      expect(left.depth).toBe(2);
      expect(left.sx).toBe(0);
      expect(left.sy).toBe(top.sy);
      expect(left.sWidth).toBe(500 + 75); // W/2 + 15% overlap
      expect(left.sHeight).toBe(top.sHeight);

      expect(right.id).toBe("L1-top-right");
      expect(right.depth).toBe(2);
      expect(right.sx).toBe(500 - 75);
      expect(right.sy).toBe(top.sy);
      expect(right.sx + right.sWidth).toBe(PAGE_WIDTH);
      expect(right.sHeight).toBe(top.sHeight);
    });

    test("returns empty array when slice depth has reached max depth (2)", () => {
      const [top] = createInitialAdaptiveSlices(PAGE_WIDTH, PAGE_HEIGHT);
      const subSlices = subdivideSlice(top);
      const deepSubSlices = subdivideSlice(subSlices[0]);
      expect(deepSubSlices).toEqual([]);
    });
  });

  describe("remapSliceBubbleToPage", () => {
    test("accurately maps local normalized coordinates to global page coordinates", () => {
      const [top, bottom] = createInitialAdaptiveSlices(PAGE_WIDTH, PAGE_HEIGHT, 0);

      // Bubble centered in top half: [400, 400, 600, 600] in slice space
      const localBubble: TranslatedBubble = {
        box: [400, 400, 600, 600],
        text: "Top text",
      };

      const remappedTop = remapSliceBubbleToPage(localBubble, top);
      // In top half (height 800 of 1600):
      // ymin = 0.4 * 800 = 320px -> 320/1600 * 1000 = 200
      // ymax = 0.6 * 800 = 480px -> 480/1600 * 1000 = 300
      expect(remappedTop.box![0]).toBe(200);
      expect(remappedTop.box![1]).toBe(400);
      expect(remappedTop.box![2]).toBe(300);
      expect(remappedTop.box![3]).toBe(600);

      // Bubble centered in bottom half
      const remappedBottom = remapSliceBubbleToPage(localBubble, bottom);
      // In bottom half (sy = 800, height 800):
      // ymin = 800 + 0.4 * 800 = 1120px -> 1120/1600 * 1000 = 700
      // ymax = 800 + 0.6 * 800 = 1280px -> 1280/1600 * 1000 = 800
      expect(remappedBottom.box![0]).toBe(700);
      expect(remappedBottom.box![1]).toBe(400);
      expect(remappedBottom.box![2]).toBe(800);
      expect(remappedBottom.box![3]).toBe(600);
    });

    test("handles full-slice invalid boxes by shrinking them to centered patch", () => {
      const [top] = createInitialAdaptiveSlices(PAGE_WIDTH, PAGE_HEIGHT, 0);
      const invalidBubble: TranslatedBubble = {
        box: [0, 0, 1000, 1000],
        text: "Malformed box",
      };

      const remapped = remapSliceBubbleToPage(invalidBubble, top);
      expect(remapped.isInvalidBox).toBe(true);
      // Centered patch [400, 400, 600, 600] remapped into top half
      expect(remapped.box).toBeDefined();
      expect(remapped.box![0]).toBeGreaterThan(0);
      expect(remapped.box![2]).toBeLessThan(1000);
    });
  });

  describe("deduplicateSliceBubbles", () => {
    test("removes duplicate bubbles in overlap zone based on IoU and containment", () => {
      const existing: TranslatedBubble[] = [
        {
          box: [200, 200, 300, 400],
          text: "Existing text",
        },
      ];

      const incoming: TranslatedBubble[] = [
        {
          box: [205, 205, 302, 398], // High IoU duplicate
          text: "Duplicate text",
        },
        {
          box: [700, 700, 800, 900], // Distinct bubble
          text: "Unique text",
        },
      ];

      const result = deduplicateSliceBubbles(existing, incoming);
      expect(result).toHaveLength(2);
      expect(result[0].text).toBe("Existing text");
      expect(result[1].text).toBe("Unique text");
    });
  });

  describe("runAdaptiveSlicing workflow", () => {
    test("Clean page: both Level 1 slices succeed -> exactly 2 calls made", async () => {
      const translator: SliceTranslator = vi.fn().mockImplementation(async (slice: AdaptiveSlice) => {
        return {
          ok: true,
          bubbles: [
            {
              box: [100, 100, 200, 200],
              text: `Bubble in ${slice.id}`,
            },
          ],
        };
      });

      const result = await runAdaptiveSlicing({
        pageWidth: PAGE_WIDTH,
        pageHeight: PAGE_HEIGHT,
        translator,
      });

      expect(translator).toHaveBeenCalledTimes(2);
      expect(result.totalCalls).toBe(2);
      expect(result.bubbles).toHaveLength(2);
    });

    test("Single blocked region: Top passes, Bottom blocked -> subdivides Bottom, <= 4 calls", async () => {
      const translator: SliceTranslator = vi.fn().mockImplementation(async (slice: AdaptiveSlice) => {
        if (slice.id === "L1-top") {
          return {
            ok: true,
            bubbles: [{ box: [100, 100, 200, 200], text: "Top bubble" }],
          };
        }
        if (slice.id === "L1-bottom") {
          // Blocked by safety
          return { ok: false, isBlockedOrEmpty: true, bubbles: [] };
        }
        if (slice.id === "L1-bottom-left") {
          return {
            ok: true,
            bubbles: [{ box: [100, 100, 200, 200], text: "Bottom left bubble" }],
          };
        }
        if (slice.id === "L1-bottom-right") {
          // Still blocked by suggestive art on bottom right
          return { ok: false, isBlockedOrEmpty: true, bubbles: [] };
        }
        return { ok: true, bubbles: [] };
      });

      const result = await runAdaptiveSlicing({
        pageWidth: PAGE_WIDTH,
        pageHeight: PAGE_HEIGHT,
        translator,
      });

      // Level 1: 2 calls (L1-top, L1-bottom)
      // Level 2: 2 calls (L1-bottom-left, L1-bottom-right)
      // Total calls = 4 (much cheaper than 6 calls in fixed 3x2 grid!)
      expect(translator).toHaveBeenCalledTimes(4);
      expect(result.totalCalls).toBe(4);
      expect(result.bubbles).toHaveLength(2);
      expect(result.bubbles.map((b) => b.text)).toContain("Top bubble");
      expect(result.bubbles.map((b) => b.text)).toContain("Bottom left bubble");
    });

    test("Fully blocked page: capped at max 6 calls", async () => {
      const translator: SliceTranslator = vi.fn().mockImplementation(async () => {
        // Everything blocked
        return { ok: false, isBlockedOrEmpty: true, bubbles: [] };
      });

      const result = await runAdaptiveSlicing({
        pageWidth: PAGE_WIDTH,
        pageHeight: PAGE_HEIGHT,
        translator,
      });

      // Level 1: 2 calls
      // Level 2: 4 calls (2 from top, 2 from bottom)
      // Total calls = 6 (capped at maxTotalSlices)
      expect(translator).toHaveBeenCalledTimes(6);
      expect(result.totalCalls).toBe(6);
      expect(result.bubbles).toHaveLength(0);
    });
  });
});
