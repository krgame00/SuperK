import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { useCleaning, type PageCleaningResult } from "@/hooks/useCleaning";
import {
  CleaningClientError,
  createCleaningJob,
  getCleaningJob,
  getCleaningResult,
  retryCleaningRegion,
} from "@/lib/cleaning/client";
import {
  loadCleaningResultAssets,
  loadCleaningResultsMetadata,
  saveCleaningResultMetadata,
} from "@/lib/projectStore";
import {
  blobFingerprint,
  inspectCleanedPage,
} from "@/lib/cleaning/remnantReview";
import type { CleaningRegion } from "@/lib/cleaning/types";

vi.mock("@/lib/cleaning/client", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/cleaning/client")>();
  return {
    ...original,
    createCleaningJob: vi.fn(),
    getCleaningJob: vi.fn(),
    getCleaningResult: vi.fn(),
    retryCleaningRegion: vi.fn(),
  };
});
vi.mock("@/lib/projectStore", () => ({
  deleteAsset: vi.fn().mockResolvedValue(undefined),
  loadCleaningResultAssets: vi.fn().mockResolvedValue({
    cleanBlob: null,
    maskBlob: null,
    reviewMaskBlob: null,
    protectedMaskBlob: null,
  }),
  loadCleaningResultsMetadata: vi.fn(),
  saveCleaningAssets: vi.fn().mockResolvedValue({}),
  saveCleaningResultMetadata: vi.fn(),
}));

// Deterministic 64x64 image fixtures: white 240 page, dark 40 glyph ink.
const SIZE = 64;
const PAGE = 240;
const INK = 40;

function solidRgba(width: number, height: number, gray: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = gray;
    data[i * 4 + 1] = gray;
    data[i * 4 + 2] = gray;
    data[i * 4 + 3] = 255;
  }
  return data;
}

function fillRectRgba(data: Uint8ClampedArray, width: number, x: number, y: number, w: number, h: number, gray: number): void {
  for (let yy = y; yy < y + h; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) {
      const offset = (yy * width + xx) * 4;
      data[offset] = gray;
      data[offset + 1] = gray;
      data[offset + 2] = gray;
      data[offset + 3] = 255;
    }
  }
}

function originalRgba(): Uint8ClampedArray {
  const data = solidRgba(SIZE, SIZE, PAGE);
  fillRectRgba(data, SIZE, 20, 24, 20, 10, INK);
  return data;
}

function paddedBlob(rgba: Uint8ClampedArray, padding: number): Blob {
  return new Blob([new Uint8ClampedArray(rgba), new Uint8Array(padding)], { type: "image/png" });
}

/** Unique padding per content so blob sizes never collide (test-mode
 *  fingerprints are size-based; production hashes content). */
const SOURCE_BLOB = paddedBlob(originalRgba(), 16);
const REPLACED_SOURCE_BLOB = paddedBlob(originalRgba(), 32);
const UNCLEANED_CLEAN_BLOB = paddedBlob(originalRgba(), 8);
const CLEANED_CLEAN_BLOB = paddedBlob(solidRgba(SIZE, SIZE, PAGE), 0);

let decodeFailures = 0;

