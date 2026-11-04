"use client";

import { useEffect, useState, useRef, type ReactElement } from "react";
import { createPortal } from "react-dom";
import type { ImageLayer } from "@/lib/editing/commands";

export interface ImageLayerCanvasProps {
  layers: ImageLayer[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (id: string, updates: Partial<ImageLayer>) => void;
  onDelete?: (id: string) => void;
}

export function ImageLayerCanvas({
  layers,
  selectedId,
  onSelect,
  onChange,
  onDelete,
}: ImageLayerCanvasProps): ReactElement | null {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [activeTransform, setActiveTransform] = useState<{
    id: string;
    updates: Partial<ImageLayer>;
  } | null>(null);
  const naturalDimensionsRef = useRef<{ width: number; height: number }>({
    width: 1000,
    height: 1500,
  });

  useEffect(() => {
    if (typeof document === "undefined") return;

    const findContainer = () => {
      const el = document.getElementById("pageContainer");
      if (el) {
        setContainer(el);
        const img = el.querySelector("img");
        const nw = img?.naturalWidth || el.clientWidth || 1000;
        const nh = img?.naturalHeight || el.clientHeight || 1500;
        naturalDimensionsRef.current = { width: nw, height: nh };
      }
    };

    findContainer();
    const interval = setInterval(findContainer, 400);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedId) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
          return;
        }
        e.preventDefault();
        onDelete?.(selectedId);
      } else if (e.key === "Escape") {
        onSelect(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedId, onDelete, onSelect]);

  if (!container || layers.length === 0) return null;

  const nw = naturalDimensionsRef.current.width;
  const nh = naturalDimensionsRef.current.height;

  const getCanvasScale = (): number => {
    if (!container) return 1;
    const cRect = container.getBoundingClientRect();
    if (!cRect.width || cRect.width <= 0) return 1;
    return nw > 0 ? cRect.width / nw : 1;
  };

