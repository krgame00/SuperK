"""Behavior tests for the screentone fast path stealing confirmed Tier 3 regions.

The gate lives behind the tier decision in TieredInpainter, so every fixture
drives clean_with_diagnostics end to end and asserts what a caller observes:
the diagnostics identity and whether the neural cleaner was called.
"""

from __future__ import annotations

import math

import cv2
import numpy as np

from app.cleaners.tier_router import InpaintTier, TieredInpainter
from app.mask_refiner import MaskRegion
from app.schemas import PixelRect
from app.screentone import analyze_screentone

TONE_PERIOD_PX = 8.0
TONE_ANGLE_DEG = 30.0


def _make_region(x: int = 20, y: int = 20, w: int = 40, h: int = 40) -> MaskRegion:
    return MaskRegion(
        id="region-screentone",
        rect=PixelRect(x=x, y=y, width=w, height=h),
        component_ids=(1,),
        stroke_radius=2,
    )


def _halftone_rgb(height: int, width: int) -> np.ndarray:
    # Binary dot screen: thresholded sum of two perpendicular cos waves at the
    # tone period and angle. The screen angle is only recoverable mod 90 deg.
    xs = np.arange(width, dtype=np.float64)
    xx, yy = np.meshgrid(xs, xs)
    rad = math.radians(TONE_ANGLE_DEG)
    x_rot = xx * math.cos(rad) - yy * math.sin(rad)
    y_rot = xx * math.sin(rad) + yy * math.cos(rad)
    wave = 0.5 * np.cos(2 * math.pi * x_rot / TONE_PERIOD_PX) + 0.5 * np.cos(2 * math.pi * y_rot / TONE_PERIOD_PX)
    screen = np.where(wave > 0.0, 255, 0).astype(np.uint8)
    return np.repeat(screen[:, :, None], 3, axis=2)


def _screentone_page() -> tuple[np.ndarray, np.ndarray, MaskRegion]:
    image = _halftone_rgb(100, 100)
    mask = np.zeros((100, 100), dtype=np.uint8)
    mask[42:54, 44:56] = 255  # 12x12 text blob sitting on the tone
    image[mask > 0] = 10
    return image, mask, _make_region(30, 30, 40, 40)


def _angle_gap_mod_90(measured_deg: float, expected_deg: float) -> float:
    gap = abs(measured_deg % 90.0 - expected_deg % 90.0)
    return min(gap, 90.0 - gap)


class _RecordingCleaner:
    """Neural-cleaner stand-in that counts calls."""

    def __init__(self) -> None:
        self.calls = 0

    def clean(self, image_rgb: np.ndarray, mask: np.ndarray, region: MaskRegion) -> np.ndarray:
        self.calls += 1
        repaired = image_rgb.copy()
        repaired[mask > 0] = 128
        return repaired


def _gate_crop(image_rgb: np.ndarray) -> np.ndarray:
    # Region (30, 30, 40, 40) padded by the gate's 12 px context margin, i.e.
    # the same neighborhood the fast path analyzes. A tighter 40x40 crop would
    # fail FFT bin spacing (measured peak 26.96 < 55 on this fixture).
    return cv2.cvtColor(image_rgb[18:82, 18:82], cv2.COLOR_RGB2GRAY)


def test_confirmed_screentone_steals_tier3_repair_from_neural_cleaner() -> None:
    image, mask, region = _screentone_page()
    tier3 = _RecordingCleaner()
    inpainter = TieredInpainter(tier3_cleaner=tier3)

    repaired, diag = inpainter.clean_with_diagnostics(image, mask, region)

    assert diag.tier == InpaintTier.TIER_3_NEURAL
    assert diag.cleaner_name == "screentone_fast"
    assert tier3.calls == 0

    # The refill must re-read as the same screen it replaced.
    analysis = analyze_screentone(_gate_crop(repaired))
    assert analysis.is_screentone
    assert analysis.period_px is not None
    assert abs(analysis.period_px - TONE_PERIOD_PX) <= 0.1 * TONE_PERIOD_PX
    assert analysis.angle_rad is not None
    # A +30 deg screen reads as 60 deg in the detector's mod-90 convention.
    measured_deg = math.degrees(analysis.angle_rad)
    assert _angle_gap_mod_90(measured_deg, (-TONE_ANGLE_DEG) % 90.0) <= 5.0


def test_non_screentone_tier3_region_still_goes_to_neural_cleaner() -> None:
    image = np.full((100, 100, 3), 255, dtype=np.uint8)
    mask = np.zeros((100, 100), dtype=np.uint8)
    mask[42:54, 44:56] = 255
    image[mask > 0] = 10
    # Thick linework around the text breaks the dominant-background shortcut,
    # keeping this white-page scene on the Tier 3 artwork route.
    cv2.line(image, (22, 26), (78, 84), 0, 5)
    cv2.line(image, (80, 24), (30, 86), 0, 3)
    region = _make_region(30, 30, 40, 40)
    tier3 = _RecordingCleaner()
    inpainter = TieredInpainter(tier3_cleaner=tier3)

    repaired, diag = inpainter.clean_with_diagnostics(image, mask, region)

    assert diag.tier == InpaintTier.TIER_3_NEURAL
    assert diag.cleaner_name == "_RecordingCleaner"
    assert tier3.calls == 1
    assert np.all(repaired[mask > 0] == 128)


def test_screentone_fast_path_fires_even_without_tier3_cleaner() -> None:
    image, mask, region = _screentone_page()
    inpainter = TieredInpainter(tier3_cleaner=None)

    repaired, diag = inpainter.clean_with_diagnostics(image, mask, region)

    assert diag.tier == InpaintTier.TIER_3_NEURAL
    assert diag.cleaner_name == "screentone_fast"  # not gradient_fallback
    assert analyze_screentone(_gate_crop(repaired)).is_screentone


def test_tier1_solid_region_is_untouched_by_the_gate() -> None:
    image = np.full((100, 100, 3), 255, dtype=np.uint8)
    mask = np.zeros((100, 100), dtype=np.uint8)
    mask[30:70, 40:48] = 255
    mask[30:70, 52:60] = 255
    image[mask > 0] = 10
    region = _make_region(20, 20, 60, 60)
    tier3 = _RecordingCleaner()
    inpainter = TieredInpainter(tier3_cleaner=tier3)

    repaired, diag = inpainter.clean_with_diagnostics(image, mask, region)

    # This fixture's neighborhood even measures detector-positive (sigma 70.4,
    # peak 152.3), so landing "flat" proves the gate sits behind the tier call.
    assert diag.tier == InpaintTier.TIER_1_SOLID
    assert diag.cleaner_name == "flat"
    assert tier3.calls == 0
    assert np.all(repaired[mask > 0] >= 250)
