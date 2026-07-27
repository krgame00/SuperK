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
from app.verifier import ResidualProbe, verify_damage, verify_region


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


BatchScore = Callable[
    [RgbImage, list[tuple[MaskRegion, BinaryMask]]],
    dict[str, float],
]


@dataclass(frozen=True)
class _BatchItem:
    region: MaskRegion
    mask: BinaryMask
    route: CleanerRoute
    confidence: float
    cleaner: Cleaner
    before: RgbImage
    support: BinaryMask
    damage_score: float
    damage_accepted: bool


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

        score_many = getattr(self.residual_probe, "score_many", None)
        if callable(score_many):
            return self._run_batched(
                image_rgb,
                refined,
                detect_ms,
                refine_ms,
                started,
                progress_callback,
                score_many,
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

    def _run_batched(
        self,
        image_rgb: RgbImage,
        refined: RefinedMask,
        detect_ms: int,
        refine_ms: int,
        started: float,
        progress_callback: ProgressCallback | None,
        score_many: BatchScore,
    ) -> PipelineOutput:
        clean_image = image_rgb.copy()
        clean_ms = 0
        verify_ms = 0
        items: list[_BatchItem] = []
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
            damage = verify_damage(before, candidate, support)
            verify_ms += _elapsed_ms(stage_started)
            if damage.accepted:
                clean_image = candidate
            items.append(
                _BatchItem(
                    region=region,
                    mask=region_mask,
                    route=decision.route,
                    confidence=decision.confidence,
                    cleaner=cleaner,
                    before=before,
                    support=support,
                    damage_score=damage.damage_score,
                    damage_accepted=damage.accepted,
                ),
            )

        _progress(progress_callback, JobStage.VERIFYING, 0, total)
        stage_started = perf_counter()
        score_items = [
            (item.region, item.mask)
            for item in items
            if item.damage_accepted
        ]
        residual_scores = score_many(clean_image, score_items)
        verify_ms += _elapsed_ms(stage_started)

        records: list[RegionRecord] = []
        for index, item in enumerate(items):
            residual = residual_scores.get(item.region.id, 0.0)
            damage_score = item.damage_score
            accepted = item.damage_accepted and residual <= 0.18
            if (
                item.damage_accepted
                and residual > 0.18
                and damage_score <= 0.02
            ):
                retry_base = clean_image.copy()
                retry_base[item.support > 0] = item.before[item.support > 0]
                retry_mask = cv2.dilate(
                    item.mask,
                    cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)),
                )
                stage_started = perf_counter()
                repaired = item.cleaner.clean(
                    retry_base,
                    retry_mask,
                    item.region,
                )
                candidate, retry_support = compose(
                    retry_base,
                    repaired,
                    retry_mask,
                )
                clean_ms += _elapsed_ms(stage_started)
                stage_started = perf_counter()
                report = verify_region(
                    retry_base,
                    candidate,
                    retry_mask,
                    retry_support,
                    item.region,
                    self.residual_probe,
                )
                verify_ms += _elapsed_ms(stage_started)
                residual = report.residual_score
                damage_score = report.damage_score
                accepted = report.accepted
                if accepted:
                    clean_image = candidate
                else:
                    restore = (item.support > 0) | (retry_support > 0)
                    clean_image[restore] = item.before[restore]
            elif not accepted and item.damage_accepted:
                clean_image[item.support > 0] = item.before[item.support > 0]

            records.append(
                RegionRecord(
                    id=item.region.id,
                    rect=item.region.rect,
                    route=item.route,
                    confidence=item.confidence,
                    status=(
                        RegionStatus.REPAIRED
                        if accepted
                        else RegionStatus.NEEDS_REVIEW
                    ),
                    residual_score=residual,
                    damage_score=damage_score,
                ),
            )
            _progress(progress_callback, JobStage.VERIFYING, index + 1, total)

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

    def retry_region(
        self,
        output: PipelineOutput,
        region_id: str,
        mask: BinaryMask,
        cleaner: str,
    ) -> PipelineOutput:
        if mask.shape != output.mask.shape:
            raise ValueError("retry mask dimensions must match the image")
        try:
            record_index, record = next(
                (index, item)
                for index, item in enumerate(output.regions)
                if item.id == region_id
            )
        except StopIteration as error:
            raise ValueError(f"unknown region: {region_id}") from error

        binary_mask = np.where(mask > 0, 255, 0).astype(np.uint8)
        points = cv2.findNonZero(binary_mask)
        if points is None:
            raise ValueError("retry mask is empty")
        x, y, width, height = cv2.boundingRect(points)
        region = MaskRegion(
            id=region_id,
            rect=record.rect.model_copy(
                update={"x": x, "y": y, "width": width, "height": height},
            ),
            component_ids=(),
            stroke_radius=2,
        )
        cleaner_key = {
            "auto": record.route.value,
            "flat": CleanerRoute.FLAT.value,
            "opencv": CleanerRoute.GRADIENT.value,
            "aot": "aot",
            "anime-lama": "anime-lama",
        }.get(cleaner)
        selected = self.cleaners.get(cleaner_key or "")
        if selected is None:
            raise RuntimeError(f"cleaner is unavailable: {cleaner}")

        started = perf_counter()
        repaired = selected.clean(output.clean_image, binary_mask, region)
        candidate, support = compose(output.clean_image, repaired, binary_mask)
        report = verify_region(
            output.clean_image,
            candidate,
            binary_mask,
            support,
            region,
            self.residual_probe,
        )
        updated_records = list(output.regions)
        updated_records[record_index] = record.model_copy(
            update={
                "status": (
                    RegionStatus.REPAIRED
                    if report.accepted
                    else RegionStatus.NEEDS_REVIEW
                ),
                "residual_score": report.residual_score,
                "damage_score": report.damage_score,
            },
        )
        timings = dict(output.timings_ms)
        timings["retry"] = _elapsed_ms(started)
        timings["total"] = timings.get("total", 0) + timings["retry"]
        return PipelineOutput(
            clean_image=candidate,
            mask=np.maximum(output.mask, binary_mask),
            regions=updated_records,
            timings_ms=timings,
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
