// Selection, chrome-control and document-lifecycle machinery for the
// overlay. Unit implementations live in their own modules; this file is
// the composition surface that re-exports them for the orchestrator.

import type { TranslatedBubble, OverlayTextStyle } from "./overlayTypes";
import type { BubbleStyleActions } from "./bubbleStyleActions";
import type { SelectionRect } from "../textSelectionBounds";
import type { BubbleRenderSharedState, WidthLayoutPreview } from "./bubbleRenderer";
import type { SelectionChromeHandle } from "./interactionTypes";
import { wireBubbleResizeHandles } from "./bubbleResizeHandles";
import { wireBubbleToolbar } from "./bubbleToolbar";

export { pruneOverlayCleanups, overlayCleanups } from "./overlayLifecycle";
export type {
  BubbleChromeControls,
  SelectedBubbleBridge,
  SelectionChromeDeps,
  SelectionChromeHandle,
} from "./interactionTypes";
export { createSelectionChrome } from "./selectionChrome";

export { wireBubbleSelectionAndMove } from "./bubbleMove";
export type { BubbleSelectionMoveDeps } from "./bubbleMove";

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
  styleActions: BubbleStyleActions;
  getActiveEditorPosition: () => (() => void) | null;
  visibleSelection: () => SelectionRect;
  chrome: SelectionChromeHandle;
  state: BubbleRenderSharedState;
}
export const wireBubbleResizeChrome = (deps: BubbleResizeChromeDeps): {
  toggleBubbleItalic: () => void;
  applyBubbleRotationAndSlant: (nextRot: number, nextItalic: boolean, label?: string) => void;
} => {
  const { chromeHandles } = wireBubbleResizeHandles({
    ...deps,
    cancelDragPreviews: deps.chrome.cancelDragPreviews,
  });
  wireBubbleToolbar({
    ...deps,
    chromeHandles,
    chromeControlsByWrapper: deps.chrome.chromeControlsByWrapper,
  });
  return {
    toggleBubbleItalic: deps.styleActions.toggleBubbleItalic,
    applyBubbleRotationAndSlant: deps.styleActions.applyBubbleRotationAndSlant,
  };
};