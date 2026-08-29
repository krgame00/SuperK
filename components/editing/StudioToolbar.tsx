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
      className="flex items-center gap-1 bg-surface/50 rounded-lg px-1 py-0.5 border border-surface-hover/50 select-none"
    >
      {/* 1. Pointer / Select Tool */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSelectTool("select")}
        aria-label="เครื่องมือเลือก (Select)"
        title="เครื่องมือเลือก / ย้าย (V)"
        className={`px-2 py-1.5 rounded-md text-sm font-medium flex items-center gap-1 transition-all duration-150 ${
          activeTool === "select"
            ? "text-primary bg-primary/10 shadow-xs"
            : "text-muted hover:text-foreground hover:bg-surface-hover"
        } disabled:opacity-30`}
      >
        <MousePointer className="w-4 h-4" />
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
        className={`px-2 py-1.5 rounded-md text-sm font-medium flex items-center gap-1 transition-all duration-150 relative ${
          activeTool === "text"
            ? "text-primary bg-primary/10 shadow-xs"
            : "text-muted hover:text-foreground hover:bg-surface-hover"
        } disabled:opacity-30`}
      >
        <Type className="w-4 h-4" />
        <Plus className="w-2.5 h-2.5 absolute top-1 right-1 text-primary stroke-[3]" />
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
        className={`px-2 py-1.5 rounded-md text-sm font-medium flex items-center gap-1 transition-all duration-150 ${
          activeTool === "mask"
            ? "text-primary bg-primary/10 shadow-xs"
            : "text-muted hover:text-foreground hover:bg-surface-hover"
        } disabled:opacity-30`}
      >
        <Brush className="w-4 h-4" />
      </button>

      {/* 4. Targeted OCR Area Tool */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSelectTool(activeTool === "ocr" ? "select" : "ocr")}
        aria-label="ตีกรอบสแกน OCR"
        title="ตีกรอบสแกนข้อความ OCR เฉพาะจุด (O)"
        className={`px-2 py-1.5 rounded-md text-sm font-medium flex items-center gap-1 transition-all duration-150 ${
          activeTool === "ocr"
            ? "text-primary bg-primary/10 shadow-xs"
            : "text-muted hover:text-foreground hover:bg-surface-hover"
        } disabled:opacity-30`}
      >
        <ScanText className="w-4 h-4" />
      </button>

      {/* 5. Warp Tool */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSelectTool(activeTool === "warp" ? "select" : "warp")}
        aria-label="ดัดรูปทรง (Warp)"
        title="ดัดรูปทรง (W)"
        className={`px-2 py-1.5 rounded-md text-sm font-medium flex items-center gap-1 transition-all duration-150 ${
          activeTool === "warp"
            ? "text-primary bg-primary/10 shadow-xs"
            : "text-muted hover:text-foreground hover:bg-surface-hover"
        } disabled:opacity-30`}
      >
        <Sparkles className="w-4 h-4" />
      </button>

      <div className="w-px h-5 bg-surface-hover mx-0.5" />

      {/* 6. Find & Replace */}
      <button
        type="button"
        disabled={disabled}
        onClick={onOpenFindReplace}
        aria-label="ค้นหาและแทนที่คำ"
        title="ค้นหาและแทนที่ข้อความ (Ctrl + F)"
        className="px-2 py-1.5 rounded-md text-sm font-medium flex items-center gap-1 text-muted hover:text-foreground hover:bg-surface-hover transition-colors disabled:opacity-30"
      >
        <Replace className="w-4 h-4" />
      </button>

      {/* 7. Keyboard Shortcuts Guide */}
      <button
        type="button"
        onClick={onOpenShortcuts}
        aria-label="ดูคีย์ลัด"
        title="คีย์ลัดการใช้งาน (Keyboard Shortcuts)"
        className="px-2 py-1.5 rounded-md text-sm font-medium flex items-center gap-1 text-muted hover:text-foreground hover:bg-surface-hover transition-colors"
      >
        <Keyboard className="w-4 h-4" />
      </button>
    </div>
  );
}
