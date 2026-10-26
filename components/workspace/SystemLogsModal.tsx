"use client";

import { useState, useEffect, useMemo, useCallback, type ReactElement } from "react";
import {
  X,
  ScrollText,
  AlertTriangle,
  AlertCircle,
  Info,
  Copy,
  Download,
  Trash2,
  RefreshCw,
  Search,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Server,
  Monitor,
} from "lucide-react";
import type { LogEntry, LogLevel, LogSource } from "@/lib/logger/types";
import { getLogs, clearLogs, subscribeLogs } from "@/lib/logger/clientLogger";

export interface SystemLogsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialLogs?: LogEntry[];
}

export function SystemLogsModal({
  isOpen,
  onClose,
  initialLogs,
}: SystemLogsModalProps): ReactElement | null {
  const [logs, setLogs] = useState<LogEntry[]>(() => initialLogs ?? getLogs());
  const [levelFilter, setLevelFilter] = useState<"ALL" | LogLevel>("ALL");
  const [sourceFilter, setSourceFilter] = useState<"ALL" | LogSource>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [ocrHealthy, setOcrHealthy] = useState<boolean | null>(null);

  const fetchCombinedLogs = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const clientEntries = getLogs();
      let serverEntries: LogEntry[] = [];

      try {
        const res = await fetch("/api/system/logs");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.entries)) {
            serverEntries = data.entries;
          }
          if (typeof data.ocrHealthy === "boolean") {
            setOcrHealthy(data.ocrHealthy);
          }
        }
      } catch {
        // Failed to fetch server logs (offline or error)
      }

      // Merge and deduplicate
      const seen = new Set<string>();
      const combined: LogEntry[] = [];

      for (const entry of [...clientEntries, ...serverEntries]) {
        const key = entry.id || `${entry.timestamp}-${entry.message}`;
        if (!seen.has(key)) {
          seen.add(key);
          combined.push(entry);
        }
      }

      // Sort newest first
      combined.sort((a, b) => b.timestamp - a.timestamp);
      setLogs(combined);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);

    if (initialLogs) {
      setLogs(initialLogs);
      return () => {
        window.removeEventListener("keydown", handleKeyDown);
      };
    }

    void fetchCombinedLogs();

    const unsubscribe = subscribeLogs((newEntry) => {
      setLogs((prev) => [newEntry, ...prev]);
    });

    return () => {
      unsubscribe();
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, initialLogs, fetchCombinedLogs, onClose]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (levelFilter !== "ALL" && log.level !== levelFilter) return false;
      if (sourceFilter !== "ALL" && log.source !== sourceFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchMsg = log.message.toLowerCase().includes(q);
        const matchCat = log.category.toLowerCase().includes(q);
        const matchDetails = log.details
          ? JSON.stringify(log.details).toLowerCase().includes(q)
          : false;
        if (!matchMsg && !matchCat && !matchDetails) return false;
      }
      return true;
    });
  }, [logs, levelFilter, sourceFilter, searchQuery]);

  const counts = useMemo(() => {
    let errors = 0;
    let warns = 0;
    let infos = 0;
    for (const log of logs) {
      if (log.level === "error") errors++;
      else if (log.level === "warn") warns++;
      else if (log.level === "info") infos++;
    }
    return { total: logs.length, errors, warns, infos };
  }, [logs]);

  const handleCopyLogs = async () => {
    const header = [
      `=== SuperK Manga Translator System Diagnostic Report ===`,
      `Exported at: ${new Date().toISOString()}`,
      `Total Entries: ${logs.length} (Errors: ${counts.errors}, Warnings: ${counts.warns})`,
      `OCR Daemon Status: ${ocrHealthy === null ? "Unknown" : ocrHealthy ? "Healthy" : "Offline"}`,
      `=========================================================\n`,
    ].join("\n");

    const body = filteredLogs
      .map((e) => {
        const time = e.isoTime.replace("T", " ").replace("Z", "");
        const detailsStr = e.details
          ? `\nDetails: ${JSON.stringify(e.details, null, 2)}`
          : "";
        const stackStr = e.stack ? `\nStack: ${e.stack}` : "";
        return `[${time}] [${e.level.toUpperCase()}] [${e.category}] (${e.source}) ${e.message}${detailsStr}${stackStr}`;
      })
      .join("\n\n");

    try {
      await navigator.clipboard.writeText(`${header}\n${body}`);
      void import("react-hot-toast").then((m) =>
        m.default.success("คัดลอกบันทึกข้อผิดพลาดเรียบร้อยแล้ว", { duration: 3000 })
      );
    } catch {
      void import("react-hot-toast").then((m) =>
        m.default.error("ไม่สามารถคัดลอกข้อความได้", { duration: 3000 })
      );
    }
  };

  const handleDownloadLogs = () => {
    const text = filteredLogs
      .map((e) => {
        const time = e.isoTime.replace("T", " ").replace("Z", "");
        const detailsStr = e.details
          ? `\nDetails: ${JSON.stringify(e.details, null, 2)}`
          : "";
        const stackStr = e.stack ? `\nStack: ${e.stack}` : "";
        return `[${time}] [${e.level.toUpperCase()}] [${e.category}] (${e.source}) ${e.message}${detailsStr}${stackStr}`;
      })
      .join("\n\n");

    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `superk-system-logs-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleClearAll = async () => {
    clearLogs();
    try {
      await fetch("/api/system/logs", { method: "DELETE" });
    } catch {}
    setLogs([]);
    void import("react-hot-toast").then((m) =>
      m.default("ล้างประวัติบันทึกข้อผิดพลาดเรียบร้อยแล้ว", { duration: 2500 })
    );
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="system-logs-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="flex h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border bg-surface-hover/30 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ScrollText className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="system-logs-modal-title" className="text-base font-bold text-foreground">
                  บันทึกข้อผิดพลาดและสถานะระบบ (System Logs)
                </h2>
                {ocrHealthy !== null && (
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                      ocrHealthy
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                        : "bg-red-500/10 text-red-400 border-red-500/20"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        ocrHealthy ? "bg-emerald-400" : "bg-red-400"
                      }`}
                    />
                    OCR: {ocrHealthy ? "Online" : "Offline"}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted">
                รวมทั้งหมด {counts.total} รายการ — {counts.errors} ข้อผิดพลาด, {counts.warns} ข้อความเตือน
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted hover:bg-surface-hover hover:text-foreground transition-colors"
            aria-label="ปิดหน้าต่าง"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Filters & Actions Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface/50 p-3 text-xs">
          {/* Level Filter Pills */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setLevelFilter("ALL")}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
                levelFilter === "ALL"
                  ? "bg-primary text-white"
                  : "bg-surface-hover text-muted hover:text-foreground"
              }`}
            >
              ทั้งหมด ({counts.total})
            </button>
            <button
              type="button"
              onClick={() => setLevelFilter("error")}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-medium transition-colors ${
                levelFilter === "error"
                  ? "bg-red-500 text-white"
                  : "bg-red-500/10 text-red-400 hover:bg-red-500/20"
              }`}
            >
              <AlertCircle className="h-3.5 w-3.5" />
              Error ({counts.errors})
            </button>
            <button
              type="button"
              onClick={() => setLevelFilter("warn")}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-medium transition-colors ${
                levelFilter === "warn"
                  ? "bg-amber-500 text-white"
                  : "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
              }`}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              Warn ({counts.warns})
            </button>
            <button
              type="button"
              onClick={() => setLevelFilter("info")}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-medium transition-colors ${
                levelFilter === "info"
                  ? "bg-blue-500 text-white"
                  : "bg-blue-500/10 text-blue-400 hover:bg-blue-500/20"
              }`}
            >
              <Info className="h-3.5 w-3.5" />
              Info ({counts.infos})
            </button>
            <div className="mx-1 h-4 w-px bg-border" />
            <div className="flex items-center rounded-lg border border-border bg-surface p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setSourceFilter("ALL")}
                className={`rounded px-2 py-0.5 font-medium transition-colors ${
                  sourceFilter === "ALL"
                    ? "bg-surface-hover text-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                ทั้งหมด
              </button>
              <button
                type="button"
                onClick={() => setSourceFilter("client")}
                className={`flex items-center gap-1 rounded px-2 py-0.5 font-medium transition-colors ${
                  sourceFilter === "client"
                    ? "bg-surface-hover text-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                <Monitor className="h-3 w-3" />
                Client
              </button>
              <button
                type="button"
                onClick={() => setSourceFilter("server")}
                className={`flex items-center gap-1 rounded px-2 py-0.5 font-medium transition-colors ${
                  sourceFilter === "server"
                    ? "bg-surface-hover text-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                <Server className="h-3 w-3" />
                Server
              </button>
            </div>
          </div>

          {/* Search & Actions */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
              <input
                type="text"
                placeholder="ค้นหาข้อความ..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 w-44 rounded-lg border border-border bg-surface pl-8 pr-3 text-xs text-foreground placeholder:text-muted focus:border-primary focus:outline-none"
              />
            </div>

            <button
              type="button"
              onClick={() => void fetchCombinedLogs()}
              disabled={isRefreshing}
              className="flex h-8 items-center gap-1 rounded-lg border border-border bg-surface px-2.5 text-xs text-muted hover:bg-surface-hover hover:text-foreground transition-colors disabled:opacity-50"
              title="ดึงข้อมูลล่าสุด"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            </button>

            <button
              type="button"
              onClick={() => void handleCopyLogs()}
              className="flex h-8 items-center gap-1 rounded-lg border border-border bg-surface px-2.5 text-xs font-semibold text-primary hover:bg-surface-hover transition-colors"
              title="คัดลอกบันทึกทั้งหมดเพื่อส่งตรวจสอบ"
            >
              <Copy className="h-3.5 w-3.5" />
              คัดลอก
            </button>

            <button
              type="button"
              onClick={handleDownloadLogs}
              className="flex h-8 items-center gap-1 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-foreground hover:bg-surface-hover transition-colors"
              title="ดาวน์โหลดไฟล์ .log"
            >
              <Download className="h-3.5 w-3.5" />
              ดาวน์โหลด
            </button>

            <button
              type="button"
              onClick={() => void handleClearAll()}
              className="flex h-8 items-center gap-1 rounded-lg border border-border bg-surface px-2.5 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
              title="ล้างบันทึกทั้งหมด"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Log Entries List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-xs">
          {filteredLogs.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2 text-center text-muted">
              <CheckCircle2 className="h-8 w-8 text-emerald-400/80" />
              <p className="text-sm font-medium text-foreground">ไม่พบบันทึกข้อผิดพลาดตามเงื่อนไขที่เลือก</p>
              <p className="text-xs">ระบบทำงานราบรื่นหรือไม่มีรายการที่ตรงกับคำค้นหา</p>
            </div>
          ) : (
            filteredLogs.map((log) => {
              const isExpanded = expandedIds.has(log.id);
              const hasExtra = Boolean(log.details || log.stack);

              const badgeColor =
                log.level === "error"
                  ? "bg-red-500/10 text-red-400 border-red-500/20"
                  : log.level === "warn"
                  ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                  : log.level === "info"
                  ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                  : "bg-gray-500/10 text-gray-400 border-gray-500/20";

              const sourceBadge =
                log.source === "server" ? (
                  <span className="flex items-center gap-0.5 text-[10px] text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded border border-purple-500/20">
                    <Server className="h-2.5 w-2.5" /> Server
                  </span>
                ) : (
                  <span className="flex items-center gap-0.5 text-[10px] text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded border border-cyan-500/20">
                    <Monitor className="h-2.5 w-2.5" /> Client
                  </span>
                );

              return (
                <div
                  key={log.id}
                  className="rounded-lg border border-border/80 bg-surface/80 p-2.5 transition-colors hover:bg-surface-hover/30"
                >
                  <div
                    className={`flex items-start justify-between gap-2 ${
                      hasExtra ? "cursor-pointer" : ""
                    }`}
                    onClick={() => hasExtra && toggleExpand(log.id)}
                  >
                    <div className="flex flex-1 items-start gap-2">
                      {hasExtra ? (
                        <button
                          type="button"
                          className="mt-0.5 text-muted hover:text-foreground"
                          aria-label={isExpanded ? "ย่อ" : "ขยาย"}
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                        </button>
                      ) : (
                        <span className="w-3.5" />
                      )}

                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold border ${badgeColor}`}
                        >
                          {log.level.toUpperCase()}
                        </span>
                        <span className="text-[10px] font-semibold text-muted bg-surface-hover px-1.5 py-0.5 rounded">
                          [{log.category}]
                        </span>
                        {sourceBadge}
                        <span className="text-[10px] text-muted font-normal">
                          {log.isoTime.replace("T", " ").slice(0, 19)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-1.5 pl-6 text-foreground break-words font-sans text-xs">
                    {log.message}
                  </div>

                  {isExpanded && hasExtra && (
                    <div className="mt-2.5 pl-6 space-y-2 border-t border-border/50 pt-2 text-[11px]">
                      {Boolean(log.details) && (
                        <div>
                          <div className="font-semibold text-muted mb-1">Details:</div>
                          <pre className="max-h-48 overflow-auto rounded bg-black/40 p-2 text-foreground font-mono">
                            {JSON.stringify(log.details, null, 2)}
                          </pre>
                        </div>
                      )}
                      {Boolean(log.stack) && (
                        <div>
                          <div className="font-semibold text-red-400 mb-1">Stack Trace:</div>
                          <pre className="max-h-48 overflow-auto rounded bg-black/40 p-2 text-red-300 font-mono text-[10px]">
                            {log.stack}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border bg-surface-hover/20 px-5 py-3 text-xs">
          <p className="text-muted">
            💡 กด <span className="text-primary font-semibold">&ldquo;คัดลอก&rdquo;</span> เพื่อนำข้อมูล Log ส่งให้ AI หรือทีมพัฒนาวิเคราะห์แก้บั๊กได้ทันที
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-surface-hover px-4 py-2 font-medium text-foreground hover:bg-surface-hover/80 transition-colors"
          >
            ปิด
          </button>
        </div>
      </div>
    </div>
  );
}
