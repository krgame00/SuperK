export interface LifecycleCheckpointMetric {
  checkpoint: string;
  timestamp: number;
  totalMemoryMB: number;
  privateWorkingSetMB?: number;
  peakWorkingSetMB?: number;
  cpuPercent?: number;
  gpuPercent?: number;
  vramMB?: number;
  processCount?: number;
  handles?: number;
  threads?: number;
  oldPageReopenLatencyMs?: number;
  modelReloadLatencyMs?: number;
}

export interface LifecycleRunReport {
  runIndex: number;
  environment: {
    platform: string;
    nodeVersion: string;
    totalHostRamMB: number;
    bookTitle: string;
    pageCount: number;
  };
  checkpoints: Record<string, LifecycleCheckpointMetric>;
  summary: {
    page50To100GrowthPercent: number;
    settledIdleCpuAveragePercent: number;
    hiddenIdleGpuAveragePercent: number;
    modelReloadLatencyMs: number;
    orphanProcessesAfterExit: number;
  };
}

export interface LifecycleBenchmarkComparison {
  runs: LifecycleRunReport[];
  medianSummary: {
    page50To100GrowthPercent: number;
    settledIdleCpuAveragePercent: number;
    hiddenIdleGpuAveragePercent: number;
    modelReloadLatencyMs: number;
    orphanProcessesAfterExit: number;
  };
  passedAcceptanceGates: {
    boundedMemoryGrowth: boolean; // <= 20%
    lowSettledIdleCpu: boolean;   // <= 2%
    nearZeroHiddenGpu: boolean;   // <= 1%
    fastModelReload: boolean;     // <= 5000ms
    cleanProcessExit: boolean;    // === 0
  };
}
