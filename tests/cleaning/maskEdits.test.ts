import { expect, test } from "vitest";

import { applyBrush } from "@/lib/cleaning/maskEdits";

function mask(width: number, height: number, alpha: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = 255;
    data[index * 4 + 3] = alpha;
  }
  return new ImageData(data, width, height);
}

function alphaAt(image: ImageData, x: number, y: number): number {
  return image.data[(y * image.width + x) * 4 + 3];
}

test("eraser clears only pixels inside brush radius", () => {
  const edited = applyBrush(
    mask(20, 20, 255),
    [{ x: 10, y: 10 }],
    3,
    "erase",
  );
  expect(alphaAt(edited, 10, 10)).toBe(0);
  expect(alphaAt(edited, 0, 0)).toBe(255);
});

test("paint clips brush at image boundary", () => {
  expect(() =>
    applyBrush(mask(10, 10, 0), [{ x: 0, y: 0 }], 8, "paint"),
  ).not.toThrow();
});

test("restore brush copies exact RGBA pixels from source to clean image", async () => {
  const { applyRestoreBrush } = await import("@/lib/cleaning/maskEdits");
  const cleanData = new Uint8ClampedArray(10 * 10 * 4); // All zeros (black/transparent)
  const clean = new ImageData(cleanData, 10, 10);

  const srcData = new Uint8ClampedArray(10 * 10 * 4);
  for (let i = 0; i < 100; i++) {
    srcData[i * 4] = 200;     // R
    srcData[i * 4 + 1] = 150; // G
    srcData[i * 4 + 2] = 100; // B
    srcData[i * 4 + 3] = 255; // A
  }
  const source = new ImageData(srcData, 10, 10);

  const restored = applyRestoreBrush(clean, source, [{ x: 5, y: 5 }], 2);
  const targetOffset = (5 * 10 + 5) * 4;
  expect(restored.data[targetOffset]).toBe(200);
  expect(restored.data[targetOffset + 1]).toBe(150);
  expect(restored.data[targetOffset + 2]).toBe(100);
  expect(restored.data[targetOffset + 3]).toBe(255);

  // Outside radius should remain untouched (0)
  const cornerOffset = 0;
  expect(restored.data[cornerOffset]).toBe(0);
});
