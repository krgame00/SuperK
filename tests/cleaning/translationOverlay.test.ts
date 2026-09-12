import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  applyTranslationOverlay,
  downloadTranslatedImage,
  type TranslatedBubble,
} from "@/lib/translationOverlay";
import { undoManager } from "@/lib/undoManager";

test("translation overlay contains no browser-side inpainting", () => {
  const source = readFileSync("lib/translationOverlay.ts", "utf8");
  expect(source).not.toContain("cv.worker");
  expect(source).not.toContain("inpainted-bg");
  expect(source).not.toMatch(/brightness\s*[<>]/);
  expect(source).toContain('className = "tl-canvas"');
});

let fillTextSpy: ReturnType<typeof vi.fn>;
let strokeTextSpy: ReturnType<typeof vi.fn>;
let lineWidths: number[];

beforeEach(() => {
  vi.useFakeTimers();
  undoManager.clear();
  fillTextSpy = vi.fn();
  strokeTextSpy = vi.fn();
  lineWidths = [];

  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { load: vi.fn().mockResolvedValue([]) },
  });

  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    new Proxy(
      {
        measureText: () => ({ width: 20 }),
        fillText: fillTextSpy,
        strokeText: strokeTextSpy,
        clearRect: vi.fn(),
        createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      },
      {
        get(target, property) {
          if (property in target) {
            return target[property as keyof typeof target];
          }
          return vi.fn();
        },
        set(target, property, value) {
          if (property === "lineWidth" && typeof value === "number") {
            lineWidths.push(value);
          }
          return Reflect.set(target as Record<PropertyKey, unknown>, property, value);
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

async function renderOverlay(
  text = "ข้อความแปล",
  bubbleOverrides: Partial<TranslatedBubble> = {},
) {
  const container = document.createElement("div");
  const image = document.createElement("img");
  Object.defineProperties(image, {
    complete: { configurable: true, value: true },
    naturalWidth: { configurable: true, value: 1000 },
    naturalHeight: { configurable: true, value: 1200 },
  });
  container.appendChild(image);
  document.body.appendChild(container);

  const bubble: TranslatedBubble = {
    box: [100, 100, 300, 400],
    t: text,
    ...bubbleOverrides,
  };
  await applyTranslationOverlay(
    [bubble],
    "single",
    0,
    vi.fn(),
    undefined,
    {
      current: {
        fontFamily: "Itim, sans-serif",
        textColor: "#000000",
        textOutline: "#ffffff",
        fontSizeMultiplier: 1,
      },
    },
    container,
  );
  await vi.runAllTimersAsync();

  const wrapper = container.querySelector<HTMLElement>(".translation-bubble-wrapper")!;
  const canvas = wrapper.querySelector<HTMLCanvasElement>("canvas")!;
  const toolbar = wrapper.querySelector<HTMLElement>(".bubble-quick-toolbar")!;

  return { container, wrapper, canvas, toolbar, bubble };
}

describe("translation overlay live editor and keyboard controls", () => {
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

  test("omits stroke rendering for an explicit high-confidence no-outline source style", async () => {
    await renderOverlay("ธรรมดา", {
      styleProfile: {
        fill: "#000000",
        outline: "#000000",
        hasOutline: false,
        outlineWidthRatio: 0,
        fillConfidence: 0.95,
        outlineConfidence: 0.95,
        source: "auto",
        category: "dialogue",
      },
    });

    expect(fillTextSpy).toHaveBeenCalled();
    expect(strokeTextSpy).not.toHaveBeenCalled();
  });

  test("scales rendered stroke width from the source-derived outline ratio", async () => {
    await renderOverlay("ขอบ", {
      styleProfile: {
        fill: "#ffffff",
        outline: "#ff1e82",
        hasOutline: true,
        outlineWidthRatio: 0.05,
        fillConfidence: 0.95,
        outlineConfidence: 0.95,
        source: "auto",
        category: "dialogue",
      },
    });
    const thinWidth = lineWidths.at(-1) ?? 0;
    expect(strokeTextSpy).toHaveBeenCalled();
    expect(thinWidth).toBeGreaterThan(0);

    lineWidths = [];
    strokeTextSpy.mockClear();
    await renderOverlay("ขอบ", {
      styleProfile: {
        fill: "#ffffff",
        outline: "#ff1e82",
        hasOutline: true,
        outlineWidthRatio: 0.20,
        fillConfidence: 0.95,
        outlineConfidence: 0.95,
        source: "auto",
        category: "dialogue",
      },
    });
    const thickWidth = lineWidths.at(-1) ?? 0;
    expect(strokeTextSpy).toHaveBeenCalled();
    expect(thickWidth).toBeGreaterThan(thinWidth * 2);
  });

  test("keeps the complete manual style profile and offers an explicit Auto/Original reset", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("#112233");
    const { toolbar, bubble } = await renderOverlay("กำหนดเอง", {
      styleProfile: {
        fill: "#445566",
        outline: "#abcdef",
        hasOutline: true,
        outlineWidthRatio: 0.12,
        opacity: 0.75,
        fillConfidence: 0.95,
        outlineConfidence: 0.95,
        confidenceBand: "high",
        source: "auto",
        category: "dialogue",
        fillGradient: {
          angleDeg: 45,
          stops: [
            { offset: 0, color: "#445566" },
            { offset: 1, color: "#778899" },
          ],
        },
        glow: {
          color: "#88aaff",
          opacity: 0.6,
          blurRatio: 0.08,
          offsetXRatio: 0,
          offsetYRatio: 0,
        },
      },
    });

    toolbar.querySelector<HTMLButtonElement>('[aria-label="เปลี่ยนสีข้อความ"]')!.click();
    expect(bubble.styleProfile).toMatchObject({
      fill: "#112233",
      outline: "#abcdef",
      hasOutline: true,
      outlineWidthRatio: 0.12,
      opacity: 0.75,
      source: "manual",
      category: "dialogue",
      fillGradient: { angleDeg: 45 },
      glow: { color: "#88aaff", blurRatio: 0.08 },
    });

    toolbar
      .querySelector<HTMLButtonElement>('[aria-label="กลับไปใช้สไตล์ต้นฉบับอัตโนมัติ"]')!
      .click();
    expect(bubble.styleProfile?.source).not.toBe("manual");
  });

  test("keeps rendered text fully visible during hover and editing", async () => {
    const { wrapper, canvas, toolbar } = await renderOverlay();
    wrapper.dispatchEvent(new MouseEvent("mouseenter"));
    expect(canvas.style.opacity || "1").toBe("1");
    toolbar.querySelector<HTMLButtonElement>('[aria-label="แก้ไขข้อความ"]')!.click();
    expect(canvas.style.opacity || "1").toBe("1");
    const editor = document.querySelector<HTMLElement>("[data-translation-editor]")!;
    expect(wrapper.contains(editor)).toBe(false);
  });

  test("renders every input on the real canvas and creates one undo transaction", async () => {
    const { toolbar } = await renderOverlay("เดิม");
    toolbar.querySelector<HTMLButtonElement>('[aria-label="แก้ไขข้อความ"]')!.click();
    const input = document.querySelector<HTMLInputElement>('[data-translation-editor] input')!;
    input.value = "ข้อความใหม่";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(fillTextSpy).toHaveBeenCalled();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(undoManager.undo()).toBe("แก้ไขข้อความ");
    expect(undoManager.undo()).toBeNull();
  });

  test("escape restores opening text without creating an undo record", async () => {
    const { toolbar } = await renderOverlay("ข้อความเดิม");
    toolbar.querySelector<HTMLButtonElement>('[aria-label="แก้ไขข้อความ"]')!.click();
    const input = document.querySelector<HTMLInputElement>('[data-translation-editor] input')!;
    input.value = "แก้ไขชั่วคราว";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(undoManager.undo()).toBeNull();
    expect(document.querySelector("[data-translation-editor]")).toBeNull();
  });

  test("moves and resizes a focused bubble in source-image pixels", async () => {
    const { wrapper } = await renderOverlay();
    const pageNavigation = vi.fn();
    window.addEventListener("keydown", pageNavigation);
    wrapper.focus();
    const leftBefore = Number.parseFloat(wrapper.style.left);
    wrapper.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(Number.parseFloat(wrapper.style.left)).toBeGreaterThanOrEqual(leftBefore);
    const topBefore = Number.parseFloat(wrapper.style.top);
    wrapper.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: true, bubbles: true }));
    expect(Number.parseFloat(wrapper.style.top)).toBeGreaterThanOrEqual(topBefore);
    const widthBefore = Number.parseFloat(wrapper.style.width);
    wrapper.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, bubbles: true }));
    expect(Number.parseFloat(wrapper.style.width)).toBeGreaterThanOrEqual(widthBefore);
    expect(pageNavigation).not.toHaveBeenCalled();
    window.removeEventListener("keydown", pageNavigation);
  });

  test("supports deletion and undo", async () => {
    const { wrapper, toolbar } = await renderOverlay("จะลบ");
    toolbar.querySelector<HTMLButtonElement>('[aria-label="ลบกล่องข้อความ"]')!.click();
    expect(wrapper.style.display).toBe("none");
    expect(undoManager.undo()).toBe("ลบกล่องข้อความ");
    expect(wrapper.style.display).toBe("block");
  });

  test("preserves style profile across movement, resizing, and text edits", async () => {
    const profile = {
      fill: "#ff5500",
      outline: "#000000",
      hasOutline: true,
      outlineWidthRatio: 0.14,
      opacity: 0.9,
      source: "manual" as const,
      category: "sfx" as const,
      fillGradient: {
        angleDeg: 90,
        stops: [
          { offset: 0, color: "#ff5500" },
          { offset: 1, color: "#ffff00" },
        ],
      },
    };

    const { wrapper, bubble, toolbar } = await renderOverlay("สไตล์เดิม", {
      styleProfile: profile,
    });

    // Move bubble
    wrapper.focus();
    wrapper.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(bubble.styleProfile).toEqual(profile);

    // Resize bubble
    wrapper.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, bubbles: true }));
    expect(bubble.styleProfile).toEqual(profile);

    // Edit text
    toolbar.querySelector<HTMLButtonElement>('[aria-label="แก้ไขข้อความ"]')!.click();
    const input = document.querySelector<HTMLInputElement>('[data-translation-editor] input')!;
    input.value = "ข้อความใหม่";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(bubble.styleProfile).toEqual(profile);
  });

  test("maintains workspace overlay and export parity for decorative effects and stroke", async () => {
    const { container } = await renderOverlay("เอฟเฟกต์ครบ", {
      styleProfile: {
        fill: "#ff0055",
        outline: "#111111",
        hasOutline: true,
        outlineWidthRatio: 0.18,
        source: "auto",
        fillGradient: {
          angleDeg: 90,
          stops: [
            { offset: 0, color: "#ff0055" },
            { offset: 1, color: "#ffaa00" },
          ],
        },
        shadow: {
          color: "#000000",
          opacity: 0.8,
          blurRatio: 0.2,
          offsetXRatio: 0.08,
          offsetYRatio: 0.08,
        },
      },
    });

    expect(strokeTextSpy).toHaveBeenCalled();
    expect(fillTextSpy).toHaveBeenCalled();

    // Export via downloadTranslatedImage using the exact same rendered container
    const exportedDataUrl = downloadTranslatedImage("single", 0, "export.png", true, container);
    expect(exportedDataUrl).toBe("data:image/jpeg;base64,dHJhbnNsYXRlZA==");
  });

  test("renders legacy profiles without new fields safely during workspace display and export", async () => {
    const legacyBubble: Partial<TranslatedBubble> = {
      styleProfile: {
        fill: "#0055ff",
        outline: "#ffffff",
        outlineWidth: 1.5,
        source: "auto",
      },
    };

    const { container } = await renderOverlay("โปรเจกต์เดิม", legacyBubble);
    expect(strokeTextSpy).toHaveBeenCalled();
    expect(fillTextSpy).toHaveBeenCalled();

    const exported = downloadTranslatedImage("single", 0, "legacy.png", true, container);
    expect(exported).toBeTruthy();
  });
});
