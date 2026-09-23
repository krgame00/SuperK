import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export type GeminiWorkflow = "text" | "image";
export type GeminiCompatibility = "unverified" | "compatible" | "incompatible";
export type GeminiReleaseChannel = "stable" | "preview" | "experimental";
export type GeminiCatalogSource = "live" | "cache" | "bootstrap";
export type GeminiKeyPoolOwner = "user" | "server";
export type GeminiEffectivePoolOwner = GeminiKeyPoolOwner | "mixed";

export interface GeminiKeyCredential {
  id: string;
  slot: number;
  apiKey: string;
  owner: GeminiKeyPoolOwner;
}

export interface ActiveGeminiKeyPool {
  id: string;
  owner: GeminiEffectivePoolOwner;
  keys: GeminiKeyCredential[];
}

export interface GeminiCatalogKeyStatus {
  id: string;
  slot: number;
  owner: GeminiKeyPoolOwner;
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
  owner: GeminiEffectivePoolOwner;
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
  keyOwner?: GeminiKeyPoolOwner;
  recoveryTrial?: boolean;
}

export interface PlanGeminiRoutesOptions {
  workflow: GeminiWorkflow;
  modelPreference?: string;
  allowPreview?: boolean;
}

export type GeminiModelHealthStatus =
  | "ready"
  | "partial_quota"
  | "quota_cooldown"
  | "high_demand"
  | "recovery";

export interface GeminiModelHealth {
  status: GeminiModelHealthStatus;
  cooldownKeys: number;
  overloadUntil?: number;
  nextRetryAt?: number;
  recoveryInFlight: boolean;
}

export type GeminiRouteFailureKind =
  | "quota"
  | "overload"
  | "capability"
  | "transient";

export interface GeminiRouteOutcome {
  workflow: GeminiWorkflow;
  model: string;
  keyId: string;
  elapsedMs?: number;
}

export interface GeminiRouteFailure extends GeminiRouteOutcome {
  kind: GeminiRouteFailureKind;
  retryAfterMs?: number;
}

export type GeminiRoutingErrorCode =
  | "GEMINI_API_KEY_MISSING"
  | "GEMINI_MODEL_UNAVAILABLE"
  | "GEMINI_MODEL_INCOMPATIBLE"
  | "GEMINI_ROUTE_UNAVAILABLE"
  | "GEMINI_ROUTE_COOLDOWN"
  | "GEMINI_MODEL_OVERLOADED";

export class GeminiRoutingError extends Error {
  readonly code: GeminiRoutingErrorCode;
  readonly model?: string;
  readonly retryAfterMs?: number;
  readonly nextRetryAt?: number;

  constructor(
    message: string,
    code: GeminiRoutingErrorCode,
    model?: string,
    retryAfterMs?: number,
    nextRetryAt?: number,
  ) {
    super(message);
    this.name = "GeminiRoutingError";
    this.code = code;
    this.model = model;
    this.retryAfterMs = retryAfterMs;
    this.nextRetryAt = nextRetryAt;
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

interface LastKnownGoodState {
  model: string;
  succeededAt: number;
}

interface ModelLatencyState {
  ewmaMs: number;
  samples: number;
  updatedAt: number;
}

interface PoolState {
  catalog?: GeminiCatalogSnapshot;
  compatibility: Record<string, ModelState>;
  lastKnownGood: Partial<Record<GeminiWorkflow, LastKnownGoodState>>;
  latency: Partial<Record<GeminiWorkflow, Record<string, ModelLatencyState>>>;
  cooldowns: Record<string, number>;
}

interface ModelOverloadState {
  cooldownUntil: number;
  halfOpenInFlight: boolean;
}

interface PersistedState {
  version: 1 | 2;
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
const MODEL_OVERLOAD_COOLDOWN_MS = 30_000;
const LAST_KNOWN_GOOD_TTL_MS = 24 * 60 * 60 * 1000;
const LATENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LATENCY_EWMA_ALPHA = 0.35;
const EMERGENCY_MODELS = ["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export function getGeminiKeyLimit(): number {
  const parsed = Number(process.env.SUPERK_GEMINI_MAX_KEYS ?? "10");
  if (!Number.isFinite(parsed)) return 10;
  return Math.min(50, Math.max(1, Math.floor(parsed)));
}

export function splitGeminiApiKeys(
  raw?: string | null,
  limit = getGeminiKeyLimit(),
): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean))]
    .slice(0, limit);
}

