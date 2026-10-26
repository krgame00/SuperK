import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import {
  writeServerLog,
  readRecentServerLogs,
  clearServerLogs,
  getLogFilePath,
} from "@/lib/logger/serverLogger";

describe("serverLogger", () => {
  const logFile = getLogFilePath();

  beforeEach(() => {
    clearServerLogs();
  });

  afterAll(() => {
    clearServerLogs();
  });

  it("writes structured logs to file and reads them back", () => {
    writeServerLog({
      level: "info",
      category: "system",
      message: "Server boot completed",
      source: "server",
    });

    writeServerLog({
      level: "error",
      category: "translate",
      message: "Model timed out",
      details: { model: "gemini-3.5-flash-lite", elapsedMs: 15000 },
      source: "server",
    });

    const entries = readRecentServerLogs();
    expect(entries).toHaveLength(2);
    expect(entries[0].message).toBe("Server boot completed");
    expect(entries[1].message).toBe("Model timed out");
    expect(entries[1].level).toBe("error");
    expect(entries[1].details).toEqual({ model: "gemini-3.5-flash-lite", elapsedMs: 15000 });
  });

  it("clears server logs cleanly", () => {
    writeServerLog({
      level: "warn",
      category: "network",
      message: "Rate limit warn",
      source: "server",
    });

    expect(readRecentServerLogs()).toHaveLength(1);
    clearServerLogs();
    expect(readRecentServerLogs()).toHaveLength(0);
  });
});
