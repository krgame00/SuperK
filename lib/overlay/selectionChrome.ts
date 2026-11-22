// Selection state and document-lifecycle wiring for the overlay. This unit
// owns the selection facade (WeakMaps, highlight, chrome sync) and
// registers its detach function in the overlay lifecycle registry.

import { overlayCleanups } from './overlayLifecycle';
import type {
  BubbleChromeControls,
  SelectedBubbleBridge,
  SelectionChromeDeps,
  SelectionChromeHandle,
} from './interactionTypes';

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
