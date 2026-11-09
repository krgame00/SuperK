"use client";

import { useState, useEffect, useRef, useCallback, type ReactElement } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Copy,
  Italic,
  Sparkles,
  Trash2,
  Type,
  Upload,
} from "lucide-react";
import type { TextLayer } from "@/lib/editing/commands";
import {
  TYPOGRAPHY_PRESETS,
  detectActiveTypographyPreset,
} from "@/lib/editing/typographyPresets";
import {
  BUILTIN_MANGA_FONTS,
  listCustomFonts,
  registerCustomFontFromFile,
  subscribeCustomFonts,
  type CustomUploadedFont,
} from "@/lib/customFonts";

export interface TextPropertiesPanelProps {
  layer: TextLayer | null;
  onChange: (updates: Partial<TextLayer>) => void;
  onDelete?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  scope?: "this-page" | "all-pages";
  onScopeChange?: (scope: "this-page" | "all-pages") => void;
  onBatchApplyTypography?: (updates: { fontFamily?: string; isBold?: boolean; isItalic?: boolean }) => void;
  onAutoFitBubble?: () => void;
}

const FONT_OPTIONS = [
  { id: "Itim, sans-serif", label: "Manga (Itim) — ค่าเริ่มต้น" },
  { id: "Prompt, sans-serif", label: "Prompt (คมชัด/โมเดิร์น)" },
  { id: "Kanit, sans-serif", label: "Kanit (มาตรฐานซับ)" },
  { id: "Sarabun, sans-serif", label: "Sarabun (ทางการ)" },
  { id: "Chakra Petch, sans-serif", label: "Chakra Petch (ไซไฟ/เหลี่ยม)" },
  { id: "Mali, sans-serif", label: "Mali (ลายมือใสๆ)" },
  { id: "Sriracha, sans-serif", label: "Sriracha (พู่กันโชเน็น)" },
];

