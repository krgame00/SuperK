"use client";

import { useState, useEffect, useMemo, useCallback, type ReactElement, type ReactNode } from "react";
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
  HardDrive,
} from "lucide-react";
import type { LogEntry, LogLevel, LogSource } from "@/lib/logger/types";
import { getLogs, clearLogs, subscribeLogs } from "@/lib/logger/clientLogger";
import { pageBlobStore } from "@/lib/lifecycle/pageBlobStore";
import { workspaceResourceManager } from "@/lib/lifecycle/workspaceResourceManager";
import type { StorageReport } from "@/src/app/api/system/storage/route";

export interface SystemLogsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialLogs?: LogEntry[];
}

interface BrowserStorageRow {
  key: string;
  bytes: number;
}

interface BrowserStorageInfo {
  usageBytes: number | null;
  quotaBytes: number | null;
  localStorageTop: BrowserStorageRow[];
  localStorageTotal: number;
  pageBlobBytes: number | null;
  ramUsageMB: number | null;
  ramBudgetMB: number | null;
}

const formatBytes = (bytes: number | null | undefined): string => {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
};

const formatHours = (hours: number | null | undefined): string =>
  hours === null || hours === undefined || Number.isNaN(hours)
    ? "—"
    : `${hours.toFixed(1)} ชม.`;

const ageHoursFrom = (ms: number | null): number | null =>
  ms === null ? null : Math.max(0, (Date.now() - ms) / 3_600_000);

const collectBrowserStorage = async (): Promise<BrowserStorageInfo> => {
  let usageBytes: number | null = null;
  let quotaBytes: number | null = null;
  try {
    if (typeof navigator.storage?.estimate === "function") {
      const estimate = await navigator.storage.estimate();
      usageBytes = estimate.usage ?? null;
      quotaBytes = estimate.quota ?? null;
    }
  } catch {
    // Estimate API unsupported or denied.
  }

  let localStorageRows: BrowserStorageRow[] = [];
  try {
    localStorageRows = Object.keys(localStorage).map((key) => {
      const value = localStorage.getItem(key) ?? "";
      return { key, bytes: (key.length + value.length) * 2 };
    });
    localStorageRows.sort((a, b) => b.bytes - a.bytes);
  } catch {
    // localStorage may be blocked in privacy modes.
  }

  let pageBlobBytes: number | null = null;
  let ramUsageMB: number | null = null;
  let ramBudgetMB: number | null = null;
  try {
    pageBlobBytes = pageBlobStore.getTotalSizeBytes();
    ramUsageMB = Math.round(workspaceResourceManager.getCurrentUsageMB());
    ramBudgetMB = Math.round(workspaceResourceManager.getBudgetMB());
  } catch {
    // Lifecycle managers not ready in this session.
  }

  return {
    usageBytes,
    quotaBytes,
    localStorageTop: localStorageRows.slice(0, 5),
    localStorageTotal: localStorageRows.reduce((sum, row) => sum + row.bytes, 0),
    pageBlobBytes,
    ramUsageMB,
    ramBudgetMB,
  };
};

function StorageCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function StorageRow({
  label,
  path,
  value,
}: {
  label: string;
  path?: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-foreground">{label}</div>
        {path && <div className="truncate font-mono text-[11px] text-muted">{path}</div>}
      </div>
      <div className="shrink-0 font-medium text-foreground">{value}</div>
    </div>
  );
}

