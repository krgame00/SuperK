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
  isSplitView?: boolean;
}

export interface UsePageZoomReturn {
  scale: number;
  displayPercentage: number;
  pan: { x: number; y: number };
  fitScale: number;
  isFit: boolean;
  isPanning: boolean;
  isSpacePressed: boolean;
  isInertiaActive: boolean;
  isWheelActive: boolean;
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
  isSplitView = false,
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

  // Compute available dimensions per pane (accounting for 2-column split with p-2 and gap-3)
  const availableDimensions = useMemo(() => {
    const rawW = containerDimensions.width || 800;
    const rawH = containerDimensions.height || 1000;
    if (!isSplitView) {
      return { width: rawW, height: rawH };
    }
    // 2 equal columns with p-2 (16px total) and gap-3 (12px) => reserved ~28px horizontal, 16px vertical
    const splitW = Math.max(200, Math.floor((rawW - 28) / 2));
    const splitH = Math.max(200, rawH - 16);
    return { width: splitW, height: splitH };
  }, [containerDimensions.width, containerDimensions.height, isSplitView]);

  // Calculate Fit scale based on available dimensions and image natural size
  const fitScale = useMemo(() => {
    if (!imageNaturalWidth || !imageNaturalHeight) return 1.0;
    const scaleX = availableDimensions.width / imageNaturalWidth;
    const scaleY = availableDimensions.height / imageNaturalHeight;
    const computedFit = Math.min(scaleX, scaleY);
    return Math.max(MIN_ZOOM_SCALE, Math.min(MAX_ZOOM_SCALE, computedFit));
  }, [availableDimensions.width, availableDimensions.height, imageNaturalWidth, imageNaturalHeight]);

  const fitPan = useMemo(() => {
    if (!imageNaturalWidth || !imageNaturalHeight) return { x: 0, y: 0 };
    return {
      x: Math.max(0, (availableDimensions.width - imageNaturalWidth * fitScale) / 2),
      y: Math.max(0, (availableDimensions.height - imageNaturalHeight * fitScale) / 2),
    };
  }, [availableDimensions.width, availableDimensions.height, fitScale, imageNaturalWidth, imageNaturalHeight]);

  const [zoomState, setZoomState] = useState<ZoomState>({
    scale: fitScale,
    pan: fitPan,
  });

