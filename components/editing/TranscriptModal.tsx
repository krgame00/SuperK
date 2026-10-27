"use client";

import { useState, useEffect, type ReactElement } from "react";
import { FileText, Copy, Check, Download, Sparkles, X } from "lucide-react";
import type { TranslatedBubble } from "@/lib/translationOverlay";

export interface TranscriptPageData {
  pageIndex: number;
  pageName: string;
  pageUrl: string;
  bubbles: TranslatedBubble[];
}

export interface TranscriptModalProps {
  isOpen: boolean;
  onClose: () => void;
  pagesData: TranscriptPageData[];
  currentPageIndex: number;
  onApplyTranscript: (
    updatesByPageUrl: Map<string, Map<number, string>>,
  ) => void;
  onExportLayeredArchive?: () => void;
}

export function formatTranscriptText(
  pagesData: TranscriptPageData[],
  scope: "current" | "all",
  currentPageIndex: number,
): string {
  const targetPages =
    scope === "current"
      ? pagesData.filter((p) => p.pageIndex === currentPageIndex)
      : pagesData;

  const lines: string[] = [];
  for (const page of targetPages) {
    lines.push(`=== [Page ${page.pageIndex + 1}: ${page.pageName || `page_${page.pageIndex + 1}`}] ===`);
    page.bubbles.forEach((b, idx) => {
      if (b.deleted) return;
      const orig = String(b.original_text ?? "").replace(/\r?\n/g, " ").trim();
      const tran = String(b.t ?? b.translated ?? "").replace(/\r?\n/g, " ").trim();
      if (orig) {
        lines.push(`#${idx + 1} [ORIG]: ${orig}`);
      }
      lines.push(`#${idx + 1} [TRAN]: ${tran}`);
    });
    lines.push("");
  }
  return lines.join("\n").trim();
}

export function parseTranscriptText(
  rawText: string,
  pagesData: TranscriptPageData[],
  scope: "current" | "all",
  currentPageIndex: number,
): Map<string, Map<number, string>> {
  const updates = new Map<string, Map<number, string>>();
  let activePageUrl: string | null =
    scope === "current"
      ? (pagesData.find((p) => p.pageIndex === currentPageIndex)?.pageUrl ?? null)
      : (pagesData[0]?.pageUrl ?? null);

  for (const rawLine of rawText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const headerMatch = line.match(/^===\s*\[Page\s+(\d+)/i);
    if (headerMatch) {
      const pageNum = parseInt(headerMatch[1], 10) - 1;
      const found = pagesData.find((p) => p.pageIndex === pageNum);
      if (found) {
        activePageUrl = found.pageUrl;
      }
      continue;
    }

    const tranMatch = line.match(/^#(\d+)\s*\[TRAN\]:\s*(.*)$/i);
    if (tranMatch && activePageUrl) {
      const bubbleIdx = parseInt(tranMatch[1], 10) - 1;
      const newText = tranMatch[2].trim();
      if (bubbleIdx >= 0) {
        let pageMap = updates.get(activePageUrl);
        if (!pageMap) {
          pageMap = new Map<number, string>();
          updates.set(activePageUrl, pageMap);
        }
        pageMap.set(bubbleIdx, newText);
      }
    }
  }
  return updates;
}

export function TranscriptModal({
  isOpen,
  onClose,
  pagesData,
  currentPageIndex,
  onApplyTranscript,
  onExportLayeredArchive,
}: TranscriptModalProps): ReactElement | null {
  const [scope, setScope] = useState<"current" | "all">("all");
  const [textValue, setTextValue] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setTextValue(formatTranscriptText(pagesData, scope, currentPageIndex));
  }, [isOpen, pagesData, scope, currentPageIndex]);

  if (!isOpen) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(textValue);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback
    }
  };

  const handleDownloadTxt = () => {
    const blob = new Blob([textValue], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `SuperK_Transcript_${scope === "all" ? "FullChapter" : `Page${currentPageIndex + 1}`}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const handleApply = () => {
    const parsed = parseTranscriptText(textValue, pagesData, scope, currentPageIndex);
    onApplyTranscript(parsed);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="แก้ไขคำแปลแบบสคริปต์ (Batch Transcript Editor)"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-150"
    >
      <div className="bg-surface border border-border rounded-2xl shadow-2xl max-w-3xl w-full flex flex-col max-h-[90vh] overflow-hidden">
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-background/60">
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-primary/15 text-primary">
              <FileText className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-sm font-bold text-foreground">
                แก้ไขบทแปลทั้งตอน &amp; ส่งออกแยกเลเยอร์ (Batch Transcript &amp; Layered Export)
              </h2>
              <p className="text-[11px] text-muted">
                แก้ไขคำแปลหลังบรรทัด <code className="text-primary">#ลำดับ [TRAN]:</code> แล้วกดนำเข้าเพื่ออัปเดตทุกบอลลูนรวดเดียว
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดหน้าต่างสคริปต์คำแปล"
            className="p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-surface-hover transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 border-b border-border/60 bg-surface text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-muted font-medium">ขอบเขต:</span>
            <button
              type="button"
              onClick={() => setScope("current")}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                scope === "current"
                  ? "bg-primary text-primary-content"
                  : "bg-background text-muted hover:text-foreground"
              }`}
            >
              เฉพาะหน้านี้ (หน้า {currentPageIndex + 1})
            </button>
            <button
              type="button"
              onClick={() => setScope("all")}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                scope === "all"
                  ? "bg-primary text-primary-content"
                  : "bg-background text-muted hover:text-foreground"
              }`}
            >
              ทั้งเล่ม ({pagesData.length} หน้า)
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border bg-background hover:bg-surface-hover text-foreground font-medium transition-colors cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? "คัดลอกแล้ว" : "คัดลอกสคริปต์"}</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadTxt}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border bg-background hover:bg-surface-hover text-foreground font-medium transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>ดาวน์โหลด .TXT</span>
            </button>
            {onExportLayeredArchive && (
              <button
                type="button"
                onClick={onExportLayeredArchive}
                title="ส่งออกไฟล์ ZIP แยกเลเยอร์ (Original + Clean Inpainted + Text Layers JSON + PSD Script)"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-primary/40 bg-primary/15 hover:bg-primary/25 text-primary font-semibold transition-colors cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>ส่งออก Layered Pack (สำหรับ Photoshop)</span>
              </button>
            )}
          </div>
        </div>

        <div className="p-4 flex-1 min-h-0 flex flex-col">
          <textarea
            aria-label="พื้นที่แก้ไขสคริปต์คำแปล"
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            rows={14}
            className="w-full flex-1 bg-background border border-border rounded-xl p-3.5 text-xs font-mono text-foreground leading-relaxed focus:outline-none focus:border-primary resize-none"
          />
        </div>

        <footer className="flex items-center justify-end gap-2.5 px-5 py-3 border-t border-border bg-background/60">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl border border-border hover:bg-surface-hover text-xs font-medium text-muted hover:text-foreground transition-colors cursor-pointer"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="px-4 py-1.5 rounded-xl bg-primary hover:brightness-110 text-primary-content text-xs font-semibold shadow-md transition-all cursor-pointer"
          >
            ✅ บันทึกคำแปลกลับเข้าบอลลูน
          </button>
        </footer>
      </div>
    </div>
  );
}
