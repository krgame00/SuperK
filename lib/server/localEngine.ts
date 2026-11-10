import { GeminiRequestError } from "@/lib/server/geminiRequest";
import { normalizeLocalBaseUrl } from "@/lib/translation/modelPreference";

export type LocalProbeResult =
  | { ok: true; baseUrl: string; models: Array<{ id: string }>; latencyMs: number }
  | { ok: false; baseUrl: string; code: "LOCAL_UNREACHABLE" | "LOCAL_BAD_RESPONSE"; error: string };

export type LocalErrorCode = "LOCAL_NOT_CONFIGURED" | "LOCAL_UNREACHABLE" | "LOCAL_FAILED";

export interface LocalErrorBody {
  error: string;
  code: LocalErrorCode;
  engine: "local";
  retryable?: boolean;
  retryAfterMs?: number;
}

export function localNotConfiguredBody(): LocalErrorBody {
  return {
    error: "Local engine selected but not configured (base URL or model missing). Set it in Settings.",
    code: "LOCAL_NOT_CONFIGURED",
    engine: "local",
  };
}

/** Failure with no upstream status to pass through (empty content, unusable body). */
export function localFailedBody(detail: string): LocalErrorBody {
  return {
    error: `Local engine failed: ${detail}. No cloud fallback was attempted.`,
    code: "LOCAL_FAILED",
    engine: "local",
  };
}

// GEMINI_UPSTREAM/502 is ambiguous between a refused connection and a real
// upstream 502, so classification leans on the transport flag and reads a
// timeout code as transport-level too.
export function isLocalUnreachable(upstream: GeminiRequestError): boolean {
  return upstream.transport === true || upstream.code === "GEMINI_TIMEOUT";
}

export function localErrorBodyFrom(upstream: GeminiRequestError): LocalErrorBody {
  if (isLocalUnreachable(upstream)) {
    return {
      error: `Local engine unreachable: ${upstream.message}. No cloud fallback was attempted.`,
      code: "LOCAL_UNREACHABLE",
      engine: "local",
      retryable: upstream.retryable,
      retryAfterMs: upstream.retryAfterMs,
    };
  }
  return {
    error: `Local engine failed: ${upstream.message}. No cloud fallback was attempted.`,
    code: "LOCAL_FAILED",
    engine: "local",
    retryable: upstream.retryable,
    retryAfterMs: upstream.retryAfterMs,
  };
}

export function localErrorStatus(upstream: GeminiRequestError): number {
  if (!isLocalUnreachable(upstream)) return upstream.status;
  return upstream.code === "GEMINI_TIMEOUT" ? 504 : 502;
}

const DEFAULT_PROBE_TIMEOUT_MS = 3_000;

/**
 * A status light must never hang on a wedged daemon, so the probe carries its
 * own short abort deadline and never throws — every outcome is a result.
 */
export async function probeLocalEngine(options: {
  baseUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<LocalProbeResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const normalized = normalizeLocalBaseUrl(options.baseUrl);
  if (!normalized) {
    return {
      ok: false,
      baseUrl: "",
      code: "LOCAL_BAD_RESPONSE",
      error: "Local base URL is missing or not a valid HTTP(S) URL.",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS);
  const startedAt = Date.now();
  const unreachable = (): LocalProbeResult => ({
    ok: false,
    baseUrl: normalized,
    code: "LOCAL_UNREACHABLE",
    error: `Could not reach the local engine at ${normalized}. Is the daemon running?`,
  });
  try {
    let response: Response;
    try {
      response = await fetchImpl(`${normalized}/models`, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
    } catch {
      return unreachable();
    }

    let body: { data?: unknown };
    try {
      body = (await response.json()) as { data?: unknown };
    } catch {
      // The deadline can land between response headers and body completion.
      if (controller.signal.aborted) return unreachable();
      body = {};
    }
    if (!response.ok || !Array.isArray(body.data)) {
      return {
        ok: false,
        baseUrl: normalized,
        code: "LOCAL_BAD_RESPONSE",
        error: `Local engine at ${normalized} returned an unusable response (HTTP ${response.status}).`,
      };
    }
    const models = body.data.flatMap((entry) => {
      const id = (entry as { id?: unknown } | null)?.id;
      return typeof id === "string" && id.trim() ? [{ id }] : [];
    });
    return { ok: true, baseUrl: normalized, models, latencyMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}
