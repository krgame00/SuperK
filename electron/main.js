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
const { checkRequiredPorts, promptPortConflict } = require("./portGuard");
const { StartupGate, createSplashWindow } = require("./splash");

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
  const win = new BrowserWindow(BASE_WINDOW_CONFIG);
  const showOnReady = options.showOnReady !== false;
  const shouldLoad = options.load !== false;

  if (showOnReady) {
    win.once("ready-to-show", () => win.show());
  }

  if (shouldLoad) {
    win.loadURL(WORKSPACE_URL);
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

  const supervisor =
    sidecarSupervisor || new SidecarSupervisor({ projectRoot: sidecarRoot });
  const workspaceSupervisor =
    runtimeOptions.workspaceSupervisor ||
    new WorkspaceServerSupervisor({
      projectRoot,
      isPackaged: Boolean(app.isPackaged),
      execPath: runtimeOptions.execPath || process.execPath,
    });

  const dialog = dialogModule || runtimeOptions.dialog || null;
  const ipcMain = runtimeOptions.ipcMain || null;
  const splashFactory = runtimeOptions.createSplashWindowFn || createSplashWindow;

  let mainWindow = null;
  let splashWindow = null;
  let startupRunning = false;
  let shuttingDown = false;

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

  const resolvePortConflicts = async () => {
    const ports = [];
    if (!workspaceSupervisor.isReady) ports.push(3000);
    if (!supervisor.isReady) ports.push(8765);

    if (ports.length === 0) return null;

    let conflict = await checkRequiredPorts(ports);
    while (conflict) {
      if (!dialog) return conflict;

      const retried = await promptPortConflict(dialog, app, conflict);
      if (!retried) return conflict;
      conflict = await checkRequiredPorts(ports);
    }

    return null;
  };

  const createAndLoadMainWindow = async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      return mainWindow;
    }

    const win = createMainWindow(BrowserWindow, {
      showOnReady: false,
      load: false,
    });

    mainWindow = win;

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
        Promise.resolve(win.loadURL(WORKSPACE_URL)).catch(reject);
      });

      await Promise.race([rendererReady, loadFailed]);
      return win;
    } catch (err) {
      if (mainWindow === win) mainWindow = null;
      win.destroy?.();
      throw new Error(`Failed to load ${WORKSPACE_URL}: ${err.message}`);
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

  if (ipcMain) {
    ipcMain.on("splash:retry", retryHandler);
  }

  app.whenReady().then(() => {
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

  const handleShutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;

    if (ipcMain) {
      ipcMain.removeListener?.("splash:retry", retryHandler);
    }

    Promise.allSettled([
      workspaceSupervisor.stop(),
      supervisor.stop(),
    ]).catch((err) => {
      console.error("[Shutdown] Error while stopping child services:", err);
    });
  };

  app.on("before-quit", handleShutdown);

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
  const { app, BrowserWindow, dialog, ipcMain } = require("electron");
  bootstrap(app, BrowserWindow, undefined, dialog, { ipcMain });
}
