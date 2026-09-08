/**
 * SuperK — Manga Translator
 * Electron Main Process — Shell Bootstrap (Ticket 01)
 *
 * Exported factory functions are injected with electron APIs so tests
 * can supply mocks without resolving the Electron binary.
 *
 * Future tickets (02–07) will extend this file with sidecar supervision,
 * port checks, splash screen, system tray, and cache routing.
 */

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
  win.on("closed", () => {
    // mainWindow reference cleanup is handled by the caller
  });
  return win;
}

/**
 * Bootstrap the Electron application.
 * Accepts `app` and `BrowserWindow` from the caller so tests inject mocks.
 * @param {import('electron').App} app
 * @param {typeof import('electron').BrowserWindow} BrowserWindow
 */
function bootstrap(app, BrowserWindow) {
  app.whenReady().then(() => {
    let mainWindow = createMainWindow(BrowserWindow);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow(BrowserWindow);
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}

module.exports = { createMainWindow, bootstrap, WORKSPACE_URL, BASE_WINDOW_CONFIG };

// ── Entry point when run by Electron directly ─────────────────────────────────
// When Electron loads this file as the main entry point, `require('electron')`
// resolves to the real Electron APIs; tests never reach this code path.
if (require.main === module) {
  const { app, BrowserWindow } = require("electron");
  bootstrap(app, BrowserWindow);
}
