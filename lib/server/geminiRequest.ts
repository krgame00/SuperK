import {
  type TranslationObservabilityMeta,
  normalizeTranslationErrorCode,
  parseRetryAfter,
} from "@/lib/translation/requestError";
import type { GeminiRoute } from "@/lib/server/geminiCatalog";


export type GeminiErrorCode =
  | "GEMINI_TIMEOUT"
  | "GEMINI_QUOTA"
  | "GEMINI_UPSTREAM";

export class GeminiRequestError extends Error {
  readonly code: GeminiErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly nextRetryAt?: number;
  readonly model?: string;
  readonly keyId?: string;
  readonly keySlot?: number;
  readonly keyOwner?: "user" | "server";
  readonly meta?: TranslationObservabilityMeta;

  constructor(
    message: string,
    code: GeminiErrorCode,
    status: number,
    retryable: boolean,
    retryAfterMs?: number,
    route?: Pick<GeminiRoute, "model" | "keyId" | "keySlot" | "keyOwner">,
    meta?: TranslationObservabilityMeta,
    nextRetryAt?: number,
  ) {
    super(message);
    this.name = "GeminiRequestError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
    this.nextRetryAt = nextRetryAt;
    this.model = route?.model;
    this.keyId = route?.keyId;
    this.keySlot = route?.keySlot;
    this.keyOwner = route?.keyOwner;
    this.meta = meta;
  }
}

export interface GeminiRequestResult<T> {
  data: T;
  keyIndex: number;
  model: string;
  keyId?: string;
  keySlot?: number;
  meta: TranslationObservabilityMeta;
}

export type GeminiRouteFailureDirective = "continue" | "skip-model";

export interface GeminiRouteRequestOptions {
  routes: GeminiRoute[];
  payload: unknown;
  attemptTimeoutMs?: number;
  totalBudgetMs?: number;
  startedAt?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  beforeRoute?: (
    route: GeminiRoute,
  ) => GeminiRouteFailureDirective | void | Promise<GeminiRouteFailureDirective | void>;
  onRouteFailure?: (
    route: GeminiRoute,
    error: GeminiRequestError,
  ) => GeminiRouteFailureDirective | void | Promise<GeminiRouteFailureDirective | void>;
  onModelSwitch?: (event: { model: string; fallbackCount: number }) => void;
}

export interface OpenAICompatibleResult<T> {
  data: T;
  model: string;
  meta: TranslationObservabilityMeta;
}

