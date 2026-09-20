import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export type GeminiWorkflow = "text" | "image";
export type GeminiCompatibility = "unverified" | "compatible" | "incompatible";
export type GeminiReleaseChannel = "stable" | "preview" | "experimental";
export type GeminiCatalogSource = "live" | "cache" | "bootstrap";
export type GeminiKeyPoolOwner = "user" | "server";

export interface GeminiKeyCredential {
  id: string;
  slot: number;
  apiKey: string;
}

export interface ActiveGeminiKeyPool {
  id: string;
  owner: GeminiKeyPoolOwner;
  keys: GeminiKeyCredential[];
}

export interface GeminiCatalogKeyStatus {
  id: string;
  slot: number;
  valid: boolean;
  modelCount: number;
  errorCode?: string;
}

export interface GeminiCatalogModel {
  id: string;
  displayName: string;
  description?: string;
  releaseChannel: GeminiReleaseChannel;
  supportedGenerationMethods: string[];
  keyIds: string[];
  availabilityCount: number;
  totalKeys: number;
  compatibility: Record<GeminiWorkflow, GeminiCompatibility>;
}

export interface GeminiCatalogSnapshot {
  poolId: string;
  owner: GeminiKeyPoolOwner;
  models: GeminiCatalogModel[];
  keys: GeminiCatalogKeyStatus[];
  source: GeminiCatalogSource;
  stale: boolean;
  discoveredAt: number;
  expiresAt: number;
}

export interface GeminiCatalogResult {
  pool: ActiveGeminiKeyPool;
  snapshot: GeminiCatalogSnapshot;
}

export interface GeminiRoute {
  model: string;
  apiKey: string;
  keyId: string;
  keyIndex: number;
  keySlot: number;
}

export interface PlanGeminiRoutesOptions {
  workflow: GeminiWorkflow;
  modelPreference?: string;
  allowPreview?: boolean;
}

export type GeminiRouteFailureKind = "quota" | "capability" | "transient";

export interface GeminiRouteOutcome {
  workflow: GeminiWorkflow;
  model: string;
  keyId: string;
}

export interface GeminiRouteFailure extends GeminiRouteOutcome {
  kind: GeminiRouteFailureKind;
  retryAfterMs?: number;
}

export type GeminiRoutingErrorCode =
  | "GEMINI_API_KEY_MISSING"
  | "GEMINI_MODEL_UNAVAILABLE"
  | "GEMINI_MODEL_INCOMPATIBLE"
  | "GEMINI_ROUTE_UNAVAILABLE";

export class GeminiRoutingError extends Error {
  readonly code: GeminiRoutingErrorCode;
  readonly model?: string;

  constructor(message: string, code: GeminiRoutingErrorCode, model?: string) {
    super(message);
    this.name = "GeminiRoutingError";
    this.code = code;
    this.model = model;
  }
}

interface ProviderModel {
  name?: string;
  displayName?: string;
  description?: string;
  supportedGenerationMethods?: string[];
}

interface ProviderModelList {
  models?: ProviderModel[];
  nextPageToken?: string;
}

interface ModelState {
  text: GeminiCompatibility;
  image: GeminiCompatibility;
}

interface PoolState {
  catalog?: GeminiCatalogSnapshot;
  compatibility: Record<string, ModelState>;
  lastKnownGood: Partial<Record<GeminiWorkflow, string>>;
  cooldowns: Record<string, number>;
}

interface PersistedState {
  version: 1;
  pools: Record<string, PoolState>;
}

interface ManagerOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  persistPath?: string | null;
  cacheTtlMs?: number;
}

const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_ROUTE_COOLDOWN_MS = 60_000;
const MAX_ROUTE_COOLDOWN_MS = 30 * 60_000;
const EMERGENCY_MODELS = ["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export function splitGeminiApiKeys(raw?: string | null): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean))].slice(0, 5);
}

