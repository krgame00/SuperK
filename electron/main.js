/**
 * SuperK — Manga Translator
 * Electron Main Process — Desktop Application Orchestrator
 *
 * Responsibilities:
 *  - Own the local Next.js workspace server lifecycle
 *  - Own the Python OCR / inpainting sidecar lifecycle
 *  - Show a splash screen while both services become healthy
 *  - Load and reveal the main workspace only after startup succeeds
 *  - Shut child processes down with the Electron application
 */

const path = require("path");
const { SidecarSupervisor } = require("./sidecar");
const { WorkspaceServerSupervisor } = require("./workspaceServer");
const {
  checkRequiredPorts,
  findAvailablePort,
  promptPortConflict,
} = require("./portGuard");
const { createDefaultOwnershipManager } = require("./processOwnership");
const { StartupGate, createSplashWindow } = require("./splash");
const {
  WindowStateManager,
  createTrayManager,
  DEFAULT_BOUNDS,
} = require("./windowState");

let electronModule = null;
try {
  electronModule = require("electron");
} catch {
  // Ignored in test environments without electron binary
}

const WORKSPACE_URL = "http://127.0.0.1:3000";

const BASE_WINDOW_CONFIG = {
  title: "SuperK — Manga Translator",
  width: 1440,
  height: 900,
  minWidth: 1024,
  minHeight: 700,
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    preload: path.join(__dirname, "preload.js"),
    backgroundThrottling: false,
  },
  backgroundColor: "#111111",
  show: false,
};

/**
 * Creates the main BrowserWindow.
 * Defaults preserve the original Ticket 01 behavior for direct callers/tests.
 * The desktop bootstrap uses load:false/showOnReady:false so the window is
 * revealed only after the startup gate has completed.
 */
function createMainWindow(BrowserWindow, options = {}) {
  const bounds = options.bounds || {};
  const config = {
    ...BASE_WINDOW_CONFIG,
    ...bounds,
    webPreferences: {
      ...BASE_WINDOW_CONFIG.webPreferences,
      ...(bounds.webPreferences || {}),
    },
  };
  const win = new BrowserWindow(config);
  const showOnReady = options.showOnReady !== false;
  const shouldLoad = options.load !== false;
  const workspaceUrl = options.workspaceUrl || WORKSPACE_URL;

  if (bounds.isMaximized && typeof win.maximize === "function") {
    win.maximize();
  }

  if (showOnReady) {
    win.once("ready-to-show", () => win.show());
  }

  if (shouldLoad) {
    win.loadURL(workspaceUrl);
  }

  return win;
}

/**
 * Bootstrap the Electron application.
 *
 * The legacy sidecar/dialog positional arguments are intentionally retained so
 * existing tests and callers remain compatible. Additional dependencies can be
 * injected through runtimeOptions for deterministic tests.
 */
