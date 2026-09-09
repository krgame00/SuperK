import { describe, expect, it, vi } from "vitest";
import {
  ProcessOwnershipManager,
  ProcessOwnershipStore,
} from "../../electron/processOwnership";

describe("desktop child-process ownership", () => {
  function makeMemoryFs(initial: string | null = null) {
    let payload = initial;
    return {
      existsSync: vi.fn(() => payload !== null),
      readFileSync: vi.fn(() => payload ?? ""),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn((_path: string, value: string) => {
        payload = value;
      }),
      renameSync: vi.fn(),
      unlinkSync: vi.fn(),
      _payload: () => payload,
    };
  }

  it("records enough child identity to survive a parent hard kill", () => {
    const fsModule = makeMemoryFs();
    const store = new ProcessOwnershipStore({
      filePath: "C:\\SuperK\\owned-processes.json",
      fsModule: fsModule as any,
    });

    store.record("sidecar", {
      pid: 1234,
      executablePath: "C:\\SuperK\\ocr-service\\runtime\\python.exe",
      args: ["-m", "uvicorn", "app.api:app", "--port", "8765"],
      startedAt: 1_700_000_000_000,
    });

    expect(store.get("sidecar")).toMatchObject({
      pid: 1234,
      executablePath: "C:\\SuperK\\ocr-service\\runtime\\python.exe",
      args: ["-m", "uvicorn", "app.api:app", "--port", "8765"],
      startedAt: 1_700_000_000_000,
    });
  });

  it("reclaims a stale child only when executable, command line, and creation time match", async () => {
    const fsModule = makeMemoryFs();
    const store = new ProcessOwnershipStore({
      filePath: "C:\\SuperK\\owned-processes.json",
      fsModule: fsModule as any,
    });
    const startedAt = Date.parse("2026-09-09T15:00:00.000Z");
    store.record("workspace", {
      pid: 2468,
      executablePath: "C:\\SuperK\\SuperK.exe",
      args: ["C:\\SuperK\\resources\\app\\.next\\standalone\\server.js"],
      startedAt,
    });

    const execFileFn = vi.fn((exe: string, args: string[], cb: Function) => {
      if (exe.toLowerCase().includes("powershell")) {
        cb(null, JSON.stringify({
          ProcessId: 2468,
          ExecutablePath: "C:\\SuperK\\SuperK.exe",
          CommandLine: '"C:\\SuperK\\SuperK.exe" "C:\\SuperK\\resources\\app\\.next\\standalone\\server.js"',
          CreationDate: "2026-09-09T15:00:00.500Z",
        }), "");
      } else {
        cb(null, "SUCCESS", "");
      }
    });

    const manager = new ProcessOwnershipManager({
      store,
      platform: "win32",
      execFileFn: execFileFn as any,
    });

    const results = await manager.reclaimStaleOwnedProcesses();

    expect(results).toEqual([
      expect.objectContaining({ service: "workspace", status: "reclaimed", pid: 2468 }),
    ]);
    expect(execFileFn).toHaveBeenCalledWith(
      "taskkill.exe",
      ["/PID", "2468", "/T", "/F"],
      expect.any(Function),
    );
    expect(store.get("workspace")).toBeNull();
  });

  it("never terminates an unknown process when a stale PID has been reused", async () => {
    const fsModule = makeMemoryFs();
    const store = new ProcessOwnershipStore({
      filePath: "C:\\SuperK\\owned-processes.json",
      fsModule: fsModule as any,
    });
    store.record("sidecar", {
      pid: 9999,
      executablePath: "C:\\SuperK\\ocr-service\\runtime\\python.exe",
      args: ["-m", "uvicorn", "app.api:app", "--port", "8765"],
      startedAt: Date.parse("2026-09-09T15:00:00.000Z"),
    });

    const execFileFn = vi.fn((exe: string, _args: string[], cb: Function) => {
      expect(exe.toLowerCase()).toContain("powershell");
      cb(null, JSON.stringify({
        ProcessId: 9999,
        ExecutablePath: "C:\\Windows\\System32\\python.exe",
        CommandLine: "python unrelated_server.py --port 8765",
        CreationDate: "2026-09-09T15:05:00.000Z",
      }), "");
    });

    const manager = new ProcessOwnershipManager({
      store,
      platform: "win32",
      execFileFn: execFileFn as any,
    });

    const results = await manager.reclaimStaleOwnedProcesses();

    expect(results).toEqual([
      expect.objectContaining({ service: "sidecar", status: "unverified", pid: 9999 }),
    ]);
    expect(execFileFn).toHaveBeenCalledTimes(1);
    expect(store.get("sidecar")).toBeNull();
  });

  it("clears metadata without killing when the recorded child no longer exists", async () => {
    const fsModule = makeMemoryFs();
    const store = new ProcessOwnershipStore({
      filePath: "C:\\SuperK\\owned-processes.json",
      fsModule: fsModule as any,
    });
    store.record("workspace", {
      pid: 1357,
      executablePath: "C:\\SuperK\\SuperK.exe",
      args: ["server.js"],
      startedAt: Date.now(),
    });

    const execFileFn = vi.fn((_exe: string, _args: string[], cb: Function) => {
      const error: any = new Error("not found");
      error.code = 3;
      cb(error, "", "");
    });

    const manager = new ProcessOwnershipManager({
      store,
      platform: "win32",
      execFileFn: execFileFn as any,
    });

    const results = await manager.reclaimStaleOwnedProcesses();
    expect(results[0]).toMatchObject({ status: "gone", pid: 1357 });
    expect(store.get("workspace")).toBeNull();
  });
});
