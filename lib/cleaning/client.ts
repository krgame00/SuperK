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

export async function createCleaningJob(
  file: Blob,
  signal?: AbortSignal,
  cleaningMode: "safe" | "all-text" = "safe",
): Promise<CleaningJob> {
  const form = new FormData();
  let resolvedFile = file;
  const filename =
    typeof File !== "undefined" && file instanceof File
      ? file.name
      : "page.png";

  const ext = filename.split(".").pop()?.toLowerCase();
  const fallbackMime =
    ext === "jpg" || ext === "jpeg" || ext === "jfif"
      ? "image/jpeg"
      : ext === "webp"
        ? "image/webp"
        : ext === "avif"
          ? "image/avif"
          : ext === "bmp"
            ? "image/bmp"
            : ext === "tiff" || ext === "tif"
              ? "image/tiff"
              : ext === "gif"
                ? "image/gif"
                : "image/png";

  const resolvedMime =
    file.type && file.type !== "application/octet-stream"
      ? file.type
      : fallbackMime;

  if (file.type !== resolvedMime) {
    resolvedFile = new Blob([file], { type: resolvedMime });
  }

  form.append("image", resolvedFile, filename);
  let effectiveCleaningMode: "safe" | "all-text" = cleaningMode;
  if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
    const savedSfx = localStorage.getItem("superk:sfx-policy");
    if (savedSfx === "translate") {
      effectiveCleaningMode = "all-text";
    } else if (savedSfx === "ignore" || savedSfx === "preserve") {
      effectiveCleaningMode = "safe";
    }
  }
  form.append("cleaning_mode", effectiveCleaningMode);
  return decodeJob(
    await requestJson(`${PROXY_BASE}/v1/jobs`, {
      method: "POST",
      body: form,
      ...(signal ? {signal} : {}),
    }),
  );
}

export async function getCleaningJob(jobId: string, signal?: AbortSignal): Promise<CleaningJob> {
  return decodeJob(
    await requestJson(`${PROXY_BASE}/v1/jobs/${encodeURIComponent(jobId)}`, signal ? {signal} : undefined),
  );
}