function stubImageDecoding(): void {
  const fixtures = new Map<number, { width: number; height: number; rgba: Uint8ClampedArray }>([
    [SOURCE_BLOB.size, { width: SIZE, height: SIZE, rgba: originalRgba() }],
    [REPLACED_SOURCE_BLOB.size, { width: SIZE, height: SIZE, rgba: originalRgba() }],
    [UNCLEANED_CLEAN_BLOB.size, { width: SIZE, height: SIZE, rgba: originalRgba() }],
    [CLEANED_CLEAN_BLOB.size, { width: SIZE, height: SIZE, rgba: solidRgba(SIZE, SIZE, PAGE) }],
  ]);
  let drawn: Uint8ClampedArray = new Uint8ClampedArray();
  vi.stubGlobal("createImageBitmap", vi.fn(async (blob: Blob) => {
    const fixture = fixtures.get(blob.size);
    if (!fixture) throw new Error(`no decode fixture for blob size ${blob.size}`);
    return { width: fixture.width, height: fixture.height, rgba: fixture.rgba, close: vi.fn() };
  }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => {
    if (decodeFailures > 0) {
      decodeFailures -= 1;
      return null;
    }
    return {
      drawImage: vi.fn((image: { rgba: Uint8ClampedArray }) => { drawn = image.rgba; }),
      getImageData: vi.fn((_x: number, _y: number, w: number, h: number) =>
        new ImageData(new Uint8ClampedArray(drawn), w, h)),
    } as unknown as CanvasRenderingContext2D;
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext);
}

const regionFixture: CleaningRegion = {
  id: "region-1",
  rect: { x: 16, y: 20, width: 28, height: 18 },
  route: "flat",
  confidence: 0.9,
  status: "ready",
  residualScore: 0,
  damageScore: 0,
  pageRole: "comic",
  textRole: "dialogue",
  eligibilityConfidence: 0.8,
  automaticAction: "clean",
  protectionReasons: [],
};

const queuedJob = {
  jobId: "job-1",
  status: "queued" as const,
  stage: "queued" as const,
};
const succeededJob = {
  jobId: "job-1",
  status: "succeeded" as const,
  stage: "complete" as const,
};
const cleaningResult = {
  cleaningMode: "all-text" as const,
  jobId: "job-1",
  sourceHash: "a".repeat(64),
  width: SIZE,
  height: SIZE,
  cleanAsset: "/api/clean/v1/jobs/job-1/assets/clean.png",
  maskAsset: "/api/clean/v1/jobs/job-1/assets/mask.png",
  reviewMaskAsset: "/api/clean/v1/jobs/job-1/assets/review-mask.png",
  protectedMaskAsset: "/api/clean/v1/jobs/job-1/assets/protected-mask.png",
  regions: [regionFixture],
  timingsMs: { total: 10 },
  pipelineVersion: "2.3.1-enclosed-backing",
};

const maskBlob = new Blob(["mask-image-data"], { type: "image/png" });

test("known source evidence outside a cleaned region invalidates approval synchronously", async () => {
  vi.mocked(createCleaningJob).mockResolvedValue(queuedJob);
  vi.mocked(getCleaningJob).mockResolvedValue(succeededJob);
  vi.mocked(getCleaningResult).mockResolvedValue({ ...cleaningResult, regions: [{ ...regionFixture, rect: { x: 2, y: 2, width: 8, height: 8 } }] });
  const { result } = renderHook(() => useCleaning({ pages: ["blob:one"], currentPage: 0 }));
  let cleaning!: Promise<PageCleaningResult>;
  act(() => { cleaning = result.current.cleanPage("blob:one", SOURCE_BLOB); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); await cleaning; });
  expect(result.current.getCurrentRemnantReview("blob:one")?.eligibility).toBe("approved");
  const evidence = { sourceContext: `${SOURCE_BLOB.size}:image/png`, textEvidence: [{ id: "outside", box: [300, 250, 600, 700] }] };
  expect(result.current.getCurrentRemnantReview("blob:one", evidence)).toBeUndefined();
  act(() => { result.current.setPageRemnantTextEvidence("blob:one", evidence); });
  expect(result.current.getCurrentRemnantReview("blob:one", evidence)).toBeUndefined();
  await act(async () => { await vi.advanceTimersByTimeAsync(0); for (let i = 0; i < 40; i++) await Promise.resolve(); });
  const review = result.current.getCurrentRemnantReview("blob:one", evidence)!;
  expect(review.eligibility).toBe("unresolved");
  expect(review.inspection.candidates[0].evidence.textEvidenceIds).toContain("outside");
  act(() => { expect(result.current.confirmArtworkCandidate("blob:one", review.inspection.candidates[0].id)).toBe(true); });
  expect(result.current.getCurrentRemnantReview("blob:one", evidence)?.eligibility).toBe("human-confirmed");
  const decodes = vi.mocked(createImageBitmap).mock.calls.length;
  act(() => { result.current.setPageRemnantTextEvidence("blob:one", { ...evidence, textEvidence: evidence.textEvidence.map(e => ({ ...e, box: [...e.box] })) }); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); for (let i = 0; i < 40; i++) await Promise.resolve(); });
  expect(vi.mocked(createImageBitmap).mock.calls.length).toBe(decodes);
  const changed = { ...evidence, textEvidence: [{ id: "outside-new", box: [300, 250, 600, 700] }] };
  act(() => { result.current.setPageRemnantTextEvidence("blob:one", changed); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); for (let i = 0; i < 40; i++) await Promise.resolve(); });
  expect(result.current.getCurrentRemnantReview("blob:one", changed)?.eligibility).toBe("unresolved");
  expect(result.current.getCurrentRemnantReview("blob:one", changed)?.inspection.revisionKey).not.toBe(review.inspection.revisionKey);
  const decoder = vi.mocked(createImageBitmap).getMockImplementation()!;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  vi.mocked(createImageBitmap).mockImplementationOnce(async (...args) => {
    await pending;
    return decoder(...args);
  });
  let recheck!: Promise<void>;
  act(() => { recheck = result.current.recheckPageRemnants("blob:one"); });
  await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
  const latest = { ...changed, textEvidence: [] };
  act(() => { result.current.setPageRemnantTextEvidence("blob:one", latest); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); for (let i = 0; i < 40; i++) await Promise.resolve(); });
  expect(result.current.getCurrentRemnantReview("blob:one", latest)?.eligibility).toBe("approved");
  await act(async () => { release(); await recheck; });
  expect(result.current.getCurrentRemnantReview("blob:one", latest)?.eligibility).toBe("approved");
  expect(result.current.getCurrentRemnantReview("blob:one", changed)).toBeUndefined();
  expect(result.current.getCurrentRemnantReview("blob:one", { ...latest, sourceContext: "" })).toBeUndefined();
  act(() => { result.current.setPageRemnantTextEvidence("blob:one", { ...latest, sourceContext: "different-source" }); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); for (let i = 0; i < 40; i++) await Promise.resolve(); });
  expect(result.current.getCurrentRemnantReview("blob:one")).toBeUndefined();
  expect(result.current.currentRemnantReview?.eligibility).toBe("unavailable");
});

