import { describe, expect, it, vi } from "vitest";
import { createRegionMaskBlob, createInkMaskBlob, extractGlyphInk } from "@/lib/cleaning/maskUtils";

function lumaFrom(rows: string[]): Uint8Array {
  const h = rows.length;
  const w = rows[0].length;
  const luma = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      luma[y * w + x] = rows[y][x] === "#" ? 30 : 230;
    }
  }
  return luma;
}

function inkToString(ink: Uint8Array, w: number, h: number): string[] {
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    let row = "";
    for (let x = 0; x < w; x++) row += ink[y * w + x] === 1 ? "#" : ".";
    rows.push(row);
  }
  return rows;
}

function lumaFromLevels(rows: string[], levels: Record<string, number>): Uint8Array {
  const h = rows.length;
  const w = rows[0].length;
  const luma = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) luma[y * w + x] = levels[rows[y][x]];
  }
  return luma;
}

function rgbaFromLevels(
  rows: string[],
  levels: Record<string, [number, number, number]>,
): Uint8ClampedArray {
  const h = rows.length;
  const w = rows[0].length;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = levels[rows[y][x]];
      const i = (y * w + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

describe("createRegionMaskBlob", () => {
  it("creates a mask blob with correct dimensions and bounds", async () => {
    const fillRectCalls: Array<[number, number, number, number]> = [];
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
      this: HTMLCanvasElement,
      contextId: string,
    ) {
      if (contextId === "2d") {
        return {
          fillStyle: "#000000",
          fillRect: vi.fn((x: number, y: number, w: number, h: number) => {
            fillRectCalls.push([x, y, w, h]);
          }),
        } as unknown as CanvasRenderingContext2D;
      }
      return null;
    });

    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
    ) {
      callback(new Blob(["test-mask"], { type: "image/png" }));
    });

    const blob = await createRegionMaskBlob(800, 1200, {
      x: 100,
      y: 200,
      width: 50,
      height: 60,
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("image/png");
    // First call fills whole canvas with black, second fills rect with white
    expect(fillRectCalls).toEqual([
      [0, 0, 800, 1200],
      [100, 200, 50, 60],
    ]);

    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it("handles fallback if toBlob is undefined", async () => {
    const originalToBlob = HTMLCanvasElement.prototype.toBlob;
    // @ts-expect-error simulating test environment where toBlob is absent
    delete HTMLCanvasElement.prototype.toBlob;

    const blob = await createRegionMaskBlob(100, 100, {
      x: 10,
      y: 10,
      width: 20,
      height: 20,
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("image/png");

    HTMLCanvasElement.prototype.toBlob = originalToBlob;
  });

  it("createInkMaskBlob creates a targeted ink mask with dark pixel detection and dilation", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
    ) {
      callback(new Blob(["ink-mask"], { type: "image/png" }));
    });

    const originalImage = globalThis.Image;
    class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      crossOrigin = "";
      private _src = "";
      set src(value: string) {
        this._src = value;
        setTimeout(() => {
          this.onload?.();
        }, 0);
      }
      get src() {
        return this._src;
      }
    }
    // @ts-expect-error mock Image
    globalThis.Image = MockImage;

    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
      this: HTMLCanvasElement,
      contextId: string,
    ) {
      if (contextId === "2d") {
        return {
          fillStyle: "#000000",
          fillRect: vi.fn(),
          drawImage: vi.fn(),
          getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(100 * 100 * 4) })),
          createImageData: vi.fn(() => ({ data: new Uint8ClampedArray(100 * 100 * 4) })),
          putImageData: vi.fn(),
        } as unknown as CanvasRenderingContext2D;
      }
      return null;
    });

    const blob = await createInkMaskBlob("blob:source", 100, 100, {
      x: 10,
      y: 10,
      width: 30,
      height: 30,
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("image/png");

    HTMLCanvasElement.prototype.getContext = originalGetContext;
    globalThis.Image = originalImage;
  });
});

