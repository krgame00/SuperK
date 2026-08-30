"use client";

import type { ReactElement } from "react";
import { Wand2, X } from "lucide-react";
import type { WorkspacePrimaryActionState } from "@/lib/workspacePrimaryAction";

export interface WorkspacePrimaryActionProps {
  state: WorkspacePrimaryActionState;
  onAction: () => void;
  onCancel?: () => void;
}

export function WorkspacePrimaryAction({
  state,
  onAction,
  onCancel,
}: WorkspacePrimaryActionProps): ReactElement {
  if (state.kind === "busy") {
    return (
      <div
        className="flex items-center gap-2"
        role="status"
        aria-live="polite"
      >
        <button
          type="button"
          disabled
          aria-label={state.label}
          className="h-8.5 min-h-[44px] sm:min-h-[34px] px-3.5 bg-primary text-primary-content opacity-75 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-xs motion-reduce:animate-none cursor-not-allowed select-none"
        >
          <span
            className="animate-spin h-3.5 w-3.5 border-2 border-primary-content border-t-transparent rounded-full motion-reduce:animate-none"
            aria-hidden="true"
          />
          <span>{state.label}</span>
        </button>

        {state.cancellable && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            aria-label="ยกเลิก"
            className="h-8.5 min-h-[44px] sm:min-h-[34px] px-2.5 rounded-lg bg-red-500/15 text-red-300 hover:bg-red-500/25 border border-red-500/30 text-xs font-semibold flex items-center gap-1 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 cursor-pointer"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            <span>ยกเลิก</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onAction}
      disabled={state.disabled}
      aria-label={state.label}
      className="h-8.5 min-h-[44px] sm:min-h-[34px] px-3.5 bg-primary text-primary-content hover:bg-primary-hover active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background cursor-pointer shrink-0"
    >
      <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{state.label}</span>
    </button>
  );
}
