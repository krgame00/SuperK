import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("@/lib/server/geminiRequest", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/server/geminiRequest")>();
  return {
    ...actual,
    requestGemini: vi.fn(),
  };
});

vi.mock("@/lib/server/geminiTranslationRouter", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/server/geminiTranslationRouter")>();
  return {
    ...actual,
    executeGeminiTranslation: vi.fn(),
  };
});

import { GeminiRoutingError } from "@/lib/server/geminiCatalog";
import {
  GeminiRequestError,
  requestGemini,
} from "@/lib/server/geminiRequest";
import { executeGeminiTranslation } from "@/lib/server/geminiTranslationRouter";
import { POST as translateImage } from "@/src/app/api/translate/route";
import { POST as translateText } from "@/src/app/api/translate-text/route";
import { POST as validateGeminiKey } from "@/src/app/api/translate/validate-key/route";
import { POST as syncExtensionSettings, _resetSettingsForTest } from "@/src/app/api/extension/settings/handler";
import { getOrCreatePairingToken } from "@/lib/server/pairing";
import { NextRequest } from "next/server";

const originalApiKey = process.env.GEMINI_API_KEY;
const originalImageRouter = process.env.SUPERK_GEMINI_IMAGE_ROUTER;
const requestGeminiMock = vi.mocked(requestGemini);
const executeGeminiTranslationMock = vi.mocked(executeGeminiTranslation);

beforeEach(() => {
  vi.restoreAllMocks();
  requestGeminiMock.mockReset();
  executeGeminiTranslationMock.mockReset();
  _resetSettingsForTest();
});

afterEach(() => {
  _resetSettingsForTest();
  if (originalApiKey === undefined) {
    delete process.env.GEMINI_API_KEY;
  } else {
    process.env.GEMINI_API_KEY = originalApiKey;
  }
  if (originalImageRouter === undefined) delete process.env.SUPERK_GEMINI_IMAGE_ROUTER;
  else process.env.SUPERK_GEMINI_IMAGE_ROUTER = originalImageRouter;
});

function timeoutError(): GeminiRequestError {
  return new GeminiRequestError(
    "Gemini ตอบสนองช้าเกินกำหนด กรุณาลองใหม่หรือเปลี่ยนโมเดล",
    "GEMINI_TIMEOUT",
    504,
    true,
  );
}

function imageSuccess(model = "gemini-test-model") {
  return {
    data: {
      candidates: [{ content: { parts: [{ text: '{"bubbles":[]}' }] } }],
    },
    keyIndex: 0,
    keyId: "key-safe",
    keySlot: 1,
    model,
    meta: {
      provider: "gemini" as const,
      model,
      keyId: "key-safe",
      keySlot: 1,
      keyOwner: "user" as const,
      attemptCount: 1,
      elapsedMs: 10,
      fallbackCount: 0,
      skippedRouteCount: 0,
    },
  };
}

test.each(["null", "[]", "\"text\"", "{"])("image route rejects invalid JSON object payload: %s", async (body) => {
  const response = await translateImage(new Request("http://localhost/api/translate", {
    method: "POST", headers: { "content-type": "application/json" }, body,
  }));
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: "INVALID_REQUEST" });
  expect(requestGeminiMock).not.toHaveBeenCalled();
  expect(executeGeminiTranslationMock).not.toHaveBeenCalled();
});

