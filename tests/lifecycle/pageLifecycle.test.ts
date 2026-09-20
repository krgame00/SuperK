import { describe, expect, test, vi } from "vitest";
import {
  getWarmPageIndices,
  isPageInWarmSet,
  reconcileWarmPageCache,
} from "@/lib/lifecycle/pageLifecycle";

describe("Lazy Source Pages & Warm Navigation Set (Ticket 02)", () => {
  test("computes warm page indices correctly for start, middle, and end of book", () => {
    // Page 0 of 100 -> Warm: [0, 1]
    expect(getWarmPageIndices(0, 100)).toEqual([0, 1]);

    // Page 19 (page 20 in 1-based) -> Warm: [18, 19, 20]
    expect(getWarmPageIndices(19, 100)).toEqual([18, 19, 20]);

    // Page 49 (page 50) -> Warm: [48, 49, 50]
    expect(getWarmPageIndices(49, 100)).toEqual([48, 49, 50]);

    // Page 99 (page 100) -> Warm: [98, 99]
    expect(getWarmPageIndices(99, 100)).toEqual([98, 99]);

    // Single-page book
    expect(getWarmPageIndices(0, 1)).toEqual([0]);

    // Empty book
    expect(getWarmPageIndices(0, 0)).toEqual([]);
  });

  test("correctly identifies whether a page is in the active warm set", () => {
    expect(isPageInWarmSet(0, 0, 100)).toBe(true);
    expect(isPageInWarmSet(1, 0, 100)).toBe(true);
    expect(isPageInWarmSet(2, 0, 100)).toBe(false);
    expect(isPageInWarmSet(50, 0, 100)).toBe(false);

    expect(isPageInWarmSet(48, 49, 100)).toBe(true);
    expect(isPageInWarmSet(49, 49, 100)).toBe(true);
    expect(isPageInWarmSet(50, 49, 100)).toBe(true);
    expect(isPageInWarmSet(0, 49, 100)).toBe(false);
  });

  test("reconciles warm cache by evicting cold entries while preserving warm pages", () => {
    const pageUrls = Array.from({ length: 100 }, (_, i) => `blob:page-${i}`);
    const cache = new Map<string, { bitmap: string }>();

    // Populate cache with pages 0, 1, 20, 50, 99
    cache.set("blob:page-0", { bitmap: "bmp-0" });
    cache.set("blob:page-1", { bitmap: "bmp-1" });
    cache.set("blob:page-20", { bitmap: "bmp-20" });
    cache.set("blob:page-50", { bitmap: "bmp-50" });

    // User is currently on page 0 (Warm set: [0, 1])
    const onEvict = vi.fn();
    const result = reconcileWarmPageCache(cache, pageUrls, 0, onEvict);

    expect(result.retained.has("blob:page-0")).toBe(true);
    expect(result.retained.has("blob:page-1")).toBe(true);
    expect(result.retained.has("blob:page-20")).toBe(false);
    expect(result.retained.has("blob:page-50")).toBe(false);

    expect(result.evictedUrls).toEqual(["blob:page-20", "blob:page-50"]);
    expect(onEvict).toHaveBeenCalledTimes(2);
  });

  test("navigating 1 -> 20 -> 50 -> 100 -> 1 maintains correct warm set at each step", () => {
    const totalPages = 100;
    const steps = [0, 19, 49, 99, 0];
    const expectedSets = [
      [0, 1],
      [18, 19, 20],
      [48, 49, 50],
      [98, 99],
      [0, 1],
    ];

    steps.forEach((curr, idx) => {
      expect(getWarmPageIndices(curr, totalPages)).toEqual(expectedSets[idx]);
    });
  });
});
