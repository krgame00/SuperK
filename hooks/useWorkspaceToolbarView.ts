"use client";

import { useState, useEffect, useCallback } from "react";
import { hydrateStoredCustomFonts } from "@/lib/customFonts";
import type { WorkspaceLayer } from "@/components/cleaning/CleaningToolbar";

export type ViewLayout = "single" | "scroll";
export type ToolbarPosition = "top" | "bottom";

export interface WorkspaceToolbarViewOptions {
  initialLayer?: WorkspaceLayer;
  initialLayout?: ViewLayout;
}

export function useWorkspaceToolbarView(options: WorkspaceToolbarViewOptions = {}) {
  const [workspaceLayer, setWorkspaceLayer] = useState<WorkspaceLayer>(
    options.initialLayer ?? "original"
  );
  const [viewLayout, setViewLayout] = useState<ViewLayout>(
    options.initialLayout ?? "single"
  );
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isThumbnailsCollapsed, setIsThumbnailsCollapsed] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [isFocusToolbarVisible, setIsFocusToolbarVisible] = useState(false);
  const [toolbarPosition, setToolbarPosition] = useState<ToolbarPosition>("top");
  const [isToolbarCollapsed, setIsToolbarCollapsed] = useState(false);

  // Restore toolbar preferences from localStorage and hydrate custom fonts from IndexedDB
  useEffect(() => {
    void hydrateStoredCustomFonts();
    try {
      const savedPos = localStorage.getItem("manga_clean_toolbar_position");
      if (savedPos === "top" || savedPos === "bottom") {
        setToolbarPosition(savedPos);
      }
      const savedCollapsed = localStorage.getItem("manga_clean_toolbar_collapsed");
      if (savedCollapsed !== null) {
        setIsToolbarCollapsed(savedCollapsed === "true");
      }
    } catch {
      // ignore localStorage errors (e.g. incognito/disabled)
    }
  }, []);

  const toggleToolbarPosition = useCallback(() => {
    setToolbarPosition((prev) => {
      const next: ToolbarPosition = prev === "top" ? "bottom" : "top";
      try {
        localStorage.setItem("manga_clean_toolbar_position", next);
      } catch {}
      return next;
    });
  }, []);

  const toggleToolbarCollapsed = useCallback(() => {
    setIsToolbarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("manga_clean_toolbar_collapsed", String(next));
      } catch {}
      return next;
    });
  }, []);

  // Reset focus toolbar visibility whenever entering focus mode
  useEffect(() => {
    if (isFocusMode) {
      setIsFocusToolbarVisible(false);
    }
  }, [isFocusMode]);

  const toggleFocusMode = useCallback(() => {
    setIsFocusMode((prev) => !prev);
  }, []);

  const exitFocusMode = useCallback(() => {
    setIsFocusMode(false);
  }, []);

  const toggleFocusToolbar = useCallback(() => {
    setIsFocusMode((focus) => {
      if (focus) {
        setIsFocusToolbarVisible((prev) => !prev);
      } else {
        toggleToolbarCollapsed();
      }
      return focus;
    });
  }, [toggleToolbarCollapsed]);

  const toggleViewLayout = useCallback(() => {
    setViewLayout((prev) => (prev === "single" ? "scroll" : "single"));
  }, []);

  const toggleMobileMenu = useCallback(() => {
    setIsMobileMenuOpen((prev) => !prev);
  }, []);

  const closeMobileMenu = useCallback(() => {
    setIsMobileMenuOpen(false);
  }, []);

  const toggleThumbnailsCollapse = useCallback(() => {
    setIsThumbnailsCollapsed((prev) => !prev);
  }, []);

  return {
    workspaceLayer,
    setWorkspaceLayer,
    viewLayout,
    setViewLayout,
    toggleViewLayout,
    isMobileMenuOpen,
    setIsMobileMenuOpen,
    toggleMobileMenu,
    closeMobileMenu,
    isThumbnailsCollapsed,
    setIsThumbnailsCollapsed,
    toggleThumbnailsCollapse,
    isFocusMode,
    setIsFocusMode,
    toggleFocusMode,
    exitFocusMode,
    isFocusToolbarVisible,
    setIsFocusToolbarVisible,
    toggleFocusToolbar,
    toolbarPosition,
    setToolbarPosition,
    toggleToolbarPosition,
    isToolbarCollapsed,
    setIsToolbarCollapsed,
    toggleToolbarCollapsed,
  };
}
