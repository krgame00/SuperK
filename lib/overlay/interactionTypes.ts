// Shared contracts for the overlay interaction units. Leaf module: types
// only, so every interaction unit can import these without forming cycles.

import type { TranslatedBubble } from "./overlayTypes";

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
