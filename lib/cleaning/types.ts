export type CleaningJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed";

export type CleaningJobStage =
  | "queued"
  | "detecting"
  | "refining"
  | "cleaning"
  | "verifying"
  | "encoding"
  | "complete";

export type CleanerOverride =
  | "auto"
  | "flat"
  | "opencv"
  | "aot"
  | "anime-lama";

export interface CleaningProgress {
  stage: CleaningJobStage;
  completedRegions: number;
  totalRegions: number;
  elapsedMs: number;
}

export interface CleaningJob {
  jobId: string;
  status: CleaningJobStatus;
  stage: CleaningJobStage;
  progress?: CleaningProgress;
  error?: string | null;
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CleaningRegion {
  id: string;
  rect: PixelRect;
  route: "flat" | "gradient" | "artwork";
  confidence: number;
  status: "ready" | "repaired" | "needs_review";
  residualScore: number;
  damageScore: number;
}

export interface CleaningResult {
  jobId: string;
  sourceHash: string;
  width: number;
  height: number;
  cleanAsset: string;
  maskAsset: string;
  regions: CleaningRegion[];
  timingsMs: Record<string, number>;
}
