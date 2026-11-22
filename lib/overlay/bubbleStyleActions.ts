// Italic / rotation / slant actions for a bubble, shared by the keyboard
// handlers and the toolbar buttons. Created once per bubble by the
// orchestrator; the toolbar registers its italic button so the actions can
// restyle it without importing the toolbar module.

import type { TranslatedBubble } from "./overlayTypes";
import { undoManager } from "../undoManager";
import type { BubbleRenderSharedState } from "./bubbleRenderer";

export interface BubbleStyleActionsDeps {
  bubble: TranslatedBubble;
  state: BubbleRenderSharedState;
  onBubblesMutated?: () => void;
  renderBubble: () => void;
  saveAdjustment: () => void;
}

export interface BubbleStyleActions {
  toggleBubbleItalic: () => void;
  applyBubbleRotationAndSlant: (nextRot: number, nextItalic: boolean, label?: string) => void;
  /** Restyles the registered italic button; call once after creating it. */
  registerItalicButton: (btnEl: HTMLButtonElement) => void;
}

export const createBubbleStyleActions = (deps: BubbleStyleActionsDeps): BubbleStyleActions => {
  const { bubble: b, state, onBubblesMutated, renderBubble, saveAdjustment } = deps;

  let italicButtonEl: HTMLButtonElement | null = null;
  const syncItalicBtnStyle = (): void => {
    if (!italicButtonEl) return;
    const active = Boolean(b.isItalic ?? b.italic ?? state.currentIsItalic);
    italicButtonEl.setAttribute("aria-pressed", String(active));
    italicButtonEl.style.color = active ? "var(--primary, #f43f5e)" : "#e4e4e7";
    italicButtonEl.style.background = active ? "rgba(244, 63, 94, 0.22)" : "transparent";
  };

  const toggleBubbleItalic = () => {
    const prevItalic = Boolean(b.isItalic ?? b.italic ?? state.currentIsItalic);
    const nextItalic = !prevItalic;
    const prevSnapshot = b.layoutSnapshot;
    state.currentIsItalic = nextItalic;
    b.isItalic = nextItalic;
    b.italic = nextItalic;
    delete b.layoutSnapshot;
    syncItalicBtnStyle();
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
        syncItalicBtnStyle();
        renderBubble();
        saveAdjustment();
      },
      redo: () => {
        state.currentIsItalic = nextItalic;
        b.isItalic = nextItalic;
        b.italic = nextItalic;
        b.layoutSnapshot = nextSnapshot;
        syncItalicBtnStyle();
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
    syncItalicBtnStyle();
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
        syncItalicBtnStyle();
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
        syncItalicBtnStyle();
        renderBubble();
        saveAdjustment();
      },
    });
  };

  return {
    toggleBubbleItalic,
    applyBubbleRotationAndSlant,
    registerItalicButton: (btnEl: HTMLButtonElement) => {
      italicButtonEl = btnEl;
      syncItalicBtnStyle();
    },
  };
};
