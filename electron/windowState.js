/**
 * SuperK — Window State Persistence & System Tray (Ticket 05)
 *
 * Responsibilities:
 *  - Persists and restores window size, position, and maximized state
 *  - Debounces state saves
 *  - Manages Windows System Tray icon, tooltip, double-click, and context menu
 *  - Intercepts close button to minimize to tray instead of quitting
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_BOUNDS = {
  width: 1440,
  height: 900,
  minWidth: 1024,
  minHeight: 700,
  isMaximized: false,
};

class SimpleFileStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  get(key) {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        const parsed = JSON.parse(raw);
        return parsed[key] || null;
      }
    } catch {
      // Fallback on corrupt file
    }
    return null;
  }

  set(key, value) {
    try {
      let data = {};
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        data = JSON.parse(raw);
      }
      data[key] = value;
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch {
      // Ignore write errors
    }
  }
}

class WindowStateManager {
  constructor(options = {}) {
    this.store = options.store || new SimpleFileStore(options.configPath);
    this.debounceMs = options.debounceMs || 500;
    this.timer = null;
  }

  getBounds() {
    const saved = this.store.get("windowState");
    if (saved && typeof saved === "object") {
      return { ...DEFAULT_BOUNDS, ...saved };
    }
    return { ...DEFAULT_BOUNDS };
  }

  saveState(state) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.store.set("windowState", state);
    }, this.debounceMs);
  }
}

function createTrayManager(options = {}) {
  const { tray, Menu, mainWindow, onExit, openHealthUrl } = options;

  const updateMenu = (hasError = false) => {
    tray.setToolTip(hasError ? "SuperK — Service Error" : "SuperK — Running");

    const template = [
      {
        label: "Open Workspace",
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      {
        label: "Service Health",
        click: () => {
          if (openHealthUrl) {
            openHealthUrl("http://127.0.0.1:8765/health");
          }
        },
      },
      { type: "separator" },
      {
        label: "Exit SuperK",
        click: () => {
          if (onExit) onExit();
        },
      },
    ];

    const contextMenu = Menu.buildFromTemplate(template);
    tray.setContextMenu(contextMenu);
  };

  updateMenu(false);

  tray.on("double-click", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  return {
    setErrorState: (hasError) => updateMenu(hasError),
    destroy: () => tray.destroy?.(),
  };
}

module.exports = {
  WindowStateManager,
  createTrayManager,
  DEFAULT_BOUNDS,
  SimpleFileStore,
};