describe("extractGlyphInk", () => {
  it("keeps glyph-sized components", () => {
    const rows = [
      "....................................",
      "..............####.......####.......",
      "..............####.......####.......",
      "..............####.......####.......",
      "..............####.......####.......",
      "....................................",
    ];
    const result = extractGlyphInk(lumaFrom(rows), 36, 6);
    expect(result.polarity).toBe("dark-on-light");
    expect(result.droppedComponents).toBe(0);
    expect(inkToString(result.ink, 36, 6)).toEqual(rows);
  });

  it("drops a thin diagonal character stroke (ultra sparse)", () => {
    const size = 40;
    const rows = Array.from({ length: size }, (_, y) =>
      Array.from({ length: size }, (_, x) => (x === y ? "#" : ".")).join(""),
    );
    const result = extractGlyphInk(lumaFrom(rows), size, size);
    expect(result.droppedComponents).toBe(1);
    expect(result.ink.every((v) => v === 0)).toBe(true);
  });

  it("drops a huge dark mass such as a hair block", () => {
    const rows = [
      "........................",
      "....################....",
      "....################....",
      "....################....",
      "....################....",
      "....################....",
      "........................",
    ];
    const result = extractGlyphInk(lumaFrom(rows), 24, 7);
    expect(result.droppedComponents).toBe(1);
    expect(result.ink.every((v) => v === 0)).toBe(true);
  });

  it("drops a full-width thin rule bar even when dense", () => {
    const rows = Array.from({ length: 20 }, (_, y) =>
      y === 9 || y === 10 ? "#".repeat(60) : ".".repeat(60),
    );
    const result = extractGlyphInk(lumaFrom(rows), 60, 20);
    expect(result.droppedComponents).toBe(1);
    expect(result.ink.every((v) => v === 0)).toBe(true);
  });

  it("keeps a merged text row that spans the crop", () => {
    const rows = Array.from({ length: 20 }, (_, y) => {
      if (y < 6 || y > 13) return ".".repeat(60);
      let row = "";
      for (let x = 0; x < 60; x++) row += x % 5 === 4 ? "." : "#";
      return row;
    });
    const result = extractGlyphInk(lumaFrom(rows), 60, 20);
    expect(result.droppedComponents).toBe(0);
    expect(result.ink.some((v) => v === 1)).toBe(true);
  });

  it("detects knockout polarity for white text on a dark bubble", () => {
    const rows = Array.from({ length: 30 }, (_, y) => {
      if (y < 10 || y >= 20) return "#".repeat(40);
      return (
        "#".repeat(6) + ".".repeat(8) + "#".repeat(10) + ".".repeat(8) + "#".repeat(8)
      );
    });
    const result = extractGlyphInk(lumaFrom(rows), 40, 30);
    expect(result.polarity).toBe("light-on-dark");
    expect(result.droppedComponents).toBe(0);
    const kept = inkToString(result.ink, 40, 30);
    expect(kept[12].slice(6, 14)).toBe("########");
    expect(kept[12].slice(24, 32)).toBe("########");
    expect(kept[5]).toBe("........................................");
  });

  it("returns empty ink for an ambiguous solid-dark crop", () => {
    const rows = Array.from({ length: 20 }, () => "#".repeat(20));
    const result = extractGlyphInk(lumaFrom(rows), 20, 20);
    expect(result.polarity).toBe("dark-on-light");
    expect(result.ink.every((v) => v === 0)).toBe(true);
  });

  it("separates mid-luma colored text from a dark bubble (Otsu polarity)", () => {
    // Purple text (~luma 123) on a dark green bubble (~luma 50): both fall
    // below the fixed dark cut of 155, so the legacy threshold swallows text
    // and background into one giant component that the artwork filter drops.
    // Otsu must split them and keep the glyphs.
    const rows = Array.from({ length: 30 }, (_, y) => {
      if (y < 10 || y >= 20) return "B".repeat(40);
      return "B".repeat(6) + "T".repeat(8) + "B".repeat(10) + "T".repeat(8) + "B".repeat(8);
    });
    const result = extractGlyphInk(lumaFromLevels(rows, { B: 50, T: 123 }), 40, 30);
    expect(result.polarity).toBe("light-on-dark");
    expect(result.droppedComponents).toBe(0);
    const kept = inkToString(result.ink, 40, 30);
    expect(kept[12].slice(6, 14)).toBe("########");
    expect(kept[12].slice(24, 32)).toBe("########");
    expect(kept[5]).toBe(".".repeat(40));
  });

  it("falls back to chroma distance when luma separation is too weak", () => {
    // Red glyphs on a green bubble at nearly identical luma (~98 vs ~83):
    // luma Otsu cannot separate them, so the chroma-distance pass must.
    const rows = Array.from({ length: 30 }, (_, y) => {
      if (y < 10 || y >= 20) return "B".repeat(40);
      return "B".repeat(6) + "T".repeat(8) + "B".repeat(10) + "T".repeat(8) + "B".repeat(8);
    });
    const rgba = rgbaFromLevels(rows, { B: [40, 110, 60], T: [190, 60, 60] });
    const luma = lumaFromLevels(rows, { B: 83, T: 98 });
    const result = extractGlyphInk(luma, 40, 30, rgba);
    expect(result.polarity).toBe("light-on-dark");
    expect(result.droppedComponents).toBe(0);
    const kept = inkToString(result.ink, 40, 30);
    expect(kept[12].slice(6, 14)).toBe("########");
    expect(kept[12].slice(24, 32)).toBe("########");
    expect(kept[5]).toBe(".".repeat(40));
  });

  it("keeps dense dark text when the background holds the borders", () => {
    // ~67% dark coverage across four glyph blocks: the legacy knockout rule
    // flips polarity and masks the white background instead. The border rule
    // keeps the glyph blocks.
    const rows = Array.from({ length: 30 }, () => ".".repeat(40));
    for (let y = 2; y < 14; y++) {
      rows[y] = ".." + "#".repeat(16) + "..." + "#".repeat(16) + "...";
    }
    for (let y = 16; y < 28; y++) {
      rows[y] = ".." + "#".repeat(16) + "..." + "#".repeat(16) + "...";
    }
    const result = extractGlyphInk(lumaFrom(rows), 40, 30);
    expect(result.polarity).toBe("dark-on-light");
    expect(result.droppedComponents).toBe(0);
    const kept = inkToString(result.ink, 40, 30);
    expect(kept[3]).toBe(".." + "#".repeat(16) + "..." + "#".repeat(16) + "...");
    expect(kept[1]).toBe(".".repeat(40));
    expect(kept[14]).toBe(".".repeat(40));
  });
});
