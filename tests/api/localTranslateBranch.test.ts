import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("@/lib/server/geminiRequest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/geminiRequest")>();
  return {
    ...actual,
    requestGemini: vi.fn(),
    requestOpenAICompatible: vi.fn(),
  };
});

vi.mock("@/lib/server/geminiTranslationRouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/geminiTranslationRouter")>();
  return {
    ...actual,
    executeGeminiTranslation: vi.fn(),
  };
});

vi.mock("@/lib/server/localEngine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/localEngine")>();
  return {
    ...actual,
    probeLocalEngine: vi.fn(),
  };
});

import {
  GeminiRequestError,
  requestGemini,
  requestOpenAICompatible,
} from "@/lib/server/geminiRequest";
import { executeGeminiTranslation } from "@/lib/server/geminiTranslationRouter";
import { probeLocalEngine } from "@/lib/server/localEngine";
import { POST as translateImage } from "@/src/app/api/translate/route";
import { POST as translateText } from "@/src/app/api/translate-text/route";
import { POST as localModelsRoute } from "@/src/app/api/translate/local-models/route";
import { isVisionModelName } from "@/lib/translation/modelPreference";

const requestGeminiMock = vi.mocked(requestGemini);
const executeGeminiTranslationMock = vi.mocked(executeGeminiTranslation);
const requestOpenAICompatibleMock = vi.mocked(requestOpenAICompatible);
const probeLocalEngineMock = vi.mocked(probeLocalEngine);

const localPreference = { engine: "local", baseUrl: "http://localhost:11434", model: "qwen2.5-vl:7b" };

const originalApiKey = process.env.GEMINI_API_KEY;

beforeEach(() => {
  requestGeminiMock.mockReset();
  executeGeminiTranslationMock.mockReset();
  requestOpenAICompatibleMock.mockReset();
  probeLocalEngineMock.mockReset();
  delete process.env.GEMINI_API_KEY;
  delete process.env.SUPERK_TRANSLATE_BASE_URL;
  delete process.env.SUPERK_TRANSLATE_API_KEY;
});

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalApiKey;
});

function imageRequest(body: Record<string, unknown>, origin?: string) {
  return new Request("http://localhost/api/translate", {
    method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: JSON.stringify({ imageBase64: "test-image", mimeType: "image/png", targetLang: "Thai", ...body }),
  });
}

function textRequest(body: Record<string, unknown>, origin?: string) {
  return new Request("http://localhost/api/translate-text", {
    method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: JSON.stringify({ bubbles: [{ t: "hello", box: [0, 0, 100, 100] }], targetLang: "Thai", ...body }),
  });
}

function transportError(overrides: { code?: "GEMINI_UPSTREAM" | "GEMINI_TIMEOUT"; status?: number; transport?: boolean } = {}): GeminiRequestError {
  const { code = "GEMINI_UPSTREAM", status = 502, transport = true } = overrides;
  return new GeminiRequestError("daemon did not answer", code, status, true, undefined, undefined, undefined, undefined, transport);
}

test("R6 canary: a failing local engine answers the local error shape and cloud engines are never called", async () => {
  requestOpenAICompatibleMock.mockRejectedValue(transportError());

  const response = await translateImage(imageRequest({ modelPreference: localPreference }));

  expect(response.status).toBe(502);
  const body = await response.json();
  expect(body).toMatchObject({ code: "LOCAL_UNREACHABLE", engine: "local", retryable: true });
  expect(body.error).toContain("No cloud fallback was attempted");
  expect(requestGeminiMock).not.toHaveBeenCalled();
  expect(executeGeminiTranslationMock).not.toHaveBeenCalled();
  // The daemon-observed request is the local engine's, with JSON-only output.
  expect(requestOpenAICompatibleMock).toHaveBeenCalledWith(expect.objectContaining({
    baseUrl: "http://localhost:11434/v1",
    model: "qwen2.5-vl:7b",
    apiKey: "",
    payload: expect.objectContaining({
      response_format: { type: "json_object" },
      messages: [expect.objectContaining({
        content: expect.arrayContaining([
          expect.objectContaining({ type: "image_url" }),
        ]),
      })],
    }),
  }));
});

test("a local timeout answers 504 LOCAL_UNREACHABLE and a daemon error passes its status through as LOCAL_FAILED", async () => {
  requestOpenAICompatibleMock.mockRejectedValue(transportError({ code: "GEMINI_TIMEOUT", status: 504 }));
  const timeoutResponse = await translateImage(imageRequest({ modelPreference: localPreference }));
  expect(timeoutResponse.status).toBe(504);
  expect(await timeoutResponse.json()).toMatchObject({ code: "LOCAL_UNREACHABLE", engine: "local" });

  requestOpenAICompatibleMock.mockRejectedValue(transportError({ transport: false }));
  const failedResponse = await translateImage(imageRequest({ modelPreference: localPreference }));
  expect(failedResponse.status).toBe(502);
  expect(await failedResponse.json()).toMatchObject({ code: "LOCAL_FAILED", engine: "local" });

  expect(requestGeminiMock).not.toHaveBeenCalled();
  expect(executeGeminiTranslationMock).not.toHaveBeenCalled();
});

