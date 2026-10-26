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

import {
  analyzeRegionMaskLocally,
  applyGeminiMaskReviewToSuggestion,
  buildRegionComparisonStripBase64,
  extractImageRegionCrop,
  type AiMaskAuditResult,
  type AiMaskViewMode,
  type GeminiMaskReviewPayload,
} from "@/lib/cleaning/aiMaskInspector";
import { applyBrush, dilateMask, type BrushMode, type MaskPoint } from "@/lib/cleaning/maskEdits";
import { inpaintCrop } from "@/lib/cleaning/client";
import { findRegionForCandidate } from "@/lib/cleaning/remnantReview";
import type {
  CleanerOverride,
  CleaningRegion,
  PixelRect,
  ManualRegionAction,
} from "@/lib/cleaning/types";
import { undoManager, type UndoActionKind } from "@/lib/undoManager";

interface MaskEditorProps {
  sourceUrl: string;
  cleanUrl?: string;
  maskUrl: string;
  proposalMaskUrl?: string;
  regions: CleaningRegion[];
  /** Page-pixel location of a suspected remnant; selects and marks its authorized region. */
  focusRect?: PixelRect;
  onClose: () => void;
  onRetry: (
    regionId: string,
    mask: Blob,
    cleaner: CleanerOverride,
    action: ManualRegionAction,
  ) => Promise<unknown>;
  onRefreshProposal?: (region: CleaningRegion) => Promise<{
    region: CleaningRegion;
    maskUrl: string;
  } | undefined>;
  onResolveRegion?: (region: CleaningRegion) => Promise<{
    region: CleaningRegion;
    proposalMaskUrl: string;
    remapped: boolean;
  } | undefined>;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}

const cleaners: { value: CleanerOverride; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "flat", label: "Flat" },
  { value: "opencv", label: "OpenCV" },
  { value: "aot", label: "AOT" },
  { value: "anime-lama", label: "AnimeLaMa" },
  { value: "lama-large", label: "LaMa Large" },
];

function maskHasPixels(mask: ImageData, rect: PixelRect): boolean {
  for (let y = Math.max(0, rect.y); y < Math.min(mask.height, rect.y + rect.height); y++) {
    for (let x = Math.max(0, rect.x); x < Math.min(mask.width, rect.x + rect.width); x++) {
      const offset = (y * mask.width + x) * 4;
      if (mask.data[offset + 3] > 0 && mask.data[offset + 2] !== 255) return true;
    }
  }
  return false;
}

function maskOverflow(mask: ImageData, rect: PixelRect): number {
  let overflow = 0;
  const data = mask.data;
  const width = mask.width;
  const height = mask.height;
  const rx = rect.x;
  const ry = rect.y;
  const rxEnd = rx + rect.width - 1;
  const ryEnd = ry + rect.height - 1;
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    const yOver = Math.max(ry - y, y - ryEnd);
    for (let x = 0; x < width; x++) {
      if (data[(rowOffset + x) * 4 + 3] === 0) continue;
      const xOver = Math.max(rx - x, x - rxEnd);
      const maxOver = xOver > yOver ? xOver : yOver;
      if (maxOver > overflow) overflow = maxOver;
    }
  }
  return overflow;
}

function normalizeDisplayMask(mask: ImageData, rect: PixelRect): ImageData {
  const normalized = cloneImageData(mask);
  const data = normalized.data;
  const width = mask.width;
  const height = mask.height;
  const rx = rect.x;
  const ry = rect.y;
  const rxEnd = rx + rect.width;
  const ryEnd = ry + rect.height;
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    const outY = y < ry || y >= ryEnd;
    for (let x = 0; x < width; x++) {
      if (outY || x < rx || x >= rxEnd) {
        data[(rowOffset + x) * 4 + 3] = 0;
      }
    }
  }
  return normalized;
}

async function encodeAuthorizedMask(mask: ImageData, rect: PixelRect, restoreOnly = false, excludedOnly = false): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = mask.width;
  canvas.height = mask.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("สร้าง Mask ไม่สำเร็จ");
  const grayscale = context.createImageData(mask.width, mask.height);
  const gData = grayscale.data;
  const mData = mask.data;
  const width = mask.width;
  const height = mask.height;
  for (let i = 3, len = gData.length; i < len; i += 4) {
    gData[i] = 255;
  }
  const minY = Math.max(0, rect.y);
  const maxY = Math.min(height, rect.y + rect.height);
  const minX = Math.max(0, rect.x);
  const maxX = Math.min(width, rect.x + rect.width);
  for (let y = minY; y < maxY; y++) {
    const rowOffset = y * width;
    for (let x = minX; x < maxX; x++) {
      const index = (rowOffset + x) * 4;
      const selected = excludedOnly
        ? isExcludedPixel(mask, index)
        : restoreOnly
          ? mData[index + 2] === 255
          : mData[index + 2] !== 255;
      if (selected && (excludedOnly || mData[index + 3] > 0)) {
        gData[index] = 255;
        gData[index + 1] = 255;
        gData[index + 2] = 255;
      }
    }
  }
  context.putImageData(grayscale, 0, 0);
  try {
    return await canvasToBlob(canvas);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

function isRecoveredResult(value: unknown): value is { recoveredRegionId: string; regions: CleaningRegion[] } {
  return typeof value === "object" && value !== null &&
    "recoveredRegionId" in value && typeof value.recoveredRegionId === "string" &&
    "regions" in value && Array.isArray(value.regions);
}

function loadMaskImage(url: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onerror = () => reject(new Error("โหลด Mask ที่เสนอใหม่ไม่สำเร็จ"));
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) return reject(new Error("อ่าน Mask ที่เสนอใหม่ไม่สำเร็จ"));
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height);
      canvas.width = 0;
      canvas.height = 0;
      for (let i = 0; i < data.data.length; i += 4) {
        const alpha = data.data[i] > 16 ? 150 : 0;
        data.data[i] = 255;
        data.data[i + 1] = 55;
        data.data[i + 2] = 80;
        data.data[i + 3] = alpha;
      }
      resolve(data);
    };
    image.src = url;
  });
}