test("opening saved work with missing local assets never contacts the cleaning provider", async () => {
  vi.mocked(loadCleaningResultsMetadata).mockResolvedValue(new Map([["blob:one", storedMetadata()]]));
  vi.mocked(loadCleaningResultAssets).mockResolvedValue({ cleanBlob: null, maskBlob: null, reviewMaskBlob: null, protectedMaskBlob: null });
  const { result } = renderHook(() => useCleaning({ pages: ["blob:one"], currentPage: 0 }));
  await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); });
  expect(getCleaningResult).not.toHaveBeenCalled();
  expect(createCleaningJob).not.toHaveBeenCalled();
  expect(result.current.currentResult).toBeUndefined();
});

test("current review accessor rejects changed mask authorization", async () => {
  vi.mocked(createCleaningJob).mockResolvedValue(queuedJob);
  vi.mocked(getCleaningJob).mockResolvedValue(succeededJob);
  vi.mocked(getCleaningResult).mockResolvedValue(cleaningResult);
  const { result } = renderHook(() => useCleaning({ pages: ["blob:one"], currentPage: 0 }));
  let cleaning!: Promise<PageCleaningResult>;
  act(() => { cleaning = result.current.cleanPage("blob:one", SOURCE_BLOB); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); await cleaning; });
  expect(result.current.getCurrentRemnantReview("blob:one")?.eligibility).toBe("unresolved");
  result.current.currentResult!.maskFingerprint = "edited-mask";
  expect(result.current.getCurrentRemnantReview("blob:one")).toBeUndefined();
});

test("rechecking a stable URL with replaced original bytes makes the old review unavailable", async () => {
  vi.mocked(createCleaningJob).mockResolvedValue(queuedJob);
  vi.mocked(getCleaningJob).mockResolvedValue(succeededJob);
  vi.mocked(getCleaningResult).mockResolvedValue(cleaningResult);
  const { result } = renderHook(() => useCleaning({ pages: ["blob:one"], currentPage: 0 }));
  let cleaning!: Promise<PageCleaningResult>;
  act(() => { cleaning = result.current.cleanPage("blob:one", SOURCE_BLOB); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); await cleaning; });
  vi.mocked(fetch).mockResolvedValue({ ok: true, blob: async () => REPLACED_SOURCE_BLOB } as Response);
  await act(async () => { await result.current.recheckPageRemnants("blob:one"); });
  expect(result.current.getCurrentRemnantReview("blob:one")?.eligibility).toBe("unavailable");
  expect(result.current.confirmArtworkCandidate("blob:one", "any")).toBe(false);
});

