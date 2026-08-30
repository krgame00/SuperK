"use client";

import { type ReactElement } from "react";
import { ScanText, X, Sparkles, Loader2 } from "lucide-react";

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrAreaToolProps {
  active: boolean;
  onDetectRegion: (rect: PixelRect) => void | Promise<void>;
  onClose: () => void;
  loading?: boolean;
}

export function OcrAreaTool({
  active,
  onDetectRegion,
  onClose,
  loading = false,
}: OcrAreaToolProps): ReactElement | null {
  const defaultRect: PixelRect = {
    x: 50,
    y: 50,
    width: 250,
    height: 120,
  };

  if (!active) return null;

  return (
    <div
      role="dialog"
      aria-label="เครื่องมือเลือกพื้นที่ OCR"
      className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 bg-surface/95 backdrop-blur-md border border-surface-hover rounded-xl px-4 py-3 shadow-2xl flex items-center gap-3 text-xs text-foreground select-none motion-reduce:transition-none"
    >
      <div className="flex items-center gap-2 font-medium">
        <ScanText className="w-5 h-5 text-primary" />
        <span>โหมดเลือกพื้นที่ OCR</span>
      </div>

      <div className="w-px h-4 bg-surface-hover" />

      <button
        type="button"
        disabled={loading}
        onClick={() => onDetectRegion(defaultRect)}
        className="flex items-center gap-1.5 bg-primary text-primary-content font-medium px-3 py-1.5 rounded-lg hover:brightness-110 active:scale-95 transition-all disabled:opacity-50"
      >
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Sparkles className="w-3.5 h-3.5" />
        )}
        <span>ตรวจจับข้อความในกรอบ</span>
      </button>

      <button
        type="button"
        onClick={onClose}
        className="p-1.5 rounded-lg hover:bg-surface-hover text-muted hover:text-foreground transition-colors"
        aria-label="ยกเลิก"
        title="ยกเลิก"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  );
}
