/**
 * Tests for the Electron Shell Main Process
 * Ticket 01: Electron Shell Bootstrap & Dev Launch
 *
 * Strategy: the module exports injectable factory functions (createMainWindow,
 * bootstrap) so tests never need the Electron binary. We supply lightweight
 * mock objects and assert observable behavior.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMainWindow, bootstrap, WORKSPACE_URL, BASE_WINDOW_CONFIG } from "../../electron/main.js";

// ── Mock helpers ───────────────────────────────────────────────────────────────

function makeWindowMock() {
  return {
    loadURL: vi.fn(),
    show: vi.fn(),
    once: vi.fn((event: string, cb: () => void) => {
      if (event === "ready-to-show") cb(); // trigger immediately
    }),
    on: vi.fn(),
  };
}

function makeBrowserWindowMock(windowInstance: ReturnType<typeof makeWindowMock>) {
  // Must be a regular function (not arrow) to be usable as a constructor with `new`
  const ctor = vi.fn(function MockBrowserWindow() {
    return windowInstance;
  }) as unknown as {
    new (opts: object): ReturnType<typeof makeWindowMock>;
    getAllWindows: ReturnType<typeof vi.fn>;
  };
  ctor.getAllWindows = vi.fn(() => [windowInstance]);
  return ctor;
}

// Capture app event callbacks for manual triggering in tests
type AppMock = {
  quit: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  whenReady: ReturnType<typeof vi.fn>;
  _events: Record<string, (...args: unknown[]) => void>;
};

function makeAppMock(): AppMock {
  const mock: AppMock = {
    quit: vi.fn(),
    _events: {},
    on: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve()),
  };
  mock.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
    mock._events[event] = cb;
  });
  return mock;
}

function bootstrapForTest(appMock: AppMock, BrowserWindowMock: ReturnType<typeof makeBrowserWindowMock>) {
  const sidecar: any = {
    isReady: false,
    on: vi.fn(),
    start: vi.fn(async () => {
      sidecar.isReady = true;
      return true;
    }),
    stop: vi.fn(async () => {
      sidecar.isReady = false;
    }),
  };

  const workspace: any = {
    isReady: false,
    on: vi.fn(),
    start: vi.fn(async () => {
      workspace.isReady = true;
      return true;
    }),
    stop: vi.fn(async () => {
      workspace.isReady = false;
    }),
  };

  const splashWindow: any = {
    close: vi.fn(),
    isDestroyed: vi.fn(() => false),
    webContents: { send: vi.fn() },
  };

  return bootstrap(
    appMock as unknown as import("electron").App,
    BrowserWindowMock as unknown as typeof import("electron").BrowserWindow,
    sidecar,
    null as any,
    {
      workspaceSupervisor: workspace,
      createSplashWindowFn: vi.fn(() => splashWindow),
    }
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("createMainWindow — BrowserWindow factory (Ticket 01)", () => {
  let windowMock: ReturnType<typeof makeWindowMock>;
  let BrowserWindowMock: ReturnType<typeof makeBrowserWindowMock>;

  beforeEach(() => {
    windowMock = makeWindowMock();
    BrowserWindowMock = makeBrowserWindowMock(windowMock);
  });

  it("constructs a BrowserWindow with correct default dimensions", () => {
    createMainWindow(BrowserWindowMock as unknown as typeof import("electron").BrowserWindow);
    expect(BrowserWindowMock).toHaveBeenCalledWith(
      expect.objectContaining({ width: 1440, height: 900 })
    );
  });

  it("enforces minimum window dimensions of 1024 × 700", () => {
    createMainWindow(BrowserWindowMock as unknown as typeof import("electron").BrowserWindow);
    expect(BrowserWindowMock).toHaveBeenCalledWith(
      expect.objectContaining({ minWidth: 1024, minHeight: 700 })
    );
  });

  it("sets the window title to 'SuperK — Manga Translator'", () => {
    createMainWindow(BrowserWindowMock as unknown as typeof import("electron").BrowserWindow);
    expect(BrowserWindowMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "SuperK — Manga Translator" })
    );
  });

  it("uses contextIsolation and disables nodeIntegration in webPreferences", () => {
    createMainWindow(BrowserWindowMock as unknown as typeof import("electron").BrowserWindow);
    expect(BrowserWindowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        webPreferences: expect.objectContaining({
          contextIsolation: true,
          nodeIntegration: false,
        }),
      })
    );
  });

  it("loads the workspace loopback URL after creation", () => {
    createMainWindow(BrowserWindowMock as unknown as typeof import("electron").BrowserWindow);
    expect(windowMock.loadURL).toHaveBeenCalledWith(WORKSPACE_URL);
  });

  it("shows the window when ready-to-show fires", () => {
    createMainWindow(BrowserWindowMock as unknown as typeof import("electron").BrowserWindow);
    expect(windowMock.show).toHaveBeenCalled();
  });
});

describe("bootstrap — app lifecycle (Ticket 01)", () => {
  let windowMock: ReturnType<typeof makeWindowMock>;
  let BrowserWindowMock: ReturnType<typeof makeBrowserWindowMock>;
  let appMock: AppMock;

  beforeEach(() => {
    windowMock = makeWindowMock();
    BrowserWindowMock = makeBrowserWindowMock(windowMock);
    appMock = makeAppMock();
  });

  it("calls app.whenReady() on bootstrap", () => {
    bootstrapForTest(appMock, BrowserWindowMock);
    expect(appMock.whenReady).toHaveBeenCalled();
  });

  it("calls app.quit() when window-all-closed fires on Windows", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });

    bootstrapForTest(appMock, BrowserWindowMock);
    await Promise.resolve(); // flush whenReady promise

    appMock._events["window-all-closed"]?.();
    expect(appMock.quit).toHaveBeenCalled();

    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  });

  it("does NOT call app.quit() when platform is darwin", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });

    bootstrapForTest(appMock, BrowserWindowMock);
    await Promise.resolve();

    appMock._events["window-all-closed"]?.();
    expect(appMock.quit).not.toHaveBeenCalled();

    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  });
});

describe("Constants (Ticket 01)", () => {
  it("WORKSPACE_URL points to the loopback Next.js server", () => {
    expect(WORKSPACE_URL).toBe("http://127.0.0.1:3000");
  });

  it("BASE_WINDOW_CONFIG has all required fields", () => {
    expect(BASE_WINDOW_CONFIG).toMatchObject({
      title: "SuperK — Manga Translator",
      width: 1440,
      height: 900,
      minWidth: 1024,
      minHeight: 700,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
  });
});
