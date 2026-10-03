import { beforeEach, expect, test, vi } from "vitest";

import {
  CleaningClientError,
  createCleaningJob,
  getCleaningResult,
  retryCleaningRegion,
} from "@/lib/cleaning/client";

beforeEach(() => vi.restoreAllMocks());

test("cleaning abort signals reach the upload request and keep cancellation distinct from service failure", async () => {
  const controller=new AbortController();
  const request=vi.spyOn(globalThis,"fetch").mockImplementation(async (_input,init)=>{
    expect(init?.signal).toBe(controller.signal);
    controller.abort();
    throw new DOMException("Cancelled","AbortError");
  });
  await expect(createCleaningJob(new Blob(["png"],{type:"image/png"}),controller.signal)).rejects.toMatchObject({name:"AbortError"});
  expect(request).toHaveBeenCalledOnce();
  request.mockRestore();
});

test("createCleaningJob posts multipart to local proxy", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json(
      { job_id: "job-1", status: "queued", stage: "queued" },
      { status: 202 },
    ),
  );
  const result = await createCleaningJob(
    new Blob(["png"], { type: "image/png" }),
  );
  expect(result.jobId).toBe("job-1");
  expect(fetchMock.mock.calls[0][0]).toBe("/api/clean/v1/jobs");
  expect(fetchMock.mock.calls[0][1]?.body).toBeInstanceOf(FormData);
  expect(fetchMock.mock.calls[0][1]?.cache).toBe("no-store");
  expect((fetchMock.mock.calls[0][1]?.body as FormData).get("cleaning_mode")).toBe("all-text");
});

test("aborting while reading a cleaning response is still cancellation", async () => {
  const controller=new AbortController();
  const request=vi.spyOn(globalThis,"fetch").mockResolvedValue({ok:true,json:async()=>{
    controller.abort(); throw new DOMException("Cancelled","AbortError");
  }} as unknown as Response);
  await expect(createCleaningJob(new Blob(["png"],{type:"image/png"}),controller.signal)).rejects.toMatchObject({name:"AbortError"});
  request.mockRestore();
});

test("getCleaningResult decodes snake case and proxies asset paths", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      job_id: "job-1",
      source_hash: "a".repeat(64),
      width: 1200,
      height: 1800,
      clean_asset: "/v1/jobs/job-1/assets/clean.png",
      mask_asset: "/v1/jobs/job-1/assets/mask.png",
      review_mask_asset: "/v1/jobs/job-1/assets/review-mask.png",
      protected_mask_asset: "/v1/jobs/job-1/assets/protected-mask.png",
      regions: [
        {
          id: "region-1",
          rect: { x: 1, y: 2, width: 3, height: 4 },
          route: "flat",
          confidence: 0.9,
          status: "repaired",
          residual_score: 0.1,
          damage_score: 0.01,
          page_role: "comic",
          text_role: "narration",
          eligibility_confidence: 0.84,
          automatic_action: "clean",
          mask_approved: true,
          protection_reasons: [],
        },
      ],
      timings_ms: { total: 1234, adaptive_route: "roi", roi_cluster_count: 1 },
      pipeline_version: "2.2.0-adaptive-roi",
      awaiting_review: false,
      cleaning_mode: "all-text",
    }),
  );
  const result = await getCleaningResult("job-1");
  expect(result.sourceHash).toBe("a".repeat(64));
  expect(result.cleanAsset).toBe(
    "/api/clean/v1/jobs/job-1/assets/clean.png",
  );
  expect(result.reviewMaskAsset).toBe(
    "/api/clean/v1/jobs/job-1/assets/review-mask.png",
  );
  expect(result.protectedMaskAsset).toBe(
    "/api/clean/v1/jobs/job-1/assets/protected-mask.png",
  );
  expect(result.regions[0].residualScore).toBe(0.1);
  expect(result.regions[0].maskApproved).toBe(false);
  expect(result.regions[0]).toEqual(
    expect.objectContaining({
      pageRole: "comic",
      textRole: "narration",
      eligibilityConfidence: 0.84,
      automaticAction: "clean",
      protectionReasons: [],
    }),
  );
  expect(result.timingsMs.total).toBe(1234);
  expect(result.timingsMs.adaptive_route).toBe("roi");
  expect(result.pipelineVersion).toBe("2.2.0-adaptive-roi");
  expect(result).toMatchObject({ cleaningMode: "all-text" });
  expect(result.awaitingReview).toBe(false);
});

test("retryCleaningRegion sends selected cleaner and mask", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json(
      { job_id: "job-2", status: "queued", stage: "queued" },
      { status: 202 },
    ),
  );
  await retryCleaningRegion(
    "job-1",
    "region-1",
    new Blob(["mask"], { type: "image/png" }),
    "opencv",
    "protect",
  );
  const request = fetchMock.mock.calls[0];
  expect(request[0]).toBe(
    "/api/clean/v1/jobs/job-1/regions/region-1/retry",
  );
  expect((request[1]?.body as FormData).get("cleaner")).toBe("opencv");
  expect((request[1]?.body as FormData).get("action")).toBe("protect");
});

test("client exposes safe recovery guidance for failed requests", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({ detail: "Image is too large." }, { status: 413 }),
  );
  await expect(
    createCleaningJob(new Blob(["png"], { type: "image/png" })),
  ).rejects.toEqual(
    expect.objectContaining<Partial<CleaningClientError>>({
      status: 413,
      message: "Image is too large.",
      recovery: expect.stringContaining("80 MB"),
    }),
  );
});