function bootstrap(
  app,
  BrowserWindow,
  sidecarSupervisor,
  dialogModule,
  runtimeOptions = {}
) {
  const projectRoot = runtimeOptions.projectRoot || path.resolve(__dirname, "..");
  const sidecarRoot =
    runtimeOptions.sidecarRoot ||
    (app.isPackaged && process.resourcesPath ? process.resourcesPath : projectRoot);
  const ownershipManager =
    runtimeOptions.ownershipManager ||
    (typeof app.getPath === "function"
      ? createDefaultOwnershipManager(
          runtimeOptions.ownershipFile ||
            path.join(app.getPath("userData"), "desktop-child-processes.json"),
          { platform: runtimeOptions.platform || process.platform }
        )
      : null);

  const supervisor =
    sidecarSupervisor ||
    new SidecarSupervisor({
      projectRoot: sidecarRoot,
      ownershipManager,
    });
  const workspaceSupervisor =
    runtimeOptions.workspaceSupervisor ||
    new WorkspaceServerSupervisor({
      projectRoot,
      isPackaged: Boolean(app.isPackaged),
      execPath: runtimeOptions.execPath || process.execPath,
      ownershipManager,
    });

  const dialog = dialogModule || runtimeOptions.dialog || null;
  const ipcMain = runtimeOptions.ipcMain || null;
  const splashFactory = runtimeOptions.createSplashWindowFn || createSplashWindow;
  const checkRequiredPortsFn = runtimeOptions.checkRequiredPortsFn || checkRequiredPorts;
  const findAvailablePortFn = runtimeOptions.findAvailablePortFn || findAvailablePort;
  const promptPortConflictFn = runtimeOptions.promptPortConflictFn || promptPortConflict;
  const autoSelectPorts =
    runtimeOptions.autoSelectPorts !== undefined
      ? Boolean(runtimeOptions.autoSelectPorts)
      : Boolean(app.isPackaged);

  const TrayClass =
    runtimeOptions.Tray !== undefined ? runtimeOptions.Tray : electronModule?.Tray;
  const MenuClass =
    runtimeOptions.Menu !== undefined ? runtimeOptions.Menu : electronModule?.Menu;
  const NotificationClass =
    runtimeOptions.Notification !== undefined
      ? runtimeOptions.Notification
      : electronModule?.Notification;
  const shellModule =
    runtimeOptions.shell !== undefined ? runtimeOptions.shell : electronModule?.shell;

  const windowStateManager =
    runtimeOptions.windowStateManager ||
    (typeof app.getPath === "function"
      ? new WindowStateManager({
          configPath:
            runtimeOptions.windowStateFile ||
            path.join(app.getPath("userData"), "window-state.json"),
        })
      : null);

  let mainWindow = null;
  let splashWindow = null;
  let trayManager = null;
  let isQuitting = false;
  let startupRunning = false;
  let shuttingDown = false;
  let ownershipPrepared = false;

  const trayIconPath =
    runtimeOptions.trayIconPath ||
    path.join(projectRoot, "public", "favicon.ico");

  const initTray = () => {
    if (trayManager || !TrayClass || !MenuClass) return;
    try {
      const tray = new TrayClass(trayIconPath);
      trayManager = createTrayManager({
        tray,
        Menu: MenuClass,
        getMainWindow: () => mainWindow,
        onExit: () => {
          isQuitting = true;
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.close?.();
          }
          app.quit();
        },
        openHealthUrl: (url) => {
          shellModule?.openExternal?.(url);
        },
      });
    } catch (err) {
      console.error("[Tray] Could not initialize tray:", err);
    }
  };

  const reportServiceCrash = (service, message) => {
    console.error(`[${service}] ${message}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents?.send("desktop:service-crashed", {
        service,
        message,
      });
    }
  };

  supervisor.on("unexpected-exit", ({ code }) => {
    reportServiceCrash(
      "sidecar",
      `Python cleaning service stopped unexpectedly (code ${code}).`
    );
  });

  workspaceSupervisor.on?.("unexpected-exit", ({ code }) => {
    reportServiceCrash(
      "workspace",
      `Workspace server stopped unexpectedly (code ${code}).`
    );
  });

  const getWorkspaceUrl = () => {
    if (typeof workspaceSupervisor.getWorkspaceUrl === "function") {
      return workspaceSupervisor.getWorkspaceUrl();
    }
    const host = workspaceSupervisor.config?.host || "127.0.0.1";
    const port = workspaceSupervisor.config?.port || 3000;
    return `http://${host}:${port}`;
  };

  const getSidecarBaseUrl = () => {
    if (typeof supervisor.getBaseUrl === "function") {
      return supervisor.getBaseUrl();
    }
    const host = supervisor.config?.host || "127.0.0.1";
    const port = supervisor.config?.port || 8765;
    return `http://${host}:${port}`;
  };

  const prepareRuntimePorts = async () => {
    if (!autoSelectPorts) return;

    const workspaceHost = workspaceSupervisor.config?.host || "127.0.0.1";
    const sidecarHost = supervisor.config?.host || "127.0.0.1";
    const preferredWorkspacePort = workspaceSupervisor.config?.port || 3000;
    const preferredSidecarPort = supervisor.config?.port || 8765;

    if (!workspaceSupervisor.isReady) {
      const workspacePort = await findAvailablePortFn(
        preferredWorkspacePort,
        workspaceHost
      );
      if (workspaceSupervisor.config) {
        workspaceSupervisor.config.port = workspacePort;
      }
      if (workspacePort !== preferredWorkspacePort) {
        console.log(
          `[Ports] Workspace port ${preferredWorkspacePort} is busy; using ${workspacePort}.`
        );
      }
    }

    if (!supervisor.isReady) {
      const sidecarPort = await findAvailablePortFn(
        preferredSidecarPort,
        sidecarHost
      );
      if (supervisor.config) {
        supervisor.config.port = sidecarPort;
      }
      if (sidecarPort !== preferredSidecarPort) {
        console.log(
          `[Ports] Cleaner port ${preferredSidecarPort} is busy; using ${sidecarPort}.`
        );
      }
    }

    const cleanerUrl = getSidecarBaseUrl();
    const serviceEnv = {
      SUPERK_CLEANER_URL: cleanerUrl,
      OCR_SERVICE_URL: cleanerUrl,
    };
    if (typeof workspaceSupervisor.setRuntimeEnv === "function") {
      workspaceSupervisor.setRuntimeEnv(serviceEnv);
    } else {
      workspaceSupervisor.runtimeEnv = {
        ...(workspaceSupervisor.runtimeEnv || {}),
        ...serviceEnv,
      };
    }
  };

  const resolvePortConflicts = async () => {
    const ports = [];
    if (!workspaceSupervisor.isReady) {
      ports.push(workspaceSupervisor.config?.port || 3000);
    }
    if (!supervisor.isReady) {
      ports.push(supervisor.config?.port || 8765);
    }

    if (ports.length === 0) return null;

    let conflict = await checkRequiredPortsFn(ports);
    while (conflict) {
      if (!dialog) return conflict;

      const retried = await promptPortConflictFn(dialog, app, conflict);
      if (!retried) return conflict;
      conflict = await checkRequiredPortsFn(ports);
    }

    return null;
  };

  const createAndLoadMainWindow = async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      return mainWindow;
    }

    const workspaceUrl = getWorkspaceUrl();
    const savedBounds = windowStateManager ? windowStateManager.getBounds() : null;
    const win = createMainWindow(BrowserWindow, {
      showOnReady: false,
      load: false,
      workspaceUrl,
      bounds: savedBounds || undefined,
    });

    mainWindow = win;

    if (windowStateManager) {
      const saveState = () => {
        if (!win.isDestroyed()) {
          const isMaximized = typeof win.isMaximized === "function" ? win.isMaximized() : false;
          const currentBounds = typeof win.getBounds === "function" ? win.getBounds() : {};
          windowStateManager.saveState({
            ...currentBounds,
            isMaximized,
          });
        }
      };
      win.on?.("resize", saveState);
      win.on?.("move", saveState);
    }

    win.on?.("close", (event) => {
      if (!isQuitting && trayManager) {
        if (event && typeof event.preventDefault === "function") {
          event.preventDefault();
        }
        win.hide?.();
      }
    });

    try {
      // Do not gate desktop startup on BrowserWindow.loadURL() fully resolving.
      // In development, a Next.js page can keep the navigation promise pending
      // while the renderer is already paintable (for example because of dev
      // tooling or long-lived resources). Electron's ready-to-show event is the
      // correct signal for revealing a hidden BrowserWindow.
      const rendererReady = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Renderer did not become ready to show within 30 seconds"));
        }, 30000);

        win.once("ready-to-show", () => {
          clearTimeout(timeout);
          resolve(true);
        });
      });

      const loadFailed = new Promise((_, reject) => {
        Promise.resolve(win.loadURL(workspaceUrl)).catch(reject);
      });

      await Promise.race([rendererReady, loadFailed]);
      return win;
    } catch (err) {
      if (mainWindow === win) mainWindow = null;
      win.destroy?.();
      throw new Error(`Failed to load ${workspaceUrl}: ${err.message}`);
    }
  };

  const cleanupFailedStartup = async () => {
    await Promise.allSettled([
      workspaceSupervisor.stop(),
      supervisor.stop(),
    ]);
  };

  const runStartup = async () => {
    if (startupRunning || shuttingDown) return false;
    startupRunning = true;

    try {
      initTray();
      if (!ownershipPrepared && ownershipManager) {
        const ownershipResults = await ownershipManager.reclaimStaleOwnedProcesses();
        for (const result of ownershipResults) {
          console.log(
            `[Ownership] ${result.service} pid=${result.pid} status=${result.status}`
          );
        }
        ownershipPrepared = true;
        if (ownershipResults.some((result) => result.status === "reclaimed")) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }

      await prepareRuntimePorts();

      const gate = new StartupGate({
        splashWindow,
        mainWindow,
        checkPortsFn: resolvePortConflicts,
        startSidecarFn: async () => {
          if (!supervisor.isReady) {
            await supervisor.start();
          }
          return true;
        },
        startWorkspaceFn: async () => {
          if (!workspaceSupervisor.isReady) {
            await workspaceSupervisor.start();
          }
          return true;
        },
        checkWorkspaceFn: async () => workspaceSupervisor.isReady,
        createMainWindowFn: createAndLoadMainWindow,
      });

      const ok = await gate.run();
      if (!ok) {
        await cleanupFailedStartup();
      }
      return ok;
    } finally {
      startupRunning = false;
    }
  };

  const retryHandler = () => {
    runStartup().catch((err) => {
      console.error("[Startup] Retry failed:", err);
    });
  };

  const cleanerRecoverHandler = async (event) => {
    return supervisor.recover((payload) => {
      event?.sender?.send?.("cleaner:recovery-status", payload);
    });
  };

  const notifyHandler = (_event, payload = {}) => {
    if (!NotificationClass) return;
    const isSupported =
      typeof NotificationClass.isSupported === "function"
        ? NotificationClass.isSupported()
        : true;
    if (!isSupported) return;

    try {
      const notif = new NotificationClass({
        title: payload.title || "SuperK — Manga Translator",
        body: payload.body || "",
        icon: trayIconPath,
      });
      notif.on?.("click", () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show?.();
          mainWindow.focus?.();
        }
      });
      notif.show?.();
    } catch (err) {
      console.error("[Notification] Failed to display notification:", err);
    }
  };

  if (ipcMain) {
    ipcMain.on("splash:retry", retryHandler);
    ipcMain.on("desktop:notify", notifyHandler);
    ipcMain.handle?.("cleaner:recover", cleanerRecoverHandler);
  }

  app.whenReady().then(() => {
    initTray();
    splashWindow = splashFactory(BrowserWindow);

    runStartup().catch(async (err) => {
      console.error("[Startup] Failed:", err);
      splashWindow?.webContents?.send("splash:error", {
        type: "general",
        message: err.message || "Startup failed",
      });
      await cleanupFailedStartup();
    });

    app.on("activate", async () => {
      if (BrowserWindow.getAllWindows().length !== 0) return;

      if (workspaceSupervisor.isReady && supervisor.isReady) {
        try {
          mainWindow = await createAndLoadMainWindow();
          mainWindow.show();
        } catch (err) {
          console.error("[Window] Failed to restore main window:", err);
        }
      }
    });
  });

  let cleanupPromise = null;
  const handleShutdown = () => {
    if (cleanupPromise) return cleanupPromise;
    shuttingDown = true;
    isQuitting = true;

    if (trayManager) {
      trayManager.destroy?.();
      trayManager = null;
    }

    if (ipcMain) {
      ipcMain.removeListener?.("splash:retry", retryHandler);
      ipcMain.removeListener?.("desktop:notify", notifyHandler);
      ipcMain.removeHandler?.("cleaner:recover");
    }

    cleanupPromise = Promise.allSettled([
      workspaceSupervisor.stop(),
      supervisor.stop(),
    ]).catch((err) => {
      console.error("[Shutdown] Error while stopping child services:", err);
    });
    return cleanupPromise;
  };

  let isQuitCleanedUp = false;
  app.on("before-quit", (event) => {
    isQuitting = true;
    if (isQuitCleanedUp) return;
    if (event && typeof event.preventDefault === "function") {
      event.preventDefault();
      handleShutdown().finally(() => {
        isQuitCleanedUp = true;
        app.quit();
      });
    } else {
      handleShutdown();
    }
  });

  app.on("window-all-closed", () => {
    handleShutdown();
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  return {
    getSupervisor: () => supervisor,
    getWorkspaceSupervisor: () => workspaceSupervisor,
    getMainWindow: () => mainWindow,
    getSplashWindow: () => splashWindow,
    getTrayManager: () => trayManager,
    runStartup,
  };
}

module.exports = {
  createMainWindow,
  bootstrap,
  WORKSPACE_URL,
  BASE_WINDOW_CONFIG,
};

if (process.type === "browser" && process.versions.electron) {
  const {
    app,
    BrowserWindow,
    dialog,
    ipcMain,
    Tray,
    Menu,
    Notification,
    shell,
  } = require("electron");
  bootstrap(app, BrowserWindow, undefined, dialog, {
    ipcMain,
    Tray,
    Menu,
    Notification,
    shell,
  });
}
