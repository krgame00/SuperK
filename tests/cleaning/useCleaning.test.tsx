import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  useCleaning,
  type PageCleaningResult,
} from "@/hooks/useCleaning";
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

const queuedJob = {
  jobId: "job-1",
  status: "queued" as const,
  stage: "queued" as const,
};
const runningJob = {
  jobId: "job-1",
  status: "running" as const,
  stage: "cleaning" as const,
  progress: {
    stage: "cleaning" as const,
    completedRegions: 1,
    totalRegions: 2,
    elapsedMs: 10,
  },
};
const succeededJob = {
  jobId: "job-1",
  status: "succeeded" as const,
  stage: "complete" as const,
};
const cleaningResult = {
  jobId: "job-1",
  sourceHash: "a".repeat(64),
  width: 8,
  height: 8,
  cleanAsset: "/api/clean/v1/jobs/job-1/assets/clean.png",
  maskAsset: "/api/clean/v1/jobs/job-1/assets/mask.png",
  reviewMaskAsset: "/api/clean/v1/jobs/job-1/assets/review-mask.png",
  protectedMaskAsset: "/api/clean/v1/jobs/job-1/assets/protected-mask.png",
  regions: [],
  timingsMs: { total: 10 },
  pipelineVersion: "2.3.1-enclosed-backing",
};

const staleMaskRegion = {
  id: "region-old",
  rect: { x: 10, y: 10, width: 20, height: 12 },
  route: "flat" as const,
  confidence: 0.9,
  status: "needs_review" as const,
  residualScore: 0,
  damageScore: 0,
  pageRole: "comic" as const,
  textRole: "review" as const,
  eligibilityConfidence: 0.8,
  automaticAction: "clean" as const,
  protectionReasons: [],
};

const recoveredMaskRegion = {
  ...staleMaskRegion,
  id: "region-new",
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.mocked(createCleaningJob).mockReset();
  vi.mocked(getCleaningJob).mockReset();
  vi.mocked(getCleaningResult).mockReset();
  vi.mocked(retryCleaningRegion).mockReset();
  vi.mocked(loadCleaningResultsMetadata).mockResolvedValue(new Map());
  vi.mocked(saveCleaningResultMetadata).mockResolvedValue();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn().mockResolvedValue({ width: 8, height: 8, close: vi.fn() }),
  );
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    const asset = new Blob(["asset"], { type: "image/png" });
    return {
      ok: true,
      status: 200,
      blob: async () => asset,
    } as Response;
  });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi
      .fn()
      .mockReturnValueOnce("blob:clean")
      .mockReturnValueOnce("blob:mask")
      .mockReturnValueOnce("blob:review")
      .mockReturnValueOnce("blob:protected"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("renders safely before any page is uploaded", () => {
  const { result } = renderHook(() =>
    useCleaning({ pages: [], currentPage: 0 }),
  );
  expect(result.current.progress).toBeUndefined();
  expect(result.current.currentResult).toBeUndefined();
});

test("polls until succeeded and stores result for current page", async () => {
  vi.mocked(createCleaningJob).mockResolvedValue(queuedJob);
  vi.mocked(getCleaningJob)
    .mockResolvedValueOnce(runningJob)
    .mockResolvedValueOnce(succeededJob);
  vi.mocked(getCleaningResult).mockResolvedValue(cleaningResult);
  const { result } = renderHook(() =>
    useCleaning({ pages: ["blob:page-1"], currentPage: 0 }),
  );
  let cleaning!: Promise<PageCleaningResult | undefined>;
  act(() => {
    cleaning = result.current.cleanCurrentPage(
      new Blob(["png"], { type: "image/png" }),
    );
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
    await cleaning;
  });
  expect(result.current.currentResult?.jobId).toBe("job-1");
  expect(result.current.currentResult?.cleanUrl).toBe("blob:clean");
  expect(result.current.currentResult?.reviewMaskUrl).toBe("blob:review");
  expect(result.current.currentResult?.protectedMaskUrl).toBe(
    "blob:protected",
  );
  expect(saveCleaningResultMetadata).toHaveBeenCalledWith(
    expect.objectContaining({ pageUrl: "blob:page-1", jobId: "job-1" }),
  );
});

test("clears progress and returns cleaning result even if saveCleaningResultMetadata rejects", async () => {
  vi.mocked(saveCleaningResultMetadata).mockRejectedValueOnce(
    new Error("IndexedDB write timeout or transaction deadlocked"),
  );
  vi.mocked(createCleaningJob).mockResolvedValue(queuedJob);
  vi.mocked(getCleaningJob).mockResolvedValue(succeededJob);
  vi.mocked(getCleaningResult).mockResolvedValue(cleaningResult);
  const { result } = renderHook(() =>
    useCleaning({ pages: ["blob:page-1"], currentPage: 0 }),
  );
  let cleaning!: Promise<PageCleaningResult>;
  act(() => {
    cleaning = result.current.cleanPage(
      "blob:page-1",
      new Blob(["png"], { type: "image/png" }),
    );
  });
  let pageResult!: PageCleaningResult;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
    pageResult = await cleaning;
  });
  expect(pageResult?.jobId).toBe("job-1");
  expect(result.current.progress).toBeUndefined();
});

