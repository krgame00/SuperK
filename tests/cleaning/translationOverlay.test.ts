import { readFileSync } from "node:fs";

import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  applyTranslationOverlay,
  downloadTranslatedImage,
} from "@/lib/translationOverlay";

test("translation overlay contains no browser-side inpainting", () => {
  const source = readFileSync("lib/translationOverlay.ts", "utf8");
  expect(source).not.toContain("cv.worker");
  expect(source).not.toContain("inpainted-bg");
  expect(source).not.toMatch(/brightness\s*[<>]/);
  expect(source).toContain('className = "tl-canvas"');
});

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { load: vi.fn().mockResolvedValue([]) },
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    new Proxy(
      {
        measureText: () => ({ width: 20 }),
      },
      {
        get(target, property) {
          if (property in target) {
            return target[property as keyof typeof target];
          }
          return vi.fn();
        },
        set() {
          return true;
        },
      },
    ) as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/jpeg;base64,dHJhbnNsYXRlZA==",
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

test("uses an explicit container for overlay and export", async () => {
  const decoy = document.createElement("div");
  decoy.id = "offscreen-container";
  document.body.appendChild(decoy);

  const explicitContainer = document.createElement("div");
  const image = document.createElement("img");
  Object.defineProperties(image, {
    complete: { configurable: true, value: true },
    naturalWidth: { configurable: true, value: 1000 },
    naturalHeight: { configurable: true, value: 1200 },
  });
  explicitContainer.appendChild(image);
  document.body.appendChild(explicitContainer);

  const onComplete = vi.fn();
  await applyTranslationOverlay(
    [{ box: [100, 100, 300, 400], t: "สวัสดี" }],
    "offscreen",
    0,
    vi.fn(),
    onComplete,
    {
      current: {
        fontFamily: "Itim, sans-serif",
        textColor: "#000000",
        textOutline: "#ffffff",
        fontSizeMultiplier: 1,
      },
    },
    explicitContainer,
  );
  await vi.runAllTimersAsync();

  expect(explicitContainer.querySelector(".tl-canvas")).not.toBeNull();
  expect(decoy.querySelector(".tl-canvas")).toBeNull();
  expect(onComplete).toHaveBeenCalledWith(
    "data:image/jpeg;base64,dHJhbnNsYXRlZA==",
  );
  expect(
    downloadTranslatedImage(
      "offscreen",
      0,
      "",
      true,
      explicitContainer,
    ),
  ).toBe("data:image/jpeg;base64,dHJhbnNsYXRlZA==");
});
