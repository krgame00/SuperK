import numpy as np

from app.cleaners.flat import FlatCleaner, GradientCleaner
from app.mask_refiner import MaskRegion
from app.schemas import PixelRect


def _region(size: int = 80) -> MaskRegion:
    return MaskRegion(
        id="region-1",
        rect=PixelRect(x=0, y=0, width=size, height=size),
        component_ids=(1,),
        stroke_radius=2,
    )


def _text_on_gradient() -> tuple[np.ndarray, np.ndarray]:
    ramp = np.linspace(180, 245, 80, dtype=np.uint8)
    image = np.repeat(ramp[None, :, None], 80, axis=0)
    image = np.repeat(image, 3, axis=2)
    mask = np.zeros((80, 80), np.uint8)
    mask[25:55, 34:39] = 255
    mask[25:55, 45:50] = 255
    image[mask > 0] = 20
    return image, mask


def test_flat_cleaner_changes_only_mask_support() -> None:
    original, mask = _text_on_gradient()
    result = FlatCleaner().clean(original, mask, _region())
    assert np.array_equal(result[mask == 0], original[mask == 0])
    assert not np.array_equal(result[mask > 0], original[mask > 0])


def test_gradient_cleaner_changes_only_mask_support() -> None:
    original, mask = _text_on_gradient()
    result = GradientCleaner().clean(original, mask, _region())
    assert np.array_equal(result[mask == 0], original[mask == 0])
    assert not np.array_equal(result[mask > 0], original[mask > 0])
