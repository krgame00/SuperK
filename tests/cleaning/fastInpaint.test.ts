import { describe, it, expect, vi, beforeEach } from "vitest";
import { dilateMask } from "@/lib/cleaning/maskEdits";
import { inpaintCrop, CleaningClientError } from "@/lib/cleaning/client";

function createMockImageData(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  return new ImageData(data, width, height);
}

describe("Fast-Path Inpaint and Mask Dilation (Option 3)", () => {
  describe("dilateMask", () => {
    it("returns unchanged mask when radius is 0 or negative", () => {
      const mask = createMockImageData(10, 10);
      mask.data[0] = 255;
      mask.data[3] = 255;
      const dilated = dilateMask(mask, 0);
      expect(dilated).toBe(mask);
    });

    it("expands single active pixel by given radius", () => {
      const mask = createMockImageData(20, 20);
      const centerX = 10;
      const centerY = 10;
      const centerOffset = (centerY * 20 + centerX) * 4;
      mask.data[centerOffset] = 255;
      mask.data[centerOffset + 1] = 55;
      mask.data[centerOffset + 2] = 80;
      mask.data[centerOffset + 3] = 255;

      const dilated = dilateMask(mask, 3);
      expect(dilated.width).toBe(20);
      expect(dilated.height).toBe(20);

      // Center should still be active
      expect(dilated.data[centerOffset + 3]).toBe(255);

      // Point at distance 2 should now be active
      const nearOffset = (centerY * 20 + (centerX + 2)) * 4;
      expect(dilated.data[nearOffset + 3]).toBe(255);
      expect(dilated.data[nearOffset]).toBe(255);

      // Point at distance 5 should remain inactive
      const farOffset = (centerY * 20 + (centerX + 5)) * 4;
      expect(dilated.data[farOffset + 3]).toBe(0);
    });

    it("constrains dilation within the specified rect", () => {
      const mask = createMockImageData(30, 30);
      // Place pixel near rect edge
      const px = 10;
      const py = 10;
      const offset = (py * 30 + px) * 4;
      mask.data[offset] = 255;
      mask.data[offset + 3] = 255;

      // Constrain to rect: x: 8..15, y: 8..15
      const rect = { x: 8, y: 8, width: 7, height: 7 };
      const dilated = dilateMask(mask, 4, rect);

      // Inside rect (e.g. x: 12) should be dilated
      const insideOffset = (py * 30 + 12) * 4;
      expect(dilated.data[insideOffset + 3]).toBe(255);

      // Outside rect (e.g. x: 5) should NOT be dilated even though within radius 4
      const outsideOffset = (py * 30 + 5) * 4;
      expect(dilated.data[outsideOffset + 3]).toBe(0);
    });
  });

  describe("inpaintCrop client", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("makes POST request to /api/clean/v1/clean/crop with correct FormData", async () => {
      const fakeBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
      const fakeResult = new Blob([new Uint8Array([4, 5, 6])], { type: "image/png" });

      let capturedUrl = "";
      let capturedBody: FormData | null = null;

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
        capturedUrl = url;
        capturedBody = init.body as FormData;
        return {
          ok: true,
          status: 200,
          blob: async () => fakeResult,
        } as Response;
      });

      const result = await inpaintCrop(fakeBlob, fakeBlob, {
        cleaner: "lama-large",
        dilation: 3,
      });

      expect(capturedUrl).toBe("/api/clean/v1/clean/crop");
      expect(capturedBody).toBeInstanceOf(FormData);
      const form = capturedBody as unknown as FormData;
      expect(form.get("cleaner")).toBe("lama-large");
      expect(form.get("dilation")).toBe("3");
      expect(result).toBe(fakeResult);
    });

    it("appends extend_hints and feather_blend when specified", async () => {
      const fakeBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
      let capturedBody: FormData | null = null;

      globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        capturedBody = init.body as FormData;
        return {
          ok: true,
          status: 200,
          blob: async () => fakeBlob,
        } as Response;
      });

      await inpaintCrop(fakeBlob, fakeBlob, {
        extendHints: true,
        featherBlend: true,
      });

      const form = capturedBody as unknown as FormData;
      expect(form.get("extend_hints")).toBe("true");
      expect(form.get("feather_blend")).toBe("true");
    });

    it("throws CleaningClientError on non-ok response", async () => {
      const fakeBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ detail: "Dimensions mismatch" }),
      } as Response);

      await expect(inpaintCrop(fakeBlob, fakeBlob)).rejects.toThrow(CleaningClientError);
    });
  });
});
