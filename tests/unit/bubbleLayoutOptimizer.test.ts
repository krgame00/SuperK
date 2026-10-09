import { describe, it, expect } from "vitest";
import {
  detectBubbleCollisions,
  resolveBubbleCollisions,
  fitBubbleTextWithinBounds,
  autoOrganizePageBubbles,
  type BubbleRect,
} from "../../lib/bubbleLayoutOptimizer";
import type { TranslatedBubble } from "../../lib/translationOverlay";

describe("Bubble Layout Optimizer", () => {
  const iw = 1200;
  const ih = 1800;

  it("detects collisions between overlapping bubble rectangles", () => {
    const bubbles: TranslatedBubble[] = [
      {
        id: 1,
        // box: [ymin, xmin, ymax, xmax] in 0-1000
        box: [100, 100, 200, 250], // y: 180-360, x: 120-300 (w: 180, h: 180)
        t: "ข้อความแรก",
      },
      {
        id: 2,
        box: [120, 150, 220, 300], // y: 216-396, x: 180-360 (overlaps with bubble 1!)
        t: "ข้อความที่สองซ้อนทับ",
      },
      {
        id: 3,
        box: [700, 700, 800, 850], // Far away in bottom right
        t: "ข้อความห่างไกล",
      },
    ];

    const collisions = detectBubbleCollisions(bubbles, iw, ih);
    expect(collisions.length).toBe(1);
    expect(collisions[0].bubbleA.id).toBe(1);
    expect(collisions[0].bubbleB.id).toBe(2);
    expect(collisions[0].overlapArea).toBeGreaterThan(0);
  });

  it("resolves collisions by separating overlapping bubbles without exceeding image bounds", () => {
    const bubbles: TranslatedBubble[] = [
      {
        id: 1,
        box: [100, 100, 200, 250],
        t: "หยุดเดี๋ยวนี้นะ!",
      },
      {
        id: 2,
        box: [110, 120, 210, 270], // Heavily overlapping
        t: "มะ... ไม่นะ! ฉันไม่เห็นตกลงด้วยเลย!",
      },
    ];

    const resolved = resolveBubbleCollisions(bubbles, iw, ih);
    expect(resolved.length).toBe(2);

    // After resolution, there should be NO collisions
    const remainingCollisions = detectBubbleCollisions(resolved, iw, ih);
    expect(remainingCollisions.length).toBe(0);

    // Both bubbles must remain inside page boundaries
    for (const b of resolved) {
      const adj = b.layoutAdjustment!;
      expect(adj.bx).toBeGreaterThanOrEqual(0);
      expect(adj.by).toBeGreaterThanOrEqual(0);
      expect(adj.bx + adj.bw).toBeLessThanOrEqual(iw + 1);
      expect(adj.by + adj.bh).toBeLessThanOrEqual(ih + 1);
    }
  });

  it("fits long Thai text within original bubble bounds by reducing font size rather than ballooning 3x", () => {
    const bubble: TranslatedBubble = {
      id: 1,
      box: [200, 200, 320, 350], // w: 180px, h: 216px on 1200x1800
      t: "มะ... ไม่นะ! ฉันไม่เห็นตกลงด้วยเลย! กล้าดียังไงมาแตะต้องคู่หมั้นฉันยะ!",
    };

    const fitted = fitBubbleTextWithinBounds(bubble, iw, ih);
    expect(fitted.targetFontSize).toBeDefined();
    expect(fitted.targetFontSize).toBeGreaterThanOrEqual(8);

    // Frame must NOT balloon to 2.5x or 3x
    const origW = (150 / 1000) * iw; // 180px
    const origH = (120 / 1000) * ih; // 216px
    const finalW = fitted.layoutAdjustment?.bw ?? origW;
    const finalH = fitted.layoutAdjustment?.bh ?? origH;

    expect(finalW).toBeLessThanOrEqual(origW * 1.15);
    expect(finalH).toBeLessThanOrEqual(origH * 1.15);
  });

  it("autoOrganizePageBubbles solves multiple overlapping dialogue clusters from realistic manga pages", () => {
    // Cluster similar to Page 4 & Page 5 of user's PDF
    const pageBubbles: TranslatedBubble[] = [
      {
        id: 1,
        box: [50, 750, 150, 920],
        t: "นี่มันอะไรเนี่ย! เกิดอะไรขึ้นเนี่ย?!",
      },
      {
        id: 2,
        box: [60, 780, 140, 930], // Colliding with 1
        t: "ด-เดี๋ยวสิ!",
      },
      {
        id: 3,
        box: [80, 800, 220, 950], // Colliding with 2
        t: "ก็เราเป็นเพื่อนซี้กันนี่นา? แล้วฉันจะปฏิเสธได้ยังไงล่ะ!",
      },
      {
        id: 4,
        box: [200, 790, 280, 920], // Touching 3
        t: "ทำไมถึงมีกล้องด้วยเนี่ย?!",
      },
    ];

    const result = autoOrganizePageBubbles(pageBubbles, iw, ih);
    expect(result.adjustedCount).toBeGreaterThan(0);

    const remainingCollisions = detectBubbleCollisions(result.optimizedBubbles, iw, ih);
    expect(remainingCollisions.length).toBe(0);

    for (const b of result.optimizedBubbles) {
      expect(b.layoutAdjustment).toBeDefined();
      const adj = b.layoutAdjustment!;
      expect(adj.bx).toBeGreaterThanOrEqual(0);
      expect(adj.by).toBeGreaterThanOrEqual(0);
      expect(adj.bx + adj.bw).toBeLessThanOrEqual(iw + 2);
      expect(adj.by + adj.bh).toBeLessThanOrEqual(ih + 2);
    }
  });

  it("handles empty and deleted bubbles gracefully", () => {
    const bubbles: TranslatedBubble[] = [
      { id: 1, deleted: true, t: "deleted" },
      { id: 2, t: "" },
      { id: 3, t: "   " },
    ];

    const result = autoOrganizePageBubbles(bubbles, iw, ih);
    expect(result.adjustedCount).toBe(0);
    expect(result.optimizedBubbles.length).toBe(3);
  });

  it("preserves manual adjustment when there are no collisions unless forceRealign is requested", () => {
    const bubbles: TranslatedBubble[] = [
      {
        id: 1,
        box: [100, 100, 200, 200],
        t: "ข้อความเดี่ยว",
        layoutAdjustment: {
          bx: 150,
          by: 250,
          bw: 160,
          bh: 120,
          iw,
          ih,
          targetFontSize: 24,
        },
      },
    ];

    // Without forceRealign: preserved!
    const resultNormal = autoOrganizePageBubbles(bubbles, iw, ih, { forceRealign: false });
    expect(resultNormal.optimizedBubbles[0].layoutAdjustment?.bx).toBe(150);
    expect(resultNormal.optimizedBubbles[0].layoutAdjustment?.by).toBe(250);

    // With forceRealign: re-optimized!
    const resultForce = autoOrganizePageBubbles(bubbles, iw, ih, { forceRealign: true });
    expect(resultForce.optimizedBubbles[0].targetFontSize).toBeDefined();
  });

  it("adapts narrow vertical Japanese text boxes to readable manga typography (>= 16px font, not tiny 8-9px)", () => {
    // Narrow vertical Japanese text box from Page 5 top-right
    // xmin = 780, xmax = 840 (w: 76px on 1280px), ymin = 50, ymax = 160 (h: 197px on 1793px)
    const bubble: TranslatedBubble = {
      id: "p5-top-right-2",
      box: [50, 780, 160, 840],
      t: "ม่ายๆๆๆ! ฉันไม่ได้ตกลงสักหน่อย! กล้าดียังไงมาแย่งท่อนดุ้นนั้นมันเนี่ย!",
    };

    const fitted = fitBubbleTextWithinBounds(bubble, 1280, 1793);
    // Should NOT be microscopic (was dropping to 9px!)
    expect(fitted.targetFontSize).toBeGreaterThanOrEqual(16);
    // Width should adapt outwards toward a natural speech balloon aspect ratio instead of staying at 64px
    expect(fitted.layoutAdjustment?.bw).toBeGreaterThanOrEqual(100);
  });

  it("handles adjacent dialogue bubbles on Page 5 with both readable font size and zero collisions", () => {
    const page5Bubbles: TranslatedBubble[] = [
      {
        id: "top-right-1",
        box: [50, 710, 160, 760],
        t: "หยุดเดี๋ยวนี้นะ! หยุดเดี๋ยวนี้นะ!",
      },
      {
        id: "top-right-2",
        box: [50, 780, 160, 840],
        t: "ม่ายๆๆๆ! ฉันไม่ได้ตกลงสักหน่อย! กล้าดียังไงมาแย่งท่อนดุ้นนั้นมันเนี่ย!",
      },
      {
        id: "mid-right-1",
        box: [480, 700, 580, 750],
        t: "อะ?! ปล่อยเขาก่อนสิ! ได้ยินที่ฉันพูดไหมเนี่ย! เขาเป็นของฉันนะ!",
      },
      {
        id: "mid-right-2",
        box: [460, 770, 560, 840],
        t: "มาร่วมแจมด้วยกันสิ! ไอ้คู่นั่นก็ต้องการความรักเหมือนกันนะ♥",
      },
    ];

    const result = autoOrganizePageBubbles(page5Bubbles, 1280, 1793);
    expect(result.optimizedBubbles.length).toBe(4);

    // No collisions among any of the bubbles!
    const remaining = detectBubbleCollisions(result.optimizedBubbles, 1280, 1793);
    expect(remaining.length).toBe(0);

    // All bubbles must have readable font size (>= 15px, not 8-10px)
    for (const b of result.optimizedBubbles) {
      expect(b.targetFontSize).toBeDefined();
      expect(b.targetFontSize).toBeGreaterThanOrEqual(15);
      expect(b.layoutAdjustment).toBeDefined();
      expect(b.layoutAdjustment!.bx).toBeGreaterThanOrEqual(0);
      expect(b.layoutAdjustment!.bx + b.layoutAdjustment!.bw).toBeLessThanOrEqual(1282);
    }
  });

  it("forceRealign breaks out of previous tiny/narrow layoutAdjustment and restores readable font size", () => {
    // Bubble that was previously organized into a tiny narrow box (the exact state the user had)
    const previouslyTinyBubble: TranslatedBubble = {
      id: "p5-top-right-1",
      box: [50, 710, 160, 760], // Original Japanese box: w: 64px, h: 197px
      t: "หยุดเดี๋ยวนี้นะ! หยุดเดี๋ยวนี้นะ!",
      targetFontSize: 9, // Prior tiny font
      layoutAdjustment: {
        bx: 900,
        by: 100,
        bw: 64, // Prior narrow box
        bh: 197,
        iw: 1280,
        ih: 1793,
        targetFontSize: 9,
      },
    };

    const result = autoOrganizePageBubbles([previouslyTinyBubble], 1280, 1793, { forceRealign: true });
    const optimized = result.optimizedBubbles[0];

    // Must NOT stay at 9px! Must adapt to readable size (>= 16px)
    expect(optimized.targetFontSize).toBeGreaterThanOrEqual(16);
    // Width must NOT stay stuck at 64px!
    expect(optimized.layoutAdjustment?.bw).toBeGreaterThanOrEqual(120);
  });
});

