"use client";

import { useRef, type ReactElement } from "react";
import { Rnd } from "react-rnd";
import type { TextLayer } from "@/lib/editing/commands";

export interface TextLayerCanvasProps {
  pageId: string;
  layers: TextLayer[];
  selectedId: string | null;
  scale?: number;
  onSelect: (id: string | null) => void;
  onChange: (id: string, updates: Partial<TextLayer>) => void;
  onDelete?: (id: string) => void;
  readOnly?: boolean;
}

export function TextLayerCanvas({
  layers,
  selectedId,
  scale = 1,
  onSelect,
  onChange,
  readOnly = false,
}: TextLayerCanvasProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none z-20 overflow-visible"
      onClick={(e) => {
        if (e.target === containerRef.current) {
          onSelect(null);
        }
      }}
    >
      {layers.map((layer) => {
        const isSelected = layer.id === selectedId;

        const styleObj: React.CSSProperties = {
          fontFamily: layer.fontFamily || "var(--font-manga)",
          fontSize: `${(layer.fontSize || 20) * scale}px`,
          lineHeight: layer.lineHeight || 1.3,
          letterSpacing: layer.letterSpacing ? `${layer.letterSpacing}px` : undefined,
          textAlign: layer.align || "center",
          color: layer.color || "#000000",
          backgroundColor: layer.boxFill || "transparent",
          border: layer.boxBorder ? `1px solid ${layer.boxBorder}` : undefined,
          borderRadius: layer.borderRadius ? `${layer.borderRadius}px` : undefined,
          opacity: layer.opacity ?? 1,
          fontWeight: layer.isBold ? "bold" : "normal",
          fontStyle: layer.isItalic ? "italic" : "normal",
          padding: layer.padding ? `${layer.padding * scale}px` : "2px",
          WebkitTextStroke: layer.strokeWidth && layer.strokeColor
            ? `${layer.strokeWidth * scale}px ${layer.strokeColor}`
            : undefined,
          wordBreak: "break-word",
          whiteSpace: "pre-wrap",
        };

        if (readOnly) {
          return (
            <div
              key={layer.id}
              data-testid={`text-layer-${layer.id}`}
              style={{
                position: "absolute",
                left: layer.x * scale,
                top: layer.y * scale,
                width: layer.width * scale,
                height: layer.height * scale,
                ...styleObj,
              }}
              className="pointer-events-auto select-none"
            >
              {layer.text}
            </div>
          );
        }

        return (
          <Rnd
            key={layer.id}
            size={{
              width: layer.width * scale,
              height: layer.height * scale,
            }}
            position={{
              x: layer.x * scale,
              y: layer.y * scale,
            }}
            scale={scale}
            bounds="parent"
            className={`pointer-events-auto transition-[box-shadow,border-color] duration-150 ${
              isSelected
                ? "is-selected ring-2 ring-primary border border-primary/50 shadow-lg"
                : "hover:ring-1 hover:ring-primary/40 border border-transparent"
            }`}
            data-testid={`text-layer-${layer.id}`}
            onDragStart={() => {
              onSelect(layer.id);
            }}
            onDragStop={(_e, d) => {
              onChange(layer.id, {
                x: Math.round(d.x / scale),
                y: Math.round(d.y / scale),
              });
            }}
            onResizeStop={(_e, _direction, ref, _delta, position) => {
              onChange(layer.id, {
                width: Math.round(ref.offsetWidth / scale),
                height: Math.round(ref.offsetHeight / scale),
                x: Math.round(position.x / scale),
                y: Math.round(position.y / scale),
              });
            }}
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              onSelect(layer.id);
            }}
            enableResizing={
              isSelected
                ? {
                    top: true,
                    right: true,
                    bottom: true,
                    left: true,
                    topRight: true,
                    bottomRight: true,
                    bottomLeft: true,
                    topLeft: true,
                  }
                : false
            }
          >
            {isSelected ? (
              <textarea
                value={layer.text}
                onChange={(e) => onChange(layer.id, { text: e.target.value })}
                onFocus={() => onSelect(layer.id)}
                style={styleObj}
                className="w-full h-full resize-none bg-transparent outline-none p-1 block overflow-hidden font-inherit"
                autoFocus
              />
            ) : (
              <div
                style={styleObj}
                className="w-full h-full flex items-center justify-center select-none overflow-hidden"
              >
                {layer.text}
              </div>
            )}
          </Rnd>
        );
      })}
    </div>
  );
}