test("image route passes cancellation to default fixed routing and opt-in dynamic routing", async () => {
  delete process.env.SUPERK_GEMINI_IMAGE_ROUTER;
  process.env.GEMINI_API_KEY = "server-key";
  requestGeminiMock.mockResolvedValue(imageSuccess());
  const fixedController = new AbortController();
  const fixedResponse = await translateImage(new Request("http://localhost/api/translate", {
    method: "POST", signal: fixedController.signal, headers: { "content-type": "application/json" },
    body: JSON.stringify({ imageBase64: "test", mimeType: "image/png" }),
  }));
  expect(fixedResponse.status).toBe(200);
  const fixedSignal = (requestGeminiMock.mock.calls[0][0] as { signal?: AbortSignal }).signal;
  fixedController.abort();
  expect(fixedSignal?.aborted).toBe(true);

  process.env.SUPERK_GEMINI_IMAGE_ROUTER = "dynamic";
  executeGeminiTranslationMock.mockResolvedValue(imageSuccess());
  const controller = new AbortController();
  const response = await translateImage(new Request("http://localhost/api/translate", {
    method: "POST", signal: controller.signal, headers: { "content-type": "application/json" },
    body: JSON.stringify({ imageBase64: "test", mimeType: "image/png" }),
  }));
  expect(response.status).toBe(200);
  const receivedSignal = (executeGeminiTranslationMock.mock.calls[0][0] as { signal?: AbortSignal }).signal;
  controller.abort();
  expect(receivedSignal?.aborted).toBe(true);
});

test.each([
  { targetLang: 42 }, { sourceLang: [] }, { modelPreference: {} },
  { apiKey: [] }, { context: true }, { isRetry: "yes" },
  { allowPreview: "yes" }, { policy: "text" }, { glossary: {} },
])("image route rejects invalid optional fields: %j", async (fields) => {
  const response = await translateImage(new Request("http://localhost/api/translate", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ imageBase64: "test", mimeType: "image/png", ...fields }),
  }));
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: "INVALID_REQUEST" });
  expect(executeGeminiTranslationMock).not.toHaveBeenCalled();
});

test("image route returns 504 for Gemini timeout", async () => {
  process.env.GEMINI_API_KEY = "server-key";
  requestGeminiMock.mockRejectedValue(timeoutError());

  const response = await translateImage(new Request("http://localhost/api/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      imageBase64: "valid-base64",
      mimeType: "image/png",
      targetLang: "Thai",
      modelPreference: "auto",
    }),
  }));
  const body = await response.json();

  expect(response.status).toBe(504);
  expect(body).toMatchObject({
    code: "GEMINI_TIMEOUT",
    retryable: true,
  });
  expect(body.error).not.toBe("Internal Server Error");
});

test("image route Auto uses shared health-aware routing with a 60 second budget when SUPERK_GEMINI_IMAGE_ROUTER=dynamic", async () => {
  process.env.SUPERK_GEMINI_IMAGE_ROUTER = "dynamic";
  process.env.GEMINI_API_KEY = "server-key-a,server-key-b";
  executeGeminiTranslationMock.mockResolvedValue(imageSuccess());

  const response = await translateImage(new Request("http://localhost/api/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      imageBase64: "valid-base64",
      mimeType: "image/png",
      targetLang: "Thai",
      modelPreference: "auto",
      allowPreview: true,
    }),
  }));

  expect(response.status).toBe(200);
  expect(executeGeminiTranslationMock).toHaveBeenCalledWith(
    expect.objectContaining({
      workflow: "image",
      serverApiKeyRaw: "server-key-a,server-key-b",
      modelPreference: "auto",
      allowPreview: true,
      attemptTimeoutMs: 25_000,
      totalBudgetMs: 60_000,
    }),
  );
  expect(requestGeminiMock).not.toHaveBeenCalled();
  expect(await response.json()).toMatchObject({
    meta: expect.objectContaining({
      model: "gemini-test-model",
      elapsedMs: 10,
      fallbackCount: 0,
    }),
  });
});

test("streamed image route sends model-switch progress before the final result", async () => {
  process.env.SUPERK_GEMINI_IMAGE_ROUTER = "dynamic";
  process.env.GEMINI_API_KEY = "server-key";
  executeGeminiTranslationMock.mockImplementation(async (options) => {
    options.onModelSwitch?.({ model: "gemini-next", fallbackCount: 1 });
    return imageSuccess("gemini-next");
  });

  const response = await translateImage(new Request("http://localhost/api/translate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/x-ndjson",
    },
    body: JSON.stringify({
      imageBase64: "valid-base64",
      mimeType: "image/png",
      modelPreference: "auto",
    }),
  }));
  const lines = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));

  expect(response.headers.get("content-type")).toContain("application/x-ndjson");
  expect(lines).toEqual([
    { type: "model-switch", model: "gemini-next", fallbackCount: 1 },
    { type: "result", status: 200, data: { text: '{"bubbles":[]}', meta: expect.objectContaining({ model: "gemini-next" }) } },
  ]);
});

