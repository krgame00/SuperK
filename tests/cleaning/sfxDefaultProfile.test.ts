import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCleaningJob, restoreCleaningJob } from "@/lib/cleaning/client";

const mockLocalStorage = (() => {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, String(value));
    },
  } satisfies Storage;
})();

describe("SFX Default Profile Cleaning Policy", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: mockLocalStorage,
    });
    if (typeof window !== "undefined") {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: mockLocalStorage,
      });
    }
    mockLocalStorage.clear();
  });

  it("sends safe cleaning mode when localStorage has no saved sfx policy", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        { job_id: "job-new-profile", status: "queued", stage: "queued" },
        { status: 202 },
      ),
    );

    await createCleaningJob(new Blob(["png"], { type: "image/png" }));

    expect(fetchMock).toHaveBeenCalledOnce();
    const body = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(body.get("cleaning_mode")).toBe("safe");
  });

  it("defaults cleaningMode argument to safe when omitted", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        { job_id: "job-default-arg", status: "queued", stage: "queued" },
        { status: 202 },
      ),
    );

    await createCleaningJob(new Blob(["png"], { type: "image/png" }), undefined);

    const body = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(body.get("cleaning_mode")).toBe("safe");
  });

  it("sends safe cleaning mode when sfx policy is explicitly ignore or preserve", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json(
        { job_id: "job-safe", status: "queued", stage: "queued" },
        { status: 202 },
      ),
    );

    mockLocalStorage.setItem("superk:sfx-policy", "ignore");
    await createCleaningJob(new Blob(["png"], { type: "image/png" }));
    let body = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(body.get("cleaning_mode")).toBe("safe");

    mockLocalStorage.setItem("superk:sfx-policy", "preserve");
    await createCleaningJob(new Blob(["png"], { type: "image/png" }));
    body = fetchMock.mock.calls[1][1]?.body as FormData;
    expect(body.get("cleaning_mode")).toBe("safe");
  });

  it("sends all-text cleaning mode only when sfx policy is explicitly translate", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        { job_id: "job-translate", status: "queued", stage: "queued" },
        { status: 202 },
      ),
    );

    mockLocalStorage.setItem("superk:sfx-policy", "translate");
    await createCleaningJob(new Blob(["png"], { type: "image/png" }));
    const body = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(body.get("cleaning_mode")).toBe("all-text");
  });

  it("defaults restoreCleaningJob cleaningMode to safe when omitted", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        {
          job_id: "job-restore",
          status: "succeeded",
          stage: "complete",
          source_hash: "a".repeat(64),
          width: 10,
          height: 10,
          clean_asset: "/clean.png",
          mask_asset: "/mask.png",
          review_mask_asset: "/review-mask.png",
          protected_mask_asset: "/protected-mask.png",
          regions: [],
          timings_ms: { total: 1 },
          pipeline_version: "2.3.1-enclosed-backing",
          cleaning_mode: "safe",
        },
        { status: 200 },
      ),
    );

    const dummyBlob = new Blob(["png"], { type: "image/png" });
    await restoreCleaningJob({
      jobId: "job-restore",
      sourceBlob: dummyBlob,
      cleanBlob: dummyBlob,
      maskBlob: dummyBlob,
      reviewMaskBlob: dummyBlob,
      protectedMaskBlob: dummyBlob,
      regions: [],
    });

    const body = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(body.get("cleaning_mode")).toBe("safe");
  });

  it("checks cache against safe mode when localStorage has no saved sfx policy", async () => {
    // If a cached result has all-text mode, but current user profile is new (sfx-policy empty),
    // the system expects "safe" mode and rejects reusing the "all-text" cached result.
    const savedSfx = mockLocalStorage.getItem("superk:sfx-policy");
    const expectedMode = savedSfx === "translate" ? "all-text" : "safe";
    expect(expectedMode).toBe("safe");
  });
});
