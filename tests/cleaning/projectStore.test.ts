import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it, test } from "vitest";

import {
  clearProjectSession,
  dataUrlToBlob,
  deleteAsset,
  loadAsset,
  loadCleaningResultsMetadata,
  loadProjectSession,
  purgeOrphanAssets,
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

  it("propagates error to caller when IndexedDB write fails", async () => {
    const originalIndexedDB = window.indexedDB;
    const mockDB = {
      ...originalIndexedDB,
      open: () => {
        const req = {} as IDBOpenDBRequest;
        setTimeout(() => {
          Object.defineProperty(req, "error", {
            value: new Error("Simulated IndexedDB quota exceeded"),
          });
          if (req.onerror) {
            req.onerror(new Event("error") as any);
          }
        }, 0);
        return req;
      },
    };
    Object.defineProperty(window, "indexedDB", {
      value: mockDB,
      configurable: true,
      writable: true,
    });

    try {
      await expect(
        saveProjectSession({
          pages: [{ url: "http://example.com/p1.png", name: "P1" }],
          currentPage: 0,
          bubbleCache: new Map(),
          translatedImageCache: new Map(),
        }),
      ).rejects.toThrow("Simulated IndexedDB quota exceeded");
    } finally {
      Object.defineProperty(window, "indexedDB", {
        value: originalIndexedDB,
        configurable: true,
        writable: true,
      });
    }
  });
});


test("dirty save rewrites dirty pages and garbage-collects orphaned assets", async () => {
  const pages = [
    { url: "blob:p1", name: "p1.png" },
    { url: "blob:p2", name: "p2.png" },
  ];
  await saveProjectSession({
    pages,
    currentPage: 0,
    bubbleCache: new Map([
      ["blob:p1", [{ t: "a" }]],
      ["blob:p2", [{ t: "b" }]],
    ]),
    translatedImageCache: new Map([
      ["blob:p1", "data:image/png;base64,AAAA"],
      ["blob:p2", "data:image/png;base64,BBBB"],
    ]),
  });

  // p2 was removed from the book; p1 changed. The dirty save must not
  // reference p2 anymore and its orphaned asset must be deleted.
  await saveProjectSession(
    {
      pages: [pages[0]],
      currentPage: 0,
      bubbleCache: new Map([["blob:p1", [{ t: "a" }]]]),
      translatedImageCache: new Map([["blob:p1", "data:image/png;base64,CCCC"]]),
    },
    { dirtyPageUrls: new Set(["blob:p1"]) },
  );

  // NOTE: fake-indexeddb cannot structured-clone jsdom Blobs (content comes
  // back garbled), so assertions here are on keys, not blob content.
  const restored = await loadProjectSession();
  expect(restored?.translatedImageCache.has("blob:p1")).toBe(true);
  expect(restored?.translatedImageCache.has("blob:p2")).toBe(false);
  expect(restored?.bubbleCache.has("blob:p2")).toBe(false);
  expect(await loadAsset("translated_blob%3Ap1")).not.toBeNull();
  expect(await loadAsset("translated_blob%3Ap2")).toBeNull();
});

test("dirty save skips unchanged pages (no asset rewrite)", async () => {
  const pages = [
    { url: "blob:p1", name: "p1.png" },
    { url: "blob:p2", name: "p2.png" },
  ];
  await saveProjectSession({
    pages,
    currentPage: 0,
    bubbleCache: new Map(),
    translatedImageCache: new Map([
      ["blob:p1", "data:image/png;base64,AAAA"],
      ["blob:p2", "data:image/png;base64,BBBB"],
    ]),
  });

  // Delete p2's stored asset, then dirty-save with only p1 dirty. If the
  // save correctly skips unchanged p2, its asset is NOT rewritten and stays
  // deleted; p1 must be rewritten.
  await deleteAsset("translated_blob%3Ap2");
  await saveProjectSession(
    {
      pages,
      currentPage: 0,
      bubbleCache: new Map(),
      translatedImageCache: new Map([
        ["blob:p1", "data:image/png;base64,CCCC"],
        ["blob:p2", "data:image/png;base64,BBBB"],
      ]),
    },
    { dirtyPageUrls: new Set(["blob:p1"]) },
  );

  expect(await loadAsset("translated_blob%3Ap2")).toBeNull();
  expect(await loadAsset("translated_blob%3Ap1")).not.toBeNull();
  const restored = await loadProjectSession();
  expect(restored?.translatedImageCache.has("blob:p1")).toBe(true);
});

test("purgeOrphanAssets removes only unused translated assets", async () => {
  // Establish the session first so its referenced assets exist...
  await saveProjectSession({
    pages: [{ url: "blob:keep", name: "keep.png" }],
    currentPage: 0,
    bubbleCache: new Map(),
    translatedImageCache: new Map([["blob:keep", "data:image/png;base64,AAAA"]]),
  });
  // ...then plant an orphan and an asset with a foreign prefix.
  await saveAsset("translated_orphan", new Blob(["orphan"]));
  await saveAsset("other_prefix_keep", new Blob(["keep"]));

  const removed = await purgeOrphanAssets();
  expect(removed).toBeGreaterThanOrEqual(1);
  expect(await loadAsset("translated_orphan")).toBeNull();
  expect(await loadAsset("other_prefix_keep")).not.toBeNull();
  expect(await loadAsset("translated_blob%3Akeep")).not.toBeNull();
});
