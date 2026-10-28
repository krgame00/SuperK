import { describe, expect, it, vi } from "vitest";
import { createRegionMaskBlob } from "@/lib/cleaning/maskUtils";

describe("createRegionMaskBlob", () => {
  it("creates a mask blob with correct dimensions and bounds", async () => {
    let fillRectCalls: Array<[number, number, number, number]> = [];
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
});