test("an edit while local inspection is pending cannot bind the old pixels to the new mask", async () => {
  vi.mocked(createCleaningJob).mockResolvedValue(queuedJob);
  vi.mocked(getCleaningJob).mockResolvedValue(succeededJob);
  vi.mocked(getCleaningResult).mockResolvedValue(cleaningResult);
  const { result } = renderHook(() => useCleaning({ pages: ["blob:one"], currentPage: 0 }));
  let cleaning!: Promise<PageCleaningResult>;
  act(() => { cleaning = result.current.cleanPage("blob:one", SOURCE_BLOB); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); await cleaning; });
  const originalDecoder = vi.mocked(createImageBitmap).getMockImplementation()!;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  vi.mocked(createImageBitmap).mockImplementationOnce(async (...args) => {
    await pending;
    return originalDecoder(...args);
  });
  let recheck!: Promise<void>;
  act(() => { recheck = result.current.recheckPageRemnants("blob:one"); });
  await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
  result.current.currentResult!.maskFingerprint = "edited-during-inspection";
  await act(async () => { release(); await recheck; });
  expect(result.current.getCurrentRemnantReview("blob:one")).toBeUndefined();
});

function storedMetadata(overrides: Record<string, unknown> = {}) {
  return {
    pageUrl: "blob:one",
    sourceHash: "a".repeat(64),
    sourceFingerprint: `${SOURCE_BLOB.size}:image/png`,
    maskFingerprint: `${maskBlob.size}:image/png`,
    pipelineVersion: "2.3.1-enclosed-backing",
    jobId: "job-offline-1",
    cleaningMode: "all-text" as const,
    width: SIZE,
    height: SIZE,
    regions: [regionFixture],
    updatedAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  decodeFailures = 0;
  vi.mocked(createCleaningJob).mockReset();
  vi.mocked(getCleaningJob).mockReset();
  vi.mocked(getCleaningResult).mockReset();
  vi.mocked(retryCleaningRegion).mockReset();
  vi.mocked(loadCleaningResultsMetadata).mockResolvedValue(new Map());
  vi.mocked(saveCleaningResultMetadata).mockResolvedValue();
  stubImageDecoding();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const asset = url.includes("clean.png") && !url.includes("review-mask") && !url.includes("protected-mask")
      ? UNCLEANED_CLEAN_BLOB
      : url.includes("mask.png") || url.includes("review-mask") || url.includes("protected-mask")
        ? maskBlob
        : SOURCE_BLOB;
    return {
      ok: true,
      status: 200,
      blob: async () => asset,
    } as Response;
  });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn().mockReturnValue("blob:asset"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test("inspects the cleaned background after cleaning and surfaces a revision-bound finding", async () => {
  vi.mocked(createCleaningJob).mockResolvedValue(queuedJob);
  vi.mocked(getCleaningJob).mockResolvedValue(succeededJob);
  vi.mocked(getCleaningResult).mockResolvedValue(cleaningResult);
  const { result } = renderHook(() => useCleaning({ pages: ["blob:one"], currentPage: 0 }));

  let cleaning!: Promise<PageCleaningResult>;
  act(() => {
    cleaning = result.current.cleanPage("blob:one", SOURCE_BLOB);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
    await cleaning;
  });

  const review = result.current.remnantReviews.get("blob:one");
  expect(review?.inspection.status).toBe("inspected");
  expect(review?.eligibility).toBe("unresolved");
  expect(review?.inspection.candidates).toHaveLength(1);
  expect(review?.inspection.candidates[0].state).toBe("suspected-remnant");
  expect(review?.inspection.candidates[0].rect).toEqual({ x: 20, y: 24, width: 20, height: 10 });
});

test("artwork confirmation binds to the exact candidate and revision, and a reclean reopens the finding", async () => {
  vi.mocked(createCleaningJob).mockResolvedValue(queuedJob);
  vi.mocked(getCleaningJob).mockResolvedValue(succeededJob);
  vi.mocked(getCleaningResult).mockResolvedValue(cleaningResult);
  vi.mocked(loadCleaningResultsMetadata).mockResolvedValue(new Map([
    ["blob:one", storedMetadata()],
  ]));
  const { result } = renderHook(() => useCleaning({ pages: ["blob:one"], currentPage: 0 }));
  let firstClean!: Promise<PageCleaningResult>;
  act(() => {
    firstClean = result.current.cleanPage("blob:one", SOURCE_BLOB);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
    await firstClean;
  });
  const candidateId = result.current.remnantReviews.get("blob:one")!.inspection.candidates[0].id;

  let confirmed = false;
  await act(async () => {
    confirmed = result.current.confirmArtworkCandidate("blob:one", candidateId);
  });
  expect(confirmed).toBe(true);
  expect(result.current.remnantReviews.get("blob:one")?.eligibility).toBe("human-confirmed");
  // The confirmation is persisted bound to its revision key.
  await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); });
  expect(vi.mocked(saveCleaningResultMetadata).mock.calls.some(([record]) =>
    (record.artworkConfirmations?.length ?? 0) > 0 &&
    record.artworkConfirmations?.[0].candidateId === candidateId &&
    typeof record.artworkConfirmations?.[0].revisionKey === "string" &&
    record.artworkConfirmations?.[0].revisionKey.length > 0,
  )).toBe(true);

  // Recleaning from replaced source bytes produces a new revision: the old
  // confirmation must not approve it (never broad future approval).
  let reclean!: Promise<PageCleaningResult>;
  act(() => {
    reclean = result.current.cleanPage("blob:one", REPLACED_SOURCE_BLOB, true);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
    await reclean;
  });
  const recleaned = result.current.remnantReviews.get("blob:one");
  expect(recleaned?.eligibility).toBe("unresolved");
  expect(recleaned?.inspection.candidates.filter((c) => c.state !== "human-confirmed-artwork")).toHaveLength(1);
});

