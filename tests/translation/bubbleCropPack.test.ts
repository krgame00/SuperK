import { describe, expect, test } from "vitest";
import {
  MAX_BUBBLE_CROPS,
  planBubbleCrops,
  remapCropBubbleBox,
} from "../../lib/translation/bubbleCropPack";
import {
  buildCropPackParts,
  parseCropPack,
} from "../../src/app/api/translate/handler";

describe("Bubble Crop Pack planning (Ladder Phase 2)", () => {
  const PAGE_WIDTH = 1000;
  const PAGE_HEIGHT = 1600;

  test("returns null when there are no usable regions", () => {
    expect(planBubbleCrops([], PAGE_WIDTH, PAGE_HEIGHT)).toBeNull();
    expect(
      planBubbleCrops([{ x: 0, y: 0, width: 4, height: 4 }], PAGE_WIDTH, PAGE_HEIGHT),
    ).toBeNull();
    expect(planBubbleCrops([{ x: 0, y: 0, width: 100, height: 100 }], 0, PAGE_HEIGHT)).toBeNull();
  });

  test("pads and clamps crops to the page bounds", () => {
    const plan = planBubbleCrops(
      [{ x: 0, y: 0, width: 100, height: 80 }],
      PAGE_WIDTH,
      PAGE_HEIGHT,
    );
    expect(plan).not.toBeNull();
    const crop = plan!.crops[0];
    expect(crop.index).toBe(1);
    expect(crop.rect.x).toBe(0);
    expect(crop.rect.y).toBe(0);
    expect(crop.rect.width).toBeGreaterThan(100);
    expect(crop.rect.height).toBeGreaterThan(80);
    expect(crop.rect.x + crop.rect.width).toBeLessThanOrEqual(PAGE_WIDTH);
    expect(crop.rect.y + crop.rect.height).toBeLessThanOrEqual(PAGE_HEIGHT);
  });

  test("merges nearby regions into a single crop", () => {
    const plan = planBubbleCrops(
      [
        { x: 100, y: 100, width: 120, height: 60 },
        { x: 110, y: 130, width: 120, height: 60 },
      ],
      PAGE_WIDTH,
      PAGE_HEIGHT,
    );
    expect(plan!.crops).toHaveLength(1);
  });

  test("keeps distant regions as separate crops in reading order", () => {
    const plan = planBubbleCrops(
      [
        { x: 600, y: 900, width: 150, height: 80 },
        { x: 100, y: 100, width: 150, height: 80 },
        { x: 500, y: 110, width: 150, height: 80 },
      ],
      PAGE_WIDTH,
      PAGE_HEIGHT,
    );
    expect(plan!.crops).toHaveLength(3);
    // Top row first (both y≈100 crops, left before right), then the lower one.
    expect(plan!.crops[0].rect.x).toBeLessThan(plan!.crops[1].rect.x);
    expect(plan!.crops[2].rect.y).toBeGreaterThan(plan!.crops[0].rect.y);
    expect(plan!.crops.map((c) => c.index)).toEqual([1, 2, 3]);
  });

  test("returns null when regions exceed the crop cap after merging", () => {
    const regions = Array.from({ length: MAX_BUBBLE_CROPS + 5 }, (_, i) => ({
      x: (i % 5) * 200,
      y: Math.floor(i / 5) * 300,
      width: 60,
      height: 40,
    }));
    expect(planBubbleCrops(regions, PAGE_WIDTH, PAGE_HEIGHT)).toBeNull();
  });
});

describe("remapCropBubbleBox", () => {
  test("maps a full-crop box to the crop's page footprint", () => {
    const crop = { x: 200, y: 400, width: 400, height: 200 };
    const box = remapCropBubbleBox([0, 0, 1000, 1000], crop, 1000, 1600);
    expect(box).toEqual([250, 200, 375, 600]);
  });

  test("maps the crop center to the expected page position", () => {
    const crop = { x: 200, y: 400, width: 400, height: 200 };
    const box = remapCropBubbleBox([500, 500, 500, 500], crop, 1000, 1600);
    expect(box[0]).toBe(313); // (400 + 0.5*200) / 1600 * 1000 = 312.5 → 313
    expect(box[1]).toBe(400); // (200 + 0.5*400) / 1000 * 1000
  });

  test("clamps out-of-range model output to 0–1000", () => {
    const crop = { x: 900, y: 1500, width: 100, height: 100 };
    const box = remapCropBubbleBox([-50, -50, 1200, 1200], crop, 1000, 1600);
    expect(box.every((v) => v >= 0 && v <= 1000)).toBe(true);
  });
});

describe("crop pack request helpers (handler)", () => {
  test("buildCropPackParts puts context first, then crops in order", () => {
    const parts = buildCropPackParts("PROMPT", "CTX", "image/png", ["C1", "C2"]);
    expect(parts).toHaveLength(4);
    expect((parts[0] as { text: string }).text).toContain("PROMPT");
    expect((parts[0] as { text: string }).text).toContain("CROP PACK MODE");
    expect(parts[1]).toEqual({ inlineData: { mimeType: "image/png", data: "CTX" } });
    expect(parts[2]).toEqual({ inlineData: { mimeType: "image/jpeg", data: "C1" } });
    expect(parts[3]).toEqual({ inlineData: { mimeType: "image/jpeg", data: "C2" } });
  });

  test("parseCropPack accepts a valid pack and rejects malformed ones", () => {
    expect(parseCropPack(undefined)).toBeNull();
    expect(parseCropPack({ crops: [{ base64: "AAA" }, { base64: "BBB" }] })).toEqual([
      "AAA",
      "BBB",
    ]);
    expect(parseCropPack({ crops: [] })).toBeNull();
    expect(parseCropPack({ crops: [{ base64: 42 }] })).toBeNull();
    expect(parseCropPack({ crops: "nope" })).toBeNull();
    expect(parseCropPack("nope")).toBeNull();
    const tooMany = {
      crops: Array.from({ length: MAX_BUBBLE_CROPS + 1 }, () => ({ base64: "AAA" })),
    };
    expect(parseCropPack(tooMany)).toBeNull();
  });
});
