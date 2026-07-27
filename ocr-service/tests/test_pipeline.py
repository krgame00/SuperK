from pathlib import Path

import numpy as np

from app.cache import ResultCache
from app.detector import DetectionResult, LetterboxTransform
from app.mask_refiner import MaskRegion, RefinedMask
from app.pipeline import CleaningPipeline
from app.schemas import PixelRect, RegionStatus


class NoTextDetector:
    def detect(self, image: np.ndarray) -> DetectionResult:
        height, width = image.shape[:2]
        return DetectionResult(
            np.zeros((height, width), np.float32),
            [],
            LetterboxTransform(width, height, max(width, height), 1, 0, 0),
        )


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
    )
    output = pipeline.run(image)
    assert cleaner.calls == 2
    assert np.array_equal(output.clean_image, image)
    assert output.regions[0].status is RegionStatus.NEEDS_REVIEW


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
    cache.store(key, image, mask, {"job_id": "job-1"})
    loaded = cache.load(key)
    assert loaded is not None
    assert np.array_equal(loaded.clean_image, image)
    assert np.array_equal(loaded.mask, mask)
