import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { useCleaning } from "@/hooks/useCleaning";
import {
  CleaningClientError,
  createCleaningJob,
  getCleaningJob,
  getCleaningResult,
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
  regions: [],
  timingsMs: { total: 10 },
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.mocked(createCleaningJob).mockReset();
  vi.mocked(getCleaningJob).mockReset();
  vi.mocked(getCleaningResult).mockReset();
  vi.mocked(loadCleaningResultsMetadata).mockResolvedValue(new Map());
  vi.mocked(saveCleaningResultMetadata).mockResolvedValue();
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    new Response(new Blob(["asset"], { type: "image/png" }), { status: 200 }),
  );
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi
      .fn()
      .mockReturnValueOnce("blob:clean")
      .mockReturnValueOnce("blob:mask"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  vi.useRealTimers();
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
});
