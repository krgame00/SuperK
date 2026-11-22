// Overlay listener lifecycle registry. Document-level listeners register
// their detach function here per container; stale entries (containers
// removed by page switches) are pruned and cleaned up on the next apply.

const overlayCleanups = new Map<Element, () => void>();

export { overlayCleanups };

export const pruneOverlayCleanups = (): void => {
  for (const [element, cleanup] of overlayCleanups) {
    if (!element.isConnected) {
      cleanup();
      overlayCleanups.delete(element);
    }
  }
};
