/**
 * Persisted ownership for Electron-managed child processes.
 *
 * Hard-killing the Electron parent can leave the local workspace/sidecar alive.
 * We persist enough immutable launch identity to reclaim those stale children on
 * the next launch without ever killing an unrelated process just because it
 * occupies the same TCP port.
 */

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const OWNERSHIP_VERSION = 1;
const DEFAULT_CREATION_TOLERANCE_MS = 120000;

function normalizePath(value) {
  if (!value) return "";
  return path.normalize(String(value)).replace(/[\\/]+$/g, "").toLowerCase();
}

function safeParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

class ProcessOwnershipStore {
  constructor(options = {}) {
    this.filePath = options.filePath;
    this.fs = options.fsModule || fs;
    if (!this.filePath) {
      throw new Error("Process ownership file path is required");
    }
  }

  _empty() {
    return { version: OWNERSHIP_VERSION, services: {} };
  }

  _read() {
    if (!this.fs.existsSync(this.filePath)) return this._empty();
    try {
      const parsed = safeParseJson(this.fs.readFileSync(this.filePath, "utf8"));
      if (!parsed || parsed.version !== OWNERSHIP_VERSION || typeof parsed.services !== "object") {
        return this._empty();
      }
      return parsed;
    } catch {
      return this._empty();
    }
  }

  _write(state) {
    const parent = path.dirname(this.filePath);
    this.fs.mkdirSync(parent, { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    this.fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    try {
      this.fs.renameSync(temporary, this.filePath);
    } catch {
      // Test doubles and a few Windows filesystems may not permit replacing an
      // existing target with rename. Fall back to a direct overwrite while
      // keeping the same serialized state.
      this.fs.writeFileSync(this.filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
      try {
        this.fs.unlinkSync?.(temporary);
      } catch {
        // Best effort cleanup only.
      }
    }
  }

  record(service, identity) {
    if (!service || !Number.isInteger(identity?.pid) || identity.pid <= 0) {
      throw new Error("Valid service name and child PID are required for ownership recording");
    }
    const state = this._read();
    state.services[service] = {
      pid: identity.pid,
      executablePath: path.resolve(identity.executablePath),
      args: Array.isArray(identity.args) ? identity.args.map(String) : [],
      cwd: identity.cwd ? path.resolve(identity.cwd) : null,
      startedAt: Number(identity.startedAt || Date.now()),
    };
    this._write(state);
    return state.services[service];
  }

  get(service) {
    const value = this._read().services[service];
    return value || null;
  }

  list() {
    return Object.entries(this._read().services).map(([service, identity]) => ({
      service,
      ...identity,
    }));
  }

  clear(service) {
    const state = this._read();
    if (!(service in state.services)) return;
    delete state.services[service];
    this._write(state);
  }
}

class ProcessOwnershipManager {
  constructor(options = {}) {
    this.store = options.store;
    this.platform = options.platform || process.platform;
    this.execFileFn = options.execFileFn || execFile;
    this.killFn = options.killFn || process.kill.bind(process);
    this.creationToleranceMs =
      options.creationToleranceMs || DEFAULT_CREATION_TOLERANCE_MS;
    if (!this.store) {
      throw new Error("ProcessOwnershipManager requires a store");
    }
  }

  record(service, identity) {
    return this.store.record(service, identity);
  }

  clear(service) {
    return this.store.clear(service);
  }

  _execFile(executable, args) {
    return new Promise((resolve) => {
      this.execFileFn(executable, args, (error, stdout = "", stderr = "") => {
        resolve({ error, stdout: String(stdout || ""), stderr: String(stderr || "") });
      });
    });
  }

  async inspectPid(pid) {
    if (this.platform !== "win32") {
      return null;
    }

    const command = [
      `$p = Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\" -ErrorAction SilentlyContinue`,
      "if ($null -eq $p) { exit 3 }",
      "$p | Select-Object ProcessId,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress",
    ].join("; ");

    const result = await this._execFile("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      command,
    ]);

    if (result.error || !result.stdout.trim()) return null;
    const parsed = safeParseJson(result.stdout.trim());
    if (!parsed) return null;

    return {
      pid: Number(parsed.ProcessId),
      executablePath: parsed.ExecutablePath || "",
      commandLine: parsed.CommandLine || "",
      creationDate: parsed.CreationDate || null,
    };
  }

  verifyOwnership(identity, processInfo) {
    if (!identity || !processInfo || processInfo.pid !== identity.pid) return false;
    if (normalizePath(processInfo.executablePath) !== normalizePath(identity.executablePath)) {
      return false;
    }

    const commandLine = String(processInfo.commandLine || "").toLowerCase();
    if (!commandLine) return false;
    for (const arg of identity.args || []) {
      const token = String(arg).trim().toLowerCase();
      if (token && !commandLine.includes(token)) return false;
    }

    const actualStartedAt = Date.parse(processInfo.creationDate || "");
    if (!Number.isFinite(actualStartedAt) || !Number.isFinite(Number(identity.startedAt))) {
      return false;
    }
    if (Math.abs(actualStartedAt - Number(identity.startedAt)) > this.creationToleranceMs) {
      return false;
    }

    return true;
  }

  async terminatePid(pid) {
    if (this.platform === "win32") {
      const result = await this._execFile("taskkill.exe", [
        "/PID",
        String(pid),
        "/T",
        "/F",
      ]);
      return !result.error;
    }

    try {
      this.killFn(pid, "SIGTERM");
      return true;
    } catch {
      return false;
    }
  }

  async reclaimStaleOwnedProcesses() {
    const results = [];
    for (const identity of this.store.list()) {
      const processInfo = await this.inspectPid(identity.pid);
      if (!processInfo) {
        this.store.clear(identity.service);
        results.push({ service: identity.service, pid: identity.pid, status: "gone" });
        continue;
      }

      if (!this.verifyOwnership(identity, processInfo)) {
        // PID reuse or provenance mismatch: this is no longer our child. Drop
        // stale metadata and deliberately do not terminate the process.
        this.store.clear(identity.service);
        results.push({ service: identity.service, pid: identity.pid, status: "unverified" });
        continue;
      }

      const terminated = await this.terminatePid(identity.pid);
      if (terminated) {
        this.store.clear(identity.service);
        results.push({ service: identity.service, pid: identity.pid, status: "reclaimed" });
      } else {
        // Keep ownership metadata when termination failed so a later launch can
        // safely retry rather than forgetting a process we still own.
        results.push({ service: identity.service, pid: identity.pid, status: "terminate-failed" });
      }
    }
    return results;
  }
}

function createDefaultOwnershipManager(filePath, options = {}) {
  const store = new ProcessOwnershipStore({
    filePath,
    fsModule: options.fsModule,
  });
  return new ProcessOwnershipManager({
    store,
    platform: options.platform,
    execFileFn: options.execFileFn,
    killFn: options.killFn,
  });
}

module.exports = {
  OWNERSHIP_VERSION,
  DEFAULT_CREATION_TOLERANCE_MS,
  ProcessOwnershipStore,
  ProcessOwnershipManager,
  createDefaultOwnershipManager,
};
