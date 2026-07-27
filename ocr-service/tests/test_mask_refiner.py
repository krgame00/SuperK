import numpy as np

from app.detector import DetectionResult, LetterboxTransform
from app.mask_refiner import (
    MaskRefinementConfig,
    build_protected_edges,
    constrained_dilate,
    refine_mask,
    refine_probability_mask,
)


def test_dilation_follows_glyph_not_full_box() -> None:
    probability = np.zeros((40, 80), np.float32)
    probability[15:25, 20:23] = 1
    probability[15:25, 30:33] = 1
    result = refine_probability_mask(
        probability,
        np.zeros((40, 80), np.uint8),
        threshold=0.5,
    )
    assert result.mask[20, 25] == 0
    assert np.count_nonzero(result.mask) < 400


def test_mask_growth_stops_at_protected_edge() -> None:
    seed = np.zeros((30, 30), np.uint8)
    seed[12:18, 8:11] = 255
    edge = np.zeros_like(seed)
    edge[:, 13] = 255
    grown = constrained_dilate(seed, edge, radius=5)
    assert grown[:, 14:].sum() == 0


def test_high_confidence_text_is_not_a_protected_edge() -> None:
    image = np.full((30, 30, 3), 255, np.uint8)
    image[:, 14:16] = 0
    probability = np.zeros((30, 30), np.float32)
    probability[:, 14:16] = 0.9
    edges = build_protected_edges(image, probability)
    assert edges[:, 14:16].sum() == 0


def test_random_refinement_preserves_seed_and_image_bounds() -> None:
    random = np.random.default_rng(20260727)
    for _ in range(100):
        height, width = random.integers(16, 80, size=2)
        probability = np.zeros((height, width), np.float32)
        x = int(random.integers(0, width))
        y = int(random.integers(0, height))
        probability[y, x] = 1
        refined = refine_probability_mask(
            probability,
            np.zeros((height, width), np.uint8),
            threshold=0.5,
            minimum_component_area=1,
        )
        assert refined.mask.shape == probability.shape
        assert refined.mask[y, x] == 255
        for region in refined.regions:
            assert region.rect.x + region.rect.width <= width
            assert region.rect.y + region.rect.height <= height


def test_refine_mask_builds_regions_from_detector_probability() -> None:
    image = np.full((60, 80, 3), 255, np.uint8)
    probability = np.zeros((60, 80), np.float32)
    probability[20:35, 25:30] = 1
    detection = DetectionResult(
        mask_probability=probability,
        blocks=[],
        scale=LetterboxTransform(80, 60, 80, 1, 0, 0),
    )
    result = refine_mask(image, detection, MaskRefinementConfig(threshold=0.5))
    assert result.mask[25, 27] == 255
    assert len(result.regions) == 1
    assert result.regions[0].rect.x <= 25
