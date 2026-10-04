"use client";

import { useState } from "react";

export function PageReviewNotice({ onConfirm }: { onConfirm: () => void }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="flex w-full max-w-5xl flex-nowrap items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-surface/95 px-2.5 sm:px-3 py-1 shadow-md backdrop-blur-md text-xs">
      <span className="font-medium text-amber-400 truncate text-[11px] sm:text-xs">
        หน้านี้มีจุดคลีนหรือคำแปลที่ต้องการการตรวจทาน
      </span>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-lg bg-amber-600 hover:bg-amber-500 active:scale-95 px-2.5 py-1 font-semibold text-white text-[11px] sm:text-xs shadow-xs transition-all focus-visible:outline-2 cursor-pointer whitespace-nowrap"
        >
          ยืนยันภาพปัจจุบันเพื่อส่งออก
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="ปิดการแจ้งเตือน"
          className="rounded-md p-1 text-muted hover:text-foreground hover:bg-amber-500/20 active:scale-95 transition-all focus-visible:outline-2 cursor-pointer"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