export function resolveActiveGeminiKeyPool(
  userApiKeyRaw?: string | null,
  serverApiKeyRaw?: string | null,
): ActiveGeminiKeyPool {
  const userKeys = splitGeminiApiKeys(userApiKeyRaw);
  const owner: GeminiKeyPoolOwner = userKeys.length > 0 ? "user" : "server";
  const rawKeys = userKeys.length > 0 ? userKeys : splitGeminiApiKeys(serverApiKeyRaw);
  const keys = rawKeys.map((apiKey, index) => ({
    apiKey,
    slot: index + 1,
    id: `key-${fingerprint(apiKey)}`,
  }));
  const poolHash = fingerprint(`${owner}:${keys.map((key) => key.id).join("|")}`);
  return { id: `${owner}-${poolHash}`, owner, keys };
}

function isTranslationGeminiModel(model: ProviderModel, id: string): boolean {
  return id.startsWith("gemini-") && model.supportedGenerationMethods?.includes("generateContent") === true;
}

function releaseChannelFor(model: ProviderModel, id: string): GeminiReleaseChannel {
  const text = `${id} ${model.displayName ?? ""} ${model.description ?? ""}`.toLowerCase();
  if (text.includes("experimental") || /(^|[-_\s])exp(?:erimental)?([-_\s]|$)/.test(text)) {
    return "experimental";
  }
  if (text.includes("preview") || text.includes("latest")) return "preview";
  return "stable";
}

function emptyCompatibility(): ModelState {
  return { text: "unverified", image: "unverified" };
}

function cloneSnapshot(snapshot: GeminiCatalogSnapshot): GeminiCatalogSnapshot {
  return structuredClone(snapshot);
}

function routeKey(model: string, keyId: string): string {
  return `${model}::${keyId}`;
}

export class GeminiCatalogManager {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly persistPath: string | null;
  private readonly cacheTtlMs: number;
  private readonly states = new Map<string, PoolState>();
  private loaded = false;

  constructor(options: ManagerOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.persistPath = options.persistPath === undefined
      ? (process.env.SUPERK_GEMINI_STATE_FILE || join(tmpdir(), "superk-gemini-state.json"))
      : options.persistPath;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  }

  async validateKey(apiKey: string, signal?: AbortSignal): Promise<{ valid: true; modelCount: number }> {
    const models = await this.discoverForKey(apiKey, signal);
    const modelCount = models.filter((candidate) =>
      candidate.supportedGenerationMethods?.includes("generateContent"),
    ).length;
    if (modelCount === 0) {
      throw new GeminiDiscoveryError(
        "Gemini API key exposes no generateContent model",
        "NO_GENERATE_CONTENT_MODEL",
      );
    }
    return { valid: true, modelCount };
  }

  async getCatalog(input: {
    userApiKeyRaw?: string | null;
    serverApiKeyRaw?: string | null;
    force?: boolean;
    signal?: AbortSignal;
  }): Promise<GeminiCatalogResult> {
    await this.ensureLoaded();
    const pool = resolveActiveGeminiKeyPool(input.userApiKeyRaw, input.serverApiKeyRaw);
    if (pool.keys.length === 0) {
      throw new GeminiRoutingError("Gemini API Key is required", "GEMINI_API_KEY_MISSING");
    }

    const state = this.getState(pool.id);
    const current = state.catalog;
    if (!input.force && current && current.expiresAt > this.now()) {
      const snapshot = this.applyStateToSnapshot({ ...cloneSnapshot(current), source: "cache", stale: false }, state);
      return { pool, snapshot };
    }

    try {
      const snapshot = await this.discover(pool, state, input.signal);
      state.catalog = cloneSnapshot(snapshot);
      await this.persist();
      return { pool, snapshot };
    } catch {
      if (current) {
        const snapshot = this.applyStateToSnapshot({ ...cloneSnapshot(current), source: "cache", stale: true }, state);
        return { pool, snapshot };
      }
      const snapshot = this.bootstrapCatalog(pool, state);
      return { pool, snapshot };
    }
  }

