import { describe, expect, it } from "vitest";
import {
  autoClusterPanelsFromBubbles,
  buildSpatialDominanceDAG,
  computeIntraPanelScore,
  panelSpatialDominates,
  sortBubblesHierarchicalDAG,
  topologicalSortPanels,
  type PanelBox,
} from "@/lib/translation/panelReadingFlowDAG";

describe("Manga Panel Segmentation & Topological Reading Flow DAG (Blueprint Module 2)", () => {
  describe("computeIntraPanelScore", () => {
    it("weights horizontal position by alpha=1.5 and vertical by beta=1.0", () => {
      // Box at right-top (X=800, Y=100) on 1000px width
      // Score = 1.5 * (1000 - 800) + 1.0 * 100 = 1.5 * 200 + 100 = 400
      const box1 = {
        top: 80,
        left: 750,
        bottom: 120,
        right: 850,
        width: 100,
        height: 40,
        centerX: 800,
        centerY: 100,
      };
      expect(computeIntraPanelScore(box1, 1000, 1.5, 1.0)).toBe(400);

      // Box at left-top (X=200, Y=100) on 1000px width
      // Score = 1.5 * (1000 - 200) + 1.0 * 100 = 1.5 * 800 + 100 = 1300
      const box2 = {
        top: 80,
        left: 150,
        bottom: 120,
        right: 250,
        width: 100,
        height: 40,
        centerX: 200,
        centerY: 100,
      };
      expect(computeIntraPanelScore(box2, 1000, 1.5, 1.0)).toBe(1300);

      // Right box has lower score -> read earlier in RTL flow
      expect(computeIntraPanelScore(box1)).toBeLessThan(computeIntraPanelScore(box2));
    });
  });

  describe("panelSpatialDominates", () => {
    it("asserts strict right-to-left dominance when panel A is right of panel B", () => {
      const panelRight: PanelBox = {
        id: "p-right",
        top: 50,
        left: 550,
        bottom: 450,
        right: 950,
        width: 400,
        height: 400,
        centerX: 750,
        centerY: 250,
      };

      const panelLeft: PanelBox = {
        id: "p-left",
        top: 50,
        left: 50,
        bottom: 450,
        right: 450,
        width: 400,
        height: 400,
        centerX: 250,
        centerY: 250,
      };

      expect(panelSpatialDominates(panelRight, panelLeft)).toBe(true);
      expect(panelSpatialDominates(panelLeft, panelRight)).toBe(false);
    });

    it("asserts top-to-bottom dominance when panels share horizontal span", () => {
      const panelTop: PanelBox = {
        id: "p-top",
        top: 50,
        left: 100,
        bottom: 400,
        right: 900,
        width: 800,
        height: 350,
        centerX: 500,
        centerY: 225,
      };

      const panelBottom: PanelBox = {
        id: "p-bottom",
        top: 450,
        left: 100,
        bottom: 850,
        right: 900,
        width: 800,
        height: 400,
        centerX: 500,
        centerY: 650,
      };

      expect(panelSpatialDominates(panelTop, panelBottom)).toBe(true);
      expect(panelSpatialDominates(panelBottom, panelTop)).toBe(false);
    });

    it("returns false for identical panel ID", () => {
      const panel: PanelBox = {
        id: "p1",
        top: 10,
        left: 10,
        bottom: 100,
        right: 100,
        width: 90,
        height: 90,
        centerX: 55,
        centerY: 55,
      };
      expect(panelSpatialDominates(panel, panel)).toBe(false);
    });
  });

  describe("topologicalSortPanels", () => {
    it("correctly sorts classic 4-koma 2x2 manga layout (Top-Right -> Top-Left -> Bottom-Right -> Bottom-Left)", () => {
      // 2x2 grid
      const pTopRight: PanelBox = {
        id: "P1_TR",
        top: 50,
        left: 520,
        bottom: 450,
        right: 950,
        width: 430,
        height: 400,
        centerX: 735,
        centerY: 250,
      };
      const pTopLeft: PanelBox = {
        id: "P2_TL",
        top: 50,
        left: 50,
        bottom: 450,
        right: 480,
        width: 430,
        height: 400,
        centerX: 265,
        centerY: 250,
      };
      const pBottomRight: PanelBox = {
        id: "P3_BR",
        top: 500,
        left: 520,
        bottom: 950,
        right: 950,
        width: 430,
        height: 450,
        centerX: 735,
        centerY: 725,
      };
      const pBottomLeft: PanelBox = {
        id: "P4_BL",
        top: 500,
        left: 50,
        bottom: 950,
        right: 480,
        width: 430,
        height: 450,
        centerX: 265,
        centerY: 725,
      };

      // Pass in random shuffled order
      const input = [pBottomLeft, pTopRight, pBottomRight, pTopLeft];
      const sorted = topologicalSortPanels(input);

      expect(sorted.map((p) => p.id)).toEqual(["P1_TR", "P2_TL", "P3_BR", "P4_BL"]);
    });

    it("correctly sorts tall right splash panel with two stacked left action panels", () => {
      const tallRight: PanelBox = {
        id: "P_TALL_RIGHT",
        top: 50,
        left: 550,
        bottom: 850,
        right: 950,
        width: 400,
        height: 800,
        centerX: 750,
        centerY: 450,
      };
      const leftTop: PanelBox = {
        id: "P_LEFT_TOP",
        top: 50,
        left: 50,
        bottom: 420,
        right: 480,
        width: 430,
        height: 370,
        centerX: 265,
        centerY: 235,
      };
      const leftBottom: PanelBox = {
        id: "P_LEFT_BOTTOM",
        top: 480,
        left: 50,
        bottom: 850,
        right: 480,
        width: 430,
        height: 370,
        centerX: 265,
        centerY: 665,
      };

      const sorted = topologicalSortPanels([leftBottom, leftTop, tallRight]);
      expect(sorted.map((p) => p.id)).toEqual(["P_TALL_RIGHT", "P_LEFT_TOP", "P_LEFT_BOTTOM"]);
    });

    it("correctly sorts two stacked right panels with tall left splash panel", () => {
      const rightTop: PanelBox = {
        id: "P_RIGHT_TOP",
        top: 50,
        left: 520,
        bottom: 420,
        right: 950,
        width: 430,
        height: 370,
        centerX: 735,
        centerY: 235,
      };
      const rightBottom: PanelBox = {
        id: "P_RIGHT_BOTTOM",
        top: 480,
        left: 520,
        bottom: 850,
        right: 950,
        width: 430,
        height: 370,
        centerX: 735,
        centerY: 665,
      };
      const tallLeft: PanelBox = {
        id: "P_TALL_LEFT",
        top: 50,
        left: 50,
        bottom: 850,
        right: 480,
        width: 430,
        height: 800,
        centerX: 265,
        centerY: 450,
      };

      const sorted = topologicalSortPanels([tallLeft, rightBottom, rightTop]);
      expect(sorted.map((p) => p.id)).toEqual(["P_RIGHT_TOP", "P_RIGHT_BOTTOM", "P_TALL_LEFT"]);
    });

    it("handles cycle fallback without infinite loop or throwing", () => {
      const p1: PanelBox = {
        id: "P1",
        top: 100,
        left: 100,
        bottom: 200,
        right: 200,
        width: 100,
        height: 100,
        centerX: 150,
        centerY: 150,
      };
      const p2: PanelBox = {
        id: "P2",
        top: 100,
        left: 100,
        bottom: 200,
        right: 200,
        width: 100,
        height: 100,
        centerX: 150,
        centerY: 150,
      };

      const sorted = topologicalSortPanels([p1, p2]);
      expect(sorted).toHaveLength(2);
    });
  });

  describe("sortBubblesHierarchicalDAG", () => {
    it("solves naive Y-sort context desynchronization in staggered panels", () => {
      // Panel 1 (Right):
      // - Bubble A1: Y=50, X=800 (Top-Right)
      // - Bubble A2: Y=220, X=650 (Bottom-Left of Panel 1)
      // Panel 2 (Left):
      // - Bubble B1: Y=110, X=350 (Top-Right of Panel 2)
      // - Bubble B2: Y=300, X=150 (Bottom-Left of Panel 2)
      //
      // Under NAIVE Y-sort:
      // Bubble A1 (Y=50) -> Bubble B1 (Y=110) -> Bubble A2 (Y=220) -> Bubble B2 (Y=300)
      // Context desynchronization! Dialogue B1 sneaks between A1 and A2!
      //
      // Under Two-Tier Hierarchical DAG:
      // Panel 1 dominates Panel 2.
      // Canonical Order: A1 -> A2 -> B1 -> B2!

      const bubbleA1 = { id: "A1", box: [30, 750, 70, 850] };
      const bubbleA2 = { id: "A2", box: [200, 600, 240, 700] };
      const bubbleB1 = { id: "B1", box: [90, 300, 130, 400] };
      const bubbleB2 = { id: "B2", box: [280, 100, 320, 200] };

      const panel1: PanelBox = {
        id: "panel-1-right",
        top: 20,
        left: 550,
        bottom: 400,
        right: 950,
        width: 400,
        height: 380,
        centerX: 750,
        centerY: 210,
      };

      const panel2: PanelBox = {
        id: "panel-2-left",
        top: 20,
        left: 50,
        bottom: 400,
        right: 480,
        width: 430,
        height: 380,
        centerX: 265,
        centerY: 210,
      };

      const shuffled = [bubbleB1, bubbleA2, bubbleB2, bubbleA1];
      const sorted = sortBubblesHierarchicalDAG(shuffled, {
        panels: [panel1, panel2],
      });

      expect(sorted.map((b) => b.id)).toEqual(["A1", "A2", "B1", "B2"]);
    });

    it("auto-clusters panels when explicit panels are omitted", () => {
      // Right cluster
      const r1 = { id: "R1", box: [50, 700, 100, 800] };
      const r2 = { id: "R2", box: [120, 680, 180, 780] };
      // Left cluster far apart (> gutter threshold)
      const l1 = { id: "L1", box: [60, 150, 110, 250] };
      const l2 = { id: "L2", box: [140, 130, 190, 230] };

      const input = [l1, r2, l2, r1];
      const sorted = sortBubblesHierarchicalDAG(input);

      // Right cluster read first (R1 -> R2), then Left cluster (L1 -> L2)
      expect(sorted.map((b) => b.id)).toEqual(["R1", "R2", "L1", "L2"]);
    });

    it("preserves invalid or unpositioned items at the end", () => {
      const valid1 = { id: "V1", box: [50, 800, 90, 900] };
      const invalid = { id: "INV", box: null };
      const valid2 = { id: "V2", box: [100, 200, 140, 300] };

      const sorted = sortBubblesHierarchicalDAG([invalid, valid2, valid1]);
      expect(sorted.map((b) => b.id)).toEqual(["V1", "V2", "INV"]);
    });

    it("safely handles empty or single element lists", () => {
      expect(sortBubblesHierarchicalDAG([])).toEqual([]);
      const single = [{ id: "one", box: [10, 10, 20, 20] }];
      expect(sortBubblesHierarchicalDAG(single)).toEqual(single);
    });
  });

  describe("autoClusterPanelsFromBubbles", () => {
    it("groups nearby bubbles into single panel and separates distant ones", () => {
      const b1 = { top: 50, left: 700, bottom: 90, right: 800, width: 100, height: 40, centerX: 750, centerY: 70 };
      const b2 = { top: 110, left: 710, bottom: 150, right: 810, width: 100, height: 40, centerX: 760, centerY: 130 };
      const b3 = { top: 50, left: 100, bottom: 90, right: 200, width: 100, height: 40, centerX: 150, centerY: 70 };

      const result = autoClusterPanelsFromBubbles([b1, b2, b3], 1000, 1000);
      expect(result.panels).toHaveLength(2);
      expect(result.bubbleToPanelIndex[0]).toBe(result.bubbleToPanelIndex[1]);
      expect(result.bubbleToPanelIndex[0]).not.toBe(result.bubbleToPanelIndex[2]);
    });
  });

  describe("buildSpatialDominanceDAG", () => {
    it("constructs correct adjacency matrix and in-degree counts", () => {
      const pA: PanelBox = { id: "A", top: 10, left: 600, bottom: 200, right: 900, width: 300, height: 190, centerX: 750, centerY: 105 };
      const pB: PanelBox = { id: "B", top: 10, left: 100, bottom: 200, right: 400, width: 300, height: 190, centerX: 250, centerY: 105 };

      const { adjacency, inDegree } = buildSpatialDominanceDAG([pA, pB]);
      expect(adjacency[0]).toContain(1); // A -> B
      expect(inDegree[0]).toBe(0);
      expect(inDegree[1]).toBe(1);
    });
  });
});
