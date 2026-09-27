import { sampleRectRegion } from "@/lib/colorMatching/canvasSampler";
import type { ColorSampleRegion } from "@/lib/colorMatching/types";

interface GlyphArea {
  left: number;
  top: number;
  width: number;
  height: number;
  rotation: number;
  lines: string[];
  fontSize: number;
  lineHeight: number;
  fontFamily: string;
}

/** Sample the clean background only where the exported glyphs actually land. */
export function sampleGlyphBackground(image: HTMLImageElement, area: GlyphArea): ColorSampleRegion | null {
  try {
    const radians = area.rotation * Math.PI / 180;
    const cos = Math.abs(Math.cos(radians));
    const sin = Math.abs(Math.sin(radians));
    const boundW = Math.ceil(area.width * cos + area.height * sin);
    const boundH = Math.ceil(area.width * sin + area.height * cos);
    const centerX = area.left + area.width / 2;
    const centerY = area.top + area.height / 2;
    const x = Math.floor(centerX - boundW / 2);
    const y = Math.floor(centerY - boundH / 2);
    if (x < 0 || y < 0 || x + boundW > image.naturalWidth || y + boundH > image.naturalHeight) return null;
    const background = sampleRectRegion(image, { x, y, width: boundW, height: boundH });
    if (!background || background.width !== boundW || background.height !== boundH) return null;

    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = boundW;
    maskCanvas.height = boundH;
    const ctx = maskCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.translate(centerX - x, centerY - y);
    ctx.rotate(radians);
    ctx.font = `bold ${area.fontSize}px ${area.fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#000000";
    const startY = -((area.lines.length - 1) * area.lineHeight) / 2;
    area.lines.forEach((line, index) => ctx.fillText(line, 0, startY + index * area.lineHeight));
    const mask = ctx.getImageData(0, 0, boundW, boundH).data;
    const glyphPixels: number[] = [];
    for (let pixel = 0; pixel < boundW * boundH; pixel++) {
      if (mask[pixel * 4 + 3] >= 32) glyphPixels.push(pixel);
    }
    if (glyphPixels.length < 4) return null;
    const step = Math.max(1, Math.floor(glyphPixels.length / 256));
    const rgba: number[] = [];
    for (let index = 0; index < glyphPixels.length; index += step) {
      const pixel = glyphPixels[index];
      const offset = pixel * 4;
      rgba.push(background.rgba[offset], background.rgba[offset + 1], background.rgba[offset + 2], background.rgba[offset + 3]);
    }
    return { width: rgba.length / 4, height: 1, rgba: new Uint8ClampedArray(rgba) };
  } catch {
    return null;
  }
}
