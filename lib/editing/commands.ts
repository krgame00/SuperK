/**
 * Unified Editing Document Model & Reversible Command Pattern for Canvas Studio
 */

export type WarpEffect =
  | "none"
  | "perspective"
  | "arch"
  | "bulge"
  | "wave"
  | "squeeze"
  | "twist"
  | "fish";

export interface WarpSettings {
  effect: WarpEffect;
  bend: number; // -100 to 100
  horizontal: number; // -100 to 100
  vertical: number; // -100 to 100
  frequency?: number;
  direction?: number;
}

export interface TextLayer {
  id: string;
  pageId: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontFamily: string;
  fontSize: number;
  lineHeight?: number;
  letterSpacing?: number;
  align?: "left" | "center" | "right";
  color?: string;
  strokeColor?: string;
  strokeWidth?: number;
  boxFill?: string;
  boxBorder?: string;
  opacity?: number;
  borderRadius?: number;
  zIndex?: number;
  isBold?: boolean;
  isItalic?: boolean;
  padding?: number;
  warp?: WarpSettings;
}

export interface MaskPoint {
  x: number;
  y: number;
}

export interface MaskLayer {
  id: string;
  pageId: string;
  points: MaskPoint[];
  shape: "circle" | "square";
  source: "original" | "inpainted" | "color" | "pattern" | "blur";
  feather: number;
  size: number;
  color?: string;
  patternSrc?: string;
  blurStrength?: number;
}

export interface ImageLayer {
  id: string;
  pageId: string;
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity?: number;
  flipX?: boolean;
  flipY?: boolean;
  zIndex?: number;
}

export interface PageEditingDocument {
  pageId: string;
  textLayers: TextLayer[];
  maskLayers: MaskLayer[];
  imageLayers: ImageLayer[];
  selectedLayerId?: string | null;
  selectedLayerType?: "text" | "mask" | "image" | null;
}

export interface EditingCommand {
  id: string;
  label: string;
  pageId: string;
  apply: (doc: PageEditingDocument) => PageEditingDocument;
  revert: (doc: PageEditingDocument) => PageEditingDocument;
}

export const createDefaultEditingDocument = (
  pageId: string,
): PageEditingDocument => ({
  pageId,
  textLayers: [],
  maskLayers: [],
  imageLayers: [],
  selectedLayerId: null,
  selectedLayerType: null,
});

export const applyEditingCommand = (
  doc: PageEditingDocument,
  command: EditingCommand,
): PageEditingDocument => {
  if (doc.pageId !== command.pageId) {
    return doc;
  }
  return command.apply(doc);
};

// ── Text Layer Commands ──

export const createAddTextLayerCommand = (
  pageId: string,
  layer: TextLayer,
): EditingCommand => ({
  id: `add_text_${layer.id}_${Date.now()}`,
  label: "เพิ่มข้อความ",
  pageId,
  apply: (doc) => ({
    ...doc,
    textLayers: [...doc.textLayers, layer],
    selectedLayerId: layer.id,
    selectedLayerType: "text",
  }),
  revert: (doc) => ({
    ...doc,
    textLayers: doc.textLayers.filter((l) => l.id !== layer.id),
    selectedLayerId: doc.selectedLayerId === layer.id ? null : doc.selectedLayerId,
    selectedLayerType:
      doc.selectedLayerId === layer.id ? null : doc.selectedLayerType,
  }),
});

export const createUpdateTextLayerCommand = (
  pageId: string,
  layerId: string,
  updates: Partial<TextLayer>,
): EditingCommand => {
  let previousState: TextLayer | null = null;
  return {
    id: `update_text_${layerId}_${Date.now()}`,
    label: "แก้ไขข้อความ",
    pageId,
    apply: (doc) => {
      const target = doc.textLayers.find((l) => l.id === layerId);
      if (target && !previousState) {
        previousState = { ...target };
      }
      return {
        ...doc,
        textLayers: doc.textLayers.map((l) =>
          l.id === layerId ? { ...l, ...updates } : l,
        ),
      };
    },
    revert: (doc) => {
      if (!previousState) return doc;
      const prev = previousState;
      return {
        ...doc,
        textLayers: doc.textLayers.map((l) =>
          l.id === layerId ? { ...prev } : l,
        ),
      };
    },
  };
};

