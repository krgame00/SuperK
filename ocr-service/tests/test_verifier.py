import numpy as np

from app.detector import DetectionResult, LetterboxTransform
from app.mask_refiner import MaskRegion
from app.residual_probe import CompositeResidualProbe
from app.schemas import PixelRect
from app.verifier import verify_damage, verify_region


def _region() -> MaskRegion:
    return MaskRegion(
        id="region-1",
        rect=PixelRect(x=0, y=0, width=32, height=32),
        component_ids=(1,),
        stroke_radius=2,
    )


def test_verifier_rejects_change_outside_support() -> None:
    original = np.zeros((32, 32, 3), np.uint8)
    changed = original.copy()
    changed[0, 0] = 255
    report = verify_damage(
        original,
        changed,
        np.zeros((32, 32), np.uint8),
    )
    assert report.accepted is False


def test_verifier_requests_single_retry_for_residual_text() -> None:
    class ResidualProbe:
        def score(self, _crop: np.ndarray, _mask: np.ndarray) -> float:
            return 0.4

    original = np.zeros((32, 32, 3), np.uint8)
    support = np.zeros((32, 32), np.uint8)
    support[10:20, 10:20] = 255
    report = verify_region(
        original,
        original.copy(),
        support,
        support,
        _region(),
        ResidualProbe(),
    )
    assert report.accepted is False
    assert report.retry_mask_radius == 2


def test_residual_probe_combines_ctd_probability_and_strokes() -> None:
    class Detector:
        def detect(self, image: np.ndarray) -> DetectionResult:
            height, width = image.shape[:2]
            return DetectionResult(
                np.full((height, width), 0.2, np.float32),
                [],
                LetterboxTransform(width, height, width, 1, 0, 0),
            )

    score = CompositeResidualProbe(Detector()).score(
        np.zeros((16, 16, 3), np.uint8),
        np.full((16, 16), 255, np.uint8),
    )
    assert np.isclose(score, 0.15)
