/**
 * SuperK — Manga Translator
 * Electron Main Process — Shell Bootstrap & Sidecar Supervision (Tickets 01 & 02)
 *
 * Responsibilities:
 *  - Create a BrowserWindow that loads the Next.js workspace via loopback
 *  - Enforce minimum and default window dimensions
 *  - Supervise Python sidecar lifecycle (spawn, health check, tree-kill shutdown)
 *  - Forward unexpected sidecar exit notifications to renderer window
 */

const { SidecarSupervisor } = require("./sidecar");

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
 * Pure factory — creates a BrowserWindow and loads the workspace URL.
 * Accepts the BrowserWindow constructor so tests can inject a mock.
 * @param {typeof import('electron').BrowserWindow} BrowserWindow
 * @returns {import('electron').BrowserWindow}
 */
function createMainWindow(BrowserWindow) {
  const win = new BrowserWindow(BASE_WINDOW_CONFIG);
  win.loadURL(WORKSPACE_URL);
  win.once("ready-to-show", () => win.show());
  return win;
}

/**
 * Bootstrap the Electron application.
 * Accepts `app`, `BrowserWindow`, and optional `sidecarSupervisor` so tests inject mocks.
 * @param {import('electron').App} app
 * @param {typeof import('electron').BrowserWindow} BrowserWindow
 * @param {import('./sidecar').SidecarSupervisor} [sidecarSupervisor]
 */
function bootstrap(app, BrowserWindow, sidecarSupervisor) {
  const supervisor = sidecarSupervisor || new SidecarSupervisor();
  let mainWindow = null;

  app.whenReady().then(async () => {
    mainWindow = createMainWindow(BrowserWindow);

    supervisor.on("unexpected-exit", ({ code }) => {
      console.error(`[Sidecar] Unexpected exit with code ${code}`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents?.send("sidecar:crashed", {
          message: "The Python cleaning & OCR service stopped unexpectedly.",
        });
      }
    });

    try {
      await supervisor.start();
      console.log("[Sidecar] Python cleaning service is healthy and ready.");
    } catch (err) {
      console.error("[Sidecar] Failed to start Python service:", err.message);
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow(BrowserWindow);
      }
    });
  });

  const handleShutdown = () => {
    supervisor.stop().catch((err) => {
      console.error("[Sidecar] Error during supervisor shutdown:", err.message);
    });
  };

  app.on("before-quit", handleShutdown);

  app.on("window-all-closed", () => {
    handleShutdown();
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  return { getSupervisor: () => supervisor, getMainWindow: () => mainWindow };
}

module.exports = {
  createMainWindow,
  bootstrap,
  WORKSPACE_URL,
  BASE_WINDOW_CONFIG,
};

// ── Entry point when run by Electron directly ─────────────────────────────────
if (require.main === module) {
  const { app, BrowserWindow } = require("electron");
  bootstrap(app, BrowserWindow);
}
