// Selection, chrome-control and document-lifecycle machinery for the
// overlay. Unit implementations live in their own modules; this file is
// the composition surface that re-exports them for the orchestrator.

import type { TranslatedBubble, OverlayTextStyle, BubbleProportionalLayout } from "./overlayTypes";
import { undoManager } from "../undoManager";
import { manualSourceSizing, type SourceSizing } from "../sourceTextSize";
import { sampleBubbleRegion } from "../colorMatching/canvasSampler";
import { extractTextColors } from "../colorMatching/sampleTextColors";
import { inferTextStyleCategory } from "../colorMatching/nearbyStyleFallback";
import { cloneTextStyleProfile, applyBwContrastModeToBubble } from "../colorMatching/resolveTextStyle";
import type { BwContrastMode } from "../colorMatching/types";
import { getWarpLabel, getNextWarpType, type WarpConfig } from "../tools/TextWarpRenderer";
import { openBubbleLiveEditor } from "./bubbleEditor";
import { resolveCanvasFontFamily } from "./canvasFont";
import { layoutBubbleAtFixedFont, measureBubbleRenderFit, minimumBubbleWidthAtFixedFont } from "./bubbleTextFit";
import { estimateSourceTextTiltAngle, snapRotationToRightAngle } from "./sourceGeometry";
import { rotateLocalPoint, type SelectionRect } from "../textSelectionBounds";
import type { BubbleRenderSharedState, WidthLayoutPreview } from "./bubbleRenderer";
import type { ReviewApiKeyProvider } from "./qualityReviewActions";
import type { SelectionChromeHandle } from "./interactionTypes";

