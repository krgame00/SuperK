from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from time import perf_counter
from typing import Protocol

import cv2
import numpy as np

from app.cleaners.base import Cleaner
from app.compositor import compose
from app.detector import DetectionResult, RgbImage
from app.mask_refiner import BinaryMask, MaskRegion, RefinedMask, refine_mask
from app.region_router import route_region
from app.schemas import (
    CleanerRoute,
    JobStage,
    RegionRecord,
    RegionStatus,
)
from app.verifier import ResidualProbe, verify_region


class Detector(Protocol):
    def detect(self, image_rgb: RgbImage) -> DetectionResult: ...


Refiner = Callable[[RgbImage, DetectionResult], RefinedMask]
ProgressCallback = Callable[[JobStage, int, int], None]


@dataclass(frozen=True)
class PipelineOutput:
    clean_image: RgbImage
    mask: BinaryMask
    regions: list[RegionRecord]
    timings_ms: dict[str, int]


class _ZeroResidualProbe:
    def score(self, _crop: RgbImage, _mask: BinaryMask) -> float:
        return 0.0


class CleaningPipeline:
    def __init__(
        self,
        *,
        detector: Detector,
        cleaners: Mapping[str | CleanerRoute, Cleaner],
        refiner: Refiner = refine_mask,
        residual_probe: ResidualProbe | None = None,
    ) -> None:
        self.detector = detector
        self.refiner = refiner
        self.cleaners = {
            key.value if isinstance(key, CleanerRoute) else key: value
            for key, value in cleaners.items()
        }
        self.residual_probe = residual_probe or _ZeroResidualProbe()

    def run(
        self,
        image_rgb: RgbImage,
        progress_callback: ProgressCallback | None = None,
    ) -> PipelineOutput:
        started = perf_counter()
        stage_started = started
        detection = self.detector.detect(image_rgb)
        detect_ms = _elapsed_ms(stage_started)
        _progress(progress_callback, JobStage.REFINING, 0, 0)

        stage_started = perf_counter()
        refined = self.refiner(image_rgb, detection)
        refine_ms = _elapsed_ms(stage_started)
        if not refined.regions:
            return PipelineOutput(
                clean_image=image_rgb.copy(),
                mask=np.zeros(image_rgb.shape[:2], np.uint8),
                regions=[],
                timings_ms={
                    "detect": detect_ms,
                    "refine": refine_ms,
                    "clean": 0,
                    "verify": 0,
                    "total": _elapsed_ms(started),
                },
            )

        clean_ms = 0
        verify_ms = 0
        clean_image = image_rgb.copy()
        records: list[RegionRecord] = []
        total = len(refined.regions)
        for index, region in enumerate(refined.regions):
            _progress(progress_callback, JobStage.CLEANING, index, total)
            region_mask = _region_mask(refined.mask, region)
            decision = route_region(image_rgb, region_mask, region)
            cleaner = self.cleaners.get(decision.route.value)
            if cleaner is None:
                raise RuntimeError(f"no cleaner configured for {decision.route.value}")

            before = clean_image.copy()
            stage_started = perf_counter()
            repaired = cleaner.clean(before, region_mask, region)
            candidate, support = compose(before, repaired, region_mask)
            clean_ms += _elapsed_ms(stage_started)
            stage_started = perf_counter()
            report = verify_region(
                before,
                candidate,
                region_mask,
                support,
                region,
                self.residual_probe,
            )
            verify_ms += _elapsed_ms(stage_started)
            if not report.accepted and report.retry_mask_radius is not None:
                stage_started = perf_counter()
                retry_mask = cv2.dilate(
                    region_mask,
                    cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)),
                )
                retry_repaired = cleaner.clean(before, retry_mask, region)
                candidate, support = compose(before, retry_repaired, retry_mask)
                clean_ms += _elapsed_ms(stage_started)
                stage_started = perf_counter()
                report = verify_region(
                    before,
                    candidate,
                    retry_mask,
                    support,
                    region,
                    self.residual_probe,
                )
                verify_ms += _elapsed_ms(stage_started)

            if report.accepted:
                clean_image = candidate
                status = RegionStatus.REPAIRED
            else:
                clean_image = before
                status = RegionStatus.NEEDS_REVIEW
            records.append(
                RegionRecord(
                    id=region.id,
                    rect=region.rect,
                    route=decision.route,
                    confidence=decision.confidence,
                    status=status,
                    residual_score=report.residual_score,
                    damage_score=report.damage_score,
                ),
            )
        _progress(progress_callback, JobStage.COMPLETE, total, total)
        return PipelineOutput(
            clean_image=clean_image,
            mask=refined.mask.copy(),
            regions=records,
            timings_ms={
                "detect": detect_ms,
                "refine": refine_ms,
                "clean": clean_ms,
                "verify": verify_ms,
                "total": _elapsed_ms(started),
            },
        )


def _region_mask(mask: BinaryMask, region: MaskRegion) -> BinaryMask:
    output = np.zeros_like(mask)
    rect = region.rect
    output[
        rect.y : rect.y + rect.height,
        rect.x : rect.x + rect.width,
    ] = mask[
        rect.y : rect.y + rect.height,
        rect.x : rect.x + rect.width,
    ]
    return output


def _progress(
    callback: ProgressCallback | None,
    stage: JobStage,
    completed: int,
    total: int,
) -> None:
    if callback is not None:
        callback(stage, completed, total)


def _elapsed_ms(started: float) -> int:
    return round((perf_counter() - started) * 1000)