export function resolveActiveGeminiKeyPool(
  userApiKeyRaw?: string | null,
  serverApiKeyRaw?: string | null,
): ActiveGeminiKeyPool {
  const limit = getGeminiKeyLimit();
  const userKeys = splitGeminiApiKeys(userApiKeyRaw, limit);
  const serverKeys = splitGeminiApiKeys(serverApiKeyRaw, limit);

  const seen = new Set<string>();
  const ownedKeys: Array<{ apiKey: string; owner: GeminiKeyPoolOwner }> = [];
  for (const [owner, values] of [
    ["user", userKeys] as const,
    ["server", serverKeys] as const,
  ]) {
    for (const apiKey of values) {
      if (seen.has(apiKey) || ownedKeys.length >= limit) continue;
      seen.add(apiKey);
      ownedKeys.push({ apiKey, owner });
    }
  }

  const keys = ownedKeys.map(({ apiKey, owner }, index) => ({
    apiKey,
    owner,
    slot: index + 1,
    id: `key-${fingerprint(apiKey)}`,
  }));
  const owner: GeminiEffectivePoolOwner =
    keys.some((key) => key.owner === "user") && keys.some((key) => key.owner === "server")
      ? "mixed"
      : keys[0]?.owner ?? "server";
  const poolHash = fingerprint(
    keys.map((key) => `${key.owner}:${key.id}`).join("|"),
  );
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
  private readonly overloads = new Map<string, Record<string, ModelOverloadState>>();
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
        const nextRetryAt = this.earliestRetryAt(catalog, selected.id, state);
        const retryAfterMs = nextRetryAt
          ? Math.max(0, nextRetryAt - this.now())
          : undefined;
        const overload = this.getOverloadState(catalog.pool.id, selected.id);
        throw new GeminiRoutingError(
          `Gemini model ${manual} has no eligible key route right now`,
          overload && overload.cooldownUntil > this.now()
            ? "GEMINI_MODEL_OVERLOADED"
            : nextRetryAt
              ? "GEMINI_ROUTE_COOLDOWN"
              : "GEMINI_ROUTE_UNAVAILABLE",
          manual,
          retryAfterMs,
          nextRetryAt,
        );
      }
      return routes;
    }

    const candidates = catalog.snapshot.models.filter((entry) => {
      if (entry.compatibility[options.workflow] === "incompatible") return false;
      return options.allowPreview || entry.releaseChannel === "stable";
    });
    const lastKnownGood = state.lastKnownGood[options.workflow];
    const freshLastKnownGood =
      lastKnownGood &&
      this.now() - lastKnownGood.succeededAt <= LAST_KNOWN_GOOD_TTL_MS
        ? lastKnownGood.model
        : undefined;
    const latency = state.latency[options.workflow] ?? {};
    const releaseRank: Record<GeminiReleaseChannel, number> = {
      stable: 0,
      preview: 1,
      experimental: 2,
    };
    const compatibilityRank = (value: GeminiCompatibility) =>
      value === "compatible" ? 0 : value === "unverified" ? 1 : 2;

    candidates.sort((a, b) => {
      const lastKnownGoodDelta =
        Number(b.id === freshLastKnownGood) - Number(a.id === freshLastKnownGood);
      if (lastKnownGoodDelta !== 0) return lastKnownGoodDelta;

      const compatibilityDelta =
        compatibilityRank(a.compatibility[options.workflow]) -
        compatibilityRank(b.compatibility[options.workflow]);
      if (compatibilityDelta !== 0) return compatibilityDelta;

      const releaseDelta = releaseRank[a.releaseChannel] - releaseRank[b.releaseChannel];
      if (releaseDelta !== 0) return releaseDelta;

      const aLatency = latency[a.id]?.ewmaMs;
      const bLatency = latency[b.id]?.ewmaMs;
      if (aLatency !== undefined && bLatency !== undefined && aLatency !== bLatency) {
        return aLatency - bLatency;
      }
      if (aLatency !== undefined) return -1;
      if (bLatency !== undefined) return 1;
      return 0;
    });

    const routes = candidates.flatMap((entry) =>
      this.routesForModel(catalog, entry, state),
    );
    // Preserve model ranking inside each ownership domain, while keeping the
    // user's entire route pool ahead of server-owned fallback credentials.
    routes.sort((a, b) =>
      Number(a.keyOwner === "server") - Number(b.keyOwner === "server"),
    );
    if (routes.length === 0) {
      const nextRetryAt = candidates
        .map((entry) => this.earliestRetryAt(catalog, entry.id, state))
        .filter((value): value is number => typeof value === "number")
        .sort((a, b) => a - b)[0];
      throw new GeminiRoutingError(
        "No eligible Gemini route is available",
        nextRetryAt ? "GEMINI_ROUTE_COOLDOWN" : "GEMINI_ROUTE_UNAVAILABLE",
        undefined,
        nextRetryAt ? Math.max(0, nextRetryAt - this.now()) : undefined,
        nextRetryAt,
      );
    }
    return routes;
  }

  claimRecoveryTrial(poolId: string, model: string): boolean {
    const overload = this.getOverloadState(poolId, model);
    if (!overload || overload.cooldownUntil > this.now()) return false;
    if (overload.halfOpenInFlight) return false;
    overload.halfOpenInFlight = true;
    return true;
  }

  releaseRecoveryTrial(poolId: string, model: string): void {
    const overload = this.getOverloadState(poolId, model);
    if (overload) overload.halfOpenInFlight = false;
  }

  async recordSuccess(catalog: GeminiCatalogResult, outcome: GeminiRouteOutcome): Promise<void> {
    await this.ensureLoaded();
    const state = this.getState(catalog.pool.id);
    const compatibility = state.compatibility[outcome.model] ?? emptyCompatibility();
    compatibility[outcome.workflow] = "compatible";
    state.compatibility[outcome.model] = compatibility;
    state.lastKnownGood[outcome.workflow] = {
      model: outcome.model,
      succeededAt: this.now(),
    };
    if (typeof outcome.elapsedMs === "number" && outcome.elapsedMs >= 0) {
      const workflowLatency = state.latency[outcome.workflow] ?? {};
      const current = workflowLatency[outcome.model];
      workflowLatency[outcome.model] = {
        ewmaMs: current
          ? (LATENCY_EWMA_ALPHA * outcome.elapsedMs) +
            ((1 - LATENCY_EWMA_ALPHA) * current.ewmaMs)
          : outcome.elapsedMs,
        samples: (current?.samples ?? 0) + 1,
        updatedAt: this.now(),
      };
      state.latency[outcome.workflow] = workflowLatency;
    }
    delete state.cooldowns[routeKey(outcome.model, outcome.keyId)];
    this.clearModelOverload(catalog.pool.id, outcome.model);
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
      this.releaseRecoveryTrial(catalog.pool.id, failure.model);
    } else if (failure.kind === "overload") {
      this.setModelOverload(catalog.pool.id, failure.model);
    } else if (failure.kind === "capability") {
      const compatibility = state.compatibility[failure.model] ?? emptyCompatibility();
      compatibility[failure.workflow] = "incompatible";
      state.compatibility[failure.model] = compatibility;
      if (state.lastKnownGood[failure.workflow]?.model === failure.model) {
        delete state.lastKnownGood[failure.workflow];
      }
      this.releaseRecoveryTrial(catalog.pool.id, failure.model);
    } else {
      this.releaseRecoveryTrial(catalog.pool.id, failure.model);
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

  getModelHealth(catalog: GeminiCatalogResult, modelId: string): GeminiModelHealth {
    const model = catalog.snapshot.models.find((entry) => entry.id === modelId);
    const state = this.getState(catalog.pool.id);
    const overload = this.getOverloadState(catalog.pool.id, modelId);
    const now = this.now();
    const overloadActive = overload && overload.cooldownUntil > now;
    const recoveryInFlight = Boolean(
      overload && overload.cooldownUntil <= now && overload.halfOpenInFlight,
    );
    const keyIds = model?.keyIds ?? [];
    const cooldowns = keyIds
      .map((keyId) => state.cooldowns[routeKey(modelId, keyId)] ?? 0)
      .filter((until) => until > now);
    const cooldownKeys = cooldowns.length;
    const routeReadyCount = Math.max(0, keyIds.length - cooldownKeys);
    const nextRetryAt = overloadActive
      ? this.earliestRetryAt(catalog, modelId, state)
      : cooldowns.sort((a, b) => a - b)[0];

    let status: GeminiModelHealthStatus = "ready";
    if (overloadActive) status = "high_demand";
    else if (recoveryInFlight || (overload && overload.cooldownUntil <= now)) {
      status = "recovery";
    } else if (keyIds.length > 0 && routeReadyCount === 0) status = "quota_cooldown";
    else if (cooldownKeys > 0) status = "partial_quota";

    return {
      status,
      cooldownKeys,
      overloadUntil: overloadActive ? overload.cooldownUntil : undefined,
      nextRetryAt,
      recoveryInFlight,
    };
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
        owner: entry.credential.owner,
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

  private routesForModel(
    catalog: GeminiCatalogResult,
    model: GeminiCatalogModel,
    state: PoolState,
  ): GeminiRoute[] {
    const overload = this.getOverloadState(catalog.pool.id, model.id);
    const now = this.now();
    if (overload && overload.cooldownUntil > now) return [];

    const eligible = catalog.pool.keys.flatMap((key, keyIndex) => {
      if (!model.keyIds.includes(key.id)) return [];
      const cooldownUntil = state.cooldowns[routeKey(model.id, key.id)] ?? 0;
      if (cooldownUntil > now) return [];
      return [{
        model: model.id,
        apiKey: key.apiKey,
        keyId: key.id,
        keyIndex,
        keySlot: key.slot,
        keyOwner: key.owner,
      } satisfies GeminiRoute];
    });

    if (!overload) return eligible;
    if (overload.halfOpenInFlight) return [];
    return eligible.length > 0
      ? [{ ...eligible[0], recoveryTrial: true }]
      : [];
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
      keys: pool.keys.map((key) => ({
        id: key.id,
        slot: key.slot,
        owner: key.owner,
        valid: false,
        modelCount: 0,
        errorCode: "DISCOVERY_FAILED",
      })),
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
      state = {
        compatibility: {},
        lastKnownGood: {},
        latency: {},
        cooldowns: {},
      };
      this.states.set(poolId, state);
    }
    state.latency ??= {};
    return state;
  }

  private getOverloadState(
    poolId: string,
    model: string,
  ): ModelOverloadState | undefined {
    return this.overloads.get(poolId)?.[model];
  }

  private setModelOverload(poolId: string, model: string): void {
    const byModel = this.overloads.get(poolId) ?? {};
    byModel[model] = {
      cooldownUntil: this.now() + MODEL_OVERLOAD_COOLDOWN_MS,
      halfOpenInFlight: false,
    };
    this.overloads.set(poolId, byModel);
  }

  private clearModelOverload(poolId: string, model: string): void {
    const byModel = this.overloads.get(poolId);
    if (!byModel) return;
    delete byModel[model];
    if (Object.keys(byModel).length === 0) this.overloads.delete(poolId);
  }

  private earliestRetryAt(
    catalog: GeminiCatalogResult,
    modelId: string,
    state: PoolState,
  ): number | undefined {
    const model = catalog.snapshot.models.find((entry) => entry.id === modelId);
    const overload = this.getOverloadState(catalog.pool.id, modelId);
    if (overload?.halfOpenInFlight) return undefined;
    const now = this.now();
    const modelReadyAt = overload?.cooldownUntil ?? now;
    const candidates = (model?.keyIds ?? []).map((keyId) =>
      Math.max(modelReadyAt, state.cooldowns[routeKey(modelId, keyId)] ?? now),
    );
    return candidates.filter((until) => until > now).sort((a, b) => a - b)[0];
  }

  private dropExpiredCooldowns(state: PoolState): void {
    const now = this.now();
    for (const [key, expiry] of Object.entries(state.cooldowns)) {
      if (expiry <= now) delete state.cooldowns[key];
    }
  }

  private dropStaleLatency(state: PoolState): void {
    const now = this.now();
    for (const workflow of ["text", "image"] as const) {
      const values = state.latency[workflow];
      if (!values) continue;
      for (const [model, sample] of Object.entries(values)) {
        if (now - sample.updatedAt > LATENCY_TTL_MS) delete values[model];
      }
    }
  }

  private normalizePersistedState(raw: PoolState): PoolState {
    const rawLastKnownGood = (raw as unknown as {
      lastKnownGood?: Partial<Record<GeminiWorkflow, string | LastKnownGoodState>>;
    }).lastKnownGood ?? {};
    const lastKnownGood: Partial<Record<GeminiWorkflow, LastKnownGoodState>> = {};
    for (const workflow of ["text", "image"] as const) {
      const value = rawLastKnownGood[workflow];
      if (typeof value === "string") {
        lastKnownGood[workflow] = { model: value, succeededAt: 0 };
      } else if (
        value &&
        typeof value.model === "string" &&
        typeof value.succeededAt === "number"
      ) {
        lastKnownGood[workflow] = value;
      }
    }
    return {
      catalog: raw.catalog,
      compatibility: raw.compatibility ?? {},
      lastKnownGood,
      latency: raw.latency ?? {},
      cooldowns: raw.cooldowns ?? {},
    };
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.persistPath) return;
    try {
      const parsed = JSON.parse(await readFile(this.persistPath, "utf8")) as PersistedState;
      if ((parsed.version !== 1 && parsed.version !== 2) || !parsed.pools) return;
      for (const [poolId, rawState] of Object.entries(parsed.pools)) {
        const state = this.normalizePersistedState(rawState);
        this.dropExpiredCooldowns(state);
        this.dropStaleLatency(state);
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
      this.dropStaleLatency(state);
      return [poolId, state];
    }));
    const payload: PersistedState = { version: 2, pools };
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
