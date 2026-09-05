"use client";

import { useState, type ReactElement } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Copy,
  Italic,
  Trash2,
  Type,
} from "lucide-react";
import type { TextLayer } from "@/lib/editing/commands";

export interface TextPropertiesPanelProps {
  layer: TextLayer | null;
  onChange: (updates: Partial<TextLayer>) => void;
  onDelete?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  scope?: "this-page" | "all-pages";
  onScopeChange?: (scope: "this-page" | "all-pages") => void;
}

const FONT_OPTIONS = [
  { id: "var(--font-manga)", label: "Manga (Noto Sans Thai)" },
  { id: "Prompt, sans-serif", label: "Prompt" },
  { id: "Kanit, sans-serif", label: "Kanit" },
  { id: "Sarabun, sans-serif", label: "Sarabun" },
  { id: "Chakra Petch, sans-serif", label: "Chakra Petch" },
];

export function TextPropertiesPanel({
  layer,
  onChange,
  onDelete,
  onDuplicate,
  scope = "this-page",
  onScopeChange,
}: TextPropertiesPanelProps): ReactElement | null {
  const [activeTab, setActiveTab] = useState<"typography" | "appearance" | "box">("typography");

  if (!layer) return null;

  return (
    <aside
      aria-label="คุณสมบัติข้อความ"
      className="flex flex-col gap-3 bg-surface/90 backdrop-blur-md border border-surface-hover rounded-xl p-3 shadow-xl w-64 sm:w-72 text-foreground select-none text-xs"
    >
      {/* Header & Quick Action Buttons */}
      <div className="flex items-center justify-between border-b border-surface-hover/60 pb-2">
        <div className="flex items-center gap-1.5 font-medium text-sm">
          <Type className="w-5 h-5 text-primary" />
          <span>แก้ไขข้อความ</span>
        </div>
        <div className="flex items-center gap-1">
          {onDuplicate && (
            <button
              type="button"
              onClick={() => onDuplicate(layer.id)}
              className="p-1 rounded hover:bg-surface-hover text-muted hover:text-foreground transition-colors"
              title="คัดลอกกล่องนี้"
              aria-label="คัดลอกกล่อง"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(layer.id)}
              className="p-1 rounded hover:bg-red-500/20 text-red-400 hover:text-red-300 transition-colors"
              title="ลบกล่องข้อความ"
              aria-label="ลบกล่องข้อความ"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex rounded-lg bg-surface-hover/50 p-0.5 text-[11px] font-medium">
        <button
          type="button"
          onClick={() => setActiveTab("typography")}
          className={`flex-1 py-1 rounded-md transition-colors ${
            activeTab === "typography"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted hover:text-foreground"
          }`}
        >
          ฟอนต์
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("appearance")}
          className={`flex-1 py-1 rounded-md transition-colors ${
            activeTab === "appearance"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted hover:text-foreground"
          }`}
        >
          สี & ขอบ
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("box")}
          className={`flex-1 py-1 rounded-md transition-colors ${
            activeTab === "box"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted hover:text-foreground"
          }`}
        >
          กล่องพื้นหลัง
        </button>
      </div>

      {/* Tab: Typography */}
      {activeTab === "typography" && (
        <div className="flex flex-col gap-2.5">
          {/* Font Family */}
          <div className="flex flex-col gap-1">
            <label htmlFor="text-font-family" className="text-muted text-[11px]">
              แบบอักษร
            </label>
            <select
              id="text-font-family"
              value={layer.fontFamily || "var(--font-manga)"}
              onChange={(e) => onChange({ fontFamily: e.target.value })}
              className="bg-background border border-surface-hover rounded-md px-2 py-1 text-xs focus:border-primary outline-none"
            >
              {FONT_OPTIONS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          {/* Font Size */}
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="text-font-size" className="text-muted text-[11px] flex-shrink-0">
              ขนาดฟอนต์
            </label>
            <div className="flex items-center gap-1.5 flex-1 justify-end">
              <button
                type="button"
                onClick={() => onChange({ fontSize: Math.max(8, (layer.fontSize || 20) - 2) })}
                aria-label="ลดขนาดฟอนต์"
                title="ลดขนาดฟอนต์ (-2)"
                className="w-7 h-7 flex items-center justify-center rounded border border-surface-hover bg-background hover:bg-surface-hover text-muted hover:text-foreground text-sm font-semibold transition-colors"
              >
                -
              </button>
              <input
                type="range"
                min="10"
                max="72"
                value={layer.fontSize || 20}
                onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
                className="w-20 accent-primary"
              />
              <button
                type="button"
                onClick={() => onChange({ fontSize: Math.min(120, (layer.fontSize || 20) + 2) })}
                aria-label="เพิ่มขนาดฟอนต์"
                title="เพิ่มขนาดฟอนต์ (+2)"
                className="w-7 h-7 flex items-center justify-center rounded border border-surface-hover bg-background hover:bg-surface-hover text-muted hover:text-foreground text-sm font-semibold transition-colors"
              >
                +
              </button>
              <input
                id="text-font-size"
                aria-label="ขนาดฟอนต์"
                type="number"
                min="8"
                max="120"
                value={layer.fontSize || 20}
                onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
                className="w-12 bg-background border border-surface-hover rounded px-1.5 py-0.5 text-center text-xs"
              />
            </div>
          </div>

          {/* Alignment & Style Buttons */}
          <div className="flex items-center justify-between gap-1 pt-1">
            <div className="flex rounded-md border border-surface-hover overflow-hidden bg-background">
              <button
                type="button"
                onClick={() => onChange({ align: "left" })}
                aria-label="ชิดซ้าย"
                className={`p-1.5 transition-colors ${
                  layer.align === "left" ? "bg-primary/20 text-primary" : "text-muted hover:text-foreground"
                }`}
              >
                <AlignLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onChange({ align: "center" })}
                aria-label="กึ่งกลาง"
                className={`p-1.5 transition-colors ${
                  (layer.align ?? "center") === "center"
                    ? "bg-primary/20 text-primary"
                    : "text-muted hover:text-foreground"
                }`}
              >
                <AlignCenter className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onChange({ align: "right" })}
                aria-label="ชิดขวา"
                className={`p-1.5 transition-colors ${
                  layer.align === "right" ? "bg-primary/20 text-primary" : "text-muted hover:text-foreground"
                }`}
              >
                <AlignRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex rounded-md border border-surface-hover overflow-hidden bg-background">
              <button
                type="button"
                onClick={() => onChange({ isBold: !layer.isBold })}
                aria-label="ตัวหนา"
                className={`p-1.5 transition-colors ${
                  layer.isBold ? "bg-primary/20 text-primary" : "text-muted hover:text-foreground"
                }`}
              >
                <Bold className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onChange({ isItalic: !layer.isItalic })}
                aria-label="ตัวเอียง"
                className={`p-1.5 transition-colors ${
                  layer.isItalic ? "bg-primary/20 text-primary" : "text-muted hover:text-foreground"
                }`}
              >
                <Italic className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Appearance (Colors & Strokes) */}
      {activeTab === "appearance" && (
        <div className="flex flex-col gap-2.5">
          {/* Text Color */}
          <div className="flex items-center justify-between">
            <label htmlFor="text-color" className="text-muted text-[11px]">
              สีข้อความ
            </label>
            <div className="flex items-center gap-1.5">
              <input
                id="text-color"
                aria-label="สีข้อความ"
                type="color"
                value={layer.color || "#000000"}
                onChange={(e) => onChange({ color: e.target.value })}
                className="w-7 h-7 rounded border border-surface-hover cursor-pointer p-0 bg-transparent"
              />
              <span className="font-mono text-[10px] text-muted">{layer.color || "#000000"}</span>
            </div>
          </div>

          {/* Stroke Color & Width */}
          <div className="flex items-center justify-between">
            <label htmlFor="text-stroke-color" className="text-muted text-[11px]">
              สีขอบตัวอักษร
            </label>
            <div className="flex items-center gap-1.5">
              <input
                id="text-stroke-color"
                aria-label="สีขอบตัวอักษร"
                type="color"
                value={layer.strokeColor || "#ffffff"}
                onChange={(e) => onChange({ strokeColor: e.target.value })}
                className="w-7 h-7 rounded border border-surface-hover cursor-pointer p-0 bg-transparent"
              />
              <span className="font-mono text-[10px] text-muted">{layer.strokeColor || "#ffffff"}</span>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <label htmlFor="text-stroke-width" className="text-muted text-[11px]">
              ความหนาขอบ
            </label>
            <div className="flex items-center gap-2">
              <input
                id="text-stroke-width"
                aria-label="ความหนาขอบ"
                type="range"
                min="0"
                max="10"
                value={layer.strokeWidth || 0}
                onChange={(e) => onChange({ strokeWidth: Number(e.target.value) })}
                className="w-24 accent-primary"
              />
              <span className="w-6 text-right text-[11px] font-mono">{layer.strokeWidth || 0}px</span>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Box Background */}
      {activeTab === "box" && (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <label htmlFor="text-box-fill" className="text-muted text-[11px]">
              สีพื้นหลังกล่อง
            </label>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onChange({ boxFill: undefined })}
                className="text-[10px] text-muted hover:text-foreground underline"
              >
                โปร่งใส
              </button>
              <input
                id="text-box-fill"
                aria-label="สีพื้นหลังกล่อง"
                type="color"
                value={layer.boxFill || "#ffffff"}
                onChange={(e) => onChange({ boxFill: e.target.value })}
                className="w-7 h-7 rounded border border-surface-hover cursor-pointer p-0 bg-transparent"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <label htmlFor="text-opacity" className="text-muted text-[11px]">
              ความโปร่งใส (Opacity)
            </label>
            <div className="flex items-center gap-2">
              <input
                id="text-opacity"
                aria-label="ความโปร่งใส"
                type="range"
                min="0.1"
                max="1"
                step="0.05"
                value={layer.opacity ?? 1}
                onChange={(e) => onChange({ opacity: Number(e.target.value) })}
                className="w-24 accent-primary"
              />
              <span className="w-8 text-right text-[11px] font-mono">
                {Math.round((layer.opacity ?? 1) * 100)}%
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Scope Selector */}
      {onScopeChange && (
        <div className="border-t border-surface-hover/60 pt-2 flex items-center justify-between text-[11px]">
          <span className="text-muted">ขอบเขตการแก้ไข:</span>
          <select
            value={scope}
            onChange={(e) => onScopeChange(e.target.value as "this-page" | "all-pages")}
            className="bg-background border border-surface-hover rounded px-1.5 py-0.5 text-[11px]"
          >
            <option value="this-page">เฉพาะหน้านี้</option>
            <option value="all-pages">ทุกหน้าทั้งเล่ม</option>
          </select>
        </div>
      )}
    </aside>
  );
}
