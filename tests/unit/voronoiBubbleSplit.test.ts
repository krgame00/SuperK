import { describe, expect, it } from "vitest";
import {
  computeVoronoiBisector,
  clipRectByVoronoiPlane,
  isDoubleBubblePair,
  splitConjoinedPairVoronoi,
  splitDoubleBubble,
  splitSingleDoubleBubble,
  generateVoronoiScanlineRatios,
  type BoundingBoxRect,
  type Point2D,
} from "@/lib/typeset/voronoiBubbleSplit";
import type { TranslatedBubble } from "@/lib/translationOverlay";

describe("voronoiBubbleSplit", () => {
  describe("computeVoronoiBisector", () => {
    it("computes vertical bisector for horizontally separated seeds", () => {
      const seedA: Point2D = { x: 100, y: 200 };
      const seedB: Point2D = { x: 200, y: 200 };

      const bisector = computeVoronoiBisector(seedA, seedB);
      expect(bisector.midpoint).toEqual({ x: 150, y: 200 });
      expect(bisector.normal.x).toBe(100);
      expect(bisector.normal.y).toBe(0);
      expect(bisector.axis).toBe("vertical");
    });

    it("computes horizontal bisector for vertically separated seeds", () => {
      const seedA: Point2D = { x: 200, y: 100 };
      const seedB: Point2D = { x: 200, y: 300 };

      const bisector = computeVoronoiBisector(seedA, seedB);
      expect(bisector.midpoint).toEqual({ x: 200, y: 200 });
      expect(bisector.normal.x).toBe(0);
      expect(bisector.normal.y).toBe(200);
      expect(bisector.axis).toBe("horizontal");
    });
  });

  describe("clipRectByVoronoiPlane", () => {
    it("clips rectangle into two complementary polygons whose areas sum to the original", () => {
      const rect: BoundingBoxRect = { x: 0, y: 0, width: 200, height: 200 };
      const seedA: Point2D = { x: 50, y: 100 };
      const seedB: Point2D = { x: 150, y: 100 };

      const { polygonA, polygonB, areaA, areaB } = clipRectByVoronoiPlane(
        rect,
        seedA,
        seedB,
      );

      expect(polygonA.length).toBeGreaterThanOrEqual(3);
      expect(polygonB.length).toBeGreaterThanOrEqual(3);
      expect(areaA + areaB).toBeCloseTo(200 * 200, 1);
      expect(areaA).toBeCloseTo(areaB, 1);
    });
  });

  describe("isDoubleBubblePair", () => {
    it("identifies heavily overlapping adjacent bubbles as a double bubble pair", () => {
      // Overlapping lobes of an 8-shaped conjoined balloon
      const boxA: BoundingBoxRect = { x: 100, y: 100, width: 120, height: 100 };
      const boxB: BoundingBoxRect = { x: 100, y: 160, width: 120, height: 100 };

      expect(isDoubleBubblePair(boxA, boxB)).toBe(true);
    });

    it("returns false for distant bubbles with no overlap", () => {
      const boxA: BoundingBoxRect = { x: 100, y: 100, width: 100, height: 100 };
      const boxB: BoundingBoxRect = { x: 500, y: 500, width: 100, height: 100 };

      expect(isDoubleBubblePair(boxA, boxB)).toBe(false);
    });
  });

  describe("splitConjoinedPairVoronoi", () => {
    it("splits vertical double bubble into two non-overlapping rectangular safe areas", () => {
      const lobeTop: BoundingBoxRect = { x: 100, y: 100, width: 150, height: 120 };
      const lobeBottom: BoundingBoxRect = { x: 100, y: 180, width: 150, height: 120 };

      const result = splitConjoinedPairVoronoi(lobeTop, lobeBottom, { gutter: 4 });

      // Box A should be on top, Box B on the bottom
      expect(result.axis).toBe("horizontal");
      expect(result.boxA.y + result.boxA.height).toBeLessThanOrEqual(result.boxB.y);

      // Verify zero overlap between boxA and boxB
      const yOverlap =
        Math.min(result.boxA.y + result.boxA.height, result.boxB.y + result.boxB.height) -
        Math.max(result.boxA.y, result.boxB.y);
      expect(yOverlap).toBeLessThanOrEqual(0);
    });

    it("splits horizontal double bubble into two non-overlapping rectangular safe areas", () => {
      const lobeLeft: BoundingBoxRect = { x: 100, y: 100, width: 120, height: 150 };
      const lobeRight: BoundingBoxRect = { x: 170, y: 100, width: 120, height: 150 };

      const result = splitConjoinedPairVoronoi(lobeLeft, lobeRight, { gutter: 6 });

      expect(result.axis).toBe("vertical");
      expect(result.boxA.x + result.boxA.width).toBeLessThanOrEqual(result.boxB.x);

      // Verify zero overlap
      const xOverlap =
        Math.min(result.boxA.x + result.boxA.width, result.boxB.x + result.boxB.width) -
        Math.max(result.boxA.x, result.boxB.x);
      expect(xOverlap).toBeLessThanOrEqual(0);
    });

    it("handles identical centers safely with fallback division", () => {
      const boxA: BoundingBoxRect = { x: 100, y: 100, width: 100, height: 100 };
      const boxB: BoundingBoxRect = { x: 100, y: 100, width: 100, height: 100 };

      const result = splitConjoinedPairVoronoi(boxA, boxB);
      expect(result.boxA.width).toBeGreaterThan(0);
      expect(result.boxB.width).toBeGreaterThan(0);
    });
  });

  describe("splitDoubleBubble (TranslatedBubble integration)", () => {
    it("updates layoutAdjustment for both bubbles with zero collision remaining", () => {
      const iw = 1000;
      const ih = 1000;

      const bubbleA: TranslatedBubble = {
        id: "b1",
        box: [100, 100, 220, 250],
        t: "ข้อความบน",
      };
      const bubbleB: TranslatedBubble = {
        id: "b2",
        box: [180, 100, 300, 250],
        t: "ข้อความล่าง",
      };

      const { bubbleA: splitA, bubbleB: splitB } = splitDoubleBubble(
        bubbleA,
        bubbleB,
        iw,
        ih,
        { gutter: 4 },
      );

      expect(splitA.layoutAdjustment).toBeDefined();
      expect(splitB.layoutAdjustment).toBeDefined();

      const adjA = splitA.layoutAdjustment!;
      const adjB = splitB.layoutAdjustment!;

      // Zero vertical collision between adjusted boxes
      expect(adjA.by + adjA.bh).toBeLessThanOrEqual(adjB.by);
      expect(splitA.t).toBe("ข้อความบน");
      expect(splitB.t).toBe("ข้อความล่าง");
      expect(splitA.scanlineRatios).toBeDefined();
      expect(splitA.scanlineRatios!.length).toBe(20);
      expect(splitB.scanlineRatios).toBeDefined();
      expect(splitB.scanlineRatios!.length).toBe(20);
    });
  });

  describe("splitSingleDoubleBubble", () => {
    it("splits a single conjoined bubble with two lines of text into two distinct bubbles", () => {
      const iw = 1000;
      const ih = 1000;

      const singleConjoined: TranslatedBubble = {
        id: "twin-1",
        box: [100, 100, 320, 240], // Tall aspect ratio 140x220
        t: "เธอจะไปไหนเหรอ?\nฉันขอไปด้วยคนสิ!",
        isDoubleBubble: true,
      };

      const [topPart, bottomPart] = splitSingleDoubleBubble(singleConjoined, iw, ih);

      expect(topPart.id).toBe("twin-1-lobe1");
      expect(bottomPart.id).toBe("twin-1-lobe2");
      expect(topPart.t).toBe("เธอจะไปไหนเหรอ?");
      expect(bottomPart.t).toBe("ฉันขอไปด้วยคนสิ!");
      expect(topPart.scanlineRatios).toBeDefined();
      expect(topPart.scanlineRatios!.length).toBe(20);
      expect(bottomPart.scanlineRatios).toBeDefined();
      expect(bottomPart.scanlineRatios!.length).toBe(20);

      const adjTop = topPart.layoutAdjustment!;
      const adjBottom = bottomPart.layoutAdjustment!;
      expect(adjTop.by + adjTop.bh).toBeLessThanOrEqual(adjBottom.by);
    });
  });

  describe("generateVoronoiScanlineRatios", () => {
    it("generates array of scanline ratios clamped between 0 and 1", () => {
      const polygon: Point2D[] = [
        { x: 10, y: 10 },
        { x: 90, y: 10 },
        { x: 90, y: 90 },
        { x: 10, y: 90 },
      ];

      const ratios = generateVoronoiScanlineRatios(polygon, 10);
      expect(ratios.length).toBe(10);
      for (const r of ratios) {
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(1.0);
      }
    });
  });
});
