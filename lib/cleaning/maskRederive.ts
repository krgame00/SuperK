import type { PixelRect } from "@/lib/cleaning/types";

export interface MaskRederiveResult {
  /** Content-derived suggested mask, same dimensions as the inputs. */
  mask: ImageData;
  /** Masked pixels kept because they sit inside a text zone. */
  keptPx: number;
  /** Masked pixels removed because content evidence says they are artwork. */
  removedPx: number;
  /** Text-zone pixels newly added even though the base had none (colored lettering, dark strokes in bubbles). */
  addedPx: number;
}

const LIGHT_LUMA = 200;
const DARK_IN_BUBBLE_LUMA = 90;
const CHROMA_STROKE_MIN = 40;
const COMPONENT_MIN_AREA = 8;

/**
 * Re-derive a region mask from image content instead of polishing the base
 * mask in place. Zones: enclosed light regions and their dark strokes are
 * lettering carriers; colored (high-chroma) strokes are stylized lettering.
 * Light regions touching the crop border are unknown (mask kept as-is), and
 * everything else — hands, screentone, contours outside text zones — is
 * artwork the suggestion should unmask.
 */
export function rederiveRegionMaskFromContent(params: {
  crop: ImageData;
  baseMask: ImageData;
}): MaskRederiveResult {
  const { crop, baseMask } = params;
  const w = crop.width;
  const h = crop.height;
  const total = w * h;
  const expectedBytes = total * 4;

  // Defensive allocation: guarantee out matches crop dimensions (w * h * 4)
  const out = new Uint8ClampedArray(expectedBytes);
  if (baseMask.data.length === expectedBytes) {
    out.set(baseMask.data);
  } else {
    const copyLen = Math.min(out.length, baseMask.data.length);
    for (let i = 0; i < copyLen; i++) {
      out[i] = baseMask.data[i];
    }
  }

  const luma = new Uint8Array(total);
  const chroma = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const p = i * 4;
    const r = crop.data[p];
    const g = crop.data[p + 1];
    const b = crop.data[p + 2];
    luma[i] = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
    chroma[i] = Math.max(r, g, b) - Math.min(r, g, b);
  }

  const isActive = (i: number): boolean =>
    out[i * 4] > 0 || out[i * 4 + 1] > 0 || out[i * 4 + 2] > 0;

  // Label light components: border-touching = outside paper (unknown), enclosed = bubble interior.
  const zone = new Uint8Array(total); // 0 unknown, 1 bubble interior, 2 outside paper, 3 chroma stroke
  const label = new Int32Array(total).fill(-1);
  const stack: number[] = [];
  let nextLabel = 0;
  for (let start = 0; start < total; start++) {
    if (luma[start] < LIGHT_LUMA || label[start] !== -1) continue;
    const id = nextLabel++;
    let touchesBorder = false;
    const members: number[] = [];
    stack.push(start);
    label[start] = id;
    while (stack.length > 0) {
      const p = stack.pop()!;
      members.push(p);
      const py = (p / w) | 0;
      const px = p - py * w;
      if (px === 0 || py === 0 || px === w - 1 || py === h - 1) touchesBorder = true;
      const neighbors = [
        py > 0 ? p - w : -1,
        py < h - 1 ? p + w : -1,
        px > 0 ? p - 1 : -1,
        px < w - 1 ? p + 1 : -1,
      ];
      for (const np of neighbors) {
        if (np >= 0 && label[np] === -1 && luma[np] >= LIGHT_LUMA) {
          label[np] = id;
          stack.push(np);
        }
      }
    }
    const zoneValue = touchesBorder ? 2 : 1;
    for (const p of members) zone[p] = zoneValue;
  }

  // Chroma strokes anywhere in the region are stylized lettering.
  const chromaSeen = new Uint8Array(total);
  for (let start = 0; start < total; start++) {
    if (chroma[start] < CHROMA_STROKE_MIN || chromaSeen[start]) continue;
    const members: number[] = [];
    stack.push(start);
    chromaSeen[start] = 1;
    while (stack.length > 0) {
      const p = stack.pop()!;
      members.push(p);
      if (chroma[p] < CHROMA_STROKE_MIN) continue;
      const py = (p / w) | 0;
      const px = p - py * w;
      const neighbors = [
        py > 0 ? p - w : -1,
        py < h - 1 ? p + w : -1,
        px > 0 ? p - 1 : -1,
        px < w - 1 ? p + 1 : -1,
      ];
      for (const np of neighbors) {
        if (np >= 0 && !chromaSeen[np]) {
          chromaSeen[np] = 1;
          stack.push(np);
        }
      }
    }
    if (members.length < COMPONENT_MIN_AREA || members.length > total * 0.4) continue;
    for (const p of members) {
      if (chroma[p] >= CHROMA_STROKE_MIN) zone[p] = 3;
    }
  }

  // Dark strokes inside bubble interiors are text.
  for (let i = 0; i < total; i++) {
    if (zone[i] === 1 && luma[i] <= DARK_IN_BUBBLE_LUMA) zone[i] = 3;
  }

  // Dark ink drawn directly on the paper (hand and contour lines) sits right
  // next to outside-paper pixels: one pass of neighborhood inheritance marks
  // it as artwork to unmask. Bubble walls only lose their outermost ring.
  const inherited = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    if (zone[i] !== 0 || luma[i] >= LIGHT_LUMA) continue;
    const py = (i / w) | 0;
    const px = i - py * w;
    const neighbors = [
      py > 0 ? i - w : -1,
      py < h - 1 ? i + w : -1,
      px > 0 ? i - 1 : -1,
      px < w - 1 ? i + 1 : -1,
    ];
    for (const np of neighbors) {
      if (np >= 0 && zone[np] === 2) {
        inherited[i] = 1;
        break;
      }
    }
  }
  for (let i = 0; i < total; i++) {
    if (inherited[i]) zone[i] = 2;
  }

  let keptPx = 0;
  let removedPx = 0;
  let addedPx = 0;
  for (let i = 0; i < total; i++) {
    const p = i * 4;
    const wasActive = isActive(i);
    const inZone = zone[i] === 1 || zone[i] === 3;
    if (zone[i] === 2) {
      // Outside paper: nothing to clean here, ever.
      if (wasActive) {
        out[p] = 0;
        out[p + 1] = 0;
        out[p + 2] = 0;
        out[p + 3] = 0;
        removedPx += 1;
      }
      continue;
    }
    if (zone[i] === 3) {
      if (!wasActive) {
        out[p] = 255;
        out[p + 1] = 255;
        out[p + 2] = 255;
        out[p + 3] = 255;
        addedPx += 1;
      } else {
        keptPx += 1;
      }
      continue;
    }
    if (wasActive) keptPx += 1;
  }

  return { mask: new ImageData(out, w, h), keptPx, removedPx, addedPx };
}

export function rederiveRectHint(rect: PixelRect): string {
  return `${rect.x},${rect.y},${rect.width}x${rect.height}`;
}
