// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/src/app/api/extension/pair/route";

describe("P3: Extension Pairing Security & Local-by-Default Hardening", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("rejects request without Origin when Host is a non-loopback remote/LAN host with 403", async () => {
    const req = new NextRequest("http://192.168.1.50:3000/api/extension/pair", {
      method: "GET",
      headers: {
        host: "192.168.1.50:3000",
      },
    });
    const res = await GET(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("Forbidden");
  });

  it("allows request without Origin when Host is loopback (127.0.0.1:3000)", async () => {
    const req = new NextRequest("http://127.0.0.1:3000/api/extension/pair", {
      method: "GET",
      headers: {
        host: "127.0.0.1:3000",
      },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.pairingToken).toBeTruthy();
  });

  it("allows request without Origin when Host is localhost:3000", async () => {
    const req = new NextRequest("http://localhost:3000/api/extension/pair", {
      method: "GET",
      headers: {
        host: "localhost:3000",
      },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.pairingToken).toBeTruthy();
  });

  it("rejects foreign non-loopback Origin with 403 Forbidden", async () => {
    const req = new NextRequest("http://127.0.0.1:3000/api/extension/pair", {
      method: "GET",
      headers: {
        host: "127.0.0.1:3000",
        origin: "https://evil-attacker.example.com",
      },
    });
    const res = await GET(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("Forbidden");
  });

  it("allows loopback Origin (http://localhost:3000 or http://127.0.0.1:3000)", async () => {
    const req = new NextRequest("http://127.0.0.1:3000/api/extension/pair", {
      method: "GET",
      headers: {
        host: "127.0.0.1:3000",
        origin: "http://localhost:3000",
      },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.pairingToken).toBeTruthy();
  });

  it("allows exact same-host Origin for self-hosted instances", async () => {
    const req = new NextRequest("http://superk.internal:3000/api/extension/pair", {
      method: "GET",
      headers: {
        host: "superk.internal:3000",
        origin: "http://superk.internal:3000",
      },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.pairingToken).toBeTruthy();
  });
});