export interface GeminiRequestOptions {
  apiKeys: string[];
  models: string[];
  payload: unknown;
  initialKeyIndex?: number;
  attemptTimeoutMs?: number;
  totalBudgetMs?: number;
  startedAt?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

interface GeminiErrorBody {
  error?: {
    message?: string;
  };
}

const TIMEOUT_MESSAGE =
  "Gemini ตอบสนองช้าเกินกำหนด กรุณาลองใหม่หรือเปลี่ยนโมเดล";

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorName(error: unknown): string | undefined {
  return typeof error === "object" && error !== null &&
    "name" in error && typeof error.name === "string"
    ? error.name
    : undefined;
}

function errorMessage(error: unknown): string | undefined {
  return typeof error === "object" && error !== null &&
    "message" in error && typeof error.message === "string"
    ? error.message
    : undefined;
}

function upstreamMessage(data: unknown, status: number): string {
  const body = data as GeminiErrorBody;
  return body?.error?.message || `Gemini request failed (${status})`;
}

function redactRouteKey(message: string, apiKey: string): string {
  return apiKey ? message.split(apiKey).join("[redacted]") : message;
}

function upstreamError(
  message: string,
  status: number,
  retryAfterMs?: number,
): GeminiRequestError {
  return new GeminiRequestError(
    message,
    status === 429 ? "GEMINI_QUOTA" : "GEMINI_UPSTREAM",
    status,
    status === 429 || status >= 500,
    retryAfterMs,
  );
}

function retryAfterMsFromHeaders(
  headers: Headers,
  nowMs = Date.now(),
): number | undefined {
  const value = headers.get("retry-after");
  if (!value) return undefined;
  return parseRetryAfter(value, nowMs);
}

function isHighDemandError(status: number, message: string): boolean {
  if (status !== 503) return false;
  const normalized = message.toLowerCase();
  return (
    normalized.includes("high demand") ||
    normalized.includes("overloaded") ||
    normalized.includes("overload") ||
    normalized.includes("temporarily unavailable")
  );
}

export async function requestGemini<T = unknown>(
  options: GeminiRequestOptions,
): Promise<GeminiRequestResult<T>> {
  const {
    apiKeys,
    models,
    payload,
    initialKeyIndex = 0,
    attemptTimeoutMs = 30_000,
    totalBudgetMs = 90_000,
    fetchImpl = globalThis.fetch,
    now = Date.now,
    sleep = defaultSleep,
  } = options;
  const startedAt = now();
  let firstHttpError: GeminiRequestError | undefined;
  let sawTransportFailure = false;
  let attemptCount = 0;
  let fallbackCount = 0;

  for (let modelIdx = 0; modelIdx < models.length; modelIdx++) {
    const model = models[modelIdx];
    let keyOffset = 0;

    keyLoop: while (keyOffset < apiKeys.length) {
      const keyIndex =
        ((initialKeyIndex + keyOffset) % apiKeys.length + apiKeys.length) %
        apiKeys.length;
      const apiKey = apiKeys[keyIndex];
      let serverRetry = 0;

      while (serverRetry <= 1) {
        const remaining = totalBudgetMs - (now() - startedAt);
        if (remaining <= 0) {
          throw new GeminiRequestError(
            TIMEOUT_MESSAGE,
            "GEMINI_TIMEOUT",
            504,
            true,
          );
        }

        attemptCount++;
        const controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort(),
          Math.min(attemptTimeoutMs, remaining),
        );
        let response: Response;

        try {
          // Key travels in a header, not the URL query string — query params
          // end up in upstream/proxy access logs; the header does not.
          response = await fetchImpl(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey,
              },
              body: JSON.stringify(payload),
              signal: controller.signal,
              cache: "no-store",
            },
          );
        } catch {
          sawTransportFailure = true;
          fallbackCount++;
          break keyLoop;
        } finally {
          clearTimeout(timer);
        }

        let data: unknown;
        try {
          data = await response.json();
        } catch {
          data = {
            error: {
              message: `Gemini returned invalid JSON (${response.status})`,
            },
          };
        }

        if (response.ok) {
          return {
            data: data as T,
            keyIndex,
            model,
            meta: {
              provider: "gemini",
              model,
              attemptCount,
              elapsedMs: now() - startedAt,
              fallbackCount,
            },
          };
        }

        const error = upstreamError(
          upstreamMessage(data, response.status),
          response.status,
          retryAfterMsFromHeaders(response.headers, now()),
        );
        firstHttpError ??= error;

        if (
          (response.status === 500 || response.status === 503) &&
          serverRetry === 0
        ) {
          serverRetry += 1;
          await sleep(1_000);
          continue;
        }

        if (
          response.status === 400 ||
          response.status === 403 ||
          response.status === 429
        ) {
          keyOffset += 1;
          fallbackCount++;
          continue keyLoop;
        }

        fallbackCount++;
        break keyLoop;
      }
    }
  }

  if (firstHttpError) {
    throw firstHttpError;
  }
  if (sawTransportFailure) {
    throw new GeminiRequestError(
      TIMEOUT_MESSAGE,
      "GEMINI_TIMEOUT",
      504,
      true,
    );
  }
  throw upstreamError("Gemini request could not be completed", 502);
}

