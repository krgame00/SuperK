import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceModalsState } from "@/hooks/useWorkspaceModalsState";
import { recoverDesktopCleaner } from "@/lib/desktopBridge";

vi.mock("@/lib/desktopBridge", () => ({
  recoverDesktopCleaner: vi.fn(),
}));

describe("useWorkspaceModalsState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initializes with all modals closed and empty recovery states", () => {
    const { result } = renderHook(() => useWorkspaceModalsState());

    expect(result.current.isSettingsOpen).toBe(false);
    expect(result.current.settingsFocusTarget).toBeNull();
    expect(result.current.apiKeyRecoveryGroupId).toBeNull();
    expect(result.current.apiKeyReadyByGroup).toEqual({});
    expect(result.current.isMaskEditorOpen).toBe(false);
    expect(result.current.maskFocusRect).toBeUndefined();
    expect(result.current.isFindReplaceOpen).toBe(false);
    expect(result.current.isShortcutsOpen).toBe(false);
    expect(result.current.isDiagnosticModalOpen).toBe(false);
    expect(result.current.cleanerRecoveryByGroup).toEqual({});
  });

  it("handles mask editor open, candidate selection, and close", () => {
    const { result } = renderHook(() => useWorkspaceModalsState());

    act(() => {
      result.current.openMaskCandidate({
        id: "cand_1",
        rect: { x: 10, y: 20, width: 100, height: 50 },
        candidateType: "text",
        confidence: 0.9,
      });
    });

    expect(result.current.isMaskEditorOpen).toBe(true);
    expect(result.current.maskFocusRect).toEqual({ x: 10, y: 20, width: 100, height: 50 });

    act(() => {
      result.current.closeMaskEditor();
    });

    expect(result.current.isMaskEditorOpen).toBe(false);
    expect(result.current.maskFocusRect).toBeUndefined();
  });

  it("handles diagnostics to settings API key transition and key validation completion", () => {
    const { result } = renderHook(() => useWorkspaceModalsState());

    act(() => {
      result.current.openDiagnostics();
    });
    expect(result.current.isDiagnosticModalOpen).toBe(true);

    act(() => {
      result.current.openSettingsApiKey("group_quota_429");
    });

    expect(result.current.isDiagnosticModalOpen).toBe(false);
    expect(result.current.isSettingsOpen).toBe(true);
    expect(result.current.settingsFocusTarget).toBe("apiKey");
    expect(result.current.apiKeyRecoveryGroupId).toBe("group_quota_429");

    act(() => {
      result.current.handleApiKeyValidated();
    });

    expect(result.current.apiKeyReadyByGroup["group_quota_429"]).toBe(true);
    expect(result.current.settingsFocusTarget).toBeNull();
  });

  it("handles basic open/close toggles for find/replace and shortcuts dialogs", () => {
    const { result } = renderHook(() => useWorkspaceModalsState());

    act(() => {
      result.current.openFindReplace();
    });
    expect(result.current.isFindReplaceOpen).toBe(true);

    act(() => {
      result.current.closeFindReplace();
    });
    expect(result.current.isFindReplaceOpen).toBe(false);

    act(() => {
      result.current.openShortcuts();
    });
    expect(result.current.isShortcutsOpen).toBe(true);

    act(() => {
      result.current.closeShortcuts();
    });
    expect(result.current.isShortcutsOpen).toBe(false);
  });

  it("executes desktop cleaner recovery and updates recovery state", async () => {
    vi.mocked(recoverDesktopCleaner).mockImplementation(async (callback) => {
      callback?.("restarting", "กำลังเริ่มต้น Cleaner ใหม่...");
      return { status: "recovered", restarted: true, message: "Cleaner พร้อมทำงานแล้ว" };
    });

    const { result } = renderHook(() => useWorkspaceModalsState());

    await act(async () => {
      await result.current.handleRecoverCleaner("group_cleaner_err");
    });

    expect(recoverDesktopCleaner).toHaveBeenCalledTimes(1);
    expect(result.current.cleanerRecoveryByGroup["group_cleaner_err"]).toEqual({
      status: "recovered",
      message: "Cleaner พร้อมทำงานแล้ว",
    });
  });

  it("validates recovery API key with mock fetch", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ valid: true }),
    });

    try {
      const { result } = renderHook(() => useWorkspaceModalsState());
      let validationResult: { ok: boolean; message?: string } | undefined;

      await act(async () => {
        validationResult = await result.current.validateRecoveryApiKey("AIzaSyValidKeyMock");
      });

      expect(validationResult?.ok).toBe(true);
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/translate/validate-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "AIzaSyValidKeyMock" }),
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
