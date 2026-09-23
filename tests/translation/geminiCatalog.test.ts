// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  GeminiCatalogManager,
  GeminiRoutingError,
} from "@/lib/server/geminiCatalog";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function modelsResponse(models: Array<Record<string, unknown>>, nextPageToken?: string) {
  return Response.json({ models, ...(nextPageToken ? { nextPageToken } : {}) });
}

function model(name: string, methods = ["generateContent"], extra: Record<string, unknown> = {}) {
  return {
    name: `models/${name}`,
    displayName: name,
    supportedGenerationMethods: methods,
    ...extra,
  };
}

describe("Gemini model catalog discovery", () => {
  test("user keys own the pool, discovery paginates each key, and the union keeps model-to-key availability", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      const headers = init?.headers as Record<string, string>;
      const key = headers["x-goog-api-key"];
      expect(url.searchParams.has("key")).toBe(false);

      if (key === "AIza-user-a-secret" && !url.searchParams.has("pageToken")) {
        return modelsResponse([
          model("gemini-stable-a"),
          model("gemma-4-26b-a4b-it"),
          model("nano-banana-pro-preview"),
          model("embedding-only", ["embedContent"]),
        ], "next-a");
      }
      if (key === "AIza-user-a-secret" && url.searchParams.get("pageToken") === "next-a") {
        return modelsResponse([model("gemini-shared")]);
      }
      if (key === "AIza-user-b-secret") {
        return modelsResponse([
          model("gemini-shared"),
          model("gemini-preview-x", ["generateContent"], { description: "Preview model" }),
        ]);
      }
      throw new Error(`unexpected key ${key}`);
    });

    const manager = new GeminiCatalogManager({ fetchImpl, persistPath: null, now: () => 1_000 });
    const result = await manager.getCatalog({
      userApiKeyRaw: "AIza-user-a-secret, AIza-user-b-secret",
      serverApiKeyRaw: "AIza-server-secret",
      force: true,
    });

    expect(result.pool.owner).toBe("mixed");
    expect(result.pool.keys).toHaveLength(3);
    expect(result.pool.keys.map((key) => [key.owner, key.apiKey])).toEqual([
      ["user", "AIza-user-a-secret"],
      ["user", "AIza-user-b-secret"],
      ["server", "AIza-server-secret"],
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(4);

    expect(result.snapshot.models.map((entry) => entry.id)).toEqual([
      "gemini-stable-a",
      "gemini-shared",
      "gemini-preview-x",
    ]);
    expect(result.snapshot.models.find((entry) => entry.id === "embedding-only")).toBeUndefined();
    expect(result.snapshot.models.find((entry) => entry.id === "gemma-4-26b-a4b-it")).toBeUndefined();
    expect(result.snapshot.models.find((entry) => entry.id === "nano-banana-pro-preview")).toBeUndefined();
    expect(result.snapshot.keys.map((key) => key.modelCount)).toEqual([2, 2, 0]);

    const shared = result.snapshot.models.find((entry) => entry.id === "gemini-shared");
    expect(shared).toMatchObject({ availabilityCount: 2, totalKeys: 3 });
    expect(shared?.keyIds).toEqual(
      result.pool.keys
        .filter((key) => key.owner === "user")
        .map((key) => key.id),
    );

    const preview = result.snapshot.models.find((entry) => entry.id === "gemini-preview-x");
    expect(preview?.releaseChannel).toBe("preview");

    const serialized = JSON.stringify(result.snapshot);
    expect(serialized).not.toContain("AIza-user-a-secret");
    expect(serialized).not.toContain("AIza-user-b-secret");
    expect(serialized).not.toContain("AIza-server-secret");
  });

  test("server keys are used only when the user pool is empty", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(modelsResponse([model("gemini-server")])) ;
    const manager = new GeminiCatalogManager({ fetchImpl, persistPath: null });

    const result = await manager.getCatalog({ userApiKeyRaw: "", serverApiKeyRaw: "server-a,server-b", force: true });

    expect(result.pool.owner).toBe("server");
    expect(result.pool.keys.map((key) => key.apiKey)).toEqual(["server-a", "server-b"]);
  });

  test("key validation succeeds from model discovery without generating content and distinguishes unauthorized keys", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const key = (init?.headers as Record<string, string>)["x-goog-api-key"];
      if (key === "good-key") return modelsResponse([model("gemini-valid")]);
      return Response.json({ error: { message: "forbidden" } }, { status: 403 });
    });
    const manager = new GeminiCatalogManager({ fetchImpl, persistPath: null });

    await expect(manager.validateKey("good-key")).resolves.toMatchObject({ valid: true, modelCount: 1 });
    await expect(manager.validateKey("bad-key")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(fetchImpl.mock.calls.every(([url]) => !String(url).includes(":generateContent"))).toBe(true);
  });

  test("default key limit accepts up to ten unique credentials and catalog identities are non-secret", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(modelsResponse([model("gemini-a")])) ;
    const manager = new GeminiCatalogManager({ fetchImpl, persistPath: null });

    const result = await manager.getCatalog({
      userApiKeyRaw: "a,b,c,d,e,f,a",
      serverApiKeyRaw: "",
      force: true,
    });

    expect(result.pool.keys).toHaveLength(6);
    expect(new Set(result.pool.keys.map((key) => key.id)).size).toBe(6);
    for (const key of result.pool.keys) {
      expect(key.id).not.toBe(key.apiKey);
      expect(key.id).toMatch(/^key-[a-f0-9]{12}$/);
    }
  });
});

