/**
 * SuperK — ViewportCanvasEngine (WP-4.6)
 *
 * Tiled Viewport Rendering Engine for Ultra-Long Webtoon Strips (height > 8192px).
 * Eliminates GPU texture memory exhaustion (browser 16,384px texture limit) by
 * slicing long strips into virtual 4096px tiles and only drawing visible / margin tiles.
 */

export interface ViewportTileBounds {
  index: number;
  top: number;
  height: number;
  bottom: number;
}

export interface ViewportCanvasEngineOptions {
  tileHeight?: number;
  marginTiles?: number;
}

export const DEFAULT_TILE_HEIGHT = 4096;
export const WEBTOON_LONG_STRIP_THRESHOLD = 8192;

export class ViewportCanvasEngine {
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly tileHeight: number;
  readonly marginTiles: number;
  readonly totalTiles: number;

  constructor(
    imageWidth: number,
    imageHeight: number,
    options: ViewportCanvasEngineOptions = {},
  ) {
    this.imageWidth = Math.max(1, imageWidth);
    this.imageHeight = Math.max(1, imageHeight);
    this.tileHeight = options.tileHeight ?? DEFAULT_TILE_HEIGHT;
    this.marginTiles = options.marginTiles ?? 1;
    this.totalTiles = Math.ceil(this.imageHeight / this.tileHeight);
  }

  isUltraLongStrip(): boolean {
    return this.imageHeight >= WEBTOON_LONG_STRIP_THRESHOLD;
  }

  getTileBounds(index: number): ViewportTileBounds | null {
    if (index < 0 || index >= this.totalTiles) return null;
    const top = index * this.tileHeight;
    const height = Math.min(this.tileHeight, this.imageHeight - top);
    return {
      index,
      top,
      height,
      bottom: top + height,
    };
  }

  getVisibleTileIndices(
    scrollTop: number,
    viewportHeight: number,
    scale = 1.0,
  ): number[] {
    if (this.totalTiles <= 1) return [0];

    const effectiveScale = Math.max(0.01, scale);
    const contentTop = Math.max(0, scrollTop / effectiveScale);
    const contentBottom = Math.min(
      this.imageHeight,
      (scrollTop + viewportHeight) / effectiveScale,
    );

    const firstTile = Math.max(
      0,
      Math.floor(contentTop / this.tileHeight) - this.marginTiles,
    );
    const lastTile = Math.min(
      this.totalTiles - 1,
      Math.floor(contentBottom / this.tileHeight) + this.marginTiles,
    );

    const indices: number[] = [];
    for (let i = firstTile; i <= lastTile; i++) {
      indices.push(i);
    }
    return indices;
  }

  drawVisibleTiles(
    source: CanvasImageSource,
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    scrollTop: number,
    viewportHeight: number,
    scale = 1.0,
  ): number {
    const visibleIndices = this.getVisibleTileIndices(scrollTop, viewportHeight, scale);
    let drawnCount = 0;

    for (const tileIdx of visibleIndices) {
      const bounds = this.getTileBounds(tileIdx);
      if (!bounds) continue;

      ctx.drawImage(
        source,
        0,
        bounds.top,
        this.imageWidth,
        bounds.height,
        0,
        bounds.top,
        this.imageWidth,
        bounds.height,
      );
      drawnCount++;
    }

    return drawnCount;
  }

  dispose(): void {
    // Engine cleanup hook for future cached OffscreenCanvas buffers
  }
}
