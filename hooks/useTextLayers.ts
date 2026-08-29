"use client";

import { useCallback, useState } from "react";
import {
  createAddTextLayerCommand,
  createDeleteTextLayerCommand,
  createUpdateTextLayerCommand,
  type PageEditingDocument,
  type TextLayer,
} from "@/lib/editing/commands";
import { undoManager } from "@/lib/undoManager";

export interface UseTextLayersOptions {
  pageId: string;
  initialDocument?: PageEditingDocument;
  onDocumentChange?: (doc: PageEditingDocument) => void;
}

export function useTextLayers({
  pageId,
  initialDocument,
  onDocumentChange,
}: UseTextLayersOptions) {
  const [doc, setDoc] = useState<PageEditingDocument>(() => initialDocument ?? {
    pageId,
    textLayers: [],
    maskLayers: [],
    imageLayers: [],
    selectedLayerId: null,
    selectedLayerType: null,
  });

  const selectedLayer = doc.textLayers.find((l) => l.id === doc.selectedLayerId) ?? null;

  const selectLayer = useCallback((layerId: string | null) => {
    setDoc((prev) => {
      const next = {
        ...prev,
        selectedLayerId: layerId,
        selectedLayerType: layerId ? ("text" as const) : null,
      };
      onDocumentChange?.(next);
      return next;
    });
  }, [onDocumentChange]);

  const addLayer = useCallback(
    (overrides?: Partial<TextLayer>) => {
      const newLayer: TextLayer = {
        id: `text_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        pageId,
        text: "ข้อความใหม่",
        x: 100,
        y: 100,
        width: 180,
        height: 80,
        fontFamily: "var(--font-manga)",
        fontSize: 22,
        color: "#000000",
        align: "center",
        ...overrides,
      };

      const cmd = createAddTextLayerCommand(pageId, newLayer);
      setDoc((prev) => {
        const next = cmd.apply(prev);
        undoManager.push({
          label: "เพิ่มข้อความ",
          undo: () => {
            setDoc((current) => {
              const reverted = cmd.revert(current);
              onDocumentChange?.(reverted);
              return reverted;
            });
          },
          redo: () => {
            setDoc((current) => {
              const reapplied = cmd.apply(current);
              onDocumentChange?.(reapplied);
              return reapplied;
            });
          },
        });
        onDocumentChange?.(next);
        return next;
      });
      return newLayer;
    },
    [pageId, onDocumentChange],
  );

  const updateLayer = useCallback(
    (layerId: string, updates: Partial<TextLayer>) => {
      const cmd = createUpdateTextLayerCommand(pageId, layerId, updates);
      setDoc((prev) => {
        const next = cmd.apply(prev);
        undoManager.push({
          label: "แก้ไขข้อความ",
          undo: () => {
            setDoc((current) => {
              const reverted = cmd.revert(current);
              onDocumentChange?.(reverted);
              return reverted;
            });
          },
          redo: () => {
            setDoc((current) => {
              const reapplied = cmd.apply(current);
              onDocumentChange?.(reapplied);
              return reapplied;
            });
          },
        });
        onDocumentChange?.(next);
        return next;
      });
    },
    [pageId, onDocumentChange],
  );

  const deleteLayer = useCallback(
    (layerId: string) => {
      const cmd = createDeleteTextLayerCommand(pageId, layerId);
      setDoc((prev) => {
        const next = cmd.apply(prev);
        undoManager.push({
          label: "ลบข้อความ",
          undo: () => {
            setDoc((current) => {
              const reverted = cmd.revert(current);
              onDocumentChange?.(reverted);
              return reverted;
            });
          },
          redo: () => {
            setDoc((current) => {
              const reapplied = cmd.apply(current);
              onDocumentChange?.(reapplied);
              return reapplied;
            });
          },
        });
        onDocumentChange?.(next);
        return next;
      });
    },
    [pageId, onDocumentChange],
  );

  const duplicateLayer = useCallback(
    (layerId: string) => {
      const target = doc.textLayers.find((l) => l.id === layerId);
      if (!target) return;
      addLayer({
        ...target,
        x: target.x + 20,
        y: target.y + 20,
      });
    },
    [doc.textLayers, addLayer],
  );

  return {
    document: doc,
    setDocument: setDoc,
    layers: doc.textLayers,
    selectedLayer,
    selectedId: doc.selectedLayerId,
    selectLayer,
    addLayer,
    updateLayer,
    deleteLayer,
    duplicateLayer,
  };
}
