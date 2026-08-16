import "fake-indexeddb/auto";

import { beforeEach, expect, test } from "vitest";

import {
  clearProjectSession,
  loadCleaningResultsMetadata,
  saveCleaningResultMetadata,
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
