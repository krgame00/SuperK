"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { ChevronsLeftRight } from "lucide-react";

export interface CompareSliderProps {
  originalUrl: string;
  translatedUrl: string;
  originalAlt?: string;
  translatedAlt?: string;
  initialPosition?: number;
  position?: number;
  onPositionChange?: (position: number) => void;
  className?: string;
  naturalDimensions?: { width: number; height: number } | null;
  stageStyle?: React.CSSProperties;
  showLabels?: boolean;
}

export function CompareSlider({
  originalUrl,
  translatedUrl,
  originalAlt = "ต้นฉบับ (Original)",
  translatedAlt = "หน้าแปลแล้ว (Translated)",
  initialPosition = 50,
  position: controlledPosition,
  onPositionChange,
  className = "",
  naturalDimensions,
  stageStyle,
  showLabels = true,
}: CompareSliderProps) {
  const [internalPosition, setInternalPosition] = useState(
    Math.max(0, Math.min(100, initialPosition)),
  );
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentPos = controlledPosition !== undefined ? controlledPosition : internalPosition;

  const updatePositionFromClientX = useCallback(
    (clientX: number) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width <= 0) return;
      const rawPct = ((clientX - rect.left) / rect.width) * 100;
      const clampedPct = Math.max(0, Math.min(100, Math.round(rawPct * 10) / 10));

      if (controlledPosition === undefined) {
        setInternalPosition(clampedPct);
      }
      onPositionChange?.(clampedPct);
    },
    [controlledPosition, onPositionChange],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(true);
      const target = e.currentTarget as HTMLElement;
      if (typeof target.setPointerCapture === "function") {
        try {
          target.setPointerCapture(e.pointerId);
        } catch {
          // ignore error in environments without pointer capture support
        }
      }
      updatePositionFromClientX(e.clientX);
    },
    [updatePositionFromClientX],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging) return;
      updatePositionFromClientX(e.clientX);
    },
    [isDragging, updatePositionFromClientX],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (isDragging) {
        setIsDragging(false);
        const target = e.currentTarget as HTMLElement;
        if (typeof target.releasePointerCapture === "function") {
          try {
            target.releasePointerCapture(e.pointerId);
          } catch {
            // ignore if already released
          }
        }
      }
    },
    [isDragging],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      let delta = 0;
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
        delta = -2;
      } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
        delta = 2;
      } else if (e.key === "PageDown") {
        delta = -10;
      } else if (e.key === "PageUp") {
        delta = 10;
      } else if (e.key === "Home") {
        delta = -currentPos;
      } else if (e.key === "End") {
        delta = 100 - currentPos;
      }

      if (delta !== 0) {
        e.preventDefault();
        const nextPos = Math.max(0, Math.min(100, currentPos + delta));
        if (controlledPosition === undefined) {
          setInternalPosition(nextPos);
        }
        onPositionChange?.(nextPos);
      }
    },
    [currentPos, controlledPosition, onPositionChange],
  );

  const handleDoubleClick = useCallback(() => {
    if (controlledPosition === undefined) {
      setInternalPosition(50);
    }
    onPositionChange?.(50);
  }, [controlledPosition, onPositionChange]);

  // Clean up dragging if pointer moves outside or unmounts
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isDragging) setIsDragging(false);
    };
    window.addEventListener("pointerup", handleGlobalMouseUp);
    return () => window.removeEventListener("pointerup", handleGlobalMouseUp);
  }, [isDragging]);

  const stageWidth = naturalDimensions ? `${naturalDimensions.width}px` : "100%";
  const stageHeight = naturalDimensions ? `${naturalDimensions.height}px` : "100%";

  return (
    <div
      ref={containerRef}
      data-testid="compare-slider-container"
      className={`relative w-full h-full select-none overflow-hidden flex items-center justify-center bg-background/50 ${className}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{ touchAction: "none" }}
    >
      {/* Visual Labels */}
      {showLabels && (
        <>
          <div
            data-testid="compare-slider-label-original"
            className="absolute top-3 left-3 z-30 pointer-events-none bg-black/80 text-white/90 border border-white/20 text-xs font-semibold px-2.5 py-1 rounded-md shadow-lg backdrop-blur-sm tracking-wide"
          >
            {originalAlt}
          </div>
          <div
            data-testid="compare-slider-label-translated"
            className="absolute top-3 right-3 z-30 pointer-events-none bg-primary/90 text-white border border-primary/50 text-xs font-semibold px-2.5 py-1 rounded-md shadow-lg backdrop-blur-sm tracking-wide"
          >
            {translatedAlt}
          </div>
        </>
      )}

      {/* Main Image Stage (with pan/zoom transform applied) */}
      <div
        className="relative inline-flex shrink-0 justify-center items-center"
        style={{
          width: stageWidth,
          height: stageHeight,
          ...stageStyle,
        }}
      >
        {/* Layer 1 (Bottom): Translated / Cleaned Artwork */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={translatedUrl}
          alt={translatedAlt}
          draggable={false}
          decoding="async"
          data-testid="compare-slider-translated-image"
          className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none block"
          style={{ userSelect: "none", WebkitUserDrag: "none" } as React.CSSProperties}
        />

        {/* Layer 2 (Top, Clipped): Original Raw Artwork */}
        {/* We clip the right side so it reveals only the left portion up to currentPos% */}
        <div
          data-testid="compare-slider-clipped-layer"
          className="absolute inset-0 w-full h-full pointer-events-none overflow-hidden"
          style={{
            clipPath: `polygon(0 0, ${currentPos}% 0, ${currentPos}% 100%, 0 100%)`,
            WebkitClipPath: `polygon(0 0, ${currentPos}% 0, ${currentPos}% 100%, 0 100%)`,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={originalUrl}
            alt={originalAlt}
            draggable={false}
            decoding="async"
            data-testid="compare-slider-original-image"
            className="w-full h-full object-contain select-none block"
            style={{ userSelect: "none", WebkitUserDrag: "none" } as React.CSSProperties}
          />
        </div>
      </div>

      {/* Slider Divider Line */}
      <div
        data-testid="compare-slider-divider"
        className="absolute top-0 bottom-0 z-20 pointer-events-none"
        style={{
          left: `${currentPos}%`,
          transform: "translateX(-50%)",
        }}
      >
        {/* Vertical Line */}
        <div className="w-[2px] h-full bg-white shadow-[0_0_8px_rgba(0,0,0,0.7)]" />

        {/* Interactive Handle */}
        <div
          role="slider"
          tabIndex={0}
          aria-label="ตัวเลื่อนเปรียบเทียบภาพต้นฉบับกับภาพแปลแล้ว"
          aria-valuenow={Math.round(currentPos)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={`${Math.round(currentPos)}%`}
          data-testid="compare-slider-handle"
          onKeyDown={handleKeyDown}
          onDoubleClick={handleDoubleClick}
          className={`pointer-events-auto absolute top-1/2 -translate-y-1/2 -translate-x-1/2 left-[1px] w-9 h-9 rounded-full bg-surface border-2 border-primary text-primary-foreground flex items-center justify-center shadow-xl cursor-ew-resize hover:scale-110 active:scale-95 transition-transform focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
            isDragging ? "ring-2 ring-primary scale-110 bg-primary/20 text-white" : "bg-neutral-900 text-neutral-200"
          }`}
          title="ลากเพื่อเปรียบเทียบ (ดับเบิลคลิกเพื่อรีเซ็ต 50%)"
        >
          <ChevronsLeftRight className="w-4 h-4 text-primary" aria-hidden="true" />
          {isDragging && (
            <div className="absolute -top-7 px-2 py-0.5 rounded bg-black/90 text-[10px] text-white font-mono shadow pointer-events-none">
              {Math.round(currentPos)}%
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
