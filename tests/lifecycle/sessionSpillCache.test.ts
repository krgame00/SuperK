import { describe, expect, test } from "vitest";
import { SessionProcessedPageSpillCache } from "@/lib/lifecycle/sessionSpillCache";

describe("Session Processed-Page Spill & Revision-Safe Restore (Ticket 04)", () => {
  test("spills evicted page data and restores successfully when revision signature matches", () => {
    const cache = new SessionProcessedPageSpillCache<{ cleanBlob: string }>();
    const pageUrl = "blob:page-1";
    const sig = "hash123:mask456:v2.3:rev1";

    cache.spill(pageUrl, sig, { cleanBlob: "clean-data-1" });

    const restored = cache.restore(pageUrl, sig);
    expect(restored).toEqual({ cleanBlob: "clean-data-1" });
  });

  test("rejects and purges stale session spill entry when revision signature changes", () => {
    const cache = new SessionProcessedPageSpillCache<{ cleanBlob: string }>();
    const pageUrl = "blob:page-1";
    const oldSig = "hash123:mask456:v2.3:rev1";
    const newSig = "hash123:maskUPDATED:v2.3:rev2"; // User edited mask

    cache.spill(pageUrl, oldSig, { cleanBlob: "old-clean-data" });

    // Try to restore with new signature
    const restored = cache.restore(pageUrl, newSig);
    expect(restored).toBeNull();

    // Cache should have purged the stale entry
    expect(cache.has(pageUrl)).toBe(false);
  });

  test("returns null safely on cache miss without throwing", () => {
    const cache = new SessionProcessedPageSpillCache();
    expect(cache.restore("blob:non-existent", "any-sig")).toBeNull();
  });

  test("clears all session spill data completely on session exit/clear", () => {
    const cache = new SessionProcessedPageSpillCache<string>();
    cache.spill("p1", "s1", "data1");
    cache.spill("p2", "s2", "data2");
    expect(cache.size()).toBe(2);

    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.has("p1")).toBe(false);
  });
});
