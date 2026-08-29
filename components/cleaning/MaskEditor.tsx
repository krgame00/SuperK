"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Paintbrush, RotateCcw, X } from "lucide-react";

import { applyBrush, type BrushMode, type MaskPoint } from "@/lib/cleaning/maskEdits";
import type {
  CleanerOverride,
  CleaningRegion,
  ManualRegionAction,
} from "@/lib/cleaning/types";
import { undoManager } from "@/lib/undoManager";

interface MaskEditorProps {
  sourceUrl: string;
  maskUrl: string;
  regions: CleaningRegion[];
  onClose: () => void;
  onRetry: (
    regionId: string,
    mask: Blob,
    cleaner: CleanerOverride,
    action: ManualRegionAction,
  ) => Promise<unknown>;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}

const cleaners: { value: CleanerOverride; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "flat", label: "Flat" },
  { value: "opencv", label: "OpenCV" },
  { value: "aot", label: "AOT" },
  { value: "anime-lama", label: "AnimeLaMa" },
];

export function MaskEditor({
  sourceUrl,
  maskUrl,
  regions,
  onClose,
  onRetry,
  returnFocusRef,
}: MaskEditorProps) {
  const titleId = useId();
  const instructionsId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageDataRef = useRef<ImageData | undefined>(undefined);
  const drawingRef = useRef(false);
  const strokeBeforeRef = useRef<ImageData | undefined>(undefined);

  const [mode, setMode] = useState<BrushMode>("paint");
  const [radius, setRadius] = useState(8);
  const [cleaner, setCleaner] = useState<CleanerOverride>("auto");
  const [regionId, setRegionId] = useState(regions[0]?.id ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [brushPoint, setBrushPoint] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const [isCanvasFocused, setIsCanvasFocused] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const closeAndRestoreFocus = useCallback(() => {
    onClose();
    queueMicrotask(() => {
      returnFocusRef?.current?.focus();
    });
  }, [onClose, returnFocusRef]);

  const renderMask = (imageData: ImageData) => {
    imageDataRef.current = imageData;
    canvasRef.current?.getContext("2d")?.putImageData(imageData, 0, 0);
  };

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    let active = true;
    const maskImage = new Image();
    maskImage.onload = () => {
      if (!active || !canvasRef.current) return;
      const canvas = canvasRef.current;
      canvas.width = maskImage.naturalWidth;
      canvas.height = maskImage.naturalHeight;
      setBrushPoint({
        x: Math.round(maskImage.naturalWidth / 2),
        y: Math.round(maskImage.naturalHeight / 2),
      });
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.drawImage(maskImage, 0, 0);
      const source = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let index = 0; index < source.data.length; index += 4) {
        const activePixel = source.data[index] > 16;
        source.data[index] = 255;
        source.data[index + 1] = 55;
        source.data[index + 2] = 80;
        source.data[index + 3] = activePixel ? 150 : 0;
      }
      renderMask(source);
    };
    maskImage.src = maskUrl;
    return () => {
      active = false;
    };
  }, [maskUrl]);

  const commitBrushAt = (point: MaskPoint) => {
    const current = imageDataRef.current;
    if (!current) return;
    const before = cloneImageData(current);
    const updated = applyBrush(current, [point], radius, mode);
    renderMask(updated);
    const after = cloneImageData(updated);
    undoManager.push({
      label: "แก้ Mask",
      undo: () => renderMask(cloneImageData(before)),
      redo: () => renderMask(cloneImageData(after)),
    });
    if (mode === "paint") {
      setStatusMessage("เพิ่ม Mask แล้ว");
    } else if (mode === "erase") {
      setStatusMessage("ลบ Mask แล้ว");
    } else {
      setStatusMessage("กู้ภาพเดิมแล้ว");
    }
  };

  const drawAt = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const current = imageDataRef.current;
    if (!canvas || !current) return;
    const bounds = canvas.getBoundingClientRect();
    const point = {
      x: (event.clientX - bounds.left) * (canvas.width / bounds.width),
      y: (event.clientY - bounds.top) * (canvas.height / bounds.height),
    };
    setBrushPoint(point);
    renderMask(applyBrush(current, [point], radius, mode));
  };

  const startStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!imageDataRef.current) return;
    drawingRef.current = true;
    strokeBeforeRef.current = cloneImageData(imageDataRef.current);
    event.currentTarget.setPointerCapture(event.pointerId);
    drawAt(event);
  };

  const finishStroke = () => {
    if (!drawingRef.current || !strokeBeforeRef.current || !imageDataRef.current) {
      return;
    }
    drawingRef.current = false;
    const before = cloneImageData(strokeBeforeRef.current);
    const after = cloneImageData(imageDataRef.current);
    undoManager.push({
      label: "แก้ Mask",
      undo: () => renderMask(cloneImageData(before)),
      redo: () => renderMask(cloneImageData(after)),
    });
  };

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeAndRestoreFocus();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable || focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleCanvasKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight" ||
      event.key === "ArrowUp" ||
      event.key === "ArrowDown"
    ) {
      event.preventDefault();
      event.stopPropagation();
      const step = event.shiftKey ? 10 : 1;
      const dx = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
      const dy = event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
      setBrushPoint((prev) => ({
        x: Math.max(0, Math.min(canvas.width - 1, prev.x + dx)),
        y: Math.max(0, Math.min(canvas.height - 1, prev.y + dy)),
      }));
      return;
    }

    if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      event.stopPropagation();
      commitBrushAt(brushPoint);
      return;
    }

    if (event.key === "[" || event.key === "]") {
      event.preventDefault();
      event.stopPropagation();
      const delta = event.key === "]" ? 1 : -1;
      const nextRadius = Math.max(2, Math.min(48, radius + delta));
      setRadius(nextRadius);
      setStatusMessage(`ขนาดแปรง ${nextRadius} พิกเซล`);
      return;
    }

    if ((event.ctrlKey || event.metaKey) && (event.key === "z" || event.key === "Z")) {
      event.preventDefault();
      event.stopPropagation();
      const action = undoManager.undo();
      if (action) {
        setStatusMessage("เลิกทำแล้ว");
      }
      return;
    }
  };

  const handleModeChange = (newMode: BrushMode) => {
    setMode(newMode);
    setStatusMessage(
      newMode === "paint"
        ? "โหมดเพิ่ม Mask"
        : newMode === "erase"
          ? "โหมดลบ Mask"
          : "โหมดกู้ภาพเดิม",
    );
  };

  const submit = async (action: ManualRegionAction) => {
    const imageData = imageDataRef.current;
    if (!imageData || !regionId) return;
    setIsSubmitting(true);
    try {
      const output = document.createElement("canvas");
      output.width = imageData.width;
      output.height = imageData.height;
      const context = output.getContext("2d");
      if (!context) return;
      const grayscale = context.createImageData(output.width, output.height);
      for (let index = 0; index < imageData.data.length; index += 4) {
        const value = imageData.data[index + 3] > 0 ? 255 : 0;
        grayscale.data[index] = value;
        grayscale.data[index + 1] = value;
        grayscale.data[index + 2] = value;
        grayscale.data[index + 3] = 255;
      }
      context.putImageData(grayscale, 0, 0);
      const blob = await canvasToBlob(output);
      await onRetry(regionId, blob, cleaner, action);
      closeAndRestoreFocus();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={handleDialogKeyDown}
    >
      <div className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-background shadow-2xl">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-hover px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Paintbrush className="h-4 w-4 text-primary" aria-hidden="true" />
            <h2 id={titleId} className="text-sm font-semibold">
              แก้ Mask
            </h2>
            <select
              aria-label="Region"
              value={regionId}
              onChange={(event) => setRegionId(event.target.value)}
              className="h-8 rounded-md bg-surface px-2 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-primary"
            >
              {regions.map((region) => (
                <option key={region.id} value={region.id}>
                  {region.id} · {region.route}
                </option>
              ))}
            </select>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={closeAndRestoreFocus}
            aria-label="ปิดแก้ Mask"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-md p-2 text-muted hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary sm:min-h-8 sm:min-w-8"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto bg-black p-2">
          <div className="relative mx-auto w-fit max-w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={sourceUrl} alt="" className="block max-h-[70vh] max-w-full" />
            <canvas
              ref={canvasRef}
              tabIndex={0}
              role="application"
              aria-label="พื้นที่แก้ Mask"
              aria-describedby={instructionsId}
              className="absolute inset-0 h-full w-full touch-none cursor-crosshair focus-visible:outline-2 focus-visible:outline-primary"
              onFocus={() => setIsCanvasFocused(true)}
              onBlur={() => setIsCanvasFocused(false)}
              onKeyDown={handleCanvasKeyDown}
              onPointerDown={startStroke}
              onPointerMove={(event) => {
                if (drawingRef.current) drawAt(event);
              }}
              onPointerUp={finishStroke}
              onPointerCancel={finishStroke}
            />
            {isCanvasFocused && canvasRef.current && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary ring-1 ring-white/75 transition-[left,top,width,height] duration-75 motion-reduce:transition-none"
                style={{
                  left: `${(brushPoint.x / (canvasRef.current.width || 1)) * 100}%`,
                  top: `${(brushPoint.y / (canvasRef.current.height || 1)) * 100}%`,
                  width: `${((radius * 2) / (canvasRef.current.width || 1)) * 100}%`,
                  aspectRatio: "1/1",
                }}
              />
            )}
          </div>
        </div>

        <div className="border-t border-surface-hover/60 bg-surface/30 px-3 py-1.5">
          <p id={instructionsId} className="text-[11px] text-muted">
            ใช้ลูกศรเลื่อนหัวแปรง (Shift เพื่อเลื่อนเร็ว), Space เพื่อป้าย, [ ] ปรับขนาด, Ctrl+Z เลิกทำ
          </p>
        </div>

        <div role="status" aria-live="polite" className="sr-only">
          {statusMessage}
        </div>

        <footer className="flex flex-col gap-3 border-t border-surface-hover px-3 py-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {(["paint", "erase", "restore"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => handleModeChange(item)}
                aria-pressed={mode === item}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-md bg-surface px-3 text-xs text-muted transition-colors duration-150 hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-primary aria-pressed:bg-primary aria-pressed:text-primary-content sm:min-h-8 sm:min-w-fit"
              >
                {item === "paint" ? "เพิ่ม Mask" : item === "erase" ? "ลบ Mask" : "กู้ภาพเดิม (Restore)"}
              </button>
            ))}
            <label className="flex items-center gap-2 text-xs text-muted">
              ขนาด {radius}px
              <input
                type="range"
                min="2"
                max="48"
                value={radius}
                onChange={(event) => {
                  const newRad = Number(event.target.value);
                  setRadius(newRad);
                  setStatusMessage(`ขนาดแปรง ${newRad} พิกเซล`);
                }}
                className="accent-primary"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                const action = undoManager.undo();
                if (action) setStatusMessage("เลิกทำแล้ว");
              }}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-md p-2 text-muted hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary sm:min-h-8 sm:min-w-8"
              aria-label="Undo Mask"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
            <select
              aria-label="Cleaner"
              value={cleaner}
              onChange={(event) =>
                setCleaner(event.target.value as CleanerOverride)
              }
              className="h-9 w-full rounded-md bg-surface px-2 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-primary sm:w-auto"
            >
              {cleaners.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-red-300">
              ลบตาม Mask นี้แม้ระบบป้องกันไว้
            </p>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
              <button
                type="button"
                disabled={isSubmitting || !regionId}
                onClick={() => submit("automatic")}
                className="flex min-h-11 flex-1 items-center justify-center rounded-md bg-surface px-3 text-xs font-medium text-foreground transition-colors duration-150 hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-40 sm:min-h-9 sm:flex-none"
              >
                Reset to automatic
              </button>
              <button
                type="button"
                disabled={isSubmitting || !regionId}
                onClick={() => submit("protect")}
                className="flex min-h-11 flex-1 items-center justify-center rounded-md bg-blue-500/20 px-3 text-xs font-semibold text-blue-200 transition-colors duration-150 hover:bg-blue-500/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 disabled:opacity-40 sm:min-h-9 sm:flex-none"
              >
                Protect
              </button>
              <button
                type="button"
                disabled={isSubmitting || !regionId}
                onClick={() => submit("force-clean")}
                className="flex min-h-11 flex-1 items-center justify-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-content transition-colors duration-150 hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-40 sm:min-h-9 sm:flex-none"
              >
                {isSubmitting ? "กำลังประมวลผล…" : "Force clean"}
              </button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

function cloneImageData(imageData: ImageData): ImageData {
  return new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height,
  );
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Unable to encode mask."));
    }, "image/png");
  });
}