describe("Gemini route planning", () => {
  async function makeManager() {
    let now = 10_000;
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const key = (init?.headers as Record<string, string>)["x-goog-api-key"];
      if (key === "a") {
        return modelsResponse([
          model("gemini-first"),
          model("gemini-second"),
          model("gemini-preview-next"),
        ]);
      }
      return modelsResponse([model("gemini-first"), model("gemini-second")]);
    });
    const manager = new GeminiCatalogManager({ fetchImpl, persistPath: null, now: () => now });
    const catalog = await manager.getCatalog({ userApiKeyRaw: "a,b", serverApiKeyRaw: "", force: true });
    return { manager, catalog, setNow: (value: number) => { now = value; } };
  }

  test("Auto exhausts keys on one stable model before moving to the next and excludes Preview by default", async () => {
    const { manager, catalog } = await makeManager();

    const routes = manager.planRoutes(catalog, {
      workflow: "image",
      modelPreference: "auto",
      allowPreview: false,
    });

    expect(routes.map((route) => [route.model, route.keyIndex])).toEqual([
      ["gemini-first", 0],
      ["gemini-first", 1],
      ["gemini-second", 0],
      ["gemini-second", 1],
    ]);
  });

  test("Last-known-good is preferred per workflow without leaking compatibility to the other workflow", async () => {
    const { manager, catalog } = await makeManager();
    const secondKey = catalog.pool.keys[0];

    await manager.recordSuccess(catalog, {
      workflow: "text",
      model: "gemini-second",
      keyId: secondKey.id,
    });

    const textRoutes = manager.planRoutes(catalog, { workflow: "text", modelPreference: "auto", allowPreview: false });
    const imageRoutes = manager.planRoutes(catalog, { workflow: "image", modelPreference: "auto", allowPreview: false });

    expect(textRoutes[0].model).toBe("gemini-second");
    expect(imageRoutes[0].model).toBe("gemini-first");
    expect(catalog.snapshot.models.find((entry) => entry.id === "gemini-second")?.compatibility).toEqual({
      text: "compatible",
      image: "unverified",
    });
  });

  test("Manual pins the model and rotates only among keys that expose it", async () => {
    const { manager, catalog } = await makeManager();

    const routes = manager.planRoutes(catalog, {
      workflow: "image",
      modelPreference: "gemini-preview-next",
      allowPreview: false,
    });

    expect(routes).toHaveLength(1);
    expect(routes[0].model).toBe("gemini-preview-next");
    expect(routes[0].keyIndex).toBe(0);
  });

  test("Manual unavailable model fails truthfully instead of substituting another model", async () => {
    const { manager, catalog } = await makeManager();

    expect(() => manager.planRoutes(catalog, {
      workflow: "image",
      modelPreference: "gemini-retired",
      allowPreview: false,
    })).toThrowError(GeminiRoutingError);

    try {
      manager.planRoutes(catalog, { workflow: "image", modelPreference: "gemini-retired", allowPreview: false });
    } catch (error) {
      expect(error).toMatchObject({ code: "GEMINI_MODEL_UNAVAILABLE", model: "gemini-retired" });
    }
  });

  test("quota cooldown removes only the affected model+key route and expiry restores it", async () => {
    const { manager, catalog, setNow } = await makeManager();
    const key = catalog.pool.keys[0];

    await manager.recordFailure(catalog, {
      workflow: "image",
      model: "gemini-first",
      keyId: key.id,
      kind: "quota",
      retryAfterMs: 5_000,
    });

    expect(manager.planRoutes(catalog, { workflow: "image", modelPreference: "auto", allowPreview: false })
      .map((route) => [route.model, route.keyIndex]))
      .toEqual([
        ["gemini-first", 1],
        ["gemini-second", 0],
        ["gemini-second", 1],
      ]);

    setNow(16_000);
    expect(manager.planRoutes(catalog, { workflow: "image", modelPreference: "auto", allowPreview: false })[0])
      .toMatchObject({ model: "gemini-first", keyIndex: 0 });
  });

  test("transient failures do not poison compatibility while capability failures only poison one workflow", async () => {
    const { manager, catalog } = await makeManager();
    const key = catalog.pool.keys[0];

    await manager.recordFailure(catalog, {
      workflow: "image", model: "gemini-first", keyId: key.id, kind: "transient",
    });
    expect(catalog.snapshot.models.find((entry) => entry.id === "gemini-first")?.compatibility.image)
      .toBe("unverified");

    await manager.recordFailure(catalog, {
      workflow: "image", model: "gemini-first", keyId: key.id, kind: "capability",
    });
    expect(catalog.snapshot.models.find((entry) => entry.id === "gemini-first")?.compatibility)
      .toEqual({ text: "unverified", image: "incompatible" });
  });
});