export { pruneOverlayCleanups, overlayCleanups } from "./overlayLifecycle";
export type {
  BubbleChromeControls,
  SelectedBubbleBridge,
  SelectionChromeDeps,
  SelectionChromeHandle,
} from "./interactionTypes";
export { createSelectionChrome } from "./selectionChrome";


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
  targetLocale: string;
  effectiveTarget: string;
  textStyle: OverlayTextStyle;
  textStyleRef?: { current?: OverlayTextStyle };
  reviewApiKeyProvider: ReviewApiKeyProvider;
  onBubblesMutated?: () => void;
  isStaleOverlay: () => boolean;
  toggleBubbleItalic: () => void;
  applyBubbleRotationAndSlant: (nextRot: number, nextItalic: boolean, label?: string) => void;
  getCurrentRotation: () => number;
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
  adjustBubbleFontSize: (delta: number) => void;
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
    targetLocale: wordWrapLocale,
    effectiveTarget,
    textStyle: ts,
    textStyleRef,
    reviewApiKeyProvider,
    onBubblesMutated,
    isStaleOverlay,
    toggleBubbleItalic,
    applyBubbleRotationAndSlant,
    getCurrentRotation,
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

  const adjustBubbleFontSize = (delta: number) => {
    const oldMult = typeof b.fontSizeMultiplier === "number" ? b.fontSizeMultiplier : 1.0;
    const newMult = Math.max(0.4, Math.min(5.0, Number((oldMult + delta).toFixed(2))));
    if (newMult === oldMult) return;
    const snapshotBefore = b.layoutSnapshot;
    const sizingBefore = b.sourceSizing;
    const targetFsBefore = b.targetFontSize;
    const bxBefore = state.currentBx;
    const byBefore = state.currentBy;
    const bwBefore = state.currentBw;
    const bhBefore = state.currentBh;
    const minHeightBefore = state.manualMinHeightPx;

    b.sourceSizing = manualSourceSizing(b.sourceSizing,b.box);
    const sizingAfter = b.sourceSizing;

    const text = (b.t || b.translated || "").trim();
    if (text && typeof b.targetFontSize !== "number" && state.renderedFontSize > 0) {
      const currentStyle = textStyleRef?.current || ts;
      const globalMult = currentStyle.fontSizeMultiplier || 1.0;
      const divisor = globalMult * oldMult;
      if (divisor > 0) {
        b.targetFontSize = state.renderedFontSize / divisor;
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
      if (state.currentBw < 160 || state.currentBw < minWordW) {
        const grownW = Math.min(
          iw,
          Math.max(28, minWordW, Math.round(state.currentBw * scaleRatio)),
        );
        const grownH = Math.min(ih, Math.max(20, Math.round(state.currentBh * scaleRatio)));
        state.currentBx = Math.max(0, Math.min(iw - grownW, state.currentBx));
        state.currentBy = Math.max(0, Math.min(ih - grownH, state.currentBy));
        state.currentBw = grownW;
        state.currentBh = grownH;
        if (typeof state.manualMinHeightPx === "number") {
          state.manualMinHeightPx = Math.min(ih, Math.round(state.manualMinHeightPx * scaleRatio));
        }
      }
    }

    b.fontSizeMultiplier = newMult;
    onBubblesMutated?.();
    renderBubble();
    const snapshotAfter = b.layoutSnapshot;
    const targetFsAfter = b.targetFontSize;
    const bxAfter = state.currentBx;
    const byAfter = state.currentBy;
    const bwAfter = state.currentBw;
    const bhAfter = state.currentBh;
    const minHeightAfter = state.manualMinHeightPx;
    saveAdjustment();
    undoManager.push({
      label: delta > 0 ? "เพิ่มขนาดข้อความ" : "ลดขนาดข้อความ",
      undo: () => {
        state.currentBx = bxBefore;
        state.currentBy = byBefore;
        state.currentBw = bwBefore;
        state.currentBh = bhBefore;
        b.fontSizeMultiplier = oldMult;
        b.targetFontSize = targetFsBefore;
        state.manualMinHeightPx = minHeightBefore;
        b.sourceSizing = sizingBefore;
        b.layoutSnapshot = snapshotBefore;
        renderBubble();
        saveAdjustment();
      },
      redo: () => {
        state.currentBx = bxAfter;
        state.currentBy = byAfter;
        state.currentBw = bwAfter;
        state.currentBh = bhAfter;
        b.fontSizeMultiplier = newMult;
        b.targetFontSize = targetFsAfter;
        state.manualMinHeightPx = minHeightAfter;
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
      const normRot = ((getCurrentRotation() + 540) % 360) - 180;
      applyBubbleRotationAndSlant(Math.round((normRot - 4) * 10) / 10, Boolean(b.isItalic ?? b.italic ?? true), "หมุนข้อความเอียงขึ้น (-4°)");
      return;
    }

    if ((e.key === "e" || e.key === "E") && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      const normRot = ((getCurrentRotation() + 540) % 360) - 180;
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
      const initBx = state.currentBx;
      const initBy = state.currentBy;
      const initBw = state.currentBw;
      const initBh = state.currentBh;
      const initSnapshot = b.layoutSnapshot;

      if (e.altKey) {
        if (e.key === "ArrowRight") {
          state.currentBw = Math.max(20, Math.min(iw - state.currentBx, state.currentBw + delta));
        } else if (e.key === "ArrowLeft") {
          state.currentBw = Math.max(20, state.currentBw - delta);
        } else if (e.key === "ArrowDown") {
          state.currentBh = Math.max(20, Math.min(ih - state.currentBy, state.currentBh + delta));
        } else if (e.key === "ArrowUp") {
          state.currentBh = Math.max(20, state.currentBh - delta);
        }
      } else {
        if (e.key === "ArrowRight") {
          state.currentBx = Math.max(0, Math.min(iw - state.currentBw, state.currentBx + delta));
        } else if (e.key === "ArrowLeft") {
          state.currentBx = Math.max(0, Math.min(iw - state.currentBw, state.currentBx - delta));
        } else if (e.key === "ArrowDown") {
          state.currentBy = Math.max(0, Math.min(ih - state.currentBh, state.currentBy + delta));
        } else if (e.key === "ArrowUp") {
          state.currentBy = Math.max(0, Math.min(ih - state.currentBh, state.currentBy - delta));
        }
      }

      if (state.currentBx !== initBx || state.currentBy !== initBy || state.currentBw !== initBw || state.currentBh !== initBh) {
        renderBubble();
        const committedSnapshot = b.layoutSnapshot;
        saveAdjustment();
        const newBx = state.currentBx, newBy = state.currentBy, newBw = state.currentBw, newBh = state.currentBh;
        undoManager.push({
          label: e.altKey ? "ปรับขนาดกล่องข้อความ" : "ย้ายตำแหน่งกล่องข้อความ",
          undo: () => {
            state.currentBx = initBx; state.currentBy = initBy; state.currentBw = initBw; state.currentBh = initBh;
            b.layoutSnapshot = initSnapshot;
            renderBubble();
            saveAdjustment();
          },
          redo: () => {
            state.currentBx = newBx; state.currentBy = newBy; state.currentBw = newBw; state.currentBh = newBh;
            b.layoutSnapshot = committedSnapshot;
            renderBubble();
            saveAdjustment();
          },
        });
      }
    }
  });

  return { openLiveEditor, deleteBubbleWithUndo, adjustBubbleFontSize };
};

export interface BubbleResizeChromeDeps {
  bubble: TranslatedBubble;
  wrapper: HTMLElement;
  tlContainer: HTMLElement;
  chromeRoot: HTMLElement | null | undefined;
  image: HTMLImageElement | null;
  pageWidth: number;
  pageHeight: number;
  targetLocale: string;
  effectiveTarget: string;
  textStyle: OverlayTextStyle;
  textStyleRef?: { current?: OverlayTextStyle };
  onBubblesMutated?: () => void;
  isStaleOverlay: () => boolean;
  adjustmentScaleX: number;
  renderBubble: (availableHeight?: number, snapshotScale?: number, widthLayoutPreview?: WidthLayoutPreview) => void;
  saveAdjustment: () => void;
  updateBubbleFrame: () => void;
  openLiveEditor: () => void;
  deleteBubbleWithUndo: () => void;
  adjustBubbleFontSize: (delta: number) => void;
  getActiveEditorPosition: () => (() => void) | null;
  visibleSelection: () => SelectionRect;
  chrome: SelectionChromeHandle;
  state: BubbleRenderSharedState;
}

export const wireBubbleResizeChrome = (deps: BubbleResizeChromeDeps): {
  toggleBubbleItalic: () => void;
  applyBubbleRotationAndSlant: (nextRot: number, nextItalic: boolean, label?: string) => void;
} => {
  const {
    bubble: b,
    wrapper,
    tlContainer,
    chromeRoot,
    image: img,
    pageWidth: iw,
    pageHeight: ih,
    targetLocale: wordWrapLocale,
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
    getActiveEditorPosition,
    visibleSelection,
    chrome,
    state,
  } = deps;
  const { chromeControlsByWrapper, cancelDragPreviews } = chrome;

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
      const point = rotateLocalPoint(state.textSelection.x, state.textSelection.y + state.textSelection.height,
        state.currentBw, state.currentBh, state.currentRotation);
      state.currentBx = scaleAnchor.x - point.x;
      state.currentBy = scaleAnchor.y - point.y;
      if (state.currentRotation === 0 && state.currentBw <= iw && state.currentBh <= ih) {
        if (state.currentBx < 0) state.currentBx = 0;
        if (state.currentBy < 0) state.currentBy = 0;
        if (state.currentBx + state.currentBw > iw) state.currentBx = Math.max(0, iw - state.currentBw);
        if (state.currentBy + state.currentBh > ih) state.currentBy = Math.max(0, ih - state.currentBh);
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
      rInitBx = state.currentBx; rInitBy = state.currentBy;
      rDragInitBx = state.currentBx;
      rDragInitBy = state.currentBy;
      rInitBw = state.currentBw; rInitBh = state.currentBh;
      rDragInitBw = state.currentBw;
      rInitRot = state.currentRotation;
      rInitSnapshot = b.layoutSnapshot;
      rInitSizing = b.sourceSizing;
      rInitUserSpace = b.userTextSpace;
      // Corner drags freeze the rendered layout once, here: the drawn
      // canvas, lines, font and selection are reused for every preview
      // frame and rescaled proportionally on release.
      scaleDragSnapshot = id === 'scale' && b.layoutSnapshot
        ? { layout: b.layoutSnapshot, selection: { ...state.textSelection } }
        : null;
      const anchor = rotateLocalPoint(state.textSelection.x, state.textSelection.y + state.textSelection.height,
        state.currentBw, state.currentBh, state.currentRotation);
      scaleAnchor = { x: state.currentBx + anchor.x, y: state.currentBy + anchor.y };
      rInitFontMult = typeof b.fontSizeMultiplier === "number" ? b.fontSizeMultiplier : 1;
      rInitRenderedFontSize = (b.t || b.translated || '').trim() ? state.renderedFontSize : 0;
      rInitTargetFs = typeof b.targetFontSize === "number" && Number.isFinite(b.targetFontSize) && b.targetFontSize > 0
        ? b.targetFontSize
        : (typeof state.adj?.targetFontSize === "number" && Number.isFinite(state.adj.targetFontSize) && state.adj.targetFontSize > 0
          ? (adjSx !== 1 ? Math.max(8, Math.round(state.adj.targetFontSize * adjSx)) : state.adj.targetFontSize)
          : undefined);
      rDragTargetFs = rInitTargetFs;
      rInitManualMinHeightPx = state.manualMinHeightPx;
      state.resizeDragActive = id === 'width' || id === 'scale';
      state.widthSelectionPreview = id === 'width';

      if (id === 'scale' && rInitRenderedFontSize > 0) {
        const currentStyle = textStyleRef?.current || ts;
        rDragTargetFs = rInitRenderedFontSize / ((currentStyle.fontSizeMultiplier || 1) * rInitFontMult);
      }

      if (id === 'width') {
        const isAutoFrame = Boolean(
          (state.adj?.isAutoOptimized || b.layoutAdjustment?.isAutoOptimized) &&
          !b.userTextSpace &&
          typeof state.manualMinHeightPx !== "number",
        );
        if (isAutoFrame && state.textSelection.width > 0 && state.textSelection.width < state.currentBw * 0.85) {
          const snugW = Math.max(30, Math.min(state.currentBw, Math.ceil(state.textSelection.width / 0.88)));
          const snugX = Math.max(
            0,
            Math.min(iw - snugW, Math.round(state.currentBx + state.textSelection.x - (snugW - state.textSelection.width) / 2)),
          );
          rDragInitBx = snugX;
          rDragInitBw = snugW;
          state.currentBx = snugX;
          state.currentBw = snugW;
        }
        if (state.currentBy < 0 || state.currentBy + state.currentBh > ih) {
          rDragInitBy = Math.max(0, Math.min(Math.max(0, ih - Math.min(state.currentBh, ih)), state.currentBy));
        }
        if (state.manualMinHeightPx === undefined) {
          state.manualMinHeightPx = state.adj
            ? (typeof state.adj.manualMinHeightPx === "number" && Number.isFinite(state.adj.manualMinHeightPx)
              ? Math.max(0, state.adj.manualMinHeightPx)
              : (state.adj.isAutoOptimized ? 25 : state.adj.bh))
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
              state.currentBw,
              state.currentBh,
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
      const previousScale = { bx: state.currentBx, by: state.currentBy, bw: state.currentBw, bh: state.currentBh,
        font: b.fontSizeMultiplier, target: b.targetFontSize, minimum: state.manualMinHeightPx };
      let widthLayoutPreview: WidthLayoutPreview | undefined;
      const rect = tlContainer.getBoundingClientRect();
      const dx = (clientX - rStartX) * (iw / rect.width);
      const dy = (clientY - rStartY) * (ih / rect.height);

      if (id === 'rotate') {
        const curAngle = Math.atan2(clientY - rCenterY, clientX - rCenterX) * (180 / Math.PI);
        const angleDiff = curAngle - rStartAngle;
        const rawRotation = (rInitRot + angleDiff + 360) % 360;
        state.currentRotation = snapRotationToRightAngle(rawRotation);
      } else if (id === 'width') {
        // Drag right (dx > 0) widens, drag left (dx < 0) narrows
        const widthGeometry = widthGeometryForDrag(dx);
        state.currentBw = widthGeometry.width;
        state.currentBx = widthGeometry.left;
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
            state.currentBw,
            effectiveFs,
            currentFontFam,
            isOvalBox,
            state.manualMinHeightPx ?? 25,
            Math.max(0, ih - rDragInitBy),
            wordWrapLocale,
          );
          widthLayoutPreview = {
            layout,
            text,
            widthPx: state.currentBw,
            fontSizePx: effectiveFs,
            fontFamily: currentFontFam,
            isOval: isOvalBox,
            manualMinHeightPx: state.manualMinHeightPx ?? 25,
            availableHeightPx: Math.max(0, ih - rDragInitBy),
            locale: wordWrapLocale,
          };
          state.currentBh = layout.heightPx;
          state.currentBy = rDragInitBy;
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
        state.currentBw = rInitBw * scale;
        const newBh = rInitBh * scale;
        state.currentBy = rInitBy + (rInitBh - newBh);
        state.currentBh = newBh;
        b.fontSizeMultiplier = rInitFontMult * scale;
        if (Math.abs(scale-1) > .000001 && typeof rDragTargetFs === 'number') {
          b.targetFontSize = rDragTargetFs;
        }
        state.manualMinHeightPx = state.currentBh;
      } else if (id === 'move') {
        state.currentBx = rInitBx + dx;
        state.currentBy = rInitBy + dy;
      }
      if (id === "move" || id === "rotate") {
        updateBubbleFrame();
      } else if (id === "scale" && scaleDragSnapshot) {
        // Bitmap corner preview: scale the captured selection and rescale
        // the same canvas bitmap via proportional CSS sizing — zero
        // retypesetting, canvas resets or re-measuring during the drag.
        const previewScale = rInitBw > 0 ? state.currentBw / rInitBw : 1;
        const scaleSelection = (k: number): SelectionRect => {
          const captured = scaleDragSnapshot!.selection;
          return { x: captured.x * k, y: captured.y * k,
            width: captured.width * k, height: captured.height * k };
        };
        state.textSelection = scaleSelection(previewScale);
        // Resolve the anchor before page constraints. Keep the last valid
        // scale when growth would cross an edge, rather than clipping its
        // height differently on redo, reopening, or export.
        pinScaleAnchor();
        if (state.currentBx < 0 || state.currentBy < 0 || state.currentBx + state.currentBw > iw || state.currentBy + state.currentBh > ih) {
          state.currentBx = previousScale.bx; state.currentBy = previousScale.by;
          state.currentBw = previousScale.bw; state.currentBh = previousScale.bh;
          b.fontSizeMultiplier = previousScale.font; b.targetFontSize = previousScale.target;
          state.manualMinHeightPx = previousScale.minimum;
          state.textSelection = scaleSelection(rInitBw > 0 ? state.currentBw / rInitBw : 1);
        }
        updateBubbleFrame();
      } else {
        renderBubble(id === "scale" ? ih : undefined, 1, id === "width" ? widthLayoutPreview : undefined);
        if (id === "scale") {
          pinScaleAnchor();
          if (state.currentBx < 0 || state.currentBy < 0 || state.currentBx + state.currentBw > iw || state.currentBy + state.currentBh > ih) {
            state.currentBx = previousScale.bx; state.currentBy = previousScale.by;
            state.currentBw = previousScale.bw; state.currentBh = previousScale.bh;
            b.fontSizeMultiplier = previousScale.font; b.targetFontSize = previousScale.target;
            state.manualMinHeightPx = previousScale.minimum;
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
        && Math.abs(state.currentBx - rInitBx) < .001 && Math.abs(state.currentBy - rInitBy) < .001
        && Math.abs(state.currentBw - rInitBw) < .001 && Math.abs(state.currentBh - rInitBh) < .001
        && (b.fontSizeMultiplier ?? 1) === rInitFontMult && b.targetFontSize === rInitTargetFs;
      if ((id === "width" && !widthDragDidMove) || unchangedScale) {
        state.resizeDragActive = false;
        state.widthSelectionPreview = false;
        state.currentBx = rInitBx;
        state.currentBy = rInitBy;
        state.currentBw = rInitBw;
        state.currentBh = rInitBh;
        state.currentRotation = rInitRot;
        b.targetFontSize = rInitTargetFs;
        state.manualMinHeightPx = rInitManualMinHeightPx;
        if (scaleDragSnapshot) state.textSelection = { ...scaleDragSnapshot.selection };
        scaleDragSnapshot = null;
        state.floorBase = { w: rInitBw, h: rInitBh };
        updateBubbleFrame();
        return;
      }
      const wasResizing = state.resizeDragActive;
      state.resizeDragActive = false;
      state.widthSelectionPreview = false;
      if (id === "scale") state.manualMinHeightPx = state.currentBh;
      // Re-apply the frame floor once, now that the drag has ended. A
      // corner drag redraws crisply in a single pass: the captured layout
      // is rescaled by the committed drag scale (same lines, float font).
      if (wasResizing || id === "move") {
        if (id === "scale" && scaleDragSnapshot && rInitBw > 0) {
          renderBubble(undefined, state.currentBw / rInitBw);
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
      if (id === 'scale' || id === 'width') b.userTextSpace = {owner:'manual',rect:{x:state.currentBx,y:state.currentBy,width:state.currentBw,height:state.currentBh},imageWidth:iw,imageHeight:ih};
      const finalUserSpace = b.userTextSpace;
      const finalSizing = b.sourceSizing;
      const finalBx = state.currentBx, finalBy = state.currentBy, finalBw = state.currentBw, finalBh = state.currentBh, finalRot = state.currentRotation;
      const finalFontMult = typeof b.fontSizeMultiplier === "number" ? b.fontSizeMultiplier : 1.0;
      const finalTargetFs = b.targetFontSize;
      const finalManualMinHeight = state.manualMinHeightPx;
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
            state.currentBx = rInitBx;
            state.currentBy = rInitBy;
            state.currentBw = rInitBw;
            state.currentBh = rInitBh;
            state.currentRotation = rInitRot;
            b.fontSizeMultiplier = rInitFontMult;
            b.sourceSizing = rInitSizing;
            b.userTextSpace = rInitUserSpace;
            b.targetFontSize = rInitTargetFs;
            state.manualMinHeightPx = rInitManualMinHeightPx;
            b.layoutSnapshot = rInitSnapshot;
            state.floorBase = { w: rInitBw, h: rInitBh };
            renderBubble();
            saveAdjustment();
          },
          redo: () => {
            state.currentBx = finalBx;
            state.currentBy = finalBy;
            state.currentBw = finalBw;
            state.currentBh = finalBh;
            state.currentRotation = finalRot;
            b.fontSizeMultiplier = finalFontMult;
            b.sourceSizing = finalSizing;
            b.userTextSpace = finalUserSpace;
            b.targetFontSize = finalTargetFs;
            state.manualMinHeightPx = finalManualMinHeight;
            b.layoutSnapshot = finalSnapshot;
            state.floorBase = { w: finalBw, h: finalBh };
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
      state.resizeDragActive = false;
      state.widthSelectionPreview = false;
      state.currentBx = rInitBx;
      state.currentBy = rInitBy;
      state.currentBw = rInitBw;
      state.currentBh = rInitBh;
      state.currentRotation = rInitRot;
      b.fontSizeMultiplier = rInitFontMult;
      b.targetFontSize = rInitTargetFs;
      state.manualMinHeightPx = rInitManualMinHeightPx;
      b.layoutSnapshot = rInitSnapshot;
      if (scaleDragSnapshot) state.textSelection = { ...scaleDragSnapshot.selection };
      scaleDragSnapshot = null;
      state.floorBase = { w: rInitBw, h: rInitBh };
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
    const active = Boolean(b.isItalic ?? b.italic ?? state.currentIsItalic);
    btnEl.setAttribute("aria-pressed", String(active));
    btnEl.style.color = active ? "var(--primary, #f43f5e)" : "#e4e4e7";
    btnEl.style.background = active ? "rgba(244, 63, 94, 0.22)" : "transparent";
  };

  const toggleBubbleItalic = () => {
    const prevItalic = Boolean(b.isItalic ?? b.italic ?? state.currentIsItalic);
    const nextItalic = !prevItalic;
    const prevSnapshot = b.layoutSnapshot;
    state.currentIsItalic = nextItalic;
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
        state.currentIsItalic = prevItalic;
        b.isItalic = prevItalic;
        b.italic = prevItalic;
        b.layoutSnapshot = prevSnapshot;
        syncItalicBtnStyle(italicBtn);
        renderBubble();
        saveAdjustment();
      },
      redo: () => {
        state.currentIsItalic = nextItalic;
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
    const prevRot = state.currentRotation;
    const prevItalic = Boolean(b.isItalic ?? b.italic ?? state.currentIsItalic);
    const prevSnapshot = b.layoutSnapshot;
    state.currentRotation = nextRot;
    state.currentIsItalic = nextItalic;
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
        state.currentRotation = prevRot;
        state.currentIsItalic = prevItalic;
        b.rotation = prevRot;
        b.isItalic = prevItalic;
        b.italic = prevItalic;
        b.layoutSnapshot = prevSnapshot;
        syncItalicBtnStyle(italicBtn);
        renderBubble();
        saveAdjustment();
      },
      redo: () => {
        state.currentRotation = nextRot;
        state.currentIsItalic = nextItalic;
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
      const normRot = ((state.currentRotation + 540) % 360) - 180;
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
      const isCompact = state.currentBw < 85 || state.currentBh < 85;
      const padPercentX = isCompact ? Math.max(6, Math.round((85 - state.currentBw) / 2)) : 0;
      const padPercentY = isCompact ? Math.max(6, Math.round((85 - state.currentBh) / 2)) : 0;
      chromeHandles.forEach((handle) => {
        const pos = handle.dataset.handlePosition ?? "nw";
        const [left, top] = localPoints[pos];
        handle.style.left = `${left / state.currentBw * 100}%`;
        handle.style.top = `${top / state.currentBh * 100}%`;
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
      toolbar.style.left = `${(selection.x + selection.width / 2) / state.currentBw * 100}%`;
      toolbar.style.top = `calc(${selection.y / state.currentBh * 100}% - ${isCompact ? 16 : 10}px)`;
      toolbar.style.transform = "translate(-50%, -100%)";
      getActiveEditorPosition()?.();
      return;
    }

    const rootRect = chromeRoot.getBoundingClientRect();
    const stageRect = tlContainer.getBoundingClientRect();
    // The normal path derives rotated page bounds from the stage rect
    // alone; the per-bubble wrapper rect is read lazily only when the
    // stage has no measurable dimensions yet.
    const stageReady = stageRect.width > 0 && stageRect.height > 0;
    const bubbleRect = stageReady ? null : wrapper.getBoundingClientRect();
    const scaleX = stageRect.width > 0 ? stageRect.width / iw : (bubbleRect ? bubbleRect.width : 0) / state.currentBw;
    const scaleY = stageRect.height > 0 ? stageRect.height / ih : (bubbleRect ? bubbleRect.height : 0) / state.currentBh;
    const originX = stageRect.width > 0 ? stageRect.left + state.currentBx * scaleX : (bubbleRect ? bubbleRect.left : 0);
    const originY = stageRect.height > 0 ? stageRect.top + state.currentBy * scaleY : (bubbleRect ? bubbleRect.top : 0);
    const pointInChrome = (x: number, y: number) => {
      const point = rotateLocalPoint(x, y, state.currentBw, state.currentBh, state.currentRotation);
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
    getActiveEditorPosition()?.();
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

  return { toggleBubbleItalic, applyBubbleRotationAndSlant };
};
