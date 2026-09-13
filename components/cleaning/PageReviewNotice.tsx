"use client";

import { useState } from "react";

export function PageReviewNotice({ onConfirm }: { onConfirm: () => void }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
      <span className="font-medium text-amber-500">หน้านี้มีจุดคลีนหรือคำแปลที่ต้องการการตรวจทาน</span>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onConfirm} className="rounded bg-amber-700 px-3 py-2 font-semibold text-white hover:bg-amber-600 focus-visible:outline-2">
          ยืนยันภาพปัจจุบันเพื่อส่งออก
        </button>
        <button type="button" onClick={() => setDismissed(true)} aria-label="ปิดการแจ้งเตือน" className="rounded p-2 text-foreground focus-visible:outline-2">✕</button>
      </div>
    </div>
  );
}
