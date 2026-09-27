import { afterEach, describe, expect, it, vi } from "vitest";
import { scanPageGeometry } from "@/lib/export/readabilityScan";
import { sampleGlyphBackground } from "@/lib/export/readabilityGlyphSampler";

vi.mock("@/lib/export/readabilityGlyphSampler", () => ({ sampleGlyphBackground: vi.fn() }));

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
    Object.defineProperty(document, "fonts", { configurable: true, value: {
      load: vi.fn().mockResolvedValue([{}]), check: vi.fn(() => true),
    } });
    vi.mocked(sampleGlyphBackground).mockReturnValue({
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

  it("reports unavailable when the requested font is missing", async () => {
    vi.stubGlobal("Image", LoadedImage);
    Object.defineProperty(document, "fonts", { configurable: true, value: {
      load: vi.fn().mockResolvedValue([]), check: vi.fn(() => false),
    } });
    const result = await scanPageGeometry({
      pageUrl: "source", pageIndex: 0,
      bubbles: [{ id: "text", t: "สวัสดี", box: [100, 100, 200, 300] }],
    });
    expect(result.unavailableReason).toContain("ฟอนต์");
  });
});
