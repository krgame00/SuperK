import os
from functools import wraps
from typing import Callable, TypeVar

import numpy as np

T = TypeVar("T", bound=Callable[..., object])


def adaptive_opt_in(test: T) -> T:
    """Opt into the release-gated path for one test, then restore the env."""
    @wraps(test)
    def wrapped(*args: object, **kwargs: object) -> object:
        previous = os.environ.get("SUPERK_ENABLE_ADAPTIVE_ROI_V2")
        os.environ["SUPERK_ENABLE_ADAPTIVE_ROI_V2"] = "1"
        try:
            return test(*args, **kwargs)
        finally:
            if previous is None:
                os.environ.pop("SUPERK_ENABLE_ADAPTIVE_ROI_V2", None)
            else:
                os.environ["SUPERK_ENABLE_ADAPTIVE_ROI_V2"] = previous

    return wrapped  # type: ignore[return-value]

from app.detector import DetectionResult, LetterboxTransform
from app.mask_refiner import MaskRegion, RefinedMask
from app.page_context import PageContext, PageFeatures
from app.pipeline import CleaningPipeline
from app.protection import ProtectionResult
from app.schemas import AutomaticAction, PageRole, PixelRect, TextRole
from app.text_eligibility import EligibilityDecision, EligibilityFeatures


class Detector:
    def detect(self, image: np.ndarray) -> DetectionResult:
        height, width = image.shape[:2]
        return DetectionResult(
            np.zeros((height, width), np.float32),
            [],
            LetterboxTransform(width, height, max(width, height), 1, 0, 0),
        )


class RecordingLama:
    def __init__(self) -> None:
        self.roi_calls: list[tuple[int, int, int, int]] = []
        self.full_calls = 0

    def clean(self, image, active_mask, _region):
        result = image.copy()
        result[active_mask > 0] = 1
        return result

    def clean_roi(self, image, active_mask, rect):
        self.roi_calls.append((rect.x, rect.y, rect.width, rect.height))
        return self.clean(image, active_mask, None)

    def clean_full_image(self, image, active_mask):
        self.full_calls += 1
        return self.clean(image, active_mask, None)


class PassingProbe:
    def score(self, _crop, _mask):
        return 0.0

    def score_many(self, _image, items):
        return {region.id: 0.0 for region, _mask in items}


class FailingProbe(PassingProbe):
    def score(self, _crop, _mask):
        return 0.3

    def score_many(self, _image, items):
        return {region.id: 0.3 for region, _mask in items}


def region(region_id: str, x: int, y: int, width: int, height: int) -> MaskRegion:
    return MaskRegion(region_id, PixelRect(x=x, y=y, width=width, height=height), (), 1)


def comic_page(*_args) -> PageContext:
    return PageContext(
        role=PageRole.COMIC,
        confidence=0.95,
        features=PageFeatures(0.1, 0.1, 0.1, 0.1, 0),
    )


def empty_protection(image, _page, _regions) -> ProtectionResult:
    empty = np.zeros(image.shape[:2], np.uint8)
    return ProtectionResult(empty.copy(), empty.copy(), [])


def clean_decision(*_args) -> EligibilityDecision:
    return EligibilityDecision(
        text_role=TextRole.DIALOGUE,
        confidence=0.95,
        action=AutomaticAction.CLEAN,
        protection_reasons=[],
        features=EligibilityFeatures(
            enclosure_score=0.95,
            backing_uniformity=0,
            rectangular_backing=0,
            artwork_edge_density=0,
            stroke_irregularity=0,
            margin_fraction=0,
        ),
    )


def make_pipeline(mask: np.ndarray, regions: list[MaskRegion], lama: RecordingLama):
    return CleaningPipeline(
        detector=Detector(),
        refiner=lambda _source, _detection: RefinedMask(
            mask,
            regions,
            np.zeros_like(mask),
        ),
        cleaners={
            "flat": lama,
            "gradient": lama,
            "artwork": lama,
            "lama-large": lama,
        },
        residual_probe=PassingProbe(),
        page_classifier=comic_page,
        protection_detector=empty_protection,
        eligibility_classifier=clean_decision,
    )


