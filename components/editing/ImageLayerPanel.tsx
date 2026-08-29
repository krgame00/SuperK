"use client";

import { type ReactElement } from "react";
import { FlipHorizontal, FlipVertical, Image as ImageIcon, Trash2 } from "lucide-react";
import type { ImageLayer } from "@/lib/editing/commands";

export interface ImageLayerPanelProps {
  layer: ImageLayer | null;
  onChange: (updates: Partial<ImageLayer>) => void;
  onDelete?: (id: string) => void;
}

export function ImageLayerPanel({
  layer,
  onChange,
  onDelete,
}: ImageLayerPanelProps): ReactElement | null {
  if (!layer) return null;

  return (
    <aside
      aria-label="แผงควบคุมเลเยอร์รูปภาพ"
      className="flex flex-col gap-3 bg-surface/90 backdrop-blur-md border border-surface-hover rounded-xl p-3 shadow-xl w-64 text-foreground select-none text-xs"
    >
      <div className="flex items-center justify-between border-b border-surface-hover/60 pb-2">
        <div className="flex items-center gap-1.5 font-medium text-sm">
          <ImageIcon className="w-4 h-4 text-primary" />
          <span>เลเยอร์รูปภาพ</span>
        </div>
        {onDelete && (
          <button
            type="button"
            onClick={() => onDelete(layer.id)}
            className="p-1 rounded hover:bg-red-500/20 text-red-400 hover:text-red-300 transition-colors"
            title="ลบเลเยอร์รูปนี้"
            aria-label="ลบเลเยอร์รูปนี้"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        {/* Opacity */}
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="img-opacity" className="text-muted text-[11px]">
            ความโปร่งใส
          </label>
          <div className="flex items-center gap-2">
            <input
              id="img-opacity"
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

        {/* Flip Buttons */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-muted text-[11px]">กลับด้านภาพ</span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => onChange({ flipX: !layer.flipX })}
              aria-label="กลับด้านแนวนอน"
              className={`p-1.5 rounded border border-surface-hover transition-colors ${
                layer.flipX ? "bg-primary/20 text-primary" : "text-muted hover:text-foreground bg-background"
              }`}
              title="กลับด้านแนวนอน (Flip Horizontal)"
            >
              <FlipHorizontal className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onChange({ flipY: !layer.flipY })}
              aria-label="กลับด้านแนวตั้ง"
              className={`p-1.5 rounded border border-surface-hover transition-colors ${
                layer.flipY ? "bg-primary/20 text-primary" : "text-muted hover:text-foreground bg-background"
              }`}
              title="กลับด้านแนวตั้ง (Flip Vertical)"
            >
              <FlipVertical className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
