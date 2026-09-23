import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/server/geminiRequest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/geminiRequest")>();
  return {
    ...actual,
    requestGemini: vi.fn(),
  };
});

vi.mock("@/lib/server/geminiTranslationRouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/geminiTranslationRouter")>();
  return {
    ...actual,
    executeGeminiTranslation: vi.fn(),
  };
});

import { requestGemini } from "@/lib/server/geminiRequest";
import { executeGeminiTranslation } from "@/lib/server/geminiTranslationRouter";
import { POST as translateImage } from "@/src/app/api/translate/route";
import { POST as translateText } from "@/src/app/api/translate-text/route";

const requestGeminiMock = vi.mocked(requestGemini);
const executeMock = vi.mocked(executeGeminiTranslation);

function successResult(model = "gemini-3.5-flash-lite") {
  return {
    data: {
      candidates: [{ content: { parts: [{ text: '{"bubbles":[]}' }] } }],
    },
    keyIndex: 0,
    keyId: "key-user",
    keySlot: 1,
    model,
    meta: {
      provider: "gemini" as const,
      model,
      keyId: "key-user",
      keySlot: 1,
      keyOwner: "user" as const,
      attemptCount: 1,
      elapsedMs: 5,
      fallbackCount: 0,
      skippedRouteCount: 0,
    },
  };
}

describe("translation routes use shared Gemini routing for image workflow", () => {
  beforeEach(() => {
    requestGeminiMock.mockReset();
    executeMock.mockReset();
    executeMock.mockResolvedValue(successResult());
    requestGeminiMock.mockResolvedValue(successResult());
    delete process.env.SUPERK_TRANSLATE_BASE_URL;
    delete process.env.SUPERK_TRANSLATE_API_KEY;
    process.env.GEMINI_API_KEY = "server-a,server-b";
  });

  test("image translation passes ownership-scoped user and server pools to shared routing", async () => {
    const response = await translateImage(new Request("http://localhost/api/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        imageBase64: "valid-base64",
        mimeType: "image/png",
        targetLang: "Thai",
        modelPreference: "auto",
        apiKey: "user-a,user-b",
        allowPreview: true,
      }),
    }));

    expect(response.status).toBe(200);
    expect(executeMock).toHaveBeenCalledWith(expect.objectContaining({
      workflow: "image",
      userApiKeyRaw: "user-a,user-b",
      serverApiKeyRaw: "server-a,server-b",
      modelPreference: "auto",
      allowPreview: true,
      attemptTimeoutMs: 25_000,
      totalBudgetMs: 60_000,
    }));
    expect(requestGeminiMock).not.toHaveBeenCalled();
    const validateSuccess = executeMock.mock.calls[0][0].validateSuccess;
    expect(validateSuccess).toBeTypeOf("function");
    expect(validateSuccess?.({ promptFeedback: { blockReason: "SAFETY" } })).toBe(false);
    expect(validateSuccess?.({ candidates: [{ content: { parts: [{ text: "not json" }] } }] })).toBe(false);
    expect(validateSuccess?.({ candidates: [{ content: { parts: [{ text: '{"bubbles":[]}' }] } }] })).toBe(true);
  });

  test("text translation remains on its existing route until the shared text migration is scheduled", async () => {
    const response = await translateText(new Request("http://localhost/api/translate-text", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        bubbles: [{ t: "hello", box: [0, 0, 100, 100] }],
        targetLang: "Thai",
        modelPreference: "auto",
        apiKey: "ignored-user-key",
      }),
    }));

    expect(response.status).toBe(200);
    expect(requestGeminiMock).toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
  });

  test("manual model selection stays on the requested model in shared image routing", async () => {
    executeMock.mockResolvedValueOnce(successResult("gemini-3.8-flash"));

    const response = await translateImage(new Request("http://localhost/api/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        imageBase64: "valid-base64",
        mimeType: "image/png",
        targetLang: "Thai",
        modelPreference: "gemini-3.8-flash",
        apiKey: "user-only",
      }),
    }));

    expect(response.status).toBe(200);
    expect(executeMock).toHaveBeenCalledWith(expect.objectContaining({
      workflow: "image",
      userApiKeyRaw: "user-only",
      serverApiKeyRaw: "server-a,server-b",
      modelPreference: "gemini-3.8-flash",
    }));
    expect(requestGeminiMock).not.toHaveBeenCalled();
  });
});
