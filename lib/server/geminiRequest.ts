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

  for (const model of models) {
    let keyOffset = 0;

    keyLoop: while (keyOffset < apiKeys.length) {
      const keyIndex =
        ((initialKeyIndex + keyOffset) % apiKeys.length + apiKeys.length)
        % apiKeys.length;
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
          };
        }

        const error = upstreamError(
          upstreamMessage(data, response.status),
          response.status,
        );
        firstHttpError ??= error;

        if ((response.status === 500 || response.status === 503)
          && serverRetry === 0) {
          serverRetry += 1;
          await sleep(1_000);
          continue;
        }

        if (
          response.status === 400
          || response.status === 403
          || response.status === 429
        ) {
          keyOffset += 1;
          continue keyLoop;
        }

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
