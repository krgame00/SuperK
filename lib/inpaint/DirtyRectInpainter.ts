import { inpaintCrop, type InpaintCropOptions } from "../cleaning/client";

export interface DeltaUndoPatch {
  pageId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  beforePixels: ImageData;
  afterPixels: ImageData;
}

export class BrushStrokeTracker {
  private minX = Infinity;
  private minY = Infinity;
  private maxX = -Infinity;
  private maxY = -Infinity;
  private hasStrokes = false;

  recordBrushDab(centerX: number, centerY: number, radius: number): void {
    this.hasStrokes = true;
    this.minX = Math.min(this.minX, Math.floor(centerX - radius));
    this.minY = Math.min(this.minY, Math.floor(centerY - radius));
    this.maxX = Math.max(this.maxX, Math.ceil(centerX + radius));
    this.maxY = Math.max(this.maxY, Math.ceil(centerY + radius));
  }

  getAlignedCropBox(
    imageWidth: number,
    imageHeight: number,
    contextPadding = 32,
    modulo = 8
  ): { x: number; y: number; width: number; height: number } | null {
    if (!this.hasStrokes) return null;

    const x0 = Math.max(0, this.minX - contextPadding);
    const y0 = Math.max(0, this.minY - contextPadding);
    const x1 = Math.min(imageWidth, this.maxX + contextPadding);
    const y1 = Math.min(imageHeight, this.maxY + contextPadding);

    const rawW = x1 - x0;
    const rawH = y1 - y0;

    const alignedW = Math.min(imageWidth - x0, Math.ceil(rawW / modulo) * modulo);
    const alignedH = Math.min(imageHeight - y0, Math.ceil(rawH / modulo) * modulo);

    return { x: x0, y: y0, width: alignedW, height: alignedH };
  }

  reset(): void {
    this.minX = Infinity;
    this.minY = Infinity;
    this.maxX = -Infinity;
    this.maxY = -Infinity;
    this.hasStrokes = false;
  }
}

export class PerImageUndoManager {
  private undoStacks = new Map<string, DeltaUndoPatch[]>();
  private redoStacks = new Map<string, DeltaUndoPatch[]>();
  private readonly maxHistoryPerPage: number;

  constructor(maxHistoryPerPage = 40) {
    this.maxHistoryPerPage = maxHistoryPerPage;
  }

  pushPatch(patch: DeltaUndoPatch): void {
    const stack = this.undoStacks.get(patch.pageId) ?? [];
    stack.push(patch);
    if (stack.length > this.maxHistoryPerPage) {
      stack.shift();
    }
    this.undoStacks.set(patch.pageId, stack);
    this.redoStacks.set(patch.pageId, []);
  }

  undo(pageId: string, ctx: CanvasRenderingContext2D): boolean {
    const stack = this.undoStacks.get(pageId);
    if (!stack || stack.length === 0) return false;
    const patch = stack.pop()!;
    ctx.putImageData(patch.beforePixels, patch.x, patch.y);

    const redo = this.redoStacks.get(pageId) ?? [];
    redo.push(patch);
    this.redoStacks.set(pageId, redo);
    return true;
  }

  redo(pageId: string, ctx: CanvasRenderingContext2D): boolean {
    const redo = this.redoStacks.get(pageId);
    if (!redo || redo.length === 0) return false;
    const patch = redo.pop()!;
    ctx.putImageData(patch.afterPixels, patch.x, patch.y);

    const undo = this.undoStacks.get(pageId) ?? [];
    undo.push(patch);
    this.undoStacks.set(pageId, undo);
    return true;
  }

  canUndo(pageId: string): boolean {
    const stack = this.undoStacks.get(pageId);
    return !!stack && stack.length > 0;
  }

  canRedo(pageId: string): boolean {
    const stack = this.redoStacks.get(pageId);
    return !!stack && stack.length > 0;
  }

