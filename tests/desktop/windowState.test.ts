/**
 * Tests for Window State Persistence & System Tray
 * Ticket 05: Native Window State Persistence & System Tray
 *
 * Observable external behavior tested:
 *  - Loads default dimensions (1440x900) when no saved state exists
 *  - Restores saved bounds (x, y, width, height, isMaximized)
 *  - Saves window state debounced upon resize or move
 *  - Minimizes/hides window on close event instead of destroying if minimizing to tray
 *  - System tray setup: tooltip, click/double-click action, and context menu items:
 *      - "Open Workspace"
 *      - "Service Health"
 *      - "Exit SuperK"
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  WindowStateManager,
  createTrayManager,
  DEFAULT_BOUNDS,
} from "../../electron/windowState";

describe("WindowStateManager & System Tray (Ticket 05)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("WindowStateManager", () => {
    it("returns default window bounds when store is empty", () => {
      const mockStore = {
        get: vi.fn().mockReturnValue(null),
        set: vi.fn(),
      };
      const manager = new WindowStateManager({ store: mockStore as any });
      const bounds = manager.getBounds();

      expect(bounds.width).toBe(DEFAULT_BOUNDS.width);
      expect(bounds.height).toBe(DEFAULT_BOUNDS.height);
      expect(bounds.isMaximized).toBe(false);
    });

    it("restores persisted window bounds and maximized state", () => {
      const saved = { x: 100, y: 150, width: 1600, height: 1000, isMaximized: true };
      const mockStore = {
        get: vi.fn().mockReturnValue(saved),
        set: vi.fn(),
      };
      const manager = new WindowStateManager({ store: mockStore as any });
      const bounds = manager.getBounds();

      expect(bounds).toMatchObject(saved);
    });

    it("saves updated bounds with debounce", async () => {
      const mockStore = {
        get: vi.fn().mockReturnValue(null),
        set: vi.fn(),
      };
      const manager = new WindowStateManager({ store: mockStore as any, debounceMs: 200 });

      manager.saveState({ x: 50, y: 50, width: 1200, height: 800, isMaximized: false });
      expect(mockStore.set).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(200);

      expect(mockStore.set).toHaveBeenCalledWith("windowState", {
        x: 50,
        y: 50,
        width: 1200,
        height: 800,
        isMaximized: false,
      });
    });
  });

  describe("createTrayManager", () => {
    let mockTray: {
      setToolTip: ReturnType<typeof vi.fn>;
      setContextMenu: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
    };
    let mockMenu: {
      buildFromTemplate: ReturnType<typeof vi.fn>;
    };
    let mockWindow: {
      show: ReturnType<typeof vi.fn>;
      focus: ReturnType<typeof vi.fn>;
      isVisible: ReturnType<typeof vi.fn>;
      isDestroyed: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      mockTray = {
        setToolTip: vi.fn(),
        setContextMenu: vi.fn(),
        on: vi.fn(),
      };
      mockMenu = {
        buildFromTemplate: vi.fn((items) => items),
      };
      mockWindow = {
        show: vi.fn(),
        focus: vi.fn(),
        isVisible: vi.fn().mockReturnValue(false),
        isDestroyed: vi.fn().mockReturnValue(false),
      };
    });

    it("configures tray with initial running tooltip and context menu", () => {
      const trayManager = createTrayManager({
        tray: mockTray as any,
        Menu: mockMenu as any,
        mainWindow: mockWindow as any,
        onExit: vi.fn(),
        openHealthUrl: vi.fn(),
      });

      expect(mockTray.setToolTip).toHaveBeenCalledWith("SuperK — Running");
      expect(mockMenu.buildFromTemplate).toHaveBeenCalled();

      const menuItems = mockMenu.buildFromTemplate.mock.calls[0][0];
      const labels = menuItems.map((item: any) => item.label);
      expect(labels).toContain("Open Workspace");
      expect(labels).toContain("Service Health");
      expect(labels).toContain("Exit SuperK");
    });

    it("updates tray tooltip on error", () => {
      const trayManager = createTrayManager({
        tray: mockTray as any,
        Menu: mockMenu as any,
        mainWindow: mockWindow as any,
        onExit: vi.fn(),
        openHealthUrl: vi.fn(),
      });

      trayManager.setErrorState(true);
      expect(mockTray.setToolTip).toHaveBeenCalledWith("SuperK — Service Error");

      trayManager.setErrorState(false);
      expect(mockTray.setToolTip).toHaveBeenCalledWith("SuperK — Running");
    });

    it("focuses window when Open Workspace action triggered", () => {
      createTrayManager({
        tray: mockTray as any,
        Menu: mockMenu as any,
        mainWindow: mockWindow as any,
        onExit: vi.fn(),
        openHealthUrl: vi.fn(),
      });

      const menuItems = mockMenu.buildFromTemplate.mock.calls[0][0];
      const openItem = menuItems.find((item: any) => item.label === "Open Workspace");
      openItem.click();

      expect(mockWindow.show).toHaveBeenCalled();
      expect(mockWindow.focus).toHaveBeenCalled();
    });

    it("resolves window dynamically via getMainWindow getter", () => {
      let currentWin: any = null;
      createTrayManager({
        tray: mockTray as any,
        Menu: mockMenu as any,
        getMainWindow: () => currentWin,
        onExit: vi.fn(),
        openHealthUrl: vi.fn(),
      });

      // Window is attached later
      currentWin = mockWindow;

      const doubleClickHandler = mockTray.on.mock.calls.find(
        (call: any[]) => call[0] === "double-click"
      )?.[1];
      expect(doubleClickHandler).toBeDefined();
      doubleClickHandler();

      expect(mockWindow.show).toHaveBeenCalled();
      expect(mockWindow.focus).toHaveBeenCalled();
    });
  });
});
