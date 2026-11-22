// Handle drag geometry for the overlay chrome: rotate / scale / width /
// move handles, their rAF width previews and the undo/redo records they
// push. Positioning of the chrome itself lives in the toolbar unit.

import { undoManager } from "../undoManager";
import { manualSourceSizing, type SourceSizing } from "../sourceTextSize";
import { resolveCanvasFontFamily } from "./canvasFont";
import { layoutBubbleAtFixedFont, measureBubbleRenderFit, minimumBubbleWidthAtFixedFont } from "./bubbleTextFit";
import { snapRotationToRightAngle } from "./sourceGeometry";
import { rotateLocalPoint, type SelectionRect } from "../textSelectionBounds";
import type { BubbleProportionalLayout, OverlayTextStyle, TranslatedBubble } from "./overlayTypes";
import type { BubbleRenderSharedState, WidthLayoutPreview } from "./bubbleRenderer";


export interface BubbleResizeHandlesDeps {
  bubble: TranslatedBubble;
  wrapper: HTMLElement;
  tlContainer: HTMLElement;
  chromeRoot: HTMLElement | null | undefined;
  pageWidth: number;
  pageHeight: number;
  targetLocale: string;
  textStyle: OverlayTextStyle;
  textStyleRef?: { current?: OverlayTextStyle };
  isStaleOverlay: () => boolean;
  adjustmentScaleX: number;
  renderBubble: (availableHeight?: number, snapshotScale?: number, widthLayoutPreview?: WidthLayoutPreview) => void;
  saveAdjustment: () => void;
  updateBubbleFrame: () => void;
  cancelDragPreviews: Array<() => void>;
  state: BubbleRenderSharedState;
}

export const wireBubbleResizeHandles = (deps: BubbleResizeHandlesDeps): {
  chromeHandles: HTMLElement[];
} => {
  const {
    bubble: b,
    wrapper,
    tlContainer,
    chromeRoot,
    pageWidth: iw,
    pageHeight: ih,
    targetLocale: wordWrapLocale,
    textStyle: ts,
    textStyleRef,
    isStaleOverlay,
    adjustmentScaleX: adjSx,
    renderBubble,
    saveAdjustment,
    updateBubbleFrame,
    cancelDragPreviews,
    state,
  } = deps;

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


  return { chromeHandles };
};
