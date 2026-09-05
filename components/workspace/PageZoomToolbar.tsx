"use client";

import { useState, useRef, useEffect, type ReactElement } from "react";
import { ZoomIn, ZoomOut, Maximize2, Check, ChevronUp, Expand, Minimize2 } from "lucide-react";

export interface PageZoomToolbarProps {
  viewLayout: "single" | "scroll";
  scale: number;
  displayPercentage: number;
  isFit: boolean;
  scrollZoomMode: "fit-width" | "actual-size";
  disabled?: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomTo: (scale: number) => void;
  onResetToFit: () => void;
  onToggleScrollZoomMode: () => void;
  isFocusMode?: boolean;
  onToggleFocusMode?: () => void;
}

const PRESET_OPTIONS = [
  { label: "พอดีหน้าจอ", scale: -1 }, // -1 sentinel for fit
  { label: "50%", scale: 0.5 },
  { label: "100%", scale: 1.0 },
  { label: "200%", scale: 2.0 },
  { label: "400%", scale: 4.0 },
];

export function PageZoomToolbar({
  viewLayout,
  scale,
  displayPercentage,
  isFit,
  scrollZoomMode,
  disabled = false,
  onZoomIn,
  onZoomOut,
  onZoomTo,
  onResetToFit,
  onToggleScrollZoomMode,
  isFocusMode = false,
  onToggleFocusMode,
}: PageZoomToolbarProps): ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click or Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  if (viewLayout === "scroll") {
    return (
      <div
        role="toolbar"
        aria-label="เครื่องมือปรับขนาดการแสดงผลต่อเนื่อง"
        className="absolute bottom-4 right-4 z-20 flex items-center bg-surface/90 backdrop-blur-md border border-border/80 rounded-xl p-1 shadow-lg select-none"
      >
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (scrollZoomMode !== "fit-width") onToggleScrollZoomMode();
          }}
          aria-label="พอดีความกว้าง"
          aria-pressed={scrollZoomMode === "fit-width"}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
            scrollZoomMode === "fit-width"
              ? "bg-primary text-white shadow-xs"
              : "text-muted hover:text-foreground hover:bg-white/5"
          }`}
        >
          พอดีความกว้าง
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (scrollZoomMode !== "actual-size") onToggleScrollZoomMode();
          }}
          aria-label="ขนาดจริง (100%)"
          aria-pressed={scrollZoomMode === "actual-size"}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
            scrollZoomMode === "actual-size"
              ? "bg-primary text-white shadow-xs"
              : "text-muted hover:text-foreground hover:bg-white/5"
          }`}
        >
          ขนาดจริง (100%)
        </button>
        {onToggleFocusMode && (
          <>
            <div className="w-px h-4 bg-border/60 mx-1" />
            <button
              type="button"
              onClick={onToggleFocusMode}
              aria-label={isFocusMode ? "ออกจากโหมดโฟกัส (Esc หรือ F)" : "เปิดโหมดโฟกัส (F)"}
              aria-pressed={isFocusMode}
              title={isFocusMode ? "Exit Focus Mode (Esc / F)" : "Focus Mode (F)"}
              className={`flex h-7 w-7 items-center justify-center rounded-lg transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                isFocusMode
                  ? "text-primary bg-primary/20 font-semibold"
                  : "text-muted hover:text-foreground hover:bg-white/10"
              }`}
            >
              {isFocusMode ? (
                <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <Expand className="w-3.5 h-3.5" aria-hidden="true" />
              )}
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div
      ref={menuRef}
      role="toolbar"
      aria-label="เครื่องมือซูมและย่อขยายภาพ"
      className="absolute bottom-4 right-4 z-20 flex items-center bg-surface/90 backdrop-blur-md border border-border/80 rounded-xl p-1 shadow-lg gap-0.5 select-none"
    >
      {/* Zoom Out Button */}
      <button
        type="button"
        disabled={disabled || scale <= 0.25}
        onClick={onZoomOut}
        aria-label="ซูมออก"
        title="ซูมออก (-)"
        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-white/10 active:scale-95 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <ZoomOut className="w-4 h-4" aria-hidden="true" />
      </button>

      {/* Percentage / Preset Menu Trigger */}
      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setIsOpen((prev) => !prev)}
          aria-label={`ระดับการซูม ${displayPercentage} เปอร์เซ็นต์`}
          aria-haspopup="true"
          aria-expanded={isOpen}
          title="เลือกระดับการซูม"
          className="flex h-8 items-center gap-1 px-2.5 rounded-lg text-xs font-medium text-foreground hover:bg-white/10 active:scale-95 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span>{displayPercentage}%</span>
          <ChevronUp
            className={`w-3 h-3 text-muted transition-transform duration-150 ${
              isOpen ? "rotate-180" : ""
            }`}
            aria-hidden="true"
          />
        </button>

        {/* Dropdown Menu */}
        {isOpen && (
          <div
            role="menu"
            aria-label="ตัวเลือกระดับการซูม"
            className="absolute bottom-full right-0 mb-2 w-36 bg-surface/95 backdrop-blur-md border border-border rounded-xl p-1 shadow-xl z-30 animate-in fade-in zoom-in-95 duration-150 flex flex-col gap-0.5"
          >
            {PRESET_OPTIONS.map((option) => {
              const isSelected =
                option.scale === -1
                  ? isFit
                  : Math.abs(scale - option.scale) < 0.05 && !isFit;

              return (
                <button
                  key={option.label}
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    if (option.scale === -1) {
                      onResetToFit();
                    } else {
                      onZoomTo(option.scale);
                    }
                    setIsOpen(false);
                  }}
                  className={`flex items-center justify-between px-3 py-1.5 text-xs rounded-lg transition-colors cursor-pointer text-left ${
                    isSelected
                      ? "bg-primary/20 text-primary font-semibold"
                      : "text-foreground hover:bg-white/10"
                  }`}
                >
                  <span>{option.label}</span>
                  {isSelected && <Check className="w-3.5 h-3.5 text-primary" />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Zoom In Button */}
      <button
        type="button"
        disabled={disabled || scale >= 4.0}
        onClick={onZoomIn}
        aria-label="ซูมเข้า"
        title="ซูมเข้า (+)"
        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-white/10 active:scale-95 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <ZoomIn className="w-4 h-4" aria-hidden="true" />
      </button>

      {/* Fit / Reset Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={onResetToFit}
        aria-label="พอดีหน้าจอ"
        aria-pressed={isFit}
        title="พอดีหน้าจอ (0)"
        className={`flex h-8 w-8 items-center justify-center rounded-lg transition-all active:scale-95 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          isFit
            ? "text-primary bg-primary/15 font-semibold"
            : "text-muted hover:text-foreground hover:bg-white/10"
        }`}
      >
        <Maximize2 className="w-4 h-4" aria-hidden="true" />
      </button>

      {onToggleFocusMode && (
        <>
          <div className="w-px h-4 bg-border/60 mx-0.5" />
          <button
            type="button"
            onClick={onToggleFocusMode}
            aria-label={isFocusMode ? "ออกจากโหมดโฟกัส (Esc หรือ F)" : "เปิดโหมดโฟกัส (F)"}
            aria-pressed={isFocusMode}
            title={isFocusMode ? "Exit Focus Mode (Esc / F)" : "Focus Mode (F)"}
            className={`flex h-8 w-8 items-center justify-center rounded-lg transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              isFocusMode
                ? "text-primary bg-primary/20 font-semibold"
                : "text-muted hover:text-foreground hover:bg-white/10"
            }`}
          >
            {isFocusMode ? (
              <Minimize2 className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Expand className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
        </>
      )}

      {/* Screen Reader Announcement */}
      <div className="sr-only" aria-live="polite">
        ระดับการซูม {displayPercentage} เปอร์เซ็นต์
      </div>
    </div>
  );
}
