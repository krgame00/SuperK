import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  applyTranslationOverlay,
  downloadTranslatedImage,
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

beforeEach(() => {
  vi.useFakeTimers();
  undoManager.clear();
  fillTextSpy = vi.fn();

  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { load: vi.fn().mockResolvedValue([]) },
  });

  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    new Proxy(
      {
        measureText: () => ({ width: 20 }),
        fillText: fillTextSpy,
        strokeText: vi.fn(),
        clearRect: vi.fn(),
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

async function renderOverlay(text = "ข้อความแปล") {
  const container = document.createElement("div");
  const image = document.createElement("img");
  Object.defineProperties(image, {
    complete: { configurable: true, value: true },
    naturalWidth: { configurable: true, value: 1000 },
    naturalHeight: { configurable: true, value: 1200 },
  });
  container.appendChild(image);
  document.body.appendChild(container);

  await applyTranslationOverlay(
    [{ box: [100, 100, 300, 400], t: text }],
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

  return { container, wrapper, canvas, toolbar };
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
});
