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
