import { describe, expect, it } from "vitest";
import {
  computePermutationFromSeed,
  computeRemainderPadding,
  generateTileMappings,
  invertPermutation,
  isKnownScrambledDomain,
} from "@/lib/extension/descrambler";
import {
  panelSpatialDominates,
  sortBubblesHierarchicalDAG,
  type PanelBox,
} from "@/lib/translation/panelReadingFlowDAG";
import {
  classifyPolygonGeometry,
  resolveCategoryTypography,
} from "@/lib/typography/comicTypography";
import {
  extractSpeakerAndDialogue,
  MonotonicSlidingWindowDebounce,
} from "@/lib/vn/monotonicDebounce";
import { sanitizeTranslationPayloadJson } from "@/lib/translation/sanitizer";

describe("SuperK Next-Gen Unified Framework End-to-End Pipeline (Blueprint Phase 4)", () => {
  it("orchestrates all 4 architectural dimensions seamlessly in unified end-to-end flow", () => {
    // -------------------------------------------------------------------------
    // STEP 1 (Module 1): Web Manga De-scramble Validation
    // -------------------------------------------------------------------------
    expect(isKnownScrambledDomain("https://shonenjumpplus.com/episode/12345")).toBe(true);

    const W_total = 803;
    const H_total = 1205;
    const N = 4;
    const M = 4;
    const padding = computeRemainderPadding(W_total, H_total, N, M);
    expect(padding.blockW).toBe(200);
    expect(padding.blockH).toBe(301);
    expect(padding.rw).toBe(3);
    expect(padding.rh).toBe(1);

    const perm = computePermutationFromSeed(16, 7, 5);
    const inv = invertPermutation(perm);
    for (let i = 0; i < 16; i++) {
      expect(inv[perm[i]]).toBe(i);
    }
    const tileSlices = generateTileMappings(W_total, H_total, {
      grid: { cols: N, rows: M },
      tileMap: perm,
    });
    // 16 core tiles + 3 remainder strips = 19 slices
    expect(tileSlices).toHaveLength(19);

    // -------------------------------------------------------------------------
    // STEP 2 (Module 2): Panel Topological DAG & Intra-Panel Sorting
    // -------------------------------------------------------------------------
    const panelRight: PanelBox = {
      id: "panel-right",
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
      id: "panel-left",
      top: 50,
      left: 50,
      bottom: 450,
      right: 480,
      width: 430,
      height: 400,
      centerX: 265,
      centerY: 250,
    };

    expect(panelSpatialDominates(panelRight, panelLeft)).toBe(true);

    // Staggered dialogue bubbles:
    // Right panel: A1 (Y=50) -> A2 (Y=200)
    // Left panel:  B1 (Y=100) -> B2 (Y=300)
    const rawDetectedBubbles = [
      { id: "B1", t: "ข้อความซ้ายบน (ตอบกลับ)", box: [90, 200, 130, 350] },
      { id: "A2", t: "ข้อความขวาล่าง (พูดต่อ)", box: [180, 600, 220, 750] },
      { id: "B2", t: "ข้อความซ้ายล่าง", box: [280, 100, 320, 250] },
      { id: "A1", t: "ข้อความขวาบน (เปิดฉาก)", box: [40, 700, 80, 850] },
    ];

    const sortedBubbles = sortBubblesHierarchicalDAG(rawDetectedBubbles, {
      panels: [panelRight, panelLeft],
    });

    // Right-panel dialogue strictly precedes Left-panel dialogue
    expect(sortedBubbles.map((b) => b.id)).toEqual(["A1", "A2", "B1", "B2"]);

    // -------------------------------------------------------------------------
    // STEP 3 (Module 3): Bubble Contour Archetype Classification & Typography
    // -------------------------------------------------------------------------
    // Shouting Starburst Polygon: [x, y][]
    const shoutingPolygon: [number, number][] = [
      [100, 50],
      [130, 70],
      [170, 40],
      [150, 90],
      [190, 120],
      [140, 130],
      [150, 180],
      [110, 150],
      [70, 190],
      [80, 140],
      [30, 120],
      [70, 90],
      [50, 50],
      [90, 70],
    ];
    const classifiedResult = classifyPolygonGeometry(shoutingPolygon);
    expect(classifiedResult.category).toBe("shouting");

    const typography = resolveCategoryTypography(classifiedResult.category, 24);
    expect(typography.fontWeight).toBe("800");
    expect(typography.dynamicStrokeWidth).toBeGreaterThanOrEqual(2.5);
    expect(typography.warpConfig).toEqual({ type: "bulge", bend: 0.35 });

    // -------------------------------------------------------------------------
    // STEP 4 (Module 4): Visual Novel Monotonic Debounce & Speaker Extraction
    // -------------------------------------------------------------------------
    const parsedSpeaker = extractSpeakerAndDialogue("【ルフィ】海賊王に俺はなる！");
    expect(parsedSpeaker.speakerName).toBe("ルフィ");
    expect(parsedSpeaker.dialogue).toBe("海賊王に俺はなる！");

    const emittedVNFrames: string[] = [];
    const debounce = new MonotonicSlidingWindowDebounce({
      stabilityThresholdMs: 50,
      onEmit: (frame) => emittedVNFrames.push(frame.rawText),
    });

    // Push progressive typewriter stream
    debounce.pushFrame({ rawText: "ฉัน" });
    debounce.pushFrame({ rawText: "ฉันจะ" });
    debounce.pushFrame({ rawText: "ฉันจะเป็น" });
    debounce.pushFrame({ rawText: "ฉันจะเป็นราชา" });
    debounce.pushFrame({ rawText: "ฉันจะเป็นราชาโจรสลัด!" });

    // Flush debounce buffer
    const finalFrame = debounce.flush();
    expect(finalFrame?.rawText).toBe("ฉันจะเป็นราชาโจรสลัด!");

    // -------------------------------------------------------------------------
    // STEP 5: Translation Sanitizer & DAG Order Preservation
    // -------------------------------------------------------------------------
    const rawGeminiResponse = JSON.stringify({
      bubbles: [
        { id: "B1", t: "そうですか ใช่หรือเปล่า", box: [90, 200, 130, 350] },
        { id: "A1", t: "おはよう สวัสดีตอนเช้า", box: [40, 700, 80, 850] },
      ],
    });

    const sanitizedJson = sanitizeTranslationPayloadJson(rawGeminiResponse, "th");
    const parsedSanitized = JSON.parse(sanitizedJson);

    // CJK echo stripped
    expect(parsedSanitized.bubbles[0].t).toBe("สวัสดีตอนเช้า");
    expect(parsedSanitized.bubbles[1].t).toBe("ใช่หรือเปล่า");
    // Canonical RTL reading order preserved
    expect(parsedSanitized.bubbles[0].id).toBe("A1");
    expect(parsedSanitized.bubbles[1].id).toBe("B1");
  });
});
