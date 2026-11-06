import { describe, expect, it } from "vitest";

import { rederiveRegionMaskFromContent } from "@/lib/cleaning/maskRederive";

function makeCrop(lumaRows: string[], chromaRows?: string[]): ImageData {
  const h = lumaRows.length;
  const w = lumaRows[0].length;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      data[p] = lumaRows[y][x] === "#" ? 30 : 235;
      data[p + 1] = data[p];
      data[p + 2] = data[p];
      data[p + 3] = 255;
      if (chromaRows && chromaRows[y][x] === "G") {
        data[p] = 40;
        data[p + 1] = 200;
        data[p + 2] = 90;
      }
    }
  }
  return new ImageData(data, w, h);
}

function makeBaseMask(rows: string[]): ImageData {
  const h = rows.length;
  const w = rows[0].length;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      if (rows[y][x] === "#") {
        data[p] = 255;
        data[p + 1] = 255;
        data[p + 2] = 255;
        data[p + 3] = 255;
      }
    }
  }
  return new ImageData(data, w, h);
}

function maskRows(mask: ImageData): string[] {
  const rows: string[] = [];
  for (let y = 0; y < mask.height; y++) {
    let row = "";
    for (let x = 0; x < mask.width; x++) row += mask.data[(y * mask.width + x) * 4] > 0 ? "#" : ".";
    rows.push(row);
  }
  return rows;
}

describe("rederiveRegionMaskFromContent", () => {
  it("unmasks artwork outside text zones and keeps dark lettering inside an enclosed bubble", () => {
    const cropRows = [
      "....................",
      "....###########.....",
      "....#.........#.....",
      "....#.#######.#.....",
      "....#.#######.#.....",
      "....#.........#.....",
      "....###########.....",
      "....................",
      ".##.................",
      "..##................",
    ];
    const crop = makeCrop(cropRows);
    const base = makeBaseMask(Array.from({ length: 10 }, () => "#".repeat(20)));
    const result = rederiveRegionMaskFromContent({ crop, baseMask: base });
    const rows = maskRows(result.mask);
    // dark lettering inside the enclosed light bubble stays masked
    expect(rows[3][8] === "#" && rows[4][12] === "#").toBe(true);
    // the hand-outline squiggle drawn on the page is artwork: unmasked
    expect(rows[8][1] === "." && rows[9][2] === ".").toBe(true);
    // the bubble wall touching the page is structure, not text: unmasked
    expect(rows[1][8] === ".").toBe(true);
    expect(result.removedPx).toBeGreaterThan(0);
    expect(result.keptPx).toBeGreaterThan(0);
  });

  it("masks colored lettering strokes the base mask missed", () => {
    const crop = makeCrop(
      [
        "....................................",
        "....................................",
        "..........GGGG......................",
        "..........GGGG......................",
        "..........GGGG......................",
        "....................................",
        "....................................",
        "....................................",
      ],
      [
        "....................................",
        "....................................",
        "..........GGGG......................",
        "..........GGGG......................",
        "..........GGGG......................",
        "....................................",
        "....................................",
        "....................................",
      ],
    );
    const base = makeBaseMask([
      "....................................",
      "....................................",
      "....................................",
      "....................................",
      "....................................",
      "....................................",
      "....................................",
      "....................................",
    ]);
    const result = rederiveRegionMaskFromContent({ crop, baseMask: base });
    const rows = maskRows(result.mask);
    expect(rows[3][10] === "#" && rows[3][13] === "#").toBe(true);
    expect(result.addedPx).toBeGreaterThan(0);
  });

  it("keeps the base untouched where the light region touches the crop border (unknown zone)", () => {
    const crop = makeCrop([
      "####################",
      "#..................#",
      "#...####...........#",
      "#...####...........#",
      "#..................#",
      "####################",
    ]);
    const base = makeBaseMask([
      "####################",
      "#..................#",
      "#...####...........#",
      "#...####...........#",
      "#..................#",
      "####################",
    ]);
    const result = rederiveRegionMaskFromContent({ crop, baseMask: base });
    expect(maskRows(result.mask)).toEqual(maskRows(base));
  });
});
