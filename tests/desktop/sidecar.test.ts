/**
 * Tests for the Python Sidecar Supervisor
 * Ticket 02: Python Sidecar Process Supervision & Clean Shutdown
 *
 * Observable external behavior tested:
 *  - Spawns Python uvicorn sidecar with correct arguments and working directory
 *  - Pipes stdout/stderr to main logger without separate terminal window
 *  - Polls health endpoint until healthy (or times out)
 *  - Kills sidecar process using Windows tree-kill (taskkill /PID <pid> /T /F) on shutdown
 *  - Emits/notifies window if sidecar crashes unexpectedly
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import {
  SidecarSupervisor,
  SIDECAR_HEALTH_URL,
  DEFAULT_SIDECAR_CONFIG,
} from "../../electron/sidecar";

describe("SidecarSupervisor (Ticket 02)", () => {
  let mockSpawn: ReturnType<typeof vi.fn>;
  let mockExec: ReturnType<typeof vi.fn>;
  let mockFetch: ReturnType<typeof vi.fn>;
  let mockChildProcess: EventEmitter & {
    pid: number;
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();

    mockChildProcess = Object.assign(new EventEmitter(), {
      pid: 12345,
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
    });

    mockSpawn = vi.fn().mockReturnValue(mockChildProcess);
    mockExec = vi.fn((cmd, cb) => cb && cb(null, "SUCCESS", ""));
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ok" }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("exports correct default configuration and health URL", () => {
    expect(SIDECAR_HEALTH_URL).toBe("http://127.0.0.1:8765/health");
    expect(DEFAULT_SIDECAR_CONFIG.host).toBe("127.0.0.1");
    expect(DEFAULT_SIDECAR_CONFIG.port).toBe(8765);
  });

  it("spawns the python uvicorn process with hidden window and correct args", () => {
    const supervisor = new SidecarSupervisor({
      spawnFn: mockSpawn as any,
      execFn: mockExec as any,
      fetchFn: mockFetch as any,
    });

    supervisor.start();

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [executable, args, options] = mockSpawn.mock.calls[0];
    expect(executable).toMatch(/python(\.exe)?$/i);
    expect(args).toEqual([
      "-m",
      "uvicorn",
      "app.api:app",
      "--host",
      "127.0.0.1",
      "--port",
      "8765",
    ]);
    expect(options.windowsHide).toBe(true);
    expect(options.cwd).toMatch(/ocr-service/);
  });

  it("polls /health endpoint and resolves ready when healthy", async () => {
    const supervisor = new SidecarSupervisor({
      spawnFn: mockSpawn as any,
      execFn: mockExec as any,
      fetchFn: mockFetch as any,
    });

    const readyPromise = supervisor.start();

    // Advance fake timers so poll fires
    await vi.advanceTimersByTimeAsync(500);

    await expect(readyPromise).resolves.toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(SIDECAR_HEALTH_URL);
  });

  it("retries health check with backoff when first attempt fails then succeeds", async () => {
    let callCount = 0;
    mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("Connection refused");
      }
      return { ok: true, json: async () => ({ status: "ok" }) };
    });

    const supervisor = new SidecarSupervisor({
      spawnFn: mockSpawn as any,
      execFn: mockExec as any,
      fetchFn: mockFetch as any,
    });

    const readyPromise = supervisor.start();

    // Step 1: fails
    await vi.advanceTimersByTimeAsync(500);
    // Step 2: backoff retry succeeds
    await vi.advanceTimersByTimeAsync(1000);

    await expect(readyPromise).resolves.toBe(true);
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it("kills sidecar tree using taskkill /PID <pid> /T /F on Windows when stopped", async () => {
    const supervisor = new SidecarSupervisor({
      spawnFn: mockSpawn as any,
      execFn: mockExec as any,
      fetchFn: mockFetch as any,
      platform: "win32",
    });

    supervisor.start();
    await vi.advanceTimersByTimeAsync(500);

    await supervisor.stop();

    expect(mockExec).toHaveBeenCalledWith(
      "taskkill /PID 12345 /T /F",
      expect.any(Function)
    );
  });

  it("emits unexpected-exit event if process crashes after becoming ready", async () => {
    const exitListener = vi.fn();
    const supervisor = new SidecarSupervisor({
      spawnFn: mockSpawn as any,
      execFn: mockExec as any,
      fetchFn: mockFetch as any,
    });

    supervisor.on("unexpected-exit", exitListener);

    const readyPromise = supervisor.start();
    await vi.advanceTimersByTimeAsync(500);
    await readyPromise;

    // Simulate child process unexpected exit
    mockChildProcess.emit("exit", 1, null);

    expect(exitListener).toHaveBeenCalledWith({
      code: 1,
      signal: null,
    });
  });

  it("does not emit unexpected-exit when stop() was intentionally requested", async () => {
    const exitListener = vi.fn();
    const supervisor = new SidecarSupervisor({
      spawnFn: mockSpawn as any,
      execFn: mockExec as any,
      fetchFn: mockFetch as any,
    });

    supervisor.on("unexpected-exit", exitListener);

    supervisor.start();
    await vi.advanceTimersByTimeAsync(500);

    await supervisor.stop();
    mockChildProcess.emit("exit", 0, null);

    expect(exitListener).not.toHaveBeenCalled();
  });
});
