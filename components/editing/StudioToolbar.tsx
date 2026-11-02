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
  ImagePlus,
  FileText,
  BookText,
} from "lucide-react";

export type StudioTool = "select" | "text" | "mask" | "ocr";

export interface StudioToolbarProps {
  activeTool: StudioTool;
  onSelectTool: (tool: StudioTool) => void;
  onAddText: () => void;
  onAddImageLayer?: () => void;
  onOpenFindReplace: () => void;
  onOpenShortcuts: () => void;
  onOpenTranscript?: () => void;
  onOpenGlossary?: () => void;
  onEditMask: () => void;
  /** Focus the selected bubble's warp controls in the inspector. */
  onWarpClick?: () => void;
  disabled?: boolean;
}

export function StudioToolbar({
  activeTool,
  onSelectTool,
  onAddText,
  onAddImageLayer,
  onOpenFindReplace,
  onOpenShortcuts,
  onOpenTranscript,
  onOpenGlossary,
  onEditMask,
  onWarpClick,
  disabled = false,
}: StudioToolbarProps): ReactElement {
  return (
    <div
      role="toolbar"
      aria-label="แถบเครื่องมือสตูดิโอ"
      className="flex flex-col items-center gap-1.5 bg-surface/90 backdrop-blur-md rounded-2xl p-1.5 border border-border shadow-2xl select-none w-14"
    >
      {/* 1. Pointer / Select Tool */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSelectTool("select")}
        aria-label="เครื่องมือเลือก (Select)"
        title="เครื่องมือเลือก / ย้าย (V)"
        className={`h-10 w-10 rounded-xl flex items-center justify-center transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          activeTool === "select"
            ? "text-primary bg-primary/10 shadow-xs border border-primary/30 font-semibold"
            : "text-muted hover:text-foreground hover:bg-surface-hover"
        } disabled:opacity-30`}
      >
        <MousePointer className="w-5 h-5" aria-hidden="true" />
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
        className={`h-10 w-10 rounded-xl flex items-center justify-center transition-all duration-150 relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          activeTool === "text"
            ? "text-primary bg-primary/10 shadow-xs border border-primary/30 font-semibold"
            : "text-muted hover:text-foreground hover:bg-surface-hover"
        } disabled:opacity-30`}
      >
        <Type className="w-5 h-5" aria-hidden="true" />
        <Plus className="w-3 h-3 absolute top-1 right-1 text-primary stroke-[3]" aria-hidden="true" />
      </button>

      {/* 2.5 Image / Sticker Layer Tool */}
      {onAddImageLayer && (
        <button
          type="button"
          disabled={disabled}
          onClick={onAddImageLayer}
          aria-label="รูปภาพ"
          title="รูปภาพ / โลโก้ / สติกเกอร์แปะทับหน้ามังงะ (Image Layer)"
          className="h-10 w-10 rounded-xl flex items-center justify-center text-muted hover:text-foreground hover:bg-surface-hover transition-all duration-150 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ImagePlus className="w-5 h-5" aria-hidden="true" />
        </button>
      )}

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
        className={`h-10 w-10 rounded-xl flex items-center justify-center transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          activeTool === "mask"
            ? "text-primary bg-primary/10 shadow-xs border border-primary/30 font-semibold"
            : "text-muted hover:text-foreground hover:bg-surface-hover"
        } disabled:opacity-30`}
      >
        <Brush className="w-5 h-5" aria-hidden="true" />
      </button>

      {/* 4. Targeted OCR Area Tool */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSelectTool(activeTool === "ocr" ? "select" : "ocr")}
        aria-label="ตีกรอบสแกน OCR"
        title="ตีกรอบสแกนข้อความ OCR เฉพาะจุด (O)"
        className={`h-10 w-10 rounded-xl flex items-center justify-center transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          activeTool === "ocr"
            ? "text-primary bg-primary/10 shadow-xs border border-primary/30 font-semibold"
            : "text-muted hover:text-foreground hover:bg-surface-hover"
        } disabled:opacity-30`}
      >
        <ScanText className="w-5 h-5" aria-hidden="true" />
      </button>

      {/* 5. Warp: focuses the selected bubble's warp controls in the inspector */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onWarpClick?.()}
        aria-label="ดัดรูปทรง (Warp)"
        title="ดัดรูปทรงข้อความในบับเบิลที่เลือก (W)"
        className="h-10 w-10 rounded-xl flex items-center justify-center transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary text-muted hover:text-foreground hover:bg-surface-hover disabled:opacity-30"
      >
        <Sparkles className="w-5 h-5" aria-hidden="true" />
      </button>

      <div className="h-px w-6 bg-border my-0.5" aria-hidden="true" />

      {/* 6. Find & Replace */}
      <button
        type="button"
        disabled={disabled}
        onClick={onOpenFindReplace}
        aria-label="ค้นหาและแทนที่คำ"
        title="ค้นหาและแทนที่ข้อความ (Ctrl + F)"
        className="h-10 w-10 rounded-xl flex items-center justify-center text-muted hover:text-foreground hover:bg-surface-hover transition-colors disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Replace className="w-5 h-5" aria-hidden="true" />
      </button>

      {/* 6.5 Batch Transcript Editor */}
      {onOpenTranscript && (
        <button
          type="button"
          disabled={disabled}
          onClick={onOpenTranscript}
          aria-label="แก้ไขสคริปต์คำแปล"
          title="แก้ไขบทแปลทั้งตอน &amp; ส่งออกแยกเลเยอร์ (Transcript)"
          className="h-10 w-10 rounded-xl flex items-center justify-center text-muted hover:text-foreground hover:bg-surface-hover transition-colors disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <FileText className="w-5 h-5" aria-hidden="true" />
        </button>
      )}

      {/* 6.8 Glossary Manager */}
      {onOpenGlossary && (
        <button
          type="button"
          disabled={disabled}
          onClick={onOpenGlossary}
          aria-label="คลังคำศัพท์เฉพาะเรื่อง"
          title="คลังคำศัพท์เฉพาะเรื่อง &amp; ล็อกชื่อตัวละคร (Glossary)"
          className="h-10 w-10 rounded-xl flex items-center justify-center text-muted hover:text-foreground hover:bg-surface-hover transition-colors disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <BookText className="w-5 h-5" aria-hidden="true" />
        </button>
      )}

      {/* 7. Keyboard Shortcuts Guide */}
      <button
        type="button"
        onClick={onOpenShortcuts}
        aria-label="ดูคีย์ลัด"
        title="คีย์ลัดการใช้งาน (Keyboard Shortcuts)"
        className="h-10 w-10 rounded-xl flex items-center justify-center text-muted hover:text-foreground hover:bg-surface-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Keyboard className="w-5 h-5" aria-hidden="true" />
      </button>
    </div>
  );
}
