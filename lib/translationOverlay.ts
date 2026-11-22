import { undoManager } from "./undoManager";
import { manualSourceSizing, type SourceSizing } from './sourceTextSize';
import { rotateLocalPoint, type SelectionRect } from "./textSelectionBounds";
import { repairExcludedScriptText } from "./languagePolicy";

export { repairExcludedScriptText };
import {
  applyBwContrastModeToBubble,
  cloneTextStyleProfile,
  measureFootprintBackgroundLuminance,
  recomputeAdaptiveReadableOnLayoutCommit,
} from "./colorMatching/resolveTextStyle";
import { sampleBubbleRegion, sampleRectRegion } from "./colorMatching/canvasSampler";
import { extractTextColors } from "./colorMatching/sampleTextColors";
import {
  applyNearbyStyleFallbacks,
  inferTextStyleCategory,
} from "./colorMatching/nearbyStyleFallback";
import type { BwContrastMode } from "./colorMatching/types";
import {
  detectBubbleCollisions,
  autoOrganizePageBubbles,
  isCorruptedAutoAdjustment,
} from "./bubbleLayoutOptimizer";
import {
  type WarpConfig,
  getNextWarpType,
  getWarpLabel,
} from "./tools/TextWarpRenderer";
import { readPageImageLayers } from "./editing/imageLayerStore";
import type {
  TranslatedBubble,
  OverlayTextStyle,
  OverlayAdjustment,
  BubbleProportionalLayout,
} from "./overlay/overlayTypes";

export type { TranslatedBubble, OverlayTextStyle, OverlayAdjustment, BubbleProportionalLayout };
import {
  layoutBubbleAtFixedFont,
} from "./overlay/bubbleTextFit";
import { downloadTranslatedImage } from "./overlay/exportTranslatedImage";

export { downloadTranslatedImage } from "./overlay/exportTranslatedImage";
import {
  defaultReviewApiKeyProvider,
  type ReviewApiKeyProvider,
} from "./overlay/qualityReviewActions";
import { openBubbleLiveEditor } from "./overlay/bubbleEditor";
import { renderBubbleContent, type WidthLayoutPreview } from "./overlay/bubbleRenderer";

export { fitTextForBubble, layoutBubbleAtFixedFont, wrapTextForBubble } from "./overlay/bubbleTextFit";
export type { BubbleTextFit } from "./overlay/bubbleTextFit";
import {
  bubbleKeyOf,
  compactOverlayPageKey,
  readOverlayAdjustments,
  readPageOverlayAdjustments,
  saveOverlayAdjustments,
  syncPageOverlayAdjustments,
} from "./overlay/overlayAdjustmentStore";

export {
  bubbleKeyOf,
  clearAllAdjustments,
  clearPageAdjustments,
  compactOverlayPageKey,
  readOverlayAdjustments,
  readPageOverlayAdjustments,
  saveOverlayAdjustments,
  syncPageOverlayAdjustments,
} from "./overlay/overlayAdjustmentStore";
import {
  fitTextInAdaptiveBubble,
  getReadableMinimumFontSize,
  measureBubbleRenderFit,
  minimumBubbleWidthAtFixedFont,
} from "./overlay/bubbleTextFit";
import { estimateSourceTextTiltAngle, snapRotationToRightAngle } from "./overlay/sourceGeometry";
import { resolveBubbleFontFamily, resolveCanvasFontFamily } from "./overlay/canvasFont";

export {
  fitTextInAdaptiveBubble,
  getReadableMinimumFontSize,
  growBubbleFrameToFit,
  measureBubbleRenderFit,
  measureTextLinesWidth,
  minimumBubbleWidthAtFixedFont,
} from "./overlay/bubbleTextFit";
export type { AdaptiveBubbleLayout } from "./overlay/bubbleTextFit";
export { estimateSourceTextTiltAngle, snapRotationToRightAngle } from "./overlay/sourceGeometry";
export { resolveBubbleFontFamily, resolveCanvasFontFamily } from "./overlay/canvasFont";

const WORD_WRAP_LOCALES: Record<string, string> = {
  thai: "th",
  ไทย: "th",
  english: "en",
  japanese: "ja",
  korean: "ko",
  chinese: "zh",
};

const wordWrapLocaleOf = (language?: string): string => {
  const normalized = language?.trim().toLowerCase();
  if (!normalized) return "th";
  return WORD_WRAP_LOCALES[normalized] ?? normalized;
};

// Document-level overlay listeners must not outlive their container —
// #pageContainer remounts on page switches, orphaning the previous
// generation's listeners. Registry keyed by container; stale (disconnected)
// entries are pruned and cleaned up on the next apply.
const overlayCleanups = new Map<Element, () => void>();

// Each applyTranslationOverlay bumps its container's generation; a paint
// whose generation is no longer current (page switched underneath it) must
// bail instead of repainting the previous page over the current one.
const overlayGenerations = new WeakMap<Element, number>();

const pruneOverlayCleanups = (): void => {
  for (const [element, cleanup] of overlayCleanups) {
    if (!element.isConnected) {
      cleanup();
      overlayCleanups.delete(element);
    }
  }
};


