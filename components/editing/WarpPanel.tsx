"use client";

import { type ReactElement } from "react";
import { Sparkles, Undo } from "lucide-react";
import type { WarpEffect, WarpSettings } from "@/lib/editing/commands";

export interface WarpPanelProps {
  warp?: WarpSettings;
  onChange: (updates: Partial<WarpSettings>) => void;
  onReset: () => void;
}

const WARP_EFFECTS: { id: WarpEffect; label: string }[] = [
  { id: "none", label: "ไม่มี (None)" },
  { id: "arch", label: "ส่วนโค้ง (Arch)" },
  { id: "perspective", label: "เปอร์สเปกทีฟ (Perspective)" },
  { id: "bulge", label: "โป่งพอง (Bulge)" },
  { id: "wave", label: "คลื่น (Wave)" },
  { id: "squeeze", label: "บีบอัด (Squeeze)" },
  { id: "twist", label: "บิดเกลียว (Twist)" },
  { id: "fish", label: "ตาปลา (Fish Eye)" },
];

export function WarpPanel({
  warp = { effect: "none", bend: 0, horizontal: 0, vertical: 0 },
  onChange,
  onReset,
}: WarpPanelProps): ReactElement {
  return (
    <aside
      aria-label="แผงดัดตัวอักษรและรูปภาพ"
      className="flex flex-col gap-3 bg-surface/90 backdrop-blur-md border border-surface-hover rounded-xl p-3 shadow-xl w-64 text-foreground select-none text-xs"
    >
      <div className="flex items-center justify-between border-b border-surface-hover/60 pb-2">
        <div className="flex items-center gap-1.5 font-medium text-sm">
          <Sparkles className="w-5 h-5 text-primary" />
          <span>ดัดรูปทรง (Warp)</span>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="p-1 rounded hover:bg-surface-hover text-muted hover:text-foreground transition-colors"
          title="รีเซ็ตการดัด"
          aria-label="รีเซ็ตการดัด"
        >
          <Undo className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="flex flex-col gap-1">
          <label htmlFor="warp-effect" className="text-muted text-[11px]">
            เอฟเฟกต์การดัด
          </label>
          <select
            id="warp-effect"
            aria-label="เอฟเฟกต์การดัด"
            value={warp.effect || "none"}
            onChange={(e) => onChange({ effect: e.target.value as WarpEffect })}
            className="bg-background border border-surface-hover rounded-md px-2 py-1 text-xs focus:border-primary outline-none"
          >
            {WARP_EFFECTS.map((eff) => (
              <option key={eff.id} value={eff.id}>
                {eff.label}
              </option>
            ))}
          </select>
        </div>

        {warp.effect !== "none" && (
          <>
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="warp-bend" className="text-muted text-[11px]">
                ความโค้ง (Bend)
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="warp-bend"
                  aria-label="ความโค้ง (Bend)"
                  type="range"
                  min="-100"
                  max="100"
                  value={warp.bend || 0}
                  onChange={(e) => onChange({ bend: Number(e.target.value) })}
                  className="w-24 accent-primary"
                />
                <span className="w-8 text-right text-[11px] font-mono">{warp.bend || 0}%</span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <label htmlFor="warp-horizontal" className="text-muted text-[11px]">
                แนวนอน (H-Distort)
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="warp-horizontal"
                  aria-label="แนวนอน (H-Distort)"
                  type="range"
                  min="-100"
                  max="100"
                  value={warp.horizontal || 0}
                  onChange={(e) => onChange({ horizontal: Number(e.target.value) })}
                  className="w-24 accent-primary"
                />
                <span className="w-8 text-right text-[11px] font-mono">{warp.horizontal || 0}%</span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <label htmlFor="warp-vertical" className="text-muted text-[11px]">
                แนวตั้ง (V-Distort)
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="warp-vertical"
                  aria-label="แนวตั้ง (V-Distort)"
                  type="range"
                  min="-100"
                  max="100"
                  value={warp.vertical || 0}
                  onChange={(e) => onChange({ vertical: Number(e.target.value) })}
                  className="w-24 accent-primary"
                />
                <span className="w-8 text-right text-[11px] font-mono">{warp.vertical || 0}%</span>
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
