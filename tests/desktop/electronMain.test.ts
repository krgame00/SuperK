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
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  return {
    loadURL: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    destroy: vi.fn(),
    close: vi.fn(),
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    once: vi.fn((event: string, cb: () => void) => {
      if (event === "ready-to-show") cb(); // trigger immediately
    }),
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
    }),
    emit: (event: string, ...args: unknown[]) => {
      listeners[event]?.forEach((cb) => cb(...args));
    },
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
  whenReady: ReturnType<typeof vi.fn> & (() => Promise<unknown>);
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

function bootstrapForTest(
  appMock: AppMock,
  BrowserWindowMock: ReturnType<typeof makeBrowserWindowMock>,
  extraOpts: Record<string, unknown> = {}
) {
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
      checkRequiredPortsFn: vi.fn(async () => null),
      ...extraOpts,
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

  it("exposes cleaner recovery through IPC and forwards observable status", async () => {
    const ipcMain = {
      on: vi.fn(),
      handle: vi.fn(),
      removeListener: vi.fn(),
      removeHandler: vi.fn(),
    };
    const sidecar: any = {
      isReady: true,
      on: vi.fn(),
      start: vi.fn(async () => true),
      stop: vi.fn(async () => undefined),
      recover: vi.fn(async (onStatus: (payload: unknown) => void) => {
        onStatus({ status: "checking" });
        onStatus({ status: "recovered" });
        return { status: "recovered", restarted: false };
      }),
    };
    const workspace: any = {
      isReady: true,
      on: vi.fn(),
      start: vi.fn(async () => true),
      stop: vi.fn(async () => undefined),
    };

    bootstrap(
      appMock as unknown as import("electron").App,
      BrowserWindowMock as unknown as typeof import("electron").BrowserWindow,
      sidecar,
      null as any,
      {
        workspaceSupervisor: workspace,
        ipcMain,
        createSplashWindowFn: vi.fn(() => ({
          close: vi.fn(),
          isDestroyed: vi.fn(() => false),
          webContents: { send: vi.fn() },
        })),
      },
    );

    const registration = ipcMain.handle.mock.calls.find(
      ([channel]) => channel === "cleaner:recover",
    );
    expect(registration).toBeDefined();
    const send = vi.fn();
    const result = await registration![1]({ sender: { send } });

    expect(sidecar.recover).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenNthCalledWith(1, "cleaner:recovery-status", { status: "checking" });
    expect(send).toHaveBeenNthCalledWith(2, "cleaner:recovery-status", { status: "recovered" });
    expect(result).toEqual({ status: "recovered", restarted: false });
  });

  it("reclaims verified stale children before checking ports or starting services", async () => {
    const order: string[] = [];
    appMock.whenReady = vi.fn(() => new Promise(() => {}));
    const sidecar: any = {
      isReady: false,
      on: vi.fn(),
      start: vi.fn(async () => {
        order.push("sidecar");
        sidecar.isReady = true;
        return true;
      }),
      stop: vi.fn(async () => undefined),
    };
    const workspace: any = {
      isReady: false,
      on: vi.fn(),
      start: vi.fn(async () => {
        order.push("workspace");
        workspace.isReady = true;
        return true;
      }),
      stop: vi.fn(async () => undefined),
    };
    const ownershipManager = {
      reclaimStaleOwnedProcesses: vi.fn(async () => {
        order.push("reclaim");
        return [];
      }),
    };

    const runtime = bootstrap(
      appMock as unknown as import("electron").App,
      BrowserWindowMock as unknown as typeof import("electron").BrowserWindow,
      sidecar,
      null as any,
      {
        workspaceSupervisor: workspace,
        ownershipManager,
        checkRequiredPortsFn: vi.fn(async () => {
          order.push("ports");
          return null;
        }),
        createSplashWindowFn: vi.fn(() => ({
          close: vi.fn(),
          isDestroyed: vi.fn(() => false),
          webContents: { send: vi.fn() },
        })),
      },
    );

    await runtime.runStartup();

    expect(ownershipManager.reclaimStaleOwnedProcesses).toHaveBeenCalledTimes(1);
    expect(order.slice(0, 4)).toEqual(["reclaim", "ports", "sidecar", "workspace"]);
  });

  it("auto-selects free ports in packaged mode and loads the dynamic workspace URL", async () => {
    appMock.whenReady = vi.fn(() => new Promise(() => {}));
    (appMock as any).isPackaged = true;

    const sidecar: any = {
      isReady: false,
      config: { host: "127.0.0.1", port: 8765 },
      on: vi.fn(),
      getBaseUrl: vi.fn(() => {
        return `http://${sidecar.config.host}:${sidecar.config.port}`;
      }),
      start: vi.fn(async function () {
        sidecar.isReady = true;
        return true;
      }),
      stop: vi.fn(async () => {
        sidecar.isReady = false;
      }),
    };
    const workspace: any = {
      isReady: false,
      config: { host: "127.0.0.1", port: 3000 },
      runtimeEnv: {},
      on: vi.fn(),
      getWorkspaceUrl: vi.fn(() => {
        return `http://${workspace.config.host}:${workspace.config.port}`;
      }),
      setRuntimeEnv: vi.fn((values: Record<string, string>) => {
        Object.assign(workspace.runtimeEnv, values);
      }),
      start: vi.fn(async function () {
        workspace.isReady = true;
        return true;
      }),
      stop: vi.fn(async () => {
        workspace.isReady = false;
      }),
    };
    const findAvailablePortFn = vi.fn(async (preferred: number) => {
      if (preferred === 3000) return 3001;
      if (preferred === 8765) return 8766;
      return preferred;
    });
    const checkRequiredPortsFn = vi.fn(async () => null);

    const runtime = bootstrap(
      appMock as unknown as import("electron").App,
      BrowserWindowMock as unknown as typeof import("electron").BrowserWindow,
      sidecar,
      null as any,
      {
        workspaceSupervisor: workspace,
        findAvailablePortFn,
        checkRequiredPortsFn,
        createSplashWindowFn: vi.fn(() => ({
          close: vi.fn(),
          isDestroyed: vi.fn(() => false),
          webContents: { send: vi.fn() },
        })),
      },
    );

    await expect(runtime.runStartup()).resolves.toBe(true);

    expect(workspace.config.port).toBe(3001);
    expect(sidecar.config.port).toBe(8766);
    expect(workspace.setRuntimeEnv).toHaveBeenCalledWith({
      SUPERK_CLEANER_URL: "http://127.0.0.1:8766",
      OCR_SERVICE_URL: "http://127.0.0.1:8766",
    });
    expect(checkRequiredPortsFn).toHaveBeenCalledWith([3001, 8766]);
    expect(windowMock.loadURL).toHaveBeenCalledWith("http://127.0.0.1:3001");
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
      webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
  });

  it("disables background timer throttling in webPreferences for full-speed background execution", () => {
    expect(BASE_WINDOW_CONFIG.webPreferences.backgroundThrottling).toBe(false);
  });
});