test("page change aborts polling", async () => {
  vi.mocked(createCleaningJob).mockResolvedValue(queuedJob);
  const { result, rerender } = renderHook(
    ({ currentPage }) =>
      useCleaning({ pages: ["blob:one", "blob:two"], currentPage }),
    { initialProps: { currentPage: 0 } },
  );
  act(() => {
    void result.current.cleanCurrentPage(
      new Blob(["png"], { type: "image/png" }),
    );
  });
  rerender({ currentPage: 1 });
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(getCleaningJob).not.toHaveBeenCalled();
});

test("service offline returns start-local-service recovery", async () => {
  vi.mocked(createCleaningJob).mockRejectedValue(
    new CleaningClientError(503, "offline", "start it"),
  );
  const { result } = renderHook(() =>
    useCleaning({ pages: ["blob:one"], currentPage: 0 }),
  );
  await act(async () => {
    await result.current.cleanCurrentPage(
      new Blob(["png"], { type: "image/png" }),
    );
  });
  expect(result.current.error?.recovery).toBe("start-local-service");
});

test("cleanPage returns and reuses a result by original URL", async () => {
  vi.mocked(createCleaningJob).mockResolvedValue(succeededJob);
  vi.mocked(getCleaningResult).mockResolvedValue(cleaningResult);
  const { result } = renderHook(() =>
    useCleaning({ pages: ["blob:one"], currentPage: 0 }),
  );
  let first!: PageCleaningResult;
  let second!: PageCleaningResult;
  await act(async () => {
    first = await result.current.cleanPage(
      "blob:one",
      new Blob(["png"], { type: "image/png" }),
    );
    second = await result.current.cleanPage(
      "blob:one",
      new Blob(["png"], { type: "image/png" }),
    );
  });
  expect(first.cleanUrl).toBe("blob:clean");
  expect(second).toBe(first);
  expect(createCleaningJob).toHaveBeenCalledOnce();
});

test("cleanPage recomputes when the source bytes change", async () => {
  vi.mocked(createCleaningJob)
    .mockResolvedValueOnce({ ...succeededJob, jobId: "job-1" })
    .mockResolvedValueOnce({ ...succeededJob, jobId: "job-2" });
  vi.mocked(getCleaningResult).mockImplementation(async (jobId) => ({
    ...cleaningResult,
    jobId,
  }));
  const { result } = renderHook(() =>
    useCleaning({ pages: ["blob:one"], currentPage: 0 }),
  );

  await act(async () => {
    await result.current.cleanPage("blob:one", new Blob(["png"], { type: "image/png" }));
    await result.current.cleanPage("blob:one", new Blob(["changed source"], { type: "image/png" }));
  });

  expect(createCleaningJob).toHaveBeenCalledTimes(2);
  expect(result.current.currentResult?.jobId).toBe("job-2");
});

test("cleanPage recomputes an in-memory result from an older pipeline", async () => {
  vi.mocked(createCleaningJob)
    .mockResolvedValueOnce({ ...succeededJob, jobId: "job-old" })
    .mockResolvedValueOnce({ ...succeededJob, jobId: "job-new" });
  vi.mocked(getCleaningResult).mockImplementation(async (jobId) => ({
    ...cleaningResult,
    jobId,
    pipelineVersion: jobId === "job-old" ? "2.1.0-complete-glyph" : "2.3.1-enclosed-backing",
  }));
  const { result } = renderHook(() =>
    useCleaning({ pages: ["blob:one"], currentPage: 0 }),
  );

  await act(async () => {
    await result.current.cleanPage("blob:one", new Blob(["png"], { type: "image/png" }));
    await result.current.cleanPage("blob:one", new Blob(["png"], { type: "image/png" }));
  });

  expect(createCleaningJob).toHaveBeenCalledTimes(2);
  expect(result.current.currentResult?.jobId).toBe("job-new");
});