test("fixed image-router is the default production baseline and prioritizes user keys", async () => {
  delete process.env.SUPERK_GEMINI_IMAGE_ROUTER;
  process.env.GEMINI_API_KEY = "server-key";
  requestGeminiMock.mockResolvedValue(imageSuccess("gemini-3.8-flash"));

  const response = await translateImage(new Request("http://localhost/api/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      imageBase64: "valid-base64",
      mimeType: "image/png",
      modelPreference: "auto",
      apiKey: "user-key",
    }),
  }));

  expect(response.status).toBe(200);
  expect(requestGeminiMock).toHaveBeenCalledWith(expect.objectContaining({
    apiKeys: ["user-key", "server-key"],
    initialKeyIndex: 0,
    models: expect.arrayContaining(["gemini-3.8-flash"]),
  }));
  expect(executeGeminiTranslationMock).not.toHaveBeenCalled();
});

test("fixed rollback splits and deduplicates comma-separated server credentials", async () => {
  process.env.SUPERK_GEMINI_IMAGE_ROUTER = "fixed";
  process.env.GEMINI_API_KEY = "server-one,server-two,server-one";
  requestGeminiMock.mockResolvedValue(imageSuccess());
  await translateImage(new Request("http://localhost/api/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      imageBase64: "valid-base64",
      mimeType: "image/png",
      modelPreference: "auto",
      apiKey: "user-one,server-two",
    }),
  }));
  expect(requestGeminiMock).toHaveBeenCalledWith(expect.objectContaining({
    apiKeys: ["user-one", "server-two", "server-one"],
  }));
});

test("fixed rollback redacts credentials echoed by an upstream error", async () => {
  process.env.SUPERK_GEMINI_IMAGE_ROUTER = "fixed";
  process.env.GEMINI_API_KEY = "server-secret";
  requestGeminiMock.mockRejectedValue(new GeminiRequestError(
    "Gemini rejected user-secret and server-secret",
    "GEMINI_UPSTREAM",
    502,
    true,
  ));
  const response = await translateImage(new Request("http://localhost/api/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      imageBase64: "valid-base64",
      mimeType: "image/png",
      apiKey: "user-secret",
    }),
  }));
  const body = await response.text();
  expect(response.status).toBe(502);
  expect(body).not.toContain("user-secret");
  expect(body).not.toContain("server-secret");
});

test("image route keeps user and server credential ownership inputs separate in dynamic mode", async () => {
  process.env.SUPERK_GEMINI_IMAGE_ROUTER = "dynamic";
  process.env.GEMINI_API_KEY = "server-key,shared-key";
  executeGeminiTranslationMock.mockResolvedValue(imageSuccess());

  const response = await translateImage(new Request("http://localhost/api/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      imageBase64: "valid-base64",
      mimeType: "image/png",
      targetLang: "Thai",
      modelPreference: "auto",
      apiKey: "user-key;shared-key",
    }),
  }));

  expect(response.status).toBe(200);
  expect(executeGeminiTranslationMock).toHaveBeenCalledWith(
    expect.objectContaining({
      userApiKeyRaw: "user-key;shared-key",
      serverApiKeyRaw: "server-key,shared-key",
    }),
  );
  expect(requestGeminiMock).not.toHaveBeenCalled();
});

