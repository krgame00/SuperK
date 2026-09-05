"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";

export const MIN_ZOOM_SCALE = 0.25;
export const MAX_ZOOM_SCALE = 4.0;
export const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0] as const;

export interface UsePageZoomOptions {
  currentPage: number;
  workspaceLayer: string;
  viewLayout: "single" | "scroll";
  containerRef: React.RefObject<HTMLElement | null>;
  imageNaturalWidth?: number;
  imageNaturalHeight?: number;
}

export interface UsePageZoomReturn {
  scale: number;
  displayPercentage: number;
  pan: { x: number; y: number };
  fitScale: number;
  isFit: boolean;
  isPanning: boolean;
  scrollZoomMode: "fit-width" | "actual-size";
  setScrollZoomMode: (mode: "fit-width" | "actual-size") => void;
  toggleScrollZoomMode: () => void;
  zoomIn: (focalPoint?: { x: number; y: number }) => void;
  zoomOut: (focalPoint?: { x: number; y: number }) => void;
  zoomTo: (targetScale: number, focalPoint?: { x: number; y: number }) => void;
  resetToFit: () => void;
  toggleActualSize: (focalPoint?: { x: number; y: number }) => void;
  handleWheel: (e: React.WheelEvent | WheelEvent) => void;
  handlePointerDown: (e: React.PointerEvent) => void;
  handlePointerMove: (e: React.PointerEvent) => void;
  handlePointerUp: (e: React.PointerEvent) => void;
  handlePointerCancel: (e: React.PointerEvent) => void;
  handleDoubleClick: (e: React.MouseEvent) => void;
  stageStyle: React.CSSProperties;
}

interface ZoomState {
  scale: number;
  pan: { x: number; y: number };
}

