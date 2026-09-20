import { describe, expect, test } from "vitest";
import {
  computeRunSummary,
  evaluateLifecycleBenchmark,
  LIFECYCLE_CHECKPOINTS,
} from "@/lib/lifecycle/benchmark";
import type { LifecycleCheckpointMetric, LifecycleRunReport } from "@/lib/lifecycle/types";

describe("Resource Lifecycle Benchmark Harness (Ticket 01)", () => {
  test("defines all 12 agreed lifecycle checkpoints in exact order", () => {
    expect(LIFECYCLE_CHECKPOINTS).toEqual([
      "cold-start",
      "settled-idle",
      "page-1",
      "page-20",
      "page-50",
      "page-100",
      "return-page-1",
      "ocr-translate",
      "idle-5m",
      "tray-idle-5m",
      "restore",
      "true-exit",
    ]);
  });

  test("computes single-run summary correctly from checkpoints", () => {
    const checkpoints: Record<string, LifecycleCheckpointMetric> = {
      "cold-start": { checkpoint: "cold-start", timestamp: 1000, totalMemoryMB: 200 },
      "settled-idle": { checkpoint: "settled-idle", timestamp: 2000, totalMemoryMB: 220, cpuPercent: 1.2 },
      "page-50": { checkpoint: "page-50", timestamp: 10000, totalMemoryMB: 500 },
      "page-100": { checkpoint: "page-100", timestamp: 20000, totalMemoryMB: 560 }, // (560-500)/500 = +12%
      "tray-idle-5m": { checkpoint: "tray-idle-5m", timestamp: 40000, totalMemoryMB: 300, gpuPercent: 0.1 },
      restore: { checkpoint: "restore", timestamp: 45000, totalMemoryMB: 400, modelReloadLatencyMs: 2500 },
      "true-exit": { checkpoint: "true-exit", timestamp: 50000, totalMemoryMB: 0, processCount: 0 },
    };

    const summary = computeRunSummary(checkpoints);
    expect(summary.page50To100GrowthPercent).toBe(12.0);
    expect(summary.settledIdleCpuAveragePercent).toBe(1.2);
    expect(summary.hiddenIdleGpuAveragePercent).toBe(0.1);
    expect(summary.modelReloadLatencyMs).toBe(2500);
    expect(summary.orphanProcessesAfterExit).toBe(0);
  });

  test("evaluates 3 candidate runs using median and verifies acceptance gates", () => {
    const mockRun = (index: number, growth: number, cpu: number, gpu: number, latency: number, orphans: number): LifecycleRunReport => ({
      runIndex: index,
      environment: {
        platform: "win32",
        nodeVersion: "v20.0.0",
        totalHostRamMB: 32768,
        bookTitle: "Manga Volume 1",
        pageCount: 100,
      },
      checkpoints: {},
      summary: {
        page50To100GrowthPercent: growth,
        settledIdleCpuAveragePercent: cpu,
        hiddenIdleGpuAveragePercent: gpu,
        modelReloadLatencyMs: latency,
        orphanProcessesAfterExit: orphans,
      },
    });

    const runs: LifecycleRunReport[] = [
      mockRun(1, 14.5, 1.5, 0.2, 2800, 0),
      mockRun(2, 12.0, 1.1, 0.1, 2400, 0),
      mockRun(3, 16.0, 1.8, 0.3, 3100, 0),
    ];

    const evaluation = evaluateLifecycleBenchmark(runs);

    // Median of [12.0, 14.5, 16.0] = 14.5
    expect(evaluation.medianSummary.page50To100GrowthPercent).toBe(14.5);
    // Median of [1.1, 1.5, 1.8] = 1.5
    expect(evaluation.medianSummary.settledIdleCpuAveragePercent).toBe(1.5);
    // Median of [0.1, 0.2, 0.3] = 0.2
    expect(evaluation.medianSummary.hiddenIdleGpuAveragePercent).toBe(0.2);
    // Median of [2400, 2800, 3100] = 2800
    expect(evaluation.medianSummary.modelReloadLatencyMs).toBe(2800);
    expect(evaluation.medianSummary.orphanProcessesAfterExit).toBe(0);

    // All gates must pass
    expect(evaluation.passedAcceptanceGates).toEqual({
      boundedMemoryGrowth: true,
      lowSettledIdleCpu: true,
      nearZeroHiddenGpu: true,
      fastModelReload: true,
      cleanProcessExit: true,
    });
  });
});