test("image route returns structured missing-key routing failure", async () => {
  delete process.env.GEMINI_API_KEY;

  const response = await translateImage(new Request("http://localhost/api/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      imageBase64: "valid-base64",
      mimeType: "image/png",
      targetLang: "Thai",
    }),
  }));
  const body = await response.json();

  expect(response.status).toBe(500);
  expect(body).toMatchObject({
    code: "GEMINI_API_KEY_MISSING",
    error: expect.stringContaining("API Key"),
  });
  expect(requestGeminiMock).not.toHaveBeenCalled();
});

test("image route propagates fail-fast retry timing from the shared router", async () => {
  process.env.SUPERK_GEMINI_IMAGE_ROUTER = "dynamic";
  process.env.GEMINI_API_KEY = "server-key";
  executeGeminiTranslationMock.mockRejectedValue(
    new GeminiRoutingError(
      "No eligible Gemini route is available",
      "GEMINI_ROUTE_COOLDOWN",
      undefined,
      12_000,
      42_000,
    ),
  );

  const response = await translateImage(new Request("http://localhost/api/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      imageBase64: "valid-base64",
      mimeType: "image/png",
      targetLang: "Thai",
    }),
  }));

  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({
    code: "GEMINI_ROUTE_COOLDOWN",
    retryable: true,
    retryAfterMs: 12_000,
    nextRetryAt: 42_000,
  });
});

test("API key validation accepts a working Gemini key", async () => {
  requestGeminiMock.mockResolvedValue({
    data: { candidates: [{ content: { parts: [{ text: "OK" }] } }] },
    keyIndex: 0,
    model: "gemini-2.5-flash-lite",
    meta: {
      provider: "gemini",
      model: "gemini-2.5-flash-lite",
      attemptCount: 1,
      elapsedMs: 10,
      fallbackCount: 0,
    },
  });
  const response = await validateGeminiKey(new Request("http://localhost/api/translate/validate-key", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apiKey: "good-key" }),
  }));

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ valid: true });
  expect(requestGeminiMock).toHaveBeenCalledWith(
    expect.objectContaining({ apiKeys: ["good-key"] }),
  );
});

test("API key validation keeps a quota-limited but valid key usable", async () => {
  requestGeminiMock.mockRejectedValue(
    new GeminiRequestError("quota", "GEMINI_QUOTA", 429, true, 5_000),
  );
  const response = await validateGeminiKey(new Request("http://localhost/api/translate/validate-key", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apiKey: "quota-key" }),
  }));

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    valid: true,
    message: expect.stringContaining("โควต้า"),
  });
});

test("API key validation rejects an unauthorized key", async () => {
  requestGeminiMock.mockRejectedValue(
    new GeminiRequestError("invalid key", "GEMINI_UPSTREAM", 403, false),
  );
  const response = await validateGeminiKey(new Request("http://localhost/api/translate/validate-key", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apiKey: "bad-key" }),
  }));

  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({
    valid: false,
    message: expect.stringContaining("API Key ใช้งานไม่ได้"),
  });
});

test("image route rejects an oversized request before forwarding it", async () => {
  process.env.GEMINI_API_KEY = "server-key";
  const response = await translateImage(new Request("http://localhost/api/translate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(100 * 1024 * 1024),
    },
    body: JSON.stringify({
      imageBase64: "valid-base64",
      mimeType: "image/png",
      targetLang: "Thai",
    }),
  }));

  expect(response.status).toBe(413);
  expect(executeGeminiTranslationMock).not.toHaveBeenCalled();
});

test("image route rejects unsupported image MIME types", async () => {
  process.env.GEMINI_API_KEY = "server-key";
  const response = await translateImage(new Request("http://localhost/api/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      imageBase64: "valid-base64",
      mimeType: "text/html",
      targetLang: "Thai",
    }),
  }));

  expect(response.status).toBe(415);
  expect(executeGeminiTranslationMock).not.toHaveBeenCalled();
});

