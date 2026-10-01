import type { ColorSampleRegion, TextStyleProfile } from "./types";

export const SOURCE_OUTLINE_VERSION = "source-outline-v1";

type OutlineEvidence = Pick<TextStyleProfile,
  "hasOutline" | "outlineWidth" | "outlineWidthRatio" | "outlineConfidence" | "sourceOutlineVersion">;

function rgb(hex: string): number[] | null {
  return /^#[\da-f]{6}$/i.test(hex)
    ? [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16))
    : null;
}

function distance(a: number[], b: number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Local contour support, independent of readability styling and removal masks. */
export function recoverSourceOutline(sample: ColorSampleRegion, fill: string, candidate: string): OutlineEvidence {
  const absent: OutlineEvidence = { hasOutline: false, outlineWidth: 0,
    outlineWidthRatio: 0, outlineConfidence: 0.90, sourceOutlineVersion: SOURCE_OUTLINE_VERSION };
  const fillRgb = rgb(fill), outlineRgb = rgb(candidate);
  const { width, height, rgba, glyphMask } = sample;
  const size = width * height;
  if (!fillRgb || !outlineRgb || distance(fillRgb, outlineRgb) < 60 || size < 1 || rgba.length < size * 4) {
    return { ...absent, outlineConfidence: 0.35 };
  }
  const kind = new Uint8Array(size);
  const dist = new Int16Array(size).fill(-1);
  const queue: number[] = [];
  let fillCount = 0;
  for (let p = 0; p < size; p++) {
    if (rgba[p * 4 + 3] < 64) continue;
    const color = [rgba[p * 4], rgba[p * 4 + 1], rgba[p * 4 + 2]];
    const fillDistance = distance(color, fillRgb);
    const outlineDistance = distance(color, outlineRgb);
    const supported = glyphMask?.length !== size || glyphMask[p] >= 32;
    if (supported && fillDistance <= 45 && fillDistance < outlineDistance) {
      kind[p] = 1; dist[p] = 0; queue.push(p); fillCount++;
    } else if (outlineDistance <= 45) kind[p] = 2;
  }
  if (fillCount < 4) return { ...absent, outlineConfidence: 0.35 };

  const radius = Math.max(3, Math.min(8, Math.round(Math.min(width, height) * 0.15)));
  const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  function neighbors(p: number): number[] {
    const x = p % width, y = Math.floor(p / width);
    return directions.flatMap(([dx, dy]) => {
      const nx = x + dx, ny = y + dy;
      return nx >= 0 && nx < width && ny >= 0 && ny < height ? [ny * width + nx] : [];
    });
  }
  for (let head = 0; head < queue.length; head++) {
    const p = queue[head];
    if (dist[p] >= radius) continue;
    for (const next of neighbors(p)) if (dist[next] < 0) {
      dist[next] = dist[p] + 1; queue.push(next);
    }
  }

  // A contour occupies a narrow band around glyphs. Large background planes,
  // even when adjacent to every glyph, are not source outline evidence.
  const visited = new Uint8Array(size), accepted = new Uint8Array(size);
  let outlineCount = 0;
  for (let p = 0; p < size; p++) {
    if (kind[p] !== 2 || visited[p]) continue;
    const component = [p]; visited[p] = 1;
    let near = 0, borderFaces = 0;
    for (let head = 0; head < component.length; head++) {
      const current = component[head], x = current % width, y = Math.floor(current / width);
      if (dist[current] > 0 && dist[current] <= radius) near++;
      if (x === 0) borderFaces |= 1;
      if (x === width - 1) borderFaces |= 2;
      if (y === 0) borderFaces |= 4;
      if (y === height - 1) borderFaces |= 8;
      for (const next of neighbors(current)) if (kind[next] === 2 && !visited[next]) {
        visited[next] = 1; component.push(next);
      }
    }
    const spansCrop = [1, 2, 4, 8].filter((face) => borderFaces & face).length >= 3;
    if (spansCrop || near < 4 || near / component.length < 0.65) continue;
    for (const current of component) if (dist[current] > 0 && dist[current] <= radius) {
      accepted[current] = 1; outlineCount++;
    }
  }
  const opportunities = [0, 0, 0, 0], hits = [0, 0, 0, 0];
  const localContour = new Uint8Array(size);
  const colorDelta = outlineRgb.map((channel, index) => channel - fillRgb[index]);
  const colorDeltaSquared = colorDelta.reduce((sum, channel) => sum + channel * channel, 0);
  function antialiasBlend(p: number): number | null {
    if (rgba[p * 4 + 3] < 64) return null;
    const pixel = [rgba[p * 4], rgba[p * 4 + 1], rgba[p * 4 + 2]];
    const t = pixel.reduce((sum, channel, index) => sum + (channel - fillRgb![index]) * colorDelta[index], 0) / colorDeltaSquared;
    return t > 0.1 && t < 0.9 && distance(pixel, fillRgb!.map((channel, index) => channel + t * colorDelta[index])) <= 25 ? t : null;
  }
  for (let p = 0; p < size; p++) {
    if (kind[p] !== 1) continue;
    const x = p % width, y = Math.floor(p / width);
    for (const [index, [dx, dy]] of directions.entries()) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height || kind[ny * width + nx] === 1) continue;
      opportunities[index]++;
      let transitionPixels = 0, previousBlend = 0;
      for (let step = 1; step <= radius; step++) {
        const sx = x + dx * step, sy = y + dy * step;
        if (sx < 0 || sx >= width || sy < 0 || sy >= height) break;
        const next = sy * width + sx;
        if (kind[next] === 1) break;
        if (accepted[next]) { hits[index]++; break; }
        if (kind[next] === 2) {
          // A white stroke can merge with a white background. Accept its
          // visible side only if a narrow contiguous band ends in exterior
          // pixels; unbounded background-colored rays provide no evidence.
          const band: number[] = [];
          for (let end = step; end <= radius; end++) {
            const ex = x + dx * end, ey = y + dy * end;
            if (ex < 0 || ex >= width || ey < 0 || ey >= height) break;
            const exterior = ey * width + ex;
            if (kind[exterior] === 2) { band.push(exterior); continue; }
            if (kind[exterior] === 0 && rgba[exterior * 4 + 3] >= 64 && band.length > 0) {
              hits[index]++;
              for (const contour of band) localContour[contour] = 1;
            }
            break;
          }
          break;
        }
        const blend = antialiasBlend(next);
        if (blend === null || transitionPixels >= 2 || blend <= previousBlend + 0.05) break;
        transitionPixels++;
        previousBlend = blend;
      }
    }
  }
  const coverage = hits.reduce((sum, count) => sum + count, 0) /
    Math.max(1, opportunities.reduce((sum, count) => sum + count, 0));
  const supportedDirections = opportunities.filter((count, index) => count > 0 && hits[index] / count >= 0.20).length;
  // Visible sides may be a minority when a stroke merges with the background.
  // Require support on three sides; a one-sided shadow or plain background fails.
  if (coverage < 0.20 || supportedDirections < 3) return absent;
  for (let p = 0; p < size; p++) if (localContour[p] && !accepted[p]) outlineCount++;
  return { hasOutline: true, outlineWidth: 1,
    outlineWidthRatio: Math.max(0.02, Math.min(0.25, (1 - Math.sqrt(fillCount / (fillCount + outlineCount))) / 2)),
    outlineConfidence: Math.min(0.95, 0.80 + coverage * 0.15), sourceOutlineVersion: SOURCE_OUTLINE_VERSION };
}
