import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { useCleaning } from "@/hooks/useCleaning";
import { getCleaningResult } from "@/lib/cleaning/client";
import { loadCleaningResultsMetadata } from "@/lib/projectStore";

vi.mock("@/lib/cleaning/client", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/cleaning/client")>();
  return {
    ...original,
    getCleaningResult: vi.fn(),
  };
});

vi.mock("@/lib/projectStore", () => ({
  loadCleaningResultsMetadata: vi.fn(),
  saveCleaningResultMetadata: vi.fn(),
}));

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
  vi.useRealTimers();
});

test("metadata restore restarts after the page count changes", async () => {
  let resolveFirst!: (
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
  vi.mocked(loadCleaningResultsMetadata)
    .mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    )
    .mockResolvedValueOnce(
      new Map([
        [
          "blob:one",
          {
            pageUrl: "blob:one",
            sourceHash: "a".repeat(64),
            jobId: "job-1",
            regions: [],
            updatedAt: 1,
          },
        ],
      ]),
    );
  vi.mocked(getCleaningResult).mockResolvedValue(cleaningResult);
  const { result, rerender } = renderHook(
    ({ pages }) => useCleaning({ pages, currentPage: 0 }),
    { initialProps: { pages: ["blob:one"] } },
  );

  rerender({ pages: ["blob:one", "blob:two"] });
  await act(async () => {
    resolveFirst(new Map());
    await vi.runAllTimersAsync();
  });

  expect(loadCleaningResultsMetadata).toHaveBeenCalledTimes(2);
  expect(result.current.resultsByPage.get("blob:one")?.jobId).toBe("job-1");
});
