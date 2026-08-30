"use client";

import { type ReactElement } from "react";
import { CheckCircle2, AlertCircle, RefreshCw, Palette } from "lucide-react";
import type { TextStyleProfile } from "@/lib/colorMatching/types";

export interface ColorMatchStatusProps {
  profile?: TextStyleProfile;
  onReanalyze?: () => void;
  loading?: boolean;
}

export function ColorMatchStatus({
  profile,
  onReanalyze,
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

  const isAuto = profile.source === "auto" || profile.source === "fallback";
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
            {isAuto && isHighConfidence ? (
              <>
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-300">จับสีอัตโนมัติ ({percent}%)</span>
              </>
            ) : profile.source === "manual" ? (
              <span className="text-primary font-semibold">ปรับแต่งเอง (Manual)</span>
            ) : (
              <>
                <AlertCircle className="w-3 h-3 text-amber-400" />
                <span className="text-muted">ใช้สีมาตรฐาน (ไม่แน่ใจ)</span>
              </>
            )}
          </div>
        </div>
      </div>

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
  );
}