describe("Gemini catalog cache persistence", () => {
  test("restores a matching cached catalog without persisting raw API keys", async () => {
    const dir = await mkdtemp(join(tmpdir(), "superk-gemini-test-"));
    tempDirs.push(dir);
    const persistPath = join(dir, "state.json");
    const liveFetch = vi.fn<typeof fetch>().mockResolvedValue(modelsResponse([model("gemini-cached")])) ;

    const first = new GeminiCatalogManager({ fetchImpl: liveFetch, persistPath, now: () => 1_000 });
    const live = await first.getCatalog({ userApiKeyRaw: "secret-user-key", serverApiKeyRaw: "", force: true });
    await first.recordSuccess(live, {
      workflow: "text",
      model: "gemini-cached",
      keyId: live.pool.keys[0].id,
    });

    const persisted = await readFile(persistPath, "utf8");
    expect(persisted).not.toContain("secret-user-key");

    const offlineFetch = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline"));
    const second = new GeminiCatalogManager({ fetchImpl: offlineFetch, persistPath, now: () => 2_000 });
    const restored = await second.getCatalog({ userApiKeyRaw: "secret-user-key", serverApiKeyRaw: "", force: true });

    expect(restored.snapshot.source).toBe("cache");
    expect(restored.snapshot.stale).toBe(true);
    expect(restored.snapshot.models.map((entry) => entry.id)).toContain("gemini-cached");
    expect(managerSafeJson(restored)).not.toContain("secret-user-key");
  });

  test("discovery passes AbortSignal to fetch and falls back to stale cache or bootstrap on timeout", async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      capturedSignal = init?.signal as AbortSignal;
      return modelsResponse([model("gemini-test")]);
    });

    const manager = new GeminiCatalogManager({ fetchImpl, persistPath: null, now: () => 1_000 });
    const customSignal = AbortSignal.timeout(5000);
    const result = await manager.getCatalog({ userApiKeyRaw: "test-key", signal: customSignal });

    expect(capturedSignal).toBe(customSignal);
    expect(result.snapshot.models.some((m) => m.id === "gemini-test")).toBe(true);
  });
});

function managerSafeJson(value: unknown) {
  return JSON.stringify(value, (key, current) => key === "apiKey" ? undefined : current);
}
