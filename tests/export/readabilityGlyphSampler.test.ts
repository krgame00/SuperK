import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleGlyphBackground } from "@/lib/export/readabilityGlyphSampler";
import { sampleRectRegion } from "@/lib/colorMatching/canvasSampler";

vi.mock("@/lib/colorMatching/canvasSampler", () => ({ sampleRectRegion: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

describe("glyph background sampling", () => {
  it("uses only pixels under glyphs, excluding the surrounding rectangle", () => {
    vi.mocked(sampleRectRegion).mockReturnValue({
      width: 8, height: 2,
      rgba: new Uint8ClampedArray(Array.from({ length: 16 }, (_, index) =>
        index < 4 ? [0, 0, 0, 255] : [255, 255, 255, 255]).flat()),
    });
    const mask = new Uint8ClampedArray(8 * 2 * 4);
    for (let pixel = 0; pixel < 4; pixel++) mask[pixel * 4 + 3] = 255;
    const context = {
      translate: vi.fn(), rotate: vi.fn(), fillText: vi.fn(),
      getImageData: vi.fn(() => ({ data: mask })),
    };
    vi.spyOn(document, "createElement").mockReturnValue({ getContext: () => context } as never);
    const image = { naturalWidth: 100, naturalHeight: 100 } as HTMLImageElement;
    const sample = sampleGlyphBackground(image, {
      left: 20, top: 20, width: 8, height: 2, rotation: 0,
      lines: ["text"], fontSize: 10, lineHeight: 12, fontFamily: "Itim",
    });
    expect(sample?.width).toBe(4);
    expect([...sample!.rgba]).toEqual(Array.from({ length: 4 }, () => [0, 0, 0, 255]).flat());
  });
});
