from pathlib import Path

import numpy as np

from app.cache import ResultCache
from app.detector import DetectionResult, LetterboxTransform
from app.mask_refiner import MaskRegion, RefinedMask
from app.page_context import PageContext, PageFeatures
from app.pipeline import CleaningPipeline, PipelineOutput
from app.protection import ProtectionResult
from app.schemas import (
    AutomaticAction,
    ManualRegionAction,
    PageRole,
    PixelRect,
    ProtectionReason,
    RegionRecord,
    RegionStatus,
    TextRole,
)
from app.text_eligibility import EligibilityDecision, EligibilityFeatures


class NoTextDetector:
    def detect(self, image: np.ndarray) -> DetectionResult:
        height, width = image.shape[:2]
        return DetectionResult(
            np.zeros((height, width), np.float32),
            [],
            LetterboxTransform(width, height, max(width, height), 1, 0, 0),
        )


def _comic_page(*_args) -> PageContext:
    return PageContext(
        role=PageRole.COMIC,
        confidence=0.95,
        features=PageFeatures(0.1, 0.1, 0.1, 0.1, 0),
    )


def _empty_protection(image, _page, _regions) -> ProtectionResult:
    empty = np.zeros(image.shape[:2], np.uint8)
    return ProtectionResult(empty.copy(), empty.copy(), [])


def _clean_decision(*_args) -> EligibilityDecision:
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


class SolidCleaner:
    def __init__(self, value: int) -> None:
        self.value = value

    def clean(self, image, active_mask, _region):
        result = image.copy()
        result[active_mask > 0] = self.value
        return result


def _single_region_output(
    *,
    source_value: int = 100,
    clean_value: int = 100,
) -> PipelineOutput:
    source = np.full((32, 32, 3), source_value, np.uint8)
    clean = np.full_like(source, clean_value)
    empty = np.zeros((32, 32), np.uint8)
    return PipelineOutput(
        source_image=source,
        clean_image=clean,
        mask=empty.copy(),
        review_mask=empty.copy(),
        protected_mask=empty.copy(),
        regions=[
            RegionRecord(
                id="region-1",
                rect=PixelRect(x=8, y=8, width=12, height=12),
                route="flat",
                confidence=0.9,
                status=RegionStatus.PRESERVED,
                residual_score=0,
                damage_score=0,
                page_role=PageRole.COMIC,
                text_role=TextRole.REVIEW,
                eligibility_confidence=0.6,
                automatic_action=AutomaticAction.PRESERVE,
                protection_reasons=[],
            ),
        ],
        timings_ms={"total": 1},
    )


def test_pipeline_never_changes_protected_pixels() -> None:
    source = np.random.default_rng(20260728).integers(
        0,
        256,
        (32, 32, 3),
        dtype=np.uint8,
    )
    refined_mask = np.zeros((32, 32), np.uint8)
    refined_mask[8:24, 8:24] = 255
    protected = np.zeros_like(refined_mask)
    protected[12:20, 12:20] = 255
    region = MaskRegion(
        id="region-1",
        rect=PixelRect(x=8, y=8, width=16, height=16),
        component_ids=(1,),
        stroke_radius=2,
    )

    def protection_detector(_image, _page, _regions):
        return ProtectionResult(protected, np.zeros_like(protected), [])

    pipeline = CleaningPipeline(
        detector=NoTextDetector(),
        refiner=lambda _source, _detection: RefinedMask(
            refined_mask,
            [region],
            np.zeros_like(refined_mask),
        ),
        cleaners={
            "flat": SolidCleaner(0),
            "gradient": SolidCleaner(0),
            "artwork": SolidCleaner(0),
        },
        page_classifier=_comic_page,
        protection_detector=protection_detector,
        eligibility_classifier=_clean_decision,
    )

    output = pipeline.run(source)
    support = protected > 0

    assert np.array_equal(output.clean_image[support], source[support])
    assert not np.any(output.mask[support])


