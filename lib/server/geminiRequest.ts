import {
  type TranslationObservabilityMeta,
} from "@/lib/translation/requestError";

export type GeminiErrorCode =
  | "GEMINI_TIMEOUT"
  | "GEMINI_QUOTA"
  | "GEMINI_UPSTREAM";

export class GeminiRequestError extends Error {
  readonly code: GeminiErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(
    message: string,
    code: GeminiErrorCode,
    status: number,
    retryable: boolean,
  ) {
    super(message);
    this.name = "GeminiRequestError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export interface GeminiRequestResult<T> {
  data: T;
  keyIndex: number;
  model: string;
  meta: TranslationObservabilityMeta;
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

function upstreamMessage(data: unknown, status: number): string {
  const body = data as GeminiErrorBody;
  return body?.error?.message || `Gemini request failed (${status})`;
}

function upstreamError(
  message: string,
  status: number,
): GeminiRequestError {
  return new GeminiRequestError(
    message,
    status === 429 ? "GEMINI_QUOTA" : "GEMINI_UPSTREAM",
    status,
    status === 429 || status >= 500,
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
          response = await fetchImpl(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
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
    const timer = setTimeout(
      () => controller.abort(),
      Math.min(attemptTimeoutMs, remaining),
    );
    let response: Response;

    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...payload, model }),
        signal: controller.signal,
        cache: "no-store",
      });
    } catch {
      sawTransportFailure = true;
      break;
    } finally {
      clearTimeout(timer);
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      data = {
        error: {
          message: `OpenAI-compatible returned invalid JSON (${response.status})`,
        },
      };
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
