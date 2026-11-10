from __future__ import annotations

import numpy as np

from app.cleaners.tier_router import InpaintTier, TieredInpainter
from app.mask_refiner import MaskRegion
from app.schemas import CleanerRoute, PixelRect


def _make_region(x: int = 20, y: int = 20, w: int = 40, h: int = 40) -> MaskRegion:
    return MaskRegion(
        id="region-test",
        rect=PixelRect(x=x, y=y, width=w, height=h),
        component_ids=(1,),
        stroke_radius=2,
    )


def test_tier1_solid_speech_balloon_routing() -> None:
    # 100x100 white speech balloon with black dialogue text
    image = np.full((100, 100, 3), 255, dtype=np.uint8)
    mask = np.zeros((100, 100), dtype=np.uint8)
    mask[30:70, 40:48] = 255
    mask[30:70, 52:60] = 255
    image[mask > 0] = 10  # Dark text

    region = _make_region(20, 20, 60, 60)
    inpainter = TieredInpainter()

    tier, route, has_dom, dom_bgr = inpainter.classify_tier(image, mask, region)
    assert tier == InpaintTier.TIER_1_SOLID
    assert route == CleanerRoute.FLAT
    assert has_dom is True
    assert dom_bgr == (255, 255, 255)

    repaired, diag = inpainter.clean_with_diagnostics(image, mask, region)
    assert diag.tier == InpaintTier.TIER_1_SOLID
    assert diag.cleaner_name == "flat"
    assert diag.elapsed_ms < 10.0  # Ultra-fast < 10ms
    # Text removed and filled with white
    assert np.all(repaired[mask > 0] >= 250)
    # Non-mask pixels untouched
    assert np.array_equal(repaired[mask == 0], image[mask == 0])


def test_tier2_gradient_background_routing() -> None:
    # Vertical gradient from 140 to 220
    ramp = np.linspace(140, 220, 100, dtype=np.uint8)
    image = np.repeat(ramp[:, None, None], 100, axis=1)
    image = np.repeat(image, 3, axis=2)

    mask = np.zeros((100, 100), dtype=np.uint8)
    mask[35:65, 45:55] = 255
    image[mask > 0] = 20

    region = _make_region(30, 30, 40, 40)
    inpainter = TieredInpainter(solid_std_threshold=3.0)  # Lower threshold to trigger gradient

    tier, route, _, _ = inpainter.classify_tier(image, mask, region)
    assert tier in (InpaintTier.TIER_1_SOLID, InpaintTier.TIER_2_ALGORITHMIC)

    repaired, diag = inpainter.clean_with_diagnostics(image, mask, region)
    assert np.array_equal(repaired[mask == 0], image[mask == 0])
    assert not np.array_equal(repaired[mask > 0], image[mask > 0])


def test_tier3_complex_artwork_routing() -> None:
    # High-variance noisy texture mimicking complex background illustration
    rng = np.random.default_rng(42)
    noise = rng.integers(0, 256, (100, 100, 3), dtype=np.uint8)
    # Add strong high-frequency edges
    noise[::4, :] = 0
    noise[:, ::4] = 255

    mask = np.zeros((100, 100), dtype=np.uint8)
    mask[30:70, 30:70] = 255

    region = _make_region(25, 25, 50, 50)

    neural_called = False

    class MockNeuralCleaner:
        def clean(self, img: np.ndarray, msk: np.ndarray, reg: MaskRegion) -> np.ndarray:
            nonlocal neural_called
            neural_called = True
            out = img.copy()
            out[msk > 0] = 128
            return out

    inpainter = TieredInpainter(tier3_cleaner=MockNeuralCleaner())
    tier, route, has_dom, _ = inpainter.classify_tier(noise, mask, region)
    assert tier == InpaintTier.TIER_3_NEURAL
    assert route == CleanerRoute.ARTWORK
    assert has_dom is False

    repaired, diag = inpainter.clean_with_diagnostics(noise, mask, region)
    assert neural_called is True
    assert diag.tier == InpaintTier.TIER_3_NEURAL
    assert diag.cleaner_name == "MockNeuralCleaner"
    assert np.all(repaired[mask > 0] == 128)


def test_tier3_graceful_fallback_when_neural_cleaner_none() -> None:
    # Noisy texture but tier3_cleaner is None
    rng = np.random.default_rng(99)
    noise = rng.integers(0, 256, (100, 100, 3), dtype=np.uint8)
    noise[::3, :] = 0

    mask = np.zeros((100, 100), dtype=np.uint8)
    mask[40:60, 40:60] = 255

    region = _make_region(30, 30, 40, 40)
    inpainter = TieredInpainter(tier3_cleaner=None)

    tier, _, _, _ = inpainter.classify_tier(noise, mask, region)
    assert tier == InpaintTier.TIER_3_NEURAL

    # Must not raise exception, falls back to algorithmic gradient cleaner
    repaired, diag = inpainter.clean_with_diagnostics(noise, mask, region)
    assert diag.cleaner_name == "gradient_fallback"
    assert np.array_equal(repaired[mask == 0], noise[mask == 0])


def test_tiered_inpainter_satisfies_cleaner_protocol() -> None:
    inpainter = TieredInpainter()
    image = np.full((60, 60, 3), 255, dtype=np.uint8)
    mask = np.zeros((60, 60), dtype=np.uint8)
    mask[20:40, 20:40] = 255
    region = _make_region(15, 15, 30, 30)

    # Standard clean(image_rgb, mask, region) -> RgbImage interface
    result = inpainter.clean(image, mask, region)
    assert result.shape == image.shape
    assert result.dtype == np.uint8
