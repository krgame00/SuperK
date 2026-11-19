"use client";

/**
 * Imperative toast for optional/secondary steps that must never block the
 * translation itself (quality review, residue cleanup). The toast states that
 * the fallback result is still usable and offers an explicit retry, so a
 * skipped step is visible instead of silently swallowed.
 */
export interface SupplementFailureToastOptions {
  title: string;
  detail?: string;
  retryLabel?: string;
  onRetry?: () => void;
  /** Stable id so repeated failures of the same step collapse into one toast. */
  id?: string;
}

export async function showSupplementFailureToast(
  options: SupplementFailureToastOptions,
): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const { default: toast } = await import("react-hot-toast");
    const id = options.id ?? `supplement-${options.title}`;
    const { title, detail, onRetry, retryLabel = "ลองใหม่" } = options;
    toast(
      <div className="flex items-center gap-3 text-xs leading-snug">
        <span className="min-w-0">
          <span className="font-semibold">{title}</span>
          {detail ? <span className="text-muted"> · {detail}</span> : null}
        </span>
        {onRetry ? (
          <button
            type="button"
            onClick={() => {
              toast.dismiss(id);
              onRetry();
            }}
            className="shrink-0 rounded border border-primary/40 px-2 py-0.5 font-semibold text-primary hover:bg-primary/10"
          >
            {retryLabel}
          </button>
        ) : null}
      </div>,
      { id, duration: 12000, icon: "⚠️" },
    );
  } catch {
    // Notification failures must never break the translation flow.
  }
}