  clear(pageId?: string): void {
    if (pageId) {
      this.undoStacks.delete(pageId);
      this.redoStacks.delete(pageId);
    } else {
      this.undoStacks.clear();
      this.redoStacks.clear();
    }
  }
}

export interface DirtyRectInpaintResult {
  patch: DeltaUndoPatch;
  cropBox: { x: number; y: number; width: number; height: number };
}

export interface DirtyRectInpaintOptions extends InpaintCropOptions {
  padding?: number;
  modulo?: number;
}

export async function executeDirtyRectInpaint(
  pageId: string,
  imageCanvas: HTMLCanvasElement | OffscreenCanvas,
  maskCanvas: HTMLCanvasElement | OffscreenCanvas,
  tracker: BrushStrokeTracker,
  options: DirtyRectInpaintOptions = {}
): Promise<DirtyRectInpaintResult | null> {
  const cropBox = tracker.getAlignedCropBox(
    imageCanvas.width,
    imageCanvas.height,
    options.padding ?? 32,
    options.modulo ?? 8
  );
  if (!cropBox) return null;

  const imageCtx = imageCanvas.getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  const maskCtx = maskCanvas.getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!imageCtx || !maskCtx) return null;

  const beforePixels = imageCtx.getImageData(
    cropBox.x,
    cropBox.y,
    cropBox.width,
    cropBox.height
  );

  const cropImgCanvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(cropBox.width, cropBox.height)
      : document.createElement("canvas");
  cropImgCanvas.width = cropBox.width;
  cropImgCanvas.height = cropBox.height;
  const cropImgCtx = cropImgCanvas.getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D;
  cropImgCtx.drawImage(
    imageCanvas,
    cropBox.x,
    cropBox.y,
    cropBox.width,
    cropBox.height,
    0,
    0,
    cropBox.width,
    cropBox.height
  );

  const cropMskCanvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(cropBox.width, cropBox.height)
      : document.createElement("canvas");
  cropMskCanvas.width = cropBox.width;
  cropMskCanvas.height = cropBox.height;
  const cropMskCtx = cropMskCanvas.getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D;
  cropMskCtx.drawImage(
    maskCanvas,
    cropBox.x,
    cropBox.y,
    cropBox.width,
    cropBox.height,
    0,
    0,
    cropBox.width,
    cropBox.height
  );

  const imgBlob =
    cropImgCanvas instanceof OffscreenCanvas
      ? await cropImgCanvas.convertToBlob({ type: "image/png" })
      : await new Promise<Blob>((res, rej) =>
          (cropImgCanvas as HTMLCanvasElement).toBlob(
            (b) => (b ? res(b) : rej(new Error("toBlob failed"))),
            "image/png"
          )
        );

  const mskBlob =
    cropMskCanvas instanceof OffscreenCanvas
      ? await cropMskCanvas.convertToBlob({ type: "image/png" })
      : await new Promise<Blob>((res, rej) =>
          (cropMskCanvas as HTMLCanvasElement).toBlob(
            (b) => (b ? res(b) : rej(new Error("toBlob failed"))),
            "image/png"
          )
        );

  const repairedBlob = await inpaintCrop(imgBlob, mskBlob, options);
  const repairedBitmap =
    typeof createImageBitmap !== "undefined"
      ? await createImageBitmap(repairedBlob)
      : await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = URL.createObjectURL(repairedBlob);
        });

  imageCtx.drawImage(repairedBitmap, cropBox.x, cropBox.y);
  if ("close" in repairedBitmap && typeof repairedBitmap.close === "function") {
    repairedBitmap.close();
  }

  const afterPixels = imageCtx.getImageData(
    cropBox.x,
    cropBox.y,
    cropBox.width,
    cropBox.height
  );
  tracker.reset();

  return {
    patch: {
      pageId,
      x: cropBox.x,
      y: cropBox.y,
      width: cropBox.width,
      height: cropBox.height,
      beforePixels,
      afterPixels,
    },
    cropBox,
  };
}

