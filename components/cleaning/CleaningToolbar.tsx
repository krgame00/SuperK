import { ArrowDown, ArrowUp, Brush, ChevronDown, ChevronUp, Eraser } from "lucide-react";

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
  position?: "top" | "bottom";
  onTogglePosition?: () => void;
  onCollapse?: () => void;
  children?: React.ReactNode;
}

const primaryLayers: Array<{
  value: Exclude<WorkspaceLayer, "mask">;
  label: string;
  shortLabel: string;
}> = [
  { value: "original", label: "Original", shortLabel: "Orig" },
  { value: "clean", label: "Clean", shortLabel: "Clean" },
  { value: "translated", label: "Translated", shortLabel: "Trans" },
];

const tabBaseClass =
  "relative h-7.5 sm:h-8 rounded-md px-2 sm:px-2.5 text-xs font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-35 select-none shrink-0";

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
  position = "top",
  onTogglePosition,
  onCollapse,
  children,
}: CleaningToolbarProps) {
  const isRunning = Boolean(progress);
  return (
    <section
      aria-label="เครื่องมือคลีนข้อความ"
      className={
        className ??
        "flex flex-nowrap w-full max-w-5xl items-center justify-between gap-1.5 sm:gap-2 rounded-xl border border-border/70 bg-surface/90 px-2 sm:px-3 py-1.5 shadow-md backdrop-blur-md transition-all overflow-x-auto no-scrollbar"
      }
    >
      <div className="flex flex-nowrap min-w-0 items-center gap-1.5 sm:gap-2 shrink-0">
        <button
          type="button"
          onClick={onClean}
          disabled={!hasPage || isRunning}
          title="คลีนข้อความออกจากภาพ (Inpainting)"
          aria-label="คลีนข้อความ"
          className="inline-flex h-7.5 sm:h-8 items-center gap-1 sm:gap-1.5 rounded-lg bg-primary px-2.5 sm:px-3 text-xs font-semibold text-primary-content shadow-xs transition-all duration-150 hover:bg-primary-hover active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-40 shrink-0 whitespace-nowrap"
        >
          {isRunning ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />
          ) : (
            <Eraser className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          <span className="hidden sm:inline">คลีนข้อความ</span>
          <span className="sm:hidden">คลีน</span>
        </button>
        {progress && (
          <p className="text-xs font-medium text-foreground flex items-center gap-1.5 bg-surface-hover/80 px-2 py-0.5 rounded-md shrink-0" aria-live="polite">
            <span className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span>{stageLabel(progress.stage)} · {progress.completedRegions}/{progress.totalRegions} · {(progress.elapsedMs / 1000).toFixed(1)}s</span>
          </p>
        )}
        {error?.recovery === "start-local-service" && (
          <p className="max-w-[46ch] text-xs font-medium text-red-400 bg-red-500/10 border border-red-500/20 px-2.5 py-1 rounded-md" role="alert">
            เปิด <code>ocr-service\run.ps1</code> แล้วลองอีกครั้ง
          </p>
        )}
        {error && error.recovery !== "start-local-service" && (
          <p className="max-w-[46ch] text-xs font-medium text-red-400 bg-red-500/10 border border-red-500/20 px-2.5 py-1 rounded-md" role="alert">
            {error.message || "การคลีนภาพล้มเหลว กรุณาลองใหม่อีกครั้ง"}
          </p>
        )}
        {children && (
          <div className="flex flex-nowrap items-center gap-1.5 sm:gap-2 border-l border-border/80 pl-1.5 sm:pl-2 shrink-0">
            {children}
          </div>
        )}
      </div>

      <div className="flex flex-nowrap items-center gap-1.5 sm:gap-2 shrink-0">
        <div
          className="inline-flex items-center gap-0.5 sm:gap-1 rounded-lg bg-background/90 p-0.5 sm:p-1 border border-border/80 shrink-0"
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
                aria-label={item.label}
                aria-selected={isSelected}
                onClick={() => onLayerChange(item.value)}
                disabled={isDisabled}
                className={`${tabBaseClass} ${
                  isSelected
                    ? "bg-primary text-primary-content font-semibold shadow-xs"
                    : "text-muted hover:text-foreground hover:bg-surface-hover/80"
                }`}
              >
                <span className="hidden sm:inline">{item.label}</span>
                <span className="sm:hidden">{item.shortLabel}</span>
              </button>
            );
          })}
          <button
            key="mask"
            type="button"
            role="tab"
            aria-label="Mask"
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
          className="inline-flex h-7.5 sm:h-8 items-center gap-1 sm:gap-1.5 rounded-lg border border-border/80 bg-surface px-2 sm:px-3 text-xs font-medium text-foreground transition-all duration-150 hover:bg-surface-hover hover:text-white active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-35 shrink-0"
        >
          <Brush className="h-3.5 w-3.5 text-muted shrink-0" aria-hidden="true" />
          <span className="hidden md:inline">แก้ Mask</span>
          <span className="md:hidden">Mask</span>
        </button>

        {(onTogglePosition || onCollapse) && (
          <div className="flex items-center gap-0.5 sm:gap-1 border-l border-border/80 pl-1 sm:pl-1.5 shrink-0">
            {onTogglePosition && (
              <button
                type="button"
                onClick={onTogglePosition}
                title={position === "top" ? "ย้ายแถบไปด้านล่าง" : "ย้ายแถบไปด้านบน"}
                aria-label={position === "top" ? "ย้ายแถบไปด้านล่าง" : "ย้ายแถบไปด้านบน"}
                className="inline-flex h-7.5 w-7.5 sm:h-8 sm:w-8 items-center justify-center rounded-lg border border-border/80 bg-surface text-muted transition-all duration-150 hover:bg-surface-hover hover:text-foreground active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background cursor-pointer shrink-0"
              >
                {position === "top" ? (
                  <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </button>
            )}

            {onCollapse && (
              <button
                type="button"
                onClick={onCollapse}
                title="ย่อแถบเครื่องมือ (กด B)"
                aria-label="ย่อแถบเครื่องมือ"
                className="inline-flex h-7.5 w-7.5 sm:h-8 sm:w-8 items-center justify-center rounded-lg border border-border/80 bg-surface text-muted transition-all duration-150 hover:bg-surface-hover hover:text-foreground active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background cursor-pointer shrink-0"
              >
                {position === "top" ? (
                  <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export function stageLabel(stage: CleaningProgress["stage"]): string {
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
