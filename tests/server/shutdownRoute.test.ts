// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/src/app/api/system/shutdown/route";

describe("System Shutdown API Route", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("GET returns system status and loopback verification", async () => {
    const req = new NextRequest("http://127.0.0.1:3000/api/system/shutdown", {
      method: "GET",
      headers: { host: "127.0.0.1:3000" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("status", "ok");
    expect(body).toHaveProperty("pid");
  });

  it("POST rejects requests from external non-loopback hosts", async () => {
    const req = new NextRequest("http://192.168.1.100:3000/api/system/shutdown", {
      method: "POST",
      headers: { host: "192.168.1.100:3000" },
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Forbidden");
  });

  it("POST accepts shutdown request from loopback and responds with success message", async () => {
    const req = new NextRequest("http://127.0.0.1:3000/api/system/shutdown", {
      method: "POST",
      headers: {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toContain("กำลังปิดระบบ");
  });
});
