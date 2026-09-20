"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Eraser,
  Maximize2,
  Paintbrush,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

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
  proposalMaskUrl?: string;
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
  proposalMaskUrl,
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
  const loadedRegionRef = useRef("");

  const [mode, setMode] = useState<BrushMode>("paint");
  const [radius, setRadius] = useState(8);
  const [cleaner, setCleaner] = useState<CleanerOverride>("auto");
  const [regionId, setRegionId] = useState(regions[0]?.id ?? "");
  const selectedRegion = regions.find(region => region.id === regionId);
  const currentIndex = regions.findIndex(region => region.id === regionId);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [brushPoint, setBrushPoint] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [isCanvasFocused, setIsCanvasFocused] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  // Zoom and Pan state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const isSpacePressedRef = useRef(false);

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
    const key = `${sourceUrl}:${regionId}`;
    if (loadedRegionRef.current === key && imageDataRef.current) return;
    let active = true;
    const maskImage = new Image();
    maskImage.onload = () => {
      if (!active || !canvasRef.current) return;
      const canvas = canvasRef.current;
      canvas.width = maskImage.naturalWidth;
      canvas.height = maskImage.naturalHeight;
      setCanvasSize({
        width: maskImage.naturalWidth,
        height: maskImage.naturalHeight,
      });
      setBrushPoint({
        x: Math.round(maskImage.naturalWidth / 2),
        y: Math.round(maskImage.naturalHeight / 2),
      });
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.drawImage(maskImage, 0, 0);
      const source = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let index = 0; index < source.data.length; index += 4) {
        const x = (index / 4) % canvas.width;
        const y = Math.floor(index / 4 / canvas.width);
        const r = regions.find(region => region.id === regionId)?.rect;
        const activePixel = source.data[index] > 16 && r && x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
        source.data[index] = 255;
        source.data[index + 1] = 55;
        source.data[index + 2] = 80;
        source.data[index + 3] = activePixel ? 150 : 0;
      }
      renderMask(source);
      loadedRegionRef.current = key;
    };
    maskImage.src = selectedRegion?.textRole === "review" && proposalMaskUrl ? proposalMaskUrl : maskUrl;
    return () => {
      active = false;
    };
  }, [sourceUrl, maskUrl, proposalMaskUrl, regionId, regions, selectedRegion?.textRole]);

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
    if (isSpacePressedRef.current || event.button === 1 || event.button === 2) {
      setIsPanning(true);
      panStartRef.current = { x: event.clientX - pan.x, y: event.clientY - pan.y };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (!imageDataRef.current) return;
    drawingRef.current = true;
    strokeBeforeRef.current = cloneImageData(imageDataRef.current);
    event.currentTarget.setPointerCapture(event.pointerId);
    drawAt(event);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      setPan({
        x: event.clientX - panStartRef.current.x,
        y: event.clientY - panStartRef.current.y,
      });
      return;
    }
    if (drawingRef.current) {
      drawAt(event);
    }
  };

  const finishStroke = () => {
    if (isPanning) {
      setIsPanning(false);
      return;
    }
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

  // Quick Action: Fill Region with Mask
  const handleFillRegion = () => {
    const current = imageDataRef.current;
    if (!current || !selectedRegion) return;
    const before = cloneImageData(current);
    const updated = cloneImageData(current);
    const r = selectedRegion.rect;
    for (let y = r.y; y < r.y + r.height; y++) {
      for (let x = r.x; x < r.x + r.width; x++) {
        if (x >= 0 && x < updated.width && y >= 0 && y < updated.height) {
          const offset = (y * updated.width + x) * 4;
          updated.data[offset] = 255;
          updated.data[offset + 1] = 55;
          updated.data[offset + 2] = 80;
          updated.data[offset + 3] = 150;
        }
      }
    }
    renderMask(updated);
    undoManager.push({
      label: "เติม Mask เต็มกรอบ",
      undo: () => renderMask(cloneImageData(before)),
      redo: () => renderMask(cloneImageData(updated)),
    });
    setStatusMessage("เติม Mask เต็มกรอบแล้ว");
  };

  // Quick Action: Clear Region Mask
  const handleClearRegion = () => {
    const current = imageDataRef.current;
    if (!current || !selectedRegion) return;
    const before = cloneImageData(current);
    const updated = cloneImageData(current);
    const r = selectedRegion.rect;
    for (let y = r.y; y < r.y + r.height; y++) {
      for (let x = r.x; x < r.x + r.width; x++) {
        if (x >= 0 && x < updated.width && y >= 0 && y < updated.height) {
          const offset = (y * updated.width + x) * 4;
          updated.data[offset + 3] = 0;
        }
      }
    }
    renderMask(updated);
    undoManager.push({
      label: "ล้าง Mask ในกรอบ",
      undo: () => renderMask(cloneImageData(before)),
      redo: () => renderMask(cloneImageData(updated)),
    });
    setStatusMessage("ล้าง Mask ในกรอบแล้ว");
  };

  // Region Carousel Stepper
  const goToRegion = (index: number) => {
    if (index >= 0 && index < regions.length) {
      setRegionId(regions[index].id);
      setStatusMessage(`เลือกบอลลูน #${index + 1}`);
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const zoomDelta = event.deltaY < 0 ? 0.2 : -0.2;
    setZoom((prev) => Math.max(0.5, Math.min(4.0, Number((prev + zoomDelta).toFixed(2)))));
  };

  const resetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setStatusMessage("รีเซ็ตขนาดภาพพอดีหน้าจอ");
  };

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeAndRestoreFocus();
      return;
    }
    if (event.key === " ") {
      isSpacePressedRef.current = true;
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

  const handleDialogKeyUp = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === " ") {
      isSpacePressedRef.current = false;
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
        const x = (index / 4) % output.width;
        const y = Math.floor(index / 4 / output.width);
        const r = selectedRegion?.rect;
        const inside = r && x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
        const value = inside && imageData.data[index + 3] > 0 ? 255 : 0;
        grayscale.data[index] = value;
        grayscale.data[index + 1] = value;
        grayscale.data[index + 2] = value;
        grayscale.data[index + 3] = 255;
      }
      context.putImageData(grayscale, 0, 0);
      const blob = await canvasToBlob(output);
      await onRetry(regionId, blob, cleaner, action);
      if (action === "confirm-text") {
        setStatusMessage("ยืนยันข้อความแล้ว ตรวจพื้นที่สีแดงที่จะลบเฉพาะบริเวณที่เลือก");
      } else {
        closeAndRestoreFocus();
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "บันทึกไม่สำเร็จ");
    } finally {
      setIsSubmitting(false);
    }
  };

  // One-Click Clean: seamlessly confirms text if necessary and cleans the region immediately
  const handleOneClickClean = async () => {
    const imageData = imageDataRef.current;
    if (!imageData || !regionId) return;
    setIsSubmitting(true);
    setStatusMessage("กำลังคลีนข้อความจุดนี้...");
    try {
      const output = document.createElement("canvas");
      output.width = imageData.width;
      output.height = imageData.height;
      const context = output.getContext("2d");
      if (!context) return;
      const grayscale = context.createImageData(output.width, output.height);
      for (let index = 0; index < imageData.data.length; index += 4) {
        const x = (index / 4) % output.width;
        const y = Math.floor(index / 4 / output.width);
        const r = selectedRegion?.rect;
        const inside = r && x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
        const value = inside && imageData.data[index + 3] > 0 ? 255 : 0;
        grayscale.data[index] = value;
        grayscale.data[index + 1] = value;
        grayscale.data[index + 2] = value;
        grayscale.data[index + 3] = 255;
      }
      context.putImageData(grayscale, 0, 0);
      const blob = await canvasToBlob(output);

      // Auto confirm text if needed by backend authorization gate
      if (selectedRegion && selectedRegion.textConfirmed !== true) {
        await onRetry(regionId, blob, cleaner, "confirm-text");
      }
      await onRetry(regionId, blob, cleaner, "force-clean");
      closeAndRestoreFocus();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "บันทึกไม่สำเร็จ");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2 sm:p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={handleDialogKeyDown}
      onKeyUp={handleDialogKeyUp}
    >
      <div className="flex h-[94vh] max-h-[95vh] w-full max-w-7xl flex-col overflow-hidden rounded-xl border border-border/80 bg-background shadow-2xl">
        {/* Header Bar */}
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 bg-surface/90 px-4 py-2.5 backdrop-blur-md">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/20 text-primary">
                <Paintbrush className="h-4 w-4" aria-hidden="true" />
              </span>
              <h2 id={titleId} className="text-sm font-semibold tracking-tight">
                แก้ Mask
              </h2>
            </div>

            {/* Region Stepper & Dropdown */}
            <div className="flex items-center gap-1 rounded-lg border border-border/80 bg-background/80 p-0.5">
              <button
                type="button"
                onClick={() => goToRegion(currentIndex > 0 ? currentIndex - 1 : regions.length - 1)}
                title="บอลลูนก่อนหน้า (Alt + ←)"
                aria-label="บอลลูนก่อนหน้า"
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-foreground active:scale-95"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="select-none px-2 text-xs font-semibold text-foreground">
                {currentIndex + 1} / {regions.length}
              </span>
              <button
                type="button"
                onClick={() => goToRegion(currentIndex < regions.length - 1 ? currentIndex + 1 : 0)}
                title="บอลลูนถัดไป (Alt + →)"
                aria-label="บอลลูนถัดไป"
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-foreground active:scale-95"
              >
                <ChevronRight className="h-4 w-4" />
              </button>

              <select
                aria-label="Region"
                value={regionId}
                onChange={(event) => setRegionId(event.target.value)}
                className="h-7 rounded-md border-0 bg-transparent px-2 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
              >
                {regions.map((region, idx) => (
                  <option key={region.id} value={region.id} className="bg-surface text-foreground">
                    #{idx + 1} · {region.id} ({region.route})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Quick Zoom Controls */}
            <div className="flex items-center gap-1 rounded-lg border border-border/80 bg-background/80 p-0.5">
              <button
                type="button"
                onClick={() => setZoom((prev) => Math.max(0.5, Number((prev - 0.25).toFixed(2))))}
                title="ซูมออก (-)"
                aria-label="ซูมออก"
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-foreground"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={resetZoom}
                title="คลิกเพื่อรีเซ็ตขนาดภาพ"
                className="px-2 text-xs font-semibold text-muted hover:text-foreground"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                onClick={() => setZoom((prev) => Math.min(4.0, Number((prev + 0.25).toFixed(2))))}
                title="ซูมเข้า (+)"
                aria-label="ซูมเข้า"
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-foreground"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={resetZoom}
                title="พอดีหน้าจอ (Fit Screen)"
                aria-label="พอดีหน้าจอ"
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-foreground"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
            </div>

            <button
              ref={closeRef}
              type="button"
              onClick={closeAndRestoreFocus}
              aria-label="ปิดแก้ Mask"
              title="ปิด (Esc)"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Canvas & Image Workspace */}
        <div
          onWheel={handleWheel}
          className="relative min-h-0 flex-1 overflow-hidden bg-neutral-950/90 select-none cursor-default"
        >
          {/* Scrollable / Zoomable Pan Wrapper */}
          <div
            className="flex h-full w-full items-center justify-center transition-transform duration-75"
            style={{
              transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
              transformOrigin: "center center",
            }}
          >
            <div className="relative mx-auto w-fit max-w-full shadow-2xl">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={sourceUrl} alt="" className="block max-h-[72vh] max-w-full pointer-events-none" />

              {/* Interactive Region Bounding Boxes Overlay */}
              {canvasSize.width > 0 && (
                <div className="absolute inset-0 pointer-events-none">
                  {regions.map((region, idx) => {
                    const isSelected = region.id === regionId;
                    const r = region.rect;
                    const left = (r.x / canvasSize.width) * 100;
                    const top = (r.y / canvasSize.height) * 100;
                    const width = (r.width / canvasSize.width) * 100;
                    const height = (r.height / canvasSize.height) * 100;

                    return (
                      <div
                        key={region.id}
                        style={{
                          left: `${left}%`,
                          top: `${top}%`,
                          width: `${width}%`,
                          height: `${height}%`,
                        }}
                        className={`absolute transition-all ${
                          isSelected
                            ? "border-2 border-cyan-400 bg-cyan-400/10 ring-2 ring-cyan-400/40 shadow-[0_0_15px_rgba(34,211,238,0.35)]"
                            : "border border-dashed border-white/35 bg-white/5 hover:border-cyan-300/80 hover:bg-cyan-300/10"
                        }`}
                      >
                        {/* Clickable Region Pill / Badge */}
                        <button
                          type="button"
                          aria-label={`เลือกบอลลูนที่ ${idx + 1}: ${region.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setRegionId(region.id);
                            setStatusMessage(`เลือกบอลลูน #${idx + 1}`);
                          }}
                          title={`คลิกเพื่อเลือกบอลลูน #${idx + 1} (${region.route})`}
                          className={`pointer-events-auto absolute -top-5 left-0 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold shadow-sm transition-transform active:scale-95 ${
                            isSelected
                              ? "bg-cyan-400 text-neutral-950"
                              : "bg-neutral-800/90 text-white/80 hover:bg-neutral-700"
                          }`}
                        >
                          <span>#{idx + 1}</span>
                          <span className="hidden sm:inline font-medium opacity-80">{region.route}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Mask Canvas Layer */}
              <canvas
                ref={canvasRef}
                tabIndex={0}
                role="application"
                aria-label="พื้นที่แก้ Mask"
                aria-describedby={instructionsId}
                className={`absolute inset-0 h-full w-full touch-none focus-visible:outline-2 focus-visible:outline-primary ${
                  isPanning ? "cursor-grabbing" : isSpacePressedRef.current ? "cursor-grab" : "cursor-crosshair"
                }`}
                onFocus={() => setIsCanvasFocused(true)}
                onBlur={() => setIsCanvasFocused(false)}
                onKeyDown={handleCanvasKeyDown}
                onPointerDown={startStroke}
                onPointerMove={handlePointerMove}
                onPointerUp={finishStroke}
                onPointerCancel={finishStroke}
              />

              {/* Brush Cursor Indicator */}
              {isCanvasFocused && canvasSize.width > 0 && !isPanning && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary ring-1 ring-white/75 transition-[left,top,width,height] duration-75 motion-reduce:transition-none"
                  style={{
                    left: `${(brushPoint.x / canvasSize.width) * 100}%`,
                    top: `${(brushPoint.y / canvasSize.height) * 100}%`,
                    width: `${((radius * 2) / canvasSize.width) * 100}%`,
                    aspectRatio: "1/1",
                  }}
                />
              )}
            </div>
          </div>
        </div>

        {/* Instruction Tips */}
        <div className="border-t border-border/80 bg-surface/50 px-4 py-1.5">
          <p id={instructionsId} className="text-[11px] text-muted flex items-center justify-between flex-wrap gap-2">
            <span>
              💡 <b>ทริก:</b> คลิกเลือกบอลลูนบนภาพได้ทันที · หมุนลูกกลิ้งเมาส์ซูมเข้า/ออก · กด <b>Spacebar + ลาก</b> เพื่อเลื่อนภาพ · <b>[ ]</b> ปรับขนาดแปรง · <b>Ctrl+Z</b> เลิกทำ
            </span>
            {selectedRegion && (
              <span className="text-[11px] font-medium text-cyan-400">
                เลือกอยู่: #{currentIndex + 1} ({selectedRegion.id})
              </span>
            )}
          </p>
        </div>

        <div role="status" aria-live="polite" className="sr-only">
          {statusMessage}
        </div>

        {/* Footer Actions & Tools */}
        <footer className="flex flex-col gap-3 border-t border-border/80 bg-surface/90 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Left: Tools, Quick Fills, Radius */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Paint / Erase / Restore Mode Buttons */}
            <div className="flex items-center gap-1 rounded-lg border border-border/80 bg-background/80 p-0.5">
              {(["paint", "erase", "restore"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => handleModeChange(item)}
                  aria-pressed={mode === item}
                  className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-all ${
                    mode === item
                      ? "bg-primary text-primary-content shadow-xs font-semibold"
                      : "text-muted hover:bg-surface hover:text-foreground"
                  }`}
                >
                  {item === "paint" && <Paintbrush className="h-3.5 w-3.5" />}
                  {item === "erase" && <Eraser className="h-3.5 w-3.5" />}
                  <span>{item === "paint" ? "เพิ่ม Mask" : item === "erase" ? "ลบ Mask" : "กู้ภาพเดิม (Restore)"}</span>
                </button>
              ))}
            </div>

            {/* Smart Fill & Clear Box Shortcuts */}
            <div className="flex items-center gap-1 border-l border-border/80 pl-2">
              <button
                type="button"
                onClick={handleFillRegion}
                title="ระบายมาร์กสีแดงเต็มกรอบบอลลูนนี้ทันที"
                className="flex h-7 items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/15 px-2.5 text-xs font-semibold text-red-300 transition-colors hover:bg-red-500/25 active:scale-95"
              >
                <Square className="h-3.5 w-3.5" />
                <span>เติมเต็มกรอบ</span>
              </button>
              <button
                type="button"
                onClick={handleClearRegion}
                title="ล้างมาร์กเฉพาะในกรอบบอลลูนนี้"
                className="flex h-7 items-center gap-1.5 rounded-md border border-border/80 bg-surface px-2.5 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground active:scale-95"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>ล้างกรอบนี้</span>
              </button>
            </div>

            {/* Radius Slider & Undo */}
            <div className="flex items-center gap-2 border-l border-border/80 pl-2">
              <label className="flex items-center gap-2 text-xs text-muted">
                <span>ขนาด {radius}px</span>
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
                  className="w-20 accent-primary cursor-pointer"
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  const action = undoManager.undo();
                  if (action) setStatusMessage("เลิกทำแล้ว");
                }}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-border/80 bg-surface text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
                aria-label="Undo Mask"
                title="เลิกทำ (Ctrl+Z)"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Right: One-Click Clean, Fallback Buttons */}
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Cleaner"
                value={cleaner}
                onChange={(event) => setCleaner(event.target.value as CleanerOverride)}
                className="h-8 rounded-md border border-border/80 bg-background px-2.5 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-primary"
              >
                {cleaners.map((item) => (
                  <option key={item.value} value={item.value}>
                    อัลกอริทึม: {item.label}
                  </option>
                ))}
              </select>

              {/* 🪄 Instant 1-Click Clean Button */}
              <button
                type="button"
                disabled={isSubmitting || !regionId}
                onClick={handleOneClickClean}
                title="ยืนยันและคลีนข้อความออกจากบอลลูนนี้ทันทีในคลิกเดียว"
                className="flex h-8 items-center gap-1.5 rounded-lg bg-gradient-to-r from-primary to-indigo-500 px-3.5 text-xs font-bold text-white shadow-md shadow-primary/20 transition-all hover:brightness-110 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>{isSubmitting ? "กำลังคลีน…" : "🪄 คลีนจุดนี้ทันที (Clean Now)"}</span>
              </button>
            </div>

            {/* Granular authorization buttons (kept for testing & power users) */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-red-300 hidden xl:inline">
                ยืนยันข้อความก่อน แล้วตรวจพื้นที่สีแดงที่จะลบเฉพาะบริเวณที่เลือก
              </span>
              <button
                type="button"
                disabled={isSubmitting || !regionId}
                onClick={() => submit("confirm-text")}
                className="h-7 rounded-md bg-surface px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-surface-hover disabled:opacity-40"
              >
                ยืนยันว่าเป็นข้อความ
              </button>
              <button
                type="button"
                disabled={isSubmitting || !regionId}
                onClick={() => submit("protect")}
                className="h-7 rounded-md bg-blue-500/20 px-2.5 text-[11px] font-semibold text-blue-200 transition-colors hover:bg-blue-500/30 disabled:opacity-40"
              >
                Protect
              </button>
              <button
                type="button"
                disabled={isSubmitting || !regionId || selectedRegion?.textConfirmed !== true}
                onClick={() => submit("force-clean")}
                className="h-7 rounded-md bg-primary/20 border border-primary/40 px-2.5 text-[11px] font-semibold text-primary-light transition-colors hover:bg-primary/30 disabled:opacity-40"
              >
                อนุมัติ Mask และลบ
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