  const [isPanning, setIsPanning] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isInertiaActive, setIsInertiaActive] = useState(false);
  const [isWheelActive, setIsWheelActive] = useState(false);
  const [scrollZoomMode, setScrollZoomMode] = useState<"fit-width" | "actual-size">("fit-width");

  // Track dragging origins and motion samples
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const pointerHistoryRef = useRef<Array<{ x: number; y: number; time: number }>>([]);
  const inertiaRafRef = useRef<number | null>(null);
  const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopInertia = useCallback(() => {
    if (inertiaRafRef.current !== null) {
      cancelAnimationFrame(inertiaRafRef.current);
      inertiaRafRef.current = null;
    }
    setIsInertiaActive(false);
  }, []);

  // Cleanup inertia and wheel timers on unmount
  useEffect(() => {
    return () => {
      if (inertiaRafRef.current !== null) {
        cancelAnimationFrame(inertiaRafRef.current);
      }
      if (wheelTimerRef.current) {
        clearTimeout(wheelTimerRef.current);
      }
    };
  }, []);

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

  const [prevSplitView, setPrevSplitView] = useState(isSplitView);
  if (prevSplitView !== isSplitView) {
    setPrevSplitView(isSplitView);
    setZoomState({ scale: fitScale, pan: fitPan });
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

      const rawW = container.clientWidth || 800;
      const rawH = container.clientHeight || 1000;
      const cWidth = isSplitView ? Math.max(200, Math.floor((rawW - 28) / 2)) : rawW;
      const cHeight = isSplitView ? Math.max(200, rawH - 16) : rawH;
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
    [containerRef, imageNaturalWidth, imageNaturalHeight, isSplitView],
  );

  // Core Zoom to scale with focal point
  const zoomTo = useCallback(
    (targetScale: number, focalPoint?: { x: number; y: number }) => {
      stopInertia();
      const clampedTarget = clampScale(targetScale);

      setZoomState((prev) => {
        const container = containerRef.current;
        const rawW = container ? (container.clientWidth || 800) : 800;
        const rawH = container ? (container.clientHeight || 1000) : 1000;
        const paneW = isSplitView ? Math.max(200, Math.floor((rawW - 28) / 2)) : rawW;
        const paneH = isSplitView ? Math.max(200, rawH - 16) : rawH;
        const cx = focalPoint?.x ?? paneW / 2;
        const cy = focalPoint?.y ?? paneH / 2;

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
    [clampScale, clampPan, containerRef, stopInertia, isSplitView],
  );

  const zoomIn = useCallback(
    (focalPoint?: { x: number; y: number }) => {
      stopInertia();
      setZoomState((prev) => {
        const nextPreset = ZOOM_PRESETS.find((p) => p > prev.scale + 0.05);
        const nextScale = nextPreset ?? prev.scale * 1.25;
        const clampedTarget = clampScale(nextScale);

        const container = containerRef.current;
        const rawW = container ? (container.clientWidth || 800) : 800;
        const rawH = container ? (container.clientHeight || 1000) : 1000;
        const paneW = isSplitView ? Math.max(200, Math.floor((rawW - 28) / 2)) : rawW;
        const paneH = isSplitView ? Math.max(200, rawH - 16) : rawH;
        const cx = focalPoint?.x ?? paneW / 2;
        const cy = focalPoint?.y ?? paneH / 2;

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
    [clampScale, clampPan, containerRef, stopInertia, isSplitView],
  );

  const zoomOut = useCallback(
    (focalPoint?: { x: number; y: number }) => {
      stopInertia();
      setZoomState((prev) => {
        const prevPreset = [...ZOOM_PRESETS].reverse().find((p) => p < prev.scale - 0.05);
        const nextScale = prevPreset ?? prev.scale / 1.25;
        const clampedTarget = clampScale(nextScale);

        const container = containerRef.current;
        const rawW = container ? (container.clientWidth || 800) : 800;
        const rawH = container ? (container.clientHeight || 1000) : 1000;
        const paneW = isSplitView ? Math.max(200, Math.floor((rawW - 28) / 2)) : rawW;
        const paneH = isSplitView ? Math.max(200, rawH - 16) : rawH;
        const cx = focalPoint?.x ?? paneW / 2;
        const cy = focalPoint?.y ?? paneH / 2;

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
    [clampScale, clampPan, containerRef, stopInertia, isSplitView],
  );

  const resetToFit = useCallback(() => {
    stopInertia();
    setZoomState({ scale: fitScale, pan: fitPan });
  }, [fitScale, fitPan, stopInertia]);

  const toggleActualSize = useCallback(
    (focalPoint?: { x: number; y: number }) => {
      stopInertia();
      if (Math.abs(zoomState.scale - 1.0) < 0.05) {
        resetToFit();
      } else {
        zoomTo(1.0, focalPoint);
      }
    },
    [zoomState.scale, resetToFit, zoomTo, stopInertia],
  );

  const toggleScrollZoomMode = useCallback(() => {
    setScrollZoomMode((prev) => (prev === "fit-width" ? "actual-size" : "fit-width"));
  }, []);

  // Ctrl/Cmd + wheel zooms; ordinary wheel input pans the zoomed image.
  const handleWheel = useCallback(
    (e: React.WheelEvent | WheelEvent) => {
      stopInertia();
      setIsWheelActive(true);
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current);
      wheelTimerRef.current = setTimeout(() => {
        setIsWheelActive(false);
      }, 100);

      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const container = containerRef.current;
        let focalX: number;
        let focalY: number;

        if (isSplitView) {
          const target = e.target as HTMLElement | null;
          const paneEl = target?.closest?.(
            '[data-testid="split-view-translated-pane"], [data-testid="split-view-original-pane"]'
          ) as HTMLElement | null;
          if (paneEl) {
            const pRect = paneEl.getBoundingClientRect();
            focalX = e.clientX - pRect.left;
            focalY = e.clientY - pRect.top;
          } else {
            const rawW = container?.clientWidth || 800;
            const rawH = container?.clientHeight || 1000;
            focalX = Math.max(200, Math.floor((rawW - 28) / 2)) / 2;
            focalY = Math.max(200, rawH - 16) / 2;
          }
        } else {
          const rect = container?.getBoundingClientRect();
          focalX = rect ? e.clientX - rect.left : e.clientX;
          focalY = rect ? e.clientY - rect.top : e.clientY;
        }

        // Distinguish high-frequency trackpad pinch vs discrete mouse wheel notch
        const isContinuousPinch = e.deltaMode === 0 && Math.abs(e.deltaY) < 50;
        let factor: number;
        if (isContinuousPinch) {
          factor = Math.exp(-e.deltaY * 0.01);
          factor = Math.max(0.85, Math.min(1.15, factor));
        } else {
          factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        }

        zoomTo(zoomState.scale * factor, { x: focalX, y: focalY });
        return;
      }

      if (zoomState.scale <= fitScale + 0.05 || (!e.deltaX && !e.deltaY)) return;

      e.preventDefault();
      setZoomState((prev) => ({
        ...prev,
        pan: clampPan(
          { x: prev.pan.x - e.deltaX, y: prev.pan.y - e.deltaY },
          prev.scale,
        ),
      }));
    },
    [clampPan, containerRef, fitScale, zoomState.scale, zoomTo, stopInertia, isSplitView],
  );

  // Pointer drag panning
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      stopInertia();
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

      const canPan =
        (zoomState.scale > fitScale + 0.05 && isLeftClick) ||
        isMiddleClick ||
        (isSpacePressed && isLeftClick);

      if (canPan) {
        e.preventDefault();
        setIsPanning(true);
        dragStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          panX: zoomState.pan.x,
          panY: zoomState.pan.y,
        };
        pointerHistoryRef.current = [
          { x: e.clientX, y: e.clientY, time: performance.now() },
        ];
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      }
    },
    [zoomState.scale, fitScale, zoomState.pan, isSpacePressed, stopInertia],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isPanning || !dragStartRef.current) return;
      const now = performance.now();
      pointerHistoryRef.current.push({ x: e.clientX, y: e.clientY, time: now });
      if (pointerHistoryRef.current.length > 10) {
        pointerHistoryRef.current = pointerHistoryRef.current.filter(
          (pt) => now - pt.time <= 120,
        );
      }

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

        // Calculate release velocity for inertial glide
        const history = pointerHistoryRef.current;
        const now = performance.now();
        const recentSamples = history.filter((p) => now - p.time <= 100);

        if (recentSamples.length >= 2) {
          const oldest = recentSamples[0];
          const latest = recentSamples[recentSamples.length - 1];
          const dt = Math.max(10, latest.time - oldest.time);
          const vx = (latest.x - oldest.x) / dt;
          const vy = (latest.y - oldest.y) / dt;
          const speed = Math.hypot(vx, vy);

          if (speed > 0.15) {
            let currentVx = vx * 16.67;
            let currentVy = vy * 16.67;
            const friction = 0.92;

            setIsInertiaActive(true);

            const step = () => {
              currentVx *= friction;
              currentVy *= friction;

              if (Math.hypot(currentVx, currentVy) < 0.25) {
                stopInertia();
                return;
              }

              setZoomState((prev) => {
                const nextPan = clampPan(
                  { x: prev.pan.x + currentVx, y: prev.pan.y + currentVy },
                  prev.scale,
                );
                return {
                  ...prev,
                  pan: nextPan,
                };
              });

              inertiaRafRef.current = requestAnimationFrame(step);
            };

            inertiaRafRef.current = requestAnimationFrame(step);
          }
        }
        pointerHistoryRef.current = [];
      }
    },
    [isPanning, clampPan, stopInertia],
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent) => {
      if (isPanning) {
        setIsPanning(false);
        dragStartRef.current = null;
        pointerHistoryRef.current = [];
        stopInertia();
        try {
          (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
        } catch {
          // ignore if already released
        }
      }
    },
    [isPanning, stopInertia],
  );

  // Double click toggles between Fit and 100%
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      stopInertia();
      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          ".translation-bubble-wrapper, .action-handle, .bubble-quick-toolbar, [data-translation-editor], button, a, input, select, textarea"
        )
      ) {
        return;
      }

      const container = containerRef.current;
      let focalX: number;
      let focalY: number;

      if (isSplitView) {
        const paneEl = target?.closest?.(
          '[data-testid="split-view-translated-pane"], [data-testid="split-view-original-pane"]'
        ) as HTMLElement | null;
        if (paneEl) {
          const pRect = paneEl.getBoundingClientRect();
          focalX = e.clientX - pRect.left;
          focalY = e.clientY - pRect.top;
        } else {
          const rawW = container?.clientWidth || 800;
          const rawH = container?.clientHeight || 1000;
          focalX = Math.max(200, Math.floor((rawW - 28) / 2)) / 2;
          focalY = Math.max(200, rawH - 16) / 2;
        }
      } else {
        const rect = container?.getBoundingClientRect();
        focalX = rect ? e.clientX - rect.left : e.clientX;
        focalY = rect ? e.clientY - rect.top : e.clientY;
      }

      if (Math.abs(zoomState.scale - fitScale) < 0.05) {
        zoomTo(1.0, { x: focalX, y: focalY });
      } else {
        resetToFit();
      }
    },
    [containerRef, zoomState.scale, fitScale, zoomTo, resetToFit, stopInertia, isSplitView],
  );

  // Spacebar key listener for universal Hand Tool pan activation
  useEffect(() => {
    if (viewLayout !== "single") {
      setIsSpacePressed(false);
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === " ") {
        const activeEl = typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
        const target = e.target as HTMLElement | null;

        const isInteractive = (el: HTMLElement | null) =>
          Boolean(
            el &&
              (el.tagName === "INPUT" ||
                el.tagName === "TEXTAREA" ||
                el.tagName === "SELECT" ||
                el.isContentEditable ||
                (typeof el.closest === "function" &&
                  Boolean(el.closest('button, a, [role="button"], [role="dialog"]')))),
          );

        if (isInteractive(target) || isInteractive(activeEl)) {
          return;
        }

        setIsSpacePressed(true);
        e.preventDefault();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === " ") {
        setIsSpacePressed(false);
      }
    };

    const handleBlur = () => {
      setIsSpacePressed(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, [viewLayout]);

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
      willChange: isPanning || isInertiaActive ? "transform" : "auto",
      touchAction: isFit && !isSpacePressed ? "pan-y" : "none",
    }),
    [zoomState.pan.x, zoomState.pan.y, zoomState.scale, isPanning, isInertiaActive, isFit, isSpacePressed],
  );

  return {
    scale: zoomState.scale,
    displayPercentage,
    pan: zoomState.pan,
    fitScale,
    isFit,
    isPanning,
    isSpacePressed,
    isInertiaActive,
    isWheelActive,
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
