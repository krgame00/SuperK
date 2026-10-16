"use client";

import { useEffect, useState, type ReactElement } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, X } from "lucide-react";
import { normalizePageExportSource, type PageExportSource } from "@/lib/export/pageSource";
import type { ReadabilityFinding } from "@/lib/export/readabilityScan";

export interface ExportReportRow {
  pageIndex: number;
  exportSource?: PageExportSource;
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
  onSelectPage?: (pageIndex: number) => void;
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
  onSelectPage,
  onContinueExport,
  scanProgress,
}: ExportReportModalProps): ReactElement | null {
  const [filterMode, setFilterMode] = useState<"all" | "issues" | "untranslated">("all");

  useEffect(() => {
    if (!isOpen) {
      setFilterMode("all");
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isRowUntranslated = (row: ExportReportRow) =>
    normalizePageExportSource(row.exportSource) === "translated" && !row.translated;

  const isRowFlagged = (row: ExportReportRow) =>
    (row.translated || normalizePageExportSource(row.exportSource) === "clean") &&
    (row.contaminated > 0 ||
      row.invalidBoxes > 0 ||
      row.pendingCleaning > 0 ||
      (row.readabilityFindings?.length ?? 0) > 0 ||
      Boolean(row.readabilityUnavailable));

  const untranslated = rows.filter(isRowUntranslated).length;
  const flagged = rows.filter(isRowFlagged).length;
  const readyCount = Math.max(0, rows.length - untranslated - flagged);
  const totalReadabilityFindings = rows.reduce(
    (sum, row) => sum + (row.readabilityFindings?.length ?? 0),
    0,
  );

  const visibleRows = rows.filter((row) => {
    if (filterMode === "untranslated") return isRowUntranslated(row);
    if (filterMode === "issues") return isRowFlagged(row) || isRowUntranslated(row);
    return true;
  });

  const summarizeReadabilityKinds = (findings?: ReadabilityFinding[]): string => {
    if (!findings || findings.length === 0) return "";
    const overflowCount = findings.filter((f) => f.kind === "overflow").length;
    const colorCount = findings.filter((f) => f.kind === "color").length;
    const smallCount = findings.filter((f) => f.kind === "small-text").length;
    const parts: string[] = [];
    if (overflowCount > 0) parts.push(`ล้น ${overflowCount}`);
    if (colorCount > 0) parts.push(`สีกลืน ${colorCount}`);
    if (smallCount > 0) parts.push(`ตัวเล็ก ${smallCount}`);
    return parts.join(" · ");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="รายงานก่อนส่งออก"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border/80 bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/60 bg-surface/50 px-5 py-3.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-sm font-bold text-foreground">
              รายงานก่อนส่งออก ({rows.length} หน้า)
            </h2>
            {readyCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400 border border-emerald-500/30">
                พร้อมส่งออก {readyCount} หน้า
              </span>
            )}
            {untranslated > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-medium text-amber-300 border border-amber-500/30">
                ยังไม่แปล {untranslated} หน้า
              </span>
            )}
            {flagged > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/15 px-2.5 py-0.5 text-[11px] font-medium text-orange-300 border border-orange-500/30">
                ควรตรวจ {flagged} หน้า
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดรายงานก่อนส่งออก"
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-foreground cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Filter Bar when there are multiple pages */}
        {rows.length > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 bg-surface/30 px-5 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setFilterMode("all")}
                className={`rounded-lg px-2.5 py-1 font-medium transition-colors cursor-pointer ${
                  filterMode === "all"
                    ? "bg-primary text-primary-content"
                    : "bg-surface text-muted hover:text-foreground"
                }`}
              >
                ทั้งหมด ({rows.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode("issues")}
                className={`rounded-lg px-2.5 py-1 font-medium transition-colors cursor-pointer ${
                  filterMode === "issues"
                    ? "bg-amber-500 text-neutral-950 font-semibold"
                    : "bg-surface text-muted hover:text-foreground"
                }`}
              >
                เฉพาะหน้าที่มีจุดตรวจ ({flagged + untranslated})
              </button>
              {untranslated > 0 && (
                <button
                  type="button"
                  onClick={() => setFilterMode("untranslated")}
                  className={`rounded-lg px-2.5 py-1 font-medium transition-colors cursor-pointer ${
                    filterMode === "untranslated"
                      ? "bg-amber-500 text-neutral-950 font-semibold"
                      : "bg-surface text-muted hover:text-foreground"
                  }`}
                >
                  ยังไม่แปล ({untranslated})
                </button>
              )}
            </div>
            {totalReadabilityFindings > 0 && (
              <span className="text-[11px] text-muted">
                คลิกที่รายการด้านล่างเพื่อกระโดดไปยังจุดข้อความบนหน้านั้นทันที
              </span>
            )}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">
              ยังไม่มีหน้าในเวิร์กสเปซ
            </p>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead className="text-muted border-b border-border/60">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-semibold">หน้า</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">คำแปล</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">ตัวอักษรปน</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">กรอบผิดปกติ</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">ค้างคลีน</th>
                  <th scope="col" className="py-2 font-semibold">ความอ่านง่าย</th>
                </tr>
              </thead>
              <tbody className="text-foreground divide-y divide-border/40">
                {visibleRows.map((row) => {
                  const hasIssue = isRowFlagged(row) || isRowUntranslated(row);
                  const breakdown = summarizeReadabilityKinds(row.readabilityFindings);
                  const firstFinding = row.readabilityFindings?.[0];
                  return (
                    <tr
                      key={row.pageIndex}
                      onClick={() => {
                        if (firstFinding && onSelectFinding) {
                          onSelectFinding(firstFinding);
                        } else if (onSelectPage) {
                          onSelectPage(row.pageIndex);
                        }
                      }}
                      className={`transition-colors ${
                        hasIssue
                          ? "bg-amber-500/[0.04] hover:bg-amber-500/[0.09]"
                          : "hover:bg-surface-hover/50"
                      } ${firstFinding || onSelectPage ? "cursor-pointer" : ""}`}
                    >
                      <td className="py-2 pr-3 font-semibold">{row.pageIndex + 1}</td>
                      <td className="py-2 pr-3">
                        {normalizePageExportSource(row.exportSource) !== "translated" ? (
                          <span className="rounded bg-surface px-2 py-0.5 text-muted border border-border/60">
                            {row.exportSource === "original" ? "ต้นฉบับ" : "ภาพคลีน"}
                          </span>
                        ) : row.translated ? (
                          <span className="inline-flex items-center gap-1 font-medium text-emerald-400">
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            {row.totalBubbles} จุด
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-2 py-0.5 font-medium text-amber-400">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            ยังไม่แปล
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        {row.contaminated > 0 ? (
                          <span className="inline-flex items-center rounded bg-red-500/15 px-2 py-0.5 font-medium text-red-400">
                            {row.contaminated} จุด
                          </span>
                        ) : (
                          <span className="text-muted">–</span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        {row.invalidBoxes > 0 ? (
                          <span className="inline-flex items-center rounded bg-amber-500/15 px-2 py-0.5 font-medium text-amber-400">
                            {row.invalidBoxes} จุด
                          </span>
                        ) : (
                          <span className="text-muted">–</span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        {row.pendingCleaning > 0 ? (
                          <span className="inline-flex items-center rounded bg-amber-500/15 px-2 py-0.5 font-medium text-amber-400">
                            {row.pendingCleaning} จุด
                          </span>
                        ) : (
                          <span className="text-muted">–</span>
                        )}
                      </td>
                      <td className="py-2">
                        {row.readabilityFindings === undefined && !row.readabilityUnavailable ? (
                          <span className="text-muted">ยังไม่ได้ตรวจ</span>
                        ) : row.readabilityUnavailable ? (
                          <span className="text-amber-400">ตรวจไม่ได้</span>
                        ) : (row.readabilityFindings?.length ?? 0) > 0 ? (
                          <span className="inline-flex flex-wrap items-center gap-1.5 text-amber-400 font-medium">
                            <span>{row.readabilityFindings?.length} จุด</span>
                            {breakdown && (
                              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300 border border-amber-500/30">
                                {breakdown}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted">–</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {rows.some((row) => (row.readabilityFindings?.length ?? 0) > 0 || row.readabilityUnavailable) && (
            <div className="mt-4 border-t border-border/60 pt-3.5">
              <div className="mb-2.5 flex items-center justify-between">
                <h3 className="text-xs font-bold text-foreground">
                  จุดที่ควรตรวจความอ่านง่าย ({totalReadabilityFindings} จุด)
                </h3>
                <span className="text-[11px] text-muted">คลิกเพื่อไปที่กล่องข้อความนั้นทันที</span>
              </div>
              <div className="flex flex-col gap-1.5">
                {rows.flatMap((row) => row.readabilityFindings ?? []).map((finding) => {
                  const reason = finding.kind === "overflow" ? "ข้อความล้น"
                    : finding.kind === "small-text" ? "ตัวอักษรเล็ก"
                      : finding.kind === "color" ? "สีกลืนกับพื้นหลัง" : "ตรวจสีไม่ได้";
                  const badgeColor =
                    finding.kind === "overflow"
                      ? "bg-orange-500/20 text-orange-300 border-orange-500/40"
                      : finding.kind === "color"
                        ? "bg-sky-500/20 text-sky-300 border-sky-500/40"
                        : "bg-amber-500/20 text-amber-300 border-amber-500/40";
                  return (
                    <button
                      key={`${finding.pageUrl}:${finding.bubbleId}:${finding.kind}`}
                      type="button"
                      className="group flex w-full items-center justify-between gap-2 rounded-xl border border-border/60 bg-surface/60 px-3 py-2 text-left text-xs text-amber-200 transition-all hover:border-amber-500/50 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
                      onClick={() => onSelectFinding?.(finding)}
                      aria-label={`หน้า ${finding.pageIndex + 1} ${reason} ${finding.text}`}
                    >
                      <span className="flex flex-wrap items-center gap-1.5 min-w-0">
                        <span className="rounded bg-background px-1.5 py-0.5 font-semibold text-foreground border border-border/60">
                          หน้า {finding.pageIndex + 1}
                        </span>
                        <span className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${badgeColor}`}>
                          {reason}
                        </span>
                        <span className="truncate text-foreground/90">
                          · {finding.text}
                          {finding.kind === "small-text" && finding.fontSize != null && finding.threshold != null
                            ? ` (${finding.fontSize}px ต่ำกว่า ${finding.threshold}px)` : ""}
                        </span>
                      </span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted group-hover:text-amber-300 transition-colors" aria-hidden="true" />
                    </button>
                  );
                })}
                {rows.filter((row) => row.readabilityUnavailable).map((row) => (
                  <p key={`unavailable-${row.pageIndex}`} className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300">
                    หน้า {row.pageIndex + 1} · {row.readabilityUnavailable}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 bg-surface/50 px-5 py-3 text-xs">
          <span className="text-muted font-medium">
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
              className="rounded-xl border border-border bg-surface px-3.5 py-1.5 font-semibold text-foreground transition-colors hover:bg-surface-hover cursor-pointer"
            >
              {onContinueExport ? "กลับไปแก้" : "กลับไปตรวจ"}
            </button>
            {onContinueExport && (
              <button
                type="button"
                onClick={onContinueExport}
                className="rounded-xl bg-primary px-4 py-1.5 font-semibold text-white shadow-sm transition-opacity hover:opacity-90 cursor-pointer"
              >
                {scanProgress ? "ส่งออกต่อโดยไม่รอผลตรวจ" : "ส่งออกต่อ"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
