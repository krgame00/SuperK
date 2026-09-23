export type TranslationErrorCode =
  | "timeout"
  | "quota"
  | "auth"
  | "bad_request"
  | "model_unavailable"
  | "safety"
  | "network"
  | "upstream"
  | "cancelled";

export interface TranslationObservabilityMeta {
  provider: "gemini" | "openai_compatible" | "mock";
  model: string;
  attemptCount: number;
  elapsedMs: number;
  routeElapsedMs?: number;
  fallbackCount: number;
  skippedRouteCount?: number;
  keySlot?: number;
  keyId?: string;
  keyOwner?: "user" | "server";
  cooldownReason?: "quota" | "overload";
  finalErrorCode?: TranslationErrorCode;
}

export function normalizeTranslationErrorCode(
  codeOrStatus?: string | number | null,
  fallback: TranslationErrorCode = "upstream",
): TranslationErrorCode {
  if (!codeOrStatus) return fallback;

  if (typeof codeOrStatus === "number") {
    if (codeOrStatus === 400 || codeOrStatus === 413 || codeOrStatus === 415)
      return "bad_request";
    if (codeOrStatus === 401 || codeOrStatus === 403) return "auth";
    if (codeOrStatus === 404) return "model_unavailable";
    if (codeOrStatus === 429) return "quota";
    if (codeOrStatus === 504) return "timeout";
    if (codeOrStatus >= 500) return "upstream";
    return fallback;
  }

  const normalized = String(codeOrStatus).toLowerCase();
  if (normalized.includes("timeout") || normalized === "gemini_timeout")
    return "timeout";
  if (
    normalized.includes("quota") ||
    normalized === "gemini_quota" ||
    normalized.includes("rate")
  )
    return "quota";
  if (normalized.includes("auth") || normalized.includes("key"))
    return "auth";
  if (
    normalized.includes("safety") ||
    normalized.includes("blocked") ||
    normalized.includes("prohibited") ||
    normalized.includes("filter")
  )
    return "safety";
  if (normalized.includes("network") || normalized.includes("fetch"))
    return "network";
  if (normalized.includes("cancel") || normalized.includes("abort"))
    return "cancelled";
  if (
    normalized.includes("bad") ||
    normalized.includes("invalid") ||
    normalized.includes("large")
  )
    return "bad_request";
  if (normalized.includes("model")) return "model_unavailable";
  if (normalized.includes("upstream") || normalized === "gemini_upstream")
    return "upstream";

  return fallback;
}

interface TranslationErrorBody {
  error?: string;
  code?: string;
  retryable?: boolean;
  retryAfterMs?: number;
  nextRetryAt?: number;
  model?: string;
  meta?: TranslationObservabilityMeta;
}

export const DEFAULT_QUOTA_COOLDOWN_MS = 60_000;
export const MAX_QUOTA_COOLDOWN_MS = 15 * 60_000;

/** Normalize Retry-After seconds or HTTP-date into a bounded client delay. */
export function parseRetryAfter(
  value: string | null | undefined,
  nowMs = Date.now(),
  fallbackMs = DEFAULT_QUOTA_COOLDOWN_MS,
): number {
  const fallback = Math.min(Math.max(fallbackMs, 0), MAX_QUOTA_COOLDOWN_MS);
  if (!value) return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) {
    if (seconds < 0) return fallback;
    return Math.min(Math.round(seconds * 1000), MAX_QUOTA_COOLDOWN_MS);
  }
  const timestamp = Date.parse(trimmed);
  if (!Number.isFinite(timestamp)) return fallback;
  if (timestamp <= nowMs) return fallback;
  return Math.min(timestamp - nowMs, MAX_QUOTA_COOLDOWN_MS);
}

export class TranslationRequestError extends Error {
  readonly code: string;
  readonly category: TranslationErrorCode;
  readonly retryable: boolean;
  readonly status: number;
  readonly retryAfterMs?: number;
  readonly nextRetryAt?: number;
  readonly model?: string;
  readonly meta?: TranslationObservabilityMeta;