test("opening saved work inspects locally without provider calls and restores persisted confirmations", async () => {
  const discovered = await inspectCleanedPage({
    result: {
      sourceFingerprint: `${SOURCE_BLOB.size}:image/png`,
      maskFingerprint: `${maskBlob.size}:image/png`,
      regions: [regionFixture],
      cleanBlob: UNCLEANED_CLEAN_BLOB,
    },
    sourceBlob: SOURCE_BLOB,
  });
  const candidate = discovered.candidates[0];
  const confirmation = {
    candidateId: candidate.id,
    revisionKey: discovered.revisionKey,
  };

  vi.mocked(loadCleaningResultsMetadata).mockResolvedValue(new Map([
    ["blob:one", storedMetadata({ artworkConfirmations: [confirmation] })],
  ]));
  vi.mocked(loadCleaningResultAssets).mockResolvedValue({
    cleanBlob: UNCLEANED_CLEAN_BLOB,
    maskBlob,
    reviewMaskBlob: null,
    protectedMaskBlob: null,
  });
  vi.mocked(getCleaningResult).mockRejectedValue(
    new CleaningClientError(503, "Python cleaner backend is offline", "retry"),
  );

  const { result } = renderHook(() => useCleaning({ pages: ["blob:one"], currentPage: 0 }));
  await act(async () => {
    for (let i = 0; i < 24; i += 1) await Promise.resolve();
  });

  expect(result.current.currentResult?.jobId).toBe("job-offline-1");
  expect(createCleaningJob).not.toHaveBeenCalled();
  expect(getCleaningResult).not.toHaveBeenCalled();
  // The persisted, revision-bound confirmation re-binds to the unchanged background.
  const review = result.current.remnantReviews.get("blob:one");
  expect(review?.inspection.candidates[0]?.state).toBe("human-confirmed-artwork");
  expect(review?.eligibility).toBe("human-confirmed");
});

