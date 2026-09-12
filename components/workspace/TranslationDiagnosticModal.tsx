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
import type { TranslationFailureGroup } from "@/lib/translation/failureGroups";

export type DiagnosticFailureGroup = TranslationFailureGroup;

export type CleanerRecoveryStatus =
  | "idle"
  | "checking"
  | "restarting"
  | "verifying"
  | "recovered"
  | "failed";

export interface CleanerRecoveryViewState {
  status: CleanerRecoveryStatus;
  message?: string;
}

export interface TranslationDiagnosticModalProps {
  isOpen: boolean;
  onClose: () => void;
  failureGroups: DiagnosticFailureGroup[];
  onOpenSettingsApiKey?: (failureGroupId: string) => void;
  onEnableNsfwBypassAndRetry?: (failureGroupId: string) => void | Promise<void>;
  onRetryFailureGroup?: (failureGroupId: string) => void | Promise<void>;
  onRecoverCleaner?: (failureGroupId: string) => void | Promise<void>;
  cleanerRecoveryByGroup?: Record<string, CleanerRecoveryViewState>;
  apiKeyReadyByGroup?: Record<string, boolean>;
}

export function TranslationDiagnosticModal({
  isOpen,
  onClose,
  failureGroups,
  onOpenSettingsApiKey,
  onEnableNsfwBypassAndRetry,
  onRetryFailureGroup,
  onRecoverCleaner,
  cleanerRecoveryByGroup = {},
  apiKeyReadyByGroup = {},
}: TranslationDiagnosticModalProps): ReactElement | null {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
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
        <div className="flex items-center justify-between border-b border-surface-hover bg-red-500/10 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-500/20 text-red-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h2 id="diagnostic-modal-title" className="text-base font-semibold text-foreground">
                รายงานสาเหตุการแปลไม่สำเร็จ
              </h2>
              <p className="text-xs text-muted">
                พบข้อผิดพลาดใน {failureGroups.reduce((acc, group) => acc + group.pages.length, 0)} หน้า — ตรวจพบสาเหตุด้านล่าง
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

        <div className="max-h-[60vh] overflow-y-auto p-5 space-y-4">
          {failureGroups.map((group) => {
            const { diagnostic, pages } = group;
            const cleanerRecovery = cleanerRecoveryByGroup[group.id] ?? { status: "idle" as const };
            const cleanerBusy = ["checking", "restarting", "verifying"].includes(cleanerRecovery.status);

            return (
              <div
                key={group.id}
                data-failure-group-id={group.id}
                className="rounded-lg border border-surface-hover bg-background/60 p-4 space-y-3"
              >
                <div className="space-y-1">
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${diagnostic.code === "CLEANING_REVIEW_REQUIRED" ? "text-amber-400" : "text-red-400"}`}>
                    {diagnostic.code === "MISSING_KEY" && <Key className="h-3.5 w-3.5" />}
                    {diagnostic.code === "SAFETY_BLOCKED" && <Flame className="h-3.5 w-3.5" />}
                    {diagnostic.code === "QUOTA_EXHAUSTED" && <Clock className="h-3.5 w-3.5" />}
                    {(diagnostic.code === "LOCAL_SIDECAR_OFFLINE" || diagnostic.code === "LOCAL_CLEANER_FAILED") && <ServerOff className="h-3.5 w-3.5" />}
                    {diagnostic.code === "NETWORK_OR_TIMEOUT" && <RotateCw className="h-3.5 w-3.5" />}
                    {diagnostic.code === "CLEANING_REVIEW_REQUIRED" && <AlertTriangle className="h-3.5 w-3.5" />}
                    <span>{diagnostic.title}</span>
                  </span>
                  <p className="text-xs leading-relaxed text-muted">{diagnostic.description}</p>
                  {group.messages && group.messages.length > 0 && (
                    <div className="mt-2 rounded-md border border-surface-hover bg-black/20 px-2.5 py-2">
                      <p className="mb-1 text-[11px] font-medium text-muted">รายละเอียดที่ตรวจพบ</p>
                      <div className="space-y-1">
                        {group.messages.slice(0, 3).map((message) => (
                          <code
                            key={message}
                            className="block break-words whitespace-pre-wrap text-[11px] leading-relaxed text-foreground/80"
                          >
                            {message}
                          </code>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted">หน้าที่ได้รับผลกระทบ:</span>
                  <div className="flex flex-wrap gap-1">
                    {pages.map((page) => (
                      <span
                        key={page}
                        className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-medium ${
                          diagnostic.code === "CLEANING_REVIEW_REQUIRED"
                            ? "bg-amber-500/20 text-amber-300"
                            : "bg-red-500/20 text-red-300"
                        }`}
                      >
                        หน้า {page}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="pt-1 space-y-2">
                  {diagnostic.recommendedAction === "open_settings_api_key" && (
                    apiKeyReadyByGroup[group.id] ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" /> API Key พร้อมใช้งานแล้ว
                        </span>
                        <button
                          type="button"
                          onClick={async () => {
                            await onRetryFailureGroup?.(group.id);
                            onClose();
                          }}
                          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-hover transition-colors shadow-sm"
                        >
                          <RotateCw className="h-3.5 w-3.5" /> ลองหน้ากลุ่มนี้ใหม่
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenSettingsApiKey?.(group.id);
                        }}
                        className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-hover transition-colors shadow-sm"
                      >
                        <Key className="h-3.5 w-3.5" />
                        <span>{diagnostic.actionLabel}</span>
                      </button>
                    )
                  )}

                  {diagnostic.recommendedAction === "enable_nsfw_bypass" && (
                    <button
                      type="button"
                      onClick={async () => {
                        await onEnableNsfwBypassAndRetry?.(group.id);
                        onClose();
                      }}
                      className="inline-flex items-center gap-2 rounded-md bg-orange-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-500 transition-colors shadow-sm"
                    >
                      <Flame className="h-3.5 w-3.5" />
                      <span>{diagnostic.actionLabel}</span>
                    </button>
                  )}

                  {diagnostic.recommendedAction === "retry_cooldown" && (
                    <div className="flex items-center gap-3">
                      {group.cooldownRemainingSeconds > 0 ? (
                        <span className="flex items-center gap-1.5 text-xs text-amber-400 font-medium">
                          <Clock className="h-3.5 w-3.5" />
                          กำลังคูลดาวน์โควต้า ({group.cooldownRemainingSeconds} วิ)...
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={async () => {
                            await onRetryFailureGroup?.(group.id);
                            onClose();
                          }}
                          className="inline-flex items-center gap-2 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500 transition-colors shadow-sm"
                        >
                          <RotateCw className="h-3.5 w-3.5" />
                          <span>ลองแปลหน้าที่ตกหล่นใหม่</span>
                        </button>
                      )}
                    </div>
                  )}

                  {diagnostic.recommendedAction === "restart_cleaner" && (
                    <div className="space-y-2">
                      {cleanerRecovery.status === "recovered" ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Cleaner พร้อมใช้งานแล้ว
                          </span>
                          <button
                            type="button"
                            onClick={async () => {
                              await onRetryFailureGroup?.(group.id);
                              onClose();
                            }}
                            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
                          >
                            <RotateCw className="h-3.5 w-3.5" /> ลองหน้ากลุ่มนี้ใหม่
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={cleanerBusy}
                          onClick={() => void onRecoverCleaner?.(group.id)}
                          className="inline-flex items-center gap-2 rounded-md bg-surface-hover px-3 py-1.5 text-xs font-medium text-foreground hover:bg-primary hover:text-primary-foreground disabled:cursor-wait disabled:opacity-60 transition-colors border border-surface-hover"
                        >
                          <ServerOff className="h-3.5 w-3.5" />
                          <span>
                            {cleanerRecovery.status === "checking" && "กำลังตรวจ Cleaner..."}
                            {cleanerRecovery.status === "restarting" && "กำลังเริ่ม Cleaner ใหม่..."}
                            {cleanerRecovery.status === "verifying" && "กำลังยืนยันสถานะ Cleaner..."}
                            {!cleanerBusy && diagnostic.actionLabel}
                          </span>
                        </button>
                      )}
                      {cleanerRecovery.status === "failed" && (
                        <p role="alert" className="text-xs text-red-400">
                          {cleanerRecovery.message || "กู้คืน Cleaner ไม่สำเร็จ กรุณาตรวจสอบ runtime แล้วลองอีกครั้ง"}
                        </p>
                      )}
                    </div>
                  )}

                  {diagnostic.recommendedAction === "retry_failed" && (
                    <button
                      type="button"
                      onClick={async () => {
                        await onRetryFailureGroup?.(group.id);
                        onClose();
                      }}
                      className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors border shadow-sm ${
                        diagnostic.code === "CLEANING_REVIEW_REQUIRED"
                          ? "bg-amber-600 text-white hover:bg-amber-500 border-amber-500/30"
                          : "bg-surface-hover text-foreground hover:bg-primary hover:text-primary-foreground border-surface-hover"
                      }`}
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

        <div className="flex items-center justify-between border-t border-surface-hover bg-background/50 px-5 py-3">
          <span className="text-[11px] text-muted">
            การกู้คืนบริการหรือคีย์จะไม่ส่งคำขอแปลใหม่จนกว่าคุณจะกดลองใหม่
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
