import numpy as np

from app.mask_refiner import MaskRegion
from app.region_router import route_region
from app.schemas import CleanerRoute, PixelRect


def _region(size: int = 64) -> MaskRegion:
    return MaskRegion(
        id="region-1",
        rect=PixelRect(x=0, y=0, width=size, height=size),
        component_ids=(1,),
        stroke_radius=2,
    )


def _glyph_mask(size: int = 64) -> np.ndarray:
    mask = np.zeros((size, size), np.uint8)
    mask[24:40, 28:32] = 255
    mask[24:40, 36:40] = 255
    return mask


def test_uniform_white_region_routes_flat() -> None:
    image = np.full((64, 64, 3), 248, np.uint8)
    decision = route_region(image, _glyph_mask(), _region())
    assert decision.route is CleanerRoute.FLAT
    assert decision.confidence >= 0.8


def test_edge_dense_region_routes_artwork() -> None:
    yy, xx = np.indices((64, 64))
    values = ((xx // 2 + yy // 2) % 2 * 255).astype(np.uint8)
    image = np.repeat(values[..., None], 3, axis=2)
    decision = route_region(image, _glyph_mask(), _region())
    assert decision.route is CleanerRoute.ARTWORK


def test_smooth_ramp_routes_gradient() -> None:
    ramp = np.linspace(20, 240, 64, dtype=np.uint8)
    image = np.repeat(ramp[None, :, None], 64, axis=0)
    image = np.repeat(image, 3, axis=2)
    decision = route_region(image, _glyph_mask(), _region())
    assert decision.route is CleanerRoute.GRADIENT
    assert decision.features.gradient_coherence >= 0.55


def test_screentone_fast_path_routing() -> None:
    # 256x256 synthetic halftone dot pattern
    xs = np.arange(256, dtype=np.float64)
    xx, yy = np.meshgrid(xs, xs)
    import math
    rad = math.radians(30.0)
    x_rot = xx * math.cos(rad) - yy * math.sin(rad)
    y_rot = xx * math.sin(rad) + yy * math.cos(rad)
    wave = 0.5 * np.cos(2 * math.pi * x_rot / 8.0) + 0.5 * np.cos(2 * math.pi * y_rot / 8.0)
    gray = np.where(wave > 0.0, 255, 0).astype(np.uint8)
    image = np.repeat(gray[..., None], 3, axis=2)

    region = MaskRegion(
        id="tone-1",
        rect=PixelRect(x=32, y=32, width=192, height=192),
        component_ids=(1,),
        stroke_radius=2,
    )
    mask = np.zeros((256, 256), np.uint8)
    mask[64:128, 64:128] = 255

    cleaners = {"lama-large": object(), "screentone": object()}
    decision = route_region(image, mask, region, cleaners=cleaners)

    assert decision.route is CleanerRoute.ARTWORK
    assert decision.features.is_screentone is True
    assert decision.preferred_cleaner == "screentone"


def test_merge_adjacent_regions_within_threshold() -> None:
    from app.region_router import merge_adjacent_regions

    r1 = MaskRegion(
        id="r1",
        rect=PixelRect(x=10, y=10, width=50, height=50),
        component_ids=(1,),
        stroke_radius=2,
    )
    # r2 is 20px to the right of r1 (gap = 80 - 60 = 20 <= 48)
    r2 = MaskRegion(
        id="r2",
        rect=PixelRect(x=80, y=10, width=50, height=50),
        component_ids=(2,),
        stroke_radius=3,
    )
    # r3 is far away (gap = 300 - 130 = 170 > 48)
    r3 = MaskRegion(
        id="r3",
        rect=PixelRect(x=300, y=10, width=50, height=50),
        component_ids=(3,),
        stroke_radius=2,
    )

    merged = merge_adjacent_regions([r1, r2, r3], max_gap=48, max_dimension=768)
    assert len(merged) == 2
    # First region is merged r1+r2
    assert "r1" in merged[0].id and "r2" in merged[0].id
    assert merged[0].rect.x == 10
    assert merged[0].rect.y == 10
    assert merged[0].rect.width == 120  # 80 + 50 - 10 = 120
    assert merged[0].rect.height == 50
    assert merged[0].component_ids == (1, 2)
    assert merged[0].stroke_radius == 3
    # Second region is untouched r3
    assert merged[1].id == "r3"


def test_merge_adjacent_regions_exceeding_max_dimension() -> None:
    from app.region_router import merge_adjacent_regions

    r1 = MaskRegion(
        id="r1",
        rect=PixelRect(x=0, y=0, width=500, height=100),
        component_ids=(1,),
        stroke_radius=2,
    )
    r2 = MaskRegion(
        id="r2",
        rect=PixelRect(x=510, y=0, width=300, height=100),
        component_ids=(2,),
        stroke_radius=2,
    )
    # Gap is 10px <= 48, but combined width is 810 > 768 -> do not merge
    merged = merge_adjacent_regions([r1, r2], max_gap=48, max_dimension=768)
    assert len(merged) == 2

