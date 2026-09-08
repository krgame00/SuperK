/**
 * Tests for the Electron-owned Next.js workspace server lifecycle.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";
import path from "path";
import {
  WorkspaceServerSupervisor,
  DEFAULT_WORKSPACE_CONFIG,
} from "../../electron/workspaceServer";

describe("WorkspaceServerSupervisor", () => {
  let child: EventEmitter & {
    pid: number;
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  let spawnFn: ReturnType<typeof vi.fn>;
  let execFn: ReturnType<typeof vi.fn>;
  let fetchFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    child = Object.assign(new EventEmitter(), {
      pid: 24680,
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
    });
    spawnFn = vi.fn().mockReturnValue(child);
    execFn = vi.fn((_cmd, cb) => cb?.(null, "OK", ""));
    fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("launches Next dev through the Electron executable in Node mode", () => {
    const supervisor = new WorkspaceServerSupervisor({
      projectRoot: "C:\\SuperK",
      execPath: "C:\\SuperK\\electron.exe",
      platform: "win32",
      spawnFn: spawnFn as any,
      execFn: execFn as any,
      fetchFn: fetchFn as any,
    });

    supervisor.start();

    const [executable, args, options] = spawnFn.mock.calls[0];
    expect(executable).toBe("C:\\SuperK\\electron.exe");
    expect(args[0]).toBe(path.join("C:\\SuperK", "node_modules", "next", "dist", "bin", "next"));
    expect(args).toContain("dev");
    expect(args).toContain("127.0.0.1");
    expect(args).toContain("3000");
    expect(options.env.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(options.windowsHide).toBe(true);
  });

  it("launches standalone/server.js in packaged mode", () => {
    const supervisor = new WorkspaceServerSupervisor({
      projectRoot: "C:\\SuperK\\resources\\app",
      execPath: "C:\\SuperK\\SuperK.exe",
      isPackaged: true,
      spawnFn: spawnFn as any,
      execFn: execFn as any,
      fetchFn: fetchFn as any,
    });

    supervisor.start();

    const [, args, options] = spawnFn.mock.calls[0];
    expect(args).toEqual([
      path.join("C:\\SuperK\\resources\\app", ".next", "standalone", "server.js"),
    ]);
    expect(options.env.NODE_ENV).toBe("production");
    expect(options.env.PORT).toBe("3000");
    expect(options.env.HOSTNAME).toBe("127.0.0.1");
  });

  it("polls the workspace URL until it is healthy", async () => {
    const supervisor = new WorkspaceServerSupervisor({
      spawnFn: spawnFn as any,
      execFn: execFn as any,
      fetchFn: fetchFn as any,
    });

    const ready = supervisor.start();
    await vi.advanceTimersByTimeAsync(DEFAULT_WORKSPACE_CONFIG.initialBackoffMs);

    await expect(ready).resolves.toBe(true);
    expect(fetchFn).toHaveBeenCalledWith("http://127.0.0.1:3000");
    expect(supervisor.isReady).toBe(true);
  });

  it("tree-kills the workspace process on Windows shutdown", async () => {
    const supervisor = new WorkspaceServerSupervisor({
      platform: "win32",
      spawnFn: spawnFn as any,
      execFn: execFn as any,
      fetchFn: fetchFn as any,
    });

    const ready = supervisor.start();
    await vi.advanceTimersByTimeAsync(DEFAULT_WORKSPACE_CONFIG.initialBackoffMs);
    await ready;

    await supervisor.stop();

    expect(execFn).toHaveBeenCalledWith(
      "taskkill /PID 24680 /T /F",
      expect.any(Function)
    );
    expect(supervisor.isReady).toBe(false);
  });

  it("loads and forwards variables from .env.local and .env into child process environment", () => {
    const fsMock = {
      existsSync: vi.fn((p: string) => {
        return p.endsWith(".env.local") || p.endsWith(".env");
      }),
      readFileSync: vi.fn((p: string) => {
        if (p.endsWith(".env.local")) {
          return "GEMINI_API_KEY=key-from-local\nSUPERK_TRANSLATE_BASE_URL=http://localhost:20128/v1\n# Comment\n";
        }
        if (p.endsWith(".env")) {
          return "GEMINI_API_KEY=key-from-env\nFALLBACK_ONLY_KEY=fallback123\n";
        }
        return "";
      }),
    };

    const supervisor = new WorkspaceServerSupervisor({
      projectRoot: "C:\\SuperK",
      fsModule: fsMock as any,
      spawnFn: spawnFn as any,
      execFn: execFn as any,
      fetchFn: fetchFn as any,
    });

    supervisor.start();

    const [, , options] = spawnFn.mock.calls[0];
    expect(options.env.GEMINI_API_KEY).toBe("key-from-local");
    expect(options.env.SUPERK_TRANSLATE_BASE_URL).toBe("http://localhost:20128/v1");
    expect(options.env.FALLBACK_ONLY_KEY).toBe("fallback123");
  });
});
