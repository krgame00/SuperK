import {
  type GeminiCatalogResult,
  type GeminiRoute,
  type GeminiRouteFailureKind,
  type GeminiWorkflow,
  GeminiRoutingError,
  geminiCatalogManager,
} from "@/lib/server/geminiCatalog";
import {
  GeminiRequestError,
  type GeminiRequestResult,
  requestGeminiRoutes,
} from "@/lib/server/geminiRequest";

const DEFAULT_TRANSLATION_ATTEMPT_TIMEOUT_MS = 15_000;
const DEFAULT_TRANSLATION_TOTAL_BUDGET_MS = 60_000;

export interface ExecuteGeminiTranslationOptions {
  workflow: GeminiWorkflow;
  userApiKeyRaw?: string | null;
  serverApiKeyRaw?: string | null;
  modelPreference?: string | null;
  allowPreview?: boolean;
  payload: unknown;
  attemptTimeoutMs?: number;
  totalBudgetMs?: number;
  now?: () => number;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}

function routeFailureKind(error: GeminiRequestError): GeminiRouteFailureKind {
  if (error.status === 429) return "quota";
  const message = error.message.toLowerCase();
  if (
    error.status === 404 ||
    message.includes("not found") ||
    message.includes("unsupported") ||
    message.includes("not supported") ||
    message.includes("does not support") ||
    message.includes("method not allowed")
  ) {
    return "capability";
  }
  return "transient";
}

async function recordRouteFailure(
  catalog: GeminiCatalogResult,
  workflow: GeminiWorkflow,
  route: GeminiRoute,
  error: GeminiRequestError,
): Promise<"skip-model" | void> {
  const kind = routeFailureKind(error);
  await geminiCatalogManager.recordFailure(catalog, {
    workflow,
    model: route.model,
    keyId: route.keyId,
    kind,
    retryAfterMs: error.retryAfterMs,
  });
  if (kind === "capability") {
    if (error.status === 404) {
      geminiCatalogManager.invalidateCatalog(catalog.pool.id);
    }
    return "skip-model";
  }
}

export async function executeGeminiTranslation<T = unknown>(
  options: ExecuteGeminiTranslationOptions,
): Promise<GeminiRequestResult<T>> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const totalBudgetMs = options.totalBudgetMs ?? DEFAULT_TRANSLATION_TOTAL_BUDGET_MS;
  const catalogSignal = AbortSignal.timeout(Math.min(10000, totalBudgetMs));

  let catalog: GeminiCatalogResult;
  try {
    catalog = await geminiCatalogManager.getCatalog({
      userApiKeyRaw: options.userApiKeyRaw,
      serverApiKeyRaw: options.serverApiKeyRaw,
      signal: catalogSignal,
    });
  } catch (err: any) {
    const elapsed = now() - startedAt;
    if (elapsed >= totalBudgetMs || err?.name === "TimeoutError" || err?.name === "AbortError") {
      throw new GeminiRequestError(
        "การค้นหาโมเดล Gemini เกินเวลาที่กำหนด (Timeout)",
        "GEMINI_TIMEOUT",
        504,
        true,
      );
    }
    throw err;
  }

  const discoveryElapsed = now() - startedAt;
  const remainingBudgetMs = totalBudgetMs - discoveryElapsed;
  if (remainingBudgetMs <= 0) {
    throw new GeminiRequestError(
      "หมดเวลางบประมาณสำหรับคำขอแปลหลังจากค้นหาโมเดล (Timeout)",
      "GEMINI_TIMEOUT",
      504,
      true,
    );
  }

  const routes = geminiCatalogManager.planRoutes(catalog, {
    workflow: options.workflow,
    modelPreference: options.modelPreference || "auto",
    allowPreview: options.allowPreview ?? false,
  });

  const result = await requestGeminiRoutes<T>({
    routes,
    payload: options.payload,
    attemptTimeoutMs: options.attemptTimeoutMs ?? DEFAULT_TRANSLATION_ATTEMPT_TIMEOUT_MS,
    totalBudgetMs: remainingBudgetMs,
    startedAt,
    now,
    fetchImpl: options.fetchImpl,
    sleep: options.sleep,
    onRouteFailure: (route, error) =>
      recordRouteFailure(catalog, options.workflow, route, error),
  });

  if (!result.keyId) {
    throw new GeminiRoutingError(
      "Gemini route completed without a key identity",
      "GEMINI_ROUTE_UNAVAILABLE",
      result.model,
    );
  }

  await geminiCatalogManager.recordSuccess(catalog, {
    workflow: options.workflow,
    model: result.model,
    keyId: result.keyId,
  });

  return result;
}

export function geminiRoutingHttpStatus(error: unknown): number {
  if (!(error instanceof GeminiRoutingError)) return 500;
  if (error.code === "GEMINI_API_KEY_MISSING") return 500;
  if (
    error.code === "GEMINI_MODEL_UNAVAILABLE" ||
    error.code === "GEMINI_MODEL_INCOMPATIBLE"
  ) {
    return 409;
  }
  return 503;
}
