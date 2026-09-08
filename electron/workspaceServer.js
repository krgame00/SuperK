/**
 * SuperK — Next.js Workspace Server Supervisor
 *
 * Owns the local Next.js server used by the Electron renderer so desktop mode
 * can start with a single command / executable instead of requiring a separate
 * `npm run dev` terminal.
 */

const { spawn, exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const { EventEmitter } = require("events");

function parseEnvString(content) {
  const result = {};
  if (!content || typeof content !== "string") return result;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;

    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();

    // Strip wrapping single or double quotes
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }

    if (key) {
      result[key] = val;
    }
  }

  return result;
}

const DEFAULT_WORKSPACE_CONFIG = {
  host: "127.0.0.1",
  port: 3000,
  initialBackoffMs: 250,
  maxBackoffMs: 2000,
  timeoutMs: 60000,
};

class WorkspaceServerSupervisor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.config = { ...DEFAULT_WORKSPACE_CONFIG, ...options.config };
    this.spawnFn = options.spawnFn || spawn;
    this.execFn = options.execFn || exec;
    this.fetchFn = options.fetchFn || globalThis.fetch;
    this.fsModule = options.fsModule || fs;
    this.platform = options.platform || process.platform;
    this.projectRoot = options.projectRoot || path.resolve(__dirname, "..");
    this.isPackaged = Boolean(options.isPackaged);
    this.execPath = options.execPath || process.execPath;

    this.process = null;
    this.isStopping = false;
    this.isReady = false;
    this.startupError = null;
  }

  loadProjectEnv() {
    const loaded = {};

    // 1. Base .env file (if present)
    const baseEnvPath = path.join(this.projectRoot, ".env");
    if (this.fsModule.existsSync(baseEnvPath)) {
      try {
        const raw = this.fsModule.readFileSync(baseEnvPath, "utf8");
        Object.assign(loaded, parseEnvString(raw));
      } catch (err) {
        console.warn(`[Workspace] Could not read .env: ${err.message}`);
      }
    }

    // 2. .env.local overrides base .env
    const localEnvPath = path.join(this.projectRoot, ".env.local");
    if (this.fsModule.existsSync(localEnvPath)) {
      try {
        const raw = this.fsModule.readFileSync(localEnvPath, "utf8");
        Object.assign(loaded, parseEnvString(raw));
      } catch (err) {
        console.warn(`[Workspace] Could not read .env.local: ${err.message}`);
      }
    }

    return loaded;
  }

  getWorkspaceUrl() {
    return `http://${this.config.host}:${this.config.port}`;
  }

  getEntryPoint() {
    if (this.isPackaged) {
      return path.join(this.projectRoot, ".next", "standalone", "server.js");
    }
    return path.join(this.projectRoot, "node_modules", "next", "dist", "bin", "next");
  }

  getLaunchArguments() {
    if (this.isPackaged) {
      return [this.getEntryPoint()];
    }

    return [
      this.getEntryPoint(),
      "dev",
      "-H",
      this.config.host,
      "-p",
      String(this.config.port),
    ];
  }

  start() {
    if (this.isReady) {
      return Promise.resolve(true);
    }
    if (this.process) {
      return this.pollHealth();
    }

    this.isStopping = false;
    this.startupError = null;

    const fileEnv = this.loadProjectEnv();

    const env = {
      ...process.env,
      ...fileEnv,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(this.config.port),
      HOSTNAME: this.config.host,
      NODE_ENV: this.isPackaged ? "production" : "development",
    };

    this.process = this.spawnFn(this.execPath, this.getLaunchArguments(), {
      cwd: this.projectRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });

    if (this.process.stdout) {
      this.process.stdout.on("data", (data) => {
        const text = data.toString().trim();
        if (text) console.log(`[Workspace] ${text}`);
      });
    }

    if (this.process.stderr) {
      this.process.stderr.on("data", (data) => {
        const text = data.toString().trim();
        if (text) console.error(`[Workspace ERR] ${text}`);
      });
    }

    this.process.on("error", (err) => {
      this.startupError = err;
    });

    this.process.on("exit", (code, signal) => {
      console.log(`[Workspace] Process exited with code ${code}, signal ${signal}`);
      if (!this.isStopping && this.isReady) {
        this.emit("unexpected-exit", { code, signal });
      }
      if (!this.isStopping && !this.isReady && code !== 0 && !this.startupError) {
        this.startupError = new Error(`Workspace process exited with code ${code}`);
      }
      this.process = null;
      this.isReady = false;
    });

    return this.pollHealth();
  }

  async pollHealth() {
    const startTime = Date.now();
    let delay = this.config.initialBackoffMs;
    const url = this.getWorkspaceUrl();

    while (Date.now() - startTime < this.config.timeoutMs) {
      if (this.isStopping) return false;
      if (this.startupError) throw this.startupError;

      await new Promise((resolve) => setTimeout(resolve, delay));

      try {
        const res = await this.fetchFn(url);
        if (res && (res.ok || (res.status >= 300 && res.status < 500))) {
          this.isReady = true;
          return true;
        }
      } catch {
        // Server is still booting.
      }

      delay = Math.min(Math.ceil(delay * 1.5), this.config.maxBackoffMs);
    }

    throw new Error(`Workspace server did not become healthy within ${this.config.timeoutMs} ms`);
  }

  async stop() {
    if (!this.process || !this.process.pid) {
      this.isReady = false;
      return;
    }

    this.isStopping = true;
    const pid = this.process.pid;

    if (this.platform === "win32") {
      await new Promise((resolve) => {
        this.execFn(`taskkill /PID ${pid} /T /F`, (err) => {
          if (err) {
            console.warn(`[Workspace] taskkill warning: ${err.message}`);
          }
          resolve();
        });
      });
    } else {
      this.process.kill("SIGTERM");
    }

    this.process = null;
    this.isReady = false;
  }
}

module.exports = {
  WorkspaceServerSupervisor,
  DEFAULT_WORKSPACE_CONFIG,
};