def test_policy_preserved_sfx_is_not_sent_to_cleaner() -> None:
    mask = np.zeros((32, 32), np.uint8)
    mask[8:16, 8:16] = 255
    region = MaskRegion(
        id="sfx-1",
        rect=PixelRect(x=8, y=8, width=8, height=8),
        component_ids=(1,),
        stroke_radius=2,
    )

    def sfx_decision(*_args) -> EligibilityDecision:
        return EligibilityDecision(
            text_role=TextRole.SFX,
            confidence=0.95,
            action=AutomaticAction.PRESERVE,
            protection_reasons=[ProtectionReason.SFX_POLICY],
            features=EligibilityFeatures(
                enclosure_score=0,
                backing_uniformity=0,
                rectangular_backing=0,
                artwork_edge_density=0.95,
                stroke_irregularity=0.95,
                margin_fraction=0,
            ),
        )

    class FailingCleaner:
        def clean(self, *_args):
            raise AssertionError("policy-preserved SFX reached cleaner")

    failing_cleaner = FailingCleaner()
    pipeline = CleaningPipeline(
        detector=NoTextDetector(),
        refiner=lambda _source, _detection: RefinedMask(
            mask,
            [region],
            np.zeros_like(mask),
        ),
        cleaners={
            "flat": failing_cleaner,
            "gradient": failing_cleaner,
            "artwork": failing_cleaner,
        },
        page_classifier=_comic_page,
        protection_detector=_empty_protection,
        eligibility_classifier=sfx_decision,
    )
    source = np.full((32, 32, 3), 100, np.uint8)
    output = pipeline.run(source)

    assert np.array_equal(output.clean_image, source)
    assert output.regions[0].status is RegionStatus.PRESERVED
    assert output.regions[0].text_role is TextRole.SFX
    assert output.regions[0].automatic_action is AutomaticAction.PRESERVE


def test_force_clean_is_the_only_action_that_can_override_review() -> None:
    output = _single_region_output()
    user_mask = np.zeros((32, 32), np.uint8)
    user_mask[10:14, 10:14] = 255
    pipeline = CleaningPipeline(
        detector=NoTextDetector(),
        cleaners={"flat": SolidCleaner(0), "aot": SolidCleaner(0)},
        page_classifier=_comic_page,
        protection_detector=_empty_protection,
        eligibility_classifier=_clean_decision,
    )

    forced = pipeline.retry_region(
        output,
        "region-1",
        user_mask,
        "aot",
        ManualRegionAction.FORCE_CLEAN,
    )

    assert forced.regions[0].automatic_action is AutomaticAction.CLEAN
    assert np.all(forced.clean_image[user_mask > 0] == 0)
    assert np.array_equal(
        forced.clean_image[user_mask == 0],
        output.clean_image[user_mask == 0],
    )


def test_protect_restores_source_pixels() -> None:
    output = _single_region_output(clean_value=0)
    user_mask = np.zeros((32, 32), np.uint8)
    user_mask[10:14, 10:14] = 255
    pipeline = CleaningPipeline(
        detector=NoTextDetector(),
        cleaners={},
        page_classifier=_comic_page,
        protection_detector=_empty_protection,
        eligibility_classifier=_clean_decision,
    )

    protected = pipeline.retry_region(
        output,
        "region-1",
        user_mask,
        "auto",
        ManualRegionAction.PROTECT,
    )
    support = user_mask > 0

    assert np.array_equal(
        protected.clean_image[support],
        protected.source_image[support],
    )
    assert np.all(protected.protected_mask[support] == 255)
    assert not np.any(protected.mask[support])


def test_text_free_pipeline_is_pixel_identical() -> None:
    image = np.arange(32 * 32 * 3, dtype=np.uint8).reshape(32, 32, 3)
    pipeline = CleaningPipeline(
        detector=NoTextDetector(),
        refiner=lambda source, detection: RefinedMask(
            np.zeros(source.shape[:2], np.uint8),
            [],
            np.zeros(source.shape[:2], np.uint8),
        ),
        cleaners={},
    )
    output = pipeline.run(image)
    assert np.array_equal(output.clean_image, image)
    assert output.mask.sum() == 0
    assert output.regions == []


