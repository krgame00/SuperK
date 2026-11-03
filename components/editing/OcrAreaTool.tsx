"use client";

import { useState, useEffect, useRef, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { ScanText, X, Sparkles, Loader2, Move } from "lucide-react";

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrAreaToolProps {
  active: boolean;
  onDetectRegion: (rect: PixelRect) => void | Promise<void>;
  onClose: () => void;
  loading?: boolean;
}

export function OcrAreaTool({
  active,
  onDetectRegion,
  onClose,
  loading = false,
}: OcrAreaToolProps): ReactElement | null {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [rect, setRect] = useState<PixelRect>({
    x: 50,
    y: 50,
    width: 250,
    height: 120,
  });
  const naturalDimensionsRef = useRef<{ width: number; height: number }>({
    width: 1000,
    height: 1500,
  });

  // Find and attach to #pageContainer when active
  useEffect(() => {
    if (!active || typeof document === "undefined") {
      setContainer(null);
      return;
    }

    const pageContainerEl = document.getElementById("pageContainer");
    if (!pageContainerEl) return;

    setContainer(pageContainerEl);

    // Get image natural dimensions
    const imgEl = pageContainerEl.querySelector("img");
    const nw = imgEl?.naturalWidth || pageContainerEl.clientWidth || 1000;
    const nh = imgEl?.naturalHeight || pageContainerEl.clientHeight || 1500;
    naturalDimensionsRef.current = { width: nw, height: nh };

    // Initial position: center-ish, comfortable size for a manga speech bubble
    const initW = Math.max(140, Math.min(360, Math.round(nw * 0.35)));
    const initH = Math.max(100, Math.min(260, Math.round(nh * 0.2)));
    const initX = Math.round((nw - initW) / 2);
    const initY = Math.round((nh - initH) * 0.35);

    setRect({
      x: initX,
      y: initY,
      width: initW,
      height: initH,
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active, onClose]);

  if (!active) return null;

  const nw = naturalDimensionsRef.current.width;
  const nh = naturalDimensionsRef.current.height;

  // Move drag handler
  const handleBoxPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).dataset.handle) return;
    e.stopPropagation();
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startRect = { ...rect };

    const cRect = container ? container.getBoundingClientRect() : null;
    const scale = cRect && nw > 0 ? cRect.width / nw : 1;

    const onPointerMove = (moveEv: PointerEvent) => {
      const dx = (moveEv.clientX - startClientX) / scale;
      const dy = (moveEv.clientY - startClientY) / scale;
      setRect({
        ...startRect,
        x: Math.max(0, Math.min(nw - startRect.width, Math.round(startRect.x + dx))),
        y: Math.max(0, Math.min(nh - startRect.height, Math.round(startRect.y + dy))),
      });
    };

    const onPointerUp = () => {
      target.removeEventListener("pointermove", onPointerMove);
      target.removeEventListener("pointerup", onPointerUp);
      target.removeEventListener("pointercancel", onPointerUp);
    };

    target.addEventListener("pointermove", onPointerMove);
    target.addEventListener("pointerup", onPointerUp);
    target.addEventListener("pointercancel", onPointerUp);
  };

  // Resize drag handler
  const handleResizePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    handle: "nw" | "ne" | "sw" | "se",
  ) => {
    e.stopPropagation();
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startRect = { ...rect };

    const cRect = container ? container.getBoundingClientRect() : null;
    const scale = cRect && nw > 0 ? cRect.width / nw : 1;

    const onPointerMove = (moveEv: PointerEvent) => {
      const dx = (moveEv.clientX - startClientX) / scale;
      const dy = (moveEv.clientY - startClientY) / scale;
      let newX = startRect.x;
      let newY = startRect.y;
      let newW = startRect.width;
      let newH = startRect.height;

      if (handle === "se") {
        newW = Math.max(40, Math.round(startRect.width + dx));
        newH = Math.max(30, Math.round(startRect.height + dy));
      } else if (handle === "sw") {
        const potW = Math.max(40, Math.round(startRect.width - dx));
        newX = Math.round(startRect.x + (startRect.width - potW));
        newW = potW;
        newH = Math.max(30, Math.round(startRect.height + dy));
      } else if (handle === "ne") {
        newW = Math.max(40, Math.round(startRect.width + dx));
        const potH = Math.max(30, Math.round(startRect.height - dy));
        newY = Math.round(startRect.y + (startRect.height - potH));
        newH = potH;
      } else if (handle === "nw") {
        const potW = Math.max(40, Math.round(startRect.width - dx));
        newX = Math.round(startRect.x + (startRect.width - potW));
        newW = potW;
        const potH = Math.max(30, Math.round(startRect.height - dy));
        newY = Math.round(startRect.y + (startRect.height - potH));
        newH = potH;
      }

      setRect({
        x: Math.max(0, Math.min(nw - 40, newX)),
        y: Math.max(0, Math.min(nh - 30, newY)),
        width: Math.min(nw - newX, newW),
        height: Math.min(nh - newY, newH),
      });
    };

    const onPointerUp = () => {
      target.removeEventListener("pointermove", onPointerMove);
      target.removeEventListener("pointerup", onPointerUp);
      target.removeEventListener("pointercancel", onPointerUp);
    };

    target.addEventListener("pointermove", onPointerMove);
    target.addEventListener("pointerup", onPointerUp);
    target.addEventListener("pointercancel", onPointerUp);
  };

  const portalBox = container
    ? createPortal(
        <div
          data-ocr-selection-box="true"
          style={{
            position: "absolute",
            left: `${rect.x}px`,
            top: `${rect.y}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
            zIndex: 48,
            cursor: "move",
          }}
          className="border-2 border-dashed border-primary bg-primary/15 backdrop-blur-[0.5px] rounded-lg shadow-[0_0_24px_rgba(var(--primary-rgb),0.55)] flex flex-col justify-between p-1.5 select-none pointer-events-auto"
          onPointerDown={handleBoxPointerDown}
        >
          {/* Top Label & Move icon */}
          <div className="flex items-center gap-1.5 pointer-events-none text-[11px] font-bold text-primary-content bg-primary/95 px-2 py-0.5 rounded-md shadow-xs w-fit">
            <Move className="w-3 h-3" />
            <span>ลากย้ายกรอบ / ย่อ-ขยายที่มุม</span>
          </div>

          {/* Bottom Dimensions badge */}
          <div className="self-end pointer-events-none text-[10px] font-mono text-white/90 bg-black/75 px-1.5 py-0.5 rounded shadow-xs">
            {Math.round(rect.width)} × {Math.round(rect.height)} px
          </div>

          {/* 4 Corner Resize Handles */}
          <div
            data-handle="nw"
            onPointerDown={(e) => handleResizePointerDown(e, "nw")}
            className="absolute -top-2 -left-2 w-4 h-4 bg-surface border-2 border-primary rounded-sm cursor-nwse-resize shadow-lg hover:scale-125 transition-transform"
            title="ปรับขนาด (บน-ซ้าย)"
          />
          <div
            data-handle="ne"
            onPointerDown={(e) => handleResizePointerDown(e, "ne")}
            className="absolute -top-2 -right-2 w-4 h-4 bg-surface border-2 border-primary rounded-sm cursor-nesw-resize shadow-lg hover:scale-125 transition-transform"
            title="ปรับขนาด (บน-ขวา)"
          />
          <div
            data-handle="sw"
            onPointerDown={(e) => handleResizePointerDown(e, "sw")}
            className="absolute -bottom-2 -left-2 w-4 h-4 bg-surface border-2 border-primary rounded-sm cursor-nesw-resize shadow-lg hover:scale-125 transition-transform"
            title="ปรับขนาด (ล่าง-ซ้าย)"
          />
          <div
            data-handle="se"
            onPointerDown={(e) => handleResizePointerDown(e, "se")}
            className="absolute -bottom-2 -right-2 w-4 h-4 bg-surface border-2 border-primary rounded-sm cursor-nwse-resize shadow-lg hover:scale-125 transition-transform"
            title="ปรับขนาด (ล่าง-ขวา)"
          />
        </div>,
        container,
      )
    : null;

  return (
    <>
      {portalBox}

      {/* Floating Bottom Toolbar Dock */}
      <div
        role="dialog"
        aria-label="เครื่องมือเลือกพื้นที่ OCR"
        className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-surface/95 backdrop-blur-md border border-primary/40 rounded-2xl px-4 py-2.5 shadow-2xl flex items-center gap-3 text-xs text-foreground select-none motion-reduce:transition-none"
      >
        <div className="flex items-center gap-2.5 font-medium">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <ScanText className="w-4 h-4" />
          </span>
          <div>
            <div className="font-semibold text-foreground flex items-center gap-1.5">
              <span>โหมดเลือกพื้นที่ OCR</span>
              <span className="text-[10px] text-primary bg-primary/10 border border-primary/20 px-1.5 py-0.2 rounded font-normal">
                {Math.round(rect.width)} × {Math.round(rect.height)}
              </span>
            </div>
            <div className="text-[11px] text-muted">ลากกรอบสีชมพูไปครอบข้อความ แล้วกดตรวจจับ</div>
          </div>
        </div>

        <div className="w-px h-6 bg-border/80" />

        <button
          type="button"
          disabled={loading}
          onClick={() => onDetectRegion(rect)}
          className="flex items-center gap-1.5 bg-primary hover:bg-primary-hover active:scale-95 text-primary-content font-semibold px-3.5 py-2 rounded-xl shadow-md transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          {loading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>กำลังสแกน...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5" />
              <span>ตรวจจับข้อความในกรอบ</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-surface-hover text-muted hover:text-foreground transition-colors cursor-pointer"
          aria-label="ยกเลิก"
          title="ยกเลิก (Esc)"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </>
  );
}