function StorageBody({
  report,
  browser,
}: {
  report: StorageReport | null;
  browser: BrowserStorageInfo | null;
}): ReactElement {
  if (!report) {
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-2 text-center text-muted">
        <HardDrive className="h-8 w-8 text-muted/60" />
        <p className="text-sm font-medium text-foreground">ไม่สามารถดึงข้อมูลพื้นที่จัดเก็บได้</p>
        <p className="text-xs">กดปุ่มรีเฟรชเพื่อลองอีกครั้ง</p>
      </div>
    );
  }

  const desktopIniHits = [...report.ocr.desktopIniHits, ...report.repo.desktopIniHits];

  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-4 text-xs">
      {desktopIniHits.length > 0 && (
        <div
          role="alert"
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400"
        >
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            พบไฟล์ desktop.ini (ไฟล์ที่ Google Drive สร้างขึ้น) ในไดเรกทอรีแคช — อาจทำให้แคช Turbopack หรือ dev server ทำงานผิดปกติ
          </div>
          <ul className="mt-1 space-y-0.5 font-mono text-[11px]">
            {desktopIniHits.map((hit) => (
              <li key={hit} className="truncate">
                {hit}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
            report.ocr.reachable
              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
              : "bg-red-500/10 text-red-400 border-red-500/20"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              report.ocr.reachable ? "bg-emerald-400" : "bg-red-400"
            }`}
          />
          OCR: {report.ocr.reachable ? "Online" : "Offline"}
        </span>
        {!report.ocr.reachable && report.ocr.error && (
          <span className="text-[11px] text-red-400">{report.ocr.error}</span>
        )}
        <span className="text-[11px] text-muted">
          อัปเดต {new Date(report.serverTime).toLocaleTimeString()}
        </span>
      </div>

      <StorageCard title="แคชงาน OCR (เซิร์ฟเวอร์)">
        <div className="truncate font-mono text-[11px] text-muted">{report.ocr.cacheDir}</div>
        <StorageRow label="จำนวนงานที่เก็บอยู่" value={`${report.ocr.jobs.count}`} />
        <StorageRow label="ขนาดรวม" value={formatBytes(report.ocr.jobs.bytes)} />
        <StorageRow label="งานเก่าสุด" value={formatHours(ageHoursFrom(report.ocr.jobs.oldestMs))} />
        <StorageRow label="ระยะเวลาเก็บงาน (retention)" value={formatHours(report.ocr.retentionHours)} />
        <StorageRow label="โฟลเดอร์ชั่วคราว (temp)" value={formatBytes(report.ocr.tempBytes)} />
        {report.ocr.jobs.largest.length > 0 && (
          <div className="mt-1.5 space-y-1 border-t border-border/50 pt-1.5">
            <div className="text-[11px] text-muted">งานที่กินพื้นที่มากที่สุด (5 อันดับแรก)</div>
            {report.ocr.jobs.largest.map((job) => (
              <div key={job.id} className="flex items-center justify-between gap-3">
                <span className="truncate font-mono text-[11px] text-muted">{job.id}</span>
                <span className="shrink-0 text-foreground">
                  {formatBytes(job.bytes)} · {formatHours(job.ageHours)}
                </span>
              </div>
            ))}
          </div>
        )}
      </StorageCard>

      <StorageCard title="โมเดล AI (เซิร์ฟเวอร์)">
        {report.ocr.models.length === 0 ? (
          <div className="text-muted">ไม่พบข้อมูลโมเดล</div>
        ) : (
          report.ocr.models.map((model) => (
            <div key={model.name} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-foreground">
                  {model.name}
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                      model.present
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                        : "bg-gray-500/10 text-gray-400 border-gray-500/20"
                    }`}
                  >
                    {model.present ? "มีไฟล์" : "ไม่พบ"}
                  </span>
                </div>
                <div className="truncate font-mono text-[11px] text-muted">{model.path}</div>
              </div>
              <span className="shrink-0 font-medium text-foreground">{formatBytes(model.bytes)}</span>
            </div>
          ))
        )}
      </StorageCard>

      <StorageCard title="แคช build (Next.js)">
        <StorageRow
          label="Turbopack cache"
          path=".next/cache/turbopack"
          value={formatBytes(report.repo.nextCache.turbopackBytes)}
        />
        <StorageRow
          label="Dev cache"
          path=".next/dev/cache"
          value={formatBytes(report.repo.nextCache.devCacheBytes)}
        />
        <StorageRow
          label="Standalone output"
          path=".next/standalone"
          value={formatBytes(report.repo.nextCache.standaloneBytes)}
        />
      </StorageCard>

      <StorageCard title="ไฟล์บันทึกและโปรเจกต์ที่บันทึกไว้">
        <StorageRow
          label="ไฟล์บันทึกเซิร์ฟเวอร์ (server.log)"
          path={report.repo.logs.path}
          value={formatBytes(report.repo.logs.bytes)}
        />
        <StorageRow
          label="ไฟล์บันทึกสำรอง (server.log.1)"
          value={formatBytes(report.repo.logs.rotatedBytes)}
        />
        <StorageRow
          label="โปรเจกต์ที่บันทึกไว้ (saved_projects)"
          value={`${report.repo.savedProjects.count} รายการ · ${formatBytes(report.repo.savedProjects.bytes)}`}
        />
      </StorageCard>

      <StorageCard title="เบราว์เซอร์ (ฝั่งผู้ใช้)">
        <StorageRow
          label="พื้นที่ที่เบราว์เซอร์ใช้ (quota ของ origin)"
          value={browser ? `${formatBytes(browser.usageBytes)} / ${formatBytes(browser.quotaBytes)}` : "—"}
        />
        <StorageRow label="localStorage (รวม)" value={browser ? formatBytes(browser.localStorageTotal) : "—"} />
        {browser && browser.localStorageTop.length > 0 && (
          <div className="space-y-1 border-t border-border/50 pt-1.5">
            {browser.localStorageTop.map((row) => (
              <div key={row.key} className="flex items-center justify-between gap-3">
                <span className="truncate font-mono text-[11px] text-muted">{row.key}</span>
                <span className="shrink-0 text-foreground">{formatBytes(row.bytes)}</span>
              </div>
            ))}
          </div>
        )}
        <StorageRow
          label="แคชภาพในหน่วยความจำ (page blobs)"
          value={browser && browser.pageBlobBytes !== null ? formatBytes(browser.pageBlobBytes) : "—"}
        />
        <StorageRow
          label="RAM ตามงบประมาณของระบบ"
          value={
            browser && browser.ramUsageMB !== null && browser.ramBudgetMB !== null
              ? `${browser.ramUsageMB} / ${browser.ramBudgetMB} MB`
              : "—"
          }
        />
        <StorageRow label="Cache Storage (PWA)" value="ปิดใช้งาน (PWA disabled)" />
      </StorageCard>
    </div>
  );
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
  const [activeView, setActiveView] = useState<"logs" | "storage">("logs");
  const [storageReport, setStorageReport] = useState<StorageReport | null>(null);
  const [browserStorage, setBrowserStorage] = useState<BrowserStorageInfo | null>(null);

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

  const fetchStorage = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [report, browser] = await Promise.all([
        (async () => {
          try {
            const res = await fetch("/api/system/storage");
            if (!res.ok) return null;
            return (await res.json().catch(() => null)) as StorageReport | null;
          } catch {
            return null;
          }
        })(),
        collectBrowserStorage(),
      ]);
      setStorageReport(report);
      setBrowserStorage(browser);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen || activeView !== "storage") return;
    void fetchStorage();
  }, [isOpen, activeView, fetchStorage]);

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
            {activeView === "logs" && (
              <>
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
              </>
            )}
            <div className="flex items-center rounded-lg border border-border bg-surface p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setActiveView("logs")}
                className={`flex items-center gap-1 rounded px-2 py-0.5 font-medium transition-colors ${
                  activeView === "logs"
                    ? "bg-surface-hover text-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                <ScrollText className="h-3 w-3" />
                บันทึกเหตุการณ์
              </button>
              <button
                type="button"
                onClick={() => setActiveView("storage")}
                className={`flex items-center gap-1 rounded px-2 py-0.5 font-medium transition-colors ${
                  activeView === "storage"
                    ? "bg-surface-hover text-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                <HardDrive className="h-3 w-3" />
                พื้นที่จัดเก็บ
              </button>
            </div>
          </div>

          {/* Search & Actions */}
          <div className="flex items-center gap-2">
            {activeView === "logs" && (
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
            )}

            <button
              type="button"
              onClick={() => void (activeView === "storage" ? fetchStorage() : fetchCombinedLogs())}
              disabled={isRefreshing}
              className="flex h-8 items-center gap-1 rounded-lg border border-border bg-surface px-2.5 text-xs text-muted hover:bg-surface-hover hover:text-foreground transition-colors disabled:opacity-50"
              title="ดึงข้อมูลล่าสุด"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            </button>

            {activeView === "logs" && (
              <>
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
              </>
            )}
          </div>
        </div>

        {/* Log Entries List / Storage Report */}
        {activeView === "storage" ? (
          <StorageBody report={storageReport} browser={browserStorage} />
        ) : (
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
        )}

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
