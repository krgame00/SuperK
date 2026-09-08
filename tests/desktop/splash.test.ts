/**
 * Tests for Splash Screen and Readiness Gate
 * Ticket 04: Splash Screen & Startup Readiness Gate
 *
 * Observable external behavior tested:
 *  - Splash window created with frameless, centered configuration
 *  - Orchestrates startup sequence with labeled progress steps:
 *      1. "checking-ports"
 *      2. "starting-sidecar"
 *      3. "checking-sidecar-health"
 *      4. "checking-workspace-health"
 *      5. "ready"
 *  - Hides main window while splash is active; shows main window and closes splash on readiness
 *  - Surfaces error state on sidecar timeout with retry capability
 *  - Surfaces error state on workspace timeout with retry capability
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  StartupGate,
  STARTUP_STEPS,
  createSplashWindow,
  SPLASH_WINDOW_CONFIG,
} from "../../electron/splash";

describe("StartupGate & Splash Screen (Ticket 04)", () => {
  let mockSplashWin: {
    loadURL: ReturnType<typeof vi.fn>;
    loadFile: ReturnType<typeof vi.fn>;
    show: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    isDestroyed: ReturnType<typeof vi.fn>;
    webContents: { send: ReturnType<typeof vi.fn> };
  };
  let mockMainWin: {
    show: ReturnType<typeof vi.fn>;
    isDestroyed: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockSplashWin = {
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      show: vi.fn(),
      close: vi.fn(),
      isDestroyed: vi.fn(() => false),
      webContents: { send: vi.fn() },
    };

    mockMainWin = {
      show: vi.fn(),
      isDestroyed: vi.fn(() => false),
    };
  });

  it("configures splash window as frameless, centered, and non-resizable", () => {
    expect(SPLASH_WINDOW_CONFIG.frame).toBe(false);
    expect(SPLASH_WINDOW_CONFIG.resizable).toBe(false);
    expect(SPLASH_WINDOW_CONFIG.center).toBe(true);
    expect(SPLASH_WINDOW_CONFIG.alwaysOnTop).toBe(true);
  });

  it("createSplashWindow instantiates splash and loads HTML", () => {
    const mockCtor = vi.fn(function MockBW() {
      return mockSplashWin;
    });
    const win = createSplashWindow(mockCtor as any);
    expect(mockCtor).toHaveBeenCalledWith(SPLASH_WINDOW_CONFIG);
    expect(win.loadFile).toHaveBeenCalled();
  });

  it("defines standard sequential startup steps", () => {
    expect(STARTUP_STEPS).toContain("checking-ports");
    expect(STARTUP_STEPS).toContain("starting-sidecar");
    expect(STARTUP_STEPS).toContain("checking-sidecar-health");
    expect(STARTUP_STEPS).toContain("checking-workspace-health");
    expect(STARTUP_STEPS).toContain("ready");
  });

  it("runs startup gate successfully and transitions from splash to main window", async () => {
    const events: string[] = [];
    const gate = new StartupGate({
      splashWindow: mockSplashWin as any,
      mainWindow: mockMainWin as any,
      checkPortsFn: vi.fn().mockResolvedValue(null),
      startSidecarFn: vi.fn().mockResolvedValue(true),
      checkWorkspaceFn: vi.fn().mockResolvedValue(true),
      onStepChange: (step: string) => events.push(step),
    });

    const result = await gate.run();

    expect(result).toBe(true);
    expect(events).toEqual([
      "checking-ports",
      "starting-sidecar",
      "checking-sidecar-health",
      "checking-workspace-health",
      "ready",
    ]);
    expect(mockMainWin.show).toHaveBeenCalled();
    expect(mockSplashWin.close).toHaveBeenCalled();
  });

  it("handles sidecar timeout with structured error state", async () => {
    const gate = new StartupGate({
      splashWindow: mockSplashWin as any,
      mainWindow: mockMainWin as any,
      checkPortsFn: vi.fn().mockResolvedValue(null),
      startSidecarFn: vi.fn().mockRejectedValue(new Error("Sidecar timeout")),
      checkWorkspaceFn: vi.fn().mockResolvedValue(true),
    });

    const result = await gate.run();

    expect(result).toBe(false);
    expect(mockSplashWin.webContents.send).toHaveBeenCalledWith(
      "splash:error",
      expect.objectContaining({
        type: "sidecar",
        message: expect.stringContaining("Cleaning engine failed to start"),
      })
    );
    expect(mockMainWin.show).not.toHaveBeenCalled();
    expect(mockSplashWin.close).not.toHaveBeenCalled();
  });

  it("handles workspace failure with structured error state", async () => {
    const gate = new StartupGate({
      splashWindow: mockSplashWin as any,
      mainWindow: mockMainWin as any,
      checkPortsFn: vi.fn().mockResolvedValue(null),
      startSidecarFn: vi.fn().mockResolvedValue(true),
      checkWorkspaceFn: vi.fn().mockResolvedValue(false),
    });

    const result = await gate.run();

    expect(result).toBe(false);
    expect(mockSplashWin.webContents.send).toHaveBeenCalledWith(
      "splash:error",
      expect.objectContaining({
        type: "workspace",
        message: expect.stringContaining("Workspace server failed to start"),
      })
    );
  });
});