test("cleanPage can finish a non-current batch page", async () => {
  vi.mocked(createCleaningJob).mockResolvedValue(queuedJob);
  vi.mocked(getCleaningJob)
    .mockResolvedValueOnce(runningJob)
    .mockResolvedValueOnce(succeededJob);
  vi.mocked(getCleaningResult).mockResolvedValue(cleaningResult);
  const { result } = renderHook(() =>
    useCleaning({ pages: ["blob:one", "blob:two"], currentPage: 0 }),
  );
  let cleaning!: Promise<PageCleaningResult>;
  act(() => {
    cleaning = result.current.cleanPage(
      "blob:two",
      new Blob(["png"], { type: "image/png" }),
    );
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
    await cleaning;
  });
  expect(result.current.resultsByPage.get("blob:two")?.jobId).toBe("job-1");
});

test("cleanPage records and rethrows a cleaning failure", async () => {
  vi.mocked(createCleaningJob).mockRejectedValue(
    new CleaningClientError(503, "offline", "start it"),
  );
  const { result } = renderHook(() =>
    useCleaning({ pages: ["blob:one"], currentPage: 0 }),
  );
  await act(async () => {
    await expect(
      result.current.cleanPage(
        "blob:one",
        new Blob(["png"], { type: "image/png" }),
      ),
    ).rejects.toThrow("offline");
  });
  expect(result.current.error?.recovery).toBe("start-local-service");
});

test("cleanPage fails when clean image dimensions cannot be validated", async () => {
  vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("cannot validate clean image dimensions")));
  vi.mocked(createCleaningJob).mockResolvedValue(succeededJob);
  vi.mocked(getCleaningResult).mockResolvedValue(cleaningResult);
  const { result } = renderHook(() =>
    useCleaning({ pages: ["blob:one"], currentPage: 0 }),
  );

  await act(async () => {
    await expect(
      result.current.cleanPage(
        "blob:one",
        new Blob(["png"], { type: "image/png" }),
      ),
    ).rejects.toThrow("cannot validate clean image dimensions");
  });

  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(saveCleaningResultMetadata).not.toHaveBeenCalled();
  expect(result.current.resultsByPage.has("blob:one")).toBe(false);
  expect(result.current.error).toEqual(
    expect.objectContaining({ recovery: "retry" }),
  );
});

test("cleanPage rejects a clean asset whose dimensions do not match the result", async () => {
  const close = vi.fn();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn().mockResolvedValue({ width: 7, height: 8, close }),
  );
  vi.mocked(createCleaningJob).mockResolvedValue(succeededJob);
  vi.mocked(getCleaningResult).mockResolvedValue(cleaningResult);
  const { result } = renderHook(() =>
    useCleaning({ pages: ["blob:one"], currentPage: 0 }),
  );

  await act(async () => {
    await expect(
      result.current.cleanPage(
        "blob:one",
        new Blob(["png"], { type: "image/png" }),
      ),
    ).rejects.toThrow("dimensions must match");
  });

  expect(close).toHaveBeenCalledOnce();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(saveCleaningResultMetadata).not.toHaveBeenCalled();
  expect(result.current.resultsByPage.has("blob:one")).toBe(false);
  expect(result.current.error).toEqual(
    expect.objectContaining({ recovery: "retry" }),
  );
});

test("retryRegion returns the updated cleaning result", async () => {
  vi.mocked(createCleaningJob).mockResolvedValue(succeededJob);
  vi.mocked(retryCleaningRegion).mockResolvedValue({
    ...succeededJob,
    jobId: "job-2",
  });
  vi.mocked(getCleaningResult)
    .mockResolvedValueOnce(cleaningResult)
    .mockResolvedValueOnce({ ...cleaningResult, jobId: "job-2" });
  vi.mocked(URL.createObjectURL)
    .mockReset()
    .mockReturnValueOnce("blob:clean")
    .mockReturnValueOnce("blob:mask")
    .mockReturnValueOnce("blob:review")
    .mockReturnValueOnce("blob:protected")
    .mockReturnValueOnce("blob:clean-2")
    .mockReturnValueOnce("blob:mask-2")
    .mockReturnValueOnce("blob:review-2")
    .mockReturnValueOnce("blob:protected-2");
  const { result } = renderHook(() =>
    useCleaning({ pages: ["blob:one"], currentPage: 0 }),
  );
  await act(async () => {
    await result.current.cleanCurrentPage(
      new Blob(["png"], { type: "image/png" }),
    );
  });
  let updated!: PageCleaningResult | undefined;
  await act(async () => {
    updated = await result.current.retryRegion(
      "region-1",
      new Blob(["mask"], { type: "image/png" }),
    );
  });
  expect(updated?.jobId).toBe("job-2");
  expect(result.current.currentResult?.cleanUrl).toBe("blob:clean-2");
});

