// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST, _resetSettingsForTest } from "@/src/app/api/extension/settings/route";
import { getOrCreatePairingToken } from "@/lib/server/pairing";

describe("Extension Settings Bridge API (/api/extension/settings)", () => {
  beforeEach(() => {
    _resetSettingsForTest();
  });

  it("returns default settings with status 200 for localhost requests with pairing token", async () => {
    const token = getOrCreatePairingToken();
    const req = new NextRequest("http://127.0.0.1:3000/api/extension/settings", {
      method: "GET",
      headers: {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        Authorization: `Bearer ${token}`,
      },
    });

    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toHaveProperty("geminiApiKey");
    expect(data).toHaveProperty("modelHierarchy");
    expect(data.modelHierarchy).toEqual([]);
    expect(data).toHaveProperty("allowPreviewModels", false);
    expect(data).toHaveProperty("textStyle");
    expect(data.textStyle).toMatchObject({
      fontFamily: expect.any(String),
      fontSizeMultiplier: expect.any(Number),
      textColor: expect.any(String),
      textOutline: expect.any(String),
    });
    expect(data).toHaveProperty("ocrServiceUrl", "http://127.0.0.1:8765");
  });

  it("allows chrome-extension origin and provides permissive CORS for extensions with pairing token", async () => {
    const token = getOrCreatePairingToken();
    const req = new NextRequest("http://127.0.0.1:3000/api/extension/settings", {
      method: "GET",
      headers: {
        host: "127.0.0.1:3000",
        origin: "chrome-extension://abcdefghijklmnop",
        Authorization: `Bearer ${token}`,
      },
    });

    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("chrome-extension://abcdefghijklmnop");
  });

  it("rejects unauthorized public origin with 403 Forbidden", async () => {
    const req = new NextRequest("http://127.0.0.1:3000/api/extension/settings", {
      method: "GET",
      headers: {
        host: "127.0.0.1:3000",
        origin: "https://malicious-site.com",
      },
    });

    const res = await GET(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("Forbidden");
  });

  it("allows updating settings via POST from localhost and returns updated settings on subsequent GET", async () => {
    const token = getOrCreatePairingToken();
    const updateReq = new NextRequest("http://127.0.0.1:3000/api/extension/settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        geminiApiKey: "custom-user-key-12345",
        textStyle: {
          fontFamily: "Sarabun, sans-serif",
          fontSizeMultiplier: 1.25,
          textColor: "#111111",
          textOutline: "#EEEEEE",
        },
        glossary: [{ original: "Sensei", translation: "อาจารย์" }],
      }),
    });

    const postRes = await POST(updateReq);
    expect(postRes.status).toBe(200);

    const getReq = new NextRequest("http://127.0.0.1:3000/api/extension/settings", {
      method: "GET",
      headers: {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        Authorization: `Bearer ${token}`,
      },
    });

    const getRes = await GET(getReq);
    const data = await getRes.json();
    expect(data.geminiApiKey).toBe(""); // Secret keys are never returned across the wire!
    expect(data.textStyle.fontFamily).toBe("Sarabun, sans-serif");
    expect(data.textStyle.fontSizeMultiplier).toBe(1.25);
    expect(data.glossary).toEqual([{ original: "Sensei", translation: "อาจารย์" }]);
  });

  it("does not leak server environment GEMINI_API_KEY to callers when user key is empty", async () => {
    const token = getOrCreatePairingToken();
    const originalEnv = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "super-secret-server-key-xyz";
    try {
      _resetSettingsForTest();
      const getReq = new NextRequest("http://127.0.0.1:3000/api/extension/settings", {
        method: "GET",
        headers: {
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
          Authorization: `Bearer ${token}`,
        },
      });
      const res = await GET(getReq);
      const data = await res.json();
      expect(data.geminiApiKey).toBe("");
      expect(data.hasServerKey).toBe(true);
    } finally {
      process.env.GEMINI_API_KEY = originalEnv;
    }
  });
});
