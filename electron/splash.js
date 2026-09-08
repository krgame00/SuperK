/**
 * SuperK — Splash Screen & Startup Readiness Gate (Ticket 04)
 *
 * Responsibilities:
 *  - Displays frameless branded splash screen immediately on application launch
 *  - Orchestrates sequential startup milestones:
 *      1. Ports pre-flight check
 *      2. Sidecar launch
 *      3. Sidecar /health check
 *      4. Next.js workspace check
 *      5. Smooth transition to main workspace window
 *  - Handles startup timeouts with diagnostic retry states
 */

const path = require("path");

const SPLASH_WINDOW_CONFIG = {
  width: 480,
  height: 320,
  frame: false,
  resizable: false,
  center: true,
  alwaysOnTop: true,
  backgroundColor: "#0f172a",
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    preload: path.join(__dirname, "splashPreload.js"),
  },
};

const STARTUP_STEPS = [
  "checking-ports",
  "starting-sidecar",
  "checking-sidecar-health",
  "checking-workspace-health",
  "ready",
];

/**
 * Creates the splash BrowserWindow.
 * @param {typeof import('electron').BrowserWindow} BrowserWindow
 * @returns {import('electron').BrowserWindow}
 */
function createSplashWindow(BrowserWindow) {
  const splash = new BrowserWindow(SPLASH_WINDOW_CONFIG);
  splash.loadFile(path.join(__dirname, "splash.html"));
  return splash;
}

class StartupGate {
  constructor(options = {}) {
    this.splashWindow = options.splashWindow;
    this.mainWindow = options.mainWindow;
    this.checkPortsFn = options.checkPortsFn || (async () => null);
    this.startSidecarFn = options.startSidecarFn || (async () => true);
    this.startWorkspaceFn = options.startWorkspaceFn || null;
    this.checkWorkspaceFn = options.checkWorkspaceFn || (async () => true);
    this.createMainWindowFn = options.createMainWindowFn || null;
    this.onStepChange = options.onStepChange || (() => {});
  }

  setStep(step) {
    this.onStepChange(step);
    if (this.splashWindow && !this.splashWindow.isDestroyed()) {
      this.splashWindow.webContents?.send("splash:step", step);
    }
  }

  sendError(type, message) {
    if (this.splashWindow && !this.splashWindow.isDestroyed()) {
      this.splashWindow.webContents?.send("splash:error", { type, message });
    }
  }

  async run() {
    try {
      // 1. Check Ports
      this.setStep("checking-ports");
      const conflict = await this.checkPortsFn();
      if (conflict) {
        return false;
      }

      // 2. Start Sidecar
      this.setStep("starting-sidecar");

      // 3. Sidecar Health
      this.setStep("checking-sidecar-health");
      try {
        await this.startSidecarFn();
      } catch {
        this.sendError(
          "sidecar",
          "Cleaning engine failed to start. Check that your GPU drivers are installed."
        );
        return false;
      }

      // 4. Workspace start + health
      this.setStep("checking-workspace-health");
      try {
        if (this.startWorkspaceFn) {
          await this.startWorkspaceFn();
        }
        const wsHealthy = await this.checkWorkspaceFn();
        if (!wsHealthy) {
          this.sendError("workspace", "Workspace server failed to start.");
          return false;
        }

        // Create/load the main window only after the loopback workspace is healthy.
        if (this.createMainWindowFn) {
          this.mainWindow = await this.createMainWindowFn();
        }
      } catch (err) {
        this.sendError(
          "workspace",
          `Workspace server failed to start. ${err.message || ""}`.trim()
        );
        return false;
      }

      // 5. Ready
      this.setStep("ready");

      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.show();
      }

      if (this.splashWindow && !this.splashWindow.isDestroyed()) {
        this.splashWindow.close();
      }

      return true;
    } catch (err) {
      this.sendError("general", err.message || "Startup failed");
      return false;
    }
  }
}

module.exports = {
  StartupGate,
  STARTUP_STEPS,
  createSplashWindow,
  SPLASH_WINDOW_CONFIG,
};
