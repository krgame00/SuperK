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
    model,
    meta: {
      provider: "gemini" as const,
      model,
      attemptCount: 1,
      elapsedMs: 5,
      fallbackCount: 0,
    },
  };
}

describe("translation routes use the restored fixed Gemini routing path", () => {
  beforeEach(() => {
    requestGeminiMock.mockReset();
    executeMock.mockReset();
    requestGeminiMock.mockResolvedValue(successResult());
    delete process.env.SUPERK_TRANSLATE_BASE_URL;
    delete process.env.SUPERK_TRANSLATE_API_KEY;
    process.env.GEMINI_API_KEY = "server-a,server-b";
  });

  test("image translation uses the user key pool directly and does not invoke dynamic catalog routing", async () => {
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
    expect(requestGeminiMock).toHaveBeenCalledWith(expect.objectContaining({
      apiKeys: ["user-a", "user-b"],
      models: [
        "gemini-3.5-flash-lite",
        "gemini-3.8-flash",
        "gemini-3.7-flash",
        "gemini-3.6-flash",
        "gemini-3-flash",
        "gemini-3.5-flash",
        "gemini-3.1-flash-lite",
      ],
      attemptTimeoutMs: 60_000,
      totalBudgetMs: 180_000,
    }));
    expect(executeMock).not.toHaveBeenCalled();
  });

  test("text translation uses the restored server-key fixed hierarchy", async () => {
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
    expect(requestGeminiMock).toHaveBeenCalledWith(expect.objectContaining({
      apiKeys: ["server-a", "server-b"],
      models: [
        "gemini-3.5-flash-lite",
        "gemini-3.8-flash",
        "gemini-3.7-flash",
        "gemini-3.6-flash",
        "gemini-3-flash",
        "gemini-3.5-flash",
        "gemini-3.1-flash-lite",
      ],
    }));
    expect(executeMock).not.toHaveBeenCalled();
  });

  test("manual model selection stays on the requested model instead of silently substituting another model", async () => {
    requestGeminiMock.mockResolvedValueOnce(successResult("gemini-3.8-flash"));

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
    expect(requestGeminiMock).toHaveBeenCalledWith(expect.objectContaining({
      apiKeys: ["user-only"],
      models: ["gemini-3.8-flash"],
    }));
    expect(executeMock).not.toHaveBeenCalled();
  });
});
