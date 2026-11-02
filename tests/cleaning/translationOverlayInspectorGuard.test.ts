import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  applyTranslationOverlay,
  readPageOverlayAdjustments,
  type TranslatedBubble,
} from "@/lib/translationOverlay";
import { undoManager } from "@/lib/undoManager";

describe("translationOverlay Inspector Guard & Persistence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    undoManager.clear();
    const storageValues = new Map<string, string>();
    const storage: Storage = {
      get length() {
        return storageValues.size;
      },
      clear: () => storageValues.clear(),
      getItem: (key: string) => storageValues.get(key) ?? null,
      key: (index: number) => Array.from(storageValues.keys())[index] ?? null,
      removeItem: (key: string) => {
        storageValues.delete(key);
      },
      setItem: (key: string, value: string) => {
        storageValues.set(key, value);
      },
    };
    Object.defineProperty(window, "localStorage", {
      value: storage,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "localStorage", {
      value: storage,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { load: vi.fn().mockResolvedValue([]) },
    });
    localStorage.clear();
  });

  const setupOverlay = async (bubbleOverrides: Partial<TranslatedBubble> = {}) => {
    const viewport = document.createElement("div");
    const container = document.createElement("div");
    const chromeRoot = document.createElement("div");
    chromeRoot.setAttribute("data-overlay-chrome-layer", "true");
    const image = document.createElement("img");
    Object.defineProperties(image, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 1000 },
      naturalHeight: { configurable: true, value: 1200 },
    });
    container.appendChild(image);
    viewport.appendChild(container);
    viewport.appendChild(chromeRoot);
    document.body.appendChild(viewport);

    const bubble: TranslatedBubble = {
      box: [100, 100, 300, 400],
      t: "คำแปลทดสอบ",
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
      undefined,
      undefined,
      "th",
    );
    await vi.runAllTimersAsync();

    const wrapper = container.querySelector<HTMLElement>(".translation-bubble-wrapper")!;
    return { viewport, container, chromeRoot, wrapper, bubble };
  };

  test("clicking inside inspector panel elements does NOT deselect the active bubble", async () => {
    const inspectorDiv = document.createElement("div");
    inspectorDiv.setAttribute("data-inspector-panel", "true");
    const fontButton = document.createElement("button");
    fontButton.textContent = "Font";
    inspectorDiv.appendChild(fontButton);
    document.body.appendChild(inspectorDiv);

    let selectedBridge: unknown = null;
    const bridgeListener = (e: Event) => {
      selectedBridge = (e as CustomEvent).detail;
    };
    window.addEventListener("superk:bubble-selected", bridgeListener);

    const { viewport, wrapper } = await setupOverlay();
    expect(wrapper).toBeTruthy();

    // Trigger selection via pointerdown
    wrapper.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(selectedBridge).not.toBeNull();

    // PointerDown inside inspector panel should NOT deselect
    const pointerDownEvent = new PointerEvent("pointerdown", { bubbles: true });
    fontButton.dispatchEvent(pointerDownEvent);
    expect(selectedBridge).not.toBeNull();

    // PointerDown outside inspector should deselect
    const outsideDiv = document.createElement("div");
    document.body.appendChild(outsideDiv);
    outsideDiv.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(selectedBridge).toBeNull();

    window.removeEventListener("superk:bubble-selected", bridgeListener);
    viewport.remove();
    inspectorDiv.remove();
    outsideDiv.remove();
  });

  test("persists custom typography and warp in OverlayAdjustment", async () => {
    let selectedBridge: any = null;
    const bridgeListener = (e: Event) => {
      selectedBridge = (e as CustomEvent).detail;
    };
    window.addEventListener("superk:bubble-selected", bridgeListener);

    const { viewport, wrapper } = await setupOverlay();
    wrapper.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(selectedBridge).toBeTruthy();

    // Apply custom typography and warp
    selectedBridge.applyUpdates({
      fontFamily: "Prompt, sans-serif",
      fontSize: 28,
      align: "right",
      isBold: false,
      strokeWidth: 4,
      boxFill: "#ffffff",
      opacity: 0.9,
      warp: { type: "arch", bend: 0.45, horizontal: 0, vertical: 0 },
    });

    const adjustments = readPageOverlayAdjustments("page-0");
    const bubbleAdj = Object.values(adjustments)[0];
    expect(bubbleAdj).toBeTruthy();
    expect(bubbleAdj.fontFamily).toBe("Prompt, sans-serif");
    expect(bubbleAdj.targetFontSize).toBe(28);
    expect(bubbleAdj.align).toBe("right");
    expect(bubbleAdj.isBold).toBe(false);
    expect(bubbleAdj.strokeWidth).toBe(4);
    expect(bubbleAdj.boxFill).toBe("#ffffff");
    expect(bubbleAdj.opacity).toBe(0.9);
    expect(bubbleAdj.warp?.type).toBe("arch");

    window.removeEventListener("superk:bubble-selected", bridgeListener);
    viewport.remove();
  });
});
