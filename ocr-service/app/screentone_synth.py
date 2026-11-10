"""Procedural screentone synthesis: refill a masked hole with matched halftone dots.

Neural inpainting turns screentone into a flat smudge, so a confirmed screentone
region is refilled procedurally instead. The wave period and angle come from
``analyze_screentone``; the dot phase is searched against a high-passed ring of
unmasked pixels around the hole so the synthetic grid continues the surrounding
dots; the dark/white ratio matches the ring density; and a distance-transform
alpha ramp feathers the seam. Everything runs on the LAB L channel, so paper
color (a/b) and unmasked pixels are preserved.

Blueprint: "พิมพ์เขียววิศวกรรมย้อนกลับ: ระบบฟื้นฟูเม็ดสกรีนโทน ..." sections
3.1-3.3 (wave, density threshold, alpha feathering) and 5.3 (feather 4.5 px).
The ring phase search is not in the blueprint; it is this module's answer to the
seam-continuity problem the blueprint leaves open.
"""

import math
from dataclasses import dataclass

import cv2
import numpy as np

from app.detector import BinaryMask, RgbImage
from app.screentone import ScreentoneAnalysis

# Blueprint section 3.2 keeps the target density away from 0 and 1 so extreme
# tones still render as a two-level halftone instead of a flat field.
DENSITY_FLOOR = 0.02
DENSITY_CEILING = 0.98
# Width of the unmasked ring (px beyond the mask) that the phase search reads.
RING_RADIUS_PX = 6


@dataclass(frozen=True)
class SynthParams:
    feather_px: float = 4.5  # blueprint sections 3.3 and 5.3
    phase_search_steps: int = 12  # phase grid resolution per axis, over one period


def _wave(
    period_px: float,
    theta_rad: float,
    phase_x: float,
    phase_y: float,
    ys: np.ndarray,
    xs: np.ndarray,
) -> np.ndarray:
    """Blueprint 3.1 wave S in [0, 1] on absolute pixel coordinates."""
    cos_t = math.cos(theta_rad)
    sin_t = math.sin(theta_rad)
    xr = (xs + phase_x) * cos_t - (ys + phase_y) * sin_t
    yr = (xs + phase_x) * sin_t + (ys + phase_y) * cos_t
    return 0.5 * (np.cos(2 * np.pi * xr / period_px) + np.cos(2 * np.pi * yr / period_px)) + 0.5


def _pearson(a: np.ndarray, b: np.ndarray) -> float:
    a = a - a.mean()
    b = b - b.mean()
    denom = math.sqrt(float(a @ a) * float(b @ b))
    if denom <= 1e-12:
        return 0.0
    return float((a @ b) / denom)


def _dot_skeleton(luma: np.ndarray, inside: np.ndarray, ring: np.ndarray, period_px: float) -> np.ndarray:
    """Signed dot-structure map of the ring: luma minus its own Gaussian blur.

    Pixels under the mask are flattened to the ring mean first so text strokes
    inside the hole do not bleed into the high-pass near the ring's inner edge.
    """
    flattened = luma.copy()
    flattened[inside] = int(round(float(luma[ring].mean())))
    blur = cv2.GaussianBlur(flattened, (0, 0), period_px / 2.0)
    return (flattened.astype(np.float32) - blur.astype(np.float32))[ring]


def _search_phase(
    skeleton: np.ndarray,
    ys: np.ndarray,
    xs: np.ndarray,
    period_px: float,
    theta_rad: float,
    threshold: float,
    steps: int,
) -> tuple[float, float]:
    """Grid search (phase_x, phase_y) over one period on ring pixels only.

    Scored by Pearson r between the thresholded wave and the skeleton. The wave
    is dark where S <= threshold, matching the fill rule, so the true phase
    scores strictly higher than the half-period anti-phase.
    """
    best_score = -1.1
    best_phase = (0.0, 0.0)
    for ix in range(steps):
        phase_x = period_px * ix / steps
        for iy in range(steps):
            phase_y = period_px * iy / steps
            wave = _wave(period_px, theta_rad, phase_x, phase_y, ys, xs)
            score = _pearson(np.where(wave <= threshold, -1.0, 1.0), skeleton)
            if score > best_score:
                best_score = score
                best_phase = (phase_x, phase_y)
    return best_phase


