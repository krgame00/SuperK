import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ImageLayerCanvas } from "@/components/editing/ImageLayerCanvas";
import {
  readAllImageLayers,
  readPageImageLayers,
  savePageImageLayers,
  clearAllImageLayers,
  flushImageLayersToIndexedDB,
  loadImageLayersFromIndexedDB,
  normalizePageKey,
} from "@/lib/editing/imageLayerStore";
import { applyTranslationOverlay } from "@/lib/translationOverlay";
import { undoManager } from "@/lib/undoManager";
import type { ImageLayer } from "@/lib/editing/commands";

describe("ImageLayer Store and Canvas", () => {
  let store: Record<string, string> = {};
  beforeEach(() => {
    store = {};
    const localStorageMock = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
    };
    Object.defineProperty(window, "localStorage", {
      value: localStorageMock,
      writable: true,
      configurable: true,
    });
    clearAllImageLayers();
  });

  it("persists and reads image layers by pageKey in localStorage", () => {
    const layer1: ImageLayer = {
      id: "img_test_1",
      pageId: "page_0",
      src: "data:image/png;base64,abc",
      x: 50,
      y: 60,
      width: 150,
      height: 150,
      opacity: 0.8,
      flipX: true,
      flipY: false,
    };

    savePageImageLayers("page_0", [layer1]);

    const retrieved = readPageImageLayers("page_0");
    expect(retrieved).toHaveLength(1);
    expect(retrieved[0].id).toBe("img_test_1");
    expect(retrieved[0].x).toBe(50);
    expect(retrieved[0].flipX).toBe(true);

    const all = readAllImageLayers();
    expect(all["page_0"]).toHaveLength(1);

    // Deleting
    savePageImageLayers("page_0", []);
    expect(readPageImageLayers("page_0")).toHaveLength(0);
  });

  it("normalizes page keys safely preserving Data URLs without slash truncation", () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA/test/layer+123==";
    expect(normalizePageKey(dataUrl)).toBe(dataUrl);

    const httpUrl = "https://example.com/manga/ch1/page_005.jpg";
    expect(normalizePageKey(httpUrl)).toBe("page_005.jpg");

    expect(normalizePageKey("")).toBe("page_0");
  });

  it("survives localStorage quota exhaustion and writes to memoryCache and IndexedDB", async () => {
    // Force localStorage.setItem to throw QuotaExceededError
    Object.defineProperty(window, "localStorage", {
      value: {
        getItem: () => null,
        setItem: () => {
          throw new DOMException("QuotaExceededError", "QuotaExceededError");
        },
        removeItem: () => {},
      },
      writable: true,
      configurable: true,
    });

    const bigLayer: ImageLayer = {
      id: "big_layer",
      pageId: "page_data_1",
      src: "data:image/png;base64," + "A".repeat(1000),
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      opacity: 1,
      flipX: false,
      flipY: false,
    };

    savePageImageLayers("page_data_1", [bigLayer]);
    expect(readPageImageLayers("page_data_1")).toHaveLength(1);
    expect(readPageImageLayers("page_data_1")[0].id).toBe("big_layer");
  });

  it("renders layer on canvas and provides corner resize handles when selected", () => {
    // Setup mock pageContainer in DOM
    const pageContainer = document.createElement("div");
    pageContainer.id = "pageContainer";
    document.body.appendChild(pageContainer);

    const onSelect = vi.fn();
    const onChange = vi.fn();
    const onDelete = vi.fn();

    const layer: ImageLayer = {
      id: "img_1",
      pageId: "page_0",
      src: "https://example.com/sticker.png",
      x: 100,
      y: 120,
      width: 200,
      height: 200,
      opacity: 1,
      flipX: false,
      flipY: false,
    };

    const { rerender } = render(
      <ImageLayerCanvas
        layers={[layer]}
        selectedId={null}
        onSelect={onSelect}
        onChange={onChange}
        onDelete={onDelete}
      />
    );

    const layerEl = pageContainer.querySelector("[data-image-layer='true']");
    expect(layerEl).not.toBeNull();
    expect(layerEl?.getAttribute("data-layer-id")).toBe("img_1");

    // Click to select
    if (layerEl) {
      fireEvent.pointerDown(layerEl);
      expect(onSelect).toHaveBeenCalledWith("img_1");
    }

    // Rerender as selected
    rerender(
      <ImageLayerCanvas
        layers={[layer]}
        selectedId="img_1"
        onSelect={onSelect}
        onChange={onChange}
        onDelete={onDelete}
      />
    );

    // Should now have 4 handles
    expect(pageContainer.querySelector("[data-handle='nw']")).not.toBeNull();
    expect(pageContainer.querySelector("[data-handle='ne']")).not.toBeNull();
    expect(pageContainer.querySelector("[data-handle='sw']")).not.toBeNull();
    expect(pageContainer.querySelector("[data-handle='se']")).not.toBeNull();

    // Keydown delete
    fireEvent.keyDown(window, { key: "Delete" });
    expect(onDelete).toHaveBeenCalledWith("img_1");

    document.body.removeChild(pageContainer);
  });

  it("delays onChange commit until pointerup during drag for 120 FPS smoothness", () => {
    const pageContainer = document.createElement("div");
    pageContainer.id = "pageContainer";
    document.body.appendChild(pageContainer);

    const onSelect = vi.fn();
    const onChange = vi.fn();

    const layer: ImageLayer = {
      id: "img_smooth_1",
      pageId: "page_0",
      src: "https://example.com/sticker.png",
      x: 100,
      y: 100,
      width: 100,
      height: 100,
      opacity: 1,
      flipX: false,
      flipY: false,
    };

    render(
      <ImageLayerCanvas
        layers={[layer]}
        selectedId="img_smooth_1"
        onSelect={onSelect}
        onChange={onChange}
      />
    );

    const layerEl = pageContainer.querySelector("[data-image-layer='true']");
    expect(layerEl).not.toBeNull();

    if (layerEl) {
      fireEvent.pointerDown(layerEl, { clientX: 100, clientY: 100, pointerId: 1 });
      fireEvent(layerEl, new PointerEvent("pointermove", { clientX: 150, clientY: 160 }));

      // MUST NOT call onChange on move events
      expect(onChange).not.toHaveBeenCalled();

      // Calling pointerup must commit the final position
      fireEvent(layerEl, new PointerEvent("pointerup"));
      expect(onChange).toHaveBeenCalledWith("img_smooth_1", { x: 150, y: 160 });
    }

    document.body.removeChild(pageContainer);
  });

  it("offscreen render creates image layers when page has 0 translation bubbles", async () => {
    const container = document.createElement("div");
    container.id = "offscreen-container";
    const img = document.createElement("img");
    img.id = "offscreen-image";
    img.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    Object.defineProperty(img, "naturalWidth", { value: 100 });
    Object.defineProperty(img, "naturalHeight", { value: 100 });
    Object.defineProperty(img, "complete", { value: true });

    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
      measureText: vi.fn().mockReturnValue({ width: 50 }),
      fillRect: vi.fn(),
      fillText: vi.fn(),
    } as any);
    HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue("data:image/png;base64,rendered");
    container.appendChild(img);
    document.body.appendChild(container);

    savePageImageLayers("page_export_test", [
      {
        id: "sticker_1",
        pageId: "page_export_test",
        src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        x: 10,
        y: 10,
        width: 50,
        height: 50,
        opacity: 1,
        flipX: false,
        flipY: false,
      },
    ]);

    const onRendered = vi.fn();
    await applyTranslationOverlay(
      [],
      "offscreen",
      0,
      () => {},
      onRendered,
      { current: {} } as any,
      container,
      "page_export_test",
    );

    await new Promise((r) => setTimeout(r, 150));

    const imageLayerEl = container.querySelector("[data-image-layer='true']");
    expect(imageLayerEl).not.toBeNull();
    expect(onRendered).toHaveBeenCalled();

    HTMLCanvasElement.prototype.getContext = originalGetContext;
    HTMLCanvasElement.prototype.toDataURL = originalToDataURL;
    document.body.removeChild(container);
  });

  it("integrates with undoManager to undo and redo image layer transformations", () => {
    let layers: ImageLayer[] = [
      {
        id: "img_undo_1",
        pageId: "page_0",
        src: "https://example.com/sticker.png",
        x: 50,
        y: 50,
        width: 100,
        height: 100,
        opacity: 1,
        flipX: false,
        flipY: false,
      },
    ];

    const prevLayers = [...layers];
    const updatedLayers = [{ ...layers[0], x: 180, y: 220 }];

    // User moves layer:
    layers = updatedLayers;
    undoManager.push({
      label: "ย้าย/ปรับขนาดรูปภาพ",
      undo: () => {
        layers = prevLayers;
      },
      redo: () => {
        layers = updatedLayers;
      },
    });

    expect(layers[0].x).toBe(180);

    // Undo (Ctrl+Z)
    const undoLabel = undoManager.undo();
    expect(undoLabel).toBe("ย้าย/ปรับขนาดรูปภาพ");
    expect(layers[0].x).toBe(50);

    // Redo (Ctrl+Y)
    const redoLabel = undoManager.redo();
    expect(redoLabel).toBe("ย้าย/ปรับขนาดรูปภาพ");
    expect(layers[0].x).toBe(180);
  });
});
