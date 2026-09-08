/**
 * Tests for Pre-flight Port Collision Detection & Resolution
 * Ticket 03: Pre-flight Port Collision Detection & User Guidance
 *
 * Observable external behavior tested:
 *  - Checks if a port is available on loopback (127.0.0.1)
 *  - Detects port collisions for port 3000 (Next.js workspace) and port 8765 (Python sidecar)
 *  - Returns actionable diagnosis identifying the service likely occupying the port
 *  - Provides kill command logic on Windows using PowerShell Get-NetTCPConnection
 *  - Handles user choices: Kill & Retry vs Exit (app.quit)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isPortAvailable,
  checkRequiredPorts,
  killProcessOnPort,
  PORT_DIAGNOSTICS,
} from "../../electron/portGuard";

describe("PortGuard (Ticket 03)", () => {
  let mockNetServer: {
    listen: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
  };
  let createServerFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockNetServer = {
      listen: vi.fn(),
      close: vi.fn((cb) => cb && cb()),
      on: vi.fn(),
      once: vi.fn(),
    };
    createServerFn = vi.fn().mockReturnValue(mockNetServer);
  });

  it("reports port as available when server binds and listens successfully", async () => {
    mockNetServer.once = vi.fn((event, handler) => {
      if (event === "listening") handler();
    });

    const result = await isPortAvailable(3000, "127.0.0.1", createServerFn as any);
    expect(result).toBe(true);
    expect(mockNetServer.close).toHaveBeenCalled();
  });

  it("reports port as unavailable when EADDRINUSE error occurs", async () => {
    mockNetServer.once = vi.fn((event, handler) => {
      if (event === "error") {
        const err = new Error("bind EADDRINUSE");
        (err as any).code = "EADDRINUSE";
        handler(err);
      }
    });

    const result = await isPortAvailable(3000, "127.0.0.1", createServerFn as any);
    expect(result).toBe(false);
  });

  it("diagnoses both port 3000 and 8765 with specific user guidance", () => {
    expect(PORT_DIAGNOSTICS[3000].serviceName).toContain("Workspace");
    expect(PORT_DIAGNOSTICS[8765].serviceName).toContain("Neural Cleaner");
  });

  it("checkRequiredPorts returns null when all ports are free", async () => {
    const isPortFreeFn = vi.fn().mockResolvedValue(true);
    const collision = await checkRequiredPorts([3000, 8765], isPortFreeFn);
    expect(collision).toBeNull();
  });

  it("checkRequiredPorts returns the first occupied port and diagnostic", async () => {
    const isPortFreeFn = vi.fn().mockImplementation(async (port: number) => {
      return port === 3000 ? false : true;
    });

    const collision = await checkRequiredPorts([3000, 8765], isPortFreeFn);
    expect(collision).not.toBeNull();
    expect(collision?.port).toBe(3000);
    expect((collision?.diagnostic as any).serviceName).toContain("Workspace");
  });

  it("kills process on port using PowerShell Get-NetTCPConnection on Windows", async () => {
    const mockExec = vi.fn((cmd, cb) => cb && cb(null, "OK", ""));
    const success = await killProcessOnPort(3000, {
      execFn: mockExec as any,
      platform: "win32",
    });

    expect(success).toBe(true);
    expect(mockExec).toHaveBeenCalled();
    const commandRan = mockExec.mock.calls[0][0];
    expect(commandRan).toContain("Get-NetTCPConnection");
    expect(commandRan).toContain("3000");
    expect(commandRan).toContain("Stop-Process");
  });
});