describe("Background Execution & System Tray", () => {
  let windowMock: ReturnType<typeof makeWindowMock>;
  let BrowserWindowMock: ReturnType<typeof makeBrowserWindowMock>;
  let appMock: AppMock;

  beforeEach(() => {
    windowMock = makeWindowMock();
    BrowserWindowMock = makeBrowserWindowMock(windowMock);
    appMock = makeAppMock();
  });

  it("initializes system tray on app ready and destroys it on shutdown", async () => {
    const mockTrayInstance = {
      setToolTip: vi.fn(),
      setContextMenu: vi.fn(),
      on: vi.fn(),
      destroy: vi.fn(),
    };
    const MockTray = vi.fn(function () {
      return mockTrayInstance;
    }) as any;
    const MockMenu = {
      buildFromTemplate: vi.fn((items) => items),
    };

    const runtime = bootstrapForTest(appMock, BrowserWindowMock, {
      Tray: MockTray,
      Menu: MockMenu,
    });

    await appMock.whenReady();
    expect(MockTray as any).toHaveBeenCalled();
    expect(mockTrayInstance.setToolTip).toHaveBeenCalledWith("SuperK — Running");

    // Before quit should destroy tray icon
    appMock._events["before-quit"]?.();
    expect(mockTrayInstance.destroy).toHaveBeenCalled();
  });

  it("intercepts window close event to hide to tray instead of terminating app", async () => {
    appMock.whenReady = vi.fn(() => new Promise(() => {}));
    const mockTrayInstance = {
      setToolTip: vi.fn(),
      setContextMenu: vi.fn(),
      on: vi.fn(),
      destroy: vi.fn(),
    };
    const MockTray = vi.fn(function () {
      return mockTrayInstance;
    }) as any;
    const MockMenu = {
      buildFromTemplate: vi.fn((items) => items),
    };

    const runtime = bootstrapForTest(appMock, BrowserWindowMock, {
      Tray: MockTray,
      Menu: MockMenu,
    });

    await runtime.runStartup();

    const preventDefault = vi.fn();
    windowMock.emit("close", { preventDefault });

    expect(preventDefault).toHaveBeenCalled();
    expect(windowMock.hide).toHaveBeenCalled();
  });

  it("handles desktop:notify IPC to trigger native OS notification", async () => {
    const ipcMain = {
      on: vi.fn(),
      handle: vi.fn(),
      removeListener: vi.fn(),
      removeHandler: vi.fn(),
    };
    const mockNotificationInstance = {
      on: vi.fn(),
      show: vi.fn(),
    };
    const MockNotification = vi.fn(function (opts: unknown) {
      return mockNotificationInstance;
    }) as unknown as { new (opts: unknown): typeof mockNotificationInstance; isSupported: () => boolean };
    MockNotification.isSupported = vi.fn(() => true);

    bootstrapForTest(appMock, BrowserWindowMock, {
      ipcMain,
      Notification: MockNotification,
    });

    const notifyListener = ipcMain.on.mock.calls.find(
      ([channel]) => channel === "desktop:notify"
    )?.[1];
    expect(notifyListener).toBeDefined();

    notifyListener({}, { title: "SuperK Manga Translator", body: "แปลเสร็จแล้ว" });

    expect(MockNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "SuperK Manga Translator",
        body: "แปลเสร็จแล้ว",
      })
    );
    expect(mockNotificationInstance.show).toHaveBeenCalled();
  });
});