export function MaskEditor({
  sourceUrl,
  cleanUrl,
  maskUrl,
  proposalMaskUrl,
  regions,
  focusRect,
  onClose,
  onRetry,
  onRefreshProposal,
  onResolveRegion,
  returnFocusRef,
}: MaskEditorProps) {
  const titleId = useId();
  const instructionsId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const sourceImageRef = useRef<HTMLImageElement>(null);
  const [comparison, setComparison] = useState<"original" | "cleaned">(cleanUrl ? "cleaned" : "original");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const brushCursorRef = useRef<HTMLDivElement>(null);
  const brushPointRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const canvasBoundsRef = useRef<DOMRect | null>(null);
  const imageDataRef = useRef<ImageData | undefined>(undefined);
  const drawingRef = useRef(false);
  const loadedRegionRef = useRef("");
  // Unsaved strokes per region: switching balloons must not wipe what the
  // user painted, and coming back must restore their work in progress.
  const regionSnapshotsRef = useRef<Map<string, ImageData>>(new Map());
  const setBoundedRegionSnapshot = (key: string, data: ImageData) => {
    const map = regionSnapshotsRef.current;
    if (map.has(key)) map.delete(key);
    map.set(key, data);
    while (map.size > 6) {
      const oldest = map.keys().next().value;
      if (oldest !== undefined) map.delete(oldest);
      else break;
    }
  };
  // Bounded undo memory: one base snapshot per edit window plus compact
  // stroke operations — never two full-page ImageData clones per stroke.
  const strokeOpsRef = useRef<Array<{ points: MaskPoint[]; radius: number; mode: BrushMode }>>([]);
  const strokeStartIndexRef = useRef(0);
  const opsBaseRef = useRef<ImageData | null>(null);
  const activeUndoDisposersRef = useRef<Array<() => void>>([]);
  const submittingRef = useRef(false);
  const maskGenerationsRef = useRef<Map<string, number>>(new Map());

  // The manager also owns unrelated workspace edits. Retire only callbacks
  // belonging to a restored region, and never replay into another selection.
  const pushMaskUndo = (action: {
    label: string;
    undo: () => void;
    redo: () => void;
    kind?: UndoActionKind;
    dispose?: () => void;
  }) => {
    const key = loadedRegionRef.current;
    const generation = maskGenerationsRef.current.get(key) ?? 0;
    const guard = (callback: () => void) => () => {
      if (submittingRef.current || loadedRegionRef.current !== key ||
        (maskGenerationsRef.current.get(key) ?? 0) !== generation) return;
      callback();
    };
    undoManager.push({
      label: action.label,
      undo: guard(action.undo),
      redo: guard(action.redo),
      kind: action.kind ?? "raster",
      dispose: action.dispose,
    });
  };

  const snapshotOpsBase = () => {
    opsBaseRef.current = imageDataRef.current ? cloneImageData(imageDataRef.current) : null;
    strokeOpsRef.current = [];
    strokeStartIndexRef.current = 0;
  };

  const renderReplayedOps = (
    base: ImageData,
    ops: Array<{ points: MaskPoint[]; radius: number; mode: BrushMode }>,
    count: number,
  ) => {
    let current = cloneImageData(base);
    for (let index = 0; index < count && index < ops.length; index++) {
      current = applyEditorBrush(current, ops[index].points, ops[index].radius, ops[index].mode);
    }
    renderMask(current);
  };

  const [mode, setMode] = useState<BrushMode>("paint");
  const [radius, setRadius] = useState(8);
  const [cleaner, setCleaner] = useState<CleanerOverride>("auto");
  const [regionId, setRegionId] = useState(regions[0]?.id ?? "");
  const selectedRegion = regions.find(region => region.id === regionId);
  const currentIndex = regions.findIndex(region => region.id === regionId);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFastInpainting, setIsFastInpainting] = useState(false);
  const [dilationRadius, setDilationRadius] = useState(0);
  const baseRegionMaskRef = useRef<Map<string, ImageData>>(new Map());
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
  const confirmedRegionRef = useRef<Set<string>>(new Set());
  const [aiAudit, setAiAudit] = useState<AiMaskAuditResult | null>(null);
  const [aiViewMode, setAiViewMode] = useState<AiMaskViewMode>("diff");
  const [isRequestingGeminiMask, setIsRequestingGeminiMask] = useState(false);
  const cachedSourceImgRef = useRef<HTMLImageElement | null>(null);
  const cachedCleanImgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    cachedSourceImgRef.current = null;
  }, [sourceUrl]);

  useEffect(() => {
    cachedCleanImgRef.current = null;
  }, [cleanUrl]);

  const resolveLoadedImage = async (
    url: string | undefined,
    cacheRef: React.MutableRefObject<HTMLImageElement | null>,
    isCurrentDisplay: boolean,
  ): Promise<HTMLImageElement | null> => {
    if (!url) return null;
    if (cacheRef.current && cacheRef.current.naturalWidth > 0) {
      return cacheRef.current;
    }
    if (
      isCurrentDisplay &&
      sourceImageRef.current &&
      sourceImageRef.current.naturalWidth > 0
    ) {
      cacheRef.current = sourceImageRef.current;
      return sourceImageRef.current;
    }
    if (typeof Image === "undefined") return sourceImageRef.current;
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        cacheRef.current = img;
        resolve(img);
      };
      img.onerror = () => resolve(isCurrentDisplay ? sourceImageRef.current : null);
      img.src = url;
    });
  };

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

  const renderMask = (
    imageData: ImageData,
    dirtyRect?: { x: number; y: number; width: number; height: number } | null,
  ) => {
    imageDataRef.current = imageData;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    if (dirtyRect && dirtyRect.width > 0 && dirtyRect.height > 0) {
      try {
        ctx.putImageData(
          imageData,
          0,
          0,
          dirtyRect.x,
          dirtyRect.y,
          dirtyRect.width,
          dirtyRect.height,
        );
        return;
      } catch {
        // Fallback to full putImageData if test mock only accepts 3 args
      }
    }
    ctx.putImageData(imageData, 0, 0);
  };

  const paintCanvasOverlayOnly = (overlayData: ImageData) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(overlayData, 0, 0);
  };

  useEffect(() => {
    closeRef.current?.focus();
    const regionSnapshots = regionSnapshotsRef.current;
    const maskGenerations = maskGenerationsRef.current;
    const undoDisposers = activeUndoDisposersRef.current;
    const canvasEl = canvasRef.current;
    return () => {
      for (const [k, gen] of maskGenerations.entries()) {
        maskGenerations.set(k, gen + 1);
      }
      for (const dispose of undoDisposers) {
        dispose();
      }
      undoDisposers.length = 0;
      regionSnapshots.clear();
      baseRegionMaskRef.current.clear();
      cachedSourceImgRef.current = null;
      cachedCleanImgRef.current = null;
      opsBaseRef.current = null;
      imageDataRef.current = undefined;
      strokeOpsRef.current = [];
      if (canvasEl) {
        canvasEl.width = 0;
        canvasEl.height = 0;
      }
    };
  }, []);

  useEffect(() => {
    setAiAudit(null);
    setAiViewMode("diff");
    const key = `${sourceUrl}:${regionId}`;
    if (loadedRegionRef.current === key && imageDataRef.current) return;
    if (loadedRegionRef.current && imageDataRef.current) {
      setBoundedRegionSnapshot(loadedRegionRef.current, imageDataRef.current);
    }
    const existingSnapshot = regionSnapshotsRef.current.get(key);
    if (
      existingSnapshot &&
      canvasRef.current &&
      canvasRef.current.width === existingSnapshot.width &&
      canvasRef.current.height === existingSnapshot.height
    ) {
      setBrushPoint({
        x: Math.round(existingSnapshot.width / 2),
        y: Math.round(existingSnapshot.height / 2),
      });
      renderMask(existingSnapshot);
      snapshotOpsBase();
      loadedRegionRef.current = key;
      return;
    }
    let active = true;
    let readingProposal = false;
    const maskImage = new Image();
    maskImage.onload = () => {
      if (!active || !canvasRef.current) return;
      const canvas = canvasRef.current;
      if (canvas.width !== maskImage.naturalWidth) {
        canvas.width = maskImage.naturalWidth;
      }
      if (canvas.height !== maskImage.naturalHeight) {
        canvas.height = maskImage.naturalHeight;
      }
      setCanvasSize((prev) =>
        prev.width === maskImage.naturalWidth && prev.height === maskImage.naturalHeight
          ? prev
          : { width: maskImage.naturalWidth, height: maskImage.naturalHeight },
      );
      setBrushPoint({
        x: Math.round(maskImage.naturalWidth / 2),
        y: Math.round(maskImage.naturalHeight / 2),
      });
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.clearRect?.(0, 0, canvas.width, canvas.height);
      context.drawImage(maskImage, 0, 0);
      const source = context.getImageData(0, 0, canvas.width, canvas.height);
      const r = regions.find(region => region.id === regionId)?.rect;
      const sData = source.data;
      const cWidth = canvas.width;
      const cHeight = canvas.height;
      const rx0 = r ? r.x : 0;
      const ry0 = r ? r.y : 0;
      const rx1 = r ? r.x + r.width : 0;
      const ry1 = r ? r.y + r.height : 0;
      for (let y = 0; y < cHeight; y++) {
        const inY = r !== undefined && y >= ry0 && y < ry1;
        const rowOffset = y * cWidth;
        for (let x = 0; x < cWidth; x++) {
          const index = (rowOffset + x) * 4;
          const activePixel = inY && x >= rx0 && x < rx1 && sData[index] > 16;
          sData[index] = 255;
          sData[index + 1] = 55;
          sData[index + 2] = 80;
          sData[index + 3] = activePixel ? 150 : 0;
        }
      }
      const snapshot = regionSnapshotsRef.current.get(key);
      const rect = r;
      // Review status also applies to regions that were already cleaned.
      // Show their actual removal mask; use a proposal only for an empty region.
      if (!snapshot && !readingProposal && rect && !maskHasPixels(source, rect) &&
        selectedRegion?.textRole === "review" && proposalMaskUrl && proposalMaskUrl !== maskUrl) {
        readingProposal = true;
        maskImage.src = proposalMaskUrl;
        return;
      }
      if (snapshot && snapshot.width === source.width && snapshot.height === source.height) {
        // Returning to a region the user already edited: keep their strokes
        // (undo history restarts from the restored state).
        renderMask(snapshot);
        baseRegionMaskRef.current.set(key, cloneImageData(snapshot));
      } else {
        renderMask(source);
        baseRegionMaskRef.current.set(key, cloneImageData(source));
      }
      setDilationRadius(0);
      snapshotOpsBase();
      loadedRegionRef.current = key;
    };
    maskImage.onerror = () => {
      if (active) setStatusMessage("โหลด Mask ไม่สำเร็จ กรุณาคลีนหน้านี้ใหม่แล้วเปิด Mask อีกครั้ง");
    };
    maskImage.src = maskUrl;
    return () => {
      active = false;
    };
  }, [sourceUrl, maskUrl, proposalMaskUrl, regionId, regions, selectedRegion?.textRole]);

  const lastStrokePointRef = useRef<MaskPoint | null>(null);

  const updateBrushCursorDom = (point: { x: number; y: number }, width: number, height: number) => {
    brushPointRef.current = point;
    const cursorEl = brushCursorRef.current;
    if (cursorEl && width > 0 && height > 0) {
      cursorEl.style.left = `${(point.x / width) * 100}%`;
      cursorEl.style.top = `${(point.y / height) * 100}%`;
    }
  };

  const drawAt = (event: React.PointerEvent<HTMLCanvasElement>, appendToCurrentStroke = false) => {
    const canvas = canvasRef.current;
    const current = imageDataRef.current;
    if (submittingRef.current || !canvas || !current) return;
    const bounds =
      appendToCurrentStroke && canvasBoundsRef.current
        ? canvasBoundsRef.current
        : canvas.getBoundingClientRect();
    canvasBoundsRef.current = bounds;
    const point = {
      x: (event.clientX - bounds.left) * (canvas.width / Math.max(1, bounds.width)),
      y: (event.clientY - bounds.top) * (canvas.height / Math.max(1, bounds.height)),
    };
    updateBrushCursorDom(point, canvas.width, canvas.height);
    if (!appendToCurrentStroke) {
      setBrushPoint(point);
    }
    const points =
      appendToCurrentStroke && lastStrokePointRef.current
        ? interpolateBrushPoints(lastStrokePointRef.current, point, radius)
        : [point];
    lastStrokePointRef.current = point;

    if (appendToCurrentStroke && strokeOpsRef.current.length > strokeStartIndexRef.current) {
      const activeOp = strokeOpsRef.current[strokeOpsRef.current.length - 1];
      activeOp.points.push(...points);
    } else {
      strokeOpsRef.current.push({ points: [...points], radius, mode });
    }
    const dirtyRect = applyEditorBrushInPlace(current, points, radius, mode);
    renderMask(current, dirtyRect);
  };

  const startStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (submittingRef.current) return;
    if (isSpacePressedRef.current || event.button === 1 || event.button === 2) {
      setIsPanning(true);
      panStartRef.current = { x: event.clientX - pan.x, y: event.clientY - pan.y };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (!imageDataRef.current) return;
    if (aiAudit) {
      const activeMask = aiViewMode === "ai" ? cloneImageData(aiAudit.suggestedMask) : cloneImageData(aiAudit.baseMask);
      renderMask(activeMask);
      if (aiViewMode === "ai") snapshotOpsBase();
      setAiAudit(null);
    }
    drawingRef.current = true;
    canvasBoundsRef.current = event.currentTarget.getBoundingClientRect();
    strokeStartIndexRef.current = strokeOpsRef.current.length;
    lastStrokePointRef.current = null;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawAt(event, false);
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
      drawAt(event, true);
    }
  };

  const finishStroke = () => {
    if (isPanning) {
      setIsPanning(false);
      return;
    }
    canvasBoundsRef.current = null;
    lastStrokePointRef.current = null;
    if (!drawingRef.current || !imageDataRef.current) {
      return;
    }
    drawingRef.current = false;
    setBrushPoint(brushPointRef.current);
    const startIndex = strokeStartIndexRef.current;
    const endIndex = strokeOpsRef.current.length;
    if (endIndex === startIndex || !opsBaseRef.current) {
      return;
    }
    const holder: { base: ImageData | null; ops: Array<{ points: MaskPoint[]; radius: number; mode: BrushMode }> } = {
      base: opsBaseRef.current,
      ops: [...strokeOpsRef.current],
    };
    const dispose = () => {
      holder.base = null;
      holder.ops = [];
    };
    activeUndoDisposersRef.current.push(dispose);
    pushMaskUndo({
      label: "แก้ Mask",
      kind: "raster",
      dispose,
      undo: () => {
        if (holder.base) renderReplayedOps(holder.base, holder.ops, startIndex);
      },
      redo: () => {
        if (holder.base) renderReplayedOps(holder.base, holder.ops, endIndex);
      },
    });
    if (imageDataRef.current) {
      baseRegionMaskRef.current.set(loadedRegionRef.current, cloneImageData(imageDataRef.current));
      setDilationRadius(0);
    }
  };

  const handleDilationChange = (radius: number) => {
    setDilationRadius(radius);
    if (!selectedRegion || !imageDataRef.current) return;
    const base = baseRegionMaskRef.current.get(loadedRegionRef.current);
    if (!base) return;
    if (radius <= 0) {
      renderMask(normalizeDisplayMask(base, selectedRegion.rect));
      setStatusMessage("ขนาด Mask ปกติ");
      return;
    }
    const dilated = dilateMask(base, radius, selectedRegion.rect);
    renderMask(normalizeDisplayMask(dilated, selectedRegion.rect));
    setStatusMessage(`ขยายขอบ Mask +${radius}px (Dilation)`);
  };

  const handleFastCropInpaint = async () => {
    if (submittingRef.current || !selectedRegion || !imageDataRef.current) return;
    const r = selectedRegion.rect;
    if (!r || r.width <= 0 || r.height <= 0) return;

    const sourceImg = await resolveLoadedImage(sourceUrl, cachedSourceImgRef, true);
    if (!sourceImg) {
      setStatusMessage("ไม่สามารถโหลดภาพต้นฉบับเพื่อคลีนเฉพาะจุดได้");
      return;
    }

    submittingRef.current = true;
    setIsFastInpainting(true);
    setStatusMessage("⚡ กำลังคลีนเฉพาะจุดด้วย Fast LaMa…");
    const started = performance.now();

    try {
      const pad = 16;
      const x0 = Math.max(0, r.x - pad);
      const y0 = Math.max(0, r.y - pad);
      const x1 = Math.min(canvasSize.width, r.x + r.width + pad);
      const y1 = Math.min(canvasSize.height, r.y + r.height + pad);
      const cropW = Math.max(1, x1 - x0);
      const cropH = Math.max(1, y1 - y0);

      const imgCanvas = document.createElement("canvas");
      imgCanvas.width = cropW;
      imgCanvas.height = cropH;
      const imgCtx = imgCanvas.getContext("2d");
      if (!imgCtx) throw new Error("Canvas context creation failed");
      imgCtx.drawImage(sourceImg, x0, y0, cropW, cropH, 0, 0, cropW, cropH);
      const cropImgBlob = await canvasToBlob(imgCanvas);

      const maskCanvas = document.createElement("canvas");
      maskCanvas.width = cropW;
      maskCanvas.height = cropH;
      const maskCtx = maskCanvas.getContext("2d");
      if (!maskCtx) throw new Error("Mask canvas context creation failed");

      const currentMask = imageDataRef.current;
      const maskCropData = maskCtx.createImageData(cropW, cropH);
      for (let y = 0; y < cropH; y++) {
        const srcY = y0 + y;
        const srcRow = srcY * currentMask.width;
        const dstRow = y * cropW;
        for (let x = 0; x < cropW; x++) {
          const srcX = x0 + x;
          const srcIdx = (srcRow + srcX) * 4;
          const dstIdx = (dstRow + x) * 4;
          const active = currentMask.data[srcIdx + 3] > 0 && currentMask.data[srcIdx + 2] !== 255;
          if (active) {
            maskCropData.data[dstIdx] = 255;
            maskCropData.data[dstIdx + 1] = 255;
            maskCropData.data[dstIdx + 2] = 255;
            maskCropData.data[dstIdx + 3] = 255;
          } else {
            maskCropData.data[dstIdx + 3] = 255;
          }
        }
      }
      maskCtx.putImageData(maskCropData, 0, 0);
      const cropMaskBlob = await canvasToBlob(maskCanvas);

      await inpaintCrop(cropImgBlob, cropMaskBlob, {
        cleaner,
        dilation: dilationRadius,
      });

      const authMaskBlob = await encodeAuthorizedMask(currentMask, r);
      await onRetry(regionId, authMaskBlob, cleaner, "force-clean");

      const elapsed = Math.round(performance.now() - started);
      setStatusMessage(`⚡ คลีนจุด #${currentIndex + 1} เรียบร้อย (${elapsed}ms)`);
      setComparison("cleaned");
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "คลีนเฉพาะจุดไม่สำเร็จ");
    } finally {
      submittingRef.current = false;
      setIsFastInpainting(false);
    }
  };

  // Quick Action: Fill Region with Mask
  const handleFillRegion = () => {
    const current = imageDataRef.current;
    if (submittingRef.current || !current || !selectedRegion) return;
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
    const holder: { before: ImageData | null; after: ImageData | null } = { before, after: updated };
    const dispose = () => {
      holder.before = null;
      holder.after = null;
    };
    activeUndoDisposersRef.current.push(dispose);
    pushMaskUndo({
      label: "เติม Mask เต็มกรอบ",
      kind: "raster",
      dispose,
      undo: () => {
        if (!holder.before) return;
        renderMask(cloneImageData(holder.before));
        snapshotOpsBase();
      },
      redo: () => {
        if (!holder.after) return;
        renderMask(cloneImageData(holder.after));
        snapshotOpsBase();
      },
    });
    snapshotOpsBase();
    setStatusMessage("เติม Mask เต็มกรอบแล้ว");
  };

  // Quick Action: Clear Region Mask
  const handleClearRegion = () => {
    const current = imageDataRef.current;
    if (submittingRef.current || !current || !selectedRegion) return;
    const before = cloneImageData(current);
    const updated = cloneImageData(current);
    const r = selectedRegion.rect;
    for (let y = r.y; y < r.y + r.height; y++) {
      for (let x = r.x; x < r.x + r.width; x++) {
        if (x >= 0 && x < updated.width && y >= 0 && y < updated.height) {
          const offset = (y * updated.width + x) * 4;
          if (
            (current.data[offset + 3] > 0 && current.data[offset + 2] !== 255) ||
            isExcludedPixel(current, offset)
          ) {
            updated.data[offset] = 255;
            updated.data[offset + 1] = 0;
            updated.data[offset + 2] = 1;
          }
          updated.data[offset + 3] = 0;
        }
      }
    }
    renderMask(updated);
    const holder: { before: ImageData | null; after: ImageData | null } = { before, after: updated };
    const dispose = () => {
      holder.before = null;
      holder.after = null;
    };
    activeUndoDisposersRef.current.push(dispose);
    pushMaskUndo({
      label: "ล้าง Mask ในกรอบ",
      kind: "raster",
      dispose,
      undo: () => {
        if (!holder.before) return;
        renderMask(cloneImageData(holder.before));
        snapshotOpsBase();
      },
      redo: () => {
        if (!holder.after) return;
        renderMask(cloneImageData(holder.after));
        snapshotOpsBase();
      },
    });
    snapshotOpsBase();
    setStatusMessage("ล้าง Mask ในกรอบแล้ว");
  };

  // Region Carousel Stepper
  const goToRegion = (index: number) => {
    if (!submittingRef.current && index >= 0 && index < regions.length) {
      setRegionId(regions[index].id);
      setStatusMessage(`เลือกจุดที่ ${index + 1}`);
    }
  };

  const selectedRegionId = selectedRegion?.id;
  const selectedRectX = selectedRegion?.rect.x;
  const selectedRectY = selectedRegion?.rect.y;
  const selectedRectW = selectedRegion?.rect.width;
  const selectedRectH = selectedRegion?.rect.height;

  const fitSelectedRegion = useCallback(() => {
    const workspace = workspaceRef.current;
    const image = sourceImageRef.current;
    if (
      !workspace ||
      !image ||
      selectedRegionId === undefined ||
      selectedRectX === undefined ||
      selectedRectY === undefined ||
      selectedRectW === undefined ||
      selectedRectH === undefined ||
      !canvasSize.width
    ) {
      return;
    }
    const imageWidth = image.clientWidth, imageHeight = image.clientHeight;
    if (!imageWidth || !imageHeight || !workspace.clientWidth || !workspace.clientHeight) return;
    setZoom(Math.max(0.5, Math.min(4, workspace.clientWidth / (imageWidth * selectedRectW / canvasSize.width + 96), workspace.clientHeight / (imageHeight * selectedRectH / canvasSize.height + 96))));
    setPan({ x: imageWidth * (0.5 - (selectedRectX + selectedRectW / 2) / canvasSize.width), y: imageHeight * (0.5 - (selectedRectY + selectedRectH / 2) / canvasSize.height) });
  }, [selectedRegionId, selectedRectX, selectedRectY, selectedRectW, selectedRectH, canvasSize.width, canvasSize.height]);
  useEffect(() => { fitSelectedRegion(); }, [fitSelectedRegion]);

  // Remnant navigation: bring the finding's authorized removal region into
  // view and mark the exact suspected location for original/clean comparison.
  // Editing stays clipped to the region's normalized bounds as before.
  const appliedFocusRef = useRef("");
  useEffect(() => {
    const key = focusRect ? `${focusRect.x},${focusRect.y},${focusRect.width},${focusRect.height}` : "";
    if (!focusRect || !canvasSize.width || appliedFocusRef.current === key) return;
    appliedFocusRef.current = key;
    const target = findRegionForCandidate(regions, focusRect);
    if (!target) return;
    if (target.id !== regionId) {
      setRegionId(target.id);
      const targetIndex = regions.findIndex((region) => region.id === target.id);
      setStatusMessage(`เลือกจุดที่ ${targetIndex + 1} จากจุดสงสัย`);
    }
    setBrushPoint({
      x: Math.max(0, Math.min(canvasSize.width - 1, Math.round(focusRect.x + focusRect.width / 2))),
      y: Math.max(0, Math.min(canvasSize.height - 1, Math.round(focusRect.y + focusRect.height / 2))),
    });
  }, [focusRect, canvasSize.width, canvasSize.height, regions, regionId]);

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
    if (event.key === " " && event.target === canvasRef.current) {
      event.preventDefault();
      isSpacePressedRef.current = true;
    }
    if (event.key !== "Tab") return;

    const candidates = dialogRef.current?.querySelectorAll<HTMLElement>(
      'summary, button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const focusable = Array.from(candidates ?? []).filter(element => { const details = element.closest("details"); return !details || details.open || element.tagName === "SUMMARY"; });
    if (focusable.length === 0) return;

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
    if (submittingRef.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
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

    // Space is reserved for panning: let it bubble to the dialog handler,
    // which owns the pan flag. Keyboard events never paint the mask.

    if (event.key === "[" || event.key === "]") {
      event.preventDefault();
      event.stopPropagation();
      const delta = event.key === "]" ? 1 : -1;
      const nextRadius = Math.max(2, Math.min(48, radius + delta));
      setRadius(nextRadius);
      setStatusMessage(`ขนาดแปรง ${nextRadius} พิกเซล`);
      return;
    }

    if (!event.ctrlKey && !event.metaKey && !event.altKey && (event.key === "1" || event.key === "2" || event.key === "3")) {
      event.preventDefault();
      event.stopPropagation();
      handleModeChange(event.key === "1" ? "paint" : event.key === "2" ? "restore" : "erase");
      return;
    }

    if ((event.ctrlKey || event.metaKey) && (event.key === "y" || event.key === "Y" || ((event.key === "z" || event.key === "Z") && event.shiftKey))) {
      event.preventDefault();
      event.stopPropagation();
      const action = undoManager.redo();
      if (action) {
        setStatusMessage("ทำซ้ำแล้ว");
      }
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

  const submit = async (action: ManualRegionAction, restoreOnly = false, excludedOnly = false) => {
    const imageData = imageDataRef.current;
    if (submittingRef.current || !imageData || !regionId) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const r = selectedRegion?.rect;
      // Brush pixels outside the region are clipped by encodeAuthorizedMask
      // (and again by the backend's authorization gate), so overflow never
      // blocks a submit — it only marks the result as adjusted below.
      if (r && action === "force-clean" && !maskHasPixels(imageData, r)) {
        setStatusMessage("ไม่มี Mask ที่ใช้คลีนได้ กรุณาวาด Mask หรือกดเติมเต็มกรอบเอง");
        return;
      }

      let effectiveRegionId = regionId;
      let adjusted = false;
      if (restoreOnly && r && !hasRestorePixels(imageData, r)) {
        setStatusMessage("ระบายจุดที่ต้องการกู้ภาพเดิมก่อน แล้วกดใช้กับจุดนี้");
        return;
      }
      let blob = await encodeAuthorizedMask(imageData, r ?? { x: 0, y: 0, width: 0, height: 0 }, restoreOnly, excludedOnly);

      if (action === "force-clean" && selectedRegion && selectedRegion.textConfirmed !== true &&
        !confirmedRegionRef.current.has(effectiveRegionId)) {
        const confirmed = await onRetry(effectiveRegionId, blob, cleaner, "confirm-text");
        if (!confirmed) {
          setStatusMessage("ยืนยันข้อความไม่สำเร็จ กรุณาลองใหม่");
          return;
        }
        if (isRecoveredResult(confirmed)) {
          adjusted = true;
          const recovered = confirmed.regions.find((item) => item.id === confirmed.recoveredRegionId);
          if (recovered) {
            effectiveRegionId = recovered.id;
            blob = await encodeAuthorizedMask(imageData, recovered.rect);
            loadedRegionRef.current = `${sourceUrl}:${recovered.id}`;
            renderMask(normalizeDisplayMask(imageData, recovered.rect));
            setRegionId(recovered.id);
          }
        }
        confirmedRegionRef.current.add(effectiveRegionId);
      }

      const result = await onRetry(effectiveRegionId, blob, cleaner, action);
      if (!result) {
        setStatusMessage("บันทึก Mask ไม่สำเร็จ กรุณาลองใหม่");
        return;
      }
      if (action === "protect") {
        const restoredId = isRecoveredResult(result) ? result.recoveredRegionId : effectiveRegionId;
        const restoredKey = `${sourceUrl}:${restoredId}`;
        const cleanedDraft = cloneImageData(imageData);
        let hadVisibleBlue = false;
        for (let idx = 0; idx < cleanedDraft.data.length; idx += 4) {
          if (cleanedDraft.data[idx + 2] === 255 && cleanedDraft.data[idx + 3] > 0) {
            hadVisibleBlue = true;
            cleanedDraft.data[idx] = 255;
            cleanedDraft.data[idx + 1] = 55;
            cleanedDraft.data[idx + 2] = 80;
            cleanedDraft.data[idx + 3] = 0;
          } else if (isExcludedPixel(cleanedDraft, idx)) {
            cleanedDraft.data[idx] = 255;
            cleanedDraft.data[idx + 1] = 55;
            cleanedDraft.data[idx + 2] = 80;
            cleanedDraft.data[idx + 3] = 0;
          }
        }
        imageDataRef.current = cleanedDraft;
        setBoundedRegionSnapshot(restoredKey, cleanedDraft);
        loadedRegionRef.current = restoredKey;
        if (hadVisibleBlue) {
          renderMask(cleanedDraft);
        }
        snapshotOpsBase();
        if (restoredId !== regionId) setRegionId(restoredId);
        if (cleanUrl) setComparison("cleaned");
      }
      if (action === "confirm-text") {
        const confirmedId = isRecoveredResult(result) ? result.recoveredRegionId : regionId;
        confirmedRegionRef.current.add(confirmedId);
        if (isRecoveredResult(result)) {
          const recovered = result.regions.find((item) => item.id === confirmedId);
          if (recovered) {
            loadedRegionRef.current = `${sourceUrl}:${confirmedId}`;
            renderMask(normalizeDisplayMask(imageData, recovered.rect));
            setRegionId(confirmedId);
          }
          setStatusMessage("ยืนยันข้อความแล้วและจับคู่พื้นที่ใหม่ กรุณาตรวจ Mask ก่อนคลีน");
        } else {
          setStatusMessage("ยืนยันข้อความแล้ว ตรวจพื้นที่สีแดงที่จะลบเฉพาะบริเวณที่เลือก");
        }
      } else if (isRecoveredResult(result) || adjusted || (r && maskOverflow(imageData, r) > 0)) {
        setStatusMessage("ปรับ Mask หรือจับคู่พื้นที่ใหม่แล้ว กรุณาตรวจบริเวณที่คลีนก่อนปิด");
      } else {
        setStatusMessage("ใช้กับจุดนี้แล้ว");
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "บันทึกไม่สำเร็จ");
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleRestoreWholeRegion = async () => {
    const current = imageDataRef.current;
    if (submittingRef.current || !current || !selectedRegion ||
      loadedRegionRef.current !== `${sourceUrl}:${selectedRegion.id}`) return;
    const selectedId = selectedRegion.id;
    const rect = { ...selectedRegion.rect };
    const key = `${sourceUrl}:${selectedId}`;
    const selectedCleaner = cleaner;
    const selection = new ImageData(new Uint8ClampedArray(current.width * current.height * 4), current.width, current.height);
    for (let y = Math.max(0, rect.y); y < Math.min(selection.height, rect.y + rect.height); y++) {
      for (let x = Math.max(0, rect.x); x < Math.min(selection.width, rect.x + rect.width); x++) {
        const offset = (y * selection.width + x) * 4;
        selection.data[offset + 2] = 255;
        selection.data[offset + 3] = 150;
      }
    }
    submittingRef.current = true;
    drawingRef.current = false;
    setIsSubmitting(true);
    setStatusMessage("กำลังกู้ภาพเดิมทั้งจุด…");
    try {
      const blob = await encodeAuthorizedMask(selection, rect, true);
      const result = await onRetry(selectedId, blob, selectedCleaner, "protect");
      if (!result) {
        setStatusMessage("กู้ภาพเดิมไม่สำเร็จ กรุณาลองใหม่");
        return;
      }
      const restoredId = isRecoveredResult(result) ? result.recoveredRegionId : selectedId;
      const restoredKey = `${sourceUrl}:${restoredId}`;
      for (const retiredKey of new Set([key, restoredKey])) {
        maskGenerationsRef.current.set(retiredKey, (maskGenerationsRef.current.get(retiredKey) ?? 0) + 1);
        regionSnapshotsRef.current.delete(retiredKey);
      }
      // A cleared snapshot keeps old applied/proposal masks from resurrecting
      // the discarded draft while updated backend assets propagate.
      const cleared = new ImageData(new Uint8ClampedArray(current.width * current.height * 4), current.width, current.height);
      setBoundedRegionSnapshot(restoredKey, cleared);
      loadedRegionRef.current = restoredKey;
      renderMask(cleared);
      snapshotOpsBase();
      setRegionId(restoredId);
      setComparison("cleaned");
      setStatusMessage(isRecoveredResult(result)
        ? "กู้ภาพเดิมทั้งจุดแล้วและจับคู่พื้นที่ใหม่ กรุณาตรวจภาพที่คลีนแล้ว"
        : "กู้ภาพเดิมทั้งจุดแล้ว");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "กู้ภาพเดิมไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleSelectAiViewMode = (nextMode: AiMaskViewMode, targetAudit = aiAudit) => {
    setAiViewMode(nextMode);
    if (!targetAudit) return;
    if (nextMode === "diff") {
      paintCanvasOverlayOnly(targetAudit.diffMask);
    } else if (nextMode === "ai") {
      paintCanvasOverlayOnly(targetAudit.suggestedMask);
    } else {
      paintCanvasOverlayOnly(targetAudit.baseMask);
    }
  };

  const handleCloseAiAudit = () => {
    if (aiAudit) {
      renderMask(cloneImageData(aiAudit.baseMask));
    }
    setAiAudit(null);
    setAiViewMode("diff");
    setStatusMessage("ปิดโหมดเปรียบเทียบ AI Mask แล้ว");
  };

  const handleRunAiMaskAudit = async () => {
    const current = aiAudit ? aiAudit.baseMask : imageDataRef.current;
    if (submittingRef.current || !current || !selectedRegion) return;
    const [origImg, cleanImg] = await Promise.all([
      resolveLoadedImage(sourceUrl, cachedSourceImgRef, comparison === "original" || !cleanUrl),
      resolveLoadedImage(cleanUrl, cachedCleanImgRef, comparison === "cleaned"),
    ]);
    const originalCrop = extractImageRegionCrop(origImg, selectedRegion.rect);
    const cleanedCrop = extractImageRegionCrop(cleanImg, selectedRegion.rect);
    const audit = analyzeRegionMaskLocally({
      regionId: selectedRegion.id,
      rect: selectedRegion.rect,
      baseMask: current,
      originalCrop,
      cleanedCrop,
    });
    setAiAudit(audit);
    setAiViewMode("diff");
    paintCanvasOverlayOnly(audit.diffMask);
    setStatusMessage(audit.summary);
  };

  const handleAskGeminiMaskReview = async () => {
    if (submittingRef.current || isRequestingGeminiMask || !selectedRegion) return;
    const baseMask = aiAudit ? aiAudit.baseMask : imageDataRef.current;
    if (!baseMask) return;
    const [origImg, cleanImg] = await Promise.all([
      resolveLoadedImage(sourceUrl, cachedSourceImgRef, comparison === "original" || !cleanUrl),
      resolveLoadedImage(cleanUrl, cachedCleanImgRef, comparison === "cleaned"),
    ]);
    const originalCrop = extractImageRegionCrop(origImg, selectedRegion.rect);
    const cleanedCrop = extractImageRegionCrop(cleanImg, selectedRegion.rect);
    const baseAudit =
      aiAudit ??
      analyzeRegionMaskLocally({
        regionId: selectedRegion.id,
        rect: selectedRegion.rect,
        baseMask,
        originalCrop,
        cleanedCrop,
      });
    if (!aiAudit) {
      setAiAudit(baseAudit);
      setAiViewMode("diff");
      paintCanvasOverlayOnly(baseAudit.diffMask);
    }
    const strip = buildRegionComparisonStripBase64({
      rect: selectedRegion.rect,
      originalCrop,
      cleanedCrop,
      maskData: baseMask,
    });
    if (!strip) {
      setStatusMessage("ใช้ผลวิเคราะห์ Local AI แล้ว (ไม่สามารถสร้างภาพส่ง Gemini ในโหมดจำลอง)");
      return;
    }
    setIsRequestingGeminiMask(true);
    setStatusMessage("กำลังส่งภาพจุดนี้ให้ Gemini Vision ช่วยตรวจเทียบ Mask…");
    try {
      const apiKey =
        typeof localStorage !== "undefined"
          ? localStorage.getItem("gemini_api_key") ||
            localStorage.getItem("manga_gemini_api_key") ||
            ""
          : "";
      const response = await fetch("/api/mask-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: strip.base64,
          mimeType: strip.mimeType,
          regionId: selectedRegion.id,
          localStats: baseAudit.stats,
          apiKey,
        }),
      });
      const payload = (await response.json()) as Partial<GeminiMaskReviewPayload> & {
        error?: string;
      };
      if (!response.ok || !payload || typeof payload.summary !== "string") {
        setStatusMessage(
          payload?.error ||
            "ไม่สามารถเรียก Gemini Vision ได้ในขณะนี้ ระบบแสดงผลเทียบจาก Local AI ให้แทน",
        );
        return;
      }
      const refined = applyGeminiMaskReviewToSuggestion(
        baseAudit,
        {
          verdict: payload.verdict ?? baseAudit.verdict,
          summary: payload.summary,
          addBoxes: Array.isArray(payload.addBoxes) ? payload.addBoxes : [],
          protectBoxes: Array.isArray(payload.protectBoxes) ? payload.protectBoxes : [],
        },
        originalCrop,
      );
      setAiAudit(refined);
      setAiViewMode("diff");
      paintCanvasOverlayOnly(refined.diffMask);
      setStatusMessage(`Gemini: ${refined.summary}`);
    } catch {
      setStatusMessage("ใช้ผลเทียบจาก Local AI แทน (การเชื่อมต่อ Gemini ขัดข้อง)");
    } finally {
      setIsRequestingGeminiMask(false);
    }
  };

  const commitAiSuggestedMaskToCanvas = (): ImageData | null => {
    if (!aiAudit) return imageDataRef.current ?? null;
    const before = cloneImageData(aiAudit.baseMask);
    const after = cloneImageData(aiAudit.suggestedMask);
    renderMask(after);
    const holder: { before: ImageData | null; after: ImageData | null } = {
      before,
      after,
    };
    const dispose = () => {
      holder.before = null;
      holder.after = null;
    };
    activeUndoDisposersRef.current.push(dispose);
    pushMaskUndo({
      label: "ใช้ Mask ที่ AI แนะนำ",
      kind: "raster",
      dispose,
      undo: () => {
        if (!holder.before) return;
        renderMask(cloneImageData(holder.before));
        snapshotOpsBase();
      },
      redo: () => {
        if (!holder.after) return;
        renderMask(cloneImageData(holder.after));
        snapshotOpsBase();
      },
    });
    snapshotOpsBase();
    setAiAudit(null);
    setAiViewMode("diff");
    return after;
  };

  const handleApplyAiSuggestedMask = () => {
    if (!aiAudit || submittingRef.current) return;
    commitAiSuggestedMaskToCanvas();
    setStatusMessage("นำ Mask ที่ AI แนะนำมาใช้แล้ว (กด 'ใช้กับจุดนี้' เพื่อคลีน หรือ Ctrl+Z เพื่อเลิกทำ)");
  };

  // One-Click Clean: seamlessly confirms text if necessary and cleans the region immediately
  const handleOneClickClean = async (overrideMask?: ImageData) => {
    if (aiAudit && !overrideMask) {
      renderMask(cloneImageData(aiAudit.baseMask));
      setAiAudit(null);
    }
    const imageData = overrideMask ?? imageDataRef.current;
    if (submittingRef.current || !imageData || !regionId || !selectedRegion) return;
    if (!maskHasPixels(imageData, selectedRegion.rect)) {
      if (hasExcludedPixels(imageData, selectedRegion.rect)) {
        await submit("protect", false, true);
        return;
      }
      if (mode === "erase") {
        setStatusMessage("ไม่มีพื้นที่สีแดงที่จะลบ จุดนี้ยังไม่ได้เปลี่ยนภาพ");
        return;
      }
    }
    submittingRef.current = true;
    setIsSubmitting(true);
    setStatusMessage("กำลังคลีนข้อความจุดนี้...");
    try {
      let effectiveRegion = selectedRegion;
      let effectiveMask = imageData;
      // Overflow is clipped at encode time (and by the backend gate); it only
      // flags the adjusted notice below.
      const initialOverflow = maskOverflow(imageData, selectedRegion.rect);
      let adjusted = initialOverflow > 0;
      if (onResolveRegion) {
        const resolved = await onResolveRegion(selectedRegion);
        if (!resolved) {
          setStatusMessage("ไม่พบพื้นที่ Mask ที่ตรงกัน กรุณาตรวจและเลือกพื้นที่ใหม่");
          return;
        }
        effectiveRegion = resolved.region;
        adjusted = adjusted || resolved.remapped;
        if (resolved.remapped) {
          effectiveMask = normalizeDisplayMask(imageData, effectiveRegion.rect);
          loadedRegionRef.current = `${sourceUrl}:${effectiveRegion.id}`;
          renderMask(effectiveMask);
          setRegionId(effectiveRegion.id);
        }
        if (!maskHasPixels(effectiveMask, effectiveRegion.rect) && resolved.proposalMaskUrl) {
          effectiveMask = normalizeDisplayMask(await loadMaskImage(resolved.proposalMaskUrl), effectiveRegion.rect);
          if (maskHasPixels(effectiveMask, effectiveRegion.rect)) renderMask(effectiveMask);
        }
      }
      let hasPixels = maskHasPixels(effectiveMask, effectiveRegion.rect);
      if (!hasPixels && onRefreshProposal) {
        const refreshed = await onRefreshProposal(selectedRegion);
        if (refreshed) {
          effectiveRegion = refreshed.region;
          adjusted = adjusted || effectiveRegion.id !== regionId;
          effectiveMask = normalizeDisplayMask(await loadMaskImage(refreshed.maskUrl), effectiveRegion.rect);
          hasPixels = maskHasPixels(effectiveMask, effectiveRegion.rect);
          if (hasPixels) {
            renderMask(normalizeDisplayMask(effectiveMask, effectiveRegion.rect));
            if (effectiveRegion.id !== regionId) {
              loadedRegionRef.current = `${sourceUrl}:${effectiveRegion.id}`;
              setRegionId(effectiveRegion.id);
            }
          }
        }
      }
      if (!hasPixels) {
        setStatusMessage("ไม่มี Mask ที่ใช้คลีนได้ กรุณาวาด Mask หรือกดเติมเต็มกรอบเอง");
        return;
      }
      adjusted = adjusted || maskOverflow(effectiveMask, effectiveRegion.rect) > 0;
      let blob = await encodeAuthorizedMask(effectiveMask, effectiveRegion.rect);

      // Auto confirm text if needed by backend authorization gate.
      // retryRegion returns undefined when the cleaning job fails, so do not
      // continue to force-clean or close the editor unless each step succeeds.
      if (effectiveRegion.textConfirmed !== true && !confirmedRegionRef.current.has(effectiveRegion.id)) {
        const confirmed = await onRetry(effectiveRegion.id, blob, cleaner, "confirm-text");
        if (!confirmed) {
          setStatusMessage("ยืนยันข้อความไม่สำเร็จ กรุณาลองใหม่");
          return;
        }
        confirmedRegionRef.current.add(effectiveRegion.id);
        if (isRecoveredResult(confirmed)) {
          effectiveRegion = confirmed.regions.find((item) => item.id === confirmed.recoveredRegionId) ?? effectiveRegion;
          adjusted = true;
          blob = await encodeAuthorizedMask(effectiveMask, effectiveRegion.rect);
          loadedRegionRef.current = `${sourceUrl}:${effectiveRegion.id}`;
          renderMask(normalizeDisplayMask(effectiveMask, effectiveRegion.rect));
          setRegionId(effectiveRegion.id);
        }
      }
      const cleaned = await onRetry(effectiveRegion.id, blob, cleaner, "force-clean");
      if (!cleaned) {
        setStatusMessage("คลีนตาม Mask ไม่สำเร็จ กรุณาลองใหม่");
        return;
      }
      if (isRecoveredResult(cleaned)) adjusted = true;
      if (adjusted) {
        setStatusMessage("ปรับ Mask หรือจับคู่พื้นที่ใหม่แล้ว กรุณาตรวจบริเวณที่คลีนก่อนปิด");
      } else {
        setStatusMessage("ใช้กับจุดนี้แล้ว");
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "บันทึกไม่สำเร็จ");
    } finally {
      submittingRef.current = false;
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
                title="จุดก่อนหน้า"
                aria-label="จุดก่อนหน้า"
                disabled={isSubmitting || regions.length < 2}
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
                title="จุดถัดไป"
                aria-label="จุดถัดไป"
                disabled={isSubmitting || regions.length < 2}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-foreground active:scale-95"
              >
                <ChevronRight className="h-4 w-4" />
              </button>

              <select
                aria-label="จุดที่แก้ไข"
                disabled={isSubmitting}
                value={regionId}
                onChange={(event) => setRegionId(event.target.value)}
                className="h-7 rounded-md border-0 bg-transparent px-2 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
              >
                {regions.map((region, idx) => (
                  <option key={region.id} value={region.id} className="bg-surface text-foreground">
                    จุดที่ {idx + 1}
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

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2" aria-label="เปรียบเทียบภาพ">
          <div className="flex flex-wrap items-center gap-2">
            {cleanUrl && (["original", "cleaned"] as const).map(view => (
              <button
                key={view}
                type="button"
                aria-pressed={comparison === view}
                onClick={() => setComparison(view)}
                className={comparison === view ? "rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-content" : "rounded-md px-3 py-1.5 text-xs text-muted hover:bg-surface-hover hover:text-foreground"}
              >
                {view === "original" ? "ภาพเดิม" : "ภาพที่คลีนแล้ว"}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isSubmitting || !selectedRegion || !canvasSize.width}
              onClick={aiAudit ? handleCloseAiAudit : handleRunAiMaskAudit}
              className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
                aiAudit
                  ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30"
                  : "border-cyan-400/50 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25"
              } disabled:opacity-40`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>{aiAudit ? "กำลังเทียบ AI Mask" : "AI ตรวจ/เทียบ Mask"}</span>
            </button>

            <button
              type="button"
              disabled={isSubmitting || isRequestingGeminiMask || !selectedRegion || !canvasSize.width}
              onClick={handleAskGeminiMaskReview}
              className="flex items-center gap-1.5 rounded-md border border-purple-400/50 bg-purple-500/15 px-3 py-1.5 text-xs font-semibold text-purple-200 transition-colors hover:bg-purple-500/25 disabled:opacity-40"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>{isRequestingGeminiMask ? "Gemini กำลังดู…" : "ให้ Gemini วิเคราะห์จุดนี้"}</span>
            </button>
          </div>
        </div>

        {aiAudit && (
          <div
            role="region"
            aria-label="ผลเปรียบเทียบ AI Mask"
            className="flex flex-col gap-2 border-b border-emerald-500/30 bg-emerald-950/25 px-4 py-2.5 text-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-emerald-500/20 px-2 py-0.5 font-semibold text-emerald-300">
                  {aiAudit.source === "hybrid-gemini" ? "Hybrid (Local + Gemini Vision)" : "Local Smart AI"}
                </span>
                <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-emerald-200">
                  สีเขียว = ควรลบเพิ่ม +{aiAudit.stats.addedCount.toLocaleString()} px
                </span>
                <span className="rounded bg-sky-500/15 px-2 py-0.5 text-sky-200">
                  สีฟ้า = ควรเว้น/กู้คืน -{aiAudit.stats.removedCount.toLocaleString()} px
                </span>
                <span className="text-muted">
                  (ตรงกัน {aiAudit.stats.matchPercent}%)
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <div className="flex items-center gap-1 rounded-md border border-border/80 bg-background/80 p-0.5">
                  {([
                    { id: "diff", label: "เทียบจุดต่าง (Diff)" },
                    { id: "current", label: "Mask เดิม" },
                    { id: "ai", label: "Mask ของ AI" },
                  ] as const).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      aria-pressed={aiViewMode === tab.id}
                      onClick={() => handleSelectAiViewMode(tab.id)}
                      className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        aiViewMode === tab.id
                          ? "bg-emerald-500 text-neutral-950 font-semibold"
                          : "text-muted hover:text-foreground"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleApplyAiSuggestedMask}
                  className="rounded-md bg-emerald-500/25 border border-emerald-400/50 px-2.5 py-1 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-500/35"
                >
                  นำ Mask ของ AI มาใช้
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => {
                    const committed = commitAiSuggestedMaskToCanvas();
                    if (committed) void handleOneClickClean(committed);
                  }}
                  className="rounded-md bg-emerald-500 px-2.5 py-1 text-[11px] font-bold text-neutral-950 hover:brightness-110"
                >
                  ใช้ AI + คลีนจุดนี้เลย
                </button>
                <button
                  type="button"
                  onClick={handleCloseAiAudit}
                  className="rounded-md px-2 py-1 text-[11px] text-muted hover:bg-surface hover:text-foreground"
                >
                  ปิดผลเทียบ
                </button>
              </div>
            </div>
            <p className="text-[11px] text-emerald-100/90">
              {aiAudit.summary}
            </p>
            {cleanUrl && selectedRegion && canvasSize.width > 0 && canvasSize.height > 0 && (() => {
              const r = selectedRegion.rect;
              const maxW = 160;
              const maxH = 92;
              const scale = Math.min(
                1.25,
                maxW / Math.max(1, r.width),
                maxH / Math.max(1, r.height),
              );
              const previewW = Math.max(32, Math.round(r.width * scale));
              const previewH = Math.max(28, Math.round(r.height * scale));
              const bgW = Math.round(canvasSize.width * scale);
              const bgH = Math.round(canvasSize.height * scale);
              const bgX = -Math.round(r.x * scale);
              const bgY = -Math.round(r.y * scale);
              return (
                <div
                  data-testid="ai-mask-inline-comparison"
                  className="flex flex-wrap items-center gap-3 pt-1"
                >
                  {([
                    ["ภาพเดิม (จุดที่เลือก)", sourceUrl, "original"],
                    ["ภาพคลีนปัจจุบัน", cleanUrl, "cleaned"],
                  ] as const).map(([label, url, modeKey]) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setComparison(modeKey)}
                      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors cursor-pointer ${
                        comparison === modeKey
                          ? "border-emerald-400/70 bg-emerald-500/15"
                          : "border-border/60 bg-background/70 hover:border-emerald-400/40"
                      }`}
                    >
                      <div
                        aria-hidden="true"
                        className="rounded border border-border/70 bg-neutral-900 shrink-0"
                        style={{
                          width: `${previewW}px`,
                          height: `${previewH}px`,
                          backgroundImage: `url("${url}")`,
                          backgroundRepeat: "no-repeat",
                          backgroundSize: `${bgW}px ${bgH}px`,
                          backgroundPosition: `${bgX}px ${bgY}px`,
                        }}
                      />
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[11px] font-semibold text-emerald-100">{label}</span>
                        <span className="text-[10px] text-muted">คลิกเพื่อสลับภาพหลัก</span>
                      </div>
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
        )}
        {/* Canvas & Image Workspace */}
        <div
          ref={workspaceRef}
          onWheel={handleWheel}
          className="relative min-h-0 flex-1 overflow-hidden bg-neutral-950/90 select-none cursor-default"
        >
          {/* Scrollable / Zoomable Pan Wrapper */}
          <div
            className="flex h-full w-full items-center justify-center transition-transform duration-75"
            style={{
              transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
              transformOrigin: "center center",
              ...(isPanning ? { transitionDuration: "0ms" } : {}),
            }}
          >
            <div className="relative mx-auto w-fit max-w-full shadow-2xl">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img ref={sourceImageRef} onLoad={fitSelectedRegion} src={comparison === "cleaned" && cleanUrl ? cleanUrl : sourceUrl} alt={comparison === "cleaned" && cleanUrl ? "ภาพที่คลีนแล้ว" : "ภาพเดิม"} className="block max-h-[72vh] max-w-full pointer-events-none" />

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
                            ? "border-2 border-cyan-400 bg-cyan-400/10"
                            : "border border-dashed border-white/35 bg-white/5 hover:border-cyan-300/80 hover:bg-cyan-300/10"
                        }`}
                      >
                        {/* Clickable Region Pill / Badge */}
                        <button
                          type="button"
                          aria-label={`เลือกจุดที่ ${idx + 1}`}
                          disabled={isSubmitting}
                          onClick={(e) => {
                            e.stopPropagation();
                            setRegionId(region.id);
                            setStatusMessage(`เลือกจุดที่ ${idx + 1}`);
                          }}
                          title={`เลือกจุดที่ ${idx + 1}`}
                          className={`pointer-events-auto absolute -top-5 left-0 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold shadow-sm transition-transform active:scale-95 ${
                            isSelected
                              ? "bg-cyan-400 text-neutral-950"
                              : "bg-neutral-800/90 text-white/80 hover:bg-neutral-700"
                          }`}
                        >
                          <span>#{idx + 1}</span>

                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Suspected-remnant location marker (from the review list) */}
              {focusRect && canvasSize.width > 0 && (
                <div
                  title="ตำแหน่งจุดสงสัย"
                  aria-label="ตำแหน่งจุดสงสัย"
                  style={{
                    left: `${(focusRect.x / canvasSize.width) * 100}%`,
                    top: `${(focusRect.y / canvasSize.height) * 100}%`,
                    width: `${(focusRect.width / canvasSize.width) * 100}%`,
                    height: `${(focusRect.height / canvasSize.height) * 100}%`,
                  }}
                  className="pointer-events-none absolute border-2 border-dashed border-amber-400 bg-amber-400/10"
                />
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
                  ref={brushCursorRef}
                  aria-hidden="true"
                  className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary ring-1 ring-white/75 transition-[width,height] duration-75 motion-reduce:transition-none"
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
              <b>สีแดง = พื้นที่ที่จะลบ</b> · สีฟ้า = จุดที่จะกู้ภาพเดิม · บันทึกเฉพาะในกรอบที่เลือก · <b>Space + ลาก</b> เลื่อนภาพ · <b>Ctrl+Z</b> เลิกทำ
            </span>
            {selectedRegion && (
              <span className="text-[11px] font-medium text-cyan-400">
                เลือกอยู่: จุดที่ {currentIndex + 1}
              </span>
            )}
          </p>
        </div>

        <div role="status" aria-live="polite" className={statusMessage ? "px-4 py-2 text-sm text-amber-300" : "sr-only"}>
          {statusMessage}
        </div>

        {/* Footer Actions & Tools */}
        <footer className="flex flex-col gap-3 border-t border-border/80 bg-surface/90 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Left: Tools, Quick Fills, Radius */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Paint / Erase / Restore Mode Buttons */}
            <div className="flex items-center gap-1 rounded-lg border border-border/80 bg-background/80 p-0.5">
              {(["paint", "restore", "erase"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => handleModeChange(item)}
                  aria-pressed={mode === item}
                  disabled={isSubmitting}
                  className={`flex min-h-9 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary ${
                    mode === item
                      ? "bg-primary text-primary-content font-semibold"
                      : item === "erase" ? "text-muted hover:bg-surface hover:text-foreground" : "bg-surface text-foreground hover:bg-surface-hover"
                  }`}
                >
                  {item === "paint" && <Paintbrush className="h-3.5 w-3.5" />}
                  {item === "erase" && <Eraser className="h-3.5 w-3.5" />}
                  {item === "restore" && <RotateCcw className="h-3.5 w-3.5" />}
                  <span>{item === "paint" ? "ลบข้อความ" : item === "erase" ? "ไม่ลบตรงนี้" : "กู้เฉพาะส่วน"}</span>
                </button>
              ))}
            </div>

            {/* Radius Slider & Undo */}
            <div className="flex items-center gap-2 border-l border-border/80 pl-2">
              <label className="flex items-center gap-2 text-xs text-muted">
                <span>ขนาด {radius}px</span>
                <input
                  type="range"
                  min="2"
                  max="48"
                  disabled={isSubmitting}
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
                disabled={isSubmitting}
                onClick={() => {
                  if (submittingRef.current) return;
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

            {/* Mask Dilation Multiplier */}
            <div className="flex items-center gap-1.5 border-l border-border/80 pl-2">
              <label className="flex items-center gap-1.5 text-xs text-muted" title="ขยายขอบ Mask อัตโนมัติ (Dilation) เพื่อลบคราบเงาและเส้นขอบตัวหนังสือ">
                <span className="text-foreground font-medium">ขยายขอบ:</span>
                <select
                  disabled={isSubmitting || isFastInpainting}
                  value={dilationRadius}
                  onChange={(event) => handleDilationChange(Number(event.target.value))}
                  className="h-7 rounded-md border border-border/80 bg-surface px-1.5 text-xs font-medium text-amber-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary cursor-pointer"
                  aria-label="ขยายขอบ Mask"
                >
                  <option value={0} className="bg-surface text-foreground">ปกติ (0px)</option>
                  <option value={1} className="bg-surface text-foreground">+1px</option>
                  <option value={2} className="bg-surface text-foreground">+2px</option>
                  <option value={3} className="bg-surface text-foreground">+3px</option>
                  <option value={4} className="bg-surface text-foreground">+4px</option>
                  <option value={6} className="bg-surface text-foreground">+6px</option>
                  <option value={8} className="bg-surface text-foreground">+8px</option>
                  <option value={12} className="bg-surface text-foreground">+12px</option>
                </select>
              </label>
            </div>
          </div>

          {/* Right: One-Click Clean, Fallback Buttons */}
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={isSubmitting || !selectedRegion || !canvasSize.width || loadedRegionRef.current !== `${sourceUrl}:${regionId}`}
                onClick={handleRestoreWholeRegion}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-blue-500/20 px-3.5 text-xs font-bold text-blue-200 hover:bg-blue-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>กู้ภาพเดิมทั้งจุด</span>
              </button>
              {/* ⚡ Fast-Path Instant Crop Inpaint */}
              <button
                type="button"
                disabled={isSubmitting || isFastInpainting || !regionId || !selectedRegion}
                onClick={handleFastCropInpaint}
                title="คลีนเฉพาะจุดทันทีแบบ Real-time (200ms) โดยใช้ LaMa ผ่านระบบ Fast-Path"
                className="flex h-8 items-center gap-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-3 text-xs font-bold text-emerald-200 transition-all hover:bg-emerald-500/30 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <Sparkles className="h-3.5 w-3.5 text-emerald-300" />
                <span>{isFastInpainting ? "กำลังคลีน…" : "⚡ คลีนทันที"}</span>
              </button>
              {/* 🪄 Instant 1-Click Clean Button */}
              <button
                type="button"
                disabled={isSubmitting || !regionId}
                onClick={() => mode === "restore" ? submit("protect", true) : handleOneClickClean()}
                title="ใช้การแก้ไขเฉพาะจุดที่เลือก"
                className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-xs font-bold text-primary-content transition-all hover:brightness-110 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>{isSubmitting ? "กำลังใช้…" : "ใช้กับจุดนี้"}</span>
              </button>
            </div>


          </div>
        </footer>
        <details className="max-h-40 overflow-y-auto border-t border-border/80 bg-surface px-4 py-2 text-xs text-muted">
          <summary className="w-fit cursor-pointer rounded py-1 focus-visible:outline-2 focus-visible:outline-primary">ตัวเลือกเพิ่มเติม</summary>
          <div className="flex flex-wrap items-center gap-3 py-2">
              <select
                aria-label="Cleaner"
                disabled={isSubmitting}
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

            {/* Smart Fill & Clear Box Shortcuts */}
            <div className="flex items-center gap-1 border-l border-border/80 pl-2">
              <button
                type="button"
                onClick={handleFillRegion}
                disabled={isSubmitting}
                title="ระบายมาร์กสีแดงเต็มกรอบบอลลูนนี้ทันที"
                className="flex h-7 items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/15 px-2.5 text-xs font-semibold text-red-300 transition-colors hover:bg-red-500/25 active:scale-95"
              >
                <Square className="h-3.5 w-3.5" />
                <span>เติมเต็มกรอบ</span>
              </button>
              <button
                type="button"
                onClick={handleClearRegion}
                disabled={isSubmitting}
                title="ล้างมาร์กเฉพาะในกรอบบอลลูนนี้"
                className="flex h-7 items-center gap-1.5 rounded-md border border-border/80 bg-surface px-2.5 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground active:scale-95"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>ล้างกรอบนี้</span>
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
        </details>
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

function interpolateBrushPoints(from: MaskPoint, to: MaskPoint, radius: number): MaskPoint[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const step = Math.max(1, radius * 0.35);
  if (distance <= step) return [to];
  const steps = Math.ceil(distance / step);
  const points: MaskPoint[] = [];
  for (let i = 1; i <= steps; i++) {
    points.push({
      x: from.x + (dx * i) / steps,
      y: from.y + (dy * i) / steps,
    });
  }
  return points;
}

function applyEditorBrushInPlace(
  mask: ImageData,
  points: MaskPoint[],
  radius: number,
  mode: BrushMode,
): { x: number; y: number; width: number; height: number } | null {
  const activeRadius = Math.max(1, Math.round(radius));
  const rSq = activeRadius * activeRadius;
  const width = mask.width;
  const height = mask.height;
  const data = mask.data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (const point of points) {
    const centerX = Math.round(point.x);
    const centerY = Math.round(point.y);
    const startX = Math.max(0, centerX - activeRadius);
    const endX = Math.min(width - 1, centerX + activeRadius);
    const startY = Math.max(0, centerY - activeRadius);
    const endY = Math.min(height - 1, centerY + activeRadius);

    if (startX <= endX && startY <= endY) {
      if (startX < minX) minX = startX;
      if (endX > maxX) maxX = endX;
      if (startY < minY) minY = startY;
      if (endY > maxY) maxY = endY;
    }

    for (let y = startY; y <= endY; y += 1) {
      const dy = y - centerY;
      const dySq = dy * dy;
      const rowOffset = y * width;
      for (let x = startX; x <= endX; x += 1) {
        const dx = x - centerX;
        if (dx * dx + dySq > rSq) continue;
        const offset = (rowOffset + x) * 4;
        if (mode === "paint") {
          data[offset] = 255;
          data[offset + 1] = 70;
          data[offset + 2] = 90;
          data[offset + 3] = 255;
        } else if (mode === "restore") {
          data[offset] = 45;
          data[offset + 1] = 145;
          data[offset + 2] = 255;
          data[offset + 3] = 150;
        } else {
          const wasActiveOrExcluded =
            (data[offset + 3] > 0 && data[offset + 2] !== 255) || isExcludedPixel(mask, offset);
          if (wasActiveOrExcluded) {
            data[offset] = 255;
            data[offset + 1] = 0;
            data[offset + 2] = 1;
            data[offset + 3] = 0;
          } else {
            data[offset] = 255;
            data[offset + 1] = 70;
            data[offset + 2] = 90;
            data[offset + 3] = 0;
          }
        }
      }
    }
  }

  if (maxX < minX || maxY < minY) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function applyEditorBrush(mask: ImageData, points: MaskPoint[], radius: number, mode: BrushMode): ImageData {
  if (mode === "paint") return applyBrush(mask, points, radius, mode);
  const updated = cloneImageData(mask);
  applyEditorBrushInPlace(updated, points, radius, mode);
  return updated;
}
function hasRestorePixels(mask: ImageData, rect: PixelRect): boolean {
  for (let y = Math.max(0, rect.y); y < Math.min(mask.height, rect.y + rect.height); y++) {
    for (let x = Math.max(0, rect.x); x < Math.min(mask.width, rect.x + rect.width); x++) {
      const offset = (y * mask.width + x) * 4;
      if (mask.data[offset + 2] === 255 && mask.data[offset + 3] > 0) return true;
    }
  }
  return false;
}

function isExcludedPixel(mask: ImageData, offset: number): boolean {
  return mask.data[offset] === 255 && mask.data[offset + 1] === 0 && mask.data[offset + 2] === 1 && mask.data[offset + 3] === 0;
}

function hasExcludedPixels(mask: ImageData, rect: PixelRect): boolean {
  for (let y = Math.max(0, rect.y); y < Math.min(mask.height, rect.y + rect.height); y++) {
    for (let x = Math.max(0, rect.x); x < Math.min(mask.width, rect.x + rect.width); x++) {
      if (isExcludedPixel(mask, (y * mask.width + x) * 4)) return true;
    }
  }
  return false;
}
