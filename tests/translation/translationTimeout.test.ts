import { describe, expect, it, vi } from "vitest";

import {
  GeminiRequestError,
  requestGeminiRoutes,
} from "@/lib/server/geminiRequest";
import { executeGeminiTranslation } from "@/lib/server/geminiTranslationRouter";
import { geminiCatalogManager } from "@/lib/server/geminiCatalog";

describe("Translation Timeout & Single Deadline Protection (PR-3)", () => {
  it("terminates with 504 GEMINI_TIMEOUT when headers arrive fast but response body hangs", async () => {
    let timerFired = false;

    // Simulate fetch: headers arrive immediately (200 OK), but response.json() hangs
    const fetchImpl: typeof fetch = vi.fn(async (_url: any, init: any) => {
      const signal = init?.signal as AbortSignal;
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => {
          return new Promise((resolve, reject) => {
            if (signal.aborted) {
              return reject(new DOMException("Aborted", "AbortError"));
            }
            signal.addEventListener("abort", () => {
              timerFired = true;
              reject(new DOMException("The operation was aborted due to timeout", "AbortError"));
            });
            // Body stream hangs indefinitely without resolving
          });
        },
      } as any;
    });

    const route = {
      model: "gemini-3.5-flash-lite",
      apiKey: "test-key",
      keyId: "slot-1",
      keyIndex: 0,
      keySlot: 1,
    };

    // Use a small attempt timeout (100ms) and budget (200ms)
    await expect(
      requestGeminiRoutes({
        routes: [route],
        payload: { contents: [] },
        attemptTimeoutMs: 100,
        totalBudgetMs: 200,
        fetchImpl,
      }),
    ).rejects.toThrowError(GeminiRequestError);

    expect(timerFired).toBe(true);

    try {
      await requestGeminiRoutes({
        routes: [route],
        payload: { contents: [] },
        attemptTimeoutMs: 100,
        totalBudgetMs: 200,
        fetchImpl,
      });
    } catch (err: any) {
      expect(err).toBeInstanceOf(GeminiRequestError);
      expect(err.code).toBe("GEMINI_TIMEOUT");
      expect(err.status).toBe(504);
      expect(err.retryable).toBe(true);
    }
  });

  it("deducts model discovery time from total budget and aborts when discovery exceeds budget", async () => {
    let simulatedTime = 1000;
    const now = () => simulatedTime;

    // Spy on geminiCatalogManager.getCatalog to simulate slow discovery (takes 45,000ms)
    vi.spyOn(geminiCatalogManager, "getCatalog").mockImplementation(async () => {
      simulatedTime += 45_000;
      return {
        pool: { id: "user", keys: [] },
        owner: "user",
        source: "live",
        stale: false,
        discoveredAt: simulatedTime,
        expiresAt: simulatedTime + 60_000,
        models: [
          {
            id: "gemini-3.5-flash-lite",
            displayName: "Flash Lite",
            description: "fast",
            releaseChannel: "stable",
            supportedWorkflows: ["image", "text"],
            compatibility: { text: "compatible", image: "compatible" },
            cooldownUntil: 0,
            availability: { "slot-1": "available" },
            failureCount: 0,
          },
        ],
      } as any;
    });

    vi.spyOn(geminiCatalogManager, "planRoutes").mockReturnValue([
      {
        model: "gemini-3.5-flash-lite",
        apiKey: "test-key",
        keyId: "slot-1",
        keyIndex: 0,
        keySlot: 1,
      },
    ]);

    const fetchImpl: typeof fetch = vi.fn(async () => {
      // If routes are called, check remaining budget
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          candidates: [{ content: { parts: [{ text: "ok" }] } }],
        }),
      } as any;
    });

    // Total budget is 40,000ms, but discovery took 45,000ms -> remaining <= 0!
    await expect(
      executeGeminiTranslation({
        workflow: "image",
        payload: { contents: [] },
        totalBudgetMs: 40_000,
        now,
        fetchImpl,
      }),
    ).rejects.toThrowError(GeminiRequestError);

    try {
      await executeGeminiTranslation({
        workflow: "image",
        payload: { contents: [] },
        totalBudgetMs: 40_000,
        now,
        fetchImpl,
      });
    } catch (err: any) {
      expect(err).toBeInstanceOf(GeminiRequestError);
      expect(err.code).toBe("GEMINI_TIMEOUT");
      expect(err.status).toBe(504);
    }
  });

  it("stops multi-round retries when total budget expires and never reports timeout as success", async () => {
    let simulatedTime = 1000;
    const now = () => simulatedTime;

    const routes = [
      { model: "model-1", apiKey: "key-1", keyId: "id-1", keyIndex: 0, keySlot: 1 },
      { model: "model-2", apiKey: "key-2", keyId: "id-2", keyIndex: 1, keySlot: 2 },
      { model: "model-3", apiKey: "key-3", keyId: "id-3", keyIndex: 2, keySlot: 3 },
    ];

    let callCount = 0;
    const fetchImpl: typeof fetch = vi.fn(async () => {
      callCount++;
      // Each request takes 15,000ms and returns 500
      simulatedTime += 15_000;
      return {
        ok: false,
        status: 500,
        headers: new Headers(),
        json: async () => ({ error: { message: "Internal server error" } }),
      } as any;
    });

    // Total budget is 25,000ms. Attempt 1 takes 15,000ms (remaining: 10,000ms).
    // Attempt 2 takes 15,000ms (exceeds total budget 25,000ms).
    await expect(
      requestGeminiRoutes({
        routes,
        payload: { contents: [] },
        attemptTimeoutMs: 20_000,
        totalBudgetMs: 25_000,
        now,
        fetchImpl,
        sleep: async (ms) => {
          simulatedTime += ms;
        },
      }),
    ).rejects.toThrowError(GeminiRequestError);

    try {
      await requestGeminiRoutes({
        routes,
        payload: { contents: [] },
        attemptTimeoutMs: 20_000,
        totalBudgetMs: 25_000,
        now,
        fetchImpl,
        sleep: async (ms) => {
          simulatedTime += ms;
        },
      });
    } catch (err: any) {
      expect(err).toBeInstanceOf(GeminiRequestError);
      expect(err.code).toBe("GEMINI_TIMEOUT");
      expect(err.status).toBe(504);
    }
  });

  it("accurately differentiates abort/timeout from upstream transport network errors", async () => {
    const route = {
      model: "gemini-3.5-flash-lite",
      apiKey: "test-key",
      keyId: "slot-1",
      keyIndex: 0,
      keySlot: 1,
    };

    let reportedFailureKind = "";
    // Case A: Connection refused (network error without abort)
    const networkFailFetch: typeof fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch: Connection refused");
    });

    await expect(
      requestGeminiRoutes({
        routes: [route],
        payload: {},
        fetchImpl: networkFailFetch,
        onRouteFailure: (_r, err) => {
          reportedFailureKind = err.code;
        },
      }),
    ).rejects.toThrow();

    expect(reportedFailureKind).toBe("GEMINI_UPSTREAM");

    // Case B: Abort due to timeout
    reportedFailureKind = "";
    const timeoutFetch: typeof fetch = vi.fn(async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    });

    await expect(
      requestGeminiRoutes({
        routes: [route],
        payload: {},
        fetchImpl: timeoutFetch,
        onRouteFailure: (_r, err) => {
          reportedFailureKind = err.code;
        },
      }),
    ).rejects.toThrow();

    expect(reportedFailureKind).toBe("GEMINI_TIMEOUT");
  });
});
