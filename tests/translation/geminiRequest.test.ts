import { describe, expect, test, vi } from "vitest";

import {
  GeminiRequestError,
  requestGemini,
  requestOpenAICompatible,
} from "@/lib/server/geminiRequest";

const successBody = {
  candidates: [
    {
      content: {
        parts: [{ text: '{"bubbles":[]}' }],
      },
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted", "AbortError");
}

describe("requestGemini", () => {
  test("transport timeout moves to the next model", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(abortError())
      .mockResolvedValueOnce(jsonResponse(successBody));

    const result = await requestGemini({
      apiKeys: ["key-a"],
      models: ["model-a", "model-b"],
      payload: { contents: [] },
      fetchImpl,
    });

    expect(result.model).toBe("model-b");
    expect(String(fetchImpl.mock.calls[1][0])).toContain(
      "/models/model-b:generateContent",
    );
  });

  test("429 rotates to the next API key on the same model", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: "quota" } }, 429),
      )
      .mockResolvedValueOnce(jsonResponse(successBody));

    const result = await requestGemini({
      apiKeys: ["key-a", "key-b"],
      models: ["model-a"],
      payload: { contents: [] },
      fetchImpl,
    });

    expect(result.keyIndex).toBe(1);
    expect(String(fetchImpl.mock.calls[0][0])).toContain("key=key-a");
    expect(String(fetchImpl.mock.calls[1][0])).toContain("key=key-b");
    expect(fetchImpl.mock.calls.every(([url]) =>
      String(url).includes("/models/model-a:generateContent"),
    )).toBe(true);
  });

  test("503 retries once before moving to the next model", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: "busy" } }, 503),
      )
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: "still busy" } }, 503),
      )
      .mockResolvedValueOnce(jsonResponse(successBody));

    const result = await requestGemini({
      apiKeys: ["key-a"],
      models: ["model-a", "model-b"],
      payload: { contents: [] },
      fetchImpl,
      sleep: async () => undefined,
    });

    expect(result.model).toBe("model-b");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(String(fetchImpl.mock.calls[0][0])).toContain(
      "/models/model-a:generateContent",
    );
    expect(String(fetchImpl.mock.calls[1][0])).toContain(
      "/models/model-a:generateContent",
    );
    expect(String(fetchImpl.mock.calls[2][0])).toContain(
      "/models/model-b:generateContent",
    );
  });

  test("all transport attempts return a structured timeout error", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(abortError());

    const operation = requestGemini({
      apiKeys: ["key-a"],
      models: ["model-a", "model-b"],
      payload: { contents: [] },
      fetchImpl,
    });

    await expect(operation).rejects.toMatchObject({
      code: "GEMINI_TIMEOUT",
      status: 504,
      retryable: true,
    });
    await expect(operation).rejects.not.toThrow("Internal Server Error");
  });

  test("one explicit model never falls back to another model", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(abortError());

    await expect(
      requestGemini({
        apiKeys: ["key-a"],
        models: ["chosen-model"],
        payload: { contents: [] },
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(GeminiRequestError);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toContain(
      "/models/chosen-model:generateContent",
    );
  });

  test("the runner never starts an attempt after the total budget", async () => {
    let now = 0;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      now = 90_000;
      throw abortError();
    });

    await expect(
      requestGemini({
        apiKeys: ["key-a"],
        models: ["model-a", "model-b"],
        payload: { contents: [] },
        fetchImpl,
        now: () => now,
        totalBudgetMs: 90_000,
      }),
    ).rejects.toMatchObject({
      code: "GEMINI_TIMEOUT",
      status: 504,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("requestOpenAICompatible", () => {
  const openAiSuccessBody = {
    choices: [
      {
        message: {
          content: '{"bubbles":[]}',
        },
        finish_reason: "stop",
      },
    ],
  };

  test("retries on 429 rate limit and succeeds on recovery", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: "Rate limit exceeded" } }, 429),
      )
      .mockResolvedValueOnce(jsonResponse(openAiSuccessBody));

    const result = await requestOpenAICompatible({
      baseUrl: "http://localhost:20128/v1",
      apiKey: "test-key",
      model: "11asd",
      payload: { messages: [] },
      fetchImpl,
      sleep: async () => undefined,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.data).toEqual(openAiSuccessBody);
  });
});