/**
 * SuperK — Page-level Monochrome Manga Classifier (ADR 0016)
 *
 * Analyzes the pre-clean original source image to determine if the page is
 * grayscale/monochrome manga versus a full-color/colorized manga page.
 */

export interface MonochromePageAnalysis {
  isMonochrome: boolean;
  confidence: number;
  chromaticPixelRatio: number;
  strongChromaticPixelRatio: number;
  sampledPixelCount: number;
}

export const MONOCHROME_THRESHOLDS = {
  MAX_SAMPLES: 20000,
  MIN_ALPHA: 32,
  CHROMA_THRESHOLD: 18,
  SATURATION_THRESHOLD: 0.08,
  STRONG_CHROMA_THRESHOLD: 35,
  STRONG_SATURATION_THRESHOLD: 0.18,
  MAX_CHROMATIC_RATIO: 0.02,
  MAX_STRONG_CHROMATIC_RATIO: 0.005,
} as const;

/**
 * Analyzes an RGBA pixel buffer of the original source page to classify
 * whether it is a monochrome (grayscale) manga page.
 */
export function analyzeMonochromePage(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): MonochromePageAnalysis {
  const totalPixels = width * height;
  if (totalPixels <= 0 || rgba.length < totalPixels * 4) {
    return {
      isMonochrome: false,
      confidence: 0,
      chromaticPixelRatio: 1,
      strongChromaticPixelRatio: 1,
      sampledPixelCount: 0,
    };
  }

  // Deterministic stride to sample up to ~20,000 pixels
  const stride = Math.max(1, Math.ceil(totalPixels / MONOCHROME_THRESHOLDS.MAX_SAMPLES));

  let sampledPixelCount = 0;
  let chromaticPixelCount = 0;
  let strongChromaticPixelCount = 0;

  for (let i = 0; i < totalPixels; i += stride) {
    const offset = i * 4;
    const a = rgba[offset + 3];

    // Ignore transparent or near-transparent pixels
    if (a < MONOCHROME_THRESHOLDS.MIN_ALPHA) {
      continue;
    }

    const r = rgba[offset];
    const g = rgba[offset + 1];
    const b = rgba[offset + 2];

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;
    const saturation = max > 0 ? chroma / max : 0;

    sampledPixelCount++;

    const isChromatic =
      chroma >= MONOCHROME_THRESHOLDS.CHROMA_THRESHOLD &&
      saturation >= MONOCHROME_THRESHOLDS.SATURATION_THRESHOLD;

    const isStrongChromatic =
      chroma >= MONOCHROME_THRESHOLDS.STRONG_CHROMA_THRESHOLD &&
      saturation >= MONOCHROME_THRESHOLDS.STRONG_SATURATION_THRESHOLD;

    if (isChromatic) {
      chromaticPixelCount++;
    }
    if (isStrongChromatic) {
      strongChromaticPixelCount++;
    }
  }

  if (sampledPixelCount === 0) {
    return {
      isMonochrome: false,
      confidence: 0,
      chromaticPixelRatio: 1,
      strongChromaticPixelRatio: 1,
      sampledPixelCount: 0,
    };
  }

  const chromaticPixelRatio = chromaticPixelCount / sampledPixelCount;
  const strongChromaticPixelRatio = strongChromaticPixelCount / sampledPixelCount;

  const isMonochrome =
    chromaticPixelRatio <= MONOCHROME_THRESHOLDS.MAX_CHROMATIC_RATIO &&
    strongChromaticPixelRatio <= MONOCHROME_THRESHOLDS.MAX_STRONG_CHROMATIC_RATIO;

  const penaltyRatio = Math.max(
    chromaticPixelRatio / MONOCHROME_THRESHOLDS.MAX_CHROMATIC_RATIO,
    strongChromaticPixelRatio / MONOCHROME_THRESHOLDS.MAX_STRONG_CHROMATIC_RATIO,
  );

  const confidence = Math.max(0, Math.min(1, 1 - penaltyRatio * 0.5));

  return {
    isMonochrome,
    confidence: Number(confidence.toFixed(4)),
    chromaticPixelRatio: Number(chromaticPixelRatio.toFixed(5)),
    strongChromaticPixelRatio: Number(strongChromaticPixelRatio.toFixed(5)),
    sampledPixelCount,
  };
}
