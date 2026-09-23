// @vitest-environment node
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  GeminiCatalogManager,
  GeminiRoutingError,
  geminiCatalogManager,
  resolveActiveGeminiKeyPool,
} from "@/lib/server/geminiCatalog";
import { executeGeminiTranslation } from "@/lib/server/geminiTranslationRouter";

function modelList(...ids: string[]): Response {
  return new Response(JSON.stringify({
    models: ids.map((id) => ({
      name: `models/${id}`,
      displayName: id,
      supportedGenerationMethods: ["generateContent"],
    })),
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function discoveryFetch(...models: string[]) {
  return vi.fn<typeof fetch>().mockImplementation(async () => modelList(...models));
}

const originalLimit = process.env.SUPERK_GEMINI_MAX_KEYS;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalLimit === undefined) delete process.env.SUPERK_GEMINI_MAX_KEYS;
  else process.env.SUPERK_GEMINI_MAX_KEYS = originalLimit;
});

describe("health-aware Gemini routing", () => {
  test("workflow-rejected HTTP success does not become Last-known-good evidence", async () => {
    const pool = resolveActiveGeminiKeyPool("secret-a");
    const route = {
      model: "gemini-a", apiKey: "secret-a", keyId: pool.keys[0].id,
      keyIndex: 0, keySlot: 1, keyOwner: "user" as const,
    };
    const catalog = {
      pool,
      snapshot: {
        poolId: pool.id, owner: pool.owner, models: [], keys: [],
        source: "live" as const, stale: false, discoveredAt: 0, expiresAt: 1,
      },
    };
    vi.spyOn(geminiCatalogManager, "getCatalog").mockResolvedValue(catalog);
    vi.spyOn(geminiCatalogManager, "planRoutes").mockReturnValue([route]);
    const recordSuccess = vi.spyOn(geminiCatalogManager, "recordSuccess").mockResolvedValue();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      promptFeedback: { blockReason: "SAFETY" },
    }));

    await executeGeminiTranslation({
      workflow: "image",
      userApiKeyRaw: "secret-a",
      payload: { contents: [] },
      fetchImpl,
      validateSuccess: (data) => !Boolean((data as { promptFeedback?: { blockReason?: string } }).promptFeedback?.blockReason),
    });

    expect(recordSuccess).not.toHaveBeenCalled();
  });

  test("discovery obeys its deadline even if catalog work ignores abort", async () => {
    vi.useFakeTimers();
    const discover = vi.spyOn(geminiCatalogManager, "getCatalog")
      .mockImplementation(() => new Promise(() => undefined));
    try {
      const request = executeGeminiTranslation({
        workflow: "image",
        userApiKeyRaw: "secret-a",
        payload: { contents: [] },
        totalBudgetMs: 1_000,
      });
      const outcome = expect(request).rejects.toMatchObject({
        code: "GEMINI_TIMEOUT",
      });
      await vi.advanceTimersByTimeAsync(1_000);
      await outcome;
      expect(discover).toHaveBeenCalledTimes(1);
    } finally {
      discover.mockRestore();
      vi.useRealTimers();
    }
  });

  test("Auto exhausts user-owned routes before server fallback even when server models sort first", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const key = new Headers(init?.headers).get("x-goog-api-key");
      return key === "user-key"
        ? modelList("gemini-z-user")
        : modelList("gemini-a-server");
    });
    const manager = new GeminiCatalogManager({ fetchImpl, persistPath: null });
    const catalog = await manager.getCatalog({
      userApiKeyRaw: "user-key",
      serverApiKeyRaw: "server-key",
      force: true,
    });
    await manager.recordSuccess(catalog, {
      workflow: "image",
      model: "gemini-a-server",
      keyId: catalog.pool.keys[1].id,
      elapsedMs: 100,
    });

    expect(manager.planRoutes(catalog, { workflow: "image" }).map((route) => [
      route.keyOwner,
      route.model,
    ])).toEqual([
      ["user", "gemini-z-user"],
      ["server", "gemini-a-server"],
    ]);
    expect(manager.planRoutes(catalog, {
      workflow: "image",
      modelPreference: "gemini-a-server",
    }).map((route) => route.model)).toEqual(["gemini-a-server"]);
  });

  test("effective pool prefers user credentials, appends server fallback, deduplicates, and honors configured cap", () => {
    process.env.SUPERK_GEMINI_MAX_KEYS = "4";
    const pool = resolveActiveGeminiKeyPool(
      "user-a,user-b,shared",
      "shared,server-a,server-b",
    );

    expect(pool.owner).toBe("mixed");
    expect(pool.keys.map((key) => [key.owner, key.apiKey])).toEqual([
      ["user", "user-a"],
      ["user", "user-b"],
      ["user", "shared"],
      ["server", "server-a"],
    ]);
  });

  test("quota cooldown removes only one route and all-route cooldown fails fast with retry timing", async () => {
    let now = 1_000;
    const manager = new GeminiCatalogManager({
      fetchImpl: discoveryFetch("gemini-a"),
      now: () => now,
      persistPath: null,
    });
    const catalog = await manager.getCatalog({
      userApiKeyRaw: "key-a,key-b",
      force: true,
    });
    const [first, second] = manager.planRoutes(catalog, {
      workflow: "image",
      modelPreference: "gemini-a",
    });

    await manager.recordFailure(catalog, {
      workflow: "image",
      model: "gemini-a",
      keyId: first.keyId,
      kind: "quota",
      retryAfterMs: 5_000,
    });

    expect(manager.planRoutes(catalog, {
      workflow: "image",
      modelPreference: "gemini-a",
    })).toEqual([
      expect.objectContaining({ keyId: second.keyId }),
    ]);
    expect(manager.getModelHealth(catalog, "gemini-a")).toMatchObject({
      status: "partial_quota",
      cooldownKeys: 1,
      nextRetryAt: 6_000,
    });

    await manager.recordFailure(catalog, {
      workflow: "image",
      model: "gemini-a",
      keyId: second.keyId,
      kind: "quota",
      retryAfterMs: 8_000,
    });

    expect(() => manager.planRoutes(catalog, {
      workflow: "image",
      modelPreference: "gemini-a",
    })).toThrow(expect.objectContaining({
      code: "GEMINI_ROUTE_COOLDOWN",
      retryAfterMs: 5_000,
      nextRetryAt: 6_000,
    }));

    now = 6_001;
    expect(manager.planRoutes(catalog, {
      workflow: "image",
      modelPreference: "gemini-a",
    })[0]).toMatchObject({ keyId: first.keyId });
  });

  test("model overload skips all keys, then allows one half-open recovery trial", async () => {
    let now = 10_000;
    const manager = new GeminiCatalogManager({
      fetchImpl: discoveryFetch("gemini-a", "gemini-b"),
      now: () => now,
      persistPath: null,
    });
    const catalog = await manager.getCatalog({
      userApiKeyRaw: "key-a,key-b",
      force: true,
    });
    const firstRoute = manager.planRoutes(catalog, {
      workflow: "image",
    })[0];

    await manager.recordFailure(catalog, {
      workflow: "image",
      model: firstRoute.model,
      keyId: firstRoute.keyId,
      kind: "overload",
    });

    const duringCooldown = manager.planRoutes(catalog, { workflow: "image" });
    expect(duringCooldown.every((route) => route.model !== firstRoute.model)).toBe(true);
    expect(manager.getModelHealth(catalog, firstRoute.model)).toMatchObject({
      status: "high_demand",
      overloadUntil: 40_000,
    });

    now = 40_001;
    const recoveryRoutes = manager.planRoutes(catalog, { workflow: "image" });
    const recovery = recoveryRoutes.find((route) => route.model === firstRoute.model);
    expect(recovery).toMatchObject({ recoveryTrial: true });
    expect(manager.claimRecoveryTrial(catalog.pool.id, firstRoute.model)).toBe(true);
    expect(manager.claimRecoveryTrial(catalog.pool.id, firstRoute.model)).toBe(false);

    const whileTrialRuns = manager.planRoutes(catalog, { workflow: "image" });
    expect(whileTrialRuns.every((route) => route.model !== firstRoute.model)).toBe(true);

    await manager.recordSuccess(catalog, {
      workflow: "image",
      model: firstRoute.model,
      keyId: recovery!.keyId,
      elapsedMs: 100,
    });
    expect(manager.getModelHealth(catalog, firstRoute.model).status).toBe("ready");
  });

  test("a transient recovery failure releases the trial without inventing model-wide overload", async () => {
    let now = 10_000;
    const manager = new GeminiCatalogManager({
      fetchImpl: discoveryFetch("gemini-a"),
      now: () => now,
      persistPath: null,
    });
    const catalog = await manager.getCatalog({ userApiKeyRaw: "key-a", force: true });
    const route = manager.planRoutes(catalog, { workflow: "image" })[0];
    await manager.recordFailure(catalog, {
      workflow: "image", model: route.model, keyId: route.keyId, kind: "overload",
    });
    now = 40_001;
    expect(manager.claimRecoveryTrial(catalog.pool.id, route.model)).toBe(true);

    await manager.recordFailure(catalog, {
      workflow: "image", model: route.model, keyId: route.keyId, kind: "transient",
    });

    expect(manager.getModelHealth(catalog, route.model)).toMatchObject({
      status: "recovery",
      overloadUntil: undefined,
      recoveryInFlight: false,
    });
    expect(manager.planRoutes(catalog, { workflow: "image" })[0].recoveryTrial).toBe(true);
  });

  test("fresh Last-known-good wins first, then expired preference yields to successful latency", async () => {
    let now = 100_000;
    const manager = new GeminiCatalogManager({
      fetchImpl: discoveryFetch("gemini-a", "gemini-b"),
      now: () => now,
      persistPath: null,
    });
    const catalog = await manager.getCatalog({
      userApiKeyRaw: "key-a",
      force: true,
    });
    const keyId = catalog.pool.keys[0].id;

    await manager.recordSuccess(catalog, {
      workflow: "image",
      model: "gemini-a",
      keyId,
      elapsedMs: 100,
    });
    now += 1_000;
    await manager.recordSuccess(catalog, {
      workflow: "image",
      model: "gemini-b",
      keyId,
      elapsedMs: 300,
    });

    expect(manager.planRoutes(catalog, { workflow: "image" })[0].model)
      .toBe("gemini-b");

    now += (24 * 60 * 60 * 1_000) + 1;
    expect(manager.planRoutes(catalog, { workflow: "image" })[0].model)
      .toBe("gemini-a");
  });

  test("manual overload is fail-fast with a retry opportunity and never substitutes another model", async () => {
    const now = 5_000;
    const manager = new GeminiCatalogManager({
      fetchImpl: discoveryFetch("gemini-a", "gemini-b"),
      now: () => now,
      persistPath: null,
    });
    const catalog = await manager.getCatalog({
      userApiKeyRaw: "key-a,key-b",
      force: true,
    });
    const route = manager.planRoutes(catalog, {
      workflow: "image",
      modelPreference: "gemini-a",
    })[0];

    await manager.recordFailure(catalog, {
      workflow: "image",
      model: "gemini-a",
      keyId: route.keyId,
      kind: "overload",
    });

    let thrown: unknown;
    try {
      manager.planRoutes(catalog, {
        workflow: "image",
        modelPreference: "gemini-a",
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GeminiRoutingError);
    expect(thrown).toMatchObject({
      code: "GEMINI_MODEL_OVERLOADED",
      model: "gemini-a",
      retryAfterMs: 30_000,
      nextRetryAt: 35_000,
    });
  });

  test("retry timing waits for both model overload and key quota cooldown", async () => {
    let now = 1_000;
    const manager = new GeminiCatalogManager({
      fetchImpl: discoveryFetch("gemini-a"),
      now: () => now,
      persistPath: null,
    });
    const catalog = await manager.getCatalog({ userApiKeyRaw: "key-a", force: true });
    const route = manager.planRoutes(catalog, { workflow: "image" })[0];
    await manager.recordFailure(catalog, {
      workflow: "image", model: route.model, keyId: route.keyId, kind: "overload",
    });
    await manager.recordFailure(catalog, {
      workflow: "image", model: route.model, keyId: route.keyId, kind: "quota", retryAfterMs: 50_000,
    });

    expect(manager.getModelHealth(catalog, route.model).nextRetryAt).toBe(51_000);
    expect(() => manager.planRoutes(catalog, {
      workflow: "image", modelPreference: route.model,
    })).toThrow(expect.objectContaining({ nextRetryAt: 51_000, retryAfterMs: 50_000 }));
    now = 31_001;
    expect(() => manager.planRoutes(catalog, {
      workflow: "image", modelPreference: route.model,
    })).toThrow(expect.objectContaining({ nextRetryAt: 51_000 }));
  });
});
