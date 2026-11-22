import { type SelectionRect } from "./textSelectionBounds";
import { repairExcludedScriptText } from "./languagePolicy";

export { repairExcludedScriptText };
import {
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
import {
  detectBubbleCollisions,
  autoOrganizePageBubbles,
  isCorruptedAutoAdjustment,
} from "./bubbleLayoutOptimizer";
import { readPageImageLayers } from "./editing/imageLayerStore";
import type {
  TranslatedBubble,
  OverlayTextStyle,
  OverlayAdjustment,
  BubbleProportionalLayout,
} from "./overlay/overlayTypes";

export type { TranslatedBubble, OverlayTextStyle, OverlayAdjustment, BubbleProportionalLayout };
import { downloadTranslatedImage } from "./overlay/exportTranslatedImage";

export { downloadTranslatedImage } from "./overlay/exportTranslatedImage";
import {
  defaultReviewApiKeyProvider,
  type ReviewApiKeyProvider,
} from "./overlay/qualityReviewActions";
import { renderBubbleContent, type BubbleRenderSharedState, type WidthLayoutPreview } from "./overlay/bubbleRenderer";
import { wireBubbleSelectionAndMove, wireBubbleResizeChrome } from "./overlay/bubbleInteraction";
import { createSelectionChrome, pruneOverlayCleanups } from "./overlay/bubbleInteraction";

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
} from "./overlay/bubbleTextFit";
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

// Each applyTranslationOverlay bumps its container's generation; a paint
// whose generation is no longer current (page switched underneath it) must
// bail instead of repainting the previous page over the current one.
const overlayGenerations = new WeakMap<Element, number>();


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

    const selection = createSelectionChrome({
      container,
      tlContainer,
      chromeRoot,
      viewMode,
    });
    const chromeControlsByWrapper = selection.chromeControlsByWrapper;
    // Set once scheduleChromeSync exists (it is declared after the bubble
    // builders); selection updates that happen before it are harmless no-ops.
    let scheduleChromeSyncRef: ((frames?: number) => void) | null = null;

    let fallbackY2 = 10;

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
      const sharedState: BubbleRenderSharedState = {
        get currentBx() { return currentBx; },
        set currentBx(value: number) { currentBx = value; },
        get currentBy() { return currentBy; },
        set currentBy(value: number) { currentBy = value; },
        get currentBw() { return currentBw; },
        set currentBw(value: number) { currentBw = value; },
        get currentBh() { return currentBh; },
        set currentBh(value: number) { currentBh = value; },
        get currentRotation() { return currentRotation; },
        set currentRotation(value: number) { currentRotation = value; },
        get currentIsItalic() { return currentIsItalic; },
        set currentIsItalic(value: boolean) { currentIsItalic = value; },
        get widthSelectionPreview() { return widthSelectionPreview; },
        set widthSelectionPreview(value: boolean) { widthSelectionPreview = value; },
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
          state: sharedState,
        }, availableHeight, snapshotScale, widthLayoutPreview);
      };

      b.render = renderBubble;

      if (viewMode !== "offscreen") {
        const { openLiveEditor, deleteBubbleWithUndo, adjustBubbleFontSize } = wireBubbleSelectionAndMove({
          bubble: b,
          wrapper,
          tlContainer,
          chromeRoot,
          selectionFrame,
          image: img,
          bubbleId,
          pageWidth: iw,
          pageHeight: ih,
          targetLocale: wordWrapLocale,
          effectiveTarget,
          textStyle: ts,
          textStyleRef,
          reviewApiKeyProvider,
          onBubblesMutated,
          isStaleOverlay,
          toggleBubbleItalic: () => {
            toggleBubbleItalic();
          },
          applyBubbleRotationAndSlant: (nextRot, nextItalic, label) => {
            applyBubbleRotationAndSlant(nextRot, nextItalic, label);
          },
          getCurrentRotation: () => currentRotation,
          renderBubble,
          saveAdjustment,
          updateBubbleFrame,
          setActiveEditorPosition: (position) => {
            activeEditorPosition = position;
          },
          chrome: selection,
          state: sharedState,
        });

      wrapper.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        openLiveEditor();
      });

      const { toggleBubbleItalic, applyBubbleRotationAndSlant } = wireBubbleResizeChrome({
        bubble: b,
        wrapper,
        tlContainer,
        chromeRoot,
        image: img,
        pageWidth: iw,
        pageHeight: ih,
        targetLocale: wordWrapLocale,
        effectiveTarget,
        textStyle: ts,
        textStyleRef,
        onBubblesMutated,
        isStaleOverlay,
        adjustmentScaleX: adjSx,
        renderBubble,
        saveAdjustment,
        updateBubbleFrame,
        openLiveEditor,
        deleteBubbleWithUndo,
        adjustBubbleFontSize,
        getActiveEditorPosition: () => activeEditorPosition,
        visibleSelection,
        chrome: selection,
        state: sharedState,
      });

      }

      tlContainer.appendChild(wrapper);
      renderBubble();
    });

    scheduleChromeSyncRef = selection.scheduleChromeSync;

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