test("the text route keeps a local failure local without any Gemini key configured", async () => {
  requestOpenAICompatibleMock.mockRejectedValue(transportError());

  const response = await translateText(textRequest({ modelPreference: localPreference }));

  expect(response.status).toBe(502);
  const body = await response.json();
  expect(body).toMatchObject({ code: "LOCAL_UNREACHABLE", engine: "local" });
  expect(body.error).not.toContain("Server missing API Key");
  expect(requestOpenAICompatibleMock).toHaveBeenCalledWith(expect.objectContaining({
    baseUrl: "http://localhost:11434/v1",
    payload: expect.objectContaining({
      response_format: { type: "json_object" },
      messages: [expect.objectContaining({
        content: expect.stringContaining("You are an expert manga translator"),
      })],
    }),
  }));
  expect(requestGeminiMock).not.toHaveBeenCalled();
  expect(executeGeminiTranslationMock).not.toHaveBeenCalled();
});

test.each([
  ["bare local marker", "local"],
  ["empty local object", { engine: "local", baseUrl: "", model: "" }],
])("an unconfigured local selection (%s) answers LOCAL_NOT_CONFIGURED without contacting any engine", async (_name, modelPreference) => {
  const response = await translateImage(imageRequest({ modelPreference }));

  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: "LOCAL_NOT_CONFIGURED", engine: "local" });
  expect(requestOpenAICompatibleMock).not.toHaveBeenCalled();
  expect(requestGeminiMock).not.toHaveBeenCalled();
  expect(executeGeminiTranslationMock).not.toHaveBeenCalled();
});

test("a local selection translates through the daemon and returns the sanitized text", async () => {
  requestOpenAICompatibleMock.mockResolvedValue({
    data: { choices: [{ message: { content: '{"bubbles":[{"t":"สวัสดี","box":[0,0,10,10]}]}' }, finish_reason: "stop" }] },
    model: "qwen2.5-vl:7b",
    meta: { provider: "openai_compatible", model: "qwen2.5-vl:7b", attemptCount: 1, elapsedMs: 5, fallbackCount: 0 },
  } as never);

  const response = await translateImage(imageRequest({ modelPreference: localPreference }));

  expect(response.status).toBe(200);
  const { text } = await response.json();
  const parsed = JSON.parse(text);
  expect(parsed.bubbles).toHaveLength(1);
  expect(parsed.bubbles[0].t).toBe("สวัสดี");
  expect(requestGeminiMock).not.toHaveBeenCalled();
  expect(executeGeminiTranslationMock).not.toHaveBeenCalled();
});

test("the text route translates a local selection through the daemon", async () => {
  requestOpenAICompatibleMock.mockResolvedValue({
    data: { choices: [{ message: { content: '{"bubbles":[{"t":"สวัสดี","box":[0,0,100,100]}]}' } }] },
    model: "qwen2.5:14b",
    meta: { provider: "openai_compatible", model: "qwen2.5:14b", attemptCount: 1, elapsedMs: 5, fallbackCount: 0 },
  } as never);

  const response = await translateText(textRequest({ modelPreference: { ...localPreference, model: "qwen2.5:14b" } }));

  expect(response.status).toBe(200);
  const { text } = await response.json();
  expect(JSON.parse(text).bubbles).toHaveLength(1);
  expect(requestGeminiMock).not.toHaveBeenCalled();
});

test("a Gemini object preference on the text route keeps the raw model id in the cloud flow", async () => {
  process.env.GEMINI_API_KEY = "server-key";
  requestGeminiMock.mockResolvedValue({
    data: { candidates: [{ content: { parts: [{ text: '{"bubbles":[]}' }] } }] },
    keyIndex: 0,
    model: "gemini-3.8-flash",
    meta: { provider: "gemini", model: "gemini-3.8-flash", attemptCount: 1, elapsedMs: 1, fallbackCount: 0 },
  } as never);

  const response = await translateText(textRequest({ modelPreference: { engine: "gemini", model: "gemini-3.8-flash" } }));

  expect(response.status).toBe(200);
  expect(requestGeminiMock).toHaveBeenCalledWith(expect.objectContaining({
    models: ["gemini-3.8-flash"],
  }));
  expect(requestOpenAICompatibleMock).not.toHaveBeenCalled();
});

test("a malformed preference object answers 400 INVALID_REQUEST before any engine runs", async () => {
  const response = await translateImage(imageRequest({ modelPreference: 42 }));

  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: "INVALID_REQUEST" });
  expect(requestOpenAICompatibleMock).not.toHaveBeenCalled();
  expect(requestGeminiMock).not.toHaveBeenCalled();
  expect(executeGeminiTranslationMock).not.toHaveBeenCalled();
});

