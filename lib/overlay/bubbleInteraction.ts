// Selection, chrome-control and document-lifecycle machinery for the
// overlay. This module owns the cleanup registry behind the
// _cleanupListeners DOM contract and the document-level listeners as one
// set; per-bubble handlers wire in through the returned facade.

import type { TranslatedBubble } from "./overlayTypes";
import { undoManager } from "../undoManager";
import { sampleBubbleRegion } from "../colorMatching/canvasSampler";
import { extractTextColors } from "../colorMatching/sampleTextColors";
import { inferTextStyleCategory } from "../colorMatching/nearbyStyleFallback";
import type { WarpConfig } from "../tools/TextWarpRenderer";
import { openBubbleLiveEditor } from "./bubbleEditor";
import type { BubbleRenderSharedState, WidthLayoutPreview } from "./bubbleRenderer";
import type { ReviewApiKeyProvider } from "./qualityReviewActions";

const overlayCleanups = new Map<Element, () => void>();

export const pruneOverlayCleanups = (): void => {
  for (const [element, cleanup] of overlayCleanups) {
    if (!element.isConnected) {
      cleanup();
      overlayCleanups.delete(element);
    }
  }
};

export type BubbleChromeControls = {
  toolbar: HTMLElement;
  handles: HTMLElement[];
  position: () => void;
  setVisible: (visible: boolean) => void;
};

export type SelectedBubbleBridge = {
  bubble: TranslatedBubble;
  bubbleId: string;
  getFontSize: () => number;
  applyUpdates: (updates: Record<string, unknown>) => void;
  deleteBubble: () => void;
  reanalyzeColor: () => void;
};

export interface SelectionChromeDeps {
  container: Element;
  tlContainer: HTMLElement;
  chromeRoot: HTMLElement | null | undefined;
  viewMode: "single" | "scroll" | "offscreen";
}

export interface SelectionChromeHandle {
  chromeControlsByWrapper: WeakMap<HTMLElement, BubbleChromeControls>;
  selectedBubbleBridgeByWrapper: WeakMap<HTMLElement, SelectedBubbleBridge>;
  setSelectedBubble: (wrapper: HTMLElement | null) => void;
  getSelectedBubble: () => HTMLElement | null;
  scheduleChromeSync: ((frames?: number) => void) | null;
  cancelDragPreviews: Array<() => void>;
}

export const createSelectionChrome = (deps: SelectionChromeDeps): SelectionChromeHandle => {
  const { container, tlContainer, chromeRoot, viewMode } = deps;
  const chromeControlsByWrapper = new WeakMap<HTMLElement, BubbleChromeControls>();
  const cancelDragPreviews: Array<() => void> = [];
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

  let scheduleChromeSync: ((frames?: number) => void) | null = null;
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
    const scheduleChromeSyncNow = (frames = 1) => {
      chromeSyncFramesRemaining = Math.max(chromeSyncFramesRemaining, frames);
      if (chromeSyncFrame === null) chromeSyncFrame = requestAnimationFrame(runChromeSyncFrame);
    };
    scheduleChromeSync = scheduleChromeSyncNow;

    const stageObserver = chromeRoot && typeof MutationObserver !== "undefined"
      ? new MutationObserver(() => scheduleChromeSyncNow(12))
      : null;
    stageObserver?.observe(container, { attributes: true, attributeFilter: ["style", "class"] });

    const chromeResizeObserver = chromeRoot && typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => scheduleChromeSyncNow(2))
      : null;
    if (chromeRoot && chromeResizeObserver) {
      chromeResizeObserver.observe(chromeRoot);
      chromeResizeObserver.observe(container);
    }

    const handleViewportChange = () => scheduleChromeSyncNow(2);
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

  return {
    chromeControlsByWrapper,
    selectedBubbleBridgeByWrapper,
    setSelectedBubble,
    getSelectedBubble: () => selectedBubbleWrapper,
    scheduleChromeSync,
    cancelDragPreviews,
  };
};

