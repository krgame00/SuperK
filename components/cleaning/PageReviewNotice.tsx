"use client";

import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";

export function PageReviewNotice({ onConfirm }: { onConfirm: () => void }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="flex w-full items-center justify-between gap-2 rounded-xl border border-amber-500/50 bg-amber-950/40 backdrop-blur-md px-3 sm:px-3.5 py-1.5 shadow-xl text-xs transition-all">
      <div className="flex items-center gap-2 min-w-0">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
        <span className="font-medium text-amber-300 truncate text-[11px] sm:text-xs">
          หน้านี้มีจุดคลีนหรือคำแปลที่ต้องการการตรวจทาน
        </span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={onConfirm}
          aria-label="ยืนยันภาพปัจจุบันเพื่อส่งออก"
          className="rounded-lg bg-amber-600 hover:bg-amber-500 active:scale-95 px-3 py-1 font-semibold text-white text-[11px] sm:text-xs shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 cursor-pointer whitespace-nowrap"
        >
          <span className="hidden sm:inline">ยืนยันภาพปัจจุบันเพื่อส่งออก</span>
          <span className="sm:hidden">ยืนยันภาพ</span>
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="ปิดการแจ้งเตือน"
          className="rounded-md p-1 text-amber-400/80 hover:text-white hover:bg-amber-500/20 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 cursor-pointer"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