export function usePageZoom({
  currentPage,
  viewLayout,
  containerRef,
  imageNaturalWidth,
  imageNaturalHeight,
}: UsePageZoomOptions): UsePageZoomReturn {
  const [containerDimensions, setContainerDimensions] = useState<{ width: number; height: number }>(() => ({
    width: containerRef.current?.clientWidth || 800,
    height: containerRef.current?.clientHeight || 1000,
  }));

  // Track container size via ResizeObserver outside of render phase
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateDimensions = () => {
      setContainerDimensions({
        width: container.clientWidth || 800,
        height: container.clientHeight || 1000,
      });
    };

    updateDimensions();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(updateDimensions);
      observer.observe(container);
      return () => observer.disconnect();
    }
  }, [containerRef]);

  // Calculate Fit scale based on container dimensions state and image natural size
  const fitScale = useMemo(() => {
    if (!imageNaturalWidth || !imageNaturalHeight) return 1.0;
    const scaleX = containerDimensions.width / imageNaturalWidth;
    const scaleY = containerDimensions.height / imageNaturalHeight;
    const computedFit = Math.min(scaleX, scaleY);
    return Math.max(MIN_ZOOM_SCALE, Math.min(MAX_ZOOM_SCALE, computedFit));
  }, [containerDimensions.width, containerDimensions.height, imageNaturalWidth, imageNaturalHeight]);

  const fitPan = useMemo(() => {
    if (!imageNaturalWidth || !imageNaturalHeight) return { x: 0, y: 0 };
    return {
      x: Math.max(0, (containerDimensions.width - imageNaturalWidth * fitScale) / 2),
      y: Math.max(0, (containerDimensions.height - imageNaturalHeight * fitScale) / 2),
    };
  }, [containerDimensions.width, containerDimensions.height, fitScale, imageNaturalWidth, imageNaturalHeight]);

  const [zoomState, setZoomState] = useState<ZoomState>({
    scale: fitScale,
    pan: fitPan,
  });

  const [isPanning, setIsPanning] = useState(false);
  const [scrollZoomMode, setScrollZoomMode] = useState<"fit-width" | "actual-size">("fit-width");

  // Track dragging drag origins
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  // Synchronize state when props change using React's official previous-render state pattern
  const [prevFitScale, setPrevFitScale] = useState(fitScale);
  const [prevFitPan, setPrevFitPan] = useState(fitPan);
  if (prevFitScale !== fitScale || prevFitPan.x !== fitPan.x || prevFitPan.y !== fitPan.y) {
    setPrevFitScale(fitScale);
    setPrevFitPan(fitPan);
    if (Math.abs(zoomState.scale - prevFitScale) < 0.01) {
      setZoomState({ scale: fitScale, pan: fitPan });
    }
  }

  const [prevPage, setPrevPage] = useState(currentPage);
  if (prevPage !== currentPage) {
    setPrevPage(currentPage);
    setZoomState({ scale: fitScale, pan: fitPan });
  }

  const [prevLayout, setPrevLayout] = useState(viewLayout);
  if (prevLayout !== viewLayout) {
    setPrevLayout(viewLayout);
    if (viewLayout !== "scroll") {
      setZoomState({ scale: fitScale, pan: fitPan });
    }
  }

  // Helper to clamp scale
  const clampScale = useCallback((val: number) => {
    return Math.max(MIN_ZOOM_SCALE, Math.min(MAX_ZOOM_SCALE, val));
  }, []);

  // Pan clamping calculation
  const clampPan = useCallback(
    (nextPan: { x: number; y: number }, targetScale: number) => {
      const container = containerRef.current;
      if (!container || !imageNaturalWidth || !imageNaturalHeight) return nextPan;

      const cWidth = container.clientWidth || 800;
      const cHeight = container.clientHeight || 1000;
      const scaledW = imageNaturalWidth * targetScale;
      const scaledH = imageNaturalHeight * targetScale;

      const margin = 40;
      let { x, y } = nextPan;

      if (scaledW <= cWidth) {
        x = (cWidth - scaledW) / 2;
      } else {
        const minX = cWidth - scaledW - margin;
        const maxX = margin;
        x = Math.max(minX, Math.min(maxX, x));
      }

      if (scaledH <= cHeight) {
        y = (cHeight - scaledH) / 2;
      } else {
        const minY = cHeight - scaledH - margin;
        const maxY = margin;
        y = Math.max(minY, Math.min(maxY, y));
      }

      return { x, y };
    },
    [containerRef, imageNaturalWidth, imageNaturalHeight],
  );

  // Core Zoom to scale with focal point
  const zoomTo = useCallback(
    (targetScale: number, focalPoint?: { x: number; y: number }) => {
      const clampedTarget = clampScale(targetScale);

      setZoomState((prev) => {
        const container = containerRef.current;
        const cx = focalPoint?.x ?? (container ? (container.clientWidth || 800) / 2 : 400);
        const cy = focalPoint?.y ?? (container ? (container.clientHeight || 1000) / 2 : 500);

        const pixelX = (cx - prev.pan.x) / prev.scale;
        const pixelY = (cy - prev.pan.y) / prev.scale;

        const nextX = cx - pixelX * clampedTarget;
        const nextY = cy - pixelY * clampedTarget;

        const clampedPan = clampPan({ x: nextX, y: nextY }, clampedTarget);

        return {
          scale: clampedTarget,
          pan: clampedPan,
        };
      });
    },
    [clampScale, clampPan, containerRef],
  );

  const zoomIn = useCallback(
    (focalPoint?: { x: number; y: number }) => {
      setZoomState((prev) => {
        const nextPreset = ZOOM_PRESETS.find((p) => p > prev.scale + 0.05);
        const nextScale = nextPreset ?? prev.scale * 1.25;
        const clampedTarget = clampScale(nextScale);

        const container = containerRef.current;
        const cx = focalPoint?.x ?? (container ? (container.clientWidth || 800) / 2 : 400);
        const cy = focalPoint?.y ?? (container ? (container.clientHeight || 1000) / 2 : 500);

        const pixelX = (cx - prev.pan.x) / prev.scale;
        const pixelY = (cy - prev.pan.y) / prev.scale;

        const nextX = cx - pixelX * clampedTarget;
        const nextY = cy - pixelY * clampedTarget;

        return {
          scale: clampedTarget,
          pan: clampPan({ x: nextX, y: nextY }, clampedTarget),
        };
      });
    },
    [clampScale, clampPan, containerRef],
  );

  const zoomOut = useCallback(
    (focalPoint?: { x: number; y: number }) => {
      setZoomState((prev) => {
        const prevPreset = [...ZOOM_PRESETS].reverse().find((p) => p < prev.scale - 0.05);
        const nextScale = prevPreset ?? prev.scale / 1.25;
        const clampedTarget = clampScale(nextScale);

        const container = containerRef.current;
        const cx = focalPoint?.x ?? (container ? (container.clientWidth || 800) / 2 : 400);
        const cy = focalPoint?.y ?? (container ? (container.clientHeight || 1000) / 2 : 500);

        const pixelX = (cx - prev.pan.x) / prev.scale;
        const pixelY = (cy - prev.pan.y) / prev.scale;

        const nextX = cx - pixelX * clampedTarget;
        const nextY = cy - pixelY * clampedTarget;

        return {
          scale: clampedTarget,
          pan: clampPan({ x: nextX, y: nextY }, clampedTarget),
        };
      });
    },
    [clampScale, clampPan, containerRef],
  );

  const resetToFit = useCallback(() => {
    setZoomState({ scale: fitScale, pan: fitPan });
  }, [fitScale, fitPan]);

  const toggleActualSize = useCallback(
    (focalPoint?: { x: number; y: number }) => {
      if (Math.abs(zoomState.scale - 1.0) < 0.05) {
        resetToFit();
      } else {
        zoomTo(1.0, focalPoint);
      }
    },
    [zoomState.scale, resetToFit, zoomTo],
  );

  const toggleScrollZoomMode = useCallback(() => {
    setScrollZoomMode((prev) => (prev === "fit-width" ? "actual-size" : "fit-width"));
  }, []);

  // Wheel handling: Ctrl/Cmd + wheel for zoom
  const handleWheel = useCallback(
    (e: React.WheelEvent | WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const container = containerRef.current;
        const rect = container?.getBoundingClientRect();
        const focalX = rect ? e.clientX - rect.left : e.clientX;
        const focalY = rect ? e.clientY - rect.top : e.clientY;

        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        zoomTo(zoomState.scale * factor, { x: focalX, y: focalY });
      }
    },
    [containerRef, zoomState.scale, zoomTo],
  );

  // Pointer drag panning
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          ".translation-bubble-wrapper, .action-handle, .bubble-quick-toolbar, [data-translation-editor], button, a, input, select, textarea"
        )
      ) {
        return;
      }

      const isMiddleClick = e.button === 1;
      const isLeftClick = e.button === 0;

      if ((zoomState.scale > fitScale + 0.05 && isLeftClick) || isMiddleClick) {
        e.preventDefault();
        setIsPanning(true);
        dragStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          panX: zoomState.pan.x,
          panY: zoomState.pan.y,
        };
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      }
    },
    [zoomState.scale, fitScale, zoomState.pan],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isPanning || !dragStartRef.current) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      const nextPan = {
        x: dragStartRef.current.panX + dx,
        y: dragStartRef.current.panY + dy,
      };
      setZoomState((prev) => ({
        ...prev,
        pan: clampPan(nextPan, prev.scale),
      }));
    },
    [isPanning, clampPan],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (isPanning) {
        setIsPanning(false);
        dragStartRef.current = null;
        try {
          (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
        } catch {
          // ignore if already released
        }
      }
    },
    [isPanning],
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent) => {
      if (isPanning) {
        setIsPanning(false);
        dragStartRef.current = null;
        try {
          (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
        } catch {
          // ignore if already released
        }
      }
    },
    [isPanning],
  );

  // Double click toggles between Fit and 100%
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          ".translation-bubble-wrapper, .action-handle, .bubble-quick-toolbar, [data-translation-editor], button, a, input, select, textarea"
        )
      ) {
        return;
      }

      const container = containerRef.current;
      const rect = container?.getBoundingClientRect();
      const focalX = rect ? e.clientX - rect.left : e.clientX;
      const focalY = rect ? e.clientY - rect.top : e.clientY;

      if (Math.abs(zoomState.scale - fitScale) < 0.05) {
        zoomTo(1.0, { x: focalX, y: focalY });
      } else {
        resetToFit();
      }
    },
    [containerRef, zoomState.scale, fitScale, zoomTo, resetToFit],
  );

  // Global Keyboard shortcuts (+, -, 0, 1)
  useEffect(() => {
    if (viewLayout !== "single") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
      const target = e.target as HTMLElement | null;

      const isInput = (el: HTMLElement | null) =>
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable);

      if (isInput(target) || isInput(activeEl)) {
        return;
      }

      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomIn();
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomOut();
      } else if (e.key === "0") {
        e.preventDefault();
        resetToFit();
      } else if (e.key === "1") {
        e.preventDefault();
        zoomTo(1.0);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [viewLayout, zoomIn, zoomOut, resetToFit, zoomTo]);

  const isFit = Math.abs(zoomState.scale - fitScale) < 0.02;
  const displayPercentage = Math.round(zoomState.scale * 100);

  const stageStyle: React.CSSProperties = useMemo(
    () => ({
      transform: `translate3d(${zoomState.pan.x}px, ${zoomState.pan.y}px, 0) scale(${zoomState.scale})`,
      transformOrigin: "0 0",
      willChange: isPanning ? "transform" : "auto",
      touchAction: isFit ? "pan-y" : "none",
    }),
    [zoomState.pan.x, zoomState.pan.y, zoomState.scale, isPanning, isFit],
  );

  return {
    scale: zoomState.scale,
    displayPercentage,
    pan: zoomState.pan,
    fitScale,
    isFit,
    isPanning,
    scrollZoomMode,
    setScrollZoomMode,
    toggleScrollZoomMode,
    zoomIn,
    zoomOut,
    zoomTo,
    resetToFit,
    toggleActualSize,
    handleWheel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handleDoubleClick,
    stageStyle,
  };
}
