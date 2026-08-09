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
