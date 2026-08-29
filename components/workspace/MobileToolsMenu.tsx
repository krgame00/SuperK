"use client";

import type { ReactElement } from "react";
import {
  Eye,
  EyeOff,
  Flame,
  GalleryVertical,
  RectangleHorizontal,
  Redo2,
  Settings,
  Undo2,
} from "lucide-react";
import type { WorkspaceLayer } from "@/components/cleaning/CleaningToolbar";

export interface MobileToolsMenuProps {
  isOpen: boolean;
  onClose: () => void;
  pagesCount: number;
  viewLayout: "single" | "scroll";
  onToggleViewLayout: () => void;
  workspaceLayer: WorkspaceLayer;
  hasCurrentTranslation: boolean;
  onToggleOriginalTranslated: () => void;
  nsfwBypassMode: boolean;
  onToggleNsfwBypassMode: () => void;
  onOpenSettings: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export function MobileToolsMenu({
  isOpen,
  onClose,
  pagesCount,
  viewLayout,
  onToggleViewLayout,
  workspaceLayer,
  hasCurrentTranslation,
  onToggleOriginalTranslated,
  nsfwBypassMode,
  onToggleNsfwBypassMode,
  onOpenSettings,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: MobileToolsMenuProps): ReactElement | null {
  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200 xl:hidden"
        onClick={onClose}
      />
      <div
        id="mobile-tools-menu"
        role="region"
        aria-label="เมนูเครื่องมือ"
        className="absolute top-[60px] right-3 left-3 z-50 flex max-h-[calc(100vh-80px)] flex-col gap-3 overflow-y-auto rounded-xl border border-surface bg-background p-3.5 shadow-2xl animate-in fade-in slide-in-from-top-2 duration-200 sm:right-6 sm:left-auto sm:w-80 xl:hidden"
      >
        {/* ── Section: 👁️ การแสดงผล ── */}
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[10px] font-bold tracking-wider text-muted uppercase">
            👁️ การแสดงผล
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => {
                onToggleViewLayout();
                onClose();
              }}
              disabled={pagesCount === 0}
              className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border p-2.5 text-xs font-medium transition-all duration-150 ${viewLayout === "scroll" ? "border-primary/20 bg-primary/10 text-primary" : "border-transparent bg-surface text-foreground"}`}
            >
              {viewLayout === "scroll" ? (
                <GalleryVertical className="h-5 w-5" />
              ) : (
                <RectangleHorizontal className="h-5 w-5" />
              )}
              <span>{viewLayout === "scroll" ? "เลื่อนอ่าน" : "ทีละหน้า"}</span>
            </button>

            <button
              onClick={() => {
                onToggleOriginalTranslated();
                onClose();
              }}
              disabled={!hasCurrentTranslation}
              className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border p-2.5 text-xs font-medium transition-all duration-150 ${workspaceLayer === "original" ? "border-transparent bg-surface text-foreground" : "border-primary/20 bg-primary/10 text-primary"}`}
            >
              {workspaceLayer === "original" ? (
                <Eye className="h-5 w-5" />
              ) : (
                <EyeOff className="h-5 w-5" />
              )}
              <span>
                {workspaceLayer === "original" ? "แสดงคำแปล" : "ดูต้นฉบับ"}
              </span>
            </button>
          </div>
        </div>

        {/* ── Section: ⚙️ ตั้งค่า ── */}
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[10px] font-bold tracking-wider text-muted uppercase">
            ⚙️ ตั้งค่า
          </div>
          <div className="flex flex-col gap-1.5">
            <button
              onClick={() => {
                onToggleNsfwBypassMode();
                onClose();
              }}
              className={`flex w-full items-center gap-3 rounded-lg border p-2.5 text-sm font-medium transition-all duration-150 ${nsfwBypassMode ? "border-red-500/20 bg-red-500/10 text-red-400 shadow-[0_0_10px_rgba(239,68,68,0.1)]" : "border-transparent bg-surface text-foreground"}`}
            >
              <Flame className="h-5 w-5" />
              <span>18+ Bypass Mode</span>
              {nsfwBypassMode && (
                <span className="ml-auto rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-400">
                  ON
                </span>
              )}
            </button>

            <button
              onClick={() => {
                onOpenSettings();
                onClose();
              }}
              className="flex w-full items-center gap-3 rounded-lg border border-transparent bg-surface p-2.5 text-sm font-medium text-foreground"
            >
              <Settings className="h-5 w-5" />
              <span>API Key & ฟอนต์</span>
            </button>
          </div>
        </div>

        {/* ── Section: ↩️ ย้อนกลับ ── */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className="flex items-center justify-center gap-2 rounded-lg border border-transparent bg-surface p-2.5 text-sm font-medium text-foreground disabled:opacity-25"
          >
            <Undo2 className="h-4 w-4" /> ย้อนกลับ
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            className="flex items-center justify-center gap-2 rounded-lg border border-transparent bg-surface p-2.5 text-sm font-medium text-foreground disabled:opacity-25"
          >
            <Redo2 className="h-4 w-4" /> ทำซ้ำ
          </button>
        </div>
      </div>
    </>
  );
}
