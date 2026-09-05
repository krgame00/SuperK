"use client";

import { useEffect, type ReactElement } from "react";
import { Keyboard, X } from "lucide-react";

export interface KeyboardShortcutsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { key: "Space / Eye", desc: "สลับดูภาพต้นฉบับ กับ คำแปล" },
  { key: "Ctrl + Z", desc: "Undo ย้อนกลับการแก้ไขล่าสุด" },
  { key: "Ctrl + Y / Shift+Ctrl+Z", desc: "Redo ทำซ้ำการแก้ไข" },
  { key: "Ctrl + F", desc: "ค้นหาและแทนที่คำแปล (Find & Replace)" },
  { key: "Delete / Backspace", desc: "ลบกล่องข้อความที่เลือกอยู่" },
  { key: "Ctrl + D", desc: "คัดลอก (Duplicate) กล่องข้อความ" },
  { key: "Arrow Left / Right", desc: "สลับไปหน้าก่อนหน้า / ถัดไป" },
  { key: "F", desc: "โหมดโฟกัสเต็มหน้าจอ (Focus Mode)" },
  { key: "B", desc: "ซ่อน / แสดงแถบเครื่องมือบน (ในโหมดโฟกัส)" },
  { key: "Escape", desc: "ยกเลิกการเลือก / ปิดหน้าต่าง / ออกจากโฟกัส" },
];

export function KeyboardShortcutsDialog({
  isOpen,
  onClose,
}: KeyboardShortcutsDialogProps): ReactElement | null {
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
      aria-label="คีย์ลัดสำหรับแก้ไขมังงะ"
      className="fixed left-4 top-20 z-40 w-80 sm:w-96 max-h-[calc(100vh-100px)] bg-surface/95 backdrop-blur-md border border-surface-hover rounded-2xl p-4 shadow-2xl text-foreground flex flex-col gap-3 select-none animate-in fade-in slide-in-from-left-3 duration-150"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-surface-hover/60 pb-2.5 flex-shrink-0">
        <div className="flex items-center gap-2 font-medium text-sm">
          <Keyboard className="w-5 h-5 text-primary" />
          <span>คีย์ลัด (Shortcuts)</span>
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

      {/* Scrollable Shortcut List */}
      <div className="flex flex-col gap-1.5 max-h-[calc(100vh-180px)] overflow-y-auto pr-1">
        {SHORTCUTS.map((item, idx) => (
          <div
            key={idx}
            className="flex items-center justify-between py-1.5 px-2.5 rounded-lg bg-background/60 border border-surface-hover/40 text-xs gap-2"
          >
            <span className="text-muted text-[11px] leading-tight">{item.desc}</span>
            <kbd className="px-1.5 py-0.5 rounded bg-surface border border-surface-hover text-[10px] font-mono font-medium text-foreground whitespace-nowrap flex-shrink-0">
              {item.key}
            </kbd>
          </div>
        ))}
      </div>
    </aside>
  );
}
