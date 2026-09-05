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


def test_nearby_mixed_orientation_glyphs_share_one_repair_region() -> None:
    probability = np.zeros((48, 48), np.float32)
    probability[14:17, 10:20] = 1
    probability[12:22, 23:26] = 1
    result = refine_probability_mask(
        probability,
        np.zeros((48, 48), np.uint8),
        threshold=0.5,
        minimum_component_area=1,
    )
    assert len(result.regions) == 1


def test_group_regions_caps_maximum_gap_to_prevent_giant_chaining() -> None:
    # Two tall vertical text columns (height 200) separated by 80px
    probability = np.zeros((400, 400), np.float32)
    # Column 1 at x=50..70, y=50..250
    probability[50:250, 50:70] = 1.0
    # Column 2 at x=150..170, y=50..250 (gap of 80px)
    probability[50:250, 150:170] = 1.0

    result = refine_probability_mask(
        probability,
        np.zeros((400, 400), np.uint8),
        threshold=0.5,
        minimum_component_area=1,
    )
    # With uncapped 1.5*median (1.5*200 = 300px), they would be merged into 1 giant region.
    # With capped maximum_gap (50px), the 80px gap keeps them as 2 separate regions.
    assert len(result.regions) == 2, f"Expected 2 regions, got {len(result.regions)}"


def test_text_outline_and_shadow_are_not_blocked_by_protected_edges() -> None:
    # Red curtain background [140, 40, 40]
    image = np.full((60, 60, 3), 40, dtype=np.uint8)
    image[:, :, 0] = 140

    # White text with black stroke outline
    # Black outline at 23:37, 23:37
    image[23:37, 23:37] = 10
    # White core at 25:35, 25:35
    image[25:35, 25:35] = 250

    probability = np.zeros((60, 60), dtype=np.float32)
    probability[25:35, 25:35] = 0.95  # Model detected text core

    protected = build_protected_edges(image, probability)
    # The immediate 2px stroke outline of the letter should NOT be in protected edges
    assert protected[23:37, 23:37].sum() == 0, "Text outline should not be marked as a protected artwork edge"


def test_non_text_artwork_and_body_marks_remain_fully_protected() -> None:
    # Skin tone background
    image = np.full((60, 60, 3), 220, dtype=np.uint8)
    image[:, :, 0] = 240
    image[:, :, 1] = 210
    image[:, :, 2] = 195

    # Red body mark / tattoo 'X' (zero text probability)
    image[20:40, 29:31] = [180, 40, 30]
    image[29:31, 20:40] = [180, 40, 30]

    probability = np.zeros((60, 60), dtype=np.float32)
    # Text is located elsewhere
    probability[5:10, 5:10] = 0.95

    protected = build_protected_edges(image, probability)
    # The body mark contour MUST have protected edges
    assert protected[18:42, 18:42].sum() > 0, "Artwork / body mark edges must remain strictly protected"