  const handleLayerPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    layer: ImageLayer
  ) => {
    if ((e.target as HTMLElement).dataset.handle) return;
    e.stopPropagation();
    onSelect(layer.id);

    const target = e.currentTarget;
    if (typeof target.setPointerCapture === "function") {
      target.setPointerCapture(e.pointerId);
    }

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startX = layer.x;
    const startY = layer.y;
    const scale = getCanvasScale();
    let pendingUpdates: Partial<ImageLayer> | null = null;

    const onPointerMove = (moveEv: PointerEvent) => {
      const dx = (moveEv.clientX - startClientX) / scale;
      const dy = (moveEv.clientY - startClientY) / scale;
      const nextX = Math.max(0, Math.min(nw - 20, Math.round(startX + dx)));
      const nextY = Math.max(0, Math.min(nh - 20, Math.round(startY + dy)));
      pendingUpdates = { x: nextX, y: nextY };
      setActiveTransform({ id: layer.id, updates: pendingUpdates });
    };

    const onPointerUp = () => {
      target.removeEventListener("pointermove", onPointerMove);
      target.removeEventListener("pointerup", onPointerUp);
      target.removeEventListener("pointercancel", onPointerUp);
      if (pendingUpdates) {
        onChange(layer.id, pendingUpdates);
      }
      setActiveTransform(null);
    };

    target.addEventListener("pointermove", onPointerMove);
    target.addEventListener("pointerup", onPointerUp);
    target.addEventListener("pointercancel", onPointerUp);
  };

  const handleResizePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    layer: ImageLayer,
    handle: "nw" | "ne" | "sw" | "se"
  ) => {
    e.stopPropagation();
    e.preventDefault();

    const target = e.currentTarget;
    if (typeof target.setPointerCapture === "function") {
      target.setPointerCapture(e.pointerId);
    }

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startX = layer.x;
    const startY = layer.y;
    const startW = layer.width;
    const startH = layer.height;
    const scale = getCanvasScale();
    let pendingUpdates: Partial<ImageLayer> | null = null;

    const onPointerMove = (moveEv: PointerEvent) => {
      const dx = (moveEv.clientX - startClientX) / scale;
      const dy = (moveEv.clientY - startClientY) / scale;

      let newX = startX;
      let newY = startY;
      let newW = startW;
      let newH = startH;

      if (handle === "se") {
        newW = Math.max(30, Math.round(startW + dx));
        newH = Math.max(30, Math.round(startH + dy));
      } else if (handle === "sw") {
        const potentialW = Math.max(30, Math.round(startW - dx));
        newX = Math.round(startX + (startW - potentialW));
        newW = potentialW;
        newH = Math.max(30, Math.round(startH + dy));
      } else if (handle === "ne") {
        newW = Math.max(30, Math.round(startW + dx));
        const potentialH = Math.max(30, Math.round(startH - dy));
        newY = Math.round(startY + (startH - potentialH));
        newH = potentialH;
      } else if (handle === "nw") {
        const potentialW = Math.max(30, Math.round(startW - dx));
        newX = Math.round(startX + (startW - potentialW));
        newW = potentialW;
        const potentialH = Math.max(30, Math.round(startH - dy));
        newY = Math.round(startY + (startH - potentialH));
        newH = potentialH;
      }

      pendingUpdates = {
        x: Math.max(0, Math.min(nw - 30, newX)),
        y: Math.max(0, Math.min(nh - 30, newY)),
        width: Math.min(nw - newX, newW),
        height: Math.min(nh - newY, newH),
      };
      setActiveTransform({ id: layer.id, updates: pendingUpdates });
    };

    const onPointerUp = () => {
      target.removeEventListener("pointermove", onPointerMove);
      target.removeEventListener("pointerup", onPointerUp);
      target.removeEventListener("pointercancel", onPointerUp);
      if (pendingUpdates) {
        onChange(layer.id, pendingUpdates);
      }
      setActiveTransform(null);
    };

    target.addEventListener("pointermove", onPointerMove);
    target.addEventListener("pointerup", onPointerUp);
    target.addEventListener("pointercancel", onPointerUp);
  };

  return createPortal(
    <div
      data-image-layers-canvas="true"
      className="absolute inset-0 pointer-events-none z-20 overflow-visible"
    >
      {layers.map((layer) => {
        const effective =
          activeTransform && activeTransform.id === layer.id
            ? { ...layer, ...activeTransform.updates }
            : layer;
        const isSelected = selectedId === layer.id;
        return (
          <div
            key={layer.id}
            data-image-layer="true"
            data-layer-id={layer.id}
            data-flipx={effective.flipX ? "true" : "false"}
            data-flipy={effective.flipY ? "true" : "false"}
            onPointerDown={(e) => handleLayerPointerDown(e, effective)}
            style={{
              position: "absolute",
              left: `${effective.x}px`,
              top: `${effective.y}px`,
              width: `${effective.width}px`,
              height: `${effective.height}px`,
              opacity: effective.opacity ?? 1,
            }}
            className={`pointer-events-auto cursor-move select-none transition-shadow ${
              isSelected
                ? "ring-2 ring-primary ring-offset-1 ring-offset-background shadow-xl"
                : "hover:ring-1 hover:ring-primary/60"
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={effective.src}
              alt="Layer image"
              draggable={false}
              style={{
                transform: `scaleX(${effective.flipX ? -1 : 1}) scaleY(${effective.flipY ? -1 : 1})`,
              }}
              className="w-full h-full object-contain pointer-events-none select-none"
            />

            {/* Corner Resize Handles when selected */}
            {isSelected && (
              <>
                <div
                  data-handle="nw"
                  onPointerDown={(e) => handleResizePointerDown(e, effective, "nw")}
                  className="absolute -top-1.5 -left-1.5 w-3.5 h-3.5 bg-primary border-2 border-background rounded-full cursor-nwse-resize shadow-md hover:scale-125 transition-transform"
                />
                <div
                  data-handle="ne"
                  onPointerDown={(e) => handleResizePointerDown(e, effective, "ne")}
                  className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-primary border-2 border-background rounded-full cursor-nesw-resize shadow-md hover:scale-125 transition-transform"
                />
                <div
                  data-handle="sw"
                  onPointerDown={(e) => handleResizePointerDown(e, effective, "sw")}
                  className="absolute -bottom-1.5 -left-1.5 w-3.5 h-3.5 bg-primary border-2 border-background rounded-full cursor-nesw-resize shadow-md hover:scale-125 transition-transform"
                />
                <div
                  data-handle="se"
                  onPointerDown={(e) => handleResizePointerDown(e, effective, "se")}
                  className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-primary border-2 border-background rounded-full cursor-nwse-resize shadow-md hover:scale-125 transition-transform"
                />
              </>
            )}
          </div>
        );
      })}
    </div>,
    container
  );
}
