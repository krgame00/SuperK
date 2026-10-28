"use client";

import { useEffect, useState, useRef } from "react";
import { undoManager } from "@/lib/undoManager";

// Global shortcuts must not fire while the event originates from a form field,
// a content-editable surface, or inside any modal dialog.
export function isShortcutTargetBlocked(target: HTMLElement | null): boolean {
  if (!target) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    Boolean(target.isContentEditable) ||
    target.contentEditable === "true" ||
    target.getAttribute?.("contenteditable") === "true" ||
    target.getAttribute?.("contenteditable") === "" ||
    (typeof target.closest === "function" &&
      Boolean(target.closest('[role="dialog"]')))
  );
}

export interface UseWorkspaceShortcutsOptions {
  // Navigation
  pagesCount: number;
  onNavigatePage: (updater: (prev: number) => number) => void;

  // Layer toggle
  onToggleLayer: () => void;

  // Translation
  onTranslateCurrent: () => void | Promise<boolean>;
  canTranslate: boolean;

  // Dialog openers
  onOpenFindReplace: () => void;
  onOpenShortcuts: () => void;

  // Focus mode
  isFocusMode: boolean;
  onToggleFocusMode: () => void;
  onExitFocusMode: () => void;
  onToggleFocusToolbar: () => void;
}

export function useWorkspaceShortcuts({
  pagesCount,
  onNavigatePage,
  onToggleLayer,
  onTranslateCurrent,
  canTranslate,
  onOpenFindReplace,
  onOpenShortcuts,
  isFocusMode,
  onToggleFocusMode,
  onExitFocusMode,
  onToggleFocusToolbar,
}: UseWorkspaceShortcutsOptions): {
  canUndo: boolean;
  canRedo: boolean;
} {
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Keep references to dynamic options to avoid re-binding window listener unnecessarily
  const optionsRef = useRef({
    pagesCount,
    onNavigatePage,
    onToggleLayer,
    onTranslateCurrent,
    canTranslate,
    onOpenFindReplace,
    onOpenShortcuts,
    isFocusMode,
    onToggleFocusMode,
    onExitFocusMode,
    onToggleFocusToolbar,
  });

  useEffect(() => {
    optionsRef.current = {
      pagesCount,
      onNavigatePage,
      onToggleLayer,
      onTranslateCurrent,
      canTranslate,
      onOpenFindReplace,
      onOpenShortcuts,
      isFocusMode,
      onToggleFocusMode,
      onExitFocusMode,
      onToggleFocusToolbar,
    };
  });

  useEffect(() => {
    const syncState = () => {
      setCanUndo(undoManager.canUndo());
      setCanRedo(undoManager.canRedo());
    };
    const unsub = undoManager.onChange(syncState);
    syncState();

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const opts = optionsRef.current;

      // Find & Replace: Ctrl+F / Cmd+F (global from canvas, inputs, and review panels)
      const isF = e.code === "KeyF" || e.key.toLowerCase() === "f";
      if ((e.ctrlKey || e.metaKey) && isF && !e.altKey) {
        if (
          target &&
          typeof target.closest === "function" &&
          target.closest('[aria-label="ค้นหาและแทนที่คำแปล"]')
        ) {
          e.preventDefault();
          const findInput = document.getElementById("find-input") as HTMLInputElement | null;
          if (findInput) {
            findInput.focus();
            findInput.select();
          }
          return;
        }
        e.preventDefault();
        opts.onOpenFindReplace();
        return;
      }

      if (isShortcutTargetBlocked(target)) {
        return;
      }

      const isB = e.code === "KeyB" || e.key.toLowerCase() === "b";
      const isT = e.code === "KeyT" || e.key.toLowerCase() === "t";
      const isZ = e.code === "KeyZ" || e.key.toLowerCase() === "z";
      const isY = e.code === "KeyY" || e.key.toLowerCase() === "y";

      // Focus Mode shortcuts (F, B, Escape)
      if (isF) {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          opts.onToggleFocusMode();
          return;
        }
      }

      if (isB) {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          opts.onToggleFocusToolbar();
          return;
        }
      }

      if (e.key === "Escape") {
        if (opts.isFocusMode) {
          e.preventDefault();
          opts.onExitFocusMode();
          return;
        }
      }

      // Undo: Ctrl+Z
      if ((e.ctrlKey || e.metaKey) && isZ && !e.shiftKey) {
        e.preventDefault();
        const label = undoManager.undo();
        if (label) {
          import("react-hot-toast").then((m) =>
            m.default(`↩️ Undo: ${label}`, { duration: 1500 })
          );
        }
        return;
      }

      // Redo: Ctrl+Shift+Z / Ctrl+Y
      if (
        (e.ctrlKey || e.metaKey) &&
        (isY || (isZ && e.shiftKey))
      ) {
        e.preventDefault();
        const label = undoManager.redo();
        if (label) {
          import("react-hot-toast").then((m) =>
            m.default(`↪️ Redo: ${label}`, { duration: 1500 })
          );
        }
        return;
      }

      // Shortcuts Help: ?
      if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        opts.onOpenShortcuts();
        return;
      }

      // Don't trigger standard shortcuts when modifier keys are held
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // ← Previous page
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        opts.onNavigatePage((p) => Math.max(0, p - 1));
        return;
      }

      // → Next page
      if (e.key === "ArrowRight") {
        e.preventDefault();
        opts.onNavigatePage((p) => Math.min(Math.max(0, opts.pagesCount - 1), p + 1));
        return;
      }

      // T = Translate current page
      if (isT) {
        if (opts.canTranslate) {
          void opts.onTranslateCurrent();
        }
        return;
      }

      // Space = Toggle Original/Translated (let focused buttons/links activate)
      if (e.key === " ") {
        if (
          target &&
          typeof target.closest === "function" &&
          target.closest('button, a, [role="button"]')
        ) {
          return;
        }
        e.preventDefault();
        opts.onToggleLayer();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      unsub();
    };
  }, []);

  return { canUndo, canRedo };
}
