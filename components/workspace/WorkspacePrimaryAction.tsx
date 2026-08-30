"use client";

import type { ReactElement } from "react";
import { Sparkles, Wand2 } from "lucide-react";

export interface WorkspacePrimaryActionProps {
  isTranslating: boolean;
  isTranslatingAll: boolean;
  workflowPhase?: string | null;
  translateAllProgress?: {
    current: number;
    total: number;
    message: string;
    remainingSeconds?: number;
  } | null;
  onTranslateCurrent: () => void;
  onTranslateBook: () => void;
  onCancelTranslateAll: () => void;
  disabled?: boolean;
  compact?: boolean;
}

export function WorkspacePrimaryAction({
  isTranslating,
  isTranslatingAll,
  workflowPhase,
  translateAllProgress,
  onTranslateCurrent,
  onTranslateBook,
  onCancelTranslateAll,
  disabled = false,
  compact = false,
}: WorkspacePrimaryActionProps): ReactElement {
  if (isTranslatingAll) {
    return (
      <div
        className="flex items-center gap-2 bg-primary/10 border border-primary/30 rounded-lg px-2.5 py-1"
        role="status"
        aria-live="polite"
        aria-label="ความคืบหน้าการแปลทั้งเล่ม"
      >
        <div className="flex flex-col gap-0.5 min-w-[110px]">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-primary font-semibold flex items-center gap-1">
              <span
                className="animate-spin h-3 w-3 border-2 border-primary border-t-transparent rounded-full"
                aria-hidden="true"
              />
              {translateAllProgress?.message ?? "เตรียม..."}
            </span>
            {translateAllProgress && (
              <span className="text-foreground font-medium text-[10px]">
                {Math.round((translateAllProgress.current / translateAllProgress.total) * 100)}%
              </span>
            )}
          </div>
          <div className="w-full h-1 bg-surface rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
              style={{
                width: translateAllProgress
                  ? `${(translateAllProgress.current / translateAllProgress.total) * 100}%`
                  : "0%",
              }}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={onCancelTranslateAll}
          aria-label="หยุดการแปลทั้งเล่ม"
          className="bg-red-500/20 text-red-300 hover:bg-red-500/30 px-2 py-0.5 rounded text-[10px] font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 cursor-pointer"
        >
          หยุด
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onTranslateCurrent}
        disabled={disabled || isTranslating}
        aria-label="แปลมังงะหน้านี้"
        className="h-8.5 px-3.5 bg-primary text-primary-content hover:bg-primary-hover active:scale-95 disabled:opacity-50 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background cursor-pointer shrink-0"
      >
        {isTranslating ? (
          <span className="flex items-center gap-1.5">
            <span
              className="animate-spin h-3.5 w-3.5 border-2 border-primary-content border-t-transparent rounded-full"
              aria-hidden="true"
            />
            <span>{workflowPhase === "cleaning" ? "กำลังคลีน..." : "กำลังแปล..."}</span>
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <Wand2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>แปลหน้านี้</span>
          </span>
        )}
      </button>

      {!compact && (
        <button
          type="button"
          onClick={onTranslateBook}
          disabled={disabled || isTranslating}
          aria-label="แปลมังงะทั้งเล่มแบบอัตโนมัติ"
          className="h-8.5 px-3 bg-surface hover:bg-surface-hover active:scale-95 disabled:opacity-50 text-foreground rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all border border-border shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background cursor-pointer shrink-0"
        >
          <Sparkles className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
          <span>แปลทั้งเล่ม</span>
        </button>
      )}
    </div>
  );
}
