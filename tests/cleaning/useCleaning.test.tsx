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
  loadCleaningResultsMetadata: vi.fn(),
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
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    new Response(new Blob(["asset"], { type: "image/png" }), { status: 200 }),
  );
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
  let cleaning!: Promise<void>;
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
  vi.stubGlobal("createImageBitmap", undefined);
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
  let cleaning!: Promise<void>;
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
    await vi.runAllTimersAsync();
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
