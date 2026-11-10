"""Tests for procedural screentone synthesis with ring phase alignment.

Every fixture is deterministic (no RNG): one halftone page with a known period,
angle and phase, black text strokes inside a central circular hole, and the
detector analysis taken from a clean corner patch. Measured margins are printed
so the numbers stay auditable with ``pytest -s``.
"""

import math

import cv2
import numpy as np
import pytest

from app.screentone import ScreentoneAnalysis, analyze_screentone
from app.screentone_synth import SynthParams, seam_texture_error, synthesize_screentone

PERIOD_PX = 8.0
ANGLE_DEG = 30.0
PHASE_PX = (2.0, 3.0)
PAGE_SIZE = 340
CENTER = PAGE_SIZE // 2
MASK_RADIUS = 48  # ~96 px across the refilled hole
ANALYSIS_PATCH = 160
FEATHER_BOUND = 60.0


def _wave(
    coords_y: np.ndarray, coords_x: np.ndarray, period: float, theta_rad: float, phase: tuple[float, float]
) -> np.ndarray:
    """Blueprint 3.1 wave on absolute pixel coordinates, independent of the implementation."""
    xr = (coords_x + phase[0]) * math.cos(theta_rad) - (coords_y + phase[1]) * math.sin(theta_rad)
    yr = (coords_x + phase[0]) * math.sin(theta_rad) + (coords_y + phase[1]) * math.cos(theta_rad)
    return 0.5 * (np.cos(2 * np.pi * xr / period) + np.cos(2 * np.pi * yr / period)) + 0.5


def _page() -> tuple[np.ndarray, np.ndarray]:
    gy, gx = np.indices((PAGE_SIZE, PAGE_SIZE), dtype=np.float64)
    wave = _wave(gy, gx, PERIOD_PX, math.radians(ANGLE_DEG), PHASE_PX)
    background = np.where(wave <= 0.5, 0, 255).astype(np.uint8)
    original = cv2.cvtColor(background, cv2.COLOR_GRAY2RGB)
    # text strokes stay >= 15 px inside the mask edge, so the seam band and the
    # detector patch both see pure halftone
    cv2.rectangle(original, (CENTER - 26, CENTER - 20), (CENTER - 8, CENTER + 20), (0, 0, 0), -1)
    cv2.rectangle(original, (CENTER - 2, CENTER - 14), (CENTER + 24, CENTER - 2), (20, 20, 20), -1)
    cv2.rectangle(original, (CENTER - 2, CENTER + 6), (CENTER + 18, CENTER + 16), (40, 40, 40), -1)
    mask = np.zeros((PAGE_SIZE, PAGE_SIZE), np.uint8)
    cv2.circle(mask, (CENTER, CENTER), MASK_RADIUS, 255, -1)
    return original, mask


def _analysis(original: np.ndarray) -> ScreentoneAnalysis:
    patch = cv2.cvtColor(original[:ANALYSIS_PATCH, :ANALYSIS_PATCH], cv2.COLOR_RGB2GRAY)
    return analyze_screentone(patch)


def _ring(mask: np.ndarray) -> np.ndarray:
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * 6 + 1,) * 2)
    return (cv2.dilate(mask, kernel) > 0) & ~(mask > 0)


def _corr(a: np.ndarray, b: np.ndarray) -> float:
    a = a - a.mean()
    b = b - b.mean()
    denom = math.sqrt(float(a @ a) * float(b @ b))
    if denom <= 1e-12:
        return 0.0
    return float((a @ b) / denom)


def _skeleton(original_gray: np.ndarray, mask: np.ndarray, period: float) -> np.ndarray:
    """High-passed ring luma: the dot-structure map the phase must continue."""
    ring = _ring(mask)
    flattened = original_gray.copy()
    flattened[mask > 0] = int(round(float(original_gray[ring].mean())))
    blur = cv2.GaussianBlur(flattened, (0, 0), period / 2.0)
    return (flattened.astype(np.float32) - blur.astype(np.float32))[_ring(mask)]


def _deep_zone(mask: np.ndarray) -> np.ndarray:
    return cv2.erode(mask, np.ones((13, 13), np.uint8)) > 0


