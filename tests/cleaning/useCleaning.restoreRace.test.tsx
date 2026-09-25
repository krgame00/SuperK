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
  deleteAsset: vi.fn().mockResolvedValue(undefined),
  loadCleaningResultAssets: vi.fn().mockResolvedValue({
    cleanBlob: null,
    maskBlob: null,
    reviewMaskBlob: null,
    protectedMaskBlob: null,
  }),
  saveCleaningAssets: vi.fn().mockResolvedValue({}),
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
  pipelineVersion: "2.3.1-enclosed-backing",
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
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
            sourceFingerprint: "5:image/png",
            maskFingerprint: "5:image/png",
            pipelineVersion: "2.3.1-enclosed-backing",
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
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
  });

  expect(loadCleaningResultsMetadata).toHaveBeenCalledTimes(2);
  expect(result.current.resultsByPage.get("blob:one")?.jobId).toBe("job-1");
});
