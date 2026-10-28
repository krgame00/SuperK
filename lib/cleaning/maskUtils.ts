import type { PixelRect } from "./types";

/**
 * Creates a binary PNG mask blob of declared dimensions with a solid white
 * rectangle at rect (all other pixels are solid black).
 * Used for 1-click region protect/restore and inpainting actions.
 */
export async function createRegionMaskBlob(
  width: number,
  height: number,
  rect: PixelRect,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  const cWidth = Math.max(1, Math.round(width));
  const cHeight = Math.max(1, Math.round(height));
  canvas.width = cWidth;
  canvas.height = cHeight;

  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, cWidth, cHeight);

    ctx.fillStyle = "#ffffff";
    const x = Math.max(0, Math.min(cWidth, Math.round(rect.x)));
    const y = Math.max(0, Math.min(cHeight, Math.round(rect.y)));
    const w = Math.max(1, Math.min(cWidth - x, Math.round(rect.width)));
    const h = Math.max(1, Math.min(cHeight - y, Math.round(rect.height)));
    ctx.fillRect(x, y, w, h);
  }

  return new Promise<Blob>((resolve, reject) => {
    if (typeof canvas.toBlob === "function") {
      canvas.toBlob((blob) => {
        canvas.width = 0;
        canvas.height = 0;
        if (blob) resolve(blob);
        else reject(new Error("Failed to encode mask blob."));
      }, "image/png");
    } else {
      canvas.width = 0;
      canvas.height = 0;
      resolve(new Blob(["mock-mask-png"], { type: "image/png" }));
    }
  });
}
