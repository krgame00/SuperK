"use client";

import { useEffect, useRef, useState } from "react";
import { Paintbrush, RotateCcw, X } from "lucide-react";

import { applyBrush, type BrushMode } from "@/lib/cleaning/maskEdits";
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
}: MaskEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageDataRef = useRef<ImageData | undefined>(undefined);
  const drawingRef = useRef(false);
  const strokeBeforeRef = useRef<ImageData | undefined>(undefined);
  const [mode, setMode] = useState<BrushMode>("paint");
  const [radius, setRadius] = useState(8);
  const [cleaner, setCleaner] = useState<CleanerOverride>("auto");
  const [regionId, setRegionId] = useState(regions[0]?.id ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const renderMask = (imageData: ImageData) => {
    imageDataRef.current = imageData;
    canvasRef.current?.getContext("2d")?.putImageData(imageData, 0, 0);
  };

  useEffect(() => {
    let active = true;
    const maskImage = new Image();
    maskImage.onload = () => {
      if (!active || !canvasRef.current) return;
      const canvas = canvasRef.current;
      canvas.width = maskImage.naturalWidth;
      canvas.height = maskImage.naturalHeight;
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

  const drawAt = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const current = imageDataRef.current;
    if (!canvas || !current) return;
    const bounds = canvas.getBoundingClientRect();
    const point = {
      x: (event.clientX - bounds.left) * (canvas.width / bounds.width),
      y: (event.clientY - bounds.top) * (canvas.height / bounds.height),
    };
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
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="แก้ไข Mask"
    >
      <div className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-background">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-hover px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Paintbrush className="h-4 w-4 text-primary" aria-hidden="true" />
            <span className="text-sm font-semibold">แก้ Mask</span>
            <select
              aria-label="Region"
              value={regionId}
              onChange={(event) => setRegionId(event.target.value)}
              className="h-8 rounded-md bg-surface px-2 text-xs text-foreground"
            >
              {regions.map((region) => (
                <option key={region.id} value={region.id}>
                  {region.id} · {region.route}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิด"
            className="rounded-md p-2 text-muted hover:bg-surface hover:text-foreground"
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
              className="absolute inset-0 h-full w-full touch-none cursor-crosshair"
              onPointerDown={startStroke}
              onPointerMove={(event) => drawingRef.current && drawAt(event)}
              onPointerUp={finishStroke}
              onPointerCancel={finishStroke}
            />
          </div>
        </div>

        <footer className="flex flex-col gap-3 border-t border-surface-hover px-3 py-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {(["paint", "erase", "restore"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setMode(item)}
                aria-pressed={mode === item}
                className="h-8 rounded-md bg-surface px-3 text-xs text-muted aria-pressed:bg-primary aria-pressed:text-primary-content"
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
                onChange={(event) => setRadius(Number(event.target.value))}
              />
            </label>
            <button
              type="button"
              onClick={() => undoManager.undo()}
              className="rounded-md p-2 text-muted hover:bg-surface"
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
              className="h-9 w-full rounded-md bg-surface px-2 text-xs text-foreground sm:w-auto"
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
                className="h-9 flex-1 rounded-md bg-surface px-3 text-xs font-medium text-foreground transition-colors duration-150 hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-40 sm:flex-none"
              >
                Reset to automatic
              </button>
              <button
                type="button"
                disabled={isSubmitting || !regionId}
                onClick={() => submit("protect")}
                className="h-9 flex-1 rounded-md bg-blue-500/20 px-3 text-xs font-semibold text-blue-200 transition-colors duration-150 hover:bg-blue-500/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 disabled:opacity-40 sm:flex-none"
              >
                Protect
              </button>
              <button
                type="button"
                disabled={isSubmitting || !regionId}
                onClick={() => submit("force-clean")}
                className="h-9 flex-1 rounded-md bg-primary px-3 text-xs font-semibold text-primary-content transition-colors duration-150 hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-40 sm:flex-none"
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
