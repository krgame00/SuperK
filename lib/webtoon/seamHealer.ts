/**
 * Webtoon Seam Healer & Inpainting Stitcher
 *
 * Implements Item 1 of the Torii Competitive Analysis Parity Roadmap:
 * Blends and heals horizontal seams between reconstructed webtoon chunks
 * using linear alpha feathering and cosine crossfade weights.
 *
 * Grounded in pstack principles:
 * - principle-model-the-domain: Typed SeamBlendConfig, SeamBlendResult.
 * - principle-fix-root-causes: Prevents harsh visible line artifacts across chunk boundaries.
 * - principle-laziness-protocol: Closed-form alpha weighting with zero external imaging dependencies.
 */

export interface SeamBlendConfig {
  overlapHeight: number;
  curve?: "linear" | "cosine";
}

/**
 * Computes an array of blend weight factors (0.0 to 1.0) across an overlap seam.
 * At index 0 (top of overlap): weight is 0.0 (100% prior chunk, 0% next chunk).
 * At index N-1 (bottom of overlap): weight is 1.0 (0% prior chunk, 100% next chunk).
 */
export function computeSeamBlendWeights(
  overlapHeight: number,
  curve: "linear" | "cosine" = "cosine",
): Float32Array {
  if (overlapHeight <= 0) {
    return new Float32Array(0);
  }

  const weights = new Float32Array(overlapHeight);
  const maxIdx = Math.max(1, overlapHeight - 1);

  for (let i = 0; i < overlapHeight; i++) {
    const t = i / maxIdx;
    if (curve === "cosine") {
      // Smooth S-curve (cosine interpolation): 0.5 * (1 - cos(pi * t))
      weights[i] = 0.5 * (1 - Math.cos(Math.PI * t));
    } else {
      weights[i] = t;
    }
  }

  return weights;
}

/**
 * Blends a single horizontal row of RGBA pixels across a seam using a blend weight (0..1).
 */
export function blendSeamPixelRow(
  topRow: Uint8ClampedArray | Uint8Array,
  bottomRow: Uint8ClampedArray | Uint8Array,
  outputRow: Uint8ClampedArray | Uint8Array,
  weight: number,
): void {
  const wBottom = Math.max(0, Math.min(1, weight));
  const wTop = 1 - wBottom;
  const len = Math.min(topRow.length, bottomRow.length, outputRow.length);

  for (let i = 0; i < len; i += 4) {
    outputRow[i] = Math.round(topRow[i] * wTop + bottomRow[i] * wBottom); // R
    outputRow[i + 1] = Math.round(topRow[i + 1] * wTop + bottomRow[i + 1] * wBottom); // G
    outputRow[i + 2] = Math.round(topRow[i + 2] * wTop + bottomRow[i + 2] * wBottom); // B
    outputRow[i + 3] = Math.round(topRow[i + 3] * wTop + bottomRow[i + 3] * wBottom); // A
  }
}