test("restored metadata cannot overwrite a newer cleanPage result", async () => {
  let resolveSaved!: (
    value: Map<
      string,
      {
        pageUrl: string;
        sourceHash: string;
        jobId: string;
        regions: never[];
        updatedAt: number;
      }
    >,
  ) => void;
  vi.mocked(loadCleaningResultsMetadata).mockReturnValue(
    new Promise((resolve) => {
      resolveSaved = resolve;
    }),
  );
  vi.mocked(createCleaningJob).mockResolvedValue({
    ...succeededJob,
    jobId: "job-new",
  });
  vi.mocked(getCleaningResult).mockImplementation(async (jobId) => ({
    ...cleaningResult,
    jobId,
    sourceHash: jobId === "job-old" ? "b".repeat(64) : "a".repeat(64),
  }));
  const pages = ["blob:one"];
  const { result } = renderHook(() =>
    useCleaning({ pages, currentPage: 0 }),
  );
  await act(async () => {
    await result.current.cleanPage(
      "blob:one",
      new Blob(["new"], { type: "image/png" }),
    );
  });
  await act(async () => {
    resolveSaved(
      new Map([
        [
          "blob:one",
          {
            pageUrl: "blob:one",
            sourceHash: "b".repeat(64),
            jobId: "job-old",
            regions: [],
            updatedAt: 1,
          },
        ],
      ]),
    );
    await vi.runAllTimersAsync();
  });
  expect(result.current.currentResult?.jobId).toBe("job-new");
});

test("cleanPage cannot restore a page removed while polling", async () => {
  vi.mocked(createCleaningJob).mockResolvedValue(queuedJob);
  vi.mocked(getCleaningJob).mockResolvedValue(succeededJob);
  vi.mocked(getCleaningResult).mockResolvedValue(cleaningResult);
  const { result, rerender } = renderHook(
    ({ pages }) => useCleaning({ pages, currentPage: 0 }),
    { initialProps: { pages: ["blob:one"] } },
  );
  let settled!: Promise<PageCleaningResult | Error>;
  act(() => {
    settled = result.current
      .cleanPage(
        "blob:one",
        new Blob(["png"], { type: "image/png" }),
      )
      .catch((error: Error) => error);
  });
  rerender({ pages: [] });
  let outcome!: PageCleaningResult | Error;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
    outcome = await settled;
  });
  expect(outcome).toBeInstanceOf(Error);
  expect(result.current.resultsByPage.has("blob:one")).toBe(false);
});

test("cached cleanPage clears an earlier structured error", async () => {
  vi.mocked(createCleaningJob).mockResolvedValue(succeededJob);
  vi.mocked(getCleaningResult).mockResolvedValue(cleaningResult);
  vi.mocked(retryCleaningRegion).mockRejectedValue(
    new CleaningClientError(503, "offline", "start it"),
  );
  const { result } = renderHook(() =>
    useCleaning({ pages: ["blob:one"], currentPage: 0 }),
  );
  await act(async () => {
    await result.current.cleanPage(
      "blob:one",
      new Blob(["png"], { type: "image/png" }),
    );
  });
  await act(async () => {
    await result.current.retryRegion(
      "region-1",
      new Blob(["mask"], { type: "image/png" }),
    );
  });
  expect(result.current.error?.recovery).toBe("start-local-service");
  await act(async () => {
    await result.current.cleanPage(
      "blob:one",
      new Blob(["png"], { type: "image/png" }),
    );
  });
  expect(result.current.error).toBeUndefined();
});

