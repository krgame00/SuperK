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
  throwIfRequestAborted,
  withGeminiDeadline,
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
  onModelSwitch?: (event: { model: string; fallbackCount: number }) => void;
  signal?: AbortSignal;
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
  throwIfRequestAborted(options.signal);

  let catalog: GeminiCatalogResult;
  try {
    catalog = await withGeminiDeadline(
      (signal) => geminiCatalogManager.getCatalog({
        userApiKeyRaw: options.userApiKeyRaw,
        serverApiKeyRaw: options.serverApiKeyRaw,
        signal,
      }),
      Math.min(10_000, totalBudgetMs),
      options.signal,
    );
    throwIfRequestAborted(options.signal);
  } catch (err: unknown) {
    throwIfRequestAborted(options.signal);
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
  const claimedRecoveryModels = new Set<string>();
  const releaseRecoveryTrials = () => {
    for (const model of claimedRecoveryModels) {
      geminiCatalogManager.releaseRecoveryTrial(catalog.pool.id, model);
    }
    claimedRecoveryModels.clear();
  };
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
      signal: options.signal,
      beforeRoute: (route) => {
        if (!route.recoveryTrial) return;
        if (!geminiCatalogManager.claimRecoveryTrial(catalog.pool.id, route.model)) return "skip-model";
        claimedRecoveryModels.add(route.model);
      },
      onRouteFailure: async (route, error) => {
        // The manager now owns retirement of this trial. Its in-memory update
        // precedes persistence, so cancellation must not release a later claim.
        claimedRecoveryModels.delete(route.model);
        return recordRouteFailure(catalog, options.workflow, route, error);
      },
      onModelSwitch: options.onModelSwitch,
    });
    throwIfRequestAborted(options.signal);

    if (!result.keyId) {
      throw new GeminiRoutingError(
        "Gemini route completed without a key identity",
        "GEMINI_ROUTE_UNAVAILABLE",
        result.model,
      );
    }

    if (options.validateSuccess?.(result.data) !== false) {
      throwIfRequestAborted(options.signal);
      const success = geminiCatalogManager.recordSuccess(catalog, {
          workflow: options.workflow,
          model: result.model,
          keyId: result.keyId,
          elapsedMs: result.meta.routeElapsedMs ?? result.meta.elapsedMs,
        });
      claimedRecoveryModels.delete(result.model);
      try {
        await withGeminiDeadline(
          () => success, Math.max(0, totalBudgetMs - (now() - startedAt)), options.signal,
        );
      } catch (error) {
        throwIfRequestAborted(options.signal);
        if (error instanceof Error && error.name === "TimeoutError") {
          throw new GeminiRequestError("Gemini routing state update exceeded the request deadline", "GEMINI_TIMEOUT", 504, true);
        }
        throw error;
      }
    }

    throwIfRequestAborted(options.signal);
    return result;
  } catch (error) {
    releaseRecoveryTrials();
    if (error instanceof GeminiRequestError && error.code !== "REQUEST_ABORTED") {
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
  } finally {
    releaseRecoveryTrials();
  }
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