export async function requestGeminiRoutes<T = unknown>(
  options: GeminiRouteRequestOptions,
): Promise<GeminiRequestResult<T>> {
  const {
    routes,
    payload,
    attemptTimeoutMs = 30_000,
    totalBudgetMs = 90_000,
    fetchImpl = globalThis.fetch,
    now = Date.now,
    sleep = defaultSleep,
    beforeRoute,
    onRouteFailure,
    onModelSwitch,
  } = options;
  const startedAt = options.startedAt ?? now();
  let lastError: GeminiRequestError | undefined;
  let attemptCount = 0;
  let fallbackCount = 0;
  let skippedRouteCount = 0;
  let lastCooldownReason: "quota" | "overload" | undefined;
  const skippedModels = new Set<string>();
  let lastAttemptedModel: string | undefined;

  for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) {
    const route = routes[routeIndex];
    if (skippedModels.has(route.model)) {
      skippedRouteCount++;
      continue;
    }
    if (totalBudgetMs - (now() - startedAt) <= 0) {
      throw new GeminiRequestError(TIMEOUT_MESSAGE, "GEMINI_TIMEOUT", 504, true, undefined, route);
    }
    const startDirective = await beforeRoute?.(route);
    if (totalBudgetMs - (now() - startedAt) <= 0) {
      const timeout = new GeminiRequestError(
        TIMEOUT_MESSAGE, "GEMINI_TIMEOUT", 504, true, undefined, route,
      );
      if (route.recoveryTrial && startDirective !== "skip-model") {
        await onRouteFailure?.(route, timeout);
      }
      throw timeout;
    }
    if (startDirective === "skip-model") {
      skippedRouteCount++;
      skippedModels.add(route.model);
      fallbackCount++;
      continue;
    }

    let serverRetry = 0;
    while (serverRetry <= 1) {
      const remaining = totalBudgetMs - (now() - startedAt);
      if (remaining <= 0) {
        throw new GeminiRequestError(
          TIMEOUT_MESSAGE,
          "GEMINI_TIMEOUT",
          504,
          true,
          undefined,
          route,
        );
      }

      if (lastAttemptedModel !== undefined && lastAttemptedModel !== route.model) {
        onModelSwitch?.({ model: route.model, fallbackCount });
      }
      lastAttemptedModel = route.model;
      attemptCount++;
      const routeAttemptStartedAt = now();
      const controller = new AbortController();
      let timeoutFired = false;
      let timer: ReturnType<typeof setTimeout>;
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timeoutFired = true;
          controller.abort();
          reject(new DOMException("Gemini route deadline exceeded", "TimeoutError"));
        }, Math.min(attemptTimeoutMs, remaining));
      });

      let response: Response;
      let data: unknown;
      try {
        ({ response, data } = await Promise.race([
          (async () => {
            const upstream = await fetchImpl(
              `https://generativelanguage.googleapis.com/v1beta/models/${route.model}:generateContent`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-goog-api-key": route.apiKey,
                },
                body: JSON.stringify(payload),
                signal: controller.signal,
                cache: "no-store",
              },
            );
            let body: unknown;
            try {
              body = await upstream.json();
            } catch (jsonErr: unknown) {
              if (timeoutFired || controller.signal.aborted) throw jsonErr;
              body = {
                error: {
                  message: `Gemini returned invalid JSON (${upstream.status})`,
                },
              };
            }
            return { response: upstream, data: body };
          })(),
          deadline,
        ]));
      } catch (fetchOrBodyErr: unknown) {
        const isTimeout =
          timeoutFired ||
          controller.signal.aborted ||
          errorName(fetchOrBodyErr) === "AbortError" ||
          errorName(fetchOrBodyErr) === "TimeoutError";
        const error = isTimeout
          ? new GeminiRequestError(
              TIMEOUT_MESSAGE,
              "GEMINI_TIMEOUT",
              504,
              true,
              undefined,
              route,
            )
          : new GeminiRequestError(
              redactRouteKey(
                errorMessage(fetchOrBodyErr) || "Gemini network transport error",
                route.apiKey,
              ),
              "GEMINI_UPSTREAM",
              502,
              true,
              undefined,
              route,
            );
        lastError = error;
        lastCooldownReason = undefined;
        const directive = await onRouteFailure?.(route, error);
        fallbackCount++;
        if (directive === "skip-model") {
          skippedModels.add(route.model);
        }
        break;
      } finally {
        clearTimeout(timer!);
      }

      if (response.ok) {
        return {
          data: data as T,
          keyIndex: route.keyIndex,
          keyId: route.keyId,
          keySlot: route.keySlot,
          model: route.model,
          meta: {
            provider: "gemini",
            model: route.model,
            keyId: route.keyId,
            keySlot: route.keySlot,
            keyOwner: route.keyOwner,
            attemptCount,
            elapsedMs: now() - startedAt,
            routeElapsedMs: now() - routeAttemptStartedAt,
            fallbackCount,
            skippedRouteCount,
          },
        };
      }

      const message = redactRouteKey(
        upstreamMessage(data, response.status),
        route.apiKey,
      );
      const retryAfterMs = retryAfterMsFromHeaders(response.headers, now());
      const error = new GeminiRequestError(
        message,
        response.status === 429 ? "GEMINI_QUOTA" : "GEMINI_UPSTREAM",
        response.status,
        response.status === 429 || response.status >= 500,
        retryAfterMs,
        route,
      );
      lastError = error;
      const highDemand = isHighDemandError(response.status, message);
      lastCooldownReason =
        response.status === 429 ? "quota" : highDemand ? "overload" : undefined;

      if (
        (response.status === 500 || response.status === 502 || response.status === 503) &&
        !highDemand &&
        serverRetry === 0
      ) {
        serverRetry += 1;
        const retryRemaining = totalBudgetMs - (now() - startedAt);
        if (retryRemaining <= 0) {
          throw new GeminiRequestError(
            TIMEOUT_MESSAGE,
            "GEMINI_TIMEOUT",
            504,
            true,
            undefined,
            route,
          );
        }
        await sleep(Math.min(1_000, retryRemaining));
        continue;
      }

      const directive = await onRouteFailure?.(route, error);
      fallbackCount++;
      if (directive === "skip-model") {
        skippedModels.add(route.model);
      }
      break;
    }
  }

  if (lastError) {
    const route = lastError.model && lastError.keyId && lastError.keySlot !== undefined
      ? {
          model: lastError.model,
          keyId: lastError.keyId,
          keySlot: lastError.keySlot,
          keyOwner: lastError.keyOwner,
        }
      : undefined;
    throw new GeminiRequestError(
      lastError.message,
      lastError.code,
      lastError.status,
      lastError.retryable,
      lastError.retryAfterMs,
      route,
      {
        provider: "gemini",
        model: lastError.model ?? "unknown",
        keyId: lastError.keyId,
        keySlot: lastError.keySlot,
        keyOwner: lastError.keyOwner,
        attemptCount,
        elapsedMs: now() - startedAt,
        fallbackCount,
        skippedRouteCount,
        cooldownReason: lastCooldownReason,
        finalErrorCode: normalizeTranslationErrorCode(lastError.code),
      },
    );
  }
  throw upstreamError("Gemini request could not be completed", 502);
}

