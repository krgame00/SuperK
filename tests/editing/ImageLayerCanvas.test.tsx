import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ImageLayerCanvas } from "@/components/editing/ImageLayerCanvas";
import {
  readAllImageLayers,
  readPageImageLayers,
  savePageImageLayers,
  clearAllImageLayers,
} from "@/lib/editing/imageLayerStore";
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
});
