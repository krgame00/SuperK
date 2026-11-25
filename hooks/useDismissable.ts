"use client";

import { useEffect, type RefObject } from "react";

/**
 * Shared dismiss hook for popovers, menus, and dialogs: closes on Escape
 * and (when containerRef is provided) on outside pointerdown/mousedown.
 */
export function useDismissable(
  isOpen: boolean,
  onClose: () => void,
  containerRef?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!isOpen || typeof document === "undefined") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef?.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    if (containerRef) {
      document.addEventListener("mousedown", handlePointerDown);
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (containerRef) {
        document.removeEventListener("mousedown", handlePointerDown);
      }
    };
  }, [isOpen, onClose, containerRef]);
}