export const createDeleteTextLayerCommand = (
  pageId: string,
  layerId: string,
): EditingCommand => {
  let deletedLayer: TextLayer | null = null;
  return {
    id: `delete_text_${layerId}_${Date.now()}`,
    label: "ลบข้อความ",
    pageId,
    apply: (doc) => {
      deletedLayer = doc.textLayers.find((l) => l.id === layerId) ?? null;
      return {
        ...doc,
        textLayers: doc.textLayers.filter((l) => l.id !== layerId),
        selectedLayerId: doc.selectedLayerId === layerId ? null : doc.selectedLayerId,
        selectedLayerType:
          doc.selectedLayerId === layerId ? null : doc.selectedLayerType,
      };
    },
    revert: (doc) => {
      if (!deletedLayer) return doc;
      const layerToRestore = deletedLayer;
      return {
        ...doc,
        textLayers: [...doc.textLayers, layerToRestore],
        selectedLayerId: layerToRestore.id,
        selectedLayerType: "text",
      };
    },
  };
};

// ── Mask Layer Commands ──

export const createAddMaskLayerCommand = (
  pageId: string,
  layer: MaskLayer,
): EditingCommand => ({
  id: `add_mask_${layer.id}_${Date.now()}`,
  label: "เพิ่มมาสก์",
  pageId,
  apply: (doc) => ({
    ...doc,
    maskLayers: [...doc.maskLayers, layer],
    selectedLayerId: layer.id,
    selectedLayerType: "mask",
  }),
  revert: (doc) => ({
    ...doc,
    maskLayers: doc.maskLayers.filter((l) => l.id !== layer.id),
    selectedLayerId: doc.selectedLayerId === layer.id ? null : doc.selectedLayerId,
    selectedLayerType:
      doc.selectedLayerId === layer.id ? null : doc.selectedLayerType,
  }),
});

// ── Image Layer Commands ──

export const createAddImageLayerCommand = (
  pageId: string,
  layer: ImageLayer,
): EditingCommand => ({
  id: `add_image_${layer.id}_${Date.now()}`,
  label: "เพิ่มรูปภาพ",
  pageId,
  apply: (doc) => ({
    ...doc,
    imageLayers: [...doc.imageLayers, layer],
    selectedLayerId: layer.id,
    selectedLayerType: "image",
  }),
  revert: (doc) => ({
    ...doc,
    imageLayers: doc.imageLayers.filter((l) => l.id !== layer.id),
    selectedLayerId: doc.selectedLayerId === layer.id ? null : doc.selectedLayerId,
    selectedLayerType:
      doc.selectedLayerId === layer.id ? null : doc.selectedLayerType,
  }),
});

export const createUpdateImageLayerCommand = (
  pageId: string,
  layerId: string,
  updates: Partial<ImageLayer>,
): EditingCommand => {
  let previousState: ImageLayer | null = null;
  return {
    id: `update_image_${layerId}_${Date.now()}`,
    label: "แก้ไขรูปภาพ",
    pageId,
    apply: (doc) => {
      const target = doc.imageLayers.find((l) => l.id === layerId);
      if (target && !previousState) {
        previousState = { ...target };
      }
      return {
        ...doc,
        imageLayers: doc.imageLayers.map((l) =>
          l.id === layerId ? { ...l, ...updates } : l,
        ),
      };
    },
    revert: (doc) => {
      if (!previousState) return doc;
      const prev = previousState;
      return {
        ...doc,
        imageLayers: doc.imageLayers.map((l) =>
          l.id === layerId ? { ...prev } : l,
        ),
      };
    },
  };
};

export const createDeleteImageLayerCommand = (
  pageId: string,
  layerId: string,
): EditingCommand => {
  let deletedLayer: ImageLayer | null = null;
  return {
    id: `delete_image_${layerId}_${Date.now()}`,
    label: "ลบรูปภาพ",
    pageId,
    apply: (doc) => {
      deletedLayer = doc.imageLayers.find((l) => l.id === layerId) ?? null;
      return {
        ...doc,
        imageLayers: doc.imageLayers.filter((l) => l.id !== layerId),
        selectedLayerId: doc.selectedLayerId === layerId ? null : doc.selectedLayerId,
        selectedLayerType:
          doc.selectedLayerId === layerId ? null : doc.selectedLayerType,
      };
    },
    revert: (doc) => {
      if (!deletedLayer) return doc;
      const layerToRestore = deletedLayer;
      return {
        ...doc,
        imageLayers: [...doc.imageLayers, layerToRestore],
        selectedLayerId: layerToRestore.id,
        selectedLayerType: "image",
      };
    },
  };
};
