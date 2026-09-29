import { describe, expect, test } from "vitest";
import { ResourceBudgetManager } from "@/lib/lifecycle/resourceBudget";

describe("Bounded Page Resource Residency (Ticket 03)", () => {
  test("initializes budget adapting to host RAM with caps", () => {
    // 8GB RAM at 6% = 491.52 MB -> 492 MB
    const manager8GB = new ResourceBudgetManager({ hostRamMB: 8192, targetRatio: 0.06 });
    expect(manager8GB.getBudgetMB()).toBe(492);

    // 2GB RAM at 6% = 122.88 MB -> clamped to minCap (128 MB)
    const manager2GB = new ResourceBudgetManager({ hostRamMB: 2048, targetRatio: 0.06, minCapMB: 128 });
    expect(manager2GB.getBudgetMB()).toBe(128);

    // 64GB RAM at 6% = 3932 MB -> clamped to maxCap (1024 MB)
    const manager64GB = new ResourceBudgetManager({ hostRamMB: 65536, targetRatio: 0.06, maxCapMB: 1024 });
    expect(manager64GB.getBudgetMB()).toBe(1024);
  });

  test("stores items and evicts cold entries when budget is exceeded", () => {
    // 10 MB budget for testing
    const manager = new ResourceBudgetManager<string>({ minCapMB: 10, maxCapMB: 10 });
    const oneMB = 1024 * 1024;

    // Add 8 MB (total 8 MB / 10 MB)
    const evicted1 = manager.set("page-1", "data1", 8 * oneMB);
    expect(evicted1).toEqual([]);
    expect(manager.getCurrentUsageMB()).toBe(8);

    // Add 4 MB (total 12 MB -> exceeds 10 MB budget, page-1 should be evicted)
    const evicted2 = manager.set("page-2", "data2", 4 * oneMB);
    expect(evicted2).toEqual(["page-1"]);
    expect(manager.has("page-1")).toBe(false);
    expect(manager.has("page-2")).toBe(true);
    expect(manager.getCurrentUsageMB()).toBe(4);
  });

  test("protects warm page set during eviction", () => {
    // 10 MB budget
    const manager = new ResourceBudgetManager<string>({ minCapMB: 10, maxCapMB: 10 });
    const oneMB = 1024 * 1024;
    const isWarm = (key: string) => key === "page-0" || key === "page-1";

    manager.set("page-0", "data0", 3 * oneMB, "translated-render", isWarm); // warm
    manager.set("page-1", "data1", 3 * oneMB, "translated-render", isWarm); // warm
    manager.set("page-20", "data20", 3 * oneMB, "translated-render", isWarm); // cold
    const evicted = manager.set("page-50", "data50", 3 * oneMB, "translated-render", isWarm); // cold (total 12MB -> 2MB over)

    // Non-warm page-20 should be evicted first
    expect(evicted).toContain("page-20");
    expect(manager.has("page-0")).toBe(true);
    expect(manager.has("page-1")).toBe(true);
  });

  test("handles memory pressure by evicting non-warm pages aggressively", () => {
    const manager = new ResourceBudgetManager<string>({ minCapMB: 100, maxCapMB: 100 });
    const oneMB = 1024 * 1024;

    manager.set("page-curr", "currData", 20 * oneMB);
    manager.set("page-old1", "old1Data", 20 * oneMB);
    manager.set("page-old2", "old2Data", 20 * oneMB);

    const isWarm = (key: string) => key === "page-curr";
    const evicted = manager.handleMemoryPressure(isWarm);

    expect(evicted).toEqual(["page-old1", "page-old2"]);
    expect(manager.has("page-curr")).toBe(true);
    expect(manager.has("page-old1")).toBe(false);
    expect(manager.has("page-old2")).toBe(false);
  });

  test("never evicts warm entries even when the budget cannot be met", () => {
    const manager = new ResourceBudgetManager<string>({ minCapMB: 10, maxCapMB: 10 });
    const oneMB = 1024 * 1024;
    const isWarm = (key: string) => key === "page-0" || key === "page-1";

    manager.set("page-0", "data0", 6 * oneMB, "source", isWarm); // warm
    manager.set("page-1", "data1", 6 * oneMB, "source", isWarm); // warm — 12 MB > 10 MB budget

    // Warm floor: the visible pages survive even over budget instead of
    // having their live object URLs revoked mid-display.
    expect(manager.has("page-0")).toBe(true);
    expect(manager.has("page-1")).toBe(true);
    expect(manager.getCurrentUsageMB()).toBe(12);

    // A later cold arrival cannot displace the warm floor: the cold item is
    // the only evictable candidate and is refused instead.
    manager.set("page-9", "data9", 1 * oneMB, "source", isWarm);
    expect(manager.has("page-9")).toBe(false);
    expect(manager.has("page-0")).toBe(true);
    expect(manager.has("page-1")).toBe(true);
  });
});
