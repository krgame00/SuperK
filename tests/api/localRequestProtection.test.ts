import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as translateImage } from "@/src/app/api/translate/route";
import { POST as translateText } from "@/src/app/api/translate-text/route";
import { POST as translateModels } from "@/src/app/api/translate/models/route";
import { POST as validateKey } from "@/src/app/api/translate/validate-key/route";
import { POST as translationReview } from "@/src/app/api/translation-review/route";
import { OPTIONS as extensionSettingsOptions } from "@/src/app/api/extension/settings/handler";
import { requestGemini } from "@/lib/server/geminiRequest";
import { getSyncedExtensionSettings } from "@/src/app/api/extension/settings/handler";

vi.mock("@/lib/server/geminiRequest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/geminiRequest")>();
  return { ...actual, requestGemini: vi.fn() };
});

const requestGeminiMock = vi.mocked(requestGemini);
const protectedRoutes = [
  ["/api/translate", translateImage],
  ["/api/translate-text", translateText],
  ["/api/translate/models", translateModels],
  ["/api/translate/validate-key", validateKey],
  ["/api/translation-review", translationReview],
] as const;

function request(url: string, body: string, origin = "https://evil.example.com") {
  return new Request(`http://127.0.0.1:3000${url}`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body,
  });
}

describe("local API request protection", () => {
  beforeEach(() => {
    requestGeminiMock.mockReset().mockResolvedValue({
      data: { candidates: [{ content: { parts: [{ text: '{"bubbles":[]}' }] } }] },
      keyIndex: 0,
      model: "gemini-3.5-flash-lite",
      meta: { provider: "gemini", model: "gemini-3.5-flash-lite", attemptCount: 1, elapsedMs: 1, fallbackCount: 0 },
    } as never);
  });

  it.each(protectedRoutes)("rejects cross-origin POST to %s before reading work", async (_path, handler) => {
    const response = await handler(request(_path, "{}"));
    expect(response.status).toBe(403);
  });

  it.each(protectedRoutes)("permits loopback and extension origins for %s", async (path, handler) => {
    const body = path === "/api/translate-text" ? JSON.stringify({ bubbles: [] }) : "{";
    const loopback = await handler(request(path, body, "http://localhost:3000"));
    const extension = await handler(request(path, body, "chrome-extension://abcdefghijklmnop"));
    expect(loopback.status).not.toBe(403);
    expect(extension.status).not.toBe(403);
  });

  it("uses the explicit or synced user key before server keys and the canonical model order", async () => {
    const settings = getSyncedExtensionSettings() as { geminiApiKey: string };
    const previousKey = settings.geminiApiKey;
    const previousServerKey = process.env.GEMINI_API_KEY;
    settings.geminiApiKey = "synced-user-key";
    process.env.GEMINI_API_KEY = "server-key";
    try {
      const response = await translateText(request("/api/translate-text", JSON.stringify({
        bubbles: [{ t: "hello", box: [0, 0, 100, 100] }],
        apiKey: "explicit-user-key",
        modelPreference: "auto",
      }), "http://localhost:3000"));
      expect(response.status).toBe(200);
      expect(requestGeminiMock).toHaveBeenCalledWith(expect.objectContaining({
        apiKeys: ["explicit-user-key", "server-key"],
        initialKeyIndex: 0,
        models: expect.arrayContaining(["gemini-3.5-flash-lite", "gemini-3.8-flash"]),
      }));
      const models = requestGeminiMock.mock.calls[0][0].models;
      expect(models.slice(0, 5)).toEqual([
        "gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3-flash",
      ]);

      requestGeminiMock.mockClear();
      const syncedResponse = await translateText(request("/api/translate-text", JSON.stringify({
        bubbles: [{ t: "hello", box: [0, 0, 100, 100] }],
      }), "http://localhost:3000"));
      expect(syncedResponse.status).toBe(200);
      expect(requestGeminiMock).toHaveBeenCalledWith(expect.objectContaining({
        apiKeys: ["synced-user-key", "server-key"],
        initialKeyIndex: 0,
      }));
    } finally {
      settings.geminiApiKey = previousKey;
      if (previousServerKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previousServerKey;
    }
  });

  it("allows the extension pairing header in the settings preflight response", async () => {
    const response = await extensionSettingsOptions(new NextRequest("http://127.0.0.1:3000/api/extension/settings", {
      method: "OPTIONS",
      headers: { origin: "chrome-extension://abcdefghijklmnop" },
    }));
    expect(response.headers.get("access-control-allow-headers")).toContain("x-superk-pairing-token");
  });
});