export async function getCleaningResult(
  jobId: string,
  signal?: AbortSignal,
): Promise<CleaningResult> {
  return decodeResult(
    await requestJson(
      `${PROXY_BASE}/v1/jobs/${encodeURIComponent(jobId)}/result`,
      signal ? {signal} : undefined,
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
  const typedMask =
    mask.type === "image/png" ? mask : new Blob([mask], { type: "image/png" });
  form.append("mask", typedMask, "mask.png");
  form.append("cleaner", cleaner);
  form.append("action", action);
  return decodeJob(
    await requestJson(
      `${PROXY_BASE}/v1/jobs/${encodeURIComponent(jobId)}/regions/${encodeURIComponent(regionId)}/retry`,
      { method: "POST", body: form },
    ),
  );
}

export interface InpaintCropOptions {
  cleaner?: CleanerOverride;
  dilation?: number;
  extendHints?: boolean;
  featherBlend?: boolean;
  signal?: AbortSignal;
}

export async function inpaintCrop(
  imageBlob: Blob,
  maskBlob: Blob,
  options: InpaintCropOptions = {},
): Promise<Blob> {
  const form = new FormData();
  const typedImage =
    imageBlob.type && imageBlob.type !== "application/octet-stream"
      ? imageBlob
      : new Blob([imageBlob], { type: "image/png" });
  const typedMask =
    maskBlob.type === "image/png"
      ? maskBlob
      : new Blob([maskBlob], { type: "image/png" });

  form.append("image", typedImage, "crop.png");
  form.append("mask", typedMask, "mask.png");
  if (options.cleaner) {
    form.append("cleaner", options.cleaner);
  }
  if (typeof options.dilation === "number" && options.dilation > 0) {
    form.append("dilation", String(Math.round(options.dilation)));
  }
  if (options.extendHints) {
    form.append("extend_hints", "true");
  }
  if (options.featherBlend) {
    form.append("feather_blend", "true");
  }

  const response = await fetch(`${PROXY_BASE}/v1/clean/crop`, {
    method: "POST",
    body: form,
    signal: options.signal,
  });

  if (!response.ok) {
    let message = "Inpainting failed";
    try {
      const err = await response.json();
      if (err.detail) message = err.detail;
    } catch {
      // ignore
    }
    throw new CleaningClientError(response.status, message, recoveryFor(response.status));
  }

  return await response.blob();
}

export interface BubbleContourProfile {
  text_box_id: number;
  bbox: [number, number, number, number];
  polygon: Array<[number, number]>;
  scanline_ratios: number[];
}

export async function detectBubbleProfiles(
  imageBlob: Blob,
  boxes: Array<{ x: number; y: number; width: number; height: number } | [number, number, number, number]>,
  numSlices = 20,
  signal?: AbortSignal,
): Promise<BubbleContourProfile[]> {
  const form = new FormData();
  const typedImage =
    imageBlob.type && imageBlob.type !== "application/octet-stream"
      ? imageBlob
      : new Blob([imageBlob], { type: "image/png" });
  form.append("image", typedImage, "page.png");
  form.append("boxes", JSON.stringify(boxes));
  form.append("num_slices", String(numSlices));

  const payload = await requestJson(`${PROXY_BASE}/v1/detect/bubbles`, {
    method: "POST",
    body: form,
    ...(signal ? { signal } : {}),
  });
  if (isRecord(payload) && Array.isArray(payload.profiles)) {
    return payload.profiles as BubbleContourProfile[];
  }
  return [];
}

export async function restoreCleaningJob(params: {
  jobId: string;
  sourceBlob: Blob;
  cleanBlob: Blob;
  maskBlob: Blob;
  reviewMaskBlob: Blob;
  protectedMaskBlob: Blob;
  regions: CleaningRegion[];
  cleaningMode?: "safe" | "all-text";
}): Promise<CleaningJob> {
  const form = new FormData();
  const ensurePng = (blob: Blob) =>
    blob.type === "image/png" ? blob : new Blob([blob], { type: "image/png" });
  form.append("job_id", params.jobId);
  form.append("source", ensurePng(params.sourceBlob), "source.png");
  form.append("clean", ensurePng(params.cleanBlob), "clean.png");
  form.append("mask", ensurePng(params.maskBlob), "mask.png");
  form.append("review_mask", ensurePng(params.reviewMaskBlob), "review-mask.png");
  form.append("protected_mask", ensurePng(params.protectedMaskBlob), "protected-mask.png");
  form.append(
    "regions",
    JSON.stringify(
      params.regions.map((r) => ({
        id: r.id,
        rect: r.rect,
        route: r.route,
        confidence: r.confidence,
        status: r.status,
        residual_score: r.residualScore,
        damage_score: r.damageScore,
        page_role: r.pageRole,
        text_role: r.textRole,
        eligibility_confidence: r.eligibilityConfidence,
        automatic_action: r.automaticAction,
        protection_reasons: r.protectionReasons,
        text_confirmed: r.textConfirmed === true,
        mask_approved: r.maskApproved === true,
        approval_revision: r.approvalRevision ?? null,
      })),
    ),
  );
  form.append("cleaning_mode", params.cleaningMode ?? "safe");
  return decodeJob(
    await requestJson(`${PROXY_BASE}/v1/jobs/restore`, {
      method: "POST",
      body: form,
    }),
  );
}

async function requestJson(
  input: string,
  init: RequestInit = {},
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(input, { ...init, cache: "no-store" });
  } catch (error) {
    if (init.signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw new DOMException("Cleaning cancelled", "AbortError");
    }
    throw new CleaningClientError(
      0,
      error instanceof Error ? error.message : "Local cleaning service is unavailable.",
      "Start the local SuperK cleaner and try again.",
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    if (init.signal?.aborted) throw new DOMException("Cleaning cancelled", "AbortError");
    payload = {};
  }
  if (init.signal?.aborted) throw new DOMException("Cleaning cancelled", "AbortError");
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
    // Older sidecars do not send the policy revision. Keep decoding those
    // responses so restored jobs can be safely rejected as non-reusable by the
    // hook instead of crashing the client at the API boundary.
    pipelineVersion:
      typeof raw.pipeline_version === "string" ? raw.pipeline_version : undefined,
    awaitingReview: raw.awaiting_review === true,
    cleaningMode: raw.cleaning_mode === "all-text" ? "all-text" : "safe",
  };
}

function decodeRegion(value: unknown): CleaningRegion {
  const raw = requireRecord(value, "cleaning region");
  const rect = requireRecord(raw.rect, "region.rect");
  const approvalRevision = typeof raw.approval_revision === "string" ? raw.approval_revision : null;
  return {
    textConfirmed: raw.text_confirmed === true,
    maskApproved: raw.mask_approved === true && approvalRevision !== null,
    approvalRevision,
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

function decodeTimings(value: unknown): Record<string, number | string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number | string] =>
        typeof entry[1] === "number" || typeof entry[1] === "string",
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