test("text route returns 504 for Gemini timeout", async () => {
  process.env.GEMINI_API_KEY = "server-key";
  requestGeminiMock.mockRejectedValue(timeoutError());
  const response = await translateText(new Request("http://localhost/api/translate-text", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      bubbles: [{ t: "hello", box: [0, 0, 100, 100] }],
      targetLang: "Thai",
      modelPreference: "auto",
    }),
  }));
  const body = await response.json();

  expect(response.status).toBe(504);
  expect(body).toMatchObject({
    code: "GEMINI_TIMEOUT",
    retryable: true,
  });
});

test("image prompt translates story text and excludes interface labels", async () => {
  process.env.GEMINI_API_KEY = "server-key";
  requestGeminiMock.mockResolvedValue(imageSuccess());

  const response = await translateImage(new Request("http://localhost/api/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      imageBase64: "valid-base64",
      mimeType: "image/png",
      targetLang: "Thai",
    }),
  }));
  expect(response.status).toBe(200);

  const options = requestGeminiMock.mock.calls[0][0];
  const payload = options.payload as {
    contents: Array<{ parts: Array<{ text?: string }> }>;
  };
  const prompt = payload.contents[0].parts[0].text ?? "";

  expect(prompt).toContain("dialogue, thoughts, and narration");
  expect(prompt).toContain("IGNORE interface text");
  expect(prompt).toContain("HUD");
  expect(prompt).toContain("watermarks");
  expect(prompt).toContain("styleCategory: dialogue, narration, or sfx");
  expect(prompt).toContain('"styleCategory":"dialogue"');
  expect(prompt).toContain("Narration may appear without a speech bubble");
  expect(prompt).not.toContain("MUST include ALL dialogue blocks");
  expect(prompt).not.toContain("Force extraction");
  expect(prompt).not.toContain("large red text");
});

test("image route supports custom translation policy (sfx: translate)", async () => {
  process.env.GEMINI_API_KEY = "server-key";
  requestGeminiMock.mockResolvedValue(imageSuccess());

  const response = await translateImage(new Request("http://localhost/api/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      imageBase64: "valid-base64",
      mimeType: "image/png",
      targetLang: "Thai",
      policy: { sfx: "translate" },
    }),
  }));
  expect(response.status).toBe(200);

  const options = requestGeminiMock.mock.calls[0][0];
  const payload = options.payload as {
    contents: Array<{ parts: Array<{ text?: string }> }>;
  };
  const prompt = payload.contents[0].parts[0].text ?? "";

  expect(prompt).toContain("Translate Sound Effects (SFX) and wrap them in asterisks");
  expect(prompt).not.toContain("IGNORE all Sound Effects (SFX)");
});

test("text route supports custom translation policy (sfx: ignore)", async () => {
  process.env.GEMINI_API_KEY = "server-key";
  requestGeminiMock.mockResolvedValue({
    data: {
      candidates: [{ content: { parts: [{ text: '{"bubbles":[]}' }] } }],
    },
    keyIndex: 0,
    model: "test-model",
    meta: {
      provider: "gemini",
      model: "test-model",
      attemptCount: 1,
      elapsedMs: 100,
      fallbackCount: 0,
    },
  });

  const response = await translateText(new Request("http://localhost/api/translate-text", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      bubbles: [{ t: "hello", box: [0, 0, 100, 100] }],
      targetLang: "Thai",
      policy: { sfx: "ignore" },
    }),
  }));
  expect(response.status).toBe(200);

  const options = requestGeminiMock.mock.calls[0][0];
  const payload = options.payload as {
    contents: Array<{ parts: Array<{ text?: string }> }>;
  };
  const prompt = payload.contents[0].parts[0].text ?? "";

  expect(prompt).toContain("IGNORE all Sound Effects (SFX). Do NOT translate them.");
  expect(prompt).not.toContain("Translate Sound Effects (SFX) and wrap them in asterisks");
});

