import { describe, expect, it } from "vitest";
import {
  boxesFromBubbles,
  snapBoxesToImageBalloons,
  type RawImageData,
} from "@/lib/balloonSnap";
import type { TranslatedBubble } from "@/lib/overlay/overlayTypes";

/** Synthetic grayscale page: white ellipse balloon with a dark outline over a mid-gray page. */
function makeBalloonPage(opts: {
  width: number;
  height: number;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  bgLum?: number;
}): RawImageData {
  const { width, height, cx, cy, rx, ry } = opts;
  const bgLum = opts.bgLum ?? 120;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const d2 = dx * dx + dy * dy;
      let lum = bgLum;
      if (d2 <= 1) lum = 245;
      if (d2 > 0.86 && d2 <= 1.0) lum = 30; // balloon outline
      const i = (y * width + x) * 4;
      data[i] = lum;
      data[i + 1] = lum;
      data[i + 2] = lum;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

const toNorm = (
  ymin: number,
  xmin: number,
  ymax: number,
  xmax: number,
  w: number,
  h: number,
): [number, number, number, number] => [
  Math.round((ymin / h) * 1000),
  Math.round((xmin / w) * 1000),
  Math.round((ymax / h) * 1000),
  Math.round((xmax / w) * 1000),
];

const fromNorm = (
  box: [number, number, number, number],
  w: number,
  h: number,
) => ({
  ymin: (box[0] / 1000) * h,
  xmin: (box[1] / 1000) * w,
  ymax: (box[2] / 1000) * h,
  xmax: (box[3] / 1000) * w,
});

describe("snapBoxesToImageBalloons", () => {
  it("keeps a box that already covers the balloon", () => {
    const W = 400, H = 600;
    const img = makeBalloonPage({ width: W, height: H, cx: 200, cy: 300, rx: 90, ry: 120 });
    const box = toNorm(180, 110, 420, 290, W, H);
    const out = snapBoxesToImageBalloons(img, [box]);
    expect(out).toHaveLength(1);
    const r = fromNorm(out[0]!, W, H);
    // Snapped box must cover the balloon body (inside outline ring)
    expect(r.ymin).toBeLessThanOrEqual(195);
    expect(r.xmin).toBeLessThanOrEqual(115);
    expect(r.ymax).toBeGreaterThanOrEqual(405);
    expect(r.xmax).toBeGreaterThanOrEqual(285);
  });

  it("expands a small corner box to cover the whole balloon", () => {
    const W = 400, H = 600;
    const img = makeBalloonPage({ width: W, height: H, cx: 200, cy: 300, rx: 90, ry: 120 });
    // Box = top-left quadrant of the balloon only
    const box = toNorm(190, 115, 300, 200, W, H);
    const out = snapBoxesToImageBalloons(img, [box]);
    expect(out[0]).not.toBeNull();
    const r = fromNorm(out[0]!, W, H);
    expect(r.ymax).toBeGreaterThanOrEqual(395);
    expect(r.xmax).toBeGreaterThanOrEqual(280);
    // Never shrink below the original box (±1px slack for 0-1000 rounding)
    expect(r.ymin).toBeLessThanOrEqual(191.5);
    expect(r.xmin).toBeLessThanOrEqual(116.5);
  });

  it("returns null on white paper leak (no balloon outline to stop the fill)", () => {
    const W = 400, H = 600;
    const img = makeBalloonPage({ width: W, height: H, cx: 200, cy: 300, rx: 90, ry: 120, bgLum: 245 });
    const box = toNorm(180, 110, 420, 290, W, H);
    const out = snapBoxesToImageBalloons(img, [box]);
    expect(out[0]).toBeNull();
  });

  it("returns null when the box area has no white seeds (dark artwork)", () => {
    const W = 400, H = 600;
    const img = makeBalloonPage({ width: W, height: H, cx: 200, cy: 300, rx: 90, ry: 120 });
    // Box far from the balloon, over dark background
    const box = toNorm(20, 20, 90, 90, W, H);
    const out = snapBoxesToImageBalloons(img, [box]);
    expect(out[0]).toBeNull();
  });

  it("handles independent boxes in one pass and skips null inputs", () => {
    const W = 400, H = 600;
    const img = makeBalloonPage({ width: W, height: H, cx: 200, cy: 150, rx: 80, ry: 100 });
    const boxA = toNorm(60, 125, 240, 275, W, H);
    const out = snapBoxesToImageBalloons(img, [boxA, null]);
    expect(out).toHaveLength(2);
    expect(out[0]).not.toBeNull();
    expect(out[1]).toBeNull();
  });
});

describe("boxesFromBubbles", () => {
  const bubble = (overrides: Partial<TranslatedBubble>): TranslatedBubble =>
    ({ t: "hello", box: [100, 200, 300, 400], ...overrides }) as TranslatedBubble;

  it("maps valid dialogue boxes to normalized input", () => {
    const boxes = boxesFromBubbles([bubble({})]);
    expect(boxes[0]).toEqual([100, 200, 300, 400]);
  });

  it("skips SFX-flagged bubbles", () => {
    const boxes = boxesFromBubbles(
      [bubble({ sfx: true }), bubble({ is_sfx: true }), bubble({ isSfx: true }), bubble({})],
    );
    expect(boxes[0]).toBeNull();
    expect(boxes[1]).toBeNull();
    expect(boxes[2]).toBeNull();
    expect(boxes[3]).not.toBeNull();
  });

  it("skips invalid or missing boxes", () => {
    const boxes = boxesFromBubbles(
      [bubble({ box: undefined }), bubble({ box: [0, 0, 1000, 1000] }), bubble({ isInvalidBox: true }), bubble({ deleted: true })],
    );
    expect(boxes[0]).toBeNull();
    expect(boxes[1]).toBeNull();
    expect(boxes[2]).toBeNull();
    expect(boxes[3]).toBeNull();
  });
});