export interface OpenAICompatibleOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  payload: Record<string, unknown>;
  attemptTimeoutMs?: number;
  totalBudgetMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export async function requestOpenAICompatible<T = unknown>(
  options: OpenAICompatibleOptions,
): Promise<OpenAICompatibleResult<T>> {
  const {
    baseUrl,
    apiKey,
    model,
    payload,
    attemptTimeoutMs = 60_000,
    totalBudgetMs = 180_000,
    fetchImpl = globalThis.fetch,
    now = Date.now,
    sleep = defaultSleep,
  } = options;

  const startedAt = now();
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const url = normalizedBase.endsWith("/chat/completions")
    ? normalizedBase
    : `${normalizedBase}/chat/completions`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  let firstHttpError: GeminiRequestError | undefined;
  let sawTransportFailure = false;
  let retryAttempt = 0;
  let attemptCount = 0;

  while (now() - startedAt < totalBudgetMs) {
    const remaining = totalBudgetMs - (now() - startedAt);
    if (remaining <= 0) {
      throw new GeminiRequestError(
        TIMEOUT_MESSAGE,
        "GEMINI_TIMEOUT",
        504,
        true,
      );
    }

    attemptCount++;
    const controller = new AbortController();
    let timeoutFired = false;
    const timer = setTimeout(
      () => {
        timeoutFired = true;
        controller.abort();
      },
      Math.min(attemptTimeoutMs, remaining),
    );
    let response: Response;
    let data: unknown;

    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...payload, model }),
        signal: controller.signal,
        cache: "no-store",
      });

      try {
        data = await response.json();
      } catch (jsonErr: unknown) {
        if (timeoutFired || controller.signal.aborted) {
          throw jsonErr;
        }
        data = {
          error: {
            message: `OpenAI-compatible returned invalid JSON (${response.status})`,
          },
        };
      }
    } catch (fetchOrBodyErr: unknown) {
      sawTransportFailure = true;
      const isTimeout =
        timeoutFired ||
        controller.signal.aborted ||
        errorName(fetchOrBodyErr) === "AbortError" ||
        errorName(fetchOrBodyErr) === "TimeoutError";
      if (isTimeout) {
        firstHttpError ??= new GeminiRequestError(
          TIMEOUT_MESSAGE,
          "GEMINI_TIMEOUT",
          504,
          true,
        );
      } else {
        firstHttpError ??= new GeminiRequestError(
          errorMessage(fetchOrBodyErr) || "OpenAI-compatible network transport error",
          "GEMINI_UPSTREAM",
          502,
          true,
        );
      }
      break;
    } finally {
      clearTimeout(timer);
    }

    if (response.ok) {
      return {
        data: data as T,
        model,
        meta: {
          provider: "openai_compatible",
          model,
          attemptCount,
          elapsedMs: now() - startedAt,
          fallbackCount: retryAttempt,
        },
      };
    }

    const error = upstreamError(
      upstreamMessage(data, response.status),
      response.status,
      retryAfterMsFromHeaders(response.headers, now()),
    );
    firstHttpError ??= error;

    // Retry on 429 (Rate Limit / Quota) and 5xx (Server Busy / Bad Gateway) with Exponential Backoff
    if (response.status === 429 || response.status >= 500) {
      retryAttempt++;
      if (retryAttempt <= 3) {
        const delayMs =
          response.status === 429
            ? Math.min(2000 * Math.pow(2, retryAttempt - 1), 8000)
            : 1000 * retryAttempt;
        await sleep(delayMs);
        continue;
      }
    }
    break;
  }

  if (firstHttpError) throw firstHttpError;
  if (sawTransportFailure) {
    throw new GeminiRequestError(
      TIMEOUT_MESSAGE,
      "GEMINI_TIMEOUT",
      504,
      true,
    );
  }
  throw upstreamError("OpenAI-compatible request could not be completed", 502);
}
