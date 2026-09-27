import { describe, expect, it } from "vitest";
import { assessPageGeometry } from "@/lib/export/readabilityScan";

describe("pre-export text geometry", () => {
  it("warns about text that cannot fit a manually sized drawing area", () => {
    const result = assessPageGeometry({
      pageUrl: "page-a",
      pageIndex: 0,
      width: 1000,
      height: 1400,
      bubbles: [{
        id: "long",
        t: "ข้อความภาษาไทยยาวมากจนไม่สามารถจัดลงในกรอบข้อความขนาดเล็กนี้ได้",
        box: [100, 100, 200, 300],
        layoutAdjustment: { bx: 100, by: 140, bw: 38, bh: 20, iw: 1000, ih: 1400 },
      }],
    });

    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ bubbleId: "id-long", kind: "overflow" }),
    ]));
  });

  it("warns only below 75 percent of the readable minimum and ignores deleted text", () => {
    const result = assessPageGeometry({
      pageUrl: "page-a",
      pageIndex: 0,
      width: 1000,
      height: 1400,
      bubbles: [
        { id: "small", t: "สวัสดี", box: [100, 100, 200, 300], fontSizeMultiplier: 0.2,
          layoutAdjustment: { bx: 100, by: 140, bw: 220, bh: 100, iw: 1000, ih: 1400 } },
        { id: "deleted", t: "ข้อความ", deleted: true, box: [100, 100, 200, 300] },
        { id: "empty", t: " ", box: [100, 100, 200, 300] },
      ],
    });

    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ bubbleId: "id-small", kind: "small-text", threshold: 17.25 }),
    ]));
    expect(result.findings.every((finding) => finding.bubbleId !== "id-deleted" && finding.bubbleId !== "id-empty")).toBe(true);
  });

  it("does not call a page with unavailable dimensions readable", () => {
    const result = assessPageGeometry({
      pageUrl: "page-a", pageIndex: 0, width: 0, height: 0,
      bubbles: [{ id: "dialogue", t: "สวัสดี", box: [100, 100, 200, 300] }],
    });
    expect(result.unavailableReason).toBe("ไม่ทราบขนาดภาพ");
  });

  it("uses the renderer's staggered fallback positions and persisted legacy font size", () => {
    const result = assessPageGeometry({
      pageUrl: "page-a", pageIndex: 0, width: 1000, height: 1000,
      bubbles: [
        { id: "first", t: "แรก", box: [0, 0, 1000, 1000] },
        { id: "second", t: "สอง", box: [0, 0, 1000, 1000] },
      ],
      adjustments: {
        "id-second": { bx: 250, by: 300, bw: 200, bh: 50, iw: 1000, ih: 1000, fontSizeMultiplier: 0.1 },
      },
    });
    expect(result.measurements?.[0].top).toBeLessThan(150);
    expect(result.measurements?.[1].top).toBe(300);
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ bubbleId: "id-second", kind: "small-text" }),
    ]));
  });
});
