import { describe, expect, it, vi } from "vitest";
import {
  ViewportCanvasEngine,
  DEFAULT_TILE_HEIGHT,
  } from "../../lib/canvas/ViewportCanvasEngine";

describe("ViewportCanvasEngine", () => {
  it("detects ultra long strip threshold correctly", () => {
    const normal = new ViewportCanvasEngine(800, 1200);
    expect(normal.isUltraLongStrip()).toBe(false);
    expect(normal.totalTiles).toBe(1);

    const longStrip = new ViewportCanvasEngine(800, 20000);
    expect(longStrip.isUltraLongStrip()).toBe(true);
    expect(longStrip.totalTiles).toBe(Math.ceil(20000 / DEFAULT_TILE_HEIGHT)); // 5 tiles
  });

  it("calculates exact tile bounds and clips last tile height", () => {
    const engine = new ViewportCanvasEngine(1000, 10000, { tileHeight: 4096 });
    expect(engine.totalTiles).toBe(3);

    const tile0 = engine.getTileBounds(0);
    expect(tile0).toEqual({ index: 0, top: 0, height: 4096, bottom: 4096 });

    const tile1 = engine.getTileBounds(1);
    expect(tile1).toEqual({ index: 1, top: 4096, height: 4096, bottom: 8192 });

    const tile2 = engine.getTileBounds(2);
    expect(tile2).toEqual({ index: 2, top: 8192, height: 1808, bottom: 10000 });

    expect(engine.getTileBounds(3)).toBeNull();
    expect(engine.getTileBounds(-1)).toBeNull();
  });

  it("computes visible tile indices with margin buffering for smooth scrolling", () => {
    const engine = new ViewportCanvasEngine(1000, 30000, {
      tileHeight: 4096,
      marginTiles: 1,
    });

    // Scrolled near top: scrollTop=0, viewportHeight=1000
    // Visible content: 0..1000 -> tile 0, with margin 1 -> tiles [0, 1]
    const topTiles = engine.getVisibleTileIndices(0, 1000, 1.0);
    expect(topTiles).toEqual([0, 1]);

    // Scrolled to middle: scrollTop=12000, viewportHeight=1000
    // Content 12000..13000 is inside tile 2 (8192..12288) and tile 3 (12288..16384)
    // with margin 1 -> tiles [1, 2, 3, 4]
    const midTiles = engine.getVisibleTileIndices(12000, 1000, 1.0);
    expect(midTiles).toEqual([1, 2, 3, 4]);

    // Scrolled to bottom
    const bottomTiles = engine.getVisibleTileIndices(29000, 1000, 1.0);
    expect(bottomTiles[bottomTiles.length - 1]).toBe(engine.totalTiles - 1);
  });

  it("draws only visible tiles to the canvas context", () => {
    const engine = new ViewportCanvasEngine(1000, 20000, { tileHeight: 4096, marginTiles: 0 });
    const mockCtx = {
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const mockSource = {} as CanvasImageSource;

    // Viewport viewing tile 0 only (marginTiles=0)
    const drawn = engine.drawVisibleTiles(mockSource, mockCtx, 0, 1000, 1.0);
    expect(drawn).toBe(1);
    expect(mockCtx.drawImage).toHaveBeenCalledTimes(1);
    expect(mockCtx.drawImage).toHaveBeenCalledWith(
      mockSource,
      0,
      0,
      1000,
      4096,
      0,
      0,
      1000,
      4096,
    );
  });
});
