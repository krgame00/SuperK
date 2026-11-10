"""Unit tests for the FFT screentone detector."""

import math
from pathlib import Path

import cv2
import numpy as np
import pytest

from app.screentone import PEAK_PROMINENCE_THRESHOLD, SIGMA_THRESHOLD, analyze_screentone

COMPARISON_DIR = Path(__file__).resolve().parents[2] / "public" / "comparison"
PATCH_SIZE = 256


def _halftone_patch(period_px: float, angle_deg: float, size: int = PATCH_SIZE) -> np.ndarray:
    # Blueprint section 3.1 wave, thresholded into a binary dot screen. The
    # wave decomposes into two perpendicular square waves of equal strength,
    # so its spectrum holds conjugate pairs at -angle and 90-angle: the
    # detector can only know the screen angle modulo 90 degrees.
    xs = np.arange(size, dtype=np.float64)
    xx, yy = np.meshgrid(xs, xs)
    rad = math.radians(angle_deg)
    x_rot = xx * math.cos(rad) - yy * math.sin(rad)
    y_rot = xx * math.sin(rad) + yy * math.cos(rad)
    wave = 0.5 * np.cos(2 * math.pi * x_rot / period_px) + 0.5 * np.cos(2 * math.pi * y_rot / period_px)
    return np.where(wave > 0.0, 255, 0).astype(np.uint8)


def _angle_gap_mod_90(measured_deg: float, expected_deg: float) -> float:
    gap = abs(measured_deg % 90.0 - expected_deg % 90.0)
    return min(gap, 90.0 - gap)


@pytest.mark.parametrize(
    ("period_px", "angle_deg"),
    [
        (6.0, 0.0),
        (8.0, 30.0),
        (10.0, 45.0),
    ],
)
def test_synthetic_halftone_recovers_period_and_angle(period_px: float, angle_deg: float) -> None:
    analysis = analyze_screentone(_halftone_patch(period_px, angle_deg))

    assert analysis.is_screentone
    assert analysis.period_px == pytest.approx(period_px, rel=0.10)
    measured_deg = math.degrees(analysis.angle_rad)
    expected_deg = (-angle_deg) % 90.0
    assert _angle_gap_mod_90(measured_deg, expected_deg) <= 5.0


def test_flat_patch_is_never_screentone() -> None:
    analysis = analyze_screentone(np.full((PATCH_SIZE, PATCH_SIZE), 200, np.uint8))

    assert analysis.sigma_patch == pytest.approx(0.0, abs=1e-6)
    assert not analysis.is_screentone


def test_gaussian_noise_passes_sigma_gate_but_fails_fft_gate() -> None:
    rng = np.random.default_rng(0)
    noise = np.clip(rng.normal(128.0, 80.0, (PATCH_SIZE, PATCH_SIZE)), 0.0, 255.0).astype(np.uint8)

    analysis = analyze_screentone(noise)

    assert analysis.sigma_patch > SIGMA_THRESHOLD
    assert analysis.peak_magnitude < PEAK_PROMINENCE_THRESHOLD
    assert not analysis.is_screentone


def _grid_patches(image: np.ndarray, size: int) -> list[tuple[int, int, np.ndarray]]:
    height, width = image.shape[:2]
    return [
        (y, x, image[y : y + size, x : x + size])
        for y in range(0, height - size + 1, size)
        for x in range(0, width - size + 1, size)
    ]


def _load_grayscale(path: Path) -> np.ndarray:
    image = cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
    if image is None:
        raise AssertionError(f"failed to decode fixture image {path.name}")
    return image


def test_real_pages_sweep_is_finite_and_reports_top_patches() -> None:
    """Sweep every grid patch of the real fixture pages.

    Prints a per-file summary table (run pytest with -s or -rP to see it);
    the numbers feed the screentone-phase report. Real pages may contain no
    screentone at all, so only finiteness is asserted, never fixed values.
    """
    if not COMPARISON_DIR.is_dir():
        pytest.skip("public/comparison fixture folder not present")
    paths = sorted(COMPARISON_DIR.glob("*.jpg"))
    if not paths:
        pytest.skip("no jpg pages in public/comparison")

    lines = [f"{'file':<22} {'patches':>7} {'flagged':>7}  top-3 patches by peak prominence"]
    total_flagged = 0
    total_patches = 0
    for path in paths:
        image = _load_grayscale(path)
        patches = _grid_patches(image, PATCH_SIZE)
        assert patches, f"expected at least one {PATCH_SIZE}x{PATCH_SIZE} grid patch in {path.name}"
        analyses = [(analyze_screentone(patch), y, x) for y, x, patch in patches]
        for analysis, _y, _x in analyses:
            assert math.isfinite(analysis.sigma_patch)
            assert math.isfinite(analysis.peak_magnitude)
            assert analysis.period_px is None or math.isfinite(analysis.period_px)
            assert analysis.angle_rad is None or math.isfinite(analysis.angle_rad)
        flagged = sum(1 for analysis, _y, _x in analyses if analysis.is_screentone)
        total_flagged += flagged
        total_patches += len(analyses)
        lines.append(f"{path.name:<22} {len(analyses):>7} {flagged:>7}")
        for analysis, y, x in sorted(analyses, key=lambda item: item[0].peak_magnitude, reverse=True)[:3]:
            period = f"{analysis.period_px:.2f}px" if analysis.period_px is not None else "None"
            angle = f"{math.degrees(analysis.angle_rad):.1f}deg" if analysis.angle_rad is not None else "None"
            lines.append(
                f"    y={y:>5} x={x:>5}  prom={analysis.peak_magnitude:8.2f}"
                f"  sigma={analysis.sigma_patch:6.1f}  P={period:>9}  angle={angle:>10}"
            )
    lines.append(f"TOTAL patches={total_patches} flagged={total_flagged}")
    print("\n".join(lines))
