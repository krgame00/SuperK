import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it, test } from "vitest";

import {
  clearAssets,
  clearProjectSession,
  dataUrlToBlob,
  deleteAsset,
  loadAsset,
  loadCleaningResultsMetadata,
  loadProjectSession,
  saveAsset,
  saveCleaningResultMetadata,
  saveProjectSession,
} from "@/lib/projectStore";

beforeEach(async () => {
  await clearProjectSession();
});

test("persists cleaning metadata without object URLs", async () => {
  await saveCleaningResultMetadata({
    pageUrl: "blob:page-1",
    sourceHash: "a".repeat(64),
    jobId: "job-1",
    regions: [],
    updatedAt: 123,
  });
  const saved = await loadCleaningResultsMetadata();
  expect(saved.get("blob:page-1")).toEqual({
    pageUrl: "blob:page-1",
    sourceHash: "a".repeat(64),
    jobId: "job-1",
    regions: [],
    updatedAt: 123,
  });
  expect(JSON.stringify(saved.get("blob:page-1"))).not.toContain("blob:clean");
});

test("clear session also clears cleaning metadata", async () => {
  await saveCleaningResultMetadata({
    pageUrl: "blob:page-1",
    sourceHash: "a".repeat(64),
    jobId: "job-1",
    regions: [],
    updatedAt: 123,
  });
  await clearProjectSession();
  expect((await loadCleaningResultsMetadata()).size).toBe(0);
});

describe("Phase 5: Blob asset store and session persistence", () => {
  it("saves and loads binary Blobs directly in assets store", async () => {
    const blob = new Blob(["test-image-content"], { type: "image/png" });
    await saveAsset("asset-1", blob);

    const loaded = await loadAsset("asset-1");
    expect(loaded).toBeDefined();
    expect(loaded?.type).toBe("image/png");

    await deleteAsset("asset-1");
    expect(await loadAsset("asset-1")).toBeNull();
  });

  it("saves project session using Blob assets and restores them", async () => {
    const sampleDataUrl = "data:image/png;base64,dGVzdA==";
    const translatedCache = new Map<string, string>([
      ["http://example.com/page-1.png", sampleDataUrl],
    ]);
    const bubbleCache = new Map();

    await saveProjectSession({
      pages: [{ url: "http://example.com/page-1.png", name: "Page 1" }],
      currentPage: 0,
      bubbleCache,
      translatedImageCache: translatedCache,
    });

    const session = await loadProjectSession();
    expect(session).toBeDefined();
    expect(session?.pages.length).toBe(1);
    expect(session?.translatedImageCache.has("http://example.com/page-1.png")).toBe(
      true,
    );
  });

  it("dataUrlToBlob converts base64 Data URLs to typed Blobs", () => {
    const sampleDataUrl = "data:image/png;base64,dGVzdA==";
    const blob = dataUrlToBlob(sampleDataUrl);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("image/png");
  });
});