test("local translation behind a cross-origin request is refused before any engine runs", async () => {
  const response = await translateImage(imageRequest({ modelPreference: localPreference }, "https://evil.example.com"));

  expect(response.status).toBe(403);
  expect(requestOpenAICompatibleMock).not.toHaveBeenCalled();
  expect(requestGeminiMock).not.toHaveBeenCalled();
});

test("the discovery route reports a successful probe", async () => {
  probeLocalEngineMock.mockResolvedValue({
    ok: true,
    baseUrl: "http://localhost:11434/v1",
    models: [{ id: "qwen2.5-vl:7b" }],
    latencyMs: 42,
  });

  const response = await localModelsRoute(new Request("http://localhost/api/translate/local-models", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baseUrl: "http://localhost:11434" }),
  }));

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    ok: true,
    baseUrl: "http://localhost:11434/v1",
    models: [{ id: "qwen2.5-vl:7b" }],
    latencyMs: 42,
  });
  expect(probeLocalEngineMock).toHaveBeenCalledWith({ baseUrl: "http://localhost:11434" });
});

test("the discovery route answers 200 with a negative result when the daemon is unreachable", async () => {
  probeLocalEngineMock.mockResolvedValue({
    ok: false,
    baseUrl: "http://localhost:11434/v1",
    code: "LOCAL_UNREACHABLE",
    error: "Could not reach the local engine at http://localhost:11434/v1. Is the daemon running?",
  });

  const response = await localModelsRoute(new Request("http://localhost/api/translate/local-models", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baseUrl: "http://localhost:11434" }),
  }));

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: false, code: "LOCAL_UNREACHABLE" });
});

test("the discovery route rejects missing or invalid base URLs and cross-origin callers before probing", async () => {
  const missing = await localModelsRoute(new Request("http://localhost/api/translate/local-models", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baseUrl: "not a url" }),
  }));
  expect(missing.status).toBe(400);
  expect(await missing.json()).toMatchObject({ code: "INVALID_BASE_URL" });

  const forbidden = await localModelsRoute(new Request("http://localhost/api/translate/local-models", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://evil.example.com" },
    body: JSON.stringify({ baseUrl: "http://localhost:11434" }),
  }));
  expect(forbidden.status).toBe(403);
  expect(probeLocalEngineMock).not.toHaveBeenCalled();
});

test("when local model fails with multimodal unsupported error, it returns friendly message pointing to vision models", async () => {
  requestOpenAICompatibleMock.mockRejectedValue(
    new GeminiRequestError(
      "Multimodal data provided, but model does not support multimodal requests.",
      "GEMINI_UPSTREAM",
      400,
      false,
    ),
  );

  const response = await translateImage(
    imageRequest({
      modelPreference: { ...localPreference, model: "qwen2.5:7b" },
    }),
  );

  expect(response.status).toBe(400);
  const body = await response.json();
  expect(body.error).toContain("qwen2.5:7b");
  expect(body.error).toContain("โมเดลข้อความเท่านั้น");
  expect(body.error).toContain("qwen2.5vl:7b");
});

test("isVisionModelName correctly differentiates vision models from text-only models", () => {
  expect(isVisionModelName("qwen2.5vl:7b")).toBe(true);
  expect(isVisionModelName("qwen2.5-vl:7b")).toBe(true);
  expect(isVisionModelName("llama3.2-vision:11b")).toBe(true);
  expect(isVisionModelName("minicpm-v:8b")).toBe(true);
  expect(isVisionModelName("llava:7b")).toBe(true);
  expect(isVisionModelName("pixtral:12b")).toBe(true);

  expect(isVisionModelName("qwen2.5:7b")).toBe(false);
  expect(isVisionModelName("llama3:8b")).toBe(false);
  expect(isVisionModelName("mistral:7b")).toBe(false);
  expect(isVisionModelName("gemma2:9b")).toBe(false);
  expect(isVisionModelName("")).toBe(false);
});

test("the local image translation prompt requests speaker identification and preserves speaker in bubbles", async () => {
  requestOpenAICompatibleMock.mockResolvedValue({
    data: {
      choices: [
        {
          message: {
            content: '{"bubbles":[{"t":"ข้าไม่ยอมแพ้","box":[0,0,10,10],"speaker":"พระเอก"}]}',
          },
          finish_reason: "stop",
        },
      ],
    },
    model: "qwen2.5-vl:7b",
    meta: { provider: "openai_compatible", model: "qwen2.5-vl:7b", attemptCount: 1, elapsedMs: 5, fallbackCount: 0 },
  } as never);

  const response = await translateImage(imageRequest({ modelPreference: localPreference }));
  expect(response.status).toBe(200);
  const { text } = await response.json();
  const parsed = JSON.parse(text);
  expect(parsed.bubbles[0].speaker).toBe("พระเอก");

  expect(requestOpenAICompatibleMock).toHaveBeenCalledWith(
    expect.objectContaining({
      payload: expect.objectContaining({
        messages: [
          expect.objectContaining({
            content: expect.arrayContaining([
              expect.objectContaining({
                text: expect.stringContaining("Identify the speaker"),
              }),
            ]),
          }),
        ],
      }),
    }),
  );
});
