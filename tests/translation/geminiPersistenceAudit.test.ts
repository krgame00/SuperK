// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { GeminiCatalogManager, geminiCatalogManager, resolveActiveGeminiKeyPool } from "@/lib/server/geminiCatalog";
import { executeGeminiTranslation } from "@/lib/server/geminiTranslationRouter";

vi.mock("node:fs/promises", () => ({ mkdir: vi.fn(), readFile: vi.fn(), writeFile: vi.fn() }));
const provider = () => Response.json({ models: [{ name: "models/gemini-a", supportedGenerationMethods: ["generateContent"] }, { name: "models/gemini-b", supportedGenerationMethods: ["generateContent"] }] });
beforeEach(() => {
  vi.mocked(readFile).mockRejectedValue(new Error("missing"));
  vi.mocked(mkdir).mockResolvedValue(undefined);
  vi.mocked(writeFile).mockResolvedValue(undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });

describe("Gemini persistence failure isolation", () => {
  test.each(["success", "failure"])("canceling %s bookkeeping settles promptly and preserves the current recovery owner", async (outcome) => {
    let now = 1_000;
    const manager = new GeminiCatalogManager({ persistPath: "cache/state.json", now: () => now,
      fetchImpl: vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ models: [{ name: "models/gemini-a", supportedGenerationMethods: ["generateContent"] }] })),
    });
    const catalog = await manager.getCatalog({ userApiKeyRaw: "secret-user-key" });
    await manager.recordFailure(catalog, { workflow: "image", model: "gemini-a", keyId: catalog.pool.keys[0].id, kind: "overload" });
    now = 31_001;
    for (const method of ["getCatalog", "planRoutes", "claimRecoveryTrial", "releaseRecoveryTrial", "recordFailure", "recordSuccess"] as const) {
      vi.spyOn(geminiCatalogManager, method).mockImplementation(manager[method].bind(manager) as never);
    }
    vi.mocked(writeFile).mockClear();
    let finishWrite!: () => void;
    vi.mocked(writeFile).mockImplementationOnce(() => new Promise<void>((resolve) => { finishWrite = resolve; }));
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(outcome === "success" ? { candidates: [] } : { error: { message: "invalid input" } }, { status: outcome === "success" ? 200 : 400 }));
    let terminal: unknown;
    const operation = executeGeminiTranslation({ workflow: "image", userApiKeyRaw: "secret-user-key", payload: {}, signal: controller.signal, fetchImpl, now: () => now }).then((result) => { terminal = result; }, (error) => { terminal = error; });
    await vi.waitFor(() => expect(writeFile).toHaveBeenCalledTimes(1));
    if (outcome === "failure") expect(manager.claimRecoveryTrial(catalog.pool.id, "gemini-a")).toBe(true);
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const afterAbort = terminal;
    const healthAfterAbort = manager.getModelHealth(catalog, "gemini-a");
    finishWrite();
    await operation;
    expect(afterAbort).toMatchObject({ code: "REQUEST_ABORTED" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    if (outcome === "failure") {
      expect(healthAfterAbort.recoveryInFlight).toBe(true);
      expect(manager.getModelHealth(catalog, "gemini-a").recoveryInFlight).toBe(true);
    } else {
      expect(healthAfterAbort.status).toBe("ready");
      const current = await manager.getCatalog({ userApiKeyRaw: "secret-user-key" });
      expect(current.snapshot.models[0].compatibility.image).toBe("compatible");
    }
  });

  test("failed persistence preserves live discovery and successful translation state with safe diagnostics", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(writeFile).mockRejectedValue(new Error("disk failure secret-user-key"));
    const manager = new GeminiCatalogManager({ persistPath: "cache/state.json", fetchImpl: vi.fn<typeof fetch>().mockImplementation(async () => provider()) });
    const catalog = await manager.getCatalog({ userApiKeyRaw: "secret-user-key" });
    expect(catalog.snapshot.source).toBe("live");
    await expect(manager.recordSuccess(catalog, { workflow: "image", model: "gemini-b", keyId: catalog.pool.keys[0].id })).resolves.toBeUndefined();
    expect(manager.planRoutes(catalog, { workflow: "image" })[0].model).toBe("gemini-b");
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-user-key");
  });

  test("failed persistence does not prevent route failure handling or eligible fallback", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const manager = new GeminiCatalogManager({ persistPath: "cache/state.json", fetchImpl: vi.fn<typeof fetch>().mockImplementation(async () => provider()) });
    const catalog = await manager.getCatalog({ userApiKeyRaw: "secret-user-key" });
    vi.mocked(mkdir).mockRejectedValue(new Error("disk failure"));
    await expect(manager.recordFailure(catalog, { workflow: "image", model: "gemini-a", keyId: catalog.pool.keys[0].id, kind: "capability" })).resolves.toBeUndefined();
    expect(manager.planRoutes(catalog, { workflow: "image" })[0].model).toBe("gemini-b");
  });

  test("concurrent catalog callers await the same persisted cache load", async () => {
    const pool = resolveActiveGeminiKeyPool("secret-user-key");
    const snapshot = { poolId: pool.id, owner: "user", models: [{ id: "gemini-cached", displayName: "cached", releaseChannel: "stable", supportedGenerationMethods: ["generateContent"], keyIds: [pool.keys[0].id], availabilityCount: 1, totalKeys: 1, compatibility: { text: "unverified", image: "unverified" } }], keys: [], source: "live", stale: false, discoveredAt: 1, expiresAt: 10_000 };
    let load!: (value: string) => void;
    vi.mocked(readFile).mockImplementation(() => new Promise<string>((resolve) => { load = resolve; }));
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => provider());
    const manager = new GeminiCatalogManager({ persistPath: "cache/state.json", fetchImpl, now: () => 1_000 });
    const first = manager.getCatalog({ userApiKeyRaw: "secret-user-key" });
    const second = manager.getCatalog({ userApiKeyRaw: "secret-user-key" });
    await Promise.resolve();
    const fetchCallsBeforeLoad = fetchImpl.mock.calls.length;
    load(JSON.stringify({ version: 2, pools: { [pool.id]: { catalog: snapshot, compatibility: {}, lastKnownGood: {}, latency: {}, cooldowns: {} } } }));
    const results = await Promise.all([first, second]);
    expect(fetchCallsBeforeLoad).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.snapshot.models[0].id)).toEqual(["gemini-cached", "gemini-cached"]);
  });

  test("concurrent persistence writes serialize and save the newest outcome last", async () => {
    const manager = new GeminiCatalogManager({ persistPath: "cache/state.json", fetchImpl: vi.fn<typeof fetch>().mockImplementation(async () => provider()) });
    const catalog = await manager.getCatalog({ userApiKeyRaw: "secret-user-key" });
    vi.mocked(writeFile).mockClear();
    let release!: () => void;
    vi.mocked(writeFile).mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const first = manager.recordSuccess(catalog, { workflow: "image", model: "gemini-a", keyId: catalog.pool.keys[0].id });
    await vi.waitFor(() => expect(writeFile).toHaveBeenCalledTimes(1));
    const second = manager.recordSuccess(catalog, { workflow: "image", model: "gemini-b", keyId: catalog.pool.keys[0].id });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const writesWhileBlocked = vi.mocked(writeFile).mock.calls.length;
    release();
    await Promise.all([first, second]);
    expect(writesWhileBlocked).toBe(1);
    expect(writeFile).toHaveBeenCalledTimes(2);
    const latest = JSON.parse(String(vi.mocked(writeFile).mock.calls[1][1]));
    expect(latest.pools[catalog.pool.id].lastKnownGood.image.model).toBe("gemini-b");
  });
});