export const applyTranslationOverlay = async (
  bubbles: TranslatedBubble[],
  viewMode: "single" | "scroll" | "offscreen",
  currentPage: number,
  setTranslationResult: (msg: string | null) => void,
  onComplete?: (dataUrl: string) => void,
  textStyleRef?: React.MutableRefObject<OverlayTextStyle>,
  containerOverride?: Element,
  pageKeyOverride?: string,
  onBubblesMutated?: () => void,
  targetLanguage: string = "th",
  reviewApiKeyProvider: ReviewApiKeyProvider = defaultReviewApiKeyProvider,
) => {
  const effectiveTarget = (targetLanguage && targetLanguage.trim()) || "th";
  const wordWrapLocale = wordWrapLocaleOf(effectiveTarget);
  let container: Element | null | undefined = containerOverride;
  if (!container && viewMode === "offscreen") {
    container = document.getElementById("offscreen-container");
  } else if (!container && viewMode === "scroll") {
    container = document.querySelector(`#spage-${currentPage}`);
  } else if (!container) {
    container = document.getElementById("pageContainer");
  }

  if (!container) return;

  const generation = (overlayGenerations.get(container) ?? 0) + 1;
  overlayGenerations.set(container, generation);
  const isStaleOverlay = () => overlayGenerations.get(container) !== generation;

  // Detach document listeners left behind by overlays whose containers were
  // removed (page switches remount #pageContainer).
  pruneOverlayCleanups();

  container.querySelectorAll(".tl-overlay,.tl-canvas").forEach((el) => {
    if (typeof (el as unknown as { _cleanupListeners?: () => void })._cleanupListeners === "function") {
      (el as unknown as { _cleanupListeners: () => void })._cleanupListeners();
    }
    el.remove();
  });
  const img = container.querySelector("img");
  if (!img) return;
  img.ondragstart = (e) => e.preventDefault();

  // Saved empty edits retain their geometry so users can select and refill them.
  const pageKey = pageKeyOverride ?? `page-${currentPage}`;
  const pageImageLayers = readPageImageLayers(pageKey);
  const real = bubbles.filter(b => b && !b.deleted && !b.hidden && (
    (b.t ?? b.translated ?? "").trim() || b.layoutAdjustment
  ));
  if (real.length === 0 && pageImageLayers.length === 0) {
    if (onComplete) {
      setTimeout(() => {
        const url = downloadTranslatedImage(viewMode, currentPage, "", true, container);
        if (url) onComplete(url);
      }, 0);
    }
    return;
  }

  const paint = async (attempt = 0) => {
    // A newer apply on this container must win — bail without touching the DOM.
    if (isStaleOverlay()) return;
    // Repaints (duplicate bubble, style change) must replace the previous
    // layer — otherwise every duplicate click stacks another full overlay
    // and leaks its document-level listeners.
    container.querySelectorAll(".tl-overlay,.tl-canvas").forEach((el) => {
      const cleanup = (el as unknown as { _cleanupListeners?: () => void })._cleanupListeners;
      if (typeof cleanup === "function") cleanup();
      el.remove();
    });

    const currentTextStyle = textStyleRef?.current || { fontFamily: "Itim, sans-serif", textColor: "#000000", textOutline: "#FFFFFF", fontSizeMultiplier: 1.0 };
    const resolvedFontFam = resolveCanvasFontFamily(currentTextStyle.fontFamily);
    let sourceFontLoaded = false;
    try {
      await document.fonts.load(`bold 16px ${resolvedFontFam}`);
      sourceFontLoaded = typeof document.fonts.check === 'function' && document.fonts.check(`bold 100px ${resolvedFontFam}`);
    } catch {
      // Font loading is best-effort; measurement falls back below.
    }
    if (isStaleOverlay()) return;
    if (!img.naturalWidth && !img.complete && attempt < 25) {
      const onLoad = () => {
        clearTimeout(timer);
        void paint(attempt + 1);
      };
      const timer = setTimeout(() => {
        img.removeEventListener("load", onLoad);
        void paint(attempt + 1);
      }, 50);
      img.addEventListener("load", onLoad, { once: true });
      return;
    }
    const iw = img.naturalWidth || img.offsetWidth;
    const ih = img.naturalHeight || img.offsetHeight;
    if (!iw || !ih) {
      // Undecodable images never gain dimensions — retry briefly, then give
      // up instead of looping forever (callers re-render on the next change).
      if (attempt < 50) setTimeout(() => paint(attempt + 1), 100);
      return;
    }

    // Adjustments are keyed by page URL — keying by array index re-mapped
    // every saved position whenever pages were reordered or deleted.
    const storagePageKey = compactOverlayPageKey(pageKey);
    const savedAdj = readPageOverlayAdjustments(pageKey);

    const tlContainer = document.createElement("div");
    tlContainer.className = "tl-canvas";
    tlContainer.style.cssText = `position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:10;`;
    container.appendChild(tlContainer);

    if (viewMode === "offscreen") {
      const pageImageLayers = readPageImageLayers(pageKey);
      for (const layer of pageImageLayers) {
        const layerEl = document.createElement("div");
        layerEl.dataset.imageLayer = "true";
        if (layer.flipX) layerEl.dataset.flipx = "true";
        if (layer.flipY) layerEl.dataset.flipy = "true";
        layerEl.style.cssText = `position:absolute; left:${layer.x}px; top:${layer.y}px; width:${layer.width}px; height:${layer.height}px; opacity:${layer.opacity ?? 1}; pointer-events:none;`;
        const layerImg = document.createElement("img");
        layerImg.src = layer.src;
        layerImg.style.cssText = "width:100%; height:100%; object-fit:contain;";
        layerEl.appendChild(layerImg);
        tlContainer.appendChild(layerEl);
      }
    }

    const chromeRoot =
      viewMode === "single"
        ? (container.parentElement?.querySelector<HTMLElement>("[data-overlay-chrome-layer]")
          ?? document.getElementById("overlayChromeLayer"))
        : null;
    chromeRoot?.querySelectorAll("[data-translation-chrome]").forEach((el) => el.remove());

    type BubbleChromeControls = {
      toolbar: HTMLElement;
      handles: HTMLElement[];
      position: () => void;
      setVisible: (visible: boolean) => void;
    };
    const chromeControlsByWrapper = new WeakMap<HTMLElement, BubbleChromeControls>();
    const cancelDragPreviews: Array<() => void> = [];
    // Set once scheduleChromeSync exists (it is declared after the bubble
    // builders); selection updates that happen before it are harmless no-ops.
    let scheduleChromeSyncRef: ((frames?: number) => void) | null = null;

    let fallbackY2 = 10;

    type SelectedBubbleBridge = {
      bubble: TranslatedBubble;
      bubbleId: string;
      getFontSize: () => number;
      applyUpdates: (updates: Record<string, unknown>) => void;
      deleteBubble: () => void;
      reanalyzeColor: () => void;
    };
    const selectedBubbleBridgeByWrapper = new WeakMap<HTMLElement, SelectedBubbleBridge>();

    let selectedBubbleWrapper: HTMLElement | null = null;
    const setSelectedBubble = (wrapper: HTMLElement | null) => {
      if (selectedBubbleWrapper === wrapper && wrapper !== null) {
        const controls = chromeControlsByWrapper.get(wrapper);
        controls?.position();
        controls?.setVisible(true);
        return;
      }
      (chromeRoot ?? tlContainer).querySelectorAll<HTMLElement>("[data-bubble-more-menu]").forEach((menu) => {
        menu.style.display = "none";
      });
      if (selectedBubbleWrapper && selectedBubbleWrapper !== wrapper) {
        const oldFrame = selectedBubbleWrapper.querySelector<HTMLElement>(".bubble-text-selection");
        if (oldFrame) oldFrame.style.outline = "none";
        selectedBubbleWrapper.style.zIndex = "10";
        selectedBubbleWrapper.style.pointerEvents = "none";
        selectedBubbleWrapper.removeAttribute("data-selected");
        chromeControlsByWrapper.get(selectedBubbleWrapper)?.setVisible(false);
      }
      selectedBubbleWrapper = wrapper;
      if (!wrapper) {
        if (viewMode !== "offscreen" && typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("superk:bubble-selected", { detail: null }));
        }
        return;
      }

      const selectedFrame = wrapper.querySelector<HTMLElement>(".bubble-text-selection");
      if (selectedFrame) selectedFrame.style.outline = "1.5px dashed #3b82f6";
      wrapper.style.zIndex = "30";
      wrapper.style.pointerEvents = viewMode === "offscreen" ? "none" : "auto";
      wrapper.setAttribute("data-selected", "true");
      const controls = chromeControlsByWrapper.get(wrapper);
      controls?.position();
      controls?.setVisible(true);
      if (viewMode !== "offscreen" && typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("superk:bubble-selected", {
            detail: selectedBubbleBridgeByWrapper.get(wrapper) ?? null,
          }),
        );
      }
    };

    if (img && (img.naturalWidth > 0 || img.width > 0)) {
      real.forEach((b) => {
        if (!b.styleProfile && b.box && b.box.length === 4 && !b.isInvalidBox) {
          const sample = sampleBubbleRegion(img, b.box);
          if (sample) {
            const profile = extractTextColors(sample);
            profile.category = inferTextStyleCategory(b);
            if (profile.source === "global" && !profile.fallbackReason) {
              profile.fallbackReason = "low-confidence";
            }
            b.styleProfile = profile;
          }
        }
      });
      applyNearbyStyleFallbacks(real);
    }

    // Auto-organize: detect and resolve any bubble collisions or unconstrained overlaps
    if (real.length > 0) {
      const hasCorrupted = real.some((b) => {
        const bKey = bubbleKeyOf(b);
        return (
          isCorruptedAutoAdjustment(b, iw, ih, b.layoutAdjustment) ||
          isCorruptedAutoAdjustment(b, iw, ih, savedAdj[bKey])
        );
      });
      if (hasCorrupted) {
        for (const b of real) {
          const bKey = bubbleKeyOf(b);
          const rescuedStyle =
            b.styleProfile ??
            b.layoutAdjustment?.styleProfile ??
            savedAdj[bKey]?.styleProfile;
          if (rescuedStyle && !b.styleProfile) {
            b.styleProfile = cloneTextStyleProfile(rescuedStyle);
          }
          if (b.layoutAdjustment && isCorruptedAutoAdjustment(b, iw, ih, b.layoutAdjustment)) {
            delete b.layoutAdjustment;
          }
          if (savedAdj[bKey] && isCorruptedAutoAdjustment(b, iw, ih, savedAdj[bKey])) {
            delete savedAdj[bKey];
          }
        }
      }
      const collisions = real.length > 1 ? detectBubbleCollisions(real, iw, ih) : [];
      const allAlreadyOrganized = real.every(
        (b) =>
          b.layoutAdjustment &&
          !isCorruptedAutoAdjustment(b, iw, ih, b.layoutAdjustment) &&
          (b.layoutAdjustment.userModified ||
            b.layoutAdjustment.isAutoOptimized ||
            typeof b.targetFontSize === "number"),
      );
      if (collisions.length > 0 || hasCorrupted || (viewMode === "offscreen" && !allAlreadyOrganized)) {
        const organized = autoOrganizePageBubbles(real, iw, ih, {
          fontFamily: resolvedFontFam,
          fontSizeMultiplier: currentTextStyle.fontSizeMultiplier || 1.0,
          locale: wordWrapLocale,
        });
        for (let i = 0; i < real.length; i++) {
          const opt = organized.optimizedBubbles[i];
          if (opt && opt.layoutAdjustment) {
            real[i].layoutAdjustment = opt.layoutAdjustment;
            real[i].targetFontSize = opt.targetFontSize;
          }
        }
        if (hasCorrupted) {
          syncPageOverlayAdjustments(pageKey, real);
        }
      }
    }

    real.forEach((b) => {
      let rawX = 50, rawY = 50, rawW = 20, rawH = 10;
      let isInvalidBox = false;

      if (b.box && Array.isArray(b.box) && b.box.length === 4) {
        const [ymin, xmin, ymax, xmax] = b.box;
        if (typeof ymin === 'number' && typeof xmin === 'number' && typeof ymax === 'number' && typeof xmax === 'number') {
          if (xmin === 0 && ymin === 0 && xmax === 1000 && ymax === 1000) {
            isInvalidBox = true;
          } else {
            rawX = (xmin + xmax) / 2 / 10;
            rawY = (ymin + ymax) / 2 / 10;
            rawW = Math.max(4, (xmax - xmin) / 10);
            rawH = Math.max(2, (ymax - ymin) / 10);
          }
        }
      }

      if (isInvalidBox) {
        rawX = 50; rawY = fallbackY2;
        fallbackY2 = (fallbackY2 + 15 > 85) ? 8 : fallbackY2 + 12;
        rawW = 30; rawH = 15;
        b.isInvalidBox = true;
      }

      const bubbleId = bubbleKeyOf(b);
      const legacyBubbleId = b.id !== undefined
        ? `id-${b.id}`
        : `text-${(b.t || b.translated || "").slice(0, 10)}-${rawX.toFixed(1)}-${rawY.toFixed(1)}`;
      const rawLegacyAdj = savedAdj[bubbleId] ?? savedAdj[legacyBubbleId];
      const legacyAdj = rawLegacyAdj && !isCorruptedAutoAdjustment(b, iw, ih, rawLegacyAdj)
        ? rawLegacyAdj
        : undefined;
      if (b.layoutAdjustment && isCorruptedAutoAdjustment(b, iw, ih, b.layoutAdjustment)) {
        delete b.layoutAdjustment;
      }
      let adj = b.layoutAdjustment ?? legacyAdj;
      const hasSavedWidthFont = [b.targetFontSize, adj?.targetFontSize, legacyAdj?.targetFontSize].some(
        (targetFontSize) => typeof targetFontSize === "number"
          && Number.isFinite(targetFontSize)
          && targetFontSize > 0,
      );

      // Repair layout adjustments inflated by the old frame-floor bug: a
      // saved legacy frame far larger than the detected bubble box balloons
      // the whole wrapper. Width-managed frames can grow legitimately with
      // wrapped content, so preserve those saved source-pixel dimensions.
      if (adj && !b.isInvalidBox && !hasSavedWidthFont) {
        const rawPxW = (rawW / 100) * iw;
        const rawPxH = (rawH / 100) * ih;
        if (adj.bw > rawPxW * 4 || adj.bh > rawPxH * 4) {
          const cx = Math.max(0, Math.min(iw, adj.bx + adj.bw / 2));
          const cy = Math.max(0, Math.min(ih, adj.by + adj.bh / 2));
          const repairedW = adj.bw > rawPxW * 4 ? rawPxW * 4 : adj.bw;
          const repairedH = adj.bh > rawPxH * 4 ? rawPxH * 4 : adj.bh;
          adj = {
            ...adj,
            bw: repairedW,
            bh: repairedH,
            bx: Math.max(0, Math.min(iw - repairedW, cx - repairedW / 2)),
            by: Math.max(0, Math.min(ih - repairedH, cy - repairedH / 2)),
          };
        }
      }

      if (legacyAdj?.fontSizeMultiplier !== undefined && b.fontSizeMultiplier === undefined) {
        b.fontSizeMultiplier = legacyAdj.fontSizeMultiplier;
      }
      if (legacyAdj?.targetFontSize !== undefined && b.targetFontSize === undefined) {
        b.targetFontSize = legacyAdj.targetFontSize;
      }
      if (adj?.targetFontSize !== undefined && b.targetFontSize === undefined) {
        b.targetFontSize = adj.targetFontSize;
      }
      if (adj?.fontFamily !== undefined && (b as { fontFamily?: string }).fontFamily === undefined) {
        (b as { fontFamily?: string }).fontFamily = adj.fontFamily;
      }
      if (adj?.align !== undefined && (b as { align?: string }).align === undefined) {
        (b as { align?: string }).align = adj.align;
      }
      if (adj?.isBold !== undefined && (b as { isBold?: boolean }).isBold === undefined) {
        (b as { isBold?: boolean }).isBold = adj.isBold;
      }
      if (adj?.strokeWidth !== undefined && (b as { strokeWidth?: number }).strokeWidth === undefined) {
        (b as { strokeWidth?: number }).strokeWidth = adj.strokeWidth;
      }
      if (adj?.boxFill !== undefined && (b as { boxFill?: string }).boxFill === undefined) {
        (b as { boxFill?: string }).boxFill = adj.boxFill;
      }
      if (adj?.opacity !== undefined && (b as { opacity?: number }).opacity === undefined) {
        (b as { opacity?: number }).opacity = adj.opacity;
      }
      if (adj?.warp !== undefined && b.warp === undefined) {
        b.warp = { ...adj.warp };
      }
      if (adj?.bubbleCategory !== undefined && b.bubbleCategory === undefined) {
        b.bubbleCategory = adj.bubbleCategory;
      }
      const persistedStyleProfile = adj?.styleProfile ?? legacyAdj?.styleProfile;
      if (
        persistedStyleProfile &&
        (persistedStyleProfile.bwContrastMode ||
          persistedStyleProfile.ownershipMode === "manual" ||
          persistedStyleProfile.source === "manual") &&
        !b.styleProfile?.bwContrastMode &&
        b.styleProfile?.ownershipMode !== "manual" &&
        b.styleProfile?.source !== "manual"
      ) {
        b.styleProfile = cloneTextStyleProfile(persistedStyleProfile);
      }

      const adjSx = adj?.isAutoOptimized && adj.iw > 0 ? iw / adj.iw : 1;
      const adjSy = adj?.isAutoOptimized && adj.ih > 0 ? ih / adj.ih : 1;
      let currentBx = adj ? adj.bx * adjSx : (rawX / 100) * iw - ((rawW / 100) * iw) / 2;
      let currentBy = adj ? adj.by * adjSy : (rawY / 100) * ih - ((rawH / 100) * ih) / 2;
      let currentBw = adj ? adj.bw * adjSx : (rawW / 100) * iw;
      let currentBh = adj ? adj.bh * adjSy : (rawH / 100) * ih;
      let currentRotation = adj?.rotation !== undefined ? adj.rotation : ((b.rotation as number) || 0);
      if (currentRotation > 180) currentRotation -= 360;
      if (!adj?.userModified && (Math.abs(Math.abs(currentRotation) - 90) <= 20 || Math.abs(Math.abs(currentRotation) - 270) <= 20)) {
        currentRotation = 0;
        b.rotation = 0;
      }
      let currentIsItalic = Boolean(
        adj?.isItalic ?? legacyAdj?.isItalic ?? b.isItalic ?? b.italic ?? false,
      );
      b.isItalic = currentIsItalic;
      let manualMinHeightPx = typeof adj?.manualMinHeightPx === "number"
        && Number.isFinite(adj.manualMinHeightPx)
        ? Math.max(0, adj.manualMinHeightPx)
        : undefined;
      // The bubble object is the authoritative layout state; adopt a
      // proportional snapshot persisted in the legacy localStorage index so
      // reopen parity does not depend on the app-state round trip.
      if (!b.layoutSnapshot && !adj?.isAutoOptimized) {
        const persistedSnapshot = adj?.layoutSnapshot ?? legacyAdj?.layoutSnapshot;
        if (persistedSnapshot) b.layoutSnapshot = persistedSnapshot;
      }
      if (!b.warp && (adj?.warp || legacyAdj?.warp)) {
        b.warp = adj?.warp ?? legacyAdj?.warp;
      }
      let layoutOverflow = false;
      // Frame-floor bookkeeping: the size the floor grows from (so repeated
      // re-renders cannot compound it) and whether a resize drag is live.
      let resizeDragActive = false;
      let floorBase: { w: number; h: number } | null = null;

      const saveAdjustment = () => {
        floorBase = { w: currentBw, h: currentBh };
        const persistedLayout: OverlayAdjustment = {
          bx: currentBx,
          by: currentBy,
          bw: currentBw,
          bh: currentBh,
          iw,
          ih,
          rotation: currentRotation,
          isItalic: currentIsItalic,
          userModified: true,
          ...(typeof (b as { fontFamily?: string }).fontFamily === "string" ? { fontFamily: (b as { fontFamily?: string }).fontFamily } : {}),
          ...(typeof (b as { align?: "left" | "center" | "right" }).align === "string" ? { align: (b as { align?: "left" | "center" | "right" }).align } : {}),
          ...(typeof (b as { isBold?: boolean }).isBold === "boolean" ? { isBold: (b as { isBold?: boolean }).isBold } : {}),
          ...(typeof (b as { strokeWidth?: number }).strokeWidth === "number" ? { strokeWidth: (b as { strokeWidth?: number }).strokeWidth } : {}),
          ...(typeof (b as { boxFill?: string }).boxFill === "string" ? { boxFill: (b as { boxFill?: string }).boxFill } : {}),
          ...(typeof (b as { opacity?: number }).opacity === "number" ? { opacity: (b as { opacity?: number }).opacity } : {}),
          ...(typeof b.fontSizeMultiplier === "number" ? { fontSizeMultiplier: b.fontSizeMultiplier } : {}),
          ...(typeof b.targetFontSize === "number" ? { targetFontSize: b.targetFontSize } : {}),
          ...(typeof manualMinHeightPx === "number" ? { manualMinHeightPx } : {}),
          ...(b.layoutSnapshot ? { layoutSnapshot: b.layoutSnapshot } : {}),
          ...(b.styleProfile ? { styleProfile: cloneTextStyleProfile(b.styleProfile) } : {}),
          ...(b.warp ? { warp: { ...b.warp } } : {}),
          ...(b.bubbleCategory ? { bubbleCategory: b.bubbleCategory } : {}),
        };
        b.layoutAdjustment = persistedLayout;

        const all = readOverlayAdjustments();
        if (!all[storagePageKey]) all[storagePageKey] = {};
        all[storagePageKey][bubbleId] = {
          ...persistedLayout,
        };
        saveOverlayAdjustments(all);

        if (img && (img.naturalWidth > 0 || img.width > 0)) {
          const sample = sampleRectRegion(img, {
            x: currentBx,
            y: currentBy,
            width: currentBw,
            height: currentBh,
          });
          if (sample) {
            recomputeAdaptiveReadableOnLayoutCommit(b, sample);
          }
        }

        onBubblesMutated?.();
      };

      const wrapper = document.createElement("div");
      wrapper.className = "translation-bubble translation-bubble-wrapper";
      wrapper.tabIndex = 0;
      const shortText = (b.t || b.translated || "").replace(/\s+/g, " ").trim().slice(0, 60);
      const baseAriaLabel = `กล่องข้อความ: ${shortText}`;
      wrapper.setAttribute("aria-label", baseAriaLabel);
      wrapper.setAttribute("data-bubble-id", bubbleId);
      wrapper.style.cssText = `position:absolute; box-sizing:border-box; cursor:grab; pointer-events:none; touch-action:none; border-radius:4px; z-index:10; transform-origin:center center;`;
      
      const bCanvas = document.createElement("canvas");
      bCanvas.style.cssText = `display:block; width:100%; height:100%; pointer-events:none;`;
      wrapper.appendChild(bCanvas);
      const selectionFrame = document.createElement("div");
      selectionFrame.className = "bubble-text-selection";
      selectionFrame.style.cssText = `position:absolute; pointer-events:${viewMode === "offscreen" ? "none" : "auto"}; cursor:grab; touch-action:none; border-radius:4px;`;
      wrapper.appendChild(selectionFrame);
      let textSelection: SelectionRect = { x: 0, y: 0, width: currentBw, height: currentBh };
      let widthSelectionPreview = false;
      const visibleSelection = (): SelectionRect => widthSelectionPreview
        ? {
            x: 0,
            y: textSelection.height > 0 ? textSelection.y : 0,
            width: currentBw,
            height: textSelection.height > 0 ? textSelection.height : currentBh,
          }
        : textSelection;
      const updateSelectionFrame = () => {
        const bounds = visibleSelection();
        selectionFrame.style.left = `${bounds.x / currentBw * 100}%`;
        selectionFrame.style.top = `${bounds.y / currentBh * 100}%`;
        selectionFrame.style.width = `${bounds.width / currentBw * 100}%`;
        selectionFrame.style.height = `${bounds.height / currentBh * 100}%`;
        // The handles/toolbar hang on the selection corners in the unscaled
        // chrome layer; a re-render that moves the selection (auto-fit after
        // translation, font swap, box resize) must re-anchor them or they stay
        // pinned to the pre-resize geometry.
        scheduleChromeSyncRef?.(4);
      };
      const overflowNotice = document.createElement("span");
      overflowNotice.className = "bubble-layout-overflow";
      overflowNotice.setAttribute("role", "status");
      overflowNotice.style.cssText = `position:absolute; right:2px; bottom:2px; z-index:20; max-width:calc(100% - 4px); padding:2px 5px; border-radius:4px; background:rgba(180,83,9,0.96); color:#fff; font:600 11px/1.3 sans-serif; pointer-events:none;`;
      overflowNotice.textContent = "ข้อความล้นพื้นที่หน้า";
      overflowNotice.hidden = true;
      wrapper.appendChild(overflowNotice);
      const scriptWarningBadge = document.createElement("span");
      scriptWarningBadge.className = "bubble-script-warning";
      scriptWarningBadge.setAttribute("data-script-warning", "true");
      scriptWarningBadge.setAttribute("role", "status");
      scriptWarningBadge.style.cssText = `position:absolute; left:4px; top:4px; z-index:21; max-width:calc(100% - 8px); padding:3px 7px; border-radius:6px; background:rgba(217,119,6,0.95); color:#fff; font:600 11px/1.35 sans-serif; pointer-events:none; box-shadow:0 2px 8px rgba(0,0,0,0.35);`;
      scriptWarningBadge.hidden = true;
      wrapper.appendChild(scriptWarningBadge);
      let activeEditorPosition: (() => void) | null = null;
      const ts = textStyleRef?.current || { fontFamily: "Itim, sans-serif", textColor: "#000000", textOutline: "#FFFFFF", fontSizeMultiplier: 1.0 };
      const fontFam = resolveBubbleFontFamily(b, ts);
      const fontMult = ts.fontSizeMultiplier || 1.0;
      const minReadableFs = Math.max(14, getReadableMinimumFontSize(iw));

      if (!adj && !(b.sourceSizing?.mode === 'auto' && b.sourceSizing.status === 'matched')) {
        const text = (b.t || b.translated || "").trim();
        if (text) {
          const adaptiveMinFs = Math.max(10, Math.round(minReadableFs * 0.75));
          const maxAdaptiveScale = viewMode === "offscreen" ? 1.25 : 1.5;
          const layout = fitTextInAdaptiveBubble(
            text,
            currentBw,
            currentBh,
            fontFam,
            !b.isInvalidBox,
            fontMult,
            adaptiveMinFs,
            maxAdaptiveScale,
            wordWrapLocale,
          );
          const origCx = currentBx + currentBw / 2;
          const origCy = currentBy + currentBh / 2;
          currentBw = layout.width;
          currentBh = layout.height;
          currentBx = Math.max(0, Math.min(iw - currentBw, origCx - currentBw / 2));
          currentBy = Math.max(0, Math.min(ih - currentBh, origCy - currentBh / 2));
        }
      }

      // Measure actual rendered footprint luminance on the live background image (`img`, which is the cleaned image)
      // so bubbles whose original English white halo was erased by inpainting get their true dark/gray background luminance.
      if (
        img &&
        (img.naturalWidth > 0 || img.width > 0) &&
        b.styleProfile &&
        (b.styleProfile.bwContrastMode === "auto" ||
          (b.styleProfile.ownershipMode !== "manual" &&
            b.styleProfile.source !== "manual" &&
            !b.styleProfile.bwContrastMode))
      ) {
        const footprintSample = sampleRectRegion(img, {
          x: currentBx,
          y: currentBy,
          width: currentBw,
          height: currentBh,
        });
        const footprint = measureFootprintBackgroundLuminance(footprintSample);
        if (
          footprint &&
          (footprint.isNonWhiteFootprint ||
            (typeof b.styleProfile.backgroundLuminance === "number" &&
              b.styleProfile.backgroundLuminance < 195))
        ) {
          b.styleProfile = {
            ...b.styleProfile,
            backgroundLuminance: footprint.backgroundLuminance,
            backgroundLuminanceSamples: footprint.backgroundLuminanceSamples,
          };
        }
      }

      let renderedFontSize = 0;
      let textLayoutOverflow = false;
      let scriptNotice = "";
      // Moving/rotating changes placement only. Reuse the existing glyph bitmap.
      const updateBubbleFrame = () => {
        layoutOverflow = textLayoutOverflow || currentBx < 0 || currentBx + currentBw > iw ||
          currentBy < 0 || currentBy + currentBh > ih;
        wrapper.dataset.layoutOverflow = layoutOverflow ? "true" : "false";
        overflowNotice.hidden = !layoutOverflow;
        wrapper.title = [scriptNotice, layoutOverflow ? "ข้อความล้นพื้นที่หน้า กรุณาขยายพื้นที่หรือแก้ข้อความ" : ""].filter(Boolean).join('; ');
        wrapper.setAttribute("aria-label", [baseAriaLabel, scriptNotice, layoutOverflow ? "ข้อความล้นพื้นที่หน้า" : ""].filter(Boolean).join('; '));
        const sizingNotice = b.sourceSizing?.status === 'fallback' ? b.sourceSizing.fallbackLabel : b.sourceSizing?.readabilityWarning;
        if (b.sourceSizing) {
          wrapper.dataset.sourceSizingStatus = b.sourceSizing.status;
          wrapper.dataset.sourceSizingMode = b.sourceSizing.mode;
        }
        if (sizingNotice) {
          wrapper.title = [wrapper.title, sizingNotice].filter(Boolean).join('; ');
          wrapper.setAttribute('aria-label', `${wrapper.getAttribute('aria-label')}; ${sizingNotice}`);
        }
        wrapper.style.left = `${(currentBx / iw) * 100}%`;
        wrapper.style.top = `${(currentBy / ih) * 100}%`;
        wrapper.style.width = `${(currentBw / iw) * 100}%`;
        wrapper.style.height = `${(currentBh / ih) * 100}%`;
        wrapper.style.transform = currentRotation ? `rotate(${currentRotation.toFixed(1)}deg)` : "";
        updateSelectionFrame();
        chromeControlsByWrapper.get(wrapper)?.position();
      };
      const renderBubble = (
        availableHeight?: number,
        snapshotScale = 1,
        widthLayoutPreview?: WidthLayoutPreview,
      ) => {
        renderBubbleContent({
          bubble: b,
          wrapper,
          canvas: bCanvas,
          scriptWarningBadge,
          textStyle: ts,
          textStyleRef,
          viewMode,
          pageWidth: iw,
          pageHeight: ih,
          targetLocale: wordWrapLocale,
          effectiveTarget,
          baseAriaLabel,
          realBubbles: real,
          legacyAdjustment: legacyAdj,
          adjustmentScaleX: adjSx,
          updateBubbleFrame,
          state: {
            get currentBx() { return currentBx; },
            set currentBx(value: number) { currentBx = value; },
            get currentBy() { return currentBy; },
            set currentBy(value: number) { currentBy = value; },
            get currentBw() { return currentBw; },
            set currentBw(value: number) { currentBw = value; },
            get currentBh() { return currentBh; },
            set currentBh(value: number) { currentBh = value; },
            get currentIsItalic() { return currentIsItalic; },
            set currentIsItalic(value: boolean) { currentIsItalic = value; },
            get manualMinHeightPx() { return manualMinHeightPx; },
            set manualMinHeightPx(value: number | undefined) { manualMinHeightPx = value; },
            get adj() { return adj; },
            set adj(value: OverlayAdjustment | undefined) { adj = value; },
            get layoutOverflow() { return layoutOverflow; },
            set layoutOverflow(value: boolean) { layoutOverflow = value; },
            get resizeDragActive() { return resizeDragActive; },
            set resizeDragActive(value: boolean) { resizeDragActive = value; },
            get floorBase() { return floorBase; },
            set floorBase(value: { w: number; h: number } | null) { floorBase = value; },
            get textSelection() { return textSelection; },
            set textSelection(value: SelectionRect) { textSelection = value; },
            get textLayoutOverflow() { return textLayoutOverflow; },
            set textLayoutOverflow(value: boolean) { textLayoutOverflow = value; },
            get renderedFontSize() { return renderedFontSize; },
            set renderedFontSize(value: number) { renderedFontSize = value; },
            get scriptNotice() { return scriptNotice; },
            set scriptNotice(value: string) { scriptNotice = value; },
            get sourceFontLoaded() { return sourceFontLoaded; },
            set sourceFontLoaded(value: boolean) { sourceFontLoaded = value; },
          },
        }, availableHeight, snapshotScale, widthLayoutPreview);
      };

      b.render = renderBubble;

      if (viewMode !== "offscreen") {
        wrapper.addEventListener('mouseenter', () => { if (selectedBubbleWrapper !== wrapper) selectionFrame.style.outline = "1.5px dashed rgba(249,115,22,0.65)"; });
      wrapper.addEventListener('mouseleave', () => { if (selectedBubbleWrapper !== wrapper) selectionFrame.style.outline = "none"; });

      let isDragging = false;
      let dragStartX = 0, dragStartY = 0;
      let initialBx = 0, initialBy = 0;
      let initialBw = 0, initialBh = 0;
      let pendingMoveFrame: number | null = null;
      let pendingMovePointer: {clientX:number;clientY:number} | null = null;
      const cancelMovePreview = () => {
        if (pendingMoveFrame !== null) window.cancelAnimationFrame(pendingMoveFrame);
        pendingMoveFrame = null;
        pendingMovePointer = null;
      };
      cancelDragPreviews.push(cancelMovePreview);
      const applyMovePosition = (clientX:number,clientY:number) => {
        const rect = tlContainer.getBoundingClientRect();
        if (!(rect.width > 0 && rect.height > 0)) return;
        currentBx = initialBx + (clientX - dragStartX) * (iw / rect.width);
        currentBy = initialBy + (clientY - dragStartY) * (ih / rect.height);
        updateBubbleFrame();
      };

      wrapper.addEventListener('pointerdown', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('.action-handle') || target.closest('.delete-btn') || target.closest('.edit-btn')) return;
        e.stopPropagation();
        setSelectedBubble(wrapper);
        isDragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        initialBx = currentBx;
        initialBy = currentBy;
        initialBw = currentBw;
        initialBh = currentBh;
        try {
          wrapper.setPointerCapture(e.pointerId);
        } catch {
          // ignore
        }
      });

      wrapper.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        e.stopPropagation();
        pendingMovePointer = {clientX:e.clientX,clientY:e.clientY};
        if (pendingMoveFrame === null) pendingMoveFrame = window.requestAnimationFrame(() => {
          pendingMoveFrame = null;
          const latest = pendingMovePointer;
          pendingMovePointer = null;
          if (latest && isDragging && !isStaleOverlay()) applyMovePosition(latest.clientX,latest.clientY);
        });
      });

      wrapper.addEventListener('pointerup', (e) => {
        if (isDragging) {
          e.stopPropagation();
          cancelMovePreview();
          applyMovePosition(e.clientX,e.clientY);
          isDragging = false;
          try {
            wrapper.releasePointerCapture(e.pointerId);
          } catch {
            // ignore
          }
          // A selection click must leave legacy layout and adaptive styles untouched.
          if (currentBx === initialBx && currentBy === initialBy) return;
          // One final layout settles page-edge constraints for preview/export parity.
          renderBubble();
          saveAdjustment();
          if (currentBx !== initialBx || currentBy !== initialBy) {
            const finalBx = currentBx, finalBy = currentBy, finalBw = currentBw, finalBh = currentBh;
            const startBx = initialBx, startBy = initialBy, startBw = initialBw, startBh = initialBh;
            undoManager.push({
              label: "ย้ายตำแหน่งกล่องข้อความ",
              undo: () => {
                currentBx = startBx;
                currentBy = startBy;
                currentBw = startBw;
                currentBh = startBh;
                renderBubble();
                saveAdjustment();
              },
              redo: () => {
                currentBx = finalBx;
                currentBy = finalBy;
                currentBw = finalBw;
                currentBh = finalBh;
                renderBubble();
                saveAdjustment();
              },
            });
          }
        }
      });

      wrapper.addEventListener('pointercancel', (e) => {
        if (isDragging) {
          isDragging = false;
          cancelMovePreview();
          try {
            wrapper.releasePointerCapture(e.pointerId);
          } catch {
            // ignore
          }
          currentBx = initialBx;
          currentBy = initialBy;
          currentBw = initialBw;
          currentBh = initialBh;
          renderBubble();
          saveAdjustment();
        }
      });

      wrapper.addEventListener('lostpointercapture', () => {
        if (isDragging) {
          isDragging = false;
          cancelMovePreview();
        }
      });

      const openLiveEditor = () => {
        openBubbleLiveEditor({
          bubble: b,
          wrapper,
          tlContainer,
          chromeRoot,
          chromeControls: chromeControlsByWrapper.get(wrapper),
          pageWidth: iw,
          pageHeight: ih,
          getCurrentRect: () => ({ x: currentBx, y: currentBy, w: currentBw, h: currentBh }),
          effectiveTarget,
          reviewApiKeyProvider,
          onBubblesMutated,
          renderBubble,
          saveAdjustment,
          setActiveEditorPosition: (position) => {
            activeEditorPosition = position;
          },
        });
      };

      const deleteBubbleWithUndo = () => {
        b.deleted = true;
        onBubblesMutated?.();
        wrapper.style.display = "none";
        wrapper.dataset.deleted = "true";
        setSelectedBubble(null);
        undoManager.push({
          label: "ลบกล่องข้อความ",
          undo: () => {
            b.deleted = false;
            wrapper.style.display = "block";
            delete wrapper.dataset.deleted;
            renderBubble();
            onBubblesMutated?.();
          },
          redo: () => {
            b.deleted = true;
            wrapper.style.display = "none";
            wrapper.dataset.deleted = "true";
            setSelectedBubble(null);
            onBubblesMutated?.();
          },
        });
      };

      selectedBubbleBridgeByWrapper.set(wrapper, {
        bubble: b,
        bubbleId,
        getFontSize: () => Math.round(renderedFontSize || b.targetFontSize || 20),
        applyUpdates: (updates: Record<string, unknown>) => {
          if (typeof updates.fontFamily === "string") {
            (b as { fontFamily?: string }).fontFamily = updates.fontFamily;
          }
          if (typeof updates.fontSize === "number" && updates.fontSize > 0) {
            b.targetFontSize = updates.fontSize;
          }
          if (typeof updates.isBold === "boolean") {
            (b as { isBold?: boolean }).isBold = updates.isBold;
          }
          if (typeof updates.isItalic === "boolean") {
            currentIsItalic = updates.isItalic;
            b.isItalic = updates.isItalic;
            b.italic = updates.isItalic;
          }
          if (typeof updates.align === "string") {
            (b as { align?: string }).align = updates.align;
          }
          if ("boxFill" in updates) {
            (b as { boxFill?: string }).boxFill = updates.boxFill as string | undefined;
          }
          if (typeof updates.opacity === "number") {
            (b as { opacity?: number }).opacity = updates.opacity;
          }
          if (typeof updates.speaker === "string") {
            b.speaker = updates.speaker.trim();
          }
          if (typeof updates.speakerConfirmed === "boolean") {
            b.speakerConfirmed = updates.speakerConfirmed;
          }
          if (typeof updates.strokeWidth === "number") {
            (b as { strokeWidth?: number }).strokeWidth = updates.strokeWidth;
          }
          if (typeof updates.color === "string") {
            b.styleProfile = {
              ...(b.styleProfile ?? {
                fill: updates.color,
                outline: "#ffffff",
                hasOutline: true,
                outlineWidthRatio: 0.16,
                source: "manual",
              }),
              fill: updates.color,
              source: "manual",
              ownershipMode: "manual",
            };
          }
          if (typeof updates.strokeColor === "string") {
            b.styleProfile = {
              ...(b.styleProfile ?? {
                fill: "#000000",
                outline: updates.strokeColor,
                hasOutline: true,
                outlineWidthRatio: 0.16,
                source: "manual",
              }),
              outline: updates.strokeColor,
              hasOutline: true,
              source: "manual",
              ownershipMode: "manual",
            };
          }
          if (typeof updates.ownershipMode === "string") {
            if (b.styleProfile) {
              b.styleProfile = {
                ...b.styleProfile,
                ownershipMode: updates.ownershipMode as "auto" | "readable" | "manual",
                source: updates.ownershipMode === "manual" ? "manual" : "auto",
              };
            }
          }
          if ("warp" in updates) {
            b.warp = updates.warp as WarpConfig | undefined;
          }
          delete b.layoutSnapshot;
          renderBubble();
          saveAdjustment();
          onBubblesMutated?.();
        },
        deleteBubble: () => deleteBubbleWithUndo(),
        reanalyzeColor: () => {
          if (img && (img.naturalWidth > 0 || img.width > 0) && b.box && b.box.length === 4) {
            const sample = sampleBubbleRegion(img, b.box);
            if (sample) {
              const profile = extractTextColors(sample);
              profile.category = inferTextStyleCategory(b);
              b.styleProfile = profile;
              delete b.layoutSnapshot;
              renderBubble();
              saveAdjustment();
              onBubblesMutated?.();
            }
          }
        },
      });

      wrapper.addEventListener("focus", () => {
        setSelectedBubble(wrapper);
      });

      wrapper.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        openLiveEditor();
      });

      const adjustBubbleFontSize = (delta: number) => {
        const oldMult = typeof b.fontSizeMultiplier === "number" ? b.fontSizeMultiplier : 1.0;
        const newMult = Math.max(0.4, Math.min(5.0, Number((oldMult + delta).toFixed(2))));
        if (newMult === oldMult) return;
        const snapshotBefore = b.layoutSnapshot;
        const sizingBefore = b.sourceSizing;
        const targetFsBefore = b.targetFontSize;
        const bxBefore = currentBx;
        const byBefore = currentBy;
        const bwBefore = currentBw;
        const bhBefore = currentBh;
        const minHeightBefore = manualMinHeightPx;

        b.sourceSizing = manualSourceSizing(b.sourceSizing,b.box);
        const sizingAfter = b.sourceSizing;

        const text = (b.t || b.translated || "").trim();
        if (text && typeof b.targetFontSize !== "number" && renderedFontSize > 0) {
          const currentStyle = textStyleRef?.current || ts;
          const globalMult = currentStyle.fontSizeMultiplier || 1.0;
          const divisor = globalMult * oldMult;
          if (divisor > 0) {
            b.targetFontSize = renderedFontSize / divisor;
          }
        }
        const scaleRatio = oldMult > 0 ? newMult / oldMult : 1;
        if (delta > 0 && text) {
          const currentStyle = textStyleRef?.current || ts;
          const currentFontFam = resolveCanvasFontFamily(currentStyle.fontFamily);
          const globalMult = currentStyle.fontSizeMultiplier || 1.0;
          const baseFs = typeof b.targetFontSize === "number" ? b.targetFontSize : 16;
          const nextEffectiveFs = Math.max(8, Math.round(baseFs * globalMult * newMult));
          const minWordW = Math.min(
            iw,
            Math.max(
              30,
              minimumBubbleWidthAtFixedFont(
                text,
                nextEffectiveFs,
                currentFontFam,
                !b.isInvalidBox,
                wordWrapLocale,
              ),
            ),
          );
          if (currentBw < 160 || currentBw < minWordW) {
            const grownW = Math.min(
              iw,
              Math.max(28, minWordW, Math.round(currentBw * scaleRatio)),
            );
            const grownH = Math.min(ih, Math.max(20, Math.round(currentBh * scaleRatio)));
            currentBx = Math.max(0, Math.min(iw - grownW, currentBx));
            currentBy = Math.max(0, Math.min(ih - grownH, currentBy));
            currentBw = grownW;
            currentBh = grownH;
            if (typeof manualMinHeightPx === "number") {
              manualMinHeightPx = Math.min(ih, Math.round(manualMinHeightPx * scaleRatio));
            }
          }
        }

        b.fontSizeMultiplier = newMult;
        onBubblesMutated?.();
        renderBubble();
        const snapshotAfter = b.layoutSnapshot;
        const targetFsAfter = b.targetFontSize;
        const bxAfter = currentBx;
        const byAfter = currentBy;
        const bwAfter = currentBw;
        const bhAfter = currentBh;
        const minHeightAfter = manualMinHeightPx;
        saveAdjustment();
        undoManager.push({
          label: delta > 0 ? "เพิ่มขนาดข้อความ" : "ลดขนาดข้อความ",
          undo: () => {
            currentBx = bxBefore;
            currentBy = byBefore;
            currentBw = bwBefore;
            currentBh = bhBefore;
            b.fontSizeMultiplier = oldMult;
            b.targetFontSize = targetFsBefore;
            manualMinHeightPx = minHeightBefore;
            b.sourceSizing = sizingBefore;
            b.layoutSnapshot = snapshotBefore;
            renderBubble();
            saveAdjustment();
          },
          redo: () => {
            currentBx = bxAfter;
            currentBy = byAfter;
            currentBw = bwAfter;
            currentBh = bhAfter;
            b.fontSizeMultiplier = newMult;
            b.targetFontSize = targetFsAfter;
            manualMinHeightPx = minHeightAfter;
            b.sourceSizing = sizingAfter;
            b.layoutSnapshot = snapshotAfter;
            renderBubble();
            saveAdjustment();
          },
        });
      };

      wrapper.addEventListener("keydown", (e) => {
        if (e.target !== wrapper) return;

        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          openLiveEditor();
          return;
        }

        if (e.key === "+" || e.key === "=") {
          e.preventDefault();
          e.stopPropagation();
          adjustBubbleFontSize(0.12);
          return;
        }

        if (e.key === "-" || e.key === "_") {
          e.preventDefault();
          e.stopPropagation();
          adjustBubbleFontSize(-0.12);
          return;
        }

        if ((e.key === "i" || e.key === "I") && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          e.stopPropagation();
          toggleBubbleItalic();
          return;
        }

        if ((e.key === "q" || e.key === "Q") && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          e.stopPropagation();
          const normRot = ((currentRotation + 540) % 360) - 180;
          applyBubbleRotationAndSlant(Math.round((normRot - 4) * 10) / 10, Boolean(b.isItalic ?? b.italic ?? true), "หมุนข้อความเอียงขึ้น (-4°)");
          return;
        }

        if ((e.key === "e" || e.key === "E") && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          e.stopPropagation();
          const normRot = ((currentRotation + 540) % 360) - 180;
          applyBubbleRotationAndSlant(Math.round((normRot + 4) * 10) / 10, Boolean(b.isItalic ?? b.italic ?? true), "หมุนข้อความเอียงลง (+4°)");
          return;
        }

        if (e.key === "0" && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          e.stopPropagation();
          applyBubbleRotationAndSlant(0, false, "รีเซ็ตมุมเอียงข้อความ");
          return;
        }

        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          e.stopPropagation();
          deleteBubbleWithUndo();
          return;
        }

        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setSelectedBubble(null);
          tlContainer.focus();
          return;
        }

        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
          e.preventDefault();
          e.stopPropagation();

          const delta = e.shiftKey ? 10 : 1;
          const initBx = currentBx;
          const initBy = currentBy;
          const initBw = currentBw;
          const initBh = currentBh;
          const initSnapshot = b.layoutSnapshot;

          if (e.altKey) {
            if (e.key === "ArrowRight") {
              currentBw = Math.max(20, Math.min(iw - currentBx, currentBw + delta));
            } else if (e.key === "ArrowLeft") {
              currentBw = Math.max(20, currentBw - delta);
            } else if (e.key === "ArrowDown") {
              currentBh = Math.max(20, Math.min(ih - currentBy, currentBh + delta));
            } else if (e.key === "ArrowUp") {
              currentBh = Math.max(20, currentBh - delta);
            }
          } else {
            if (e.key === "ArrowRight") {
              currentBx = Math.max(0, Math.min(iw - currentBw, currentBx + delta));
            } else if (e.key === "ArrowLeft") {
              currentBx = Math.max(0, Math.min(iw - currentBw, currentBx - delta));
            } else if (e.key === "ArrowDown") {
              currentBy = Math.max(0, Math.min(ih - currentBh, currentBy + delta));
            } else if (e.key === "ArrowUp") {
              currentBy = Math.max(0, Math.min(ih - currentBh, currentBy - delta));
            }
          }

          if (currentBx !== initBx || currentBy !== initBy || currentBw !== initBw || currentBh !== initBh) {
            renderBubble();
            const committedSnapshot = b.layoutSnapshot;
            saveAdjustment();
            const newBx = currentBx, newBy = currentBy, newBw = currentBw, newBh = currentBh;
            undoManager.push({
              label: e.altKey ? "ปรับขนาดกล่องข้อความ" : "ย้ายตำแหน่งกล่องข้อความ",
              undo: () => {
                currentBx = initBx; currentBy = initBy; currentBw = initBw; currentBh = initBh;
                b.layoutSnapshot = initSnapshot;
                renderBubble();
                saveAdjustment();
              },
              redo: () => {
                currentBx = newBx; currentBy = newBy; currentBw = newBw; currentBh = newBh;
                b.layoutSnapshot = committedSnapshot;
                renderBubble();
                saveAdjustment();
              },
            });
          }
        }
      });

      // 1. Interactive handles live in the unscaled chrome layer.
      const chromeHandles: HTMLElement[] = [];
      const handlesConfig = [
        {
          id: 'rotate',
          pos: 'nw',
          cursor: 'grab',
          title: 'หมุนข้อความ (ดูดมุมฉาก 90° อัตโนมัติ)',
          size: 30,
          icon: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>`
        },
        {
          id: 'scale',
          pos: 'ne',
          cursor: 'nesw-resize',
          title: 'ปรับขนาดเฉียง (ย่อ-ขยายทั้งกล่องและตัวหนังสือ)',
          size: 30,
          icon: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/></svg>`
        },
        {
          id: 'width',
          pos: 'e',
          cursor: 'ew-resize',
          title: 'ปรับความกว้าง (ลากซ้าย-ขวา เพื่อตัดบรรทัดใหม่ ขนาดตัวหนังสือเท่าเดิม)',
          size: 30,
          icon: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="6,8 2,12 6,16" fill="currentColor"/><polygon points="18,8 22,12 18,16" fill="currentColor"/><line x1="4" y1="12" x2="20" y2="12"/></svg>`
        },
        {
          id: 'move',
          pos: 'sw',
          cursor: 'move',
          title: 'ย้ายตำแหน่ง (ลากเพื่อย้ายกล่อง)',
          size: 30,
          icon: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="22"/></svg>`
        }
      ];

      handlesConfig.forEach(({ id, pos, cursor, title, icon, size }) => {
        const handle = document.createElement("div");
        handle.className = `action-handle action-handle--${id}`;
        handle.setAttribute("data-translation-chrome", "true");
        handle.setAttribute("data-handle-position", pos);
        handle.title = title;
        const handleSize = size || 36;
        const handleZIndex = id === "scale" ? 54 : id === "rotate" ? 53 : id === "move" ? 52 : 51;
        handle.dataset.baseTranslate = "translate(-50%, -50%)";
        handle.style.cssText = `position:absolute; width:${handleSize}px; height:${handleSize}px; background:#ffffff; border:2.5px solid var(--primary, #f43f5e); border-radius:50%; z-index:${handleZIndex}; opacity:0; pointer-events:none; display:flex; align-items:center; justify-content:center; color:var(--primary, #f43f5e); cursor:${cursor}; box-shadow:0 3px 10px rgba(0,0,0,0.35); transition:opacity 120ms ease, box-shadow 120ms ease, filter 120ms ease, transform 120ms ease; touch-action:none; user-select:none; transform:translate(-50%, -50%) scale(1);`;
        handle.innerHTML = icon;

        handle.addEventListener('mouseenter', () => {
          handle.style.filter = 'brightness(1.05)';
          handle.style.boxShadow = '0 6px 16px rgba(244,63,94,0.45)';
          handle.style.borderColor = 'var(--primary-hover, #e11d48)';
          const baseTranslate = handle.dataset.baseTranslate || 'translate(-50%, -50%)';
          handle.style.transform = `${baseTranslate} scale(1.06)`;
        });
        handle.addEventListener('mouseleave', () => {
          handle.style.filter = '';
          handle.style.boxShadow = '0 3px 10px rgba(0,0,0,0.35)';
          handle.style.borderColor = 'var(--primary, #f43f5e)';
          const baseTranslate = handle.dataset.baseTranslate || 'translate(-50%, -50%)';
          handle.style.transform = `${baseTranslate} scale(1)`;
        });

        let rStartX = 0, rStartY = 0;
        let rInitBx = 0, rInitBy = 0, rInitBw = 0, rInitBh = 0;
        let rDragInitBx = 0, rDragInitBy = 0, rDragInitBw = 0;
        let rCenterX = 0, rCenterY = 0;
        let rStartAngle = 0;
        let rInitRot = 0;
        let rInitFontMult = 1;
        let rInitRenderedFontSize = 0;
        let rInitTargetFs: number | undefined = undefined;
        let rDragTargetFs: number | undefined = undefined;
        let rInitManualMinHeightPx: number | undefined = undefined;
        let rMinimumWordWidth = 30;
        let widthDragDidMove = false;
        let handleDidMove = false;
        let lastAppliedPreviewPointer: { clientX: number; clientY: number } | null = null;
        let scaleAnchor = { x: 0, y: 0 };
        // Proportional layout captured once at corner pointerdown: the drawn
        // bitmap, wrapped lines, font and selection stay frozen for the whole
        // drag and are rescaled through CSS; only this snapshot is reused.
        let scaleDragSnapshot: { layout: BubbleProportionalLayout; selection: SelectionRect } | null = null;
        let rInitSnapshot: BubbleProportionalLayout | undefined = undefined;
        let rInitSizing: SourceSizing | undefined;
        let rInitUserSpace: TranslatedBubble['userTextSpace'];
        const pinScaleAnchor = () => {
          const point = rotateLocalPoint(textSelection.x, textSelection.y + textSelection.height,
            currentBw, currentBh, currentRotation);
          currentBx = scaleAnchor.x - point.x;
          currentBy = scaleAnchor.y - point.y;
          if (currentRotation === 0 && currentBw <= iw && currentBh <= ih) {
            if (currentBx < 0) currentBx = 0;
            if (currentBy < 0) currentBy = 0;
            if (currentBx + currentBw > iw) currentBx = Math.max(0, iw - currentBw);
            if (currentBy + currentBh > ih) currentBy = Math.max(0, ih - currentBh);
          }
        };

        const widthGeometryForDrag = (dx: number): { width: number; left: number } => {
          const requestedWidth = Math.max(30, rDragInitBw + dx);
          const minimumWidth = Math.max(30, rMinimumWordWidth);
          if (dx < 0 && minimumWidth > iw) {
            return { width: rDragInitBw, left: rDragInitBx };
          }
          if (dx < 0 && rDragInitBw < minimumWidth) {
            return { width: rDragInitBw, left: rDragInitBx };
          }
          if (dx < 0 && requestedWidth <= minimumWidth) {
            const width = Math.min(minimumWidth, iw);
            return {
              width,
              left: Math.max(0, Math.min(rDragInitBx, iw - width)),
            };
          }
          return { width: requestedWidth, left: rDragInitBx };
        };

        handle.addEventListener('pointerdown', (e) => {
          widthDragDidMove = false;
          handleDidMove = false;
          lastAppliedPreviewPointer = null;
          rStartX = e.clientX; rStartY = e.clientY;
          rInitBx = currentBx; rInitBy = currentBy;
          rDragInitBx = currentBx;
          rDragInitBy = currentBy;
          rInitBw = currentBw; rInitBh = currentBh;
          rDragInitBw = currentBw;
          rInitRot = currentRotation;
          rInitSnapshot = b.layoutSnapshot;
          rInitSizing = b.sourceSizing;
          rInitUserSpace = b.userTextSpace;
          // Corner drags freeze the rendered layout once, here: the drawn
          // canvas, lines, font and selection are reused for every preview
          // frame and rescaled proportionally on release.
          scaleDragSnapshot = id === 'scale' && b.layoutSnapshot
            ? { layout: b.layoutSnapshot, selection: { ...textSelection } }
            : null;
          const anchor = rotateLocalPoint(textSelection.x, textSelection.y + textSelection.height,
            currentBw, currentBh, currentRotation);
          scaleAnchor = { x: currentBx + anchor.x, y: currentBy + anchor.y };
          rInitFontMult = typeof b.fontSizeMultiplier === "number" ? b.fontSizeMultiplier : 1;
          rInitRenderedFontSize = (b.t || b.translated || '').trim() ? renderedFontSize : 0;
          rInitTargetFs = typeof b.targetFontSize === "number" && Number.isFinite(b.targetFontSize) && b.targetFontSize > 0
            ? b.targetFontSize
            : (typeof adj?.targetFontSize === "number" && Number.isFinite(adj.targetFontSize) && adj.targetFontSize > 0
              ? (adjSx !== 1 ? Math.max(8, Math.round(adj.targetFontSize * adjSx)) : adj.targetFontSize)
              : undefined);
          rDragTargetFs = rInitTargetFs;
          rInitManualMinHeightPx = manualMinHeightPx;
          resizeDragActive = id === 'width' || id === 'scale';
          widthSelectionPreview = id === 'width';

          if (id === 'scale' && rInitRenderedFontSize > 0) {
            const currentStyle = textStyleRef?.current || ts;
            rDragTargetFs = rInitRenderedFontSize / ((currentStyle.fontSizeMultiplier || 1) * rInitFontMult);
          }

          if (id === 'width') {
            const isAutoFrame = Boolean(
              (adj?.isAutoOptimized || b.layoutAdjustment?.isAutoOptimized) &&
              !b.userTextSpace &&
              typeof manualMinHeightPx !== "number",
            );
            if (isAutoFrame && textSelection.width > 0 && textSelection.width < currentBw * 0.85) {
              const snugW = Math.max(30, Math.min(currentBw, Math.ceil(textSelection.width / 0.88)));
              const snugX = Math.max(
                0,
                Math.min(iw - snugW, Math.round(currentBx + textSelection.x - (snugW - textSelection.width) / 2)),
              );
              rDragInitBx = snugX;
              rDragInitBw = snugW;
              currentBx = snugX;
              currentBw = snugW;
            }
            if (currentBy < 0 || currentBy + currentBh > ih) {
              rDragInitBy = Math.max(0, Math.min(Math.max(0, ih - Math.min(currentBh, ih)), currentBy));
            }
            if (manualMinHeightPx === undefined) {
              manualMinHeightPx = adj
                ? (typeof adj.manualMinHeightPx === "number" && Number.isFinite(adj.manualMinHeightPx)
                  ? Math.max(0, adj.manualMinHeightPx)
                  : (adj.isAutoOptimized ? 25 : adj.bh))
                : 25;
            }
            const text = (b.t || b.translated || "").trim();
            if (text) {
              const currentStyle = textStyleRef?.current || ts;
              const currentFontFam = resolveCanvasFontFamily(currentStyle.fontFamily);
              const bubbleMult = typeof b.fontSizeMultiplier === "number" ? b.fontSizeMultiplier : 1.0;
              const globalMult = currentStyle.fontSizeMultiplier || 1.0;
              if (typeof rInitTargetFs !== "number") {
                const prevFit = measureBubbleRenderFit(
                  text,
                  currentBw,
                  currentBh,
                  iw,
                  currentFontFam,
                  globalMult,
                  bubbleMult,
                  !b.isInvalidBox,
                  undefined,
                  wordWrapLocale,
                );
                const multiplier = bubbleMult * globalMult;
                rDragTargetFs = multiplier > 0 ? prevFit.fontSize / multiplier : prevFit.fontSize;
                b.targetFontSize = rDragTargetFs;
              }
              const targetFs = typeof b.targetFontSize === "number" ? b.targetFontSize : (rDragTargetFs || 16);
              const effectiveFs = Math.max(8, Math.round(targetFs * globalMult * bubbleMult));
              rMinimumWordWidth = Math.max(
                30,
                minimumBubbleWidthAtFixedFont(
                  text, effectiveFs, currentFontFam, !b.isInvalidBox, wordWrapLocale,
                ),
              );
            }
          }

          updateBubbleFrame();

          const bRect = wrapper.getBoundingClientRect();
          rCenterX = bRect.left + bRect.width / 2;
          rCenterY = bRect.top + bRect.height / 2;
          rStartAngle = Math.atan2(e.clientY - rCenterY, e.clientX - rCenterX) * (180 / Math.PI);

          try {
            handle.setPointerCapture(e.pointerId);
          } catch {
            // ignore
          }
          e.stopPropagation();
        });

        let pendingWidthPreviewFrame: number | null = null;
        let pendingWidthPointer: { pointerId: number; clientX: number; clientY: number } | null = null;

        const applyPointerMove = (clientX: number, clientY: number): void => {
          lastAppliedPreviewPointer = { clientX, clientY };
          const previousScale = { bx: currentBx, by: currentBy, bw: currentBw, bh: currentBh,
            font: b.fontSizeMultiplier, target: b.targetFontSize, minimum: manualMinHeightPx };
          let widthLayoutPreview: WidthLayoutPreview | undefined;
          const rect = tlContainer.getBoundingClientRect();
          const dx = (clientX - rStartX) * (iw / rect.width);
          const dy = (clientY - rStartY) * (ih / rect.height);
          
          if (id === 'rotate') {
            const curAngle = Math.atan2(clientY - rCenterY, clientX - rCenterX) * (180 / Math.PI);
            const angleDiff = curAngle - rStartAngle;
            const rawRotation = (rInitRot + angleDiff + 360) % 360;
            currentRotation = snapRotationToRightAngle(rawRotation);
          } else if (id === 'width') {
            // Drag right (dx > 0) widens, drag left (dx < 0) narrows
            const widthGeometry = widthGeometryForDrag(dx);
            currentBw = widthGeometry.width;
            currentBx = widthGeometry.left;
            // Ticket 02: Keep b.fontSizeMultiplier locked.
            // Ticket 03: Top-anchored dynamic auto-height:
            const text = (b.t || b.translated || "").trim();
            if (text) {
              const currentStyle = textStyleRef?.current || ts;
              const currentFontFam = resolveCanvasFontFamily(currentStyle.fontFamily);
              const bubbleMult = typeof b.fontSizeMultiplier === "number" ? b.fontSizeMultiplier : 1.0;
              const globalMult = currentStyle.fontSizeMultiplier || 1.0;
              const targetFs = typeof b.targetFontSize === "number" && Number.isFinite(b.targetFontSize) && b.targetFontSize > 0
                ? b.targetFontSize
                : (rDragTargetFs || 16);
              const effectiveFs = Math.max(8, Math.round(targetFs * globalMult * bubbleMult));
              const isOvalBox = !b.isInvalidBox;
              const layout = layoutBubbleAtFixedFont(
                text,
                currentBw,
                effectiveFs,
                currentFontFam,
                isOvalBox,
                manualMinHeightPx ?? 25,
                Math.max(0, ih - rDragInitBy),
                wordWrapLocale,
              );
              widthLayoutPreview = {
                layout,
                text,
                widthPx: currentBw,
                fontSizePx: effectiveFs,
                fontFamily: currentFontFam,
                isOval: isOvalBox,
                manualMinHeightPx: manualMinHeightPx ?? 25,
                availableHeightPx: Math.max(0, ih - rDragInitBy),
                locale: wordWrapLocale,
              };
              currentBh = layout.heightPx;
              currentBy = rDragInitBy;
            }
          } else if (id === 'scale') {
            // Project onto the corner diagonal: one scale controls both axes
            // and the font, including horizontal-only or vertical-only drags.
            const angle = rInitRot * Math.PI / 180;
            const localDx = dx * Math.cos(angle) + dy * Math.sin(angle);
            const localDy = -dx * Math.sin(angle) + dy * Math.cos(angle);
            const requestedScale = 1 + (localDx*rInitBw-localDy*rInitBh)/(rInitBw*rInitBw+rInitBh*rInitBh);
            const minScale = Math.max(20/rInitBw,25/rInitBh,.4/rInitFontMult,
              rInitRenderedFontSize > 0 ? 8/rInitRenderedFontSize : 0);
            const maxScale = Math.max(
              3 / rInitFontMult,
              rInitRenderedFontSize > 0 ? 72 / rInitRenderedFontSize : 3,
            );
            const scale = Math.max(minScale,Math.min(maxScale,requestedScale));
            currentBw = rInitBw * scale;
            const newBh = rInitBh * scale;
            currentBy = rInitBy + (rInitBh - newBh);
            currentBh = newBh;
            b.fontSizeMultiplier = rInitFontMult * scale;
            if (Math.abs(scale-1) > .000001 && typeof rDragTargetFs === 'number') {
              b.targetFontSize = rDragTargetFs;
            }
            manualMinHeightPx = currentBh;
          } else if (id === 'move') {
            currentBx = rInitBx + dx;
            currentBy = rInitBy + dy;
          }
          if (id === "move" || id === "rotate") {
            updateBubbleFrame();
          } else if (id === "scale" && scaleDragSnapshot) {
            // Bitmap corner preview: scale the captured selection and rescale
            // the same canvas bitmap via proportional CSS sizing — zero
            // retypesetting, canvas resets or re-measuring during the drag.
            const previewScale = rInitBw > 0 ? currentBw / rInitBw : 1;
            const scaleSelection = (k: number): SelectionRect => {
              const captured = scaleDragSnapshot!.selection;
              return { x: captured.x * k, y: captured.y * k,
                width: captured.width * k, height: captured.height * k };
            };
            textSelection = scaleSelection(previewScale);
            // Resolve the anchor before page constraints. Keep the last valid
            // scale when growth would cross an edge, rather than clipping its
            // height differently on redo, reopening, or export.
            pinScaleAnchor();
            if (currentBx < 0 || currentBy < 0 || currentBx + currentBw > iw || currentBy + currentBh > ih) {
              currentBx = previousScale.bx; currentBy = previousScale.by;
              currentBw = previousScale.bw; currentBh = previousScale.bh;
              b.fontSizeMultiplier = previousScale.font; b.targetFontSize = previousScale.target;
              manualMinHeightPx = previousScale.minimum;
              textSelection = scaleSelection(rInitBw > 0 ? currentBw / rInitBw : 1);
            }
            updateBubbleFrame();
          } else {
            renderBubble(id === "scale" ? ih : undefined, 1, id === "width" ? widthLayoutPreview : undefined);
            if (id === "scale") {
              pinScaleAnchor();
              if (currentBx < 0 || currentBy < 0 || currentBx + currentBw > iw || currentBy + currentBh > ih) {
                currentBx = previousScale.bx; currentBy = previousScale.by;
                currentBw = previousScale.bw; currentBh = previousScale.bh;
                b.fontSizeMultiplier = previousScale.font; b.targetFontSize = previousScale.target;
                manualMinHeightPx = previousScale.minimum;
                renderBubble();
              } else {
                updateBubbleFrame();
              }
            }
          }
        };

        const cancelPendingWidthPreview = (): void => {
          if (pendingWidthPreviewFrame !== null) {
            window.cancelAnimationFrame(pendingWidthPreviewFrame);
            pendingWidthPreviewFrame = null;
          }
          pendingWidthPointer = null;
        };
        cancelDragPreviews.push(cancelPendingWidthPreview);

        const flushPendingWidthPreview = (pointer?: { pointerId: number; clientX: number; clientY: number }): void => {
          if (pendingWidthPreviewFrame !== null) {
            window.cancelAnimationFrame(pendingWidthPreviewFrame);
            pendingWidthPreviewFrame = null;
          }
          const latest = pointer ?? pendingWidthPointer;
          pendingWidthPointer = null;
          if (latest && handle.hasPointerCapture(latest.pointerId)
            && (latest.clientX !== lastAppliedPreviewPointer?.clientX || latest.clientY !== lastAppliedPreviewPointer?.clientY)) {
            applyPointerMove(latest.clientX, latest.clientY);
          }
        };

        handle.addEventListener('pointermove', (e) => {
          if (!handle.hasPointerCapture(e.pointerId)) return;
          if (e.clientX === rStartX && e.clientY === rStartY && !handleDidMove) return;
          handleDidMove = true;
          if (id === "width") {
            const rect = tlContainer.getBoundingClientRect();
            const dx = (e.clientX - rStartX) * (iw / rect.width);
            const widthGeometry = widthGeometryForDrag(dx);
            if (Math.abs(widthGeometry.width - rDragInitBw) < 0.001 && Math.abs(widthGeometry.left - rDragInitBx) < 0.001) return;
            widthDragDidMove = true;
          }
          pendingWidthPointer = { pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY };
          if (pendingWidthPreviewFrame === null) {
            pendingWidthPreviewFrame = window.requestAnimationFrame(() => {
              pendingWidthPreviewFrame = null;
              const latest = pendingWidthPointer;
              pendingWidthPointer = null;
              if (latest && !isStaleOverlay() && handle.hasPointerCapture(latest.pointerId)) {
                applyPointerMove(latest.clientX, latest.clientY);
              }
            });
          }
        });

        handle.addEventListener('pointerup', (e) => {
          e.stopPropagation();
          if (id === "width" ? widthDragDidMove : handleDidMove || e.clientX !== rStartX || e.clientY !== rStartY) {
            flushPendingWidthPreview({ pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY });
          }
          try {
            handle.releasePointerCapture(e.pointerId);
          } catch {
            // ignore
          }
          const unchangedScale = id === "scale"
            && Math.abs(currentBx - rInitBx) < .001 && Math.abs(currentBy - rInitBy) < .001
            && Math.abs(currentBw - rInitBw) < .001 && Math.abs(currentBh - rInitBh) < .001
            && (b.fontSizeMultiplier ?? 1) === rInitFontMult && b.targetFontSize === rInitTargetFs;
          if ((id === "width" && !widthDragDidMove) || unchangedScale) {
            resizeDragActive = false;
            widthSelectionPreview = false;
            currentBx = rInitBx;
            currentBy = rInitBy;
            currentBw = rInitBw;
            currentBh = rInitBh;
            currentRotation = rInitRot;
            b.targetFontSize = rInitTargetFs;
            manualMinHeightPx = rInitManualMinHeightPx;
            if (scaleDragSnapshot) textSelection = { ...scaleDragSnapshot.selection };
            scaleDragSnapshot = null;
            floorBase = { w: rInitBw, h: rInitBh };
            updateBubbleFrame();
            return;
          }
          const wasResizing = resizeDragActive;
          resizeDragActive = false;
          widthSelectionPreview = false;
          if (id === "scale") manualMinHeightPx = currentBh;
          // Re-apply the frame floor once, now that the drag has ended. A
          // corner drag redraws crisply in a single pass: the captured layout
          // is rescaled by the committed drag scale (same lines, float font).
          if (wasResizing || id === "move") {
            if (id === "scale" && scaleDragSnapshot && rInitBw > 0) {
              renderBubble(undefined, currentBw / rInitBw);
            } else if (id === "width") {
              // The latest width preview already drew the exact committed layout;
              // refresh selectionFrame and chrome positions now that widthSelectionPreview is false.
              updateBubbleFrame();
            } else {
              renderBubble();
            }
          }
          if (id === "scale") {
            pinScaleAnchor();
            updateBubbleFrame();
          }
          if (id === "width" && typeof b.targetFontSize !== "number" && typeof rDragTargetFs === "number") {
            b.targetFontSize = rDragTargetFs;
          }
          scaleDragSnapshot = null;
          saveAdjustment();

          if (id === 'scale' && Math.abs((b.fontSizeMultiplier ?? 1)-rInitFontMult) > .000001) b.sourceSizing = manualSourceSizing(b.sourceSizing,b.box);
          if (id === 'scale' || id === 'width') b.userTextSpace = {owner:'manual',rect:{x:currentBx,y:currentBy,width:currentBw,height:currentBh},imageWidth:iw,imageHeight:ih};
          const finalUserSpace = b.userTextSpace;
          const finalSizing = b.sourceSizing;
          const finalBx = currentBx, finalBy = currentBy, finalBw = currentBw, finalBh = currentBh, finalRot = currentRotation;
          const finalFontMult = typeof b.fontSizeMultiplier === "number" ? b.fontSizeMultiplier : 1.0;
          const finalTargetFs = b.targetFontSize;
          const finalManualMinHeight = manualMinHeightPx;
          const finalSnapshot = b.layoutSnapshot;
          if (
            finalBx !== rInitBx ||
            finalBy !== rInitBy ||
            finalBw !== rInitBw ||
            finalBh !== rInitBh ||
            finalRot !== rInitRot ||
            finalFontMult !== rInitFontMult ||
            finalTargetFs !== rInitTargetFs ||
            finalManualMinHeight !== rInitManualMinHeightPx
          ) {
            undoManager.push({
              label:
                id === "width"
                  ? "ปรับความกว้างกล่องข้อความ"
                  : id === "scale"
                  ? "ปรับขนาดกล่องข้อความ"
                  : id === "rotate"
                  ? "หมุนกล่องข้อความ"
                  : "ย้ายตำแหน่งกล่องข้อความ",
              undo: () => {
                currentBx = rInitBx;
                currentBy = rInitBy;
                currentBw = rInitBw;
                currentBh = rInitBh;
                currentRotation = rInitRot;
                b.fontSizeMultiplier = rInitFontMult;
                b.sourceSizing = rInitSizing;
                b.userTextSpace = rInitUserSpace;
                b.targetFontSize = rInitTargetFs;
                manualMinHeightPx = rInitManualMinHeightPx;
                b.layoutSnapshot = rInitSnapshot;
                floorBase = { w: rInitBw, h: rInitBh };
                renderBubble();
                saveAdjustment();
              },
              redo: () => {
                currentBx = finalBx;
                currentBy = finalBy;
                currentBw = finalBw;
                currentBh = finalBh;
                currentRotation = finalRot;
                b.fontSizeMultiplier = finalFontMult;
                b.sourceSizing = finalSizing;
                b.userTextSpace = finalUserSpace;
                b.targetFontSize = finalTargetFs;
                manualMinHeightPx = finalManualMinHeight;
                b.layoutSnapshot = finalSnapshot;
                floorBase = { w: finalBw, h: finalBh };
                renderBubble();
                saveAdjustment();
              },
            });
          }
        });

        handle.addEventListener('pointercancel', (e) => {
          e.stopPropagation();
          cancelPendingWidthPreview();
          try {
            handle.releasePointerCapture(e.pointerId);
          } catch {
            // ignore
          }
          resizeDragActive = false;
          widthSelectionPreview = false;
          currentBx = rInitBx;
          currentBy = rInitBy;
          currentBw = rInitBw;
          currentBh = rInitBh;
          currentRotation = rInitRot;
          b.fontSizeMultiplier = rInitFontMult;
          b.targetFontSize = rInitTargetFs;
          manualMinHeightPx = rInitManualMinHeightPx;
          b.layoutSnapshot = rInitSnapshot;
          if (scaleDragSnapshot) textSelection = { ...scaleDragSnapshot.selection };
          scaleDragSnapshot = null;
          floorBase = { w: rInitBw, h: rInitBh };
          renderBubble();
        });

        chromeHandles.push(handle);
        (chromeRoot ?? wrapper).appendChild(handle);
      });

      // 2. Top Floating Quick Action Toolbar
      const toolbar = document.createElement("div");
      toolbar.className = "bubble-quick-toolbar action-handle";
      toolbar.setAttribute("data-translation-chrome", "true");
      toolbar.style.cssText = `
        position: absolute;
        left: 0;
        top: 0;
        transform: translate(-50%, -100%);
        background: rgba(24, 24, 27, 0.96);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.24);
        border-radius: 9px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
        padding: 3px 4px;
        display: flex;
        align-items: center;
        gap: 2px;
        max-width: calc(100% - 16px);
        overflow: visible;
        z-index: 50;
        opacity: 0;
        pointer-events: none;
        transition: opacity 120ms ease-out;
        user-select: none;
      `;

      const createToolBtn = (title: string, svg: string, onClick: () => void, isDanger = false) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.title = title;
        btn.setAttribute("aria-label", title);
        btn.className = "action-handle";
        btn.innerHTML = svg;
        btn.style.cssText = `
          width: 30px;
          height: 30px;
          border-radius: 6px;
          background: transparent;
          color: ${isDanger ? '#ef4444' : '#e4e4e7'};
          border: none;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          padding: 0;
          transition: background 150ms ease, color 150ms ease, transform 120ms ease;
        `;
        btn.onmouseenter = () => {
          btn.style.background = isDanger ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.15)';
          btn.style.transform = 'scale(1.08)';
          if (isDanger) btn.style.color = '#f87171';
        };
        btn.onmouseleave = () => {
          btn.style.background = 'transparent';
          btn.style.transform = 'scale(1)';
          btn.style.color = isDanger ? '#ef4444' : '#e4e4e7';
        };
        btn.onpointerdown = (e) => e.stopPropagation();
        btn.onclick = (e) => {
          e.stopPropagation();
          onClick();
        };
        return btn;
      };

      // Decrease Font Size Button [A-]
      const decreaseFontBtn = createToolBtn(
        "ลดขนาดข้อความ (A- หรือคีย์ -)",
        `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18 9 5l5 13"/><path d="M6 13h6"/><line x1="16" y1="12" x2="22" y2="12"/></svg>`,
        () => adjustBubbleFontSize(-0.12)
      );

      // Increase Font Size Button [A+]
      const increaseFontBtn = createToolBtn(
        "เพิ่มขนาดข้อความ (A+ หรือคีย์ +)",
        `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18 9 5l5 13"/><path d="M6 13h6"/><line x1="19" y1="9" x2="19" y2="15"/><line x1="16" y1="12" x2="22" y2="12"/></svg>`,
        () => adjustBubbleFontSize(0.12)
      );

      // Edit Text (Pencil) Button
      const editBtn = createToolBtn(
        "แก้ไขข้อความ",
        `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`,
        () => {
          openLiveEditor();
        }
      );

      const createDivider = () => {
        const div = document.createElement("div");
        div.style.cssText = `width:1px; height:18px; background:rgba(255,255,255,0.2); margin:0 2px;`;
        return div;
      };

      // Delete Button (Red Trash)
      const deleteBtn = createToolBtn(
        "ลบกล่องข้อความ",
        `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>`,
        () => {
          deleteBubbleWithUndo();
        },
        true
      );

      const bwContrastLabel = () => {
        const mode = b.styleProfile?.bwContrastMode;
        if (mode === "black_on_white") return "โหมดขาว-ดำ: ดำ-ขาว (ตัวดำ ขอบขาวหนา)";
        if (mode === "white_on_black") return "โหมดขาว-ดำ: ขาว-ดำ (ตัวขาว ขอบดำหนา)";
        if (mode === "pure_black") return "โหมดขาว-ดำ: ดำล้วน";
        if (mode === "auto") return "โหมดขาว-ดำ: ออโต้";
        return "สลับโหมดสี ขาว-ดำ / ดำ-ขาว";
      };

      const bwContrastBtn = createToolBtn(
        bwContrastLabel(),
        `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/></svg>`,
        () => {
          const currentMode = b.styleProfile?.bwContrastMode;
          const nextMode: BwContrastMode =
            currentMode === "black_on_white"
              ? "white_on_black"
              : currentMode === "white_on_black"
                ? "pure_black"
                : currentMode === "pure_black"
                  ? "auto"
                  : "black_on_white";
          const prevProfile = cloneTextStyleProfile(b.styleProfile);
          const updated = applyBwContrastModeToBubble(b, nextMode);
          b.styleProfile = updated.styleProfile;
          bwContrastBtn.setAttribute("aria-label", bwContrastLabel());
          bwContrastBtn.title = bwContrastLabel();
          onBubblesMutated?.();
          renderBubble();
          saveAdjustment();
          const nextProfile = cloneTextStyleProfile(b.styleProfile);
          undoManager.push({
            label: `สลับโหมดขาว-ดำ (${nextMode})`,
            undo: () => {
              b.styleProfile = cloneTextStyleProfile(prevProfile);
              bwContrastBtn.setAttribute("aria-label", bwContrastLabel());
              bwContrastBtn.title = bwContrastLabel();
              renderBubble();
              saveAdjustment();
            },
            redo: () => {
              b.styleProfile = cloneTextStyleProfile(nextProfile);
              bwContrastBtn.setAttribute("aria-label", bwContrastLabel());
              bwContrastBtn.title = bwContrastLabel();
              renderBubble();
              saveAdjustment();
            },
          });
        },
      );

      const syncItalicBtnStyle = (btnEl: HTMLButtonElement) => {
        const active = Boolean(b.isItalic ?? b.italic ?? currentIsItalic);
        btnEl.setAttribute("aria-pressed", String(active));
        btnEl.style.color = active ? "var(--primary, #f43f5e)" : "#e4e4e7";
        btnEl.style.background = active ? "rgba(244, 63, 94, 0.22)" : "transparent";
      };

      const toggleBubbleItalic = () => {
        const prevItalic = Boolean(b.isItalic ?? b.italic ?? currentIsItalic);
        const nextItalic = !prevItalic;
        const prevSnapshot = b.layoutSnapshot;
        currentIsItalic = nextItalic;
        b.isItalic = nextItalic;
        b.italic = nextItalic;
        delete b.layoutSnapshot;
        syncItalicBtnStyle(italicBtn);
        onBubblesMutated?.();
        renderBubble();
        const nextSnapshot = b.layoutSnapshot;
        saveAdjustment();
        undoManager.push({
          label: nextItalic ? "เปิดข้อความตัวเอียง" : "ปิดข้อความตัวเอียง",
          undo: () => {
            currentIsItalic = prevItalic;
            b.isItalic = prevItalic;
            b.italic = prevItalic;
            b.layoutSnapshot = prevSnapshot;
            syncItalicBtnStyle(italicBtn);
            renderBubble();
            saveAdjustment();
          },
          redo: () => {
            currentIsItalic = nextItalic;
            b.isItalic = nextItalic;
            b.italic = nextItalic;
            b.layoutSnapshot = nextSnapshot;
            syncItalicBtnStyle(italicBtn);
            renderBubble();
            saveAdjustment();
          },
        });
      };

      const applyBubbleRotationAndSlant = (nextRot: number, nextItalic: boolean, label = "ปรับองศาเอียงข้อความ") => {
        const prevRot = currentRotation;
        const prevItalic = Boolean(b.isItalic ?? b.italic ?? currentIsItalic);
        const prevSnapshot = b.layoutSnapshot;
        currentRotation = nextRot;
        currentIsItalic = nextItalic;
        b.rotation = nextRot;
        b.isItalic = nextItalic;
        b.italic = nextItalic;
        delete b.layoutSnapshot;
        syncItalicBtnStyle(italicBtn);
        onBubblesMutated?.();
        renderBubble();
        const nextSnapshot = b.layoutSnapshot;
        saveAdjustment();
        undoManager.push({
          label,
          undo: () => {
            currentRotation = prevRot;
            currentIsItalic = prevItalic;
            b.rotation = prevRot;
            b.isItalic = prevItalic;
            b.italic = prevItalic;
            b.layoutSnapshot = prevSnapshot;
            syncItalicBtnStyle(italicBtn);
            renderBubble();
            saveAdjustment();
          },
          redo: () => {
            currentRotation = nextRot;
            currentIsItalic = nextItalic;
            b.rotation = nextRot;
            b.isItalic = nextItalic;
            b.italic = nextItalic;
            b.layoutSnapshot = nextSnapshot;
            syncItalicBtnStyle(italicBtn);
            renderBubble();
            saveAdjustment();
          },
        });
      };

      const italicBtn = createToolBtn(
        "สลับตัวอักษรเอียง (Italic หรือคีย์ I)",
        `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/></svg>`,
        () => toggleBubbleItalic(),
      );
      syncItalicBtnStyle(italicBtn);

      const tiltBtn = createToolBtn(
        "เอียงข้อความตามต้นฉบับ / สลับมุมเอียง (คีย์ Q / E)",
        `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17 20 9"/><path d="M6 20h14"/><path d="M16 7l4 2-2 4"/></svg>`,
        () => {
          const normRot = ((currentRotation + 540) % 360) - 180;
          if (Math.abs(normRot) < 1.5) {
            let targetAngle = -12;
            if (img && (img.naturalWidth > 0 || img.width > 0) && b.box && b.box.length === 4) {
              const sample = sampleBubbleRegion(img, b.box);
              const detected = estimateSourceTextTiltAngle(sample);
              if (Math.abs(detected.rotationDeg) >= 3.5) {
                targetAngle = detected.rotationDeg;
              }
            }
            applyBubbleRotationAndSlant(targetAngle, true, "เอียงข้อความตามต้นฉบับ");
          } else if (normRot < 0) {
            applyBubbleRotationAndSlant(12, true, "สลับมุมเอียงข้อความ (+12°)");
          } else {
            applyBubbleRotationAndSlant(0, false, "รีเซ็ตมุมเอียงข้อความ (0°)");
          }
        },
      );

      const syncWarpBtnStyle = (btnEl: HTMLButtonElement) => {
        const active = Boolean(b.warp && b.warp.type !== "none");
        btnEl.setAttribute("aria-pressed", String(active));
        btnEl.title = `ดัดรูปทรง SFX: ${getWarpLabel(b.warp?.type ?? "none")} (คลิกเพื่อเปลี่ยนรูปทรง)`;
        btnEl.style.color = active ? "var(--primary, #f43f5e)" : "#e4e4e7";
        btnEl.style.background = active ? "rgba(244, 63, 94, 0.22)" : "transparent";
      };

      const warpBtn = createToolBtn(
        `ดัดรูปทรง SFX: ${getWarpLabel(b.warp?.type ?? "none")} (คลิกเพื่อเปลี่ยนรูปทรง)`,
        `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14c2-4 5-6 8-6s6 2 8 6"/><path d="M12 3v3"/><path d="M3 21l3-3"/><path d="M21 21l-3-3"/></svg>`,
        () => {
          const currentType = b.warp?.type ?? "none";
          const nextType = getNextWarpType(currentType);
          const prevWarp = b.warp ? { ...b.warp } : undefined;
          const nextWarp: WarpConfig | undefined =
            nextType === "none"
              ? undefined
              : { type: nextType, bend: 0.45, frequency: 1.5 };

          b.warp = nextWarp;
          syncWarpBtnStyle(warpBtn);
          delete b.layoutSnapshot;
          onBubblesMutated?.();
          renderBubble();
          saveAdjustment();

          undoManager.push({
            label: `ดัดรูปทรง SFX (${getWarpLabel(nextType)})`,
            undo: () => {
              b.warp = prevWarp;
              syncWarpBtnStyle(warpBtn);
              delete b.layoutSnapshot;
              onBubblesMutated?.();
              renderBubble();
              saveAdjustment();
            },
            redo: () => {
              b.warp = nextWarp;
              syncWarpBtnStyle(warpBtn);
              delete b.layoutSnapshot;
              onBubblesMutated?.();
              renderBubble();
              saveAdjustment();
            },
          });
        },
      );
      syncWarpBtnStyle(warpBtn);

      toolbar.appendChild(editBtn);
      toolbar.appendChild(decreaseFontBtn);
      toolbar.appendChild(increaseFontBtn);
      toolbar.appendChild(italicBtn);
      toolbar.appendChild(tiltBtn);
      toolbar.appendChild(warpBtn);
      toolbar.appendChild(bwContrastBtn);
      toolbar.appendChild(createDivider());
      toolbar.appendChild(deleteBtn);
      (chromeRoot ?? wrapper).appendChild(toolbar);

      const positionChromeControls = () => {
        if (wrapper.style.display === "none") return;
        const selection = visibleSelection();
        const localPoints: Record<string, [number, number]> = {
          nw: [selection.x, selection.y],
          ne: [selection.x + selection.width, selection.y],
          e: [selection.x + selection.width, selection.y + selection.height / 2],
          sw: [selection.x, selection.y + selection.height],
        };

        if (!chromeRoot) {
          const isCompact = currentBw < 85 || currentBh < 85;
          const padPercentX = isCompact ? Math.max(6, Math.round((85 - currentBw) / 2)) : 0;
          const padPercentY = isCompact ? Math.max(6, Math.round((85 - currentBh) / 2)) : 0;
          chromeHandles.forEach((handle) => {
            const pos = handle.dataset.handlePosition ?? "nw";
            const [left, top] = localPoints[pos];
            handle.style.left = `${left / currentBw * 100}%`;
            handle.style.top = `${top / currentBh * 100}%`;
            let baseTranslate = "translate(-50%, -50%)";
            if (isCompact) {
              if (pos === "nw") baseTranslate = `translate(calc(-50% - ${padPercentX}px), calc(-50% - ${padPercentY}px))`;
              else if (pos === "ne") baseTranslate = `translate(calc(-50% + ${padPercentX}px), calc(-50% - ${padPercentY}px))`;
              else if (pos === "e") baseTranslate = `translate(calc(-50% + ${padPercentX}px), calc(-50% + ${Math.round(padPercentY * 1.5)}px))`;
              else if (pos === "sw") baseTranslate = `translate(calc(-50% - ${padPercentX}px), calc(-50% + ${padPercentY}px))`;
            }
            handle.dataset.baseTranslate = baseTranslate;
            handle.style.transform = `${baseTranslate} scale(1)`;
          });
          const wrapperChromeScale = Math.max(
            0.6,
            Math.min(1, wrapper.offsetWidth / 220, wrapper.offsetHeight / 100),
          );
          toolbar.style.zoom = String(wrapperChromeScale);
          chromeHandles.forEach((handle) => {
            handle.style.zoom = String(wrapperChromeScale);
          });
          toolbar.style.left = `${(selection.x + selection.width / 2) / currentBw * 100}%`;
          toolbar.style.top = `calc(${selection.y / currentBh * 100}% - ${isCompact ? 16 : 10}px)`;
          toolbar.style.transform = "translate(-50%, -100%)";
          activeEditorPosition?.();
          return;
        }

        const rootRect = chromeRoot.getBoundingClientRect();
        const stageRect = tlContainer.getBoundingClientRect();
        // The normal path derives rotated page bounds from the stage rect
        // alone; the per-bubble wrapper rect is read lazily only when the
        // stage has no measurable dimensions yet.
        const stageReady = stageRect.width > 0 && stageRect.height > 0;
        const bubbleRect = stageReady ? null : wrapper.getBoundingClientRect();
        const scaleX = stageRect.width > 0 ? stageRect.width / iw : (bubbleRect ? bubbleRect.width : 0) / currentBw;
        const scaleY = stageRect.height > 0 ? stageRect.height / ih : (bubbleRect ? bubbleRect.height : 0) / currentBh;
        const originX = stageRect.width > 0 ? stageRect.left + currentBx * scaleX : (bubbleRect ? bubbleRect.left : 0);
        const originY = stageRect.height > 0 ? stageRect.top + currentBy * scaleY : (bubbleRect ? bubbleRect.top : 0);
        const pointInChrome = (x: number, y: number) => {
          const point = rotateLocalPoint(x, y, currentBw, currentBh, currentRotation);
          return { x: originX - rootRect.left + point.x * scaleX, y: originY - rootRect.top + point.y * scaleY };
        };
        const corners = [localPoints.nw, localPoints.ne, localPoints.sw,
          [selection.x + selection.width, selection.y + selection.height]];
        const points = corners.map(([x, y]) => pointInChrome(x, y));
        const left = Math.min(...points.map(point => point.x));
        const top = Math.min(...points.map(point => point.y));
        const right = Math.max(...points.map(point => point.x));
        const bottom = Math.max(...points.map(point => point.y));
        const centerX = (left + right) / 2;

        // Chrome (toolbar + handles) must not dwarf small bubbles: shrink it
        // as the bubble shrinks, floored so buttons stay grabbable. `zoom`
        // keeps the translate(-50%, …) anchors intact while scaling the whole
        // rendered chrome — but it also multiplies the element's own left/top
        // lengths, so every offset written below is pre-divided by the scale
        // to stay anchored on the bubble.
        const chromeScale = Math.max(
          0.6,
          Math.min(1, (right - left) / 220, (bottom - top) / 100),
        );
        // offsetWidth/offsetHeight already include the previous sync's zoom.
        const prevChromeZoom = Number(toolbar.style.zoom) || 1;
        const baseToolbarWidth = toolbar.offsetWidth > 0 ? toolbar.offsetWidth / prevChromeZoom : 210;
        const baseToolbarHeight = toolbar.offsetHeight > 0 ? toolbar.offsetHeight / prevChromeZoom : 46;
        toolbar.style.zoom = String(chromeScale);
        chromeHandles.forEach((handle) => {
          handle.style.zoom = String(chromeScale);
        });
        const scaledWidth = baseToolbarWidth * chromeScale;
        const scaledHeight = baseToolbarHeight * chromeScale;
        const rootWidth = rootRect.width || Math.max(right + 16, baseToolbarWidth + 16);
        const boxW = right - left;
        const boxH = bottom - top;
        // In screen coordinates, a box with width < 85px or height < 85px is compact.
        // Outset handles outward to keep text clear and prevent handle collision.
        const isCompactW = (boxW > 0 || boxH > 0) && boxW < 85;
        const isCompactH = (boxH > 0 || boxH > 0) && boxH < 85;
        const isCompactBox = isCompactW || isCompactH;

        const padX = isCompactW ? Math.round(Math.max(6, (85 - boxW) / 2) / chromeScale) : 0;
        const padY = isCompactH ? Math.round(Math.max(6, (85 - boxH) / 2) / chromeScale) : 0;
        const padEastY = isCompactH ? Math.round(Math.max(12, (95 - boxH) / 2) / chromeScale) : 0;

        const placeBelow = top < scaledHeight + 14;
        const minCenter = scaledWidth / 2 + 8;
        const maxCenter = Math.max(minCenter, rootWidth - scaledWidth / 2 - 8);
        const toolbarX = Math.max(minCenter, Math.min(maxCenter, centerX));
        const bottomClearance = isCompactBox
          ? Math.max(bottom + padY * chromeScale, (top + bottom) / 2 + padEastY * chromeScale) + 12 * chromeScale
          : bottom;
        const toolbarY = placeBelow ? bottomClearance + 10 : top - 10;
        toolbar.style.left = `${toolbarX / chromeScale}px`;
        toolbar.style.top = `${toolbarY / chromeScale}px`;
        toolbar.style.transformOrigin = placeBelow ? "center top" : "center bottom";
        toolbar.style.transform = placeBelow ? "translate(-50%, 0)" : "translate(-50%, -100%)";

        chromeHandles.forEach((handle) => {
          const pos = handle.dataset.handlePosition ?? "nw";
          const local = localPoints[pos];
          const { x, y } = pointInChrome(...local);
          handle.style.left = `${x / chromeScale}px`;
          handle.style.top = `${y / chromeScale}px`;
          let baseTranslate = "translate(-50%, -50%)";
          if (isCompactBox) {
            if (pos === "nw") {
              baseTranslate = `translate(calc(-50% - ${padX}px), calc(-50% - ${padY}px))`;
            } else if (pos === "ne") {
              baseTranslate = `translate(calc(-50% + ${padX}px), calc(-50% - ${padY}px))`;
            } else if (pos === "e") {
              baseTranslate = `translate(calc(-50% + ${padX}px), calc(-50% + ${padEastY}px))`;
            } else if (pos === "sw") {
              baseTranslate = `translate(calc(-50% - ${padX}px), calc(-50% + ${padY}px))`;
            }
          }
          handle.dataset.baseTranslate = baseTranslate;
          handle.style.transform = `${baseTranslate} scale(1)`;
        });
        activeEditorPosition?.();
      };

      const setChromeVisible = (visible: boolean) => {
        toolbar.style.opacity = visible ? "1" : "0";
        toolbar.style.pointerEvents = visible ? "auto" : "none";
        chromeHandles.forEach((handle) => {
          handle.style.opacity = visible ? "1" : "0";
          handle.style.pointerEvents = visible ? "auto" : "none";
        });
      };

      chromeControlsByWrapper.set(wrapper, {
        toolbar,
        handles: chromeHandles,
        position: positionChromeControls,
        setVisible: setChromeVisible,
      });
      }

      tlContainer.appendChild(wrapper);
      renderBubble();
    });

    if (viewMode !== "offscreen") {
    const syncSelectedChrome = () => {
      if (!selectedBubbleWrapper) return;
      chromeControlsByWrapper.get(selectedBubbleWrapper)?.position();
    };
    let chromeSyncFrame: number | null = null;
    let chromeSyncFramesRemaining = 0;
    const runChromeSyncFrame = () => {
      chromeSyncFrame = null;
      syncSelectedChrome();
      chromeSyncFramesRemaining = Math.max(0, chromeSyncFramesRemaining - 1);
      if (chromeSyncFramesRemaining > 0) {
        chromeSyncFrame = requestAnimationFrame(runChromeSyncFrame);
      }
    };
    const scheduleChromeSync = (frames = 1) => {
      chromeSyncFramesRemaining = Math.max(chromeSyncFramesRemaining, frames);
      if (chromeSyncFrame === null) chromeSyncFrame = requestAnimationFrame(runChromeSyncFrame);
    };
    scheduleChromeSyncRef = scheduleChromeSync;

    const stageObserver = chromeRoot && typeof MutationObserver !== "undefined"
      ? new MutationObserver(() => scheduleChromeSync(12))
      : null;
    stageObserver?.observe(container, { attributes: true, attributeFilter: ["style", "class"] });

    const chromeResizeObserver = chromeRoot && typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => scheduleChromeSync(2))
      : null;
    if (chromeRoot && chromeResizeObserver) {
      chromeResizeObserver.observe(chromeRoot);
      chromeResizeObserver.observe(container);
    }

    const handleViewportChange = () => scheduleChromeSync(2);
    const handleDocumentPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        !target.closest('.translation-bubble-wrapper') &&
        !target.closest('.action-handle') &&
        !target.closest('[data-translation-editor]') &&
        !target.closest('[data-inspector-panel="true"]') &&
        !target.closest('[data-testid="text-properties-panel"]') &&
        !target.closest('[data-testid="workspace-inspector-panel"]') &&
        !target.closest('#warp-panel-section') &&
        !target.closest('[aria-label="คุณสมบัติข้อความ"]') &&
        !target.closest('[aria-label="แผงดัดตัวอักษรและรูปภาพ"]') &&
        !target.closest('[aria-label="สถานะการจับคู่สี"]') &&
        !target.closest('[data-testid="remnant-review-findings"]')
      ) {
        setSelectedBubble(null);
      }
    };
    const handleDocumentKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") setSelectedBubble(null); };
    const detachDocumentListeners = () => {
      for (const cancelPreview of cancelDragPreviews) cancelPreview();
      document.removeEventListener('pointerdown', handleDocumentPointerDown);
      document.removeEventListener('keydown', handleDocumentKeyDown);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
      stageObserver?.disconnect();
      chromeResizeObserver?.disconnect();
      if (chromeSyncFrame !== null) cancelAnimationFrame(chromeSyncFrame);
      chromeRoot?.querySelectorAll('[data-translation-chrome]').forEach((el) => el.remove());
    };
    document.addEventListener('pointerdown', handleDocumentPointerDown);
    document.addEventListener('keydown', handleDocumentKeyDown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    (tlContainer as unknown as { _cleanupListeners: () => void })._cleanupListeners = detachDocumentListeners;
    overlayCleanups.set(container, detachDocumentListeners);
    }

    container.appendChild(tlContainer);

    if (onComplete) {
      setTimeout(() => {
        const url = downloadTranslatedImage(viewMode, currentPage, "", true, container);
        if (viewMode === "offscreen") {
          tlContainer.querySelectorAll("canvas").forEach((cvs) => {
            cvs.width = 0;
            cvs.height = 0;
          });
        }
        if (url) onComplete(url);
      }, 100);
    }
  };

  const paintWhenReady = () => {
    if (img.complete && img.naturalWidth) paint();
    else img.onload = () => paint();
  };
  if (typeof document !== "undefined" && document.fonts?.load) {
    document.fonts
      .load(`1em ${resolveCanvasFontFamily(textStyleRef?.current?.fontFamily)}`)
      .then(paintWhenReady)
      .catch(paintWhenReady);
  } else {
    paintWhenReady();
  }
};

export {
  detectBubbleCollisions,
  autoOrganizePageBubbles,
  autoOrganizeAllPagesBubbles,
  fitBubbleTextWithinBounds,
  resolveBubbleCollisions,
} from "./bubbleLayoutOptimizer";

export {
  fitTextVertically,
  isCJKLanguage,
  shouldPreferVerticalTypesetting,
} from "./typeset/verticalTypography";


