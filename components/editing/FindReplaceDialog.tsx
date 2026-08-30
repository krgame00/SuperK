"use client";

import { useState, useEffect, type ReactElement } from "react";
import { Search, Replace, X } from "lucide-react";

export interface ReplaceOptions {
  find: string;
  replace: string;
  scope: "this-page" | "all-pages";
  caseSensitive: boolean;
}

export interface FindReplaceDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onReplace: (options: ReplaceOptions) => void;
}

export function FindReplaceDialog({
  isOpen,
  onClose,
  onReplace,
}: FindReplaceDialogProps): ReactElement | null {
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [scope, setScope] = useState<"this-page" | "all-pages">("this-page");
  const [caseSensitive, setCaseSensitive] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <aside
      role="dialog"
      aria-label="ค้นหาและแทนที่คำแปล"
      className="fixed left-4 top-20 z-40 w-80 sm:w-96 max-h-[calc(100vh-100px)] bg-surface/95 backdrop-blur-md border border-surface-hover rounded-2xl p-4 shadow-2xl text-foreground flex flex-col gap-3 select-none animate-in fade-in slide-in-from-left-3 duration-150"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-surface-hover/60 pb-2.5 flex-shrink-0">
        <div className="flex items-center gap-2 font-medium text-sm">
          <Replace className="w-5 h-5 text-primary" />
          <span>ค้นหาและแทนที่ข้อความ</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-lg hover:bg-surface-hover text-muted hover:text-foreground transition-colors"
          title="ปิด"
          aria-label="ปิด"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Form Fields */}
      <div className="flex flex-col gap-2.5 overflow-y-auto pr-1">
        <div className="flex flex-col gap-1">
          <label htmlFor="find-input" className="text-[11px] text-muted">
            ค้นหาคำ
          </label>
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 pointer-events-none" />
            <input
              id="find-input"
              aria-label="ค้นหาคำ"
              type="text"
              value={findText}
              onChange={(e) => setFindText(e.target.value)}
              placeholder="คำที่ต้องการค้นหา..."
              className="w-full bg-background border border-surface-hover rounded-lg pl-8 pr-2.5 py-1.5 text-xs focus:border-primary outline-none"
              autoFocus
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="replace-input" className="text-[11px] text-muted">
            แทนที่ด้วย
          </label>
          <input
            id="replace-input"
            aria-label="แทนที่ด้วย"
            type="text"
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            placeholder="ข้อความที่ต้องการใส่แทน..."
            className="w-full bg-background border border-surface-hover rounded-lg px-2.5 py-1.5 text-xs focus:border-primary outline-none"
          />
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex flex-col gap-1 flex-1">
            <label htmlFor="replace-scope" className="text-[11px] text-muted">
              ขอบเขต
            </label>
            <select
              id="replace-scope"
              aria-label="ขอบเขต"
              value={scope}
              onChange={(e) => setScope(e.target.value as "this-page" | "all-pages")}
              className="bg-background border border-surface-hover rounded-lg px-2 py-1 text-xs outline-none focus:border-primary"
            >
              <option value="this-page">เฉพาะหน้านี้ (This Page)</option>
              <option value="all-pages">ทุกหน้าทั้งเล่ม (All Pages)</option>
            </select>
          </div>

          <label className="flex items-center gap-1.5 text-[11px] text-muted cursor-pointer mt-4">
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(e) => setCaseSensitive(e.target.checked)}
              className="rounded accent-primary"
            />
            <span>ตรงตามพิมพ์เล็ก-ใหญ่</span>
          </label>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-surface-hover/60 flex-shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 rounded-lg border border-surface-hover hover:bg-surface-hover text-xs font-medium text-muted hover:text-foreground transition-colors"
        >
          ยกเลิก
        </button>
        <button
          type="button"
          disabled={!findText.trim()}
          onClick={() => {
            onReplace({
              find: findText,
              replace: replaceText,
              scope,
              caseSensitive,
            });
            onClose();
          }}
          className="flex items-center gap-1 bg-primary text-primary-content font-medium px-3.5 py-1.5 rounded-lg hover:brightness-110 active:scale-95 transition-all text-xs disabled:opacity-40"
        >
          <Replace className="w-3.5 h-3.5" />
          <span>แทนที่ทั้งหมด</span>
        </button>
      </div>
    </aside>
  );
}
