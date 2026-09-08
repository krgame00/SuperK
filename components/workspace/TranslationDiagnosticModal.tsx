"use client";

import { useEffect, useRef, type ReactElement } from "react";
import {
  AlertTriangle,
  Key,
  Flame,
  Clock,
  RotateCw,
  ServerOff,
  X,
  CheckCircle2,
} from "lucide-react";
import {
  type DiagnosticDetail,
  type DiagnosticErrorCode,
} from "@/lib/translation/diagnostics";

export interface DiagnosticFailureGroup {
  diagnostic: DiagnosticDetail;
  pages: number[]; // 1-indexed page numbers
}

export interface TranslationDiagnosticModalProps {
  isOpen: boolean;
  onClose: () => void;
  failureGroups: DiagnosticFailureGroup[];
  onOpenSettingsApiKey?: () => void;
  onEnableNsfwBypassAndRetry?: () => void;
  onRetryFailedPages?: () => void;
  cooldownSeconds?: number;
}

export function TranslationDiagnosticModal({
  isOpen,
  onClose,
  failureGroups,
  onOpenSettingsApiKey,
  onEnableNsfwBypassAndRetry,
  onRetryFailedPages,
  cooldownSeconds = 0,
}: TranslationDiagnosticModalProps): ReactElement | null {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || failureGroups.length === 0) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="diagnostic-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-lg overflow-hidden rounded-xl border border-red-500/30 bg-surface shadow-2xl transition-all"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-surface-hover bg-red-500/10 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-500/20 text-red-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h2
                id="diagnostic-modal-title"
                className="text-base font-semibold text-foreground"
              >
                รายงานสาเหตุการแปลไม่สำเร็จ
              </h2>
              <p className="text-xs text-muted">
                พบข้อผิดพลาดใน {failureGroups.reduce((acc, g) => acc + g.pages.length, 0)} หน้า — ตรวจพบสาเหตุด้านล่าง
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted hover:bg-surface-hover hover:text-foreground transition-colors"
            aria-label="ปิดหน้าต่าง"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content list of failure groups */}
        <div className="max-h-[60vh] overflow-y-auto p-5 space-y-4">
          {failureGroups.map((group, idx) => {
            const { diagnostic, pages } = group;

            return (
              <div
                key={idx}
                className="rounded-lg border border-surface-hover bg-background/60 p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-400">
                      {diagnostic.code === "MISSING_KEY" && <Key className="h-3.5 w-3.5" />}
                      {diagnostic.code === "SAFETY_BLOCKED" && <Flame className="h-3.5 w-3.5" />}
                      {diagnostic.code === "QUOTA_EXHAUSTED" && <Clock className="h-3.5 w-3.5" />}
                      {diagnostic.code === "LOCAL_SIDECAR_OFFLINE" && <ServerOff className="h-3.5 w-3.5" />}
                      {diagnostic.code === "NETWORK_OR_TIMEOUT" && <RotateCw className="h-3.5 w-3.5" />}
                      <span>{diagnostic.title}</span>
                    </span>
                    <p className="text-xs leading-relaxed text-muted">
                      {diagnostic.description}
                    </p>
                  </div>
                </div>

                {/* Affected Pages Badge */}
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted">หน้าที่ได้รับผลกระทบ:</span>
                  <div className="flex flex-wrap gap-1">
                    {pages.map((p) => (
                      <span
                        key={p}
                        className="rounded bg-red-500/20 px-1.5 py-0.5 font-mono text-[11px] font-medium text-red-300"
                      >
                        หน้า {p}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Specific Action Buttons per Taxonomy */}
                <div className="pt-1">
                  {diagnostic.recommendedAction === "open_settings_api_key" && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenSettingsApiKey?.();
                      }}
                      className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-hover transition-colors shadow-sm"
                    >
                      <Key className="h-3.5 w-3.5" />
                      <span>{diagnostic.actionLabel}</span>
                    </button>
                  )}

                  {diagnostic.recommendedAction === "enable_nsfw_bypass" && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onEnableNsfwBypassAndRetry?.();
                      }}
                      className="inline-flex items-center gap-2 rounded-md bg-orange-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-500 transition-colors shadow-sm"
                    >
                      <Flame className="h-3.5 w-3.5" />
                      <span>{diagnostic.actionLabel}</span>
                    </button>
                  )}

                  {diagnostic.recommendedAction === "retry_cooldown" && (
                    <div className="flex items-center gap-3">
                      {cooldownSeconds > 0 ? (
                        <span className="flex items-center gap-1.5 text-xs text-amber-400 font-medium">
                          <Clock className="h-3.5 w-3.5 animate-spin" />
                          กำลังคูลดาวน์โควต้า ({cooldownSeconds} วิ)...
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onRetryFailedPages?.();
                          }}
                          className="inline-flex items-center gap-2 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500 transition-colors shadow-sm"
                        >
                          <RotateCw className="h-3.5 w-3.5" />
                          <span>ลองแปลหน้าที่ตกหล่นใหม่ทันที</span>
                        </button>
                      )}
                    </div>
                  )}

                  {(diagnostic.recommendedAction === "retry_failed" ||
                    diagnostic.recommendedAction === "restart_cleaner") && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onRetryFailedPages?.();
                      }}
                      className="inline-flex items-center gap-2 rounded-md bg-surface-hover px-3 py-1.5 text-xs font-medium text-foreground hover:bg-primary hover:text-primary-foreground transition-colors border border-surface-hover"
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                      <span>{diagnostic.actionLabel}</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-surface-hover bg-background/50 px-5 py-3">
          <span className="text-[11px] text-muted">
            เคล็ดลับ: คุณสามารถกดลองใหม่เฉพาะหน้าที่ไม่ผ่านได้ตลอดเวลา
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-surface-hover px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-active transition-colors"
          >
            ปิด
          </button>
        </div>
      </div>
    </div>
  );
}
