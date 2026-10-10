import { describe, it, expect } from "vitest";
import {
  getBubbleGeometry,
  detectBubbleCollisions,
  resolveBubbleCollisions,
  fitBubbleTextWithinBounds,
  autoOrganizePageBubbles,
  autoOrganizeAllPagesBubbles,
  type BubbleRect,
} from "../../lib/bubbleLayoutOptimizer";
import {
  layoutBubbleAtFixedFont,
  type TranslatedBubble,
} from "../../lib/translationOverlay";

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

  it("expands frame beyond original bubble bounds for long Thai text so font stays large and easy to read (>= 20px)", () => {
    const bubble: TranslatedBubble = {
      id: 1,
      box: [200, 200, 320, 350], // w: 180px, h: 216px on 1200x1800
      t: "มะ... ไม่นะ! ฉันไม่เห็นตกลงด้วยเลย! กล้าดียังไงมาแตะต้องคู่หมั้นฉันยะ!",
    };

    const fitted = fitBubbleTextWithinBounds(bubble, iw, ih);
    expect(fitted.targetFontSize).toBeDefined();
    // Must stay large and easy to read (>= 23px on 1200px wide page) instead of shrinking to 13-19px
    expect(fitted.targetFontSize).toBeGreaterThanOrEqual(23);

    const origW = (150 / 1000) * iw; // 180px
    const origH = (120 / 1000) * ih; // 216px
    const finalW = fitted.layoutAdjustment?.bw ?? origW;
    const finalH = fitted.layoutAdjustment?.bh ?? origH;

    // Frame expands beyond the original bubble bounds so the text is large and easy to read
    expect(finalW).toBeGreaterThan(origW);
    expect(finalW).toBeLessThanOrEqual(iw * 0.5);
    expect(finalH).toBeLessThanOrEqual(ih * 0.5);
  });

  it("can still constrain within original bubble bounds when constrainToOriginalBox is true", () => {
    const bubble: TranslatedBubble = {
      id: 1,
      box: [200, 200, 320, 350],
      t: "มะ... ไม่นะ! ฉันไม่เห็นตกลงด้วยเลย! กล้าดียังไงมาแตะต้องคู่หมั้นฉันยะ!",
    };

    const fitted = fitBubbleTextWithinBounds(bubble, iw, ih, { constrainToOriginalBox: true });
    const origW = (150 / 1000) * iw;
    const origH = (120 / 1000) * ih;
    expect(fitted.layoutAdjustment!.bw).toBeLessThanOrEqual(origW * 1.15);
    expect(fitted.layoutAdjustment!.bh).toBeLessThanOrEqual(origH * 1.15);
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

  it("strictly preserves bubbles with layoutAdjustment.userModified === true even during forceRealign", () => {
    const userBubble: TranslatedBubble = {
      id: "manual-bubble-1",
      box: [50, 710, 160, 760],
      t: "ข้อความที่ฉันตั้งใจลากไว้เอง",
      layoutAdjustment: {
        bx: 500,
        by: 400,
        bw: 220,
        bh: 140,
        iw: 1200,
        ih: 1800,
        userModified: true, // Marked by user drag/resize gesture
        targetFontSize: 28,
      },
    };

    const result = autoOrganizePageBubbles([userBubble], 1200, 1800, { forceRealign: true });
    const preserved = result.optimizedBubbles[0];

    // Must strictly preserve the exact coordinates and font size set by the user!
    expect(preserved.layoutAdjustment?.bx).toBe(500);
    expect(preserved.layoutAdjustment?.by).toBe(400);
    expect(preserved.layoutAdjustment?.bw).toBe(220);
    expect(preserved.layoutAdjustment?.bh).toBe(140);
    expect(preserved.layoutAdjustment?.userModified).toBe(true);
    expect(result.adjustedCount).toBe(0);
  });

  it("autoOrganizeAllPagesBubbles processes multiple pages across a book and aggregates adjusted bubble count", () => {
    const pages = [
      {
        pageUrl: "blob:page-1",
        width: 1200,
        height: 1800,
        bubbles: [
          {
            id: 1,
            box: [100, 100, 200, 250],
            t: "หน้า 1 คำพูด",
          },
        ],
      },
      {
        pageUrl: "blob:page-2",
        width: 1200,
        height: 1800,
        bubbles: [
          {
            id: 2,
            box: [100, 100, 200, 250],
            t: "หน้า 2 คำพูดแรก",
          },
          {
            id: 3,
            box: [120, 140, 220, 280], // Colliding with 2
            t: "หน้า 2 คำพูดสองซ้อน",
          },
        ],
      },
    ];

    const result = autoOrganizeAllPagesBubbles(pages, { forceRealign: true });

    expect(result.pageResults.size).toBe(2);
    expect(result.pageResults.has("blob:page-1")).toBe(true);
    expect(result.pageResults.has("blob:page-2")).toBe(true);

    const p1Bubbles = result.pageResults.get("blob:page-1")!;
    const p2Bubbles = result.pageResults.get("blob:page-2")!;

    expect(p1Bubbles.length).toBe(1);
    expect(p2Bubbles.length).toBe(2);

    // Collisions on page 2 resolved
    const p2Collisions = detectBubbleCollisions(p2Bubbles, 1200, 1800);
    expect(p2Collisions.length).toBe(0);

    // Total adjusted count includes all adjusted bubbles
    expect(result.totalAdjustedCount).toBeGreaterThan(0);
  });

  it("single-pass convergence: running autoOrganizePageBubbles once vs twice produces identical geometry and zero collisions even for long text", () => {
    const cluster: TranslatedBubble[] = [
      {
        id: "c1",
        box: [60, 740, 170, 790], // Narrow vertical 1 near right edge with very long text (!fit.fits)
        t: "นี่มันเกิดอะไรขึ้นกันแน่เนี่ย?! ทำไมจู่ๆ ถึงเป็นแบบนี้ไปได้ล่ะ! ฉันไม่เข้าใจเลยสักนิดเดียว ช่วยอธิบายให้ฟังหน่อยสิ!",
      },
      {
        id: "c2",
        box: [65, 795, 175, 845], // Narrow vertical 2 right next to c1 with very long text (!fit.fits)
        t: "ด-เดี๋ยวก่อนสิ! ฟังฉันอธิบายก่อนนะ! เรื่องนี้มันมีเหตุผลจำเป็นจริงๆ นะไม่ได้ตั้งใจจะปิดบังเลย!",
      },
      {
        id: "c3",
        box: [155, 760, 265, 820], // Stacked below & overlapping with long text
        t: "ไม่ฟังแล้ว! เธอทำเกินไปแล้วจริงๆ นะรู้ตัวไหม! ฉันจะไม่ยอมให้เรื่องนี้ผ่านไปง่ายๆ เด็ดขาด!",
      },
    ];

    const pass1 = autoOrganizePageBubbles(cluster, 1280, 1800, { forceRealign: true });
    expect(detectBubbleCollisions(pass1.optimizedBubbles, 1280, 1800).length).toBe(0);

    // Also verify running pass2 without forceRealign (as applyTranslationOverlay does on page render) does NOT mutate or re-expand!
    const renderPass = autoOrganizePageBubbles(pass1.optimizedBubbles, 1280, 1800, { forceRealign: false });
    expect(detectBubbleCollisions(renderPass.optimizedBubbles, 1280, 1800).length).toBe(0);

    // Running a second time with forceRealign: true must converge to the exact same geometry in 1 click!
    const pass2 = autoOrganizePageBubbles(pass1.optimizedBubbles, 1280, 1800, { forceRealign: true });
    expect(detectBubbleCollisions(pass2.optimizedBubbles, 1280, 1800).length).toBe(0);

    for (let i = 0; i < pass1.optimizedBubbles.length; i++) {
      const b1 = pass1.optimizedBubbles[i].layoutAdjustment!;
      const bRender = renderPass.optimizedBubbles[i].layoutAdjustment!;
      const b2 = pass2.optimizedBubbles[i].layoutAdjustment!;
      expect(bRender.bx).toBe(b1.bx);
      expect(bRender.by).toBe(b1.by);
      expect(bRender.bw).toBe(b1.bw);
      expect(bRender.bh).toBe(b1.bh);
      expect(b2.bx).toBe(b1.bx);
      expect(b2.by).toBe(b1.by);
      expect(b2.bw).toBe(b1.bw);
      expect(b2.bh).toBe(b1.bh);
      expect(pass2.optimizedBubbles[i].targetFontSize).toBe(pass1.optimizedBubbles[i].targetFontSize);
    }
  });

  it("clears stale layoutSnapshot on non-userModified bubbles so render does not revert to pre-organized wrap", () => {
    const bubbleWithStaleSnapshot: TranslatedBubble = {
      id: "stale-snap-1",
      box: [100, 700, 240, 760],
      t: "ข้อความยาวที่เคยถูกแคชไว้ในกรอบแคบๆ",
      layoutSnapshot: {
        text: "ข้อความยาวที่เคยถูกแคชไว้ในกรอบแคบๆ",
        fontFamily: "Itim, sans-serif",
        fontSizePx: 9,
        lineHeightPx: 11.7,
        frameWidthPx: 64,
        frameHeightPx: 220,
        selectionX: 0,
        selectionY: 0,
        selectionWidth: 64,
        selectionHeight: 220,
        lines: ["ข้อ", "ความ", "ยาว"],
        globalMult: 1,
        bubbleMult: 1,
        overflow: true,
      },
    };

    const res = autoOrganizePageBubbles([bubbleWithStaleSnapshot], 1200, 1800, { forceRealign: true });
    expect(res.optimizedBubbles[0].layoutSnapshot).toBeUndefined();
    expect(res.optimizedBubbles[0].layoutAdjustment?.layoutSnapshot).toBeUndefined();

    // Verify render-time layoutBubbleAtFixedFont produces exact heightPx === adj.bh (zero render-time vertical expansion)
    const opt = res.optimizedBubbles[0];
    const adj = opt.layoutAdjustment!;
    const renderLayout = layoutBubbleAtFixedFont(
      opt.t!,
      adj.bw,
      opt.targetFontSize!,
      "Itim, sans-serif",
      true,
      adj.bh,
      1800,
      "th",
    );
    expect(renderLayout.heightPx).toBe(adj.bh);
  });

  it("resolves collisions on id-less OCR bubbles (Page 18 repro) without teleporting or crushing bubble[0]", () => {
    // Real Gemini OCR bubbles do NOT have an `id` field (b.id is undefined).
    // Previously `b.id === col.bubbleA.id` evaluated `undefined === undefined` (true) for index 0,
    // crushing bubble[0] to 16px width and pushing it to the far right edge (x ~ 98%).
    const page18Bubbles: TranslatedBubble[] = [
      {
        // Top-left double balloon, right lobe (bubble[0])
        box: [155, 115, 510, 185],
        t: "ฉันเปิดดูเจ้านี่ซ้ำตั้งหลายรอบตอนกินข้าว แต่...",
      },
      {
        // Top-left double balloon, left lobe (bubble[1])
        box: [165, 50, 550, 125],
        t: "พอมาได้ยินเสียงครางของตัวเองแล้วมันยังน่าอายอยู่ดีนั่นแหละ!",
      },
      {
        // Top-right oval balloon
        box: [125, 530, 480, 620],
        t: "ฮ่าๆ วันนั้นเนี่ยสุดยอดจริงๆ เลย!",
      },
      {
        // Mid-left spiky balloon
        box: [695, 90, 910, 165],
        t: "เฮ้! มันไม่ตลกนะ!",
      },
      {
        // Bottom-right double cloud balloon, lobe A
        box: [790, 540, 960, 620],
        t: "อิอิ! แต่จะบอกว่าไม่ได้ผลก็ไม่ได้นะ!",
      },
      {
        // Bottom-right double cloud balloon, lobe B (colliding with lobe A)
        box: [820, 520, 985, 605],
        t: "งั้นเดี๋ยวเรามาลองกันใหม่อีกรอบดีไหม?",
      },
    ];

    const res = autoOrganizePageBubbles(page18Bubbles, 1280, 1800, { forceRealign: true });
    const remainingCollisions = detectBubbleCollisions(res.optimizedBubbles, 1280, 1800);
    expect(remainingCollisions.length).toBe(0);

    const b0 = res.optimizedBubbles[0];
    const adj0 = b0.layoutAdjustment!;
    // Must stay in the top-left speech balloon region (never teleported to x > 400 or right edge 1260!)
    expect(adj0.bx).toBeLessThan(320);
    // Must NOT be crushed into a 16-20px vertical strip!
    expect(adj0.bw).toBeGreaterThanOrEqual(80);

    // Every bubble on Page 18 must render without overflow at its resolved box & targetFontSize
    for (const b of res.optimizedBubbles) {
      const adj = b.layoutAdjustment!;
      const layout = layoutBubbleAtFixedFont(
        b.t!,
        adj.bw,
        b.targetFontSize!,
        "Itim, sans-serif",
        true,
        adj.bh,
        1800,
        "th",
      );
      expect(layout.overflow).toBe(false);
      expect(layout.heightPx).toBe(adj.bh);
    }
  });

  it("automatically self-heals bubbles that were previously crushed or teleported by the id-less collision bug", () => {
    const corruptedPage18: TranslatedBubble[] = [
      {
        box: [155, 115, 510, 185],
        t: "ฉันเปิดดูเจ้านี่ซ้ำตั้งหลายรอบตอนกินข้าว แต่...",
        targetFontSize: 12,
        layoutAdjustment: {
          bx: 1261, // Teleported to far right edge!
          by: 280,
          bw: 19,   // Crushed to 19px!
          bh: 44,
          iw: 1280,
          ih: 1800,
          targetFontSize: 12,
          isAutoOptimized: true,
        },
      },
      {
        box: [165, 50, 550, 125],
        t: "พอมาได้ยินเสียงครางของตัวเองแล้วมันยังน่าอายอยู่ดีนั่นแหละ!",
      },
    ];

    // Even when called with forceRealign: false (like automatic page render), corrupted adjustments must self-heal
    const res = autoOrganizePageBubbles(corruptedPage18, 1280, 1800, { forceRealign: false });
    const healed0 = res.optimizedBubbles[0].layoutAdjustment!;
    expect(healed0.bx).toBeLessThan(320);
    expect(healed0.bw).toBeGreaterThanOrEqual(80);
    expect(detectBubbleCollisions(res.optimizedBubbles, 1280, 1800).length).toBe(0);
  });

  it("handles Page 4 3-lobe cluster and top-left camera box without teleporting bubble[0] or crushing sandwiched middle lobe", () => {
    const page4Bubbles: TranslatedBubble[] = [
      {
        // Top-left camera box "NOW RECORDING..." (bubble[0])
        box: [45, 70, 115, 225],
        t: "กำลังบันทึกภาพอยู่...",
      },
      {
        // Top-right Lobe 1 top
        box: [45, 760, 175, 825],
        t: "นี่มันอะไรกันเนี่ย! เกิดอะไรขึ้นเนี่ย?!",
      },
      {
        // Top-right Lobe 1 bottom (stacked in same column)
        box: [185, 765, 295, 825],
        t: "ทำไมถึงมีกล้องด้วยเนี่ย?!",
      },
      {
        // Top-right Lobe 2 middle (sandwiched between Lobe 1 and Lobe 3)
        box: [65, 825, 165, 865],
        t: "เดี๋ยว-เดี๋ยวสิ!",
      },
      {
        // Top-right Lobe 3 right
        box: [45, 865, 295, 928],
        t: "ก็พวกเราเป็นเพื่อนซี้กันไม่ใช่เหรอ? แล้วฉันจะปฏิเสธลงได้ยังไงล่ะ! ปล่อยให้เป็นหน้าที่ฉันเอง!",
      },
    ];

    const res = autoOrganizePageBubbles(page4Bubbles, 1280, 1807, { forceRealign: true });
    expect(detectBubbleCollisions(res.optimizedBubbles, 1280, 1807).length).toBe(0);

    // Top-left camera box (bubble[0]) must stay in top-left (x < 250px)
    const camAdj = res.optimizedBubbles[0].layoutAdjustment!;
    expect(camAdj.bx).toBeLessThan(250);
    expect(camAdj.bw).toBeGreaterThanOrEqual(120);

    // Sandwiched middle lobe ("เดี๋ยว-เดี๋ยวสิ!") must stay between Lobe 1 and Lobe 3
    const lobe1Cx = res.optimizedBubbles[1].layoutAdjustment!.bx + res.optimizedBubbles[1].layoutAdjustment!.bw / 2;
    const lobe2Cx = res.optimizedBubbles[3].layoutAdjustment!.bx + res.optimizedBubbles[3].layoutAdjustment!.bw / 2;
    const lobe3Cx = res.optimizedBubbles[4].layoutAdjustment!.bx + res.optimizedBubbles[4].layoutAdjustment!.bw / 2;
    expect(lobe2Cx).toBeGreaterThan(lobe1Cx);
    expect(lobe2Cx).toBeLessThan(lobe3Cx);
  });

  it("self-heals Page 13 pre-v2 auto-optimized bubbles that were moderately shifted out of their speech balloon", () => {
    const page13Bubbles: TranslatedBubble[] = [
      {
        // Right lobe ("อื้ม... ควยอร่อยจัง!") shifted right onto the dark wooden shelf in PDF 138 (v1)
        box: [60, 495, 165, 565], // rawCx = 678px on 1280px
        t: "อื้ม... ควยอร่อยจัง!",
        targetFontSize: 18,
        layoutAdjustment: {
          bx: 730, // Shifted right onto dark wooden shelf in v1 (without autoOptimizeVersion: 2)
          by: 110,
          bw: 95,
          bh: 160,
          iw: 1280,
          ih: 1807,
          targetFontSize: 18,
          isAutoOptimized: true,
        },
      },
      {
        // Left lobe ("โดนปล่อยให้อยู่คนเดียวแบบนี้มันไม่แฟร์เลยนะ!")
        box: [60, 410, 145, 485],
        t: "โดนปล่อยให้อยู่คนเดียวแบบนี้มันไม่แฟร์เลยนะ!",
      },
    ];

    const res = autoOrganizePageBubbles(page13Bubbles, 1280, 1807, { forceRealign: false });
    expect(detectBubbleCollisions(res.optimizedBubbles, 1280, 1807).length).toBe(0);
    const healedRightLobe = res.optimizedBubbles[0].layoutAdjustment!;
    const healedCx = healedRightLobe.bx + healedRightLobe.bw / 2;
    // Must be healed back near its canonical lobe center (~678px), NOT stuck at 777px!
    expect(Math.abs(healedCx - 678)).toBeLessThan(40);
  });

  it("maintains clean vertical proportions, balloon centering, and harmonious font sizes on complex multi-bubble Page 4 layout", () => {
    const iw = 1280;
    const ih = 1807;
    const fullPage4: TranslatedBubble[] = [
      {
        // 0: Top-left rectangular sign "กำลังบันทึกภาพอยู่..."
        box: [30, 158, 145, 228],
        t: "กำลังบันทึกภาพอยู่...",
      },
      {
        // 1: Upper-left vertical oval balloon
        box: [110, 55, 250, 185],
        t: "ถามอะไรเนี่ย? มองไม่เห็นเหรอว่าพวกเรากำลังจะรุมปล้ำเขาจนเละเลยนะ?",
      },
      {
        // 2: Lower-left tall vertical oval balloon
        box: [260, 52, 435, 185],
        t: "เราจะเปลี่ยนจากลุคยอมคนเดิมๆ ของเธอมาเป็นแบบนี้แทน! หลังจากนี้ไป เดี๋ยวเธอได้เป็นแม่คนในพริบตาแน่! เชื่อใจฉันได้เลย!",
      },
      {
        // 3: Right cluster left lobe
        box: [95, 725, 185, 810],
        t: "นี่มันอะไรเนี่ย! เกิดอะไรขึ้นเนี่ย?!",
      },
      {
        // 4: Right cluster middle narrow lobe ("ด-เดี๋ยว ก่อนสิ!")
        box: [115, 822, 165, 862],
        t: "ด-เดี๋ยว ก่อนสิ!",
      },
      {
        // 5: Right cluster lower-middle lobe
        box: [195, 760, 260, 845],
        t: "แล้วทำไมถึงมีกล้องด้วยเนี่ย?!",
      },
      {
        // 6: Right strip top
        box: [18, 862, 110, 932],
        t: "ก็เราเป็นเพื่อนซี้กันนี่นา ใช่ไหมล่ะ?",
      },
      {
        // 7: Right strip middle
        box: [118, 865, 195, 932],
        t: "แล้วฉันจะปฏิเสธได้ยังไงล่ะ!",
      },
      {
        // 8: Right strip bottom
        box: [205, 862, 285, 932],
        t: "ปล่อยให้เป็นหน้าที่ฉันเอง!",
      },
    ];

    const res = autoOrganizePageBubbles(fullPage4, iw, ih, { forceRealign: true });
    expect(detectBubbleCollisions(res.optimizedBubbles, iw, ih).length).toBe(0);

    // 1. Top-left camera box ("กำลังบันทึกภาพอยู่...") must stay centered inside its white rectangle,
    // NOT pushed above its original top edge (y = 30/1000 * 1807 = 54px)!
    const camOrig = getBubbleGeometry(fullPage4[0], iw, ih, true);
    const camAdj = res.optimizedBubbles[0].layoutAdjustment!;
    const camCy = camAdj.by + camAdj.bh / 2;
    const camOrigCy = camOrig.y + camOrig.height / 2;
    expect(Math.abs(camCy - camOrigCy)).toBeLessThanOrEqual(24);
    expect(camAdj.by).toBeGreaterThanOrEqual(Math.floor(camOrig.y) - 10);

    // 2. Lower-left tall vertical oval ("เราจะเปลี่ยนจากลุคยอมคนเดิมๆ...") must keep a vertical
    // silhouette (width <= 1.55x original width, height > width) instead of sprawling 2.35x across hair!
    const lowLeftOrig = getBubbleGeometry(fullPage4[2], iw, ih, true);
    const lowLeftAdj = res.optimizedBubbles[2].layoutAdjustment!;
    expect(lowLeftAdj.bw).toBeLessThanOrEqual(Math.round(lowLeftOrig.width * 1.55));
    expect(lowLeftAdj.bh).toBeGreaterThan(lowLeftAdj.bw);

    // 3. Upper-left oval ("ถามอะไรเนี่ย?...") must stay horizontally centered near its balloon center
    const upLeftOrig = getBubbleGeometry(fullPage4[1], iw, ih, true);
    const upLeftAdj = res.optimizedBubbles[1].layoutAdjustment!;
    const upLeftCx = upLeftAdj.bx + upLeftAdj.bw / 2;
    const upLeftOrigCx = upLeftOrig.x + upLeftOrig.width / 2;
    expect(Math.abs(upLeftCx - upLeftOrigCx)).toBeLessThanOrEqual(28);

    // 4. Middle narrow lobe ("ด-เดี๋ยว ก่อนสิ!") and lower lobe ("แล้วทำไมถึงมีกล้องด้วยเนี่ย?!")
    // must NOT be crushed into tiny 11px-13px fonts while neighbors are 24px!
    const fsMiddle = res.optimizedBubbles[4].targetFontSize!;
    const fsLowerMiddle = res.optimizedBubbles[5].targetFontSize!;
    const fsLeftLobe = res.optimizedBubbles[3].targetFontSize!;
    const fsRightTop = res.optimizedBubbles[6].targetFontSize!;
    expect(fsMiddle).toBeGreaterThanOrEqual(16);
    expect(fsLowerMiddle).toBeGreaterThanOrEqual(16);
    expect(Math.abs(fsRightTop - fsMiddle)).toBeLessThanOrEqual(6);
    expect(Math.abs(fsLeftLobe - fsMiddle)).toBeLessThanOrEqual(6);
  });
});




