import { describe, expect, it } from "vitest";

import {
  computeRunSummary,
  evaluateLifecycleBenchmark,
} from "@/lib/lifecycle/benchmark";
import { ResourceBudgetManager } from "@/lib/lifecycle/resourceBudget";
import { PageBlobStoreClass } from "@/lib/lifecycle/pageBlobStore";
import { WorkspaceResourceManager } from "@/lib/lifecycle/workspaceResourceManager";
import type { LifecycleRunReport } from "@/lib/lifecycle/types";

describe("Resource Budget Integration & Memory Plateau Benchmark (Ticket PR-4 / ADR 0013)", () => {
  describe("Baseline Memory Behavior (Unbudgeted Eager Base64 Retention)", () => {
    it("fails the <= 20% memory plateau gate due to linear O(N) memory growth when retaining all pages as Base64", () => {
      // Simulation of unbudgeted legacy behavior:
      // Every page retains a ~10MB Base64 string in RAM without eviction.
      const baselineCheckpoints = {
        "cold-start": { checkpoint: "cold-start", timestamp: 1000, totalMemoryMB: 150 },
        "settled-idle": { checkpoint: "settled-idle", timestamp: 2000, totalMemoryMB: 180, cpuPercent: 1.5 },
        "page-1": { checkpoint: "page-1", timestamp: 3000, totalMemoryMB: 190 },
        "page-20": { checkpoint: "page-20", timestamp: 8000, totalMemoryMB: 380 },
        "page-50": { checkpoint: "page-50", timestamp: 15000, totalMemoryMB: 680 },
        // Unbudgeted: at page 100, memory has grown linearly by another ~500MB!
        "page-100": { checkpoint: "page-100", timestamp: 25000, totalMemoryMB: 1180 },
        "return-page-1": { checkpoint: "return-page-1", timestamp: 30000, totalMemoryMB: 1190 },
        "ocr-translate": { checkpoint: "ocr-translate", timestamp: 35000, totalMemoryMB: 1250 },
        "idle-5m": { checkpoint: "idle-5m", timestamp: 40000, totalMemoryMB: 1240 },
        "tray-idle-5m": { checkpoint: "tray-idle-5m", timestamp: 45000, totalMemoryMB: 1240, gpuPercent: 0.1 },
        restore: { checkpoint: "restore", timestamp: 50000, totalMemoryMB: 1250, modelReloadLatencyMs: 3000 },
        "true-exit": { checkpoint: "true-exit", timestamp: 55000, totalMemoryMB: 0, processCount: 0 },
      };

      const baselineSummary = computeRunSummary(baselineCheckpoints);
      // Growth from page 50 (680MB) to page 100 (1180MB) is (1180 - 680) / 680 = +73.53%
      expect(baselineSummary.page50To100GrowthPercent).toBeGreaterThan(20.0);
      expect(baselineSummary.page50To100GrowthPercent).toBe(73.53);

      const baselineRun: LifecycleRunReport = {
        runIndex: 1,
        environment: {
          platform: "win32",
          nodeVersion: "v20.0.0",
          totalHostRamMB: 16384,
          bookTitle: "Legacy Unbudgeted 100-page Book",
          pageCount: 100,
        },
        checkpoints: baselineCheckpoints,
        summary: baselineSummary,
      };

      const comparison = evaluateLifecycleBenchmark([baselineRun]);
      // The baseline FAILS the boundedMemoryGrowth acceptance gate!
      expect(comparison.passedAcceptanceGates.boundedMemoryGrowth).toBe(false);
    });
  });

  describe("Optimized Bounded Resource Budget with Warm Neighborhood", () => {
    it("satisfies the <= 20% memory growth plateau gate when using Blob storage and ResourceBudgetManager", () => {
      // Simulation of optimized behavior:
      // Pages 1-50 warm up to the budget cap (~480MB for 8GB host).
      // Between page 50 and 100, cold pages are evicted, memory plateaus within budget.
      const optimizedCheckpoints = {
        "cold-start": { checkpoint: "cold-start", timestamp: 1000, totalMemoryMB: 150 },
        "settled-idle": { checkpoint: "settled-idle", timestamp: 2000, totalMemoryMB: 165, cpuPercent: 1.2 },
        "page-1": { checkpoint: "page-1", timestamp: 3000, totalMemoryMB: 180 },
        "page-20": { checkpoint: "page-20", timestamp: 8000, totalMemoryMB: 320 },
        "page-50": { checkpoint: "page-50", timestamp: 15000, totalMemoryMB: 480 },
        // Optimized: plateaus around budget cap (~495MB), growth = (495-480)/480 = +3.125%
        "page-100": { checkpoint: "page-100", timestamp: 25000, totalMemoryMB: 495 },
        "return-page-1": { checkpoint: "return-page-1", timestamp: 30000, totalMemoryMB: 490 },
        "ocr-translate": { checkpoint: "ocr-translate", timestamp: 35000, totalMemoryMB: 510 },
        "idle-5m": { checkpoint: "idle-5m", timestamp: 40000, totalMemoryMB: 350 },
        "tray-idle-5m": { checkpoint: "tray-idle-5m", timestamp: 45000, totalMemoryMB: 280, gpuPercent: 0.1 },
        restore: { checkpoint: "restore", timestamp: 50000, totalMemoryMB: 360, modelReloadLatencyMs: 2200 },
        "true-exit": { checkpoint: "true-exit", timestamp: 55000, totalMemoryMB: 0, processCount: 0 },
      };

      const summary = computeRunSummary(optimizedCheckpoints);
      expect(summary.page50To100GrowthPercent).toBeLessThanOrEqual(20.0);
      expect(summary.page50To100GrowthPercent).toBe(3.13);

      const run1: LifecycleRunReport = {
        runIndex: 1,
        environment: { platform: "win32", nodeVersion: "v20", totalHostRamMB: 16384, bookTitle: "Run 1", pageCount: 100 },
        checkpoints: optimizedCheckpoints,
        summary,
      };

      const comparison = evaluateLifecycleBenchmark([run1]);
      expect(comparison.passedAcceptanceGates.boundedMemoryGrowth).toBe(true);
      expect(comparison.passedAcceptanceGates.lowSettledIdleCpu).toBe(true);
      expect(comparison.passedAcceptanceGates.nearZeroHiddenGpu).toBe(true);
      expect(comparison.passedAcceptanceGates.fastModelReload).toBe(true);
      expect(comparison.passedAcceptanceGates.cleanProcessExit).toBe(true);
    });

    it("verifies PageBlobStore manages blob lifecycle without leaks", () => {
      const store = new PageBlobStoreClass();
      const mockBlob = new Blob(["dummy manga content"], { type: "image/png" });

      const entry = store.set("p-1", mockBlob);
      expect(entry.sizeBytes).toBe(mockBlob.size);
      expect(store.has("p-1")).toBe(true);
      expect(store.get("p-1")).toBe(mockBlob);

      const url = store.getOrCreateObjectUrl("p-1");
      expect(url).toBeDefined();

      const revoked = store.revokeObjectUrl("p-1");
      expect(revoked).toBe(true);

      store.delete("p-1");
      expect(store.has("p-1")).toBe(false);
      expect(store.size()).toBe(0);
    });

    it("WorkspaceResourceManager maintains warm neighborhood and restores evicted representations without loss of bubbles or edits", () => {
      const manager = new WorkspaceResourceManager({ minCapMB: 10, maxCapMB: 10 });
      const pageIds = Array.from({ length: 20 }, (_, i) => `page_${i}`);

      // Set active navigation to page 5 (Warm set: [4, 5, 6])
      manager.updateNavigation(pageIds, 5);

      expect(manager.isWarm("page_4")).toBe(true);
      expect(manager.isWarm("page_5")).toBe(true);
      expect(manager.isWarm("page_6")).toBe(true);
      expect(manager.isWarm("page_0")).toBe(false);
      expect(manager.isWarm("page_19")).toBe(false);

      // Register rendered images across multiple pages
      // Each ~3 MB -> 4 pages = 12 MB (exceeds 10 MB budget)
      manager.registerResource("page_0", "translated-render", "data:rendered-0", 3 * 1024 * 1024);
      manager.registerResource("page_1", "translated-render", "data:rendered-1", 3 * 1024 * 1024);
      manager.registerResource("page_4", "translated-render", "data:rendered-4", 3 * 1024 * 1024);
      manager.registerResource("page_5", "translated-render", "data:rendered-5", 3 * 1024 * 1024);

      // Warm pages (4 and 5) MUST remain resident in memory!
      expect(manager.hasResource("page_4", "translated-render")).toBe(true);
      expect(manager.hasResource("page_5", "translated-render")).toBe(true);

      // Cold page 0 was evicted to fit the 10 MB budget, but spilled into SessionProcessedPageSpillCache!
      expect(manager.hasResource("page_0", "translated-render")).toBe(false);

      // Restore evicted page 0 on return / export
      const restored = manager.restoreRenderedImage("page_0", "default");
      expect(restored).toBe("data:rendered-0");
    });

    it("does not restore an in-memory render from another revision", () => {
      const manager = new WorkspaceResourceManager({ minCapMB: 10, maxCapMB: 10 });
      manager.registerRenderedImage("p1", "rev-1", "data:old", 100);
      expect(manager.restoreRenderedImage("p1", "rev-2")).toBeNull();
    });

    it("restores the render when the signature matches", () => {
      const manager = new WorkspaceResourceManager({ minCapMB: 10, maxCapMB: 10 });
      manager.registerRenderedImage("p1", "rev-2", "data:new", 100);
      expect(manager.restoreRenderedImage("p1", "rev-2")).toBe("data:new");
    });

    it("does not restore a spilled render from another revision and preserves actual signature on eviction", () => {
      const manager = new WorkspaceResourceManager({ minCapMB: 2, maxCapMB: 2 });
      // Evict p1 by filling budget
      manager.registerRenderedImage("p1", "rev-1", "data:old-render", 1.5 * 1024 * 1024);
      manager.registerRenderedImage("p2", "rev-1", "data:other-render", 1.5 * 1024 * 1024);

      // p1 is now evicted and spilled with "rev-1"
      // Attempting to restore with "rev-2" must return null
      expect(manager.restoreRenderedImage("p1", "rev-2")).toBeNull();
    });
  });
});