test("retryRegion rebuilds a stale cleaner job and remaps the Mask region", async () => {
  const pixels = new ImageData(new Uint8ClampedArray(100 * 80 * 4), 100, 80);
  pixels.data[(11 * 100 + 10) * 4] = 255;
  pixels.data[(11 * 100 + 14) * 4] = 255;
  const putImageData = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(), getImageData: vi.fn(() => pixels), putImageData,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["clipped"], { type: "image/png" })));
  const staleResult = {
    ...cleaningResult,
    jobId: "job-stale",
    regions: [staleMaskRegion],
  };
  const rebuiltResult = {
    ...cleaningResult,
    jobId: "job-rebuilt",
    regions: [{ ...recoveredMaskRegion, rect: { ...recoveredMaskRegion.rect, x: 13 } }],
  };
  const confirmedResult = {
    ...rebuiltResult,
    jobId: "job-confirmed",
  };
  const cleanedResult = {
    ...rebuiltResult,
    jobId: "job-cleaned",
  };

  vi.mocked(createCleaningJob)
    .mockResolvedValueOnce({ ...succeededJob, jobId: "job-stale" })
    .mockResolvedValueOnce({ ...succeededJob, jobId: "job-rebuilt" });
  vi.mocked(getCleaningResult)
    .mockResolvedValueOnce(staleResult)
    .mockResolvedValueOnce(rebuiltResult)
    .mockResolvedValueOnce(confirmedResult)
    .mockResolvedValueOnce(cleanedResult);
  vi.mocked(retryCleaningRegion)
    .mockRejectedValueOnce(
      new CleaningClientError(404, "Job not found.", "retry"),
    )
    .mockResolvedValueOnce({ ...succeededJob, jobId: "job-confirmed" })
    .mockResolvedValueOnce({ ...succeededJob, jobId: "job-cleaned" });

  const { result } = renderHook(() =>
    useCleaning({ pages: ["blob:one"], currentPage: 0 }),
  );

  await act(async () => {
    await result.current.cleanPage(
      "blob:one",
      new Blob(["png"], { type: "image/png" }),
    );
  });
  vi.stubGlobal("createImageBitmap", vi.fn().mockImplementation(async (blob: Blob) => ({
    width: blob.size === 5 ? 8 : 100,
    height: blob.size === 5 ? 8 : 80,
    close: vi.fn(),
  })));

  let confirmed!: PageCleaningResult | undefined;
  await act(async () => {
    confirmed = await result.current.retryRegion(
      "region-old",
      new Blob(["mask"], { type: "image/png" }),
      "auto",
      "confirm-text",
    );
  });

  expect(retryCleaningRegion).toHaveBeenNthCalledWith(
    1,
    "job-stale",
    "region-old",
    expect.any(Blob),
    "auto",
    "confirm-text",
  );
  expect(retryCleaningRegion).toHaveBeenNthCalledWith(
    2,
    "job-rebuilt",
    "region-new",
    expect.any(Blob),
    "auto",
    "confirm-text",
  );
  expect(confirmed?.jobId).toBe("job-confirmed");
  expect(result.current.error).toBeUndefined();

  let cleaned!: PageCleaningResult | undefined;
  const secondActionMask = new Blob(["mask"], { type: "image/png" });
  await act(async () => {
    cleaned = await result.current.retryRegion(
      "region-old",
      secondActionMask,
      "auto",
      "force-clean",
    );
  });

  expect(retryCleaningRegion).toHaveBeenNthCalledWith(
    3,
    "job-confirmed",
    "region-new",
    expect.any(Blob),
    "auto",
    "force-clean",
  );
  expect(vi.mocked(retryCleaningRegion).mock.calls[2][2]).not.toBe(secondActionMask);
  expect(putImageData).toHaveBeenCalled();
  expect(pixels.data[(11 * 100 + 10) * 4]).toBe(0);
  expect(pixels.data[(11 * 100 + 14) * 4]).toBe(255);
  expect(cleaned?.jobId).toBe("job-cleaned");
  expect(result.current.error).toBeUndefined();
});

test("same region ID with a shifted rectangle reports an adjustment after stale-job recovery", async () => {
  const shiftedRegion = { ...staleMaskRegion, rect: { ...staleMaskRegion.rect, x: 11 } };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
    getImageData: vi.fn(() => new ImageData(new Uint8ClampedArray(100 * 80 * 4), 100, 80)),
    putImageData: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["clipped"], { type: "image/png" })));
  vi.mocked(createCleaningJob)
    .mockResolvedValueOnce({ ...succeededJob, jobId: "job-stale" })
    .mockResolvedValueOnce({ ...succeededJob, jobId: "job-rebuilt" });
  vi.mocked(getCleaningResult)
    .mockResolvedValueOnce({ ...cleaningResult, jobId: "job-stale", regions: [staleMaskRegion] })
    .mockResolvedValueOnce({ ...cleaningResult, jobId: "job-rebuilt", regions: [shiftedRegion] })
    .mockResolvedValueOnce({ ...cleaningResult, jobId: "job-confirmed", regions: [shiftedRegion] });
  vi.mocked(retryCleaningRegion)
    .mockRejectedValueOnce(new CleaningClientError(404, "Job not found.", "retry"))
    .mockResolvedValueOnce({ ...succeededJob, jobId: "job-confirmed" });
  const { result } = renderHook(() => useCleaning({ pages: ["blob:one"], currentPage: 0 }));
  await act(async () => { await result.current.cleanPage("blob:one", new Blob(["png"], { type: "image/png" })); });
  vi.stubGlobal("createImageBitmap", vi.fn().mockImplementation(async (blob: Blob) => ({
    width: blob.size === 5 ? 8 : 100,
    height: blob.size === 5 ? 8 : 80,
    close: vi.fn(),
  })));
  let recovered!: PageCleaningResult | undefined;
  await act(async () => {
    recovered = await result.current.retryRegion("region-old", new Blob(["mask"], { type: "image/png" }), "auto", "confirm-text");
  });
  expect(recovered?.maskAdjustment).toBe("remapped");
  expect(recovered?.recoveredRegionId).toBe("region-old");
  expect(retryCleaningRegion).toHaveBeenCalledTimes(2);
});

