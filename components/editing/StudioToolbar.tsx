"use client";

import { type ReactElement } from "react";
import {
  MousePointer,
  Type,
  Brush,
  ScanText,
  Sparkles,
  Replace,
  Keyboard,
  Plus,
} from "lucide-react";

export type StudioTool = "select" | "text" | "mask" | "ocr" | "warp";

export interface StudioToolbarProps {
  activeTool: StudioTool;
  onSelectTool: (tool: StudioTool) => void;
  onAddText: () => void;
  onOpenFindReplace: () => void;
  onOpenShortcuts: () => void;
  onEditMask: () => void;
  disabled?: boolean;
}

export function StudioToolbar({
  activeTool,
  onSelectTool,
  onAddText,
  onOpenFindReplace,
  onOpenShortcuts,
  onEditMask,
  disabled = false,
}: StudioToolbarProps): ReactElement {
  return (
    <div
      role="toolbar"
      aria-label="แถบเครื่องมือสตูดิโอ"
      className="flex items-center gap-2 bg-surface/90 rounded-xl p-2 border border-border shadow-sm select-none"
    >
      {/* 1. Pointer / Select Tool */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSelectTool("select")}
        aria-label="เครื่องมือเลือก (Select)"
        title="เครื่องมือเลือก / ย้าย (V)"
        className={`h-12 w-12 rounded-xl flex items-center justify-center gap-1 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          activeTool === "select"
            ? "text-primary bg-primary/10 shadow-xs border border-primary/30 font-semibold"
            : "text-muted hover:text-foreground hover:bg-surface-hover"
        } disabled:opacity-30`}
      >
        <MousePointer className="w-6 h-6" aria-hidden="true" />
      </button>

      {/* 2. Text Tool */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          onSelectTool("text");
          onAddText();
        }}
        aria-label="เพิ่มข้อความ (Text)"
        title="เพิ่มกล่องข้อความใหม่ (T)"
        className={`h-12 w-12 rounded-xl flex items-center justify-center gap-1 transition-all duration-150 relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          activeTool === "text"
            ? "text-primary bg-primary/10 shadow-xs border border-primary/30 font-semibold"
            : "text-muted hover:text-foreground hover:bg-surface-hover"
        } disabled:opacity-30`}
      >
        <Type className="w-6 h-6" aria-hidden="true" />
        <Plus className="w-3.5 h-3.5 absolute top-1.5 right-1.5 text-primary stroke-[3]" aria-hidden="true" />
      </button>

      {/* 3. Brush / Mask Tool */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          onSelectTool("mask");
          onEditMask();
        }}
        aria-label="แก้ไข Mask"
        title="แก้ไข Mask (B)"
        className={`h-10 w-10 rounded-lg flex items-center justify-center gap-1 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          activeTool === "mask"
            ? "text-primary bg-primary/10 shadow-xs border border-primary/30 font-semibold"
            : "text-muted hover:text-foreground hover:bg-surface-hover"
        } disabled:opacity-30`}
      >
        <Brush className="w-6 h-6" aria-hidden="true" />
      </button>

      {/* 4. Targeted OCR Area Tool */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSelectTool(activeTool === "ocr" ? "select" : "ocr")}
        aria-label="ตีกรอบสแกน OCR"
        title="ตีกรอบสแกนข้อความ OCR เฉพาะจุด (O)"
        className={`h-10 w-10 rounded-lg flex items-center justify-center gap-1 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          activeTool === "ocr"
            ? "text-primary bg-primary/10 shadow-xs border border-primary/30 font-semibold"
            : "text-muted hover:text-foreground hover:bg-surface-hover"
        } disabled:opacity-30`}
      >
        <ScanText className="w-6 h-6" aria-hidden="true" />
      </button>

      {/* 5. Warp Tool */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSelectTool(activeTool === "warp" ? "select" : "warp")}
        aria-label="ดัดรูปทรง (Warp)"
        title="ดัดรูปทรง (W)"
        className={`h-10 w-10 rounded-lg flex items-center justify-center gap-1 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          activeTool === "warp"
            ? "text-primary bg-primary/10 shadow-xs border border-primary/30 font-semibold"
            : "text-muted hover:text-foreground hover:bg-surface-hover"
        } disabled:opacity-30`}
      >
        <Sparkles className="w-6 h-6" aria-hidden="true" />
      </button>

      <div className="w-px h-6 bg-border mx-1" aria-hidden="true" />

      {/* 6. Find & Replace */}
      <button
        type="button"
        disabled={disabled}
        onClick={onOpenFindReplace}
        aria-label="ค้นหาและแทนที่คำ"
        title="ค้นหาและแทนที่ข้อความ (Ctrl + F)"
        className="h-12 w-12 rounded-xl flex items-center justify-center gap-1 text-muted hover:text-foreground hover:bg-surface-hover transition-colors disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Replace className="w-6 h-6" aria-hidden="true" />
      </button>

      {/* 7. Keyboard Shortcuts Guide */}
      <button
        type="button"
        onClick={onOpenShortcuts}
        aria-label="ดูคีย์ลัด"
        title="คีย์ลัดการใช้งาน (Keyboard Shortcuts)"
        className="h-12 w-12 rounded-xl flex items-center justify-center gap-1 text-muted hover:text-foreground hover:bg-surface-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Keyboard className="w-6 h-6" aria-hidden="true" />
      </button>
    </div>
  );
}