export interface BubbleSelectionMoveDeps {
  bubble: TranslatedBubble;
  wrapper: HTMLElement;
  tlContainer: HTMLElement;
  chromeRoot: HTMLElement | null | undefined;
  selectionFrame: HTMLElement;
  image: HTMLImageElement | null;
  bubbleId: string;
  pageWidth: number;
  pageHeight: number;
  effectiveTarget: string;
  reviewApiKeyProvider: ReviewApiKeyProvider;
  onBubblesMutated?: () => void;
  isStaleOverlay: () => boolean;
  renderBubble: (availableHeight?: number, snapshotScale?: number, widthLayoutPreview?: WidthLayoutPreview) => void;
  saveAdjustment: () => void;
  updateBubbleFrame: () => void;
  setActiveEditorPosition: (position: (() => void) | null) => void;
  chrome: SelectionChromeHandle;
  state: BubbleRenderSharedState;
}

export const wireBubbleSelectionAndMove = (deps: BubbleSelectionMoveDeps): {
  openLiveEditor: () => void;
  deleteBubbleWithUndo: () => void;
} => {
  const {
    bubble: b,
    wrapper,
    tlContainer,
    chromeRoot,
    selectionFrame,
    image: img,
    bubbleId,
    pageWidth: iw,
    pageHeight: ih,
    effectiveTarget,
    reviewApiKeyProvider,
    onBubblesMutated,
    isStaleOverlay,
    renderBubble,
    saveAdjustment,
    updateBubbleFrame,
    setActiveEditorPosition,
    chrome,
    state,
  } = deps;
  const {
    chromeControlsByWrapper,
    selectedBubbleBridgeByWrapper,
    setSelectedBubble,
    getSelectedBubble,
    cancelDragPreviews,
  } = chrome;

  wrapper.addEventListener('mouseenter', () => { if (getSelectedBubble() !== wrapper) selectionFrame.style.outline = "1.5px dashed rgba(249,115,22,0.65)"; });
  wrapper.addEventListener('mouseleave', () => { if (getSelectedBubble() !== wrapper) selectionFrame.style.outline = "none"; });

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
    state.currentBx = initialBx + (clientX - dragStartX) * (iw / rect.width);
    state.currentBy = initialBy + (clientY - dragStartY) * (ih / rect.height);
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
    initialBx = state.currentBx;
    initialBy = state.currentBy;
    initialBw = state.currentBw;
    initialBh = state.currentBh;
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
      if (state.currentBx === initialBx && state.currentBy === initialBy) return;
      // One final layout settles page-edge constraints for preview/export parity.
      renderBubble();
      saveAdjustment();
      if (state.currentBx !== initialBx || state.currentBy !== initialBy) {
        const finalBx = state.currentBx, finalBy = state.currentBy, finalBw = state.currentBw, finalBh = state.currentBh;
        const startBx = initialBx, startBy = initialBy, startBw = initialBw, startBh = initialBh;
        undoManager.push({
          label: "ย้ายตำแหน่งกล่องข้อความ",
          undo: () => {
            state.currentBx = startBx;
            state.currentBy = startBy;
            state.currentBw = startBw;
            state.currentBh = startBh;
            renderBubble();
            saveAdjustment();
          },
          redo: () => {
            state.currentBx = finalBx;
            state.currentBy = finalBy;
            state.currentBw = finalBw;
            state.currentBh = finalBh;
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
      state.currentBx = initialBx;
      state.currentBy = initialBy;
      state.currentBw = initialBw;
      state.currentBh = initialBh;
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
      getCurrentRect: () => ({ x: state.currentBx, y: state.currentBy, w: state.currentBw, h: state.currentBh }),
      effectiveTarget,
      reviewApiKeyProvider,
      onBubblesMutated,
      renderBubble,
      saveAdjustment,
      setActiveEditorPosition,
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
    getFontSize: () => Math.round(state.renderedFontSize || b.targetFontSize || 20),
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
        state.currentIsItalic = updates.isItalic;
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

  return { openLiveEditor, deleteBubbleWithUndo };
};