test.each([
  { name: "exact identity", regions: [recoveredMaskRegion, staleMaskRegion], expected: "region-old" },
  { name: "strong changed identity", regions: [recoveredMaskRegion], expected: "region-new" },
  { name: "weak overlap", regions: [{ ...recoveredMaskRegion, rect: { x: 25, y: 10, width: 20, height: 12 } }], expected: undefined },
  { name: "ambiguous overlap", regions: [recoveredMaskRegion, { ...recoveredMaskRegion, id: "region-other" }], expected: undefined },
])("resolveMaskRegion handles $name before authorization", async ({ regions, expected }) => {
  vi.mocked(createCleaningJob)
    .mockResolvedValueOnce({ ...succeededJob, jobId: "job-stale" })
    .mockResolvedValueOnce({ ...succeededJob, jobId: "job-rebuilt" });
  vi.mocked(getCleaningResult)
    .mockResolvedValueOnce({ ...cleaningResult, jobId: "job-stale", regions: [staleMaskRegion] })
    .mockResolvedValueOnce({ ...cleaningResult, jobId: "job-rebuilt", regions });
  vi.mocked(getCleaningJob).mockRejectedValueOnce(new CleaningClientError(404, "Job not found.", "retry"));
  const { result } = renderHook(() => useCleaning({ pages: ["blob:one"], currentPage: 0 }));
  await act(async () => {
    await result.current.cleanPage("blob:one", new Blob(["png"], { type: "image/png" }));
  });

  if (expected) {
    let resolved!: Awaited<ReturnType<typeof result.current.resolveMaskRegion>>;
    await act(async () => { resolved = await result.current.resolveMaskRegion(staleMaskRegion); });
    expect(resolved?.region.id).toBe(expected);
    expect(resolved?.remapped).toBe(expected !== "region-old");
  } else {
    await expect(result.current.resolveMaskRegion(staleMaskRegion)).rejects.toThrow("ไม่พบพื้นที่ Mask");
  }
  expect(retryCleaningRegion).not.toHaveBeenCalled();
});

test("page change aborts retryRegion polling", async () => {
  vi.mocked(createCleaningJob).mockResolvedValue(succeededJob);
  vi.mocked(getCleaningResult).mockResolvedValue(cleaningResult);
  vi.mocked(retryCleaningRegion).mockResolvedValue(queuedJob);
  const { result, rerender } = renderHook(
    ({ currentPage }) =>
      useCleaning({ pages: ["blob:one", "blob:two"], currentPage }),
    { initialProps: { currentPage: 0 } },
  );
  await act(async () => {
    await result.current.cleanCurrentPage(
      new Blob(["png"], { type: "image/png" }),
    );
  });
  act(() => {
    void result.current.retryRegion(
      "region-1",
      new Blob(["mask"], { type: "image/png" }),
    );
  });
  rerender({ currentPage: 1 });
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(getCleaningJob).not.toHaveBeenCalled();
});

test("cancelled page progress does not return when navigating back", async () => {
  vi.mocked(createCleaningJob).mockResolvedValue(queuedJob);
  vi.mocked(getCleaningJob).mockResolvedValueOnce(runningJob);
  const { result, rerender } = renderHook(
    ({ currentPage }) =>
      useCleaning({ pages: ["blob:one", "blob:two"], currentPage }),
    { initialProps: { currentPage: 0 } },
  );
  let cleaning!: Promise<PageCleaningResult | undefined>;
  act(() => {
    cleaning = result.current.cleanCurrentPage(
      new Blob(["png"], { type: "image/png" }),
    );
  });
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(result.current.progress?.stage).toBe("cleaning");
  rerender({ currentPage: 1 });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
    await cleaning;
  });
  rerender({ currentPage: 0 });
  expect(result.current.progress).toBeUndefined();
});

test("removing one page revokes and drops its cached result", async () => {
  vi.mocked(createCleaningJob).mockResolvedValue(succeededJob);
  vi.mocked(getCleaningResult).mockResolvedValue(cleaningResult);
  const { result, rerender } = renderHook(
    ({ pages }) => useCleaning({ pages, currentPage: 0 }),
    { initialProps: { pages: ["blob:one", "blob:two"] } },
  );
  await act(async () => {
    await result.current.cleanPage(
      "blob:one",
      new Blob(["png"], { type: "image/png" }),
    );
  });
  rerender({ pages: ["blob:two"] });
  expect(result.current.resultsByPage.has("blob:one")).toBe(false);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:clean");
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mask");
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:review");
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:protected");
});

