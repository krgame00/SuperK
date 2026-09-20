// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

describe("PR 1: Extension Settings Security & Fresh Server Start Without Reset", () => {
  const originalServerKey = process.env.GEMINI_API_KEY;
  const originalPairingToken = process.env.SUPERK_PAIRING_TOKEN;

  beforeEach(() => {
    vi.resetModules();
    process.env.GEMINI_API_KEY = "server-secret-gemini-key-12345";
    process.env.SUPERK_PAIRING_TOKEN = "valid-pairing-token-abc";
  });

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalServerKey;
    process.env.SUPERK_PAIRING_TOKEN = originalPairingToken;
    vi.resetModules();
  });

  it("rejects un-paired GET and POST requests on a fresh server start with 401 Unauthorized", async () => {
    // Dynamically import the module fresh without calling _resetSettingsForTest()!
    const { GET, POST } = await import("@/src/app/api/extension/settings/route");

    // 1. Un-paired GET
    const unauthenticatedGet = new NextRequest("http://127.0.0.1:3000/api/extension/settings", {
      method: "GET",
      headers: {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
      },
    });
    const getRes = await GET(unauthenticatedGet);
    expect(getRes.status).toBe(401);
    const getData = await getRes.json();
    expect(getData.error).toContain("pairing token");

    // 2. Un-paired POST
    const unauthenticatedPost = new NextRequest("http://127.0.0.1:3000/api/extension/settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
      },
      body: JSON.stringify({ targetLang: "Japanese" }),
    });
    const postRes = await POST(unauthenticatedPost);
    expect(postRes.status).toBe(401);
    const postData = await postRes.json();
    expect(postData.error).toContain("pairing token");
  });

  it("never returns secret keys in responses on fresh server start, but indicates server key presence", async () => {
    // Dynamically import fresh without reset
    const { GET, POST } = await import("@/src/app/api/extension/settings/route");

    // Paired GET
    const pairedGet = new NextRequest("http://127.0.0.1:3000/api/extension/settings", {
      method: "GET",
      headers: {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        Authorization: "Bearer valid-pairing-token-abc",
      },
    });

    const getRes = await GET(pairedGet);
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();

    // Must NOT leak server key or any secret key!
    expect(getData.geminiApiKey).toBe("");
    expect(getData.hasServerKey).toBe(true);
    expect(JSON.stringify(getData)).not.toContain("server-secret-gemini-key-12345");

    // Paired POST with a custom user key
    const pairedPost = new NextRequest("http://127.0.0.1:3000/api/extension/settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        "x-superk-pairing-token": "valid-pairing-token-abc",
      },
      body: JSON.stringify({
        geminiApiKey: "user-private-key-67890",
        targetLang: "Thai",
      }),
    });

    const postRes = await POST(pairedPost);
    expect(postRes.status).toBe(200);
    const postData = await postRes.json();

    // Response must NOT echo back secret keys across the wire!
    expect(postData.settings.geminiApiKey).toBe("");
    expect(JSON.stringify(postData)).not.toContain("user-private-key-67890");
    expect(JSON.stringify(postData)).not.toContain("server-secret-gemini-key-12345");
  });
});
