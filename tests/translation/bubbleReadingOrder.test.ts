import { describe, expect, it } from "vitest";
import {
  extractNormalizedBox,
  sortBubblesRTL,
  assignReadingOrderIndices,
  isRTLReadingOrder,
} from "@/lib/translation/bubbleReadingOrder";

describe("bubbleReadingOrder", () => {
  describe("extractNormalizedBox", () => {
    it("extracts and normalizes valid [ymin, xmin, ymax, xmax] coordinates", () => {
      const box = [100, 200, 300, 600];
      const norm = extractNormalizedBox(box);
      expect(norm).not.toBeNull();
      expect(norm?.top).toBe(100);
      expect(norm?.left).toBe(200);
      expect(norm?.bottom).toBe(300);
      expect(norm?.right).toBe(600);
      expect(norm?.width).toBe(400);
      expect(norm?.height).toBe(200);
      expect(norm?.centerX).toBe(400);
      expect(norm?.centerY).toBe(200);
    });

    it("handles inverted coordinates gracefully", () => {
      const norm = extractNormalizedBox([300, 600, 100, 200]);
      expect(norm).not.toBeNull();
      expect(norm?.top).toBe(100);
      expect(norm?.bottom).toBe(300);
      expect(norm?.left).toBe(200);
      expect(norm?.right).toBe(600);
    });

    it("returns null for non-array or invalid box coordinates", () => {
      expect(extractNormalizedBox(undefined)).toBeNull();
      expect(extractNormalizedBox(null)).toBeNull();
      expect(extractNormalizedBox([])).toBeNull();
      expect(extractNormalizedBox([10, 20, 30])).toBeNull();
      expect(extractNormalizedBox(["a", "b", "c", "d"])).toBeNull();
      expect(extractNormalizedBox([NaN, 10, 20, 30])).toBeNull();
    });
  });

  describe("sortBubblesRTL - Standard Manga Layouts", () => {
    it("sorts single-panel dialogue from Right to Left", () => {
      // Right speaker speaks first, left speaker responds
      const rightSpeaker = { id: "right", box: [100, 600, 250, 850], text: "Right" };
      const leftSpeaker = { id: "left", box: [110, 150, 260, 400], text: "Left" };

      // Input in wrong order (left first)
      const sorted = sortBubblesRTL([leftSpeaker, rightSpeaker]);
      expect(sorted.map((b) => b.id)).toEqual(["right", "left"]);
    });

    it("sorts staggered bubbles correctly where right speaker top is slightly lower than left speaker", () => {
      // Right speaker starts at y=130, Left speaker starts at y=100
      // Because they share the same dialogue tier, Right speaker still speaks first
      const rightSpeaker = { id: "right-staggered", box: [130, 600, 280, 850] };
      const leftSpeaker = { id: "left-higher", box: [100, 150, 250, 400] };

      const sorted = sortBubblesRTL([leftSpeaker, rightSpeaker]);
      expect(sorted.map((b) => b.id)).toEqual(["right-staggered", "left-higher"]);
    });

    it("sorts vertically stacked bubbles for the same character from top to bottom before moving left", () => {
      // Character on right has 2 stacked bubbles: top line and follow-up line
      // Character on left replies
      const rightTop = { id: "r1", box: [50, 600, 120, 800] };
      const rightBottom = { id: "r2", box: [140, 600, 210, 800] };
      const leftReply = { id: "left", box: [80, 100, 200, 300] };

      const sorted = sortBubblesRTL([leftReply, rightBottom, rightTop]);
      expect(sorted.map((b) => b.id)).toEqual(["r1", "r2", "left"]);
    });

    it("sorts multi-panel 2x2 manga page (Top-Right -> Top-Left -> Bottom-Right -> Bottom-Left)", () => {
      const topPanelRight = { id: "TR", box: [50, 550, 150, 850] };
      const topPanelLeft = { id: "TL", box: [50, 100, 150, 400] };
      const bottomPanelRight = { id: "BR", box: [550, 550, 650, 850] };
      const bottomPanelLeft = { id: "BL", box: [550, 100, 650, 400] };

      // Shuffle order
      const input = [bottomPanelLeft, topPanelLeft, bottomPanelRight, topPanelRight];
      const sorted = sortBubblesRTL(input);

      expect(sorted.map((b) => b.id)).toEqual(["TR", "TL", "BR", "BL"]);
    });

    it("sorts 4-koma style vertical column from top to bottom", () => {
      const p1 = { id: "koma1", box: [50, 200, 200, 800] };
      const p2 = { id: "koma2", box: [250, 200, 400, 800] };
      const p3 = { id: "koma3", box: [450, 200, 600, 800] };
      const p4 = { id: "koma4", box: [650, 200, 800, 800] };

      const sorted = sortBubblesRTL([p3, p1, p4, p2]);
      expect(sorted.map((b) => b.id)).toEqual(["koma1", "koma2", "koma3", "koma4"]);
    });

    it("sorts a 3-tier 6-panel full-page layout in canonical manga flow", () => {
      // Tier 1 (top): Right and Left
      const t1r = { id: "t1-right", box: [40, 520, 180, 950] };
      const t1l = { id: "t1-left", box: [50, 50, 190, 480] };
      // Tier 2 (middle): Right and Left
      const t2r = { id: "t2-right", box: [350, 520, 480, 950] };
      const t2l = { id: "t2-left", box: [360, 50, 490, 480] };
      // Tier 3 (bottom): Right and Left
      const t3r = { id: "t3-right", box: [700, 520, 850, 950] };
      const t3l = { id: "t3-left", box: [710, 50, 860, 480] };

      const scrambled = [t3l, t1l, t2r, t3r, t1r, t2l];
      const sorted = sortBubblesRTL(scrambled);

      expect(sorted.map((b) => b.id)).toEqual([
        "t1-right",
        "t1-left",
        "t2-right",
        "t2-left",
        "t3-right",
        "t3-left",
      ]);
    });

    it("sorts 3 distinct speakers across a single wide panel from right to left", () => {
      const right = { id: "spk-right", box: [100, 700, 250, 900] };
      const center = { id: "spk-center", box: [110, 400, 260, 600] };
      const left = { id: "spk-left", box: [105, 100, 255, 300] };

      const sorted = sortBubblesRTL([center, left, right]);
      expect(sorted.map((b) => b.id)).toEqual(["spk-right", "spk-center", "spk-left"]);
    });

    it("maintains stable sorting order for identical coordinates", () => {
      const b1 = { id: "first", box: [100, 500, 200, 700] };
      const b2 = { id: "second", box: [100, 500, 200, 700] };

      const sorted = sortBubblesRTL([b1, b2]);
      expect(sorted.map((b) => b.id)).toEqual(["first", "second"]);
    });
  });

  describe("sortBubblesRTL - Edge Cases & Resilience", () => {
    it("handles empty array", () => {
      expect(sortBubblesRTL([])).toEqual([]);
    });

    it("handles single bubble", () => {
      const single = [{ id: "one", box: [100, 100, 200, 200] }];
      expect(sortBubblesRTL(single)).toEqual(single);
    });

    it("places bubbles without box at the end while preserving their relative order", () => {
      const b1 = { id: "valid-right", box: [100, 700, 200, 900] };
      const b2 = { id: "no-box-1" };
      const b3 = { id: "valid-left", box: [100, 100, 200, 300] };
      const b4 = { id: "no-box-2", box: [] };

      const sorted = sortBubblesRTL([b2, b3, b4, b1]);
      expect(sorted.map((b) => b.id)).toEqual([
        "valid-right",
        "valid-left",
        "no-box-1",
        "no-box-2",
      ]);
    });

    it("preserves original array immutability", () => {
      const original = [
        { id: "b", box: [100, 100, 200, 200] },
        { id: "a", box: [100, 700, 200, 800] },
      ];
      const copy = [...original];
      const sorted = sortBubblesRTL(original);

      expect(original).toEqual(copy);
      expect(sorted).not.toBe(original);
      expect(sorted[0].id).toBe("a");
    });

    it("supports LTR reading direction for western comics", () => {
      const left = { id: "left", box: [100, 150, 250, 400] };
      const right = { id: "right", box: [100, 600, 250, 850] };

      const sorted = sortBubblesRTL([right, left], { direction: "ltr" });
      expect(sorted.map((b) => b.id)).toEqual(["left", "right"]);
    });
  });

  describe("assignReadingOrderIndices", () => {
    it("assigns 1-based sequential readingOrder property matching RTL flow", () => {
      const tr = { id: "TR", box: [50, 600, 150, 800] };
      const tl = { id: "TL", box: [50, 100, 150, 300] };
      const br = { id: "BR", box: [500, 600, 600, 800] };

      const indexed = assignReadingOrderIndices([tl, br, tr]);
      expect(indexed.map((b) => ({ id: b.id, order: b.readingOrder }))).toEqual([
        { id: "TR", order: 1 },
        { id: "TL", order: 2 },
        { id: "BR", order: 3 },
      ]);
    });
  });

  describe("isRTLReadingOrder", () => {
    it("identifies whether bubble sequence is already sorted in RTL order", () => {
      const tr = { id: "TR", box: [50, 600, 150, 800] };
      const tl = { id: "TL", box: [50, 100, 150, 300] };

      expect(isRTLReadingOrder([tr, tl])).toBe(true);
      expect(isRTLReadingOrder([tl, tr])).toBe(false);
    });
  });
});
