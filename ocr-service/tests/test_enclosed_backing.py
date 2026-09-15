import cv2
import numpy as np
import pytest

from app.mask_refiner import MaskRegion, RefinedMask
from app.pipeline import CleaningPipeline
from app.schemas import AutomaticAction, PixelRect
from app.text_eligibility import classify_eligibility
from test_pipeline import NoTextDetector, SolidCleaner, _comic_page, _empty_protection


def _caption(ellipse=False, supported=True):
    image = np.random.default_rng(15).integers(0, 160, (180, 240, 3), dtype=np.uint8)
    if ellipse:
        cv2.ellipse(image, (126, 90), (54, 42), 0, 0, 360, (255, 255, 255), -1)
        cv2.ellipse(image, (126, 90), (54, 42), 0, 0, 360, (0, 0, 0), 3)
    else:
        cv2.rectangle(image, (80, 58), (184, 121), (255, 255, 255), -1)
        cv2.rectangle(image, (80, 58), (184, 121), (0, 0, 0), 3)
    mask = np.zeros(image.shape[:2], np.uint8)
    cv2.putText(mask, "WHAT", (92, 85), cv2.FONT_HERSHEY_SIMPLEX, 0.8, 255, 2)
    cv2.putText(mask, "NOW?", (92, 111), cv2.FONT_HERSHEY_SIMPLEX, 0.8, 255, 2)
    image[mask > 0] = 0
    x, y, w, h = cv2.boundingRect(mask)
    region = MaskRegion("caption", PixelRect(x=x, y=y, width=w, height=h), (1,), 6, supported)
    return image, mask, region


@pytest.mark.parametrize("ellipse", [False, True])
def test_closed_backing_is_not_penalized_for_artwork_outside_its_border(ellipse):
    image, mask, region = _caption(ellipse)
    decision = classify_eligibility(image, mask, region, _comic_page(), _empty_protection(image, None, None))
    assert decision.action is AutomaticAction.CLEAN
    assert decision.features.backing_uniformity > 0.95


@pytest.mark.parametrize("supported", [False, True])
def test_closed_backing_preserves_text_evidence_gate_and_outside_pixels(supported):
    image, mask, region = _caption(supported=supported)
    pipeline = CleaningPipeline(
        detector=NoTextDetector(),
        refiner=lambda *_: RefinedMask(mask, [region], np.zeros_like(mask)),
        cleaners={key: SolidCleaner(1) for key in ["flat", "gradient", "artwork"]},
        page_classifier=_comic_page,
        protection_detector=_empty_protection,
    )
    output = pipeline.run(image)
    assert np.array_equal(output.clean_image[mask == 0], image[mask == 0])
    if supported:
        assert np.any(output.mask)
        assert np.all(output.clean_image[mask > 0] == 1)
    else:
        assert not np.any(output.mask)
        assert np.array_equal(output.clean_image, image)


def test_open_white_area_does_not_gain_closed_backing_evidence():
    image, mask, region = _caption()
    # White reaches the image border, so there is no bounded balloon/caption.
    image[:130, 60:] = 255
    image[mask > 0] = 0
    decision = classify_eligibility(image, mask, region, _comic_page(), _empty_protection(image, None, None))
    assert decision.features.enclosure_score == 0
    assert decision.features.rectangular_backing == 0
