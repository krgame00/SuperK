"use client";

import { useState, useCallback } from "react";
import type { PixelRect } from "@/lib/cleaning/types";
import type { CleanerRecoveryViewState } from "@/components/workspace/TranslationDiagnosticModal";
import { recoverDesktopCleaner } from "@/lib/desktopBridge";

export function useWorkspaceModalsState() {
  // Settings Modal State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsFocusTarget, setSettingsFocusTarget] = useState<"apiKey" | null>(null);
  const [apiKeyRecoveryGroupId, setApiKeyRecoveryGroupId] = useState<string | null>(null);
  const [apiKeyReadyByGroup, setApiKeyReadyByGroup] = useState<Record<string, boolean>>({});

  // Mask Editor State
  const [isMaskEditorOpen, setIsMaskEditorOpen] = useState(false);
  const [maskFocusRect, setMaskFocusRect] = useState<PixelRect | undefined>(undefined);

  // Find & Replace and Shortcuts Dialogs State
  const [isFindReplaceOpen, setIsFindReplaceOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);

  // Diagnostic Modal and Desktop Cleaner Recovery State
  const [isDiagnosticModalOpen, setIsDiagnosticModalOpen] = useState(false);
  const [cleanerRecoveryByGroup, setCleanerRecoveryByGroup] = useState<
    Record<string, CleanerRecoveryViewState>
  >({});

  const openSettings = useCallback((focusTarget?: "apiKey" | null) => {
    if (focusTarget !== undefined) {
      setSettingsFocusTarget(focusTarget);
    }
    setIsSettingsOpen(true);
  }, []);

  const closeSettings = useCallback(() => {
    setIsSettingsOpen(false);
    setSettingsFocusTarget(null);
  }, []);

  const openMaskEditor = useCallback((focusRect?: PixelRect) => {
    if (focusRect) {
      setMaskFocusRect(focusRect);
    }
    setIsMaskEditorOpen(true);
  }, []);

  const closeMaskEditor = useCallback(() => {
    setIsMaskEditorOpen(false);
    setMaskFocusRect(undefined);
  }, []);

  const openMaskCandidate = useCallback((candidate: { id?: string; rect: PixelRect; [key: string]: unknown }) => {
    setMaskFocusRect(candidate.rect);
    setIsMaskEditorOpen(true);
  }, []);

  const openFindReplace = useCallback(() => {
    setIsFindReplaceOpen(true);
  }, []);

  const closeFindReplace = useCallback(() => {
    setIsFindReplaceOpen(false);
  }, []);

  const openShortcuts = useCallback(() => {
    setIsShortcutsOpen(true);
  }, []);

  const closeShortcuts = useCallback(() => {
    setIsShortcutsOpen(false);
  }, []);

  const openDiagnostics = useCallback(() => {
    setIsDiagnosticModalOpen(true);
  }, []);

  const closeDiagnostics = useCallback(() => {
    setIsDiagnosticModalOpen(false);
  }, []);

  const openSettingsApiKey = useCallback((failureGroupId: string) => {
    setIsDiagnosticModalOpen(false);
    setApiKeyRecoveryGroupId(failureGroupId);
    setSettingsFocusTarget("apiKey");
    setIsSettingsOpen(true);
  }, []);

  const handleApiKeyValidated = useCallback(() => {
    if (apiKeyRecoveryGroupId) {
      setApiKeyReadyByGroup((previous) => ({
        ...previous,
        [apiKeyRecoveryGroupId]: true,
      }));
    }
    setSettingsFocusTarget(null);
  }, [apiKeyRecoveryGroupId]);

  const handleRecoverCleaner = useCallback(async (failureGroupId: string) => {
    setCleanerRecoveryByGroup((previous) => ({
      ...previous,
      [failureGroupId]: { status: "checking" },
    }));

    const result = await recoverDesktopCleaner((status, message) => {
      setCleanerRecoveryByGroup((previous) => ({
        ...previous,
        [failureGroupId]: { status, message },
      }));
    });

    setCleanerRecoveryByGroup((previous) => ({
      ...previous,
      [failureGroupId]: {
        status: result.status,
        message: result.message,
      },
    }));
  }, []);

  const validateRecoveryApiKey = useCallback(async (apiKey: string) => {
    try {
      const response = await fetch("/api/translate/validate-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        valid?: boolean;
        message?: string;
      };
      return {
        ok: response.ok && data.valid === true,
        message: data.message || (response.ok ? undefined : "ตรวจสอบ API Key ไม่สำเร็จ"),
      };
    } catch {
      return {
        ok: false,
        message: "เชื่อมต่อเซิร์ฟเวอร์เพื่อตรวจสอบ API Key ไม่สำเร็จ",
      };
    }
  }, []);

  return {
    // Settings modal
    isSettingsOpen,
    setIsSettingsOpen,
    openSettings,
    closeSettings,
    settingsFocusTarget,
    setSettingsFocusTarget,
    apiKeyRecoveryGroupId,
    setApiKeyRecoveryGroupId,
    apiKeyReadyByGroup,
    setApiKeyReadyByGroup,
    openSettingsApiKey,
    handleApiKeyValidated,

    // Mask editor
    isMaskEditorOpen,
    setIsMaskEditorOpen,
    openMaskEditor,
    closeMaskEditor,
    openMaskCandidate,
    maskFocusRect,
    setMaskFocusRect,

    // Dialogs
    isFindReplaceOpen,
    setIsFindReplaceOpen,
    openFindReplace,
    closeFindReplace,
    isShortcutsOpen,
    setIsShortcutsOpen,
    openShortcuts,
    closeShortcuts,

    // Diagnostics & Cleaner recovery
    isDiagnosticModalOpen,
    setIsDiagnosticModalOpen,
    openDiagnostics,
    closeDiagnostics,
    cleanerRecoveryByGroup,
    setCleanerRecoveryByGroup,
    handleRecoverCleaner,
    validateRecoveryApiKey,
  };
}
