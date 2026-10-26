import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET, POST, DELETE } from "@/src/app/api/system/logs/route";
import { clearServerLogs, readRecentServerLogs } from "@/lib/logger/serverLogger";

describe("/api/system/logs route", () => {
  beforeEach(() => {
    clearServerLogs();
  });

  it("GET returns empty entries initially with server health info", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.entries).toEqual([]);
    expect(data.serverTime).toBeDefined();
    expect(typeof data.ocrHealthy).toBe("boolean");
  });

  it("POST appends client log entry to server log file", async () => {
    const req = new Request("http://localhost:3000/api/system/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entry: {
          level: "error",
          category: "translate",
          message: "Client failed to fetch image",
          details: { url: "blob:http://localhost/123" },
          source: "client",
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);

    const logs = readRecentServerLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].message).toBe("Client failed to fetch image");
    expect(logs[0].source).toBe("client");
  });

  it("DELETE clears server logs", async () => {
    const postReq = new Request("http://localhost:3000/api/system/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entry: { level: "info", category: "ui", message: "Hello" },
      }),
    });
    await POST(postReq);
    expect(readRecentServerLogs()).toHaveLength(1);

    const deleteRes = await DELETE();
    expect(deleteRes.status).toBe(200);
    expect(readRecentServerLogs()).toHaveLength(0);
  });
});
