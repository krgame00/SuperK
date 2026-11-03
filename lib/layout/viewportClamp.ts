export interface ViewportClampOptions {
  targetY: number;
  elementHeight: number;
  viewportHeight: number;
  headerOffset?: number;
  bottomOffset?: number;
}

/**
 * Clamps floating elements (such as Remnant Review Panel, dialogs, or bubble editors)
 * inside the visible canvas viewport so they do not collide with or get obscured by
 * top navigation headers or bottom toolbars.
 */
export function clampToViewport({
  targetY,
  elementHeight,
  viewportHeight,
  headerOffset = 64,
  bottomOffset = 80,
}: ViewportClampOptions): number {
  const minY = headerOffset + 8;
  const maxY = Math.max(minY, viewportHeight - bottomOffset - elementHeight - 8);
  return Math.max(minY, Math.min(targetY, maxY));
}