  planRoutes(catalog: GeminiCatalogResult, options: PlanGeminiRoutesOptions): GeminiRoute[] {
    const state = this.getState(catalog.pool.id);
    this.dropExpiredCooldowns(state);
    const manual = options.modelPreference && options.modelPreference !== "auto"
      ? options.modelPreference
      : undefined;

    if (manual) {
      const selected = catalog.snapshot.models.find((entry) => entry.id === manual);
      if (!selected) {
        throw new GeminiRoutingError(
          `Gemini model ${manual} is unavailable for the active key pool`,
          "GEMINI_MODEL_UNAVAILABLE",
          manual,
        );
      }
      if (selected.compatibility[options.workflow] === "incompatible") {
        throw new GeminiRoutingError(
          `Gemini model ${manual} is incompatible with ${options.workflow} translation`,
          "GEMINI_MODEL_INCOMPATIBLE",
          manual,
        );
      }
      const routes = this.routesForModel(catalog, selected, state);
      if (routes.length === 0) {
        throw new GeminiRoutingError(
          `Gemini model ${manual} has no eligible key route right now`,
          "GEMINI_ROUTE_UNAVAILABLE",
          manual,
        );
      }
      return routes;
    }

    const candidates = catalog.snapshot.models.filter((entry) => {
      if (entry.compatibility[options.workflow] === "incompatible") return false;
      return options.allowPreview || entry.releaseChannel === "stable";
    });
    const lastKnownGood = state.lastKnownGood[options.workflow];
    if (lastKnownGood) {
      candidates.sort((a, b) => Number(b.id === lastKnownGood) - Number(a.id === lastKnownGood));
    }

    const routes = candidates.flatMap((entry) => this.routesForModel(catalog, entry, state));
    if (routes.length === 0) {
      throw new GeminiRoutingError("No eligible Gemini route is available", "GEMINI_ROUTE_UNAVAILABLE");
    }
    return routes;
  }

  async recordSuccess(catalog: GeminiCatalogResult, outcome: GeminiRouteOutcome): Promise<void> {
    await this.ensureLoaded();
    const state = this.getState(catalog.pool.id);
    const compatibility = state.compatibility[outcome.model] ?? emptyCompatibility();
    compatibility[outcome.workflow] = "compatible";
    state.compatibility[outcome.model] = compatibility;
    state.lastKnownGood[outcome.workflow] = outcome.model;
    delete state.cooldowns[routeKey(outcome.model, outcome.keyId)];
    this.applyStateToSnapshot(catalog.snapshot, state);
    if (state.catalog) this.applyStateToSnapshot(state.catalog, state);
    await this.persist();
  }

  async recordFailure(catalog: GeminiCatalogResult, failure: GeminiRouteFailure): Promise<void> {
    await this.ensureLoaded();
    const state = this.getState(catalog.pool.id);
    if (failure.kind === "quota") {
      const duration = Math.min(
        Math.max(failure.retryAfterMs ?? DEFAULT_ROUTE_COOLDOWN_MS, 1_000),
        MAX_ROUTE_COOLDOWN_MS,
      );
      const key = routeKey(failure.model, failure.keyId);
      state.cooldowns[key] = Math.max(state.cooldowns[key] ?? 0, this.now() + duration);
    } else if (failure.kind === "capability") {
      const compatibility = state.compatibility[failure.model] ?? emptyCompatibility();
      compatibility[failure.workflow] = "incompatible";
      state.compatibility[failure.model] = compatibility;
      if (state.lastKnownGood[failure.workflow] === failure.model) {
        delete state.lastKnownGood[failure.workflow];
      }
    }
    this.applyStateToSnapshot(catalog.snapshot, state);
    if (state.catalog) this.applyStateToSnapshot(state.catalog, state);
    await this.persist();
  }