test("opening a legacy project without fingerprints makes no provider calls and never silently restores", async () => {
  vi.mocked(loadCleaningResultsMetadata).mockResolvedValue(new Map([
    ["blob:one", {
      pageUrl: "blob:one",
      sourceHash: "a".repeat(64),
      jobId: "legacy-job",
      regions: [regionFixture],
      updatedAt: 1,
    }],
  ]));
  vi.mocked(loadCleaningResultAssets).mockResolvedValue({
    cleanBlob: UNCLEANED_CLEAN_BLOB,
    maskBlob,
    reviewMaskBlob: null,
    protectedMaskBlob: null,
  });

  const { result } = renderHook(() => useCleaning({ pages: ["blob:one"], currentPage: 0 }));
  await act(async () => {
    for (let i = 0; i < 24; i += 1) await Promise.resolve();
  });

  expect(createCleaningJob).not.toHaveBeenCalled();
  expect(getCleaningResult).not.toHaveBeenCalled();
  expect(result.current.resultsByPage.has("blob:one")).toBe(false);
  expect(result.current.remnantReviews.has("blob:one")).toBe(false);
});

test("failed image decoding is reported as unverified and cannot be confirmed away", async () => {
  decodeFailures = 1; // the original page decode fails
  vi.mocked(createCleaningJob).mockResolvedValue(queuedJob);
  vi.mocked(getCleaningJob).mockResolvedValue(succeededJob);
  vi.mocked(getCleaningResult).mockResolvedValue(cleaningResult);
  const { result } = renderHook(() => useCleaning({ pages: ["blob:one"], currentPage: 0 }));

  let cleaning!: Promise<PageCleaningResult>;
  act(() => {
    cleaning = result.current.cleanPage("blob:one", SOURCE_BLOB);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
    await cleaning;
  });

  const review = result.current.remnantReviews.get("blob:one");
  expect(review?.inspection.status).toBe("unverified");
  expect(review?.inspection.unverifiedReason).toBe("detection-failed");
  expect(review?.eligibility).toBe("unavailable");
  expect(result.current.confirmArtworkCandidate("blob:one", "rem-anything")).toBe(false);
});

test("removing a page drops its remnant review", async () => {
  vi.mocked(createCleaningJob).mockResolvedValue(queuedJob);
  vi.mocked(getCleaningJob).mockResolvedValue(succeededJob);
  vi.mocked(getCleaningResult).mockResolvedValue(cleaningResult);
  const { result, rerender } = renderHook(
    ({ pages }) => useCleaning({ pages, currentPage: 0 }),
    { initialProps: { pages: ["blob:one", "blob:two"] } },
  );
  let cleaning!: Promise<PageCleaningResult>;
  act(() => {
    cleaning = result.current.cleanPage("blob:one", SOURCE_BLOB);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
    await cleaning;
  });
  expect(result.current.remnantReviews.has("blob:one")).toBe(true);
  rerender({ pages: ["blob:two"] });
  expect(result.current.remnantReviews.has("blob:one")).toBe(false);
});

test("a clean background yields an approved review without findings", async () => {
  // Replace the clean asset fixture with fully cleaned bytes for this test.
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const asset = url.includes("clean.png") && !url.includes("review-mask") && !url.includes("protected-mask")
      ? CLEANED_CLEAN_BLOB
      : url.includes("mask.png") || url.includes("review-mask") || url.includes("protected-mask")
        ? maskBlob
        : SOURCE_BLOB;
    return { ok: true, status: 200, blob: async () => asset } as Response;
  });
  vi.mocked(createCleaningJob).mockResolvedValue(queuedJob);
  vi.mocked(getCleaningJob).mockResolvedValue(succeededJob);
  vi.mocked(getCleaningResult).mockResolvedValue(cleaningResult);
  const { result } = renderHook(() => useCleaning({ pages: ["blob:one"], currentPage: 0 }));

  let cleaning!: Promise<PageCleaningResult>;
  act(() => {
    cleaning = result.current.cleanPage("blob:one", SOURCE_BLOB);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
    await cleaning;
  });

  const review = result.current.remnantReviews.get("blob:one");
  expect(review?.inspection.status).toBe("inspected");
  expect(review?.inspection.candidates).toEqual([]);
  expect(review?.eligibility).toBe("approved");
});

test("stored metadata fingerprints stay verifiable through the shared fingerprint helper", async () => {
  expect(await blobFingerprint(SOURCE_BLOB)).toBe(`${SOURCE_BLOB.size}:image/png`);
});