  constructor(
    message: string,
    status: number,
    code?: string,
    retryable = false,
    retryAfterMs?: number,
    nextRetryAt?: number,
    model?: string,
    meta?: TranslationObservabilityMeta,
  ) {
    super(message);
    this.name = "TranslationRequestError";
    this.code = code || normalizeTranslationErrorCode(status);
    this.category = normalizeTranslationErrorCode(code || status);
    this.retryable = retryable;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.nextRetryAt = nextRetryAt;
    this.model = model;
    this.meta = meta;
  }
}

export async function readTranslationResponse<T>(
  response: Response,
  onModelSwitch?: (event: { model: string; fallbackCount: number }) => void,
): Promise<T> {
  let data: unknown;
  let status = response.status;
  if (response.headers.get("content-type")?.includes("application/x-ndjson")) {
    if (!response.body) {
      throw new TranslationRequestError(
        "Network error: translation stream has no body", 0, "NETWORK", true,
      );
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let hasResult = false;
    const consume = (line: string) => {
      if (!line.trim()) return;
      const event = JSON.parse(line) as {
        type?: string;
        model?: string;
        fallbackCount?: number;
        status?: number;
        data?: unknown;
      };
      if (event.type === "model-switch" && typeof event.model === "string") {
        onModelSwitch?.({
          model: event.model,
          fallbackCount: typeof event.fallbackCount === "number" ? event.fallbackCount : 0,
        });
      } else if (event.type === "result") {
        status = typeof event.status === "number" ? event.status : 500;
        data = event.data;
        hasResult = true;
      }
    };
    try {
      while (true) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch (error) {
          if (isUserCancelledError(error)) throw error;
          throw new TranslationRequestError(
            "Network error: translation stream interrupted", 0, "NETWORK", true,
          );
        }
        if (chunk.done) break;
        pending += decoder.decode(chunk.value, { stream: true });
        let newline = pending.indexOf("\n");
        while (newline >= 0) {
          consume(pending.slice(0, newline));
          pending = pending.slice(newline + 1);
          newline = pending.indexOf("\n");
        }
      }
      pending += decoder.decode();
      if (pending.trim()) consume(pending);
    } finally {
      reader.releaseLock();
    }
    if (!hasResult) {
      throw new TranslationRequestError(
        "Network error: translation stream ended without a result", 0, "NETWORK", true,
      );
    }
  } else {
    data = await response.json();
  }
  if (status < 200 || status >= 300) {
    const error = data as TranslationErrorBody;
    throw new TranslationRequestError(
      error?.error || `Translation request failed (${status})`,
      status,
      error.code,
      error.retryable === true,
      typeof error.retryAfterMs === "number" ? error.retryAfterMs : undefined,
      typeof error.nextRetryAt === "number" ? error.nextRetryAt : undefined,
      typeof error.model === "string" ? error.model : undefined,
      error.meta,
    );
  }
  return data as T;
}

export function isUserCancelledError(error: unknown): boolean {
  if (!error) return false;
  if (
    error instanceof TranslationRequestError &&
    (error.category === "cancelled" || error.code === "cancelled")
  ) {
    return true;
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name: string }).name === "AbortError"
  ) {
    return true;
  }
  return false;
}

export function shouldAutoRetryTranslation(
  error: unknown,
  completedRetries: number = 0,
): boolean {
  return (
    completedRetries < 1 &&
    error instanceof TranslationRequestError &&
    error.retryable &&
    error.category === "network"
  );
}

export function getTranslationRetryDelay(
  error: unknown,
  attempt: number = 0,
): number | null {
  if (!(error instanceof TranslationRequestError) || !error.retryable) {
    return null;
  }
  if (
    error.code === "GEMINI_QUOTA" ||
    error.code === "quota" ||
    error.category === "quota"
  ) {
    return 60_000;
  }
  if (
    error.code === "GEMINI_TIMEOUT" ||
    error.code === "timeout" ||
    error.category === "timeout"
  ) {
    return 5_000;
  }
  return Math.min(30_000, 2000 * Math.pow(2, attempt));
}
