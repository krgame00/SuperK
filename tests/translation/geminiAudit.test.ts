// @vitest-environment node
import { afterEach, describe, expect, test, vi } from "vitest";
import { clearKeyCooldowns, defaultKeyCooldowns, requestGemini, requestGeminiRoutes } from "@/lib/server/geminiRequest";
import { GeminiCatalogManager, geminiCatalogManager } from "@/lib/server/geminiCatalog";
import { executeGeminiTranslation } from "@/lib/server/geminiTranslationRouter";

const route = { model: "gemini-a", apiKey: "secret-a", keyId: "key-a", keyIndex: 0, keySlot: 1 };
const body = { candidates: [] };
const fixed = (fetchImpl: typeof fetch, signal?: AbortSignal) => requestGemini({ apiKeys: ["secret-a"], models: ["gemini-a"], payload: {}, fetchImpl, signal, attemptTimeoutMs: 50 });
const dynamic = (fetchImpl: typeof fetch, signal?: AbortSignal) => requestGeminiRoutes({ routes: [route], payload: {}, fetchImpl, signal, attemptTimeoutMs: 50 });

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); clearKeyCooldowns(); });

describe("Gemini attempt terminal paths", () => {
  test("cancellation during the final failure callback surfaces as REQUEST_ABORTED", async () => {
    const controller = new AbortController();
    await expect(requestGeminiRoutes({ routes: [route], payload: {}, signal: controller.signal,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { message: "invalid input" } }, { status: 400 })),
      onRouteFailure: () => { controller.abort(); },
    })).rejects.toMatchObject({ code: "REQUEST_ABORTED" });
  });
  test.each(["fetch", "body"])("fixed deadline covers hanging %s even when abort is ignored", async (stage) => {
    vi.useFakeTimers();
    let release!: () => void;
    const stalled = new Promise<void>((resolve) => { release = resolve; });
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      if (stage === "fetch") await stalled;
      return { ok: true, status: 200, json: async () => { if (stage === "body") await stalled; return body; } } as Response;
    });
    let terminal: unknown;
    const operation = fixed(fetchImpl).then((result) => { terminal = result; }, (error) => { terminal = error; });
    await vi.advanceTimersByTimeAsync(50);
    const atDeadline = terminal;
    release();
    await operation;
    expect(atDeadline).toMatchObject({ code: "GEMINI_TIMEOUT" });
  });

  test.each([["fixed", fixed], ["dynamic", dynamic]] as const)("%s cancellation settles immediately when provider ignores abort", async (_name, run) => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined));
    let terminal: unknown;
    const operation = run(fetchImpl, controller.signal).catch((error) => { terminal = error; });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    const afterAbort = terminal;
    await vi.advanceTimersByTimeAsync(50);
    // The old fixed implementation never settles when fetch ignores abort.
    void operation;
    expect(afterAbort).toMatchObject({ code: "REQUEST_ABORTED", status: 499 });
    expect(defaultKeyCooldowns.size).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("fixed cancellation does not mark the key unhealthy", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    });
    await expect(fixed(fetchImpl, controller.signal)).rejects.toMatchObject({ code: "REQUEST_ABORTED" });
    expect(defaultKeyCooldowns.size).toBe(0);
  });

  test.each(["fixed", "dynamic"])("%s cancellation interrupts retry sleep without another attempt or health penalty", async (name) => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let finishSleep!: () => void;
    const sleep = vi.fn(() => new Promise<void>((resolve) => { finishSleep = resolve; }));
    const onRouteFailure = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { message: "busy" } }, { status: 503 }));
    let terminal: unknown;
    const options = { payload: {}, fetchImpl, signal: controller.signal, sleep, attemptTimeoutMs: 50, totalBudgetMs: 100 };
    const operation = (name === "fixed"
      ? requestGemini({ ...options, apiKeys: ["secret-a"], models: ["gemini-a"] })
      : requestGeminiRoutes({ ...options, routes: [route], onRouteFailure })
    ).catch((error) => { terminal = error; });
    await vi.advanceTimersByTimeAsync(0);
    expect(sleep).toHaveBeenCalledTimes(1);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    const afterAbort = terminal;
    finishSleep();
    await operation;
    expect(afterAbort).toMatchObject({ code: "REQUEST_ABORTED" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onRouteFailure).not.toHaveBeenCalled();
    expect(defaultKeyCooldowns.size).toBe(0);
  });

  test.each(["fixed", "dynamic"])("%s retry sleep cannot outlive the total request budget", async (name) => {
    vi.useFakeTimers();
    let finishSleep!: () => void;
    const sleep = () => new Promise<void>((resolve) => { finishSleep = resolve; });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { message: "busy" } }, { status: 503 }));
    let terminal: unknown;
    const options = { payload: {}, fetchImpl, sleep, totalBudgetMs: 100 };
    const operation = (name === "fixed"
      ? requestGemini({ ...options, apiKeys: ["secret-a"], models: ["gemini-a"] })
      : requestGeminiRoutes({ ...options, routes: [route] })
    ).catch((error) => { terminal = error; });
    await vi.advanceTimersByTimeAsync(100);
    const atDeadline = terminal;
    finishSleep();
    await operation;
    expect(atDeadline).toMatchObject({ code: "GEMINI_TIMEOUT" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test.each([["fixed", fixed], ["dynamic", dynamic]] as const)("%s removes the external listener after success", async (_name, run) => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    await run(vi.fn<typeof fetch>().mockResolvedValue(Response.json(body)), controller.signal);
    const listeners = add.mock.calls.filter(([event]) => event === "abort");
    expect(listeners.length).toBeGreaterThan(0);
    for (const [event, listener] of listeners) expect(remove).toHaveBeenCalledWith(event, listener);
  });
});

