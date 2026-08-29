import type { ColorSampleRegion } from "./types";

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Converts OCR bounding box [ymin, xmin, ymax, xmax] (0-1000 scale) to image pixel rect.
 */
export function normalizeBubbleBox(
  box: number[],
  imageWidth: number,
  imageHeight: number,
): PixelRect {
  if (!box || box.length < 4 || imageWidth <= 0 || imageHeight <= 0) {
    return { x: 0, y: 0, width: Math.max(1, imageWidth), height: Math.max(1, imageHeight) };
  }

  const [yminRaw, xminRaw, ymaxRaw, xmaxRaw] = box;

  const xminNorm = Math.max(0, Math.min(1000, Math.min(xminRaw, xmaxRaw))) / 1000;
  const xmaxNorm = Math.max(0, Math.min(1000, Math.max(xminRaw, xmaxRaw))) / 1000;
  const yminNorm = Math.max(0, Math.min(1000, Math.min(yminRaw, ymaxRaw))) / 1000;
  const ymaxNorm = Math.max(0, Math.min(1000, Math.max(yminRaw, ymaxRaw))) / 1000;

  const x = Math.floor(xminNorm * imageWidth);
  const y = Math.floor(yminNorm * imageHeight);
  const width = Math.max(1, Math.ceil((xmaxNorm - xminNorm) * imageWidth));
  const height = Math.max(1, Math.ceil((ymaxNorm - yminNorm) * imageHeight));

  return {
    x: Math.min(x, imageWidth - 1),
    y: Math.min(y, imageHeight - 1),
    width: Math.min(width, imageWidth - x),
    height: Math.min(height, imageHeight - y),
  };
}

/**
 * Pure function extracting a sub-rectangle pixel buffer from full image data.
 */
export function sampleBubbleRegionFromImageData(
  fullRgba: Uint8ClampedArray,
  fullWidth: number,
  fullHeight: number,
  rect: PixelRect,
): ColorSampleRegion {
  const targetW = Math.max(1, Math.min(rect.width, fullWidth - rect.x));
  const targetH = Math.max(1, Math.min(rect.height, fullHeight - rect.y));

  const sampleRgba = new Uint8ClampedArray(targetW * targetH * 4);

  for (let row = 0; row < targetH; row++) {
    const srcY = rect.y + row;
    if (srcY >= fullHeight) break;

    const srcStart = (srcY * fullWidth + rect.x) * 4;
    const srcEnd = srcStart + targetW * 4;
    const destStart = row * targetW * 4;

    sampleRgba.set(fullRgba.subarray(srcStart, srcEnd), destStart);
  }

  return {
    width: targetW,
    height: targetH,
    rgba: sampleRgba,
  };
}

/**
 * Samples bubble region from an HTMLImageElement or HTMLCanvasElement.
 */
export function sampleBubbleRegion(
  image: HTMLImageElement | HTMLCanvasElement,
  box: number[],
): ColorSampleRegion | null {
  try {
    const naturalWidth =
      "naturalWidth" in image ? image.naturalWidth || image.width : image.width;
    const naturalHeight =
      "naturalHeight" in image ? image.naturalHeight || image.height : image.height;

    if (!naturalWidth || !naturalHeight) return null;

    const rect = normalizeBubbleBox(box, naturalWidth, naturalHeight);

    const canvas = document.createElement("canvas");
    canvas.width = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(
      image,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      0,
      0,
      rect.width,
      rect.height,
    );

    const imgData = ctx.getImageData(0, 0, rect.width, rect.height);
    return {
      width: rect.width,
      height: rect.height,
      rgba: imgData.data,
    };
  } catch (err) {
    console.warn("Failed to sample bubble region from canvas:", err);
    return null;
  }
}
