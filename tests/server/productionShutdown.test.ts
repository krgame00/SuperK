// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { POST } from "@/src/app/api/system/shutdown/route";

vi.mock("child_process", () => ({ exec: vi.fn() }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.clearAllMocks(); });

test("production shutdown uses the launcher's project root even when standalone changes cwd", async () => {
  vi.useFakeTimers();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("SUPERK_PROJECT_ROOT", "C:\\SuperK Test");
  vi.spyOn(fs, "existsSync").mockReturnValue(true);
  const response = await POST(new NextRequest("http://127.0.0.1:3000/api/system/shutdown", {
    method: "POST", headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
  }));
  expect(response.status).toBe(200);
  await vi.advanceTimersByTimeAsync(500);
  expect(exec).toHaveBeenCalledWith(`cmd.exe /c "${path.join("C:\\SuperK Test", "stop.bat")}"`, expect.any(Function));
});
