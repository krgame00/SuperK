import type {
  CleanerOverride,
  CleaningJob,
  CleaningJobStage,
  CleaningJobStatus,
  CleaningProgress,
  CleaningRegion,
  CleaningResult,
  ManualRegionAction,
} from "./types";

const PROXY_BASE = "/api/clean";

export class CleaningClientError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly recovery: string,
  ) {
    super(message);
    this.name = "CleaningClientError";
  }
}

export async function createCleaningJob(file: Blob): Promise<CleaningJob> {
  const form = new FormData();
  const filename =
    typeof File !== "undefined" && file instanceof File
      ? file.name
      : "page.png";
  form.append("image", file, filename);
  return decodeJob(
    await requestJson(`${PROXY_BASE}/v1/jobs`, {
      method: "POST",
      body: form,
    }),
  );
}

export async function getCleaningJob(jobId: string): Promise<CleaningJob> {
  return decodeJob(
    await requestJson(`${PROXY_BASE}/v1/jobs/${encodeURIComponent(jobId)}`),
  );
}

export async function getCleaningResult(
  jobId: string,
): Promise<CleaningResult> {
  return decodeResult(
    await requestJson(
      `${PROXY_BASE}/v1/jobs/${encodeURIComponent(jobId)}/result`,
    ),
  );
}

export async function retryCleaningRegion(
  jobId: string,
  regionId: string,
  mask: Blob,
  cleaner: CleanerOverride,
  action: ManualRegionAction,
): Promise<CleaningJob> {
  const form = new FormData();
  form.append("mask", mask, "mask.png");
  form.append("cleaner", cleaner);
  form.append("action", action);
  return decodeJob(
    await requestJson(
      `${PROXY_BASE}/v1/jobs/${encodeURIComponent(jobId)}/regions/${encodeURIComponent(regionId)}/retry`,
      { method: "POST", body: form },
    ),
  );
}

async function requestJson(
  input: string,
  init: RequestInit = {},
): Promise<unknown> {
  const response = await fetch(input, { ...init, cache: "no-store" });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const detail =
      isRecord(payload) && typeof payload.detail === "string"
        ? payload.detail
        : `Cleaning service returned ${response.status}.`;
    throw new CleaningClientError(
      response.status,
      detail,
      recoveryFor(response.status),
    );
  }
  return payload;
}

function decodeJob(payload: unknown): CleaningJob {
  const raw = requireRecord(payload, "cleaning job");
  const progress = isRecord(raw.progress)
    ? decodeProgress(raw.progress)
    : undefined;
  return {
    jobId: requireString(raw.job_id, "job_id"),
    status: requireString(raw.status, "status") as CleaningJobStatus,
    stage: requireString(raw.stage, "stage") as CleaningJobStage,
    progress,
    error: typeof raw.error === "string" ? raw.error : null,
  };
}

function decodeProgress(raw: Record<string, unknown>): CleaningProgress {
  return {
    stage: requireString(raw.stage, "progress.stage") as CleaningJobStage,
    completedRegions: requireNumber(
      raw.completed_regions,
      "progress.completed_regions",
    ),
    totalRegions: requireNumber(
      raw.total_regions,
      "progress.total_regions",
    ),
    elapsedMs: requireNumber(raw.elapsed_ms, "progress.elapsed_ms"),
  };
}

function decodeResult(payload: unknown): CleaningResult {
  const raw = requireRecord(payload, "cleaning result");
  const regions = Array.isArray(raw.regions)
    ? raw.regions.map(decodeRegion)
    : [];
  return {
    jobId: requireString(raw.job_id, "job_id"),
    sourceHash: requireString(raw.source_hash, "source_hash"),
    width: requireNumber(raw.width, "width"),
    height: requireNumber(raw.height, "height"),
    cleanAsset: proxyAsset(requireString(raw.clean_asset, "clean_asset")),
    maskAsset: proxyAsset(requireString(raw.mask_asset, "mask_asset")),
    reviewMaskAsset: proxyAsset(
      requireString(raw.review_mask_asset, "review_mask_asset"),
    ),
    protectedMaskAsset: proxyAsset(
      requireString(raw.protected_mask_asset, "protected_mask_asset"),
    ),
    regions,
    timingsMs: decodeTimings(raw.timings_ms),
  };
}

function decodeRegion(value: unknown): CleaningRegion {
  const raw = requireRecord(value, "cleaning region");
  const rect = requireRecord(raw.rect, "region.rect");
  return {
    id: requireString(raw.id, "region.id"),
    rect: {
      x: requireNumber(rect.x, "rect.x"),
      y: requireNumber(rect.y, "rect.y"),
      width: requireNumber(rect.width, "rect.width"),
      height: requireNumber(rect.height, "rect.height"),
    },
    route: requireString(raw.route, "region.route") as CleaningRegion["route"],
    confidence: requireNumber(raw.confidence, "region.confidence"),
    status: requireString(
      raw.status,
      "region.status",
    ) as CleaningRegion["status"],
    residualScore: requireNumber(
      raw.residual_score,
      "region.residual_score",
    ),
    damageScore: requireNumber(raw.damage_score, "region.damage_score"),
    pageRole: requireString(
      raw.page_role,
      "region.page_role",
    ) as CleaningRegion["pageRole"],
    textRole: requireString(
      raw.text_role,
      "region.text_role",
    ) as CleaningRegion["textRole"],
    eligibilityConfidence: requireNumber(
      raw.eligibility_confidence,
      "region.eligibility_confidence",
    ),
    automaticAction: requireString(
      raw.automatic_action,
      "region.automatic_action",
    ) as CleaningRegion["automaticAction"],
    protectionReasons: decodeStringArray(
      raw.protection_reasons,
      "region.protection_reasons",
    ) as CleaningRegion["protectionReasons"],
  };
}

function decodeStringArray(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string")
  ) {
    throw new TypeError(`Missing ${field} in cleaning service response.`);
  }
  return value;
}

function decodeTimings(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number",
    ),
  );
}

function proxyAsset(path: string): string {
  if (!path.startsWith("/v1/")) {
    throw new TypeError("Cleaning service returned an invalid asset path.");
  }
  return `${PROXY_BASE}${path}`;
}

function recoveryFor(status: number): string {
  if (status === 413) return "Use an image smaller than 80 MB.";
  if (status === 415) return "Use a PNG, JPEG, or WebP image.";
  if (status === 503) return "Start the local SuperK cleaner and try again.";
  return "Try again. If it still fails, inspect the local cleaner status.";
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`Invalid ${label} response.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`Missing ${field} in cleaning service response.`);
  }
  return value;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`Missing ${field} in cleaning service response.`);
  }
  return value;
}