test("stale saved job asks for reclean without crashing", async () => {
  vi.mocked(loadCleaningResultsMetadata).mockResolvedValue(
    new Map([
      [
        "blob:one",
        {
          pageUrl: "blob:one",
          sourceHash: "a".repeat(64),
          sourceFingerprint: "5:image/png",
          maskFingerprint: "5:image/png",
          pipelineVersion: "2.3.1-enclosed-backing",
          jobId: "missing-job",
          regions: [],
          updatedAt: 1,
        },
      ],
    ]),
  );
  vi.mocked(getCleaningResult).mockRejectedValue(
    new CleaningClientError(404, "missing", "retry"),
  );
  const { result } = renderHook(() =>
    useCleaning({ pages: ["blob:one"], currentPage: 0 }),
  );
  await act(async () => {
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
  });
  expect(result.current.error?.recovery).toBe("reclean");
});

test("unmount revokes generated asset URLs", async () => {
  vi.mocked(createCleaningJob).mockResolvedValue(succeededJob);
  vi.mocked(getCleaningResult).mockResolvedValue(cleaningResult);
  const { result, unmount } = renderHook(() =>
    useCleaning({ pages: ["blob:one"], currentPage: 0 }),
  );
  await act(async () => {
    await result.current.cleanCurrentPage(
      new Blob(["png"], { type: "image/png" }),
    );
  });
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:clean");
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mask");
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:review");
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:protected");
});

test("restores cleaning result directly from IndexedDB assets without contacting cleaning service", async () => {
  const pageUrl = "blob:one";
  const cleanBlob = new Blob(["clean-image-data"], { type: "image/png" });
  const maskBlob = new Blob(["mask-image-data"], { type: "image/png" });

  vi.mocked(loadCleaningResultsMetadata).mockResolvedValue(
    new Map([
      [
        pageUrl,
        {
          pageUrl,
          sourceHash: "a".repeat(64),
          sourceFingerprint: "5:image/png",
          maskFingerprint: `${maskBlob.size}:image/png`,
          pipelineVersion: "2.3.1-enclosed-backing",
          jobId: "job-offline-1",
          width: 1000,
          height: 1400,
          regions: [{ ...staleMaskRegion, textConfirmed: true, maskApproved: true, approvalRevision: null }],
          updatedAt: Date.now(),
          cleanAssetId: "clean_blob%3Aone",
          maskAssetId: "mask_blob%3Aone",
        },
      ],
    ]),
  );

  vi.mocked(loadCleaningResultAssets).mockResolvedValue({
    cleanBlob,
    maskBlob,
    reviewMaskBlob: null,
    protectedMaskBlob: null,
  });

  vi.mocked(getCleaningResult).mockRejectedValue(
    new CleaningClientError(503, "Python cleaner backend is offline", "retry"),
  );

  const { result } = renderHook(() =>
    useCleaning({ pages: [pageUrl], currentPage: 0 }),
  );

  await act(async () => {
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
  });

  expect(result.current.currentResult?.jobId).toBe("job-offline-1");
  expect(result.current.currentResult?.regions[0].maskApproved).toBe(false);
  expect(result.current.error).toBeUndefined();
  expect(getCleaningResult).not.toHaveBeenCalled();
});

test.each([true, undefined])("fast restore preserves review state (stored flag: %s)", async (awaitingReview) => {
  const maskBlob = new Blob(["mask"], { type: "image/png" });
  vi.mocked(loadCleaningResultsMetadata).mockResolvedValue(new Map([["blob:one", {
    pageUrl: "blob:one", sourceHash: "a".repeat(64),
    sourceFingerprint: "5:image/png", maskFingerprint: "4:image/png",
    pipelineVersion: "2.3.1-enclosed-backing", jobId: "offline-review",
    width: 8, height: 8, regions: [staleMaskRegion], updatedAt: 1,
    awaitingReview,
  }]]));
  vi.mocked(loadCleaningResultAssets).mockResolvedValue({
    cleanBlob: new Blob(["clean"], { type: "image/png" }), maskBlob,
    reviewMaskBlob: null, protectedMaskBlob: null,
  });
  const { result } = renderHook(() => useCleaning({ pages: ["blob:one"], currentPage: 0 }));
  await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });
  expect(result.current.currentResult?.awaitingReview).toBe(true);
  const reused = await result.current.cleanPage("blob:one", new Blob(["asset"], { type: "image/png" }));
  expect(reused.awaitingReview).toBe(true);
  expect(getCleaningResult).not.toHaveBeenCalled();
  expect(createCleaningJob).not.toHaveBeenCalled();
});