describe("Gemini discovery cancellation", () => {
  test.each([false, true])("partial discovery cancellation preserves the existing catalog (prior catalog: %s)", async (hasPriorCatalog) => {
    let canceledDiscovery = false;
    let keyBStarted!: () => void;
    const started = new Promise<void>((resolve) => { keyBStarted = resolve; });
    const provider = () => Response.json({ models: [{ name: "models/gemini-a", supportedGenerationMethods: ["generateContent"] }] });
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      if (canceledDiscovery && (init?.headers as Record<string, string>)["x-goog-api-key"] === "secret-b") {
        keyBStarted();
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        });
      }
      return provider();
    });
    const manager = new GeminiCatalogManager({ persistPath: null, fetchImpl });
    const input = { userApiKeyRaw: "secret-a,secret-b" };
    const prior = hasPriorCatalog ? await manager.getCatalog(input) : undefined;
    canceledDiscovery = true;
    const controller = new AbortController();
    const discovery = manager.getCatalog({ ...input, force: true, signal: controller.signal });
    const terminal = discovery.then((result) => result, (error: unknown) => error);
    await started;
    controller.abort();
    const canceled = await terminal;
    canceledDiscovery = false;
    fetchImpl.mockClear();
    const next = await manager.getCatalog(input);
    expect(canceled).toMatchObject({ name: "AbortError" });
    expect(fetchImpl).toHaveBeenCalledTimes(hasPriorCatalog ? 0 : 2);
    expect(next.snapshot.keys.every((key) => key.valid)).toBe(true);
    expect(next.snapshot.models[0].keyIds).toHaveLength(2);
    if (prior) expect(next.snapshot.models).toEqual(prior.snapshot.models);
    expect(manager.getModelHealth(next, "gemini-a")).toMatchObject({ status: "ready", cooldownKeys: 0 });
  });
});

describe("Gemini router recovery and cancellation", () => {
  async function recoverySetup() {
    let now = 1_000;
    const manager = new GeminiCatalogManager({ persistPath: null, now: () => now, fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ models: [{ name: "models/gemini-a", supportedGenerationMethods: ["generateContent"] }] })) });
    const catalog = await manager.getCatalog({ userApiKeyRaw: "secret-a" });
    await manager.recordFailure(catalog, { workflow: "image", model: "gemini-a", keyId: catalog.pool.keys[0].id, kind: "overload" });
    now = 31_001;
    for (const method of ["getCatalog", "planRoutes", "claimRecoveryTrial", "releaseRecoveryTrial", "recordFailure", "recordSuccess"] as const) {
      vi.spyOn(geminiCatalogManager, method).mockImplementation(manager[method].bind(manager) as never);
    }
    return { manager, catalog, now: () => now, expire: () => { now += 100; } };
  }

  test("invalid translation releases a recovery trial without recording success", async () => {
    const { manager, catalog, now } = await recoverySetup();
    await executeGeminiTranslation({ workflow: "image", userApiKeyRaw: "secret-a", payload: {}, now, fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(Response.json(body)), validateSuccess: () => false });
    expect(manager.getModelHealth(catalog, "gemini-a")).toMatchObject({ recoveryInFlight: false });
    expect(geminiCatalogManager.recordSuccess).not.toHaveBeenCalled();
    expect(manager.claimRecoveryTrial(catalog.pool.id, "gemini-a")).toBe(true);
  });

  test("budget exhaustion during a recovery retry releases the trial", async () => {
    const { manager, catalog, now, expire } = await recoverySetup();
    await expect(executeGeminiTranslation({ workflow: "image", userApiKeyRaw: "secret-a", payload: {}, now, totalBudgetMs: 100, fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { message: "busy" } }, { status: 500 })), sleep: async () => expire() })).rejects.toMatchObject({ code: "GEMINI_TIMEOUT" });
    expect(manager.getModelHealth(catalog, "gemini-a").recoveryInFlight).toBe(false);
  });

  test("canceling a recovery request releases the trial without changing health", async () => {
    const { manager, catalog, now } = await recoverySetup();
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>(async () => { controller.abort(); throw new DOMException("Aborted", "AbortError"); });
    await expect(executeGeminiTranslation({ workflow: "image", userApiKeyRaw: "secret-a", payload: {}, now, fetchImpl, signal: controller.signal })).rejects.toMatchObject({ code: "REQUEST_ABORTED" });
    expect(manager.getModelHealth(catalog, "gemini-a")).toMatchObject({ recoveryInFlight: false, status: "recovery" });
    expect(geminiCatalogManager.recordFailure).not.toHaveBeenCalled();
  });

  test("caller cancellation reaches discovery and settles when discovery ignores abort", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let discoverySignal: AbortSignal | undefined;
    vi.spyOn(geminiCatalogManager, "getCatalog").mockImplementation((input) => { discoverySignal = input.signal; return new Promise(() => undefined); });
    const fetchImpl = vi.fn<typeof fetch>();
    let terminal: unknown;
    const operation = executeGeminiTranslation({ workflow: "image", payload: {}, signal: controller.signal, fetchImpl, totalBudgetMs: 50 }).catch((error) => { terminal = error; });
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    const afterAbort = terminal;
    const discoveryAborted = discoverySignal?.aborted;
    await vi.advanceTimersByTimeAsync(50);
    await operation;
    expect(afterAbort).toMatchObject({ code: "REQUEST_ABORTED" });
    expect(discoveryAborted).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
