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
    this.ownershipManager = options.ownershipManager || null;
    this.ownershipService = options.ownershipService || "workspace";
    this.runtimeEnv = { ...(options.runtimeEnv || {}) };

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

  setRuntimeEnv(values = {}) {
    Object.assign(this.runtimeEnv, values);
  }

  getEntryPoint() {
    const standalonePath = path.join(this.projectRoot, ".next", "standalone", "server.js");
    if (this.isPackaged || (!process.env.SUPERK_FORCE_DEV && this.fsModule.existsSync(standalonePath))) {
      return standalonePath;
    }
    return path.join(this.projectRoot, "node_modules", "next", "dist", "bin", "next");
  }

  getLaunchArguments() {
    const entry = this.getEntryPoint();
    if (entry.endsWith("server.js")) {
      return [entry];
    }

    return [
      entry,
      "dev",
      "-H",
      this.config.host,
      "-p",
      String(this.config.port),
    ];
  }

  ensureStandaloneAssets() {
    const standaloneDir = path.join(this.projectRoot, ".next", "standalone");
    if (!this.fsModule.existsSync(standaloneDir)) return;

    const publicSrc = path.join(this.projectRoot, "public");
    const publicDest = path.join(standaloneDir, "public");
    if (this.fsModule.existsSync(publicSrc) && !this.fsModule.existsSync(publicDest)) {
      try {
        if (typeof this.fsModule.cpSync === "function") {
          this.fsModule.cpSync(publicSrc, publicDest, { recursive: true });
        }
      } catch (err) {
        console.warn("[Workspace] Could not sync public to standalone:", err.message);
      }
    }

    const staticSrc = path.join(this.projectRoot, ".next", "static");
    const staticDest = path.join(standaloneDir, ".next", "static");
    if (this.fsModule.existsSync(staticSrc) && !this.fsModule.existsSync(staticDest)) {
      try {
        if (typeof this.fsModule.mkdirSync === "function") {
          this.fsModule.mkdirSync(path.dirname(staticDest), { recursive: true });
        }
        if (typeof this.fsModule.cpSync === "function") {
          this.fsModule.cpSync(staticSrc, staticDest, { recursive: true });
        }
      } catch (err) {
        console.warn("[Workspace] Could not sync static to standalone:", err.message);
      }
    }
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
    const launchArgs = this.getLaunchArguments();
    const isStandalone = launchArgs[0]?.endsWith("server.js");

    if (isStandalone) {
      this.ensureStandaloneAssets();
    }

    const env = {
      ...process.env,
      ...fileEnv,
      ...this.runtimeEnv,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(this.config.port),
      HOSTNAME: this.config.host,
      NODE_ENV: (this.isPackaged || isStandalone) ? "production" : "development",
    };

    const startedAt = Date.now();
    this.process = this.spawnFn(this.execPath, launchArgs, {
      cwd: this.projectRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });

    if (this.process?.pid && this.ownershipManager) {
      this.ownershipManager.record(this.ownershipService, {
        pid: this.process.pid,
        executablePath: this.execPath,
        args: launchArgs,
        cwd: this.projectRoot,
        startedAt,
      });
    }

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
      this.ownershipManager?.clear?.(this.ownershipService);
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

    let terminated = true;
    if (this.platform === "win32") {
      await new Promise((resolve) => {
        this.execFn(`taskkill /PID ${pid} /T /F`, (err) => {
          terminated = !err;
          if (err) {
            console.warn(`[Workspace] taskkill warning: ${err.message}`);
          }
          resolve();
        });
      });
    } else {
      try {
        this.process.kill("SIGTERM");
      } catch {
        terminated = false;
      }
    }

    if (terminated) {
      this.ownershipManager?.clear?.(this.ownershipService);
    }
    this.process = null;
    this.isReady = false;
  }
}

module.exports = {
  WorkspaceServerSupervisor,
  DEFAULT_WORKSPACE_CONFIG,
};
