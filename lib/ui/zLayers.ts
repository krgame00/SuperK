/**
 * Semantic z-index scale for the workspace (UI audit checklist P2-1).
 *
 * Every stacking value in the app must belong to one of these tiers.
 * Do not introduce ad-hoc values (the historical z-[55]/z-[9998] one-offs
 * are what this scale replaces): pick the tier that matches the surface,
 * and if no tier fits, extend this scale instead of inventing a number.
 *
 * Tiers, lowest to highest:
 * - canvas (10): badges and highlights drawn inside the page canvas.
 * - canvasTools (20): small floating tools anchored to the canvas
 *   (drag indicators, resize handles).
 * - chrome (30): persistent workspace chrome — StudioToolbar, the page
 *   filmstrip, floating zoom controls.
 * - panel (40): side panels and floating banners (remnant review panel,
 *   workflow status banner, warp hint).
 * - popover (50): popovers and menus rendered inside a chrome/panel
 *   stacking context, the inspector column, and the page-navigation
 *   cluster (nav arrows intentionally sit above panels so page turning
 *   is never covered).
 * - dock (55): the page-controls dock. Above panels/popovers so its
 *   menus are reachable, below top-level menus.
 * - menu (60): top-level menus rendered at the root (mobile menu
 *   backdrop 60, its panel 61 = menu + 1).
 * - modalBackdrop (90) / modal (100): full-screen dialogs. Every modal
 *   uses this tier (Settings, export gates, transcript, logs), so modal
 *   stacking order is decided by DOM order alone.
 * - toast (9999): react-hot-toast's own layer; always supreme. Nothing
 *   in the app may use this tier.
 */
export const Z_LAYERS = {
  canvas: 10,
  canvasTools: 20,
  chrome: 30,
  panel: 40,
  popover: 50,
  dock: 55,
  menu: 60,
  modalBackdrop: 90,
  modal: 100,
  toast: 9999,
} as const;

export type ZLayerName = keyof typeof Z_LAYERS;