def test_pipeline_retries_once_then_restores_failed_region() -> None:
    mask = np.zeros((32, 32), np.uint8)
    mask[10:20, 12:18] = 255
    region = MaskRegion(
        id="region-1",
        rect=PixelRect(x=8, y=8, width=14, height=14),
        component_ids=(1,),
        stroke_radius=2,
    )

    class Detector(NoTextDetector):
        def detect(self, image: np.ndarray) -> DetectionResult:
            return DetectionResult(
                mask.astype(np.float32) / 255,
                [],
                LetterboxTransform(32, 32, 32, 1, 0, 0),
            )

    class Cleaner:
        calls = 0

        def clean(
            self,
            image: np.ndarray,
            active_mask: np.ndarray,
            _region: MaskRegion,
        ) -> np.ndarray:
            self.calls += 1
            result = image.copy()
            result[active_mask > 0] = 1
            return result

    class Probe:
        def score(self, _crop: np.ndarray, _mask: np.ndarray) -> float:
            return 0.5

    cleaner = Cleaner()
    image = np.zeros((32, 32, 3), np.uint8)
    pipeline = CleaningPipeline(
        detector=Detector(),
        refiner=lambda _source, _detection: RefinedMask(
            mask,
            [region],
            np.zeros_like(mask),
        ),
        cleaners={"flat": cleaner},
        residual_probe=Probe(),
        page_classifier=_comic_page,
        protection_detector=_empty_protection,
        eligibility_classifier=_clean_decision,
    )
    output = pipeline.run(image)
    assert cleaner.calls == 2
    assert np.array_equal(output.clean_image, image)
    assert output.regions[0].status is RegionStatus.NEEDS_REVIEW


def test_pipeline_batches_initial_residual_detection_across_regions() -> None:
    mask = np.zeros((32, 32), np.uint8)
    mask[4:8, 4:8] = 255
    mask[20:24, 20:24] = 255
    regions = [
        MaskRegion(
            id="region-1",
            rect=PixelRect(x=2, y=2, width=8, height=8),
            component_ids=(1,),
            stroke_radius=2,
        ),
        MaskRegion(
            id="region-2",
            rect=PixelRect(x=18, y=18, width=8, height=8),
            component_ids=(2,),
            stroke_radius=2,
        ),
    ]

    class Cleaner:
        def clean(self, image, active_mask, _region):
            result = image.copy()
            result[active_mask > 0] = 255
            return result

    class BatchProbe:
        batch_calls = 0
        single_calls = 0

        def score(self, _crop, _mask):
            self.single_calls += 1
            return 0.0

        def score_many(self, _image, items):
            self.batch_calls += 1
            return {region.id: 0.0 for region, _mask in items}

    probe = BatchProbe()
    pipeline = CleaningPipeline(
        detector=NoTextDetector(),
        refiner=lambda _source, _detection: RefinedMask(
            mask,
            regions,
            np.zeros_like(mask),
        ),
        cleaners={"flat": Cleaner()},
        residual_probe=probe,
        page_classifier=_comic_page,
        protection_detector=_empty_protection,
        eligibility_classifier=_clean_decision,
    )
    output = pipeline.run(np.zeros((32, 32, 3), np.uint8))
    assert len(output.regions) == 2
    assert probe.batch_calls == 1
    assert probe.single_calls == 0


def test_result_cache_round_trips_lossless_assets(tmp_path: Path) -> None:
    cache = ResultCache(tmp_path)
    key = cache.key_for(
        b"source",
        pipeline_version="1",
        detector_model_sha="a" * 64,
        cleaner_model_sha="b" * 64,
        settings={"threshold": 0.45},
    )
    image = np.full((8, 8, 3), 123, np.uint8)
    mask = np.zeros((8, 8), np.uint8)
    review_mask = np.zeros_like(mask)
    review_mask[1:3, 1:3] = 255
    protected_mask = np.zeros_like(mask)
    protected_mask[5:7, 5:7] = 255
    cache.store(
        key,
        image,
        mask,
        review_mask,
        protected_mask,
        {"job_id": "job-1"},
    )
    loaded = cache.load(key)
    assert loaded is not None
    assert np.array_equal(loaded.clean_image, image)
    assert np.array_equal(loaded.mask, mask)
    assert np.array_equal(loaded.review_mask, review_mask)
    assert np.array_equal(loaded.protected_mask, protected_mask)