@adaptive_opt_in
def test_production_pipeline_uses_roi_for_localized_mask() -> None:
    image = np.zeros((800, 600, 3), np.uint8)
    mask = np.zeros((800, 600), np.uint8)
    mask[280:330, 200:270] = 255
    regions = [
        MaskRegion(
            id="one",
            rect=PixelRect(x=200, y=280, width=70, height=50),
            component_ids=(1,),
            stroke_radius=2,
        )
    ]
    lama = RecordingLama()
    output = make_pipeline(mask, regions, lama).run(image)

    assert len(lama.roi_calls) == 1
    assert lama.full_calls == 0
    assert np.all(output.clean_image[mask > 0] == 1)
    assert np.array_equal(output.clean_image[mask == 0], image[mask == 0])
    assert output.timings_ms["clean_ms"] == output.timings_ms["clean"]
    assert output.timings_ms["verification_ms"] == output.timings_ms["verify"]
    assert output.timings_ms["changed_pixels_outside_support"] == 0
    assert output.timings_ms["protected_mask_changes"] == 0


@adaptive_opt_in
def test_production_pipeline_uses_full_page_for_large_distributed_mask() -> None:
    image = np.zeros((800, 600, 3), np.uint8)
    mask = np.zeros((800, 600), np.uint8)
    mask[20:320, 20:250] = 255
    mask[480:780, 350:580] = 255
    regions = [
        MaskRegion("one", PixelRect(x=20, y=20, width=230, height=300), (1,), 2),
        MaskRegion("two", PixelRect(x=350, y=480, width=230, height=300), (2,), 2),
    ]
    lama = RecordingLama()
    make_pipeline(mask, regions, lama).run(image)

    assert lama.roi_calls == []
    assert lama.full_calls == 1


@adaptive_opt_in
def test_adaptive_roi_kill_switch_uses_legacy_full_page_path() -> None:
    image = np.zeros((800, 600, 3), np.uint8)
    mask = np.zeros((800, 600), np.uint8)
    mask[280:330, 200:270] = 255
    regions = [region("one", 200, 280, 70, 50)]
    lama = RecordingLama()
    previous = os.environ.get("SUPERK_DISABLE_ADAPTIVE_ROI")
    os.environ["SUPERK_DISABLE_ADAPTIVE_ROI"] = "1"
    try:
        output = make_pipeline(mask, regions, lama).run(image)
    finally:
        if previous is None:
            os.environ.pop("SUPERK_DISABLE_ADAPTIVE_ROI", None)
        else:
            os.environ["SUPERK_DISABLE_ADAPTIVE_ROI"] = previous

    assert lama.roi_calls == []
    assert lama.full_calls == 1
    assert output.timings_ms["adaptive_route"] == "legacy-full-page"


@adaptive_opt_in
def test_roi_quality_failure_escalates_to_expanded_then_full_page_at_most_once() -> None:
    image = np.zeros((800, 600, 3), np.uint8)
    mask = np.zeros((800, 600), np.uint8)
    mask[280:330, 200:270] = 255
    regions = [region("one", 200, 280, 70, 50)]
    lama = RecordingLama()
    pipeline = CleaningPipeline(
        detector=Detector(),
        refiner=lambda _source, _detection: RefinedMask(mask, regions, np.zeros_like(mask)),
        cleaners={"flat": lama, "gradient": lama, "artwork": lama, "lama-large": lama},
        residual_probe=FailingProbe(),
        page_classifier=comic_page,
        protection_detector=empty_protection,
        eligibility_classifier=clean_decision,
    )

    output = pipeline.run(image)

    assert len(lama.roi_calls) == 2
    assert lama.roi_calls[1][2] > lama.roi_calls[0][2]
    assert lama.full_calls == 1
    assert output.awaiting_review is True
    assert output.timings_ms["escalation_attempts"] == 2
