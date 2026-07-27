import { readFileSync } from "node:fs";

import { expect, test } from "vitest";

test("translation overlay contains no browser-side inpainting", () => {
  const source = readFileSync("lib/translationOverlay.ts", "utf8");
  expect(source).not.toContain("cv.worker");
  expect(source).not.toContain("inpainted-bg");
  expect(source).not.toMatch(/brightness\s*[<>]/);
  expect(source).toContain('className = "tl-canvas"');
});
