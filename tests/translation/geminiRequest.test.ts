import { describe, expect, test, vi } from "vitest";

import {
  GeminiRequestError,
  requestGemini,
  requestGeminiRoutes,
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
    // The API key must travel in the x-goog-api-key header, never the URL
    const headerOf = (index: number): string => {
      const headers = fetchImpl.mock.calls[index][1]?.headers as Record<string, string>;
      return headers["x-goog-api-key"];
    };
    expect(headerOf(0)).toBe("key-a");
    expect(headerOf(1)).toBe("key-b");
    expect(
      fetchImpl.mock.calls.every(([url]) => !String(url).includes("key-a") && !String(url).includes("key-b")),
    ).toBe(true);
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

  test("route failures are reported per attempted model-key route", async () => {
    const onRouteFailure = vi.fn();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: { message: "quota" } }, 429))
      .mockResolvedValueOnce(jsonResponse({ error: { message: "unsupported input" } }, 400))
      .mockResolvedValueOnce(jsonResponse(successBody));

    await requestGeminiRoutes({
      routes: [
        { model: "model-a", apiKey: "secret-a", keyId: "key-aaa", keyIndex: 0, keySlot: 1 },
        { model: "model-a", apiKey: "secret-b", keyId: "key-bbb", keyIndex: 1, keySlot: 2 },
        { model: "model-b", apiKey: "secret-a", keyId: "key-aaa", keyIndex: 0, keySlot: 1 },
      ],
      payload: { contents: [] },
      fetchImpl,
      onRouteFailure,
    });

    expect(onRouteFailure).toHaveBeenNthCalledWith(1, expect.objectContaining({ model: "model-a", keyId: "key-aaa" }), expect.objectContaining({ status: 429 }));
    expect(onRouteFailure).toHaveBeenNthCalledWith(2, expect.objectContaining({ model: "model-a", keyId: "key-bbb" }), expect.objectContaining({ status: 400 }));
  });

  test("a model-wide capability failure skips the remaining keys for that model", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: { message: "model does not support this request" } }, 404))
      .mockResolvedValueOnce(jsonResponse(successBody));

    const result = await requestGeminiRoutes({
      routes: [
        { model: "model-a", apiKey: "secret-a", keyId: "key-aaa", keyIndex: 0, keySlot: 1 },
        { model: "model-a", apiKey: "secret-b", keyId: "key-bbb", keyIndex: 1, keySlot: 2 },
        { model: "model-b", apiKey: "secret-a", keyId: "key-aaa", keyIndex: 0, keySlot: 1 },
      ],
      payload: { contents: [] },
      fetchImpl,
      onRouteFailure: async (_route, error) => error.status === 404 ? "skip-model" : undefined,
    });

    expect(result.model).toBe("model-b");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[0][0])).toContain("/models/model-a:generateContent");
    expect(String(fetchImpl.mock.calls[1][0])).toContain("/models/model-b:generateContent");
  });

  test("explicit catalog routes preserve model-key order and return safe route diagnostics", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: { message: "quota" } }, 429))
      .mockResolvedValueOnce(jsonResponse(successBody));

    const result = await requestGeminiRoutes({
      routes: [
        { model: "model-a", apiKey: "secret-a", keyId: "key-aaa", keyIndex: 0, keySlot: 1 },
        { model: "model-a", apiKey: "secret-b", keyId: "key-bbb", keyIndex: 1, keySlot: 2 },
        { model: "model-b", apiKey: "secret-a", keyId: "key-aaa", keyIndex: 0, keySlot: 1 },
      ],
      payload: { contents: [] },
      fetchImpl,
    });

    expect(result).toMatchObject({ model: "model-a", keyIndex: 1, keyId: "key-bbb", keySlot: 2 });
    expect(result.meta).toMatchObject({ model: "model-a", keySlot: 2, attemptCount: 2, fallbackCount: 1 });
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringContaining("/models/model-a:generateContent"),
      expect.stringContaining("/models/model-a:generateContent"),
    ]);
    expect(JSON.stringify(result)).not.toContain("secret-a");
    expect(JSON.stringify(result)).not.toContain("secret-b");
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