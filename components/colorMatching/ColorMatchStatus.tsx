"use client";

import { type ReactElement } from "react";
import { CheckCircle2, AlertCircle, RefreshCw, Palette } from "lucide-react";
import type { TextStyleProfile } from "@/lib/colorMatching/types";

export interface ColorMatchStatusProps {
  profile?: TextStyleProfile;
  onReanalyze?: () => void;
  onSelectMode?: (mode: "auto" | "readable" | "manual") => void;
  loading?: boolean;
}

function getFallbackExplanation(reason?: TextStyleProfile["fallbackReason"]): string {
  switch (reason) {
    case "background-contamination":
      return "ตรวจพบสีพื้นหลังปนเปื้อน (Background Contamination)";
    case "insufficient-evidence":
      return "หลักฐานสีไม่เพียงพอ (Insufficient Evidence)";
    case "low-confidence":
      return "ความมั่นใจสีต่ำ (Low Confidence)";
    case "low-readability":
      return "คอนทราสต์ต่ำ/อ่านยากบนพื้นหลัง (Low Readability)";
    case "no-nearby-anchor":
      return "ไม่มีบับเบิลอ้างอิงใกล้เคียง (No Nearby Anchor)";
    default:
      return "ปรับใช้สีอ่านง่ายเพื่อป้องกันการกลืนกับภาพ";
  }
}

export function ColorMatchStatus({
  profile,
  onReanalyze,
  onSelectMode,
  loading = false,
}: ColorMatchStatusProps): ReactElement {
  if (!profile) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-muted py-1">
        <Palette className="w-3.5 h-3.5" />
        <span>สีเริ่มต้น (Global Default)</span>
      </div>
    );
  }

  const isManual = profile.source === "manual" || profile.ownershipMode === "manual";
  const isRejected = profile.evidenceState === "rejected";
  const isFallback =
    !isManual &&
    (profile.source === "fallback" ||
      profile.ownershipMode === "readable" ||
      isRejected ||
      (profile.fallbackReason && profile.fallbackReason !== "nearby"));

  const confidence = profile.fillConfidence ?? 1.0;
  const isHighConfidence = confidence >= 0.65;
  const percent = Math.round(confidence * 100);

  return (
    <div
      role="status"
      aria-label="สถานะการจับคู่สี"
      className="flex items-center justify-between gap-2 bg-background/50 border border-surface-hover/60 rounded-lg px-2.5 py-1.5 text-xs text-foreground"
    >
      <div className="flex items-center gap-2">
        <div
          className="w-3.5 h-3.5 rounded-full border border-white/20 shadow-xs flex-shrink-0"
          style={{ backgroundColor: profile.fill }}
          title={`สีที่ตรวจจับได้: ${profile.fill}`}
        />

        <div className="flex flex-col">
          <div className="flex items-center gap-1 font-medium text-[11px]">
            {isManual ? (
              <span className="text-primary font-semibold">ปรับแต่งเอง (Manual)</span>
            ) : isFallback ? (
              <>
                <AlertCircle className="w-3 h-3 text-amber-400" />
                <span className="text-amber-300">Auto → สีอ่านง่าย (Readable Fallback)</span>
              </>
            ) : isHighConfidence ? (
              <>
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-300">จับสีอัตโนมัติ ({percent}%)</span>
              </>
            ) : (
              <>
                <AlertCircle className="w-3 h-3 text-amber-400" />
                <span className="text-muted">ใช้สีมาตรฐาน (ไม่แน่ใจ)</span>
              </>
            )}
          </div>
          {isFallback && (
            <span className="text-[10px] text-muted leading-tight">
              {getFallbackExplanation(profile.fallbackReason)}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1">
        {onSelectMode && (
          <>
            {isManual ? (
              <button
                type="button"
                onClick={() => onSelectMode("auto")}
                className="text-[10px] px-1.5 py-0.5 rounded bg-surface-hover hover:bg-surface-active text-muted hover:text-foreground transition-colors cursor-pointer"
                title="คืนค่า Auto"
                aria-label="คืนค่า Auto"
              >
                คืนค่า Auto
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onSelectMode("readable")}
                className="text-[10px] px-1.5 py-0.5 rounded bg-surface-hover hover:bg-surface-active text-muted hover:text-foreground transition-colors cursor-pointer"
                title="ใช้สีอ่านง่าย"
                aria-label="ใช้สีอ่านง่าย"
              >
                ใช้สีอ่านง่าย
              </button>
            )}
          </>
        )}

        {onReanalyze && (
          <button
            type="button"
            disabled={loading}
            onClick={onReanalyze}
            className="p-1 rounded hover:bg-surface-hover text-muted hover:text-foreground transition-colors disabled:opacity-50"
            title="วิเคราะห์สีใหม่"
            aria-label="วิเคราะห์สีใหม่"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          </button>
        )}
      </div>
    </div>
  );
}
