import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceToolbarView } from "@/hooks/useWorkspaceToolbarView";

vi.mock("@/lib/customFonts", () => ({
  hydrateStoredCustomFonts: vi.fn(),
}));

describe("useWorkspaceToolbarView", () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    const localStorageMock = {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store.set(key, String(value));
      }),
      removeItem: vi.fn((key: string) => {
        store.delete(key);
      }),
      clear: vi.fn(() => {
        store.clear();
      }),
      length: 0,
      key: vi.fn(() => null),
    };
    Object.defineProperty(globalThis, "localStorage", {
      value: localStorageMock,
      writable: true,
      configurable: true,
    });
    vi.clearAllMocks();
  });

  it("initializes with default states and calls hydrateStoredCustomFonts", async () => {
    const { hydrateStoredCustomFonts } = await import("@/lib/customFonts");
    const { result } = renderHook(() => useWorkspaceToolbarView());

    expect(result.current.workspaceLayer).toBe("original");
    expect(result.current.viewLayout).toBe("single");
    expect(result.current.isMobileMenuOpen).toBe(false);
    expect(result.current.isThumbnailsCollapsed).toBe(false);
    expect(result.current.isFocusMode).toBe(false);
    expect(result.current.isFocusToolbarVisible).toBe(false);
    expect(result.current.toolbarPosition).toBe("top");
    expect(result.current.isToolbarCollapsed).toBe(false);
    expect(hydrateStoredCustomFonts).toHaveBeenCalledTimes(1);
  });

  it("restores toolbar preferences from localStorage", () => {
    store.set("manga_clean_toolbar_position", "bottom");
    store.set("manga_clean_toolbar_collapsed", "true");

    const { result } = renderHook(() => useWorkspaceToolbarView());

    expect(result.current.toolbarPosition).toBe("bottom");
    expect(result.current.isToolbarCollapsed).toBe(true);
  });

  it("toggles toolbar position and persists to localStorage", () => {
    const { result } = renderHook(() => useWorkspaceToolbarView());

    act(() => {
      result.current.toggleToolbarPosition();
    });

    expect(result.current.toolbarPosition).toBe("bottom");
    expect(store.get("manga_clean_toolbar_position")).toBe("bottom");

    act(() => {
      result.current.toggleToolbarPosition();
    });

    expect(result.current.toolbarPosition).toBe("top");
    expect(store.get("manga_clean_toolbar_position")).toBe("top");
  });

  it("toggles toolbar collapsed state and persists to localStorage", () => {
    const { result } = renderHook(() => useWorkspaceToolbarView());

    act(() => {
      result.current.toggleToolbarCollapsed();
    });

    expect(result.current.isToolbarCollapsed).toBe(true);
    expect(store.get("manga_clean_toolbar_collapsed")).toBe("true");

    act(() => {
      result.current.toggleToolbarCollapsed();
    });

    expect(result.current.isToolbarCollapsed).toBe(false);
    expect(store.get("manga_clean_toolbar_collapsed")).toBe("false");
  });

  it("resets focus toolbar visibility when entering focus mode", () => {
    const { result } = renderHook(() => useWorkspaceToolbarView());

    act(() => {
      result.current.setIsFocusToolbarVisible(true);
    });
    expect(result.current.isFocusToolbarVisible).toBe(true);

    act(() => {
      result.current.setIsFocusMode(true);
    });

    expect(result.current.isFocusMode).toBe(true);
    expect(result.current.isFocusToolbarVisible).toBe(false);
  });

  it("handles toggleFocusToolbar differently depending on focus mode", () => {
    const { result } = renderHook(() => useWorkspaceToolbarView());

    // When NOT in focus mode, toggleFocusToolbar toggles collapsed toolbar state
    act(() => {
      result.current.toggleFocusToolbar();
    });
    expect(result.current.isToolbarCollapsed).toBe(true);

    act(() => {
      result.current.setIsFocusMode(true);
    });

    // When in focus mode, toggleFocusToolbar toggles isFocusToolbarVisible
    act(() => {
      result.current.toggleFocusToolbar();
    });
    expect(result.current.isFocusToolbarVisible).toBe(true);
  });

  it("toggles view layout, mobile menu, and thumbnails collapse correctly", () => {
    const { result } = renderHook(() => useWorkspaceToolbarView());

    act(() => {
      result.current.toggleViewLayout();
    });
    expect(result.current.viewLayout).toBe("scroll");

    act(() => {
      result.current.toggleViewLayout();
    });
    expect(result.current.viewLayout).toBe("single");

    act(() => {
      result.current.toggleMobileMenu();
    });
    expect(result.current.isMobileMenuOpen).toBe(true);

    act(() => {
      result.current.closeMobileMenu();
    });
    expect(result.current.isMobileMenuOpen).toBe(false);

    act(() => {
      result.current.toggleThumbnailsCollapse();
    });
    expect(result.current.isThumbnailsCollapsed).toBe(true);
  });
});
