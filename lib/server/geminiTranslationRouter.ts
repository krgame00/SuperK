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

const DEFAULT_TRANSLATION_ATTEMPT_TIMEOUT_MS = 25_000;
const DEFAULT_TRANSLATION_TOTAL_BUDGET_MS = 60_000;

export interface ExecuteGeminiTranslationOptions<T = unknown> {
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
  validateSuccess?: (data: T) => boolean;
}

function routeFailureKind(error: GeminiRequestError): GeminiRouteFailureKind {
  if (error.status === 429) return "quota";
  const message = error.message.toLowerCase();
  if (
    error.status === 503 &&
    (
      message.includes("high demand") ||
      message.includes("overloaded") ||
      message.includes("overload") ||
      message.includes("temporarily unavailable")
    )
  ) {
    return "overload";
  }
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
  if (kind === "overload") return "skip-model";
}

export async function executeGeminiTranslation<T = unknown>(
  options: ExecuteGeminiTranslationOptions<T>,
): Promise<GeminiRequestResult<T>> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const totalBudgetMs = options.totalBudgetMs ?? DEFAULT_TRANSLATION_TOTAL_BUDGET_MS;
  const catalogController = new AbortController();
  let catalogTimer: ReturnType<typeof setTimeout>;
  const catalogDeadline = new Promise<never>((_, reject) => {
    catalogTimer = setTimeout(() => {
      catalogController.abort();
      reject(new DOMException("Gemini discovery deadline exceeded", "TimeoutError"));
    }, Math.min(10_000, totalBudgetMs));
  });

  let catalog: GeminiCatalogResult;
  try {
    catalog = await Promise.race([
      geminiCatalogManager.getCatalog({
        userApiKeyRaw: options.userApiKeyRaw,
        serverApiKeyRaw: options.serverApiKeyRaw,
        signal: catalogController.signal,
      }),
      catalogDeadline,
    ]);
  } catch (err: unknown) {
    const elapsed = now() - startedAt;
    if (elapsed >= totalBudgetMs || (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError"))) {
      throw new GeminiRequestError(
        "การค้นหาโมเดล Gemini เกินเวลาที่กำหนด (Timeout)",
        "GEMINI_TIMEOUT",
        504,
        true,
      );
    }
    throw err;
  } finally {
    clearTimeout(catalogTimer!);
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

  let result: GeminiRequestResult<T>;
  try {
    result = await requestGeminiRoutes<T>({
      routes,
      payload: options.payload,
      attemptTimeoutMs: options.attemptTimeoutMs ?? DEFAULT_TRANSLATION_ATTEMPT_TIMEOUT_MS,
      totalBudgetMs,
      startedAt,
      now,
      fetchImpl: options.fetchImpl,
      sleep: options.sleep,
      beforeRoute: (route) => {
        if (!route.recoveryTrial) return;
        return geminiCatalogManager.claimRecoveryTrial(catalog.pool.id, route.model)
          ? undefined
          : "skip-model";
      },
      onRouteFailure: (route, error) =>
        recordRouteFailure(catalog, options.workflow, route, error),
    });
  } catch (error) {
    if (error instanceof GeminiRequestError) {
      try {
        // Fail with the post-attempt health state when every meaningful route
        // is now cooling down, so callers receive actionable retry timing.
        geminiCatalogManager.planRoutes(catalog, {
          workflow: options.workflow,
          modelPreference: options.modelPreference || "auto",
          allowPreview: options.allowPreview ?? false,
        });
      } catch (routingError) {
        if (
          routingError instanceof GeminiRoutingError &&
          (routingError.retryAfterMs !== undefined ||
            routingError.code === "GEMINI_MODEL_INCOMPATIBLE")
        ) {
          throw routingError;
        }
      }
    }
    throw error;
  }

  if (!result.keyId) {
    throw new GeminiRoutingError(
      "Gemini route completed without a key identity",
      "GEMINI_ROUTE_UNAVAILABLE",
      result.model,
    );
  }

  if (options.validateSuccess?.(result.data) !== false) {
    await geminiCatalogManager.recordSuccess(catalog, {
      workflow: options.workflow,
      model: result.model,
      keyId: result.keyId,
      elapsedMs: result.meta.routeElapsedMs ?? result.meta.elapsedMs,
    });
  }

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
