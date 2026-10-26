import { describe, it, expect, beforeEach } from "vitest";
import {
  clientLogger,
  logError,
  logWarn,
  logInfo,
  getLogs,
  clearLogs,
  subscribeLogs,
  exportLogsAsText,
} from "@/lib/logger/clientLogger";

describe("clientLogger", () => {
  beforeEach(() => {
    clearLogs();
  });

  it("records log entries with timestamp, level, category, and message", () => {
    logInfo("system", "App initialized");
    logWarn("network", "Slow response detected", { latencyMs: 3200 });
    logError("translate", "Gemini 429 quota exceeded", { status: 429 });

    const logs = getLogs();
    expect(logs).toHaveLength(3);

    expect(logs[0].level).toBe("info");
    expect(logs[0].category).toBe("system");
    expect(logs[0].message).toBe("App initialized");
    expect(logs[0].source).toBe("client");

    expect(logs[1].level).toBe("warn");
    expect(logs[1].category).toBe("network");

    expect(logs[2].level).toBe("error");
    expect(logs[2].category).toBe("translate");
    expect(logs[2].details).toEqual({ status: 429 });
  });

  it("caps memory ring buffer at max entries", () => {
    clientLogger.setMaxEntries(10);
    for (let i = 0; i < 15; i++) {
      logInfo("ui", `Message ${i}`);
    }

    const logs = getLogs();
    expect(logs).toHaveLength(10);
    expect(logs[0].message).toBe("Message 5");
    expect(logs[9].message).toBe("Message 14");
    clientLogger.setMaxEntries(500); // restore
  });

  it("notifies subscribers when new entries are added", () => {
    const received: string[] = [];
    const unsubscribe = subscribeLogs((entry) => {
      received.push(entry.message);
    });

    logInfo("system", "First event");
    logWarn("clean", "Second event");
    unsubscribe();
    logError("export", "Third event");

    expect(received).toEqual(["First event", "Second event"]);
  });

  it("exports logs as clean formatted text", () => {
    logInfo("system", "Ready");
    logError("translate", "Fatal failure", { code: "QUOTA" });

    const text = exportLogsAsText();
    expect(text).toContain("[INFO] [system] Ready");
    expect(text).toContain("[ERROR] [translate] Fatal failure");
    expect(text).toContain("code");
  });

  it("clears logs cleanly", () => {
    logInfo("system", "Test");
    expect(getLogs()).toHaveLength(1);
    clearLogs();
    expect(getLogs()).toHaveLength(0);
  });
});
