import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useWorkspaceShortcuts,
  isShortcutTargetBlocked,
  type UseWorkspaceShortcutsOptions,
} from "@/hooks/useWorkspaceShortcuts";
import { undoManager } from "@/lib/undoManager";

describe("isShortcutTargetBlocked", () => {
  it("returns false for null or normal elements", () => {
    expect(isShortcutTargetBlocked(null)).toBe(false);
    const div = document.createElement("div");
    expect(isShortcutTargetBlocked(div)).toBe(false);
  });

  it("returns true for form inputs", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const select = document.createElement("select");
    expect(isShortcutTargetBlocked(input)).toBe(true);
    expect(isShortcutTargetBlocked(textarea)).toBe(true);
    expect(isShortcutTargetBlocked(select)).toBe(true);
  });

  it("returns true for contenteditable elements", () => {
    const div = document.createElement("div");
    div.contentEditable = "true";
    expect(isShortcutTargetBlocked(div)).toBe(true);
  });

  it("returns true for elements inside a dialog", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const button = document.createElement("button");
    dialog.appendChild(button);
    document.body.appendChild(dialog);

    expect(isShortcutTargetBlocked(button)).toBe(true);

    document.body.removeChild(dialog);
  });
});

describe("useWorkspaceShortcuts", () => {
  let defaultOptions: UseWorkspaceShortcutsOptions;

  beforeEach(() => {
    defaultOptions = {
      pagesCount: 5,
      onNavigatePage: vi.fn(),
      onToggleLayer: vi.fn(),
      onTranslateCurrent: vi.fn(),
      canTranslate: true,
      onOpenFindReplace: vi.fn(),
      onOpenShortcuts: vi.fn(),
      isFocusMode: false,
      onToggleFocusMode: vi.fn(),
      onExitFocusMode: vi.fn(),
      onToggleFocusToolbar: vi.fn(),
    };
  });

  it("handles Focus Mode shortcuts (F, B, Escape)", () => {
    const { rerender } = renderHook(
      (opts) => useWorkspaceShortcuts(opts),
      { initialProps: defaultOptions }
    );

    // 'F' toggles focus mode
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "f" }));
    });
    expect(defaultOptions.onToggleFocusMode).toHaveBeenCalledTimes(1);

    // 'B' toggles toolbar
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "b" }));
    });
    expect(defaultOptions.onToggleFocusToolbar).toHaveBeenCalledTimes(1);

    // 'Escape' exits focus mode when active
    rerender({ ...defaultOptions, isFocusMode: true });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(defaultOptions.onExitFocusMode).toHaveBeenCalledTimes(1);
  });

  it("handles page navigation (ArrowLeft, ArrowRight)", () => {
    renderHook(() => useWorkspaceShortcuts(defaultOptions));

    // ArrowLeft
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    });
    expect(defaultOptions.onNavigatePage).toHaveBeenCalledTimes(1);

    // Test updater logic
    const leftUpdater = vi.mocked(defaultOptions.onNavigatePage).mock.calls[0][0];
    expect(leftUpdater(2)).toBe(1);
    expect(leftUpdater(0)).toBe(0);

    // ArrowRight
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    });
    expect(defaultOptions.onNavigatePage).toHaveBeenCalledTimes(2);

    const rightUpdater = vi.mocked(defaultOptions.onNavigatePage).mock.calls[1][0];
    expect(rightUpdater(2)).toBe(3);
    expect(rightUpdater(4)).toBe(4);
  });

  it("handles translation shortcut 'T' when canTranslate is true and blocks when false", () => {
    const { rerender } = renderHook(
      (opts) => useWorkspaceShortcuts(opts),
      { initialProps: defaultOptions }
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "t" }));
    });
    expect(defaultOptions.onTranslateCurrent).toHaveBeenCalledTimes(1);

    // When cannot translate
    rerender({ ...defaultOptions, canTranslate: false });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "t" }));
    });
    expect(defaultOptions.onTranslateCurrent).toHaveBeenCalledTimes(1);
  });

  it("handles Space layer toggle and respects button/link focus", () => {
    renderHook(() => useWorkspaceShortcuts(defaultOptions));

    // Regular space
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    });
    expect(defaultOptions.onToggleLayer).toHaveBeenCalledTimes(1);

    // Space on a button target should be ignored to allow native button activation
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    const event = new KeyboardEvent("keydown", { key: " ", bubbles: true });
    Object.defineProperty(event, "target", { value: btn, writable: false });

    act(() => {
      window.dispatchEvent(event);
    });
    expect(defaultOptions.onToggleLayer).toHaveBeenCalledTimes(1);
    document.body.removeChild(btn);
  });

  it("handles dialog openers (Ctrl+F for Find & Replace, ? for Shortcuts)", () => {
    renderHook(() => useWorkspaceShortcuts(defaultOptions));

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true }));
    });
    expect(defaultOptions.onOpenFindReplace).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }));
    });
    expect(defaultOptions.onOpenShortcuts).toHaveBeenCalledTimes(1);
  });

  it("handles Ctrl+F from within inputs, dialogs, and non-English keyboard layouts", () => {
    renderHook(() => useWorkspaceShortcuts(defaultOptions));

    // 1. Works with Thai keyboard layout (key: 'ด', code: 'KeyF')
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ด", code: "KeyF", ctrlKey: true })
      );
    });
    expect(defaultOptions.onOpenFindReplace).toHaveBeenCalledTimes(1);

    // 2. Works when an input element is focused
    const input = document.createElement("input");
    document.body.appendChild(input);
    const inputEvent = new KeyboardEvent("keydown", {
      key: "f",
      code: "KeyF",
      ctrlKey: true,
      bubbles: true,
    });
    Object.defineProperty(inputEvent, "target", { value: input, writable: false });

    act(() => {
      window.dispatchEvent(inputEvent);
    });
    expect(defaultOptions.onOpenFindReplace).toHaveBeenCalledTimes(2);
    document.body.removeChild(input);

    // 3. Works when focused inside another dialog/panel
    const otherDialog = document.createElement("div");
    otherDialog.setAttribute("role", "dialog");
    const panelButton = document.createElement("button");
    otherDialog.appendChild(panelButton);
    document.body.appendChild(otherDialog);

    const dialogEvent = new KeyboardEvent("keydown", {
      key: "f",
      code: "KeyF",
      ctrlKey: true,
      bubbles: true,
    });
    Object.defineProperty(dialogEvent, "target", { value: panelButton, writable: false });

    act(() => {
      window.dispatchEvent(dialogEvent);
    });
    expect(defaultOptions.onOpenFindReplace).toHaveBeenCalledTimes(3);
    document.body.removeChild(otherDialog);
  });

  it("handles Undo and Redo shortcuts and tracks undoManager state", () => {
    const undoSpy = vi.spyOn(undoManager, "undo").mockReturnValue("Edit text");
    const redoSpy = vi.spyOn(undoManager, "redo").mockReturnValue("Edit text");

    const { result } = renderHook(() => useWorkspaceShortcuts(defaultOptions));

    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);

    // Ctrl+Z
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true }));
    });
    expect(undoSpy).toHaveBeenCalled();

    // Ctrl+Shift+Z
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", ctrlKey: true, shiftKey: true })
      );
    });
    expect(redoSpy).toHaveBeenCalled();

    undoSpy.mockRestore();
    redoSpy.mockRestore();
  });
});
