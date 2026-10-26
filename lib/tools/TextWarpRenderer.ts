export type WarpEffectType = "none" | "arch" | "wave" | "bulge" | "squeeze";

export interface WarpConfig {
  type: WarpEffectType;
  bend: number; // -1.0 to 1.0 (e.g. 0.5)
  frequency?: number; // For wave mode (e.g. 1.5)
}

export const WARP_TYPE_ORDER: WarpEffectType[] = [
  "none",
  "arch",
  "wave",
  "bulge",
  "squeeze",
];

export function getNextWarpType(current: WarpEffectType): WarpEffectType {
  const idx = WARP_TYPE_ORDER.indexOf(current);
  if (idx === -1 || idx === WARP_TYPE_ORDER.length - 1) {
    return WARP_TYPE_ORDER[0];
  }
  return WARP_TYPE_ORDER[idx + 1];
}

export function getWarpLabel(type: WarpEffectType): string {
  switch (type) {
    case "arch":
      return "ดัดโค้ง (Arch)";
    case "wave":
      return "ดัดคลื่น (Wave)";
    case "bulge":
      return "ป่องกลาง (Bulge)";
    case "squeeze":
      return "บีบกลาง (Squeeze)";
    case "none":
    default:
      return "ข้อความปกติ (None)";
  }
}

/**
 * Renders text with SFX non-linear deformation (arch, wave, bulge, squeeze)
 * by slicing the source canvas into 2px vertical strips and applying mathematical offsets.
 */
export function renderWarpedText(
  destCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement | OffscreenCanvas,
  destX: number,
  destY: number,
  config: WarpConfig
): void {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;

  if (
    config.type === "none" ||
    Math.abs(config.bend) < 0.001 ||
    w <= 0 ||
    h <= 0
  ) {
    destCtx.drawImage(sourceCanvas, destX, destY);
    return;
  }

  const freq = config.frequency ?? 1.5;
  const sliceStep = 2;

  for (let sx = 0; sx < w; sx += sliceStep) {
    const sliceW = Math.min(sliceStep, w - sx);
    const u = ((sx + sliceW * 0.5) / w) * 2 - 1;

    let offsetY = 0;
    let scaleY = 1.0;

    switch (config.type) {
      case "arch":
        offsetY = -config.bend * (1 - u * u) * (h * 0.6);
        break;
      case "wave":
        offsetY = Math.sin(u * Math.PI * freq) * config.bend * (h * 0.35);
        break;
      case "bulge":
        scaleY = Math.max(0.2, 1 + config.bend * (1 - u * u) * 0.65);
        offsetY = (1 - scaleY) * h * 0.5;
        break;
      case "squeeze":
        scaleY = Math.max(0.2, 1 - config.bend * (1 - u * u) * 0.6);
        offsetY = (1 - scaleY) * h * 0.5;
        break;
    }

    destCtx.drawImage(
      sourceCanvas,
      sx,
      0,
      sliceW,
      h,
      destX + sx,
      destY + offsetY,
      sliceW,
      h * scaleY
    );
  }
}