  registerCustomModel(catalog: GeminiCatalogResult, modelId: string): GeminiCatalogModel {
    const id = modelId.trim().replace(/^models\//, "");
    if (!id) throw new GeminiRoutingError("Custom Gemini model ID is empty", "GEMINI_MODEL_UNAVAILABLE");
    const existing = catalog.snapshot.models.find((entry) => entry.id === id);
    if (existing) return existing;
    const state = this.getState(catalog.pool.id);
    const entry: GeminiCatalogModel = {
      id,
      displayName: id,
      releaseChannel: releaseChannelFor({}, id),
      supportedGenerationMethods: ["generateContent"],
      keyIds: catalog.pool.keys.map((key) => key.id),
      availabilityCount: catalog.pool.keys.length,
      totalKeys: catalog.pool.keys.length,
      compatibility: { ...(state.compatibility[id] ?? emptyCompatibility()) },
    };
    catalog.snapshot.models.push(entry);
    return entry;
  }

  invalidateCatalog(poolId: string): void {
    const state = this.states.get(poolId);
    if (state?.catalog) state.catalog.expiresAt = 0;
  }

  getRouteCooldownUntil(poolId: string, model: string, keyId: string): number | undefined {
    const state = this.getState(poolId);
    const until = state.cooldowns[routeKey(model, keyId)];
    return until && until > this.now() ? until : undefined;
  }

  private async discover(pool: ActiveGeminiKeyPool, state: PoolState, signal?: AbortSignal): Promise<GeminiCatalogSnapshot> {
    const perKey = await Promise.all(pool.keys.map(async (credential) => {
      try {
        const models = await this.discoverForKey(credential.apiKey, signal);
        return { credential, models, valid: true as const };
      } catch (error) {
        const code = error instanceof GeminiDiscoveryError ? error.code : "DISCOVERY_FAILED";
        return { credential, models: [] as ProviderModel[], valid: false as const, code };
      }
    }));

    if (!perKey.some((entry) => entry.valid)) {
      throw new GeminiDiscoveryError("No Gemini key could be discovered", "DISCOVERY_FAILED");
    }

    const union = new Map<string, GeminiCatalogModel>();
    for (const entry of perKey) {
      for (const providerModel of entry.models) {
        const id = providerModel.name?.replace(/^models\//, "");
        if (!id || !isTranslationGeminiModel(providerModel, id)) continue;
        const existing = union.get(id);
        if (existing) {
          if (!existing.keyIds.includes(entry.credential.id)) existing.keyIds.push(entry.credential.id);
          for (const method of providerModel.supportedGenerationMethods ?? []) {
            if (!existing.supportedGenerationMethods.includes(method)) existing.supportedGenerationMethods.push(method);
          }
          continue;
        }
        union.set(id, {
          id,
          displayName: providerModel.displayName || id,
          description: providerModel.description,
          releaseChannel: releaseChannelFor(providerModel, id),
          supportedGenerationMethods: [...(providerModel.supportedGenerationMethods ?? [])],
          keyIds: [entry.credential.id],
          availabilityCount: 1,
          totalKeys: pool.keys.length,
          compatibility: { ...(state.compatibility[id] ?? emptyCompatibility()) },
        });
      }
    }

    const models = [...union.values()].map((entry) => ({
      ...entry,
      keyIds: pool.keys.filter((key) => entry.keyIds.includes(key.id)).map((key) => key.id),
      availabilityCount: entry.keyIds.length,
      totalKeys: pool.keys.length,
    }));
    const now = this.now();
    return this.applyStateToSnapshot({
      poolId: pool.id,
      owner: pool.owner,
      models,
      keys: perKey.map((entry) => ({
        id: entry.credential.id,
        slot: entry.credential.slot,
        valid: entry.valid,
        modelCount: entry.models.filter((candidate) => {
          const id = candidate.name?.replace(/^models\//, "");
          return Boolean(id && isTranslationGeminiModel(candidate, id));
        }).length,
        ...(!entry.valid ? { errorCode: entry.code } : {}),
      })),
      source: "live",
      stale: false,
      discoveredAt: now,
      expiresAt: now + this.cacheTtlMs,
    }, state);
  }

  private async discoverForKey(apiKey: string, signal?: AbortSignal): Promise<ProviderModel[]> {
    const models: ProviderModel[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
      url.searchParams.set("pageSize", "1000");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      let response: Response;
      try {
        response = await this.fetchImpl(url.toString(), {
          method: "GET",
          headers: { "x-goog-api-key": apiKey },
          cache: "no-store",
          signal: signal ?? AbortSignal.timeout(10000),
        });
      } catch {
        throw new GeminiDiscoveryError("Gemini model discovery failed", "NETWORK");
      }
      if (!response.ok) {
        const code = response.status === 401 || response.status === 403 ? "UNAUTHORIZED" : `HTTP_${response.status}`;
        throw new GeminiDiscoveryError(`Gemini model discovery failed (${response.status})`, code);
      }
      let body: ProviderModelList;
      try {
        body = await response.json() as ProviderModelList;
      } catch {
        throw new GeminiDiscoveryError("Gemini model discovery returned invalid JSON", "INVALID_JSON");
      }
      models.push(...(body.models ?? []));
      pageToken = body.nextPageToken;
    } while (pageToken);
    return models;
  }

  private routesForModel(catalog: GeminiCatalogResult, model: GeminiCatalogModel, state: PoolState): GeminiRoute[] {
    return catalog.pool.keys.flatMap((key, keyIndex) => {
      if (!model.keyIds.includes(key.id)) return [];
      const cooldownUntil = state.cooldowns[routeKey(model.id, key.id)] ?? 0;
      if (cooldownUntil > this.now()) return [];
      return [{
        model: model.id,
        apiKey: key.apiKey,
        keyId: key.id,
        keyIndex,
        keySlot: key.slot,
      }];
    });
  }

  private bootstrapCatalog(pool: ActiveGeminiKeyPool, state: PoolState): GeminiCatalogSnapshot {
    const now = this.now();
    return this.applyStateToSnapshot({
      poolId: pool.id,
      owner: pool.owner,
      models: EMERGENCY_MODELS.map((id) => ({
        id,
        displayName: id,
        releaseChannel: "stable" as const,
        supportedGenerationMethods: ["generateContent"],
        keyIds: pool.keys.map((key) => key.id),
        availabilityCount: pool.keys.length,
        totalKeys: pool.keys.length,
        compatibility: { ...(state.compatibility[id] ?? emptyCompatibility()) },
      })),
      keys: pool.keys.map((key) => ({ id: key.id, slot: key.slot, valid: false, modelCount: 0, errorCode: "DISCOVERY_FAILED" })),
      source: "bootstrap",
      stale: true,
      discoveredAt: now,
      expiresAt: now,
    }, state);
  }

  private applyStateToSnapshot(snapshot: GeminiCatalogSnapshot, state: PoolState): GeminiCatalogSnapshot {
    snapshot.models = snapshot.models.filter((entry) =>
      entry.id.startsWith("gemini-") && entry.supportedGenerationMethods.includes("generateContent"),
    );
    for (const entry of snapshot.models) {
      entry.compatibility = { ...(state.compatibility[entry.id] ?? entry.compatibility ?? emptyCompatibility()) };
      entry.availabilityCount = entry.keyIds.length;
      entry.totalKeys = snapshot.keys.length || entry.totalKeys;
    }
    return snapshot;
  }

  private getState(poolId: string): PoolState {
    let state = this.states.get(poolId);
    if (!state) {
      state = { compatibility: {}, lastKnownGood: {}, cooldowns: {} };
      this.states.set(poolId, state);
    }
    return state;
  }

  private dropExpiredCooldowns(state: PoolState): void {
    const now = this.now();
    for (const [key, expiry] of Object.entries(state.cooldowns)) {
      if (expiry <= now) delete state.cooldowns[key];
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.persistPath) return;
    try {
      const parsed = JSON.parse(await readFile(this.persistPath, "utf8")) as PersistedState;
      if (parsed.version !== 1 || !parsed.pools) return;
      for (const [poolId, state] of Object.entries(parsed.pools)) {
        this.dropExpiredCooldowns(state);
        this.states.set(poolId, state);
      }
    } catch {
      // Missing/corrupt local cache is recoverable through live discovery.
    }
  }

  private async persist(): Promise<void> {
    if (!this.persistPath) return;
    const pools = Object.fromEntries([...this.states.entries()].map(([poolId, state]) => {
      this.dropExpiredCooldowns(state);
      return [poolId, state];
    }));
    const payload: PersistedState = { version: 1, pools };
    await mkdir(dirname(this.persistPath), { recursive: true });
    await writeFile(this.persistPath, JSON.stringify(payload), "utf8");
  }
}

export class GeminiDiscoveryError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "GeminiDiscoveryError";
    this.code = code;
  }
}

export const geminiCatalogManager = new GeminiCatalogManager();
