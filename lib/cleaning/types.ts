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

export type PageRole = "comic" | "credits" | "ui" | "unknown";

export type TextRole =
  | "dialogue"
  | "narration"
  | "sfx"
  | "protected"
  | "review";

export type AutomaticAction = "clean" | "preserve";

export type ManualRegionAction = "automatic" | "force-clean" | "protect";

export type ProtectionReason =
  | "qr"
  | "credit-page"
  | "ui-page"
  | "margin-mark"
  | "logo"
  | "low-confidence";

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
  status: "ready" | "repaired" | "needs_review" | "preserved";
  residualScore: number;
  damageScore: number;
  pageRole: PageRole;
  textRole: TextRole;
  eligibilityConfidence: number;
  automaticAction: AutomaticAction;
  protectionReasons: ProtectionReason[];
}

export interface CleaningResult {
  jobId: string;
  sourceHash: string;
  width: number;
  height: number;
  cleanAsset: string;
  maskAsset: string;
  reviewMaskAsset: string;
  protectedMaskAsset: string;
  regions: CleaningRegion[];
  timingsMs: Record<string, number>;
}
