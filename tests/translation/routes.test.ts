import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("@/lib/server/geminiRequest", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/server/geminiRequest")>();
  return {
    ...actual,
    requestGemini: vi.fn(),
  };
});

import {
  GeminiRequestError,
  requestGemini,
} from "@/lib/server/geminiRequest";
import { resetRateLimits } from "@/lib/server/rateLimiter";
import { POST as translateImage } from "@/src/app/api/translate/route";
import { POST as translateText } from "@/src/app/api/translate-text/route";
import { POST as validateGeminiKey } from "@/src/app/api/translate/validate-key/route";

const originalApiKey = process.env.GEMINI_API_KEY;
const requestGeminiMock = vi.mocked(requestGemini);

beforeEach(() => {
  vi.restoreAllMocks();
  requestGeminiMock.mockReset();
  resetRateLimits();
});

afterEach(() => {
  if (originalApiKey === undefined) {
    delete process.env.GEMINI_API_KEY;
  } else {
    process.env.GEMINI_API_KEY = originalApiKey;
  }
});

function timeoutError(): GeminiRequestError {
  return new GeminiRequestError(
    "Gemini ตอบสนองช้าเกินกำหนด กรุณาลองใหม่หรือเปลี่ยนโมเดล",
    "GEMINI_TIMEOUT",
    504,
    true,
  );
}

test("image route returns 504 for Gemini timeout", async () => {
  process.env.GEMINI_API_KEY = "server-key";
  requestGeminiMock.mockRejectedValue(timeoutError());
  vi.spyOn(globalThis, "fetch").mockRejectedValue(
    new TypeError("fetch failed"),
  );
  const request = new Request("http://localhost/api/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      imageBase64: "valid-base64",
      mimeType: "image/png",
      targetLang: "Thai",
      modelPreference: "auto",
    }),
  });

  const response = await translateImage(request);
  const body = await response.json();

  expect(response.status).toBe(504);
  expect(body).toMatchObject({
    code: "GEMINI_TIMEOUT",
    retryable: true,
  });
  expect(body.error).not.toBe("Internal Server Error");
});

test("image route keeps the missing API key response", async () => {
  delete process.env.GEMINI_API_KEY;
  const request = new Request("http://localhost/api/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      imageBase64: "valid-base64",
      mimeType: "image/png",
      targetLang: "Thai",
    }),
  });

  const response = await translateImage(request);
  const body = await response.json();

  expect(response.status).toBe(500);
  expect(body.error).toContain("Server missing API Key");
  expect(requestGeminiMock).not.toHaveBeenCalled();
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

test("image route rejects an oversized request before reading or forwarding it", async () => {
  process.env.GEMINI_API_KEY = "server-key";
  const request = new Request("http://localhost/api/translate", {
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
  });

  const response = await translateImage(request);

  expect(response.status).toBe(413);
  expect(requestGeminiMock).not.toHaveBeenCalled();
});

test("image route rejects unsupported image MIME types", async () => {
  process.env.GEMINI_API_KEY = "server-key";
  const request = new Request("http://localhost/api/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      imageBase64: "valid-base64",
      mimeType: "text/html",
      targetLang: "Thai",
    }),
  });

  const response = await translateImage(request);

  expect(response.status).toBe(415);
  expect(requestGeminiMock).not.toHaveBeenCalled();
});

test("text route returns 504 for Gemini timeout", async () => {
  process.env.GEMINI_API_KEY = "server-key";
  requestGeminiMock.mockRejectedValue(timeoutError());
  vi.spyOn(globalThis, "fetch").mockRejectedValue(
    new TypeError("fetch failed"),
  );
  const request = new Request("http://localhost/api/translate-text", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      bubbles: [{ t: "hello", box: [0, 0, 100, 100] }],
      targetLang: "Thai",
      modelPreference: "auto",
    }),
  });

  const response = await translateText(request);
  const body = await response.json();

  expect(response.status).toBe(504);
  expect(body).toMatchObject({
    code: "GEMINI_TIMEOUT",
    retryable: true,
  });
  expect(body.error).not.toBe("Internal Server Error");
});

test("image prompt translates story text and excludes interface labels", async () => {
  process.env.GEMINI_API_KEY = "server-key";
  requestGeminiMock.mockResolvedValue({
    data: {
      candidates: [
        {
          content: { parts: [{ text: '{"bubbles":[]}' }] },
        },
      ],
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
  const request = new Request("http://localhost/api/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      imageBase64: "valid-base64",
      mimeType: "image/png",
      targetLang: "Thai",
    }),
  });

  const response = await translateImage(request);
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
  expect(prompt).toContain(
    "Narration may appear without a speech bubble",
  );
  expect(prompt).not.toContain("MUST include ALL dialogue blocks");
  expect(prompt).not.toContain("Force extraction");
  expect(prompt).not.toContain("large red text");
});

test("image route supports custom translation policy (sfx: translate)", async () => {
  process.env.GEMINI_API_KEY = "server-key";
  requestGeminiMock.mockResolvedValue({
    data: {
      candidates: [
        {
          content: { parts: [{ text: '{"bubbles":[]}' }] },
        },
      ],
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
  const request = new Request("http://localhost/api/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      imageBase64: "valid-base64",
      mimeType: "image/png",
      targetLang: "Thai",
      policy: { sfx: "translate" },
    }),
  });

  const response = await translateImage(request);
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
      candidates: [
        {
          content: { parts: [{ text: '{"bubbles":[]}' }] },
        },
      ],
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
  const request = new Request("http://localhost/api/translate-text", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      bubbles: [{ t: "hello", box: [0, 0, 100, 100] }],
      targetLang: "Thai",
      policy: { sfx: "ignore" },
    }),
  });

  const response = await translateText(request);
  expect(response.status).toBe(200);

  const options = requestGeminiMock.mock.calls[0][0];
  const payload = options.payload as {
    contents: Array<{ parts: Array<{ text?: string }> }>;
  };
  const prompt = payload.contents[0].parts[0].text ?? "";

  expect(prompt).toContain("IGNORE all Sound Effects (SFX). Do NOT translate them.");
  expect(prompt).not.toContain("Translate Sound Effects (SFX) and wrap them in asterisks");
});
