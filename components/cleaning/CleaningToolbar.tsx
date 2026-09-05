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
  className?: string;
}

const primaryLayers: Array<{
  value: Exclude<WorkspaceLayer, "mask">;
  label: string;
}> = [
  { value: "original", label: "Original" },
  { value: "clean", label: "Clean" },
  { value: "translated", label: "Translated" },
];

const tabBaseClass =
  "relative h-8 rounded-md px-3 text-xs font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-35 select-none";

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
  className,
}: CleaningToolbarProps) {
  const isRunning = Boolean(progress);
  return (
    <section
      aria-label="เครื่องมือคลีนข้อความ"
      className={
        className ??
        "flex w-full max-w-4xl flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-surface/90 px-3 py-1.5 shadow-md backdrop-blur-md transition-all"
      }
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onClean}
          disabled={!hasPage || isRunning}
          title="คลีนข้อความออกจากภาพ (Inpainting)"
          className="inline-flex h-8.5 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-content shadow-xs transition-all duration-150 hover:bg-primary-hover active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isRunning ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />
          ) : (
            <Eraser className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          <span>คลีนข้อความ</span>
        </button>
        {progress && (
          <p className="text-xs font-medium text-foreground flex items-center gap-1.5 bg-surface-hover/80 px-2.5 py-1 rounded-md" aria-live="polite">
            <span className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span>{stageLabel(progress.stage)} · {progress.completedRegions}/{progress.totalRegions} · {(progress.elapsedMs / 1000).toFixed(1)}s</span>
          </p>
        )}
        {error?.recovery === "start-local-service" && (
          <p className="max-w-[46ch] text-xs font-medium text-red-400 bg-red-500/10 border border-red-500/20 px-2.5 py-1 rounded-md" role="alert">
            เปิด <code>ocr-service\run.ps1</code> แล้วลองอีกครั้ง
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div
          className="inline-flex items-center gap-1 rounded-lg bg-background/90 p-1 border border-border/80"
          role="tablist"
          aria-label="เลือกเลเยอร์ภาพหลัก"
        >
          {primaryLayers.map((item) => {
            const isSelected = layer === item.value;
            const isDisabled =
              (item.value === "clean" && !hasResult) ||
              (item.value === "translated" && !hasTranslated);
            return (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => onLayerChange(item.value)}
                disabled={isDisabled}
                className={`${tabBaseClass} ${
                  isSelected
                    ? "bg-primary text-primary-content font-semibold shadow-xs"
                    : "text-muted hover:text-foreground hover:bg-surface-hover/80"
                }`}
              >
                {item.label}
              </button>
            );
          })}
          <button
            key="mask"
            type="button"
            role="tab"
            aria-selected={layer === "mask"}
            onClick={() => onLayerChange("mask")}
            disabled={!hasResult}
            className={`${tabBaseClass} ${
              layer === "mask"
                ? "bg-primary text-primary-content font-semibold shadow-xs"
                : "text-muted hover:text-foreground hover:bg-surface-hover/80"
            }`}
          >
            Mask
          </button>
        </div>

        <button
          type="button"
          onClick={onEditMask}
          disabled={!hasResult}
          aria-label="เปิดหน้าต่างแก้ไข Mask"
          className="inline-flex h-8.5 items-center gap-1.5 rounded-lg border border-border/80 bg-surface px-3 text-xs font-medium text-foreground transition-all duration-150 hover:bg-surface-hover hover:text-white active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-35"
        >
          <Brush className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
          <span>แก้ Mask</span>
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
