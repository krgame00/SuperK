import type {
  LifecycleBenchmarkComparison,
  LifecycleCheckpointMetric,
  LifecycleRunReport,
} from "./types";

export const LIFECYCLE_CHECKPOINTS = [
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
] as const;

export type LifecycleCheckpointName = (typeof LIFECYCLE_CHECKPOINTS)[number];

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeRunSummary(
  checkpoints: Record<string, LifecycleCheckpointMetric>,
): LifecycleRunReport["summary"] {
  const p50 = checkpoints["page-50"]?.totalMemoryMB ?? 1;
  const p100 = checkpoints["page-100"]?.totalMemoryMB ?? p50;
  const growth = p50 > 0 ? ((p100 - p50) / p50) * 100 : 0;

  const idleCpu = checkpoints["settled-idle"]?.cpuPercent ?? 0;
  const trayGpu = checkpoints["tray-idle-5m"]?.gpuPercent ?? 0;
  const reloadLatency =
    checkpoints["restore"]?.modelReloadLatencyMs ??
    checkpoints["ocr-translate"]?.modelReloadLatencyMs ??
    0;
  const orphans = checkpoints["true-exit"]?.processCount ?? 0;

  return {
    page50To100GrowthPercent: Number(growth.toFixed(2)),
    settledIdleCpuAveragePercent: Number(idleCpu.toFixed(2)),
    hiddenIdleGpuAveragePercent: Number(trayGpu.toFixed(2)),
    modelReloadLatencyMs: Math.round(reloadLatency),
    orphanProcessesAfterExit: orphans,
  };
}

export function evaluateLifecycleBenchmark(
  runs: LifecycleRunReport[],
): LifecycleBenchmarkComparison {
  if (runs.length === 0) {
    throw new Error("Benchmark requires at least one run report.");
  }

  const growths = runs.map((r) => r.summary.page50To100GrowthPercent);
  const cpus = runs.map((r) => r.summary.settledIdleCpuAveragePercent);
  const gpus = runs.map((r) => r.summary.hiddenIdleGpuAveragePercent);
  const reloads = runs.map((r) => r.summary.modelReloadLatencyMs);
  const orphans = runs.map((r) => r.summary.orphanProcessesAfterExit);

  const medianSummary = {
    page50To100GrowthPercent: Number(median(growths).toFixed(2)),
    settledIdleCpuAveragePercent: Number(median(cpus).toFixed(2)),
    hiddenIdleGpuAveragePercent: Number(median(gpus).toFixed(2)),
    modelReloadLatencyMs: Math.round(median(reloads)),
    orphanProcessesAfterExit: Math.round(median(orphans)),
  };

  const passedAcceptanceGates = {
    boundedMemoryGrowth: medianSummary.page50To100GrowthPercent <= 20.0,
    lowSettledIdleCpu: medianSummary.settledIdleCpuAveragePercent <= 2.0,
    nearZeroHiddenGpu: medianSummary.hiddenIdleGpuAveragePercent <= 1.0,
    fastModelReload: medianSummary.modelReloadLatencyMs <= 5000,
    cleanProcessExit: medianSummary.orphanProcessesAfterExit === 0,
  };

  return {
    runs,
    medianSummary,
    passedAcceptanceGates,
  };
}
