/**
 * Snaps a rotation angle (in degrees) to cardinal right angles (0, 90, 180, 270)
 * if within thresholdDeg (default 6 degrees), matching Torii Translate scanlation ergonomics.
 * Angles outside the threshold are normalized to [0, 360) and preserved.
 */
export function snapRotationToRightAngle(deg: number, thresholdDeg = 6): number {
  const normalized = ((deg % 360) + 360) % 360;
  const nearestQuarter = Math.round(normalized / 90) * 90;
  if (Math.abs(normalized - nearestQuarter) <= thresholdDeg) {
    return nearestQuarter % 360;
  }
  return deg >= 0 && deg < 360 ? deg : parseFloat(normalized.toFixed(6));
}

/**
 * Estimates the baseline tilt angle (in degrees, -35..35) and italic slant of source text
 * from an image pixel region by fitting top and bottom ink contours across horizontal slices.
 * Both top and bottom contours must slope in the same direction so normal oval bubbles
 * (which expand and contract symmetrically) stay at 0 degrees.
 */
export function estimateSourceTextTiltAngle(
  sample: { width: number; height: number; rgba: Uint8ClampedArray } | null | undefined,
): { rotationDeg: number; isItalic: boolean } {
  if (!sample || sample.width < 16 || sample.height < 10 || sample.rgba.length < sample.width * sample.height * 4) {
    return { rotationDeg: 0, isItalic: false };
  }
  const { width, height, rgba } = sample;
  const luma = new Float32Array(width * height);
  const borderLuma: number[] = [];
  for (let y = 0; y < height; y++) {
    const rOff = y * width;
    for (let x = 0; x < width; x++) {
      const idx = (rOff + x) * 4;
      const yVal = 0.299 * rgba[idx] + 0.587 * rgba[idx + 1] + 0.114 * rgba[idx + 2];
      luma[rOff + x] = yVal;
      if (x <= 1 || x >= width - 2 || y <= 1 || y >= height - 2) {
        borderLuma.push(yVal);
      }
    }
  }
  borderLuma.sort((a, b) => a - b);
  const bgMedian = borderLuma.length > 0 ? borderLuma[Math.floor(borderLuma.length * 0.65)] : 235;

  const numBins = 8;
  const binW = width / numBins;
  const xs: number[] = [];
  const yTops: number[] = [];
  const yBots: number[] = [];
  const yMids: number[] = [];

  for (let b = 0; b < numBins; b++) {
    const x0 = Math.max(1, Math.floor(b * binW));
    const x1 = Math.min(width - 1, Math.ceil((b + 1) * binW));
    const ys: number[] = [];
    for (let y = 1; y < height - 1; y++) {
      const rOff = y * width;
      for (let x = x0; x < x1; x++) {
        if (Math.abs(luma[rOff + x] - bgMedian) >= 42) {
          ys.push(y);
        }
      }
    }
    if (ys.length < 4) continue;
    ys.sort((a, c) => a - c);
    const yTop = ys[Math.floor(ys.length * 0.12)];
    const yBot = ys[Math.floor(ys.length * 0.88)];
    xs.push((x0 + x1) * 0.5);
    yTops.push(yTop);
    yBots.push(yBot);
    yMids.push((yTop + yBot) * 0.5);
  }

  if (xs.length < 4) {
    return { rotationDeg: 0, isItalic: false };
  }

  const fitSlope = (yArr: number[]) => {
    const n = xs.length;
    const meanX = xs.reduce((s, v) => s + v, 0) / n;
    const meanY = yArr.reduce((s, v) => s + v, 0) / n;
    let num = 0;
    let denX = 0;
    let denY = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - meanX;
      const dy = yArr[i] - meanY;
      num += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    }
    if (denX <= 1e-3) return { slope: 0, r2: 0 };
    const slope = num / denX;
    const r2 = denY <= 1e-3 ? 0 : (num * num) / (denX * denY);
    return { slope, r2 };
  };

  const topFit = fitSlope(yTops);
  const botFit = fitSlope(yBots);
  const midFit = fitSlope(yMids);

  // Require both top and bottom text edges to tilt in the same direction (excludes oval/diamond bubbles)
  if (topFit.slope * botFit.slope <= 0 || midFit.r2 < 0.52) {
    return { rotationDeg: 0, isItalic: false };
  }

  const rawDeg = (Math.atan(midFit.slope) * 180) / Math.PI;
  if (Math.abs(rawDeg) < 3.5 || Math.abs(rawDeg) > 36) {
    return { rotationDeg: 0, isItalic: false };
  }
  const roundedDeg = Math.round(rawDeg * 2) / 2;
  return {
    rotationDeg: roundedDeg,
    isItalic: Math.abs(roundedDeg) >= 4.5,
  };
}
