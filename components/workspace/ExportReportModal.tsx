"use client";

import { useEffect, type ReactElement } from "react";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import type { ReadabilityFinding } from "@/lib/export/readabilityScan";

export interface ExportReportRow {
  pageIndex: number;
  translated: boolean;
  totalBubbles: number;
  contaminated: number;
  invalidBoxes: number;
  pendingCleaning: number;
  readabilityFindings?: ReadabilityFinding[];
  readabilityUnavailable?: string;
}

export interface ExportReportModalProps {
  isOpen: boolean;
  rows: ExportReportRow[];
  onClose: () => void;
  onSelectFinding?: (finding: ReadabilityFinding) => void;
  onContinueExport?: () => void;
  scanProgress?: { completed: number; total: number } | null;
}

/**
 * Pre-export report: one row per page so the whole book's state is visible
 * before committing to an export — untranslated pages, bubbles with a
 * fallback box, foreign-script contamination, and cleaning regions that
 * still await review.
 */
export function ExportReportModal({
  isOpen,
  rows,
  onClose,
  onSelectFinding,
  onContinueExport,
  scanProgress,
}: ExportReportModalProps): ReactElement | null {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const untranslated = rows.filter((row) => !row.translated).length;
  const flagged = rows.filter(
    (row) =>
      row.translated &&
      (row.contaminated > 0 || row.invalidBoxes > 0 || row.pendingCleaning > 0
        || (row.readabilityFindings?.length ?? 0) > 0 || Boolean(row.readabilityUnavailable)),
  ).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="รายงานก่อนส่งออก"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border/80 bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">
            รายงานก่อนส่งออก ({rows.length} หน้า)
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดรายงานก่อนส่งออก"
            className="rounded-md p-1 text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">
              ยังไม่มีหน้าในเวิร์กสเปซ
            </p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="text-muted">
                <tr>
                  <th scope="col" className="py-1.5 pr-3 font-medium">หน้า</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">คำแปล</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">ตัวอักษรปน</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">กรอบผิดปกติ</th>
                  <th scope="col" className="py-1.5 font-medium">ค้างคลีน</th>
                  <th scope="col" className="py-1.5 font-medium">ความอ่านง่าย</th>
                </tr>
              </thead>
              <tbody className="text-foreground">
                {rows.map((row) => (
                  <tr key={row.pageIndex} className="border-t border-border/40">
                    <td className="py-1.5 pr-3">{row.pageIndex + 1}</td>
                    <td className="py-1.5 pr-3">
                      {row.translated ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                          {row.totalBubbles} จุด
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-400">
                          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                          ยังไม่แปล
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3">
                      {row.contaminated > 0 ? (
                        <span className="text-red-400">{row.contaminated} จุด</span>
                      ) : (
                        <span className="text-muted">–</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3">
                      {row.invalidBoxes > 0 ? (
                        <span className="text-amber-400">{row.invalidBoxes} จุด</span>
                      ) : (
                        <span className="text-muted">–</span>
                      )}
                    </td>
                    <td className="py-1.5">
                      {row.pendingCleaning > 0 ? (
                        <span className="text-amber-400">{row.pendingCleaning} จุด</span>
                      ) : (
                        <span className="text-muted">–</span>
                      )}
                    </td>
                    <td className="py-1.5">
                      {row.readabilityFindings === undefined && !row.readabilityUnavailable ? (
                        <span className="text-muted">ยังไม่ได้ตรวจ</span>
                      ) : row.readabilityUnavailable ? (
                        <span className="text-amber-400">ตรวจไม่ได้</span>
                      ) : (row.readabilityFindings?.length ?? 0) > 0 ? (
                        <span className="text-amber-400">{row.readabilityFindings?.length} จุด</span>
                      ) : <span className="text-muted">–</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {rows.some((row) => (row.readabilityFindings?.length ?? 0) > 0 || row.readabilityUnavailable) && (
            <div className="mt-4 border-t border-border/60 pt-3">
              <h3 className="mb-2 text-xs font-semibold text-foreground">จุดที่ควรตรวจความอ่านง่าย</h3>
              {rows.flatMap((row) => row.readabilityFindings ?? []).map((finding) => {
                const reason = finding.kind === "overflow" ? "ข้อความล้น"
                  : finding.kind === "small-text" ? "ตัวอักษรเล็ก"
                    : finding.kind === "color" ? "สีกลืนกับพื้นหลัง" : "ตรวจสีไม่ได้";
                return (
                  <button
                    key={`${finding.pageUrl}:${finding.bubbleId}:${finding.kind}`}
                    type="button"
                    className="mb-1 block w-full rounded-md px-2 py-1.5 text-left text-xs text-amber-300 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    onClick={() => onSelectFinding?.(finding)}
                    aria-label={`หน้า ${finding.pageIndex + 1} ${reason} ${finding.text}`}
                  >
                    หน้า {finding.pageIndex + 1} · {reason} · {finding.text}
                    {finding.kind === "small-text" && finding.fontSize != null && finding.threshold != null
                      ? ` (${finding.fontSize}px ต่ำกว่า ${finding.threshold}px)` : ""}
                  </button>
                );
              })}
              {rows.filter((row) => row.readabilityUnavailable).map((row) => (
                <p key={`unavailable-${row.pageIndex}`} className="px-2 py-1 text-xs text-amber-300">
                  หน้า {row.pageIndex + 1} · {row.readabilityUnavailable}
                </p>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-3 text-xs">
          <span className="text-muted">
            {scanProgress && `กำลังตรวจ ${scanProgress.completed}/${scanProgress.total} หน้า · `}
            {untranslated > 0 && `ยังไม่แปล ${untranslated} หน้า · `}
            {flagged > 0
              ? `มีจุดที่ควรตรวจ ${flagged} หน้า`
              : untranslated === 0 && !scanProgress && rows.every((row) => row.readabilityFindings !== undefined || row.readabilityUnavailable)
                ? "ทุกหน้าพร้อมส่งออก"
                : ""}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 font-medium text-foreground transition-colors hover:bg-surface-hover"
            >
              {onContinueExport ? "กลับไปแก้" : "กลับไปตรวจ"}
            </button>
            {onContinueExport && (
              <button type="button" onClick={onContinueExport}
                className="rounded-lg bg-primary px-3 py-1.5 font-medium text-white hover:opacity-90">
                {scanProgress ? "ส่งออกต่อโดยไม่รอผลตรวจ" : "ส่งออกต่อ"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
