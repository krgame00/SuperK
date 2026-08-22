export type BrushMode = "paint" | "erase" | "restore";
export interface MaskPoint {
  x: number;
  y: number;
}

export function applyBrush(
  mask: ImageData,
  points: MaskPoint[],
  radius: number,
  mode: BrushMode,
): ImageData {
  const data = new Uint8ClampedArray(mask.data);
  const activeRadius = Math.max(1, Math.round(radius));
  const alpha = mode === "paint" ? 255 : 0;
  for (const point of points) {
    const centerX = Math.round(point.x);
    const centerY = Math.round(point.y);
    const startX = Math.max(0, centerX - activeRadius);
    const endX = Math.min(mask.width - 1, centerX + activeRadius);
    const startY = Math.max(0, centerY - activeRadius);
    const endY = Math.min(mask.height - 1, centerY + activeRadius);
    for (let y = startY; y <= endY; y += 1) {
      for (let x = startX; x <= endX; x += 1) {
        if ((x - centerX) ** 2 + (y - centerY) ** 2 > activeRadius ** 2) {
          continue;
        }
        const offset = (y * mask.width + x) * 4;
        data[offset] = 255;
        data[offset + 1] = 70;
        data[offset + 2] = 90;
        data[offset + 3] = alpha;
      }
    }
  }
  return new ImageData(data, mask.width, mask.height);
}

export function applyRestoreBrush(
  cleanImage: ImageData,
  sourceImage: ImageData,
  points: MaskPoint[],
  radius: number,
): ImageData {
  const data = new Uint8ClampedArray(cleanImage.data);
  const srcData = sourceImage.data;
  const activeRadius = Math.max(1, Math.round(radius));
  const width = cleanImage.width;
  const height = cleanImage.height;

  for (const point of points) {
    const centerX = Math.round(point.x);
    const centerY = Math.round(point.y);
    const startX = Math.max(0, centerX - activeRadius);
    const endX = Math.min(width - 1, centerX + activeRadius);
    const startY = Math.max(0, centerY - activeRadius);
    const endY = Math.min(height - 1, centerY + activeRadius);

    for (let y = startY; y <= endY; y += 1) {
      for (let x = startX; x <= endX; x += 1) {
        if ((x - centerX) ** 2 + (y - centerY) ** 2 > activeRadius ** 2) {
          continue;
        }
        const offset = (y * width + x) * 4;
        data[offset] = srcData[offset];         // R
        data[offset + 1] = srcData[offset + 1]; // G
        data[offset + 2] = srcData[offset + 2]; // B
        data[offset + 3] = srcData[offset + 3]; // A
      }
    }
  }
  return new ImageData(data, width, height);
}