def _fill_pattern(result: np.ndarray, mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Binary fill pattern and coordinates of the pure-synthesis deep zone."""
    gray = cv2.cvtColor(result, cv2.COLOR_RGB2GRAY)
    deep = _deep_zone(mask)
    dy, dx = np.nonzero(deep)
    return np.where(gray[deep] < 128, 1.0, -1.0), (dy.astype(np.float32), dx.astype(np.float32))


def _recovered_phase(result: np.ndarray, mask: np.ndarray, analysis: ScreentoneAnalysis) -> tuple[float, float]:
    """Phase of the blueprint wave that matches the refilled pattern best.

    The deep zone is pure synthesis, so a 24-step grid over one period in the
    detector's frame recovers the phase the implementation locked onto; the
    implementation's own 12-step grid is a subset of it.
    """
    pattern, (ys, xs) = _fill_pattern(result, mask)
    period = float(analysis.period_px)
    theta = -float(analysis.angle_rad)
    best_corr, best_phase = -2.0, (0.0, 0.0)
    for ix in range(24):
        for iy in range(24):
            phase = (period * ix / 24, period * iy / 24)
            wave = _wave(ys, xs, period, theta, phase)
            corr = _corr(np.where(wave <= 0.5, 1.0, -1.0), pattern)
            if corr > best_corr:
                best_corr, best_phase = corr, phase
    return best_phase


def test_synthesized_tone_closes_the_loop_with_the_detector() -> None:
    original, mask = _page()
    analysis = _analysis(original)
    assert analysis.is_screentone

    result = synthesize_screentone(original, mask, analysis)
    y0 = CENTER - MASK_RADIUS
    filled = cv2.cvtColor(result, cv2.COLOR_RGB2GRAY)[y0 : y0 + 2 * MASK_RADIUS + 1, y0 : y0 + 2 * MASK_RADIUS + 1]
    redetected = analyze_screentone(filled)

    assert redetected.is_screentone
    assert redetected.period_px == pytest.approx(PERIOD_PX, rel=0.10)
    measured_deg = math.degrees(redetected.angle_rad)
    expected_deg = math.degrees(analysis.angle_rad)
    gap = abs(measured_deg % 90.0 - expected_deg % 90.0)
    assert min(gap, 90.0 - gap) <= 5.0
    print(f"redetected P={redetected.period_px:.3f} (true 8.0), angle={measured_deg:.2f} deg vs "
          f"analysis {expected_deg:.2f} deg, mod-90 gap={min(gap, 90.0 - gap):.2f} deg")


def test_phase_search_locks_onto_the_ring() -> None:
    original, mask = _page()
    analysis = _analysis(original)
    aligned = synthesize_screentone(original, mask, analysis)
    zero = synthesize_screentone(original, mask, analysis, _force_zero_phase=True)

    period = float(analysis.period_px)
    theta = -float(analysis.angle_rad)
    skeleton = _skeleton(cv2.cvtColor(original, cv2.COLOR_RGB2GRAY), mask, period)
    ry, rx = np.nonzero(_ring(mask))

    def ring_corr(phase: tuple[float, float]) -> float:
        wave = _wave(ry.astype(np.float32), rx.astype(np.float32), period, theta, phase)
        return _corr(np.where(wave <= 0.5, -1.0, 1.0), skeleton)

    phase = _recovered_phase(aligned, mask, analysis)
    corr_aligned = ring_corr(phase)
    corr_zero = ring_corr((0.0, 0.0))

    # the zero-phase kwarg really filled with the zero-phase pattern
    pattern, (ys, xs) = _fill_pattern(zero, mask)
    wave_zero = _wave(ys, xs, period, theta, (0.0, 0.0))
    assert _corr(np.where(wave_zero <= 0.5, 1.0, -1.0), pattern) > 0.9

    assert corr_aligned >= 1.5 * corr_zero
    assert corr_aligned >= 0.5
    err_aligned = seam_texture_error(aligned, original, mask)
    err_zero = seam_texture_error(zero, original, mask)
    assert err_aligned < err_zero
    print(f"fill phase=({phase[0]:.3f}, {phase[1]:.3f}) of P={period:.4f}; ring corr "
          f"aligned={corr_aligned:.4f} zero={corr_zero:.4f}; seam error aligned={err_aligned:.4f} zero={err_zero:.4f}")


def test_density_matches_the_surrounding_tone() -> None:
    original, mask = _page()
    analysis = _analysis(original)
    result = synthesize_screentone(original, mask, analysis)

    ring = _ring(mask)
    gray_original = cv2.cvtColor(original, cv2.COLOR_RGB2GRAY)
    gray_result = cv2.cvtColor(result, cv2.COLOR_RGB2GRAY)
    mu_ring = float(gray_original[ring].mean())
    filled_mu = float(gray_result[mask > 0].mean())
    delta = abs(filled_mu - mu_ring)
    assert delta <= 6.0
    print(f"ring mu={mu_ring:.3f}, filled mu={filled_mu:.3f}, density delta={delta:.3f} gray levels")


def _mean_seam_step(gray: np.ndarray, mask: np.ndarray) -> float:
    """Mean |delta| of adjacent pairs straddling the mask boundary.

    This is the 1-px profile across the seam, ensembled over every boundary
    point. A raw single-line max cannot work here: the binary carrier's own dot
    edges jump 255 gray levels on both sides of the mask (measured 255.0 for
    original, feathered and hard alike), so only the boundary ensemble
    separates a feather ramp from a wall.
    """
    inner = (mask > 0) & ~(cv2.erode(mask, np.ones((3, 3), np.uint8)) > 0)
    outer = (cv2.dilate(mask, np.ones((3, 3), np.uint8)) > 0) & ~(mask > 0)
    height, width = mask.shape
    values = gray.astype(np.float32)
    padded_outer = np.pad(outer, 1)
    padded_gray = np.pad(values, 1, mode="edge")
    deltas = []
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        neighbor_outer = padded_outer[1 + dy : 1 + dy + height, 1 + dx : 1 + dx + width]
        neighbor_gray = padded_gray[1 + dy : 1 + dy + height, 1 + dx : 1 + dx + width]
        deltas.append(np.abs(values - neighbor_gray)[inner & neighbor_outer])
    return float(np.concatenate(deltas).mean())


def test_feather_ramps_across_the_seam() -> None:
    original, mask = _page()
    analysis = _analysis(original)
    feathered = synthesize_screentone(original, mask, analysis)
    hard = synthesize_screentone(original, mask, analysis, SynthParams(feather_px=0.0))

    gray_feathered = cv2.cvtColor(feathered, cv2.COLOR_RGB2GRAY)
    gray_hard = cv2.cvtColor(hard, cv2.COLOR_RGB2GRAY)
    step_feathered = _mean_seam_step(gray_feathered, mask)
    step_hard = _mean_seam_step(gray_hard, mask)
    assert step_feathered <= FEATHER_BOUND
    assert step_hard > FEATHER_BOUND
    assert step_hard > step_feathered
    print(f"mean seam step: feathered={step_feathered:.2f}, no-feather={step_hard:.2f} (bound {FEATHER_BOUND:.0f})")


def test_rejects_unconfirmed_analysis() -> None:
    original, mask = _page()
    analysis = _analysis(original)
    unconfirmed = ScreentoneAnalysis(
        analysis.sigma_patch, analysis.peak_magnitude, analysis.period_px, analysis.angle_rad, False
    )
    with pytest.raises(ValueError, match="confirmed screentone"):
        synthesize_screentone(original, mask, unconfirmed)
    missing = ScreentoneAnalysis(analysis.sigma_patch, analysis.peak_magnitude, None, None, True)
    with pytest.raises(ValueError, match="confirmed screentone"):
        synthesize_screentone(original, mask, missing)


def test_synthesis_is_deterministic() -> None:
    original, mask = _page()
    analysis = _analysis(original)
    first = synthesize_screentone(original, mask, analysis)
    assert np.array_equal(first, synthesize_screentone(original, mask, analysis))