test("fixed image route advances initialKeyIndex round-robin and uses 15s timeout", async () => {
  process.env.SUPERK_GEMINI_IMAGE_ROUTER = "fixed";
  process.env.GEMINI_API_KEY = "key-0,key-1,key-2";
  requestGeminiMock.mockResolvedValue(imageSuccess());

  const makeReq = () =>
    translateImage(
      new Request("http://localhost/api/translate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          imageBase64: "valid-base64",
          mimeType: "image/png",
          modelPreference: "auto",
        }),
      }),
    );

  await makeReq();
  const firstCall = requestGeminiMock.mock.calls[0][0];
  expect(firstCall.attemptTimeoutMs).toBe(15_000);
  const firstKeyIndex = firstCall.initialKeyIndex ?? 0;

  await makeReq();
  const secondCall = requestGeminiMock.mock.calls[1][0];
  expect(secondCall.attemptTimeoutMs).toBe(15_000);
  expect(secondCall.initialKeyIndex).toBe((firstKeyIndex + 1) % 3);
});

test("text route advances initialKeyIndex round-robin and uses 15s timeout", async () => {
  process.env.GEMINI_API_KEY = "key-0,key-1,key-2";
  requestGeminiMock.mockResolvedValue({
    data: {
      candidates: [{ content: { parts: [{ text: '{"bubbles":[]}' }] } }],
    },
    keyIndex: 0,
    model: "test-model",
    meta: {
      provider: "gemini",
      model: "test-model",
      attemptCount: 1,
      elapsedMs: 100,
      fallbackCount: 0,
    },
  });

  const makeReq = () =>
    translateText(
      new Request("http://localhost/api/translate-text", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bubbles: [{ t: "hello", box: [0, 0, 100, 100] }],
          targetLang: "Thai",
        }),
      }),
    );

  await makeReq();
  const firstCall = requestGeminiMock.mock.calls[0][0];
  expect(firstCall.attemptTimeoutMs).toBe(15_000);
  const firstKeyIndex = firstCall.initialKeyIndex ?? 0;

  await makeReq();
  const secondCall = requestGeminiMock.mock.calls[1][0];
  expect(secondCall.attemptTimeoutMs).toBe(15_000);
  expect(secondCall.initialKeyIndex).toBe((firstKeyIndex + 1) % 3);
});

test("image route keeps initialKeyIndex within user-supplied keys across repeated requests before falling back to server keys", async () => {
  delete process.env.SUPERK_GEMINI_IMAGE_ROUTER;
  process.env.GEMINI_API_KEY = "server-0,server-1";
  requestGeminiMock.mockResolvedValue(imageSuccess());

  for (let i = 0; i < 3; i++) {
    await translateImage(
      new Request("http://localhost/api/translate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          imageBase64: "valid-base64",
          mimeType: "image/png",
          apiKey: "user-only-key",
        }),
      }),
    );
  }

  for (const [call] of requestGeminiMock.mock.calls) {
    expect(call.apiKeys).toEqual(["user-only-key", "server-0", "server-1"]);
    expect(call.initialKeyIndex).toBe(0);
  }
});

test("image route falls back to synced extension settings API key and glossary when omitted in request body", async () => {
  delete process.env.SUPERK_GEMINI_IMAGE_ROUTER;
  delete process.env.GEMINI_API_KEY;
  requestGeminiMock.mockResolvedValue(imageSuccess());

  const token = getOrCreatePairingToken();
  await syncExtensionSettings(
    new NextRequest("http://127.0.0.1:3000/api/extension/settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        geminiApiKey: "synced-web-key",
        glossary: [{ original: "Furina", translation: "ฟูริน่า" }],
      }),
    }),
  );

  const response = await translateImage(
    new Request("http://localhost/api/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        imageBase64: "valid-base64",
        mimeType: "image/png",
        apiKey: "",
      }),
    }),
  );

  expect(response.status).toBe(200);
  const call = requestGeminiMock.mock.calls[0][0];
  expect(call.apiKeys).toEqual(["synced-web-key"]);
  const payload = call.payload as {
    contents: Array<{ parts: Array<{ text?: string }> }>;
  };
  const prompt = payload.contents[0].parts[0].text ?? "";
  expect(prompt).toContain("Furina");
  expect(prompt).toContain("ฟูริน่า");
});