export function TextPropertiesPanel({
  layer,
  onChange,
  onDelete,
  onDuplicate,
  scope = "this-page",
  onScopeChange,
  onBatchApplyTypography,
  onAutoFitBubble,
}: TextPropertiesPanelProps): ReactElement | null {
  const [activeTab, setActiveTab] = useState<"typography" | "appearance" | "box">("typography");
  const [customFonts, setCustomFonts] = useState<CustomUploadedFont[]>([]);
  const fontUploadInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void listCustomFonts().then(setCustomFonts);
    return subscribeCustomFonts(() => {
      void listCustomFonts().then(setCustomFonts);
    });
  }, []);

  const handleUploadFont = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const registered = await registerCustomFontFromFile(file);
        const nextFont = registered.cssValue;
        onChange({ fontFamily: nextFont });
        if (scope === "all-pages" && onBatchApplyTypography) {
          onBatchApplyTypography({ fontFamily: nextFont });
        }
      } catch (err) {
        console.error("Failed to upload custom font", err);
      } finally {
        e.target.value = "";
      }
    },
    [onChange, onBatchApplyTypography, scope],
  );

  const activePresetId = layer ? detectActiveTypographyPreset(layer) : null;
  const activePreset = TYPOGRAPHY_PRESETS.find((p) => p.id === activePresetId);

  if (!layer) return null;

  return (
    <aside
      aria-label="คุณสมบัติข้อความ"
      data-testid="text-properties-panel"
      data-inspector-panel="true"
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
              className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-lg hover:bg-surface-hover text-muted hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
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
              className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-lg hover:bg-red-500/20 text-red-400 hover:text-red-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 cursor-pointer"
              title="ลบกล่องข้อความ"
              aria-label="ลบกล่องข้อความ"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 1-Click Typography Presets */}
      <div className="flex flex-col gap-1.5 pb-2 border-b border-surface-hover/60">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-muted">สไตล์คำพูดสำเร็จรูป</span>
          {activePreset && (
            <span className="text-[10px] text-primary font-medium flex items-center gap-1">
              <span>{activePreset.emoji}</span>
              <span>{activePreset.nameTh}</span>
            </span>
          )}
        </div>
        <div className="grid grid-cols-5 gap-1" role="group" aria-label="สไตล์คำพูดสำเร็จรูป">
          {TYPOGRAPHY_PRESETS.map((preset) => {
            const isSelected = activePresetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  onChange(preset.style);
                  if (scope === "all-pages" && onBatchApplyTypography) {
                    onBatchApplyTypography({
                      fontFamily: preset.style.fontFamily,
                      isBold: preset.style.isBold,
                      isItalic: preset.style.isItalic,
                    });
                  }
                }}
                title={`${preset.nameTh} (${preset.name}): ${preset.description}`}
                aria-label={`ใช้สไตล์ ${preset.nameTh}`}
                aria-pressed={isSelected}
                className={`flex flex-col items-center justify-center py-1.5 px-0.5 rounded-lg border transition-all cursor-pointer text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  isSelected
                    ? "border-primary bg-primary/15 text-primary shadow-xs font-semibold ring-1 ring-primary/40"
                    : "border-surface-hover bg-background/60 hover:bg-surface-hover text-muted hover:text-foreground"
                }`}
              >
                <span className="text-sm leading-none">{preset.emoji}</span>
                <span className="text-[9px] mt-0.5 truncate max-w-full font-medium">
                  {preset.nameTh.split(" ")[0]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label="หมวดหมู่การตั้งค่าข้อความ" className="flex rounded-lg bg-surface-hover/50 p-0.5 text-[11px] font-medium">
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
            <div className="flex items-center justify-between gap-1">
              <label htmlFor="text-font-family" className="text-muted text-[11px]">
                แบบอักษร
              </label>
              <button
                type="button"
                onClick={() => fontUploadInputRef.current?.click()}
                className="text-[10px] text-primary hover:underline flex items-center gap-1 cursor-pointer"
                title="ติดตั้งฟอนต์ของคุณ (.ttf, .otf)"
                aria-label="เพิ่มแบบอักษรใหม่"
              >
                <Upload className="w-3 h-3" />
                เพิ่มฟอนต์
              </button>
              <input
                ref={fontUploadInputRef}
                type="file"
                accept=".ttf,.otf,.woff,.woff2"
                className="hidden"
                onChange={handleUploadFont}
                aria-label="เลือกไฟล์ฟอนต์"
              />
            </div>
            <select
              id="text-font-family"
              value={
                !layer.fontFamily || layer.fontFamily === "var(--font-manga)"
                  ? "Itim, sans-serif"
                  : layer.fontFamily
              }
              onChange={(e) => {
                const nextFont = e.target.value;
                onChange({ fontFamily: nextFont });
                if (scope === "all-pages" && onBatchApplyTypography) {
                  onBatchApplyTypography({ fontFamily: nextFont });
                }
              }}
              className="bg-background border border-surface-hover rounded-md px-2 py-1 text-xs focus:border-primary outline-none"
            >
              <optgroup label="🎨 แบบอักษรมังงะมาตรฐาน">
                {BUILTIN_MANGA_FONTS.map((f) => (
                  <option key={f.id} value={f.cssValue}>
                    {f.label}
                  </option>
                ))}
              </optgroup>
              {customFonts.length > 0 && (
                <optgroup label="⭐ ฟอนต์ของคุณ (Custom Fonts)">
                  {customFonts.map((cf) => (
                    <option key={cf.id} value={cf.cssValue}>
                      {cf.familyName}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          {/* Auto-Fit Button */}
          {onAutoFitBubble && (
            <button
              type="button"
              onClick={onAutoFitBubble}
              aria-label="ปรับพอดีบอลลูนอัตโนมัติ"
              title="คำนวณและปรับขนาดฟอนต์ให้พอดีรูปทรงบอลลูนอัตโนมัติ (Contour Auto-Fit)"
              className="flex items-center justify-center gap-1.5 w-full py-1.5 px-2 rounded-lg border border-primary/40 bg-primary/10 hover:bg-primary/20 text-primary text-xs font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>⚡ ปรับพอดีบอลลูน (Auto Fit)</span>
            </button>
          )}

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
                className="w-7.5 h-7.5 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg border border-surface-hover bg-background hover:bg-surface-hover text-muted hover:text-foreground text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
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
                className="w-7.5 h-7.5 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg border border-surface-hover bg-background hover:bg-surface-hover text-muted hover:text-foreground text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
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
                className={`p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:z-10 cursor-pointer ${
                  layer.align === "left" ? "bg-primary/20 text-primary" : "text-muted hover:text-foreground"
                }`}
              >
                <AlignLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onChange({ align: "center" })}
                aria-label="กึ่งกลาง"
                className={`p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:z-10 cursor-pointer ${
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
                className={`p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:z-10 cursor-pointer ${
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
                className={`p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:z-10 cursor-pointer ${
                  layer.isBold ? "bg-primary/20 text-primary" : "text-muted hover:text-foreground"
                }`}
              >
                <Bold className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onChange({ isItalic: !layer.isItalic })}
                aria-label="ตัวเอียง"
                className={`p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:z-10 cursor-pointer ${
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
        <div className="border-t border-surface-hover/60 pt-2 flex flex-col gap-2">
          <div className="flex items-center justify-between text-[11px]">
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
          {scope === "all-pages" && onBatchApplyTypography && (
            <button
              type="button"
              onClick={() =>
                onBatchApplyTypography({
                  fontFamily: layer.fontFamily,
                  isBold: layer.isBold,
                  isItalic: layer.isItalic,
                })
              }
              className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-primary/20 hover:bg-primary/30 active:scale-98 text-primary border border-primary/40 font-semibold text-xs transition-all cursor-pointer shadow-xs"
              title="กระจายแบบอักษรและสไตล์ตัวหนา/เอียงของกล่องนี้ไปยังทุกบับเบิลในทุกหน้าทั้งเล่ม"
            >
              <span>⚡ กระจายฟอนต์นี้ไปยังทุกหน้าทั้งเล่ม</span>
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