test("cleaning persistence stores the awaiting-review flag", async () => {
  vi.mocked(createCleaningJob).mockResolvedValue(queuedJob);
  vi.mocked(getCleaningJob).mockResolvedValue(succeededJob);
  vi.mocked(getCleaningResult).mockResolvedValue({ ...cleaningResult, awaitingReview: true });
  const { result } = renderHook(() => useCleaning({ pages: ["blob:one"], currentPage: 0 }));
  let pending!: Promise<PageCleaningResult | undefined>;
  act(() => { pending = result.current.cleanCurrentPage(new Blob(["png"], { type: "image/png" })); });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
    await pending;
  });
  expect(saveCleaningResultMetadata).toHaveBeenCalledWith(expect.objectContaining({ awaitingReview: true }));
});

test("restore metadata without image dimensions falls back to guarded hydration", async () => {
  const pageUrl = "blob:one";
  vi.mocked(loadCleaningResultsMetadata).mockResolvedValue(
    new Map([
      [
        pageUrl,
        {
          pageUrl,
          sourceHash: "a".repeat(64),
          sourceFingerprint: "5:image/png",
          maskFingerprint: "4:image/png",
          pipelineVersion: "2.3.1-enclosed-backing",
          jobId: "job-offline-1",
          regions: [{ ...staleMaskRegion, textConfirmed: true, maskApproved: true, approvalRevision: null }],
          updatedAt: Date.now(),
          cleanAssetId: "clean_blob%3Aone",
          maskAssetId: "mask_blob%3Aone",
        },
      ],
    ]),
  );

  vi.mocked(loadCleaningResultAssets).mockResolvedValue({
    cleanBlob: new Blob(["clean"], { type: "image/png" }),
    maskBlob: new Blob(["mask"], { type: "image/png" }),
    reviewMaskBlob: null,
    protectedMaskBlob: null,
  });

  vi.mocked(getCleaningResult).mockRejectedValue(
    new CleaningClientError(503, "Python cleaner backend is offline", "retry"),
  );

  const { result } = renderHook(() =>
    useCleaning({ pages: [pageUrl], currentPage: 0 }),
  );

  await act(async () => {
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
  });

  // Zero dimensions would make translationScope compute NaN boxes and cache
  // the page as clean-only; the guarded hydration path must run instead.
  expect(getCleaningResult).toHaveBeenCalled();
  expect(result.current.currentResult).toBeUndefined();
  expect(result.current.error?.recovery).toBe("reclean");
});

test("changed persisted mask asset invalidates offline approval reuse", async () => {
  vi.mocked(loadCleaningResultsMetadata).mockResolvedValue(new Map([["blob:one", {
    pageUrl: "blob:one",
    sourceHash: "a".repeat(64),
    sourceFingerprint: "5:image/png",
    maskFingerprint: "old-mask:image/png",
    pipelineVersion: "2.3.1-enclosed-backing",
    jobId: "job-offline-1",
    regions: [{ ...staleMaskRegion, textConfirmed: true, maskApproved: true, approvalRevision: "approved-revision" }],
    updatedAt: Date.now(),
  }]]));
  vi.mocked(loadCleaningResultAssets).mockResolvedValue({
    cleanBlob: new Blob(["clean"], { type: "image/png" }),
    maskBlob: new Blob(["changed"], { type: "image/png" }),
    reviewMaskBlob: null,
    protectedMaskBlob: null,
  });
  vi.mocked(getCleaningResult).mockRejectedValue(new CleaningClientError(404, "missing", "retry"));
  const { result } = renderHook(() => useCleaning({ pages: ["blob:one"], currentPage: 0 }));
  await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); });
  expect(result.current.currentResult).toBeUndefined();
  expect(result.current.error?.recovery).toBe("reclean");
});

test("clears progress when polling job fails", async () => {
  vi.mocked(createCleaningJob).mockResolvedValue(queuedJob);
  vi.mocked(getCleaningJob)
    .mockResolvedValueOnce(runningJob)
    .mockResolvedValueOnce({
      jobId: "job-1",
      status: "failed",
      stage: "cleaning",
      progress: {
        stage: "cleaning",
        completedRegions: 0,
        totalRegions: 0,
        elapsedMs: 0,
      },
      error: "cleaning failed",
    });
  const { result } = renderHook(() =>
    useCleaning({ pages: ["blob:one"], currentPage: 0 }),
  );
  let cleaning!: Promise<PageCleaningResult | undefined>;
  act(() => {
    cleaning = result.current.cleanCurrentPage(
      new Blob(["png"], { type: "image/png" }),
    );
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
    await cleaning;
  });
  expect(result.current.progress).toBeUndefined();
  expect(result.current.error?.recovery).toBe("retry");
});