def synthesize_screentone(
    image_rgb: RgbImage,
    mask: BinaryMask,
    analysis: ScreentoneAnalysis,
    params: SynthParams = SynthParams(),
    *,
    _force_zero_phase: bool = False,
) -> RgbImage:
    """Fill the masked area with a phase-aligned procedural halftone.

    ``mask`` is 0/255 at full-page coordinates, 255 marking the area to refill.
    The detector analysis must confirm screentone and carry period and angle.
    The test-only ``_force_zero_phase`` kwarg skips the ring phase search.
    """
    if not analysis.is_screentone or analysis.period_px is None or analysis.angle_rad is None:
        raise ValueError("synthesize requires a confirmed screentone analysis")
    if image_rgb.ndim != 3 or image_rgb.shape[2] != 3:
        raise ValueError(f"expected an RGB image, got shape {image_rgb.shape}")
    if mask.shape != image_rgb.shape[:2]:
        raise ValueError(f"mask shape {mask.shape} does not match image {image_rgb.shape[:2]}")
    if params.feather_px < 0.0:
        raise ValueError("feather_px must be >= 0")
    if params.phase_search_steps < 1:
        raise ValueError("phase_search_steps must be >= 1")

    inside = mask > 0
    if not inside.any():
        raise ValueError("mask has no pixels to fill")
    period = float(analysis.period_px)
    if period <= 0.0:
        raise ValueError("period_px must be positive")

    # The detector reports the FFT peak direction; the blueprint wave rotates by
    # the negative of it, which reproduces the pattern for every symmetric peak
    # bin the detector may pick (verified against the detector's own tests).
    theta = -float(analysis.angle_rad)

    lab = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2LAB)
    luma = lab[:, :, 0]

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * RING_RADIUS_PX + 1,) * 2)
    ring = (cv2.dilate(mask, kernel) > 0) & ~inside
    if not ring.any():
        raise ValueError("ring around the mask is empty; cannot align phase")

    mu_ring = float(luma[ring].mean())
    density = min(max(1.0 - mu_ring / 255.0, DENSITY_FLOOR), DENSITY_CEILING)

    fill_y, fill_x = np.nonzero(inside)
    fill_y = fill_y.astype(np.float32)
    fill_x = fill_x.astype(np.float32)
    # S is stationary over a many-periods-wide region, so the quantile is
    # phase-invariant and one phase-0 evaluation fixes it for all candidates.
    s_zero = _wave(period, theta, 0.0, 0.0, fill_y, fill_x)
    threshold = float(np.quantile(s_zero, density))

    phase_x, phase_y = 0.0, 0.0
    if not _force_zero_phase:
        skeleton = _dot_skeleton(luma, inside, ring, period)
        ring_y, ring_x = np.nonzero(ring)
        phase_x, phase_y = _search_phase(
            skeleton,
            ring_y.astype(np.float32),
            ring_x.astype(np.float32),
            period,
            theta,
            threshold,
            params.phase_search_steps,
        )

    synth = np.where(_wave(period, theta, phase_x, phase_y, fill_y, fill_x) <= threshold, 0.0, 255.0)

    if params.feather_px > 0.0:
        distance = cv2.distanceTransform(mask, cv2.DIST_L2, cv2.DIST_MASK_5)
        alpha = np.clip(distance / params.feather_px, 0.0, 1.0)
    else:
        alpha = inside.astype(np.float32)

    final_luma = luma.astype(np.float32)
    alpha_in = alpha[inside]
    final_luma[inside] = alpha_in * synth + (1.0 - alpha_in) * final_luma[inside]
    lab[:, :, 0] = np.clip(np.rint(final_luma), 0.0, 255.0).astype(np.uint8)
    return cv2.cvtColor(lab, cv2.COLOR_LAB2RGB)


def _local_std(luma: np.ndarray) -> np.ndarray:
    """Local standard deviation of luma over a 5x5 window."""
    values = luma.astype(np.float32)
    mean = cv2.boxFilter(values, -1, (5, 5), normalize=True)
    mean_sq = cv2.boxFilter(values * values, -1, (5, 5), normalize=True)
    return np.sqrt(np.maximum(mean_sq - mean * mean, 0.0))


def seam_texture_error(
    result_rgb: RgbImage,
    original_rgb: RgbImage,
    mask: BinaryMask,
    *,
    band_px: int = 4,
) -> float:
    """Relative luma-texture energy gap of the seam band around the mask.

    The band holds pixels within ``band_px`` of the mask edge on both sides.
    The local 5x5 luma standard deviation averaged over the band measures the
    graininess the refill must preserve; the ratio scales the absolute gap.
    """
    if band_px < 1:
        raise ValueError("band_px must be >= 1")
    if result_rgb.shape != original_rgb.shape:
        raise ValueError(f"result shape {result_rgb.shape} does not match original {original_rgb.shape}")
    if mask.shape != result_rgb.shape[:2]:
        raise ValueError(f"mask shape {mask.shape} does not match image {result_rgb.shape[:2]}")

    inside_u8 = ((mask > 0).astype(np.uint8)) * 255
    distance_in = cv2.distanceTransform(inside_u8, cv2.DIST_L2, cv2.DIST_MASK_5)
    distance_out = cv2.distanceTransform(255 - inside_u8, cv2.DIST_L2, cv2.DIST_MASK_5)
    band = ((distance_in >= 1) & (distance_in <= band_px)) | ((distance_out >= 1) & (distance_out <= band_px))
    if not band.any():
        return 0.0

    std_result = float(_local_std(cv2.cvtColor(result_rgb, cv2.COLOR_RGB2LAB)[:, :, 0])[band].mean())
    std_original = float(_local_std(cv2.cvtColor(original_rgb, cv2.COLOR_RGB2LAB)[:, :, 0])[band].mean())
    return abs(std_result - std_original) / max(std_original, 1e-6)
