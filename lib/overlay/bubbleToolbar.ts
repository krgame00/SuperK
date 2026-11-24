// Floating quick-action toolbar for a selected bubble: the edit / font
// size / italic / tilt / warp / B-W contrast / delete buttons plus the
// chrome positioning logic that keeps toolbar and handles anchored to the
// (possibly rotated, possibly compact) bubble.

import { undoManager } from "../undoManager";
import { sampleBubbleRegion } from "../colorMatching/canvasSampler";
import { applyBwContrastModeToBubble, cloneTextStyleProfile } from "../colorMatching/resolveTextStyle";
import type { BwContrastMode } from "../colorMatching/types";
import { getWarpLabel, getNextWarpType, type WarpConfig } from "../tools/TextWarpRenderer";
import { estimateSourceTextTiltAngle } from "./sourceGeometry";
import { rotateLocalPoint, type SelectionRect } from "../textSelectionBounds";
import type { BubbleStyleActions } from "./bubbleStyleActions";
import type { BubbleChromeControls } from "./interactionTypes";
import type { BubbleRenderSharedState } from "./bubbleRenderer";
import type { TranslatedBubble } from "./overlayTypes";

export interface BubbleToolbarDeps {
  bubble: TranslatedBubble;
  wrapper: HTMLElement;
  tlContainer: HTMLElement;
  chromeRoot: HTMLElement | null | undefined;
  image: HTMLImageElement | null;
  pageWidth: number;
  pageHeight: number;
  onBubblesMutated?: () => void;
  renderBubble: () => void;
  saveAdjustment: () => void;
  styleActions: BubbleStyleActions;
  openLiveEditor: () => void;
  deleteBubbleWithUndo: () => void;
  adjustBubbleFontSize: (delta: number) => void;
  getActiveEditorPosition: () => (() => void) | null;
  visibleSelection: () => SelectionRect;
  chromeControlsByWrapper: WeakMap<HTMLElement, BubbleChromeControls>;
  chromeHandles: HTMLElement[];
  state: BubbleRenderSharedState;
}

export const wireBubbleToolbar = (deps: BubbleToolbarDeps): void => {
  const {
    bubble: b,
    wrapper,
    tlContainer,
    chromeRoot,
    image: img,
    pageWidth: iw,
    pageHeight: ih,
    onBubblesMutated,
    renderBubble,
    saveAdjustment,
    styleActions,
    openLiveEditor,
    deleteBubbleWithUndo,
    adjustBubbleFontSize,
    getActiveEditorPosition,
    visibleSelection,
    chromeControlsByWrapper,
    chromeHandles,
    state,
  } = deps;

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

  const italicBtn = createToolBtn(
    "สลับตัวอักษรเอียง (Italic หรือคีย์ I)",
    `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/></svg>`,
    () => styleActions.toggleBubbleItalic(),
  );
  styleActions.registerItalicButton(italicBtn);

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
        styleActions.applyBubbleRotationAndSlant(targetAngle, true, "เอียงข้อความตามต้นฉบับ");
      } else if (normRot < 0) {
        styleActions.applyBubbleRotationAndSlant(12, true, "สลับมุมเอียงข้อความ (+12°)");
      } else {
        styleActions.applyBubbleRotationAndSlant(0, false, "รีเซ็ตมุมเอียงข้อความ (0°)");
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
    toolbar.style.display = visible ? "flex" : "none";
    toolbar.style.opacity = visible ? "1" : "0";
    toolbar.style.pointerEvents = visible ? "auto" : "none";
    chromeHandles.forEach((handle) => {
      handle.style.display = visible ? "block" : "none";
      handle.style.opacity = visible ? "1" : "0";
      handle.style.pointerEvents = visible ? "auto" : "none";
    });
  };

  const cleanupChrome = () => {
    toolbar.remove();
    chromeHandles.forEach((handle) => handle.remove());
  };

  if (typeof MutationObserver !== "undefined") {
    const parent = wrapper.parentElement ?? tlContainer;
    const unmountObserver = new MutationObserver(() => {
      if (!wrapper.isConnected) {
        cleanupChrome();
        unmountObserver.disconnect();
      }
    });
    unmountObserver.observe(parent, { childList: true });
  }

  chromeControlsByWrapper.set(wrapper, {
    toolbar,
    handles: chromeHandles,
    position: positionChromeControls,
    setVisible: setChromeVisible,
  });
};
