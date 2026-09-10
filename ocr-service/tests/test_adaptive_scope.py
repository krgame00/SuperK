import numpy as np

from app.adaptive_scope import decide_adaptive_scope
from app.mask_refiner import MaskRegion
from app.schemas import PixelRect


def region(region_id: str, x: int, y: int, width: int, height: int) -> MaskRegion:
    return MaskRegion(
        id=region_id,
        rect=PixelRect(x=x, y=y, width=width, height=height),
        component_ids=(),
        stroke_radius=1,
    )


def mask_for(shape: tuple[int, int], regions: list[MaskRegion]) -> np.ndarray:
    mask = np.zeros(shape, np.uint8)
    for item in regions:
        rect = item.rect
        mask[rect.y : rect.y + rect.height, rect.x : rect.x + rect.width] = 255
    return mask


def test_small_localized_mask_selects_roi() -> None:
    regions = [region("a", 200, 300, 80, 50)]
    decision = decide_adaptive_scope(mask_for((1200, 800), regions), regions)
    assert decision.mode == "roi"
    assert decision.cluster_count == 1
    assert decision.mask_coverage < 0.01


def test_nearby_regions_merge_into_one_roi_cluster() -> None:
    regions = [
        region("a", 200, 300, 80, 50),
        region("b", 300, 320, 90, 60),
        region("c", 410, 340, 80, 55),
    ]
    decision = decide_adaptive_scope(mask_for((1200, 800), regions), regions)
    assert decision.mode == "roi"
    assert decision.cluster_count == 1
    assert set(decision.clusters[0].region_ids) == {"a", "b", "c"}


def test_distributed_regions_can_stay_as_multiple_rois() -> None:
    regions = [
        region("a", 80, 120, 50, 40),
        region("b", 620, 900, 50, 40),
    ]
    decision = decide_adaptive_scope(mask_for((1200, 800), regions), regions)
    assert decision.mode == "roi"
    assert decision.cluster_count == 2


def test_large_or_widely_spread_mask_uses_full_page() -> None:
    regions = [
        region("a", 20, 20, 300, 450),
        region("b", 470, 700, 300, 450),
    ]
    decision = decide_adaptive_scope(mask_for((1200, 800), regions), regions)
    assert decision.mode == "full-page"


def test_equivalent_normalized_layouts_choose_same_route_across_resolutions() -> None:
    small_regions = [region("a", 100, 150, 60, 40), region("b", 200, 180, 50, 35)]
    large_regions = [region("a", 200, 300, 120, 80), region("b", 400, 360, 100, 70)]
    small = decide_adaptive_scope(mask_for((600, 400), small_regions), small_regions)
    large = decide_adaptive_scope(mask_for((1200, 800), large_regions), large_regions)
    assert small.mode == large.mode == "roi"
    assert small.cluster_count == large.cluster_count


def test_empty_mask_needs_no_neural_scope() -> None:
    decision = decide_adaptive_scope(np.zeros((600, 400), np.uint8), [])
    assert decision.mode == "none"
    assert decision.cluster_count == 0
