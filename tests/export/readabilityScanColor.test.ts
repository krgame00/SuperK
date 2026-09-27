import { afterEach, describe, expect, it, vi } from "vitest";
import { scanPageGeometry } from "@/lib/export/readabilityScan";
import { sampleRectRegion } from "@/lib/colorMatching/canvasSampler";

vi.mock("@/lib/colorMatching/canvasSampler", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  sampleRectRegion: vi.fn(),
}));

class LoadedImage {
  naturalWidth = 1000;
  naturalHeight = 1000;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_value: string) { queueMicrotask(() => this.onload?.()); }
}

afterEach(() => vi.unstubAllGlobals());

describe("readability scan against clean background", () => {
  it("flags locally unreadable manually styled text", async () => {
    vi.stubGlobal("Image", LoadedImage);
    vi.mocked(sampleRectRegion).mockReturnValue({
      width: 20, height: 1,
      rgba: new Uint8ClampedArray(Array.from({ length: 20 }, () => [0, 0, 0, 255]).flat()),
    });
    const result = await scanPageGeometry({
      pageUrl: "source", backgroundUrl: "clean", pageIndex: 0,
      bubbles: [{ id: "dark", t: "ข้อความ", box: [100, 100, 200, 300],
        styleProfile: { source: "manual", ownershipMode: "manual", fill: "#000000", outline: "#000000", hasOutline: false } }],
    });
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ bubbleId: "id-dark", kind: "color" }),
    ]));
  });
});
