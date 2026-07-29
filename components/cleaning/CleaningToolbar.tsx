import { Brush, Eraser } from "lucide-react";

import type { CleaningHookError } from "@/hooks/useCleaning";
import type { CleaningProgress } from "@/lib/cleaning/types";

export type WorkspaceLayer = "original" | "clean" | "translated" | "mask";

interface CleaningToolbarProps {
  hasPage: boolean;
  hasResult: boolean;
  hasTranslated: boolean;
  layer: WorkspaceLayer;
  onClean: () => void;
  onEditMask: () => void;
  onLayerChange: (layer: WorkspaceLayer) => void;
  progress?: CleaningProgress;
  error?: CleaningHookError;
}

const primaryLayers: Array<{
  value: Exclude<WorkspaceLayer, "mask">;
  label: string;
}> = [
  { value: "original", label: "Original" },
  { value: "clean", label: "Clean" },
  { value: "translated", label: "Translated" },
];

const layerButtonClass =
  "h-7 rounded px-2.5 text-xs font-medium text-muted transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary aria-pressed:bg-surface-hover aria-pressed:text-foreground disabled:cursor-not-allowed disabled:opacity-30";

export function CleaningToolbar({
  hasPage,
  hasResult,
  hasTranslated,
  layer,
  onClean,
  onEditMask,
  onLayerChange,
  progress,
  error,
}: CleaningToolbarProps) {
  const isRunning = Boolean(progress);
  return (
    <section
      aria-label="เครื่องมือคลีนข้อความ"
      className="mb-3 flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 px-1"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onClean}
          disabled={!hasPage || isRunning}
          className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-primary-content transition-colors duration-150 hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isRunning ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />
          ) : (
            <Eraser className="h-4 w-4" aria-hidden="true" />
          )}
          คลีนข้อความ
        </button>
        {progress && (
          <p className="text-xs text-foreground" aria-live="polite">
            {stageLabel(progress.stage)} · {progress.completedRegions}/
            {progress.totalRegions} · {(progress.elapsedMs / 1000).toFixed(1)}s
          </p>
        )}
        {error?.recovery === "start-local-service" && (
          <p className="max-w-[46ch] text-xs text-red-300" role="alert">
            เปิด <code>ocr-service\run.ps1</code> แล้วลองอีกครั้ง
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div
          className="inline-flex rounded-md bg-surface p-1"
          role="group"
          aria-label="เลือกเลเยอร์ภาพหลัก"
        >
          {primaryLayers.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => onLayerChange(item.value)}
              disabled={
                (item.value === "clean" && !hasResult) ||
                (item.value === "translated" && !hasTranslated)
              }
              aria-pressed={layer === item.value}
              className={layerButtonClass}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onLayerChange("mask")}
          disabled={!hasResult}
          aria-pressed={layer === "mask"}
          className={layerButtonClass}
        >
          Mask
        </button>
        <button
          type="button"
          onClick={onEditMask}
          disabled={!hasResult}
          className="inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted transition-colors duration-150 hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-30"
        >
          <Brush className="h-4 w-4" aria-hidden="true" />
          แก้ Mask
        </button>
      </div>
    </section>
  );
}

function stageLabel(stage: CleaningProgress["stage"]): string {
  const labels = {
    queued: "รอคิว",
    detecting: "ตรวจข้อความ",
    refining: "เก็บขอบ Mask",
    cleaning: "ซ่อมพื้นภาพ",
    verifying: "ตรวจคราบ",
    encoding: "บันทึกภาพ",
    complete: "เสร็จแล้ว",
  };
  return labels[stage];
}
