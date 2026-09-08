/**
 * SuperK — Python Sidecar Supervisor (Ticket 02)
 *
 * Manages the lifecycle of the Python OCR/inpainting service child process:
 *  - Spawns uvicorn as a hidden background process
 *  - Pipes stdout/stderr
 *  - Health checks http://127.0.0.1:8765/health with backoff
 *  - Uses taskkill /PID <pid> /T /F on Windows for clean tree shutdown
 *  - Emits 'unexpected-exit' if the process dies unexpectedly
 */

const { spawn, exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const { resolveCacheEnvironment } = require("./cacheRouting");

const DEFAULT_SIDECAR_CONFIG = {
  host: "127.0.0.1",
  port: 8765,
  initialBackoffMs: 500,
  maxBackoffMs: 4000,
  timeoutMs: 30000,
};

const SIDECAR_HEALTH_URL = `http://${DEFAULT_SIDECAR_CONFIG.host}:${DEFAULT_SIDECAR_CONFIG.port}/health`;

class SidecarSupervisor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.config = { ...DEFAULT_SIDECAR_CONFIG, ...options.config };
    this.spawnFn = options.spawnFn || spawn;
    this.execFn = options.execFn || exec;
    this.fetchFn = options.fetchFn || globalThis.fetch;
    this.platform = options.platform || process.platform;
    this.projectRoot = options.projectRoot || path.resolve(__dirname, "..");
    this.ocrServiceDir = options.ocrServiceDir || path.join(this.projectRoot, "ocr-service");
    this.existsSync = options.existsSync || fs.existsSync;

    this.process = null;
    this.isStopping = false;
    this.isReady = false;
  }

  getPythonPath() {
    const candidates = [
      path.join(this.ocrServiceDir, "runtime", "python.exe"),
      path.join(this.ocrServiceDir, "venv", "Scripts", "python.exe"),
      path.join(this.ocrServiceDir, ".venv", "Scripts", "python.exe"),
    ];

    return candidates.find((candidate) => this.existsSync(candidate)) || candidates[0];
  }

  getOcrServiceDir() {
    return this.ocrServiceDir;
  }

  start() {
    const pythonExe = this.getPythonPath();
    const cwd = this.getOcrServiceDir();

    this.isStopping = false;
    this.isReady = false;

    if (!this.existsSync(pythonExe)) {
      throw new Error(
        `Python runtime was not found. Expected ${path.join(cwd, "runtime")}, ${path.join(cwd, "venv")}, or ${path.join(cwd, ".venv")}.`
      );
    }

    const cacheEnv = resolveCacheEnvironment({
      platform: this.platform,
      appRoot: this.projectRoot,
    });
    console.log(`[Cache Routing] Active cache root: ${cacheEnv.SUPERK_CACHE_ROOT}`);

    this.process = this.spawnFn(
      pythonExe,
      [
        "-m",
        "uvicorn",
        "app.api:app",
        "--host",
        this.config.host,
        "--port",
        String(this.config.port),
      ],
      {
        cwd,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ...cacheEnv },
      }
    );

    if (this.process.stdout) {
      this.process.stdout.on("data", (data) => {
        const text = data.toString().trim();
        if (text) console.log(`[Python Sidecar] ${text}`);
      });
    }

    if (this.process.stderr) {
      this.process.stderr.on("data", (data) => {
        const text = data.toString().trim();
        if (text) console.error(`[Python Sidecar ERR] ${text}`);
      });
    }

    this.process.on("exit", (code, signal) => {
      console.log(`[Python Sidecar] Process exited with code ${code}, signal ${signal}`);
      if (!this.isStopping && this.isReady) {
        this.emit("unexpected-exit", { code, signal });
      }
      this.process = null;
      this.isReady = false;
    });

    return this.pollHealth();
  }

  async pollHealth() {
    const startTime = Date.now();
    let delay = this.config.initialBackoffMs;

    while (Date.now() - startTime < this.config.timeoutMs) {
      if (this.isStopping) return false;

      await new Promise((r) => setTimeout(r, delay));

      try {
        const res = await this.fetchFn(SIDECAR_HEALTH_URL);
        if (res && res.ok) {
          this.isReady = true;
          return true;
        }
      } catch {
        // Not ready yet, retry with backoff
      }

      delay = Math.min(delay * 1.5, this.config.maxBackoffMs);
    }

    throw new Error(
      `Python sidecar did not become healthy within ${this.config.timeoutMs} ms`
    );
  }

  async stop() {
    if (!this.process || !this.process.pid) {
      return;
    }

    this.isStopping = true;
    const pid = this.process.pid;

    if (this.platform === "win32") {
      await new Promise((resolve) => {
        this.execFn(`taskkill /PID ${pid} /T /F`, (err) => {
          if (err) {
            console.warn(`[Python Sidecar] taskkill warning: ${err.message}`);
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
  SidecarSupervisor,
  DEFAULT_SIDECAR_CONFIG,
  SIDECAR_HEALTH_URL,
};
