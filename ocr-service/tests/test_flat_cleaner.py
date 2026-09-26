import cv2
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


def test_gradient_cleaner_inpaints_a_region_crop_not_the_full_page(monkeypatch) -> None:
    # 320x320 page with a small 20x20 text region: inpainting must run on the
    # region crop (+ context), not six full-page passes per region.
    original, mask = _text_on_gradient()
    big = cv2.resize(original, (320, 320), interpolation=cv2.INTER_NEAREST)
    big_mask = cv2.resize(mask, (320, 320), interpolation=cv2.INTER_NEAREST)
    region = MaskRegion(
        id="region-1",
        rect=PixelRect(x=136, y=100, width=40, height=120),
        component_ids=(1,),
        stroke_radius=2,
    )

    shapes: list[tuple[int, int]] = []
    real_inpaint = cv2.inpaint

    def tracking_inpaint(image, src_mask, radius, method):
        shapes.append(image.shape[:2])
        return real_inpaint(image, src_mask, radius, method)

    monkeypatch.setattr(cv2, "inpaint", tracking_inpaint)

    result = GradientCleaner().clean(big, big_mask, region)

    assert shapes, "inpaint was never called"
    assert all(h <= 184 and w <= 104 for (h, w) in shapes), shapes
    assert np.array_equal(result[big_mask == 0], big[big_mask == 0])
    assert not np.array_equal(result[big_mask > 0], big[big_mask > 0])


def test_gradient_cleaner_changes_only_mask_support() -> None:
    original, mask = _text_on_gradient()
    result = GradientCleaner().clean(original, mask, _region())
    assert np.array_equal(result[mask == 0], original[mask == 0])
    assert not np.array_equal(result[mask > 0], original[mask > 0])
