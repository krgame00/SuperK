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
from app.page_context import PageContext, classify_page
from app.protection import ProtectionResult, detect_protection
from app.region_router import route_region
from app.schemas import (
    AutomaticAction,
    CleanerRoute,
    JobStage,
    ManualRegionAction,
    RegionRecord,
    RegionStatus,
    TextRole,
)
from app.text_eligibility import EligibilityDecision, classify_eligibility
from app.verifier import ResidualProbe, verify_damage, verify_region


class Detector(Protocol):
    def detect(self, image_rgb: RgbImage) -> DetectionResult: ...


Refiner = Callable[[RgbImage, DetectionResult], RefinedMask]
PageClassifier = Callable[[RgbImage, list[MaskRegion]], PageContext]
ProtectionDetector = Callable[
    [RgbImage, PageContext, list[MaskRegion]],
    ProtectionResult,
]
EligibilityClassifier = Callable[
    [RgbImage, BinaryMask, MaskRegion, PageContext, ProtectionResult],
    EligibilityDecision,
]
ProgressCallback = Callable[[JobStage, int, int], None]


@dataclass(frozen=True)
class PipelineOutput:
    source_image: RgbImage
    clean_image: RgbImage
    mask: BinaryMask
    review_mask: BinaryMask
    protected_mask: BinaryMask
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
    eligibility: EligibilityDecision


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
        page_classifier: PageClassifier = classify_page,
        protection_detector: ProtectionDetector = detect_protection,
        eligibility_classifier: EligibilityClassifier = classify_eligibility,
    ) -> None:
        self.detector = detector
        self.refiner = refiner
        self.cleaners = {
            key.value if isinstance(key, CleanerRoute) else key: value
            for key, value in cleaners.items()
        }
        self.residual_probe = residual_probe or _ZeroResidualProbe()
        self.page_classifier = page_classifier
        self.protection_detector = protection_detector
        self.eligibility_classifier = eligibility_classifier

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
        page = self.page_classifier(image_rgb, refined.regions)
        protection = self.protection_detector(
            image_rgb,
            page,
            refined.regions,
        )
        eligible, review, decisions = self._build_eligibility(
            image_rgb,
            refined,
            page,
            protection,
        )
        if not refined.regions:
            return PipelineOutput(
                source_image=image_rgb.copy(),
                clean_image=image_rgb.copy(),
                mask=eligible,
                review_mask=review,
                protected_mask=protection.protected_mask.copy(),
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
                eligible,
                review,
                protection,
                page,
                decisions,
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
            refined_region_mask = _region_mask(refined.mask, region)
            region_mask = _region_mask(eligible, region)
            route = route_region(image_rgb, refined_region_mask, region)
            eligibility = decisions[region.id]
            if (
                eligibility.action is AutomaticAction.PRESERVE
                or not np.any(region_mask)
            ):
                records.append(
                    _record(
                        region,
                        route.route,
                        route.confidence,
                        RegionStatus.PRESERVED,
                        0,
                        0,
                        page,
                        eligibility,
                    ),
                )
                continue
            cleaner = self.cleaners.get(route.route.value)
            if cleaner is None:
                raise RuntimeError(f"no cleaner configured for {route.route.value}")

            before = clean_image.copy()
            stage_started = perf_counter()
            repaired = cleaner.clean(before, region_mask, region)
            candidate, support = compose(before, repaired, region_mask)
            _restore_protected(
                image_rgb,
                candidate,
                support,
                protection.protected_mask,
            )
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
                retry_mask[protection.protected_mask > 0] = 0
                retry_repaired = cleaner.clean(before, retry_mask, region)
                candidate, support = compose(before, retry_repaired, retry_mask)
                _restore_protected(
                    image_rgb,
                    candidate,
                    support,
                    protection.protected_mask,
                )
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
                _record(
                    region,
                    route.route,
                    route.confidence,
                    status,
                    report.residual_score,
                    report.damage_score,
                    page,
                    eligibility,
                ),
            )
        _progress(progress_callback, JobStage.COMPLETE, total, total)
        return PipelineOutput(
            source_image=image_rgb.copy(),
            clean_image=clean_image,
            mask=eligible,
            review_mask=review,
            protected_mask=protection.protected_mask.copy(),
            regions=records,
            timings_ms={
                "detect": detect_ms,
                "refine": refine_ms,
                "clean": clean_ms,
                "verify": verify_ms,
                "total": _elapsed_ms(started),
            },
        )

    def _build_eligibility(
        self,
        image_rgb: RgbImage,
        refined: RefinedMask,
        page: PageContext,
        protection: ProtectionResult,
    ) -> tuple[BinaryMask, BinaryMask, dict[str, EligibilityDecision]]:
        eligible = np.zeros_like(refined.mask)
        review = protection.review_mask.copy()
        decisions: dict[str, EligibilityDecision] = {}
        for region in refined.regions:
            region_mask = _region_mask(refined.mask, region)
            decision = self.eligibility_classifier(
                image_rgb,
                region_mask,
                region,
                page,
                protection,
            )
            decisions[region.id] = decision
            if decision.action is AutomaticAction.CLEAN:
                eligible = np.maximum(eligible, region_mask)
            elif decision.text_role is TextRole.REVIEW:
                review = np.maximum(review, region_mask)
        eligible[protection.protected_mask > 0] = 0
        return eligible, review, decisions

    def _run_batched(
        self,
        image_rgb: RgbImage,
        refined: RefinedMask,
        eligible: BinaryMask,
        review: BinaryMask,
        protection: ProtectionResult,
        page: PageContext,
        decisions: dict[str, EligibilityDecision],
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
            refined_region_mask = _region_mask(refined.mask, region)
            region_mask = _region_mask(eligible, region)
            route = route_region(image_rgb, refined_region_mask, region)
            eligibility = decisions[region.id]
            if (
                eligibility.action is AutomaticAction.PRESERVE
                or not np.any(region_mask)
            ):
                continue
            cleaner = self.cleaners.get(route.route.value)
            if cleaner is None:
                raise RuntimeError(f"no cleaner configured for {route.route.value}")

            before = clean_image.copy()
            stage_started = perf_counter()
            repaired = cleaner.clean(before, region_mask, region)
            candidate, support = compose(before, repaired, region_mask)
            _restore_protected(
                image_rgb,
                candidate,
                support,
                protection.protected_mask,
            )
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
                    route=route.route,
                    confidence=route.confidence,
                    cleaner=cleaner,
                    before=before,
                    support=support,
                    damage_score=damage.damage_score,
                    damage_accepted=damage.accepted,
                    eligibility=eligibility,
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
                retry_mask[protection.protected_mask > 0] = 0
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
                _restore_protected(
                    image_rgb,
                    candidate,
                    retry_support,
                    protection.protected_mask,
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
                _record(
                    item.region,
                    item.route,
                    item.confidence,
                    (
                        RegionStatus.REPAIRED
                        if accepted
                        else RegionStatus.NEEDS_REVIEW
                    ),
                    residual,
                    damage_score,
                    page,
                    item.eligibility,
                ),
            )
            _progress(progress_callback, JobStage.VERIFYING, index + 1, total)

        cleaned_ids = {item.region.id for item in items}
        for region in refined.regions:
            if region.id in cleaned_ids:
                continue
            refined_region_mask = _region_mask(refined.mask, region)
            route = route_region(image_rgb, refined_region_mask, region)
            records.append(
                _record(
                    region,
                    route.route,
                    route.confidence,
                    RegionStatus.PRESERVED,
                    0,
                    0,
                    page,
                    decisions[region.id],
                ),
            )
        record_order = {
            region.id: index for index, region in enumerate(refined.regions)
        }
        records.sort(key=lambda record: record_order[record.id])
        _progress(progress_callback, JobStage.COMPLETE, total, total)
        return PipelineOutput(
            source_image=image_rgb.copy(),
            clean_image=clean_image,
            mask=eligible,
            review_mask=review,
            protected_mask=protection.protected_mask.copy(),
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
        action: ManualRegionAction = ManualRegionAction.AUTOMATIC,
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
        if action is ManualRegionAction.PROTECT:
            clean_image = output.clean_image.copy()
            clean_image[binary_mask > 0] = output.source_image[binary_mask > 0]
            eligible = output.mask.copy()
            eligible[binary_mask > 0] = 0
            review = output.review_mask.copy()
            review[binary_mask > 0] = 0
            protected = np.maximum(output.protected_mask, binary_mask)
            updated_records = list(output.regions)
            updated_records[record_index] = record.model_copy(
                update={
                    "status": RegionStatus.PRESERVED,
                    "text_role": TextRole.PROTECTED,
                    "automatic_action": AutomaticAction.PRESERVE,
                },
            )
            return PipelineOutput(
                source_image=output.source_image,
                clean_image=clean_image,
                mask=eligible,
                review_mask=review,
                protected_mask=protected,
                regions=updated_records,
                timings_ms=dict(output.timings_ms),
            )

        if action is ManualRegionAction.AUTOMATIC:
            page = PageContext(
                role=record.page_role,
                confidence=record.eligibility_confidence,
                features=self.page_classifier(
                    output.source_image,
                    [region],
                ).features,
            )
            protection = ProtectionResult(
                output.protected_mask,
                output.review_mask,
                [],
            )
            eligibility = self.eligibility_classifier(
                output.source_image,
                binary_mask,
                region,
                page,
                protection,
            )
            if eligibility.action is AutomaticAction.PRESERVE:
                updated_records = list(output.regions)
                updated_records[record_index] = record.model_copy(
                    update={
                        "status": RegionStatus.PRESERVED,
                        "text_role": eligibility.text_role,
                        "eligibility_confidence": eligibility.confidence,
                        "automatic_action": eligibility.action,
                        "protection_reasons": eligibility.protection_reasons,
                    },
                )
                return PipelineOutput(
                    source_image=output.source_image,
                    clean_image=output.clean_image.copy(),
                    mask=output.mask.copy(),
                    review_mask=np.maximum(output.review_mask, binary_mask),
                    protected_mask=output.protected_mask.copy(),
                    regions=updated_records,
                    timings_ms=dict(output.timings_ms),
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
        candidate, support = compose(
            output.clean_image,
            repaired,
            binary_mask,
            feather_radius=(
                0 if action is ManualRegionAction.FORCE_CLEAN else 2
            ),
        )
        if action is ManualRegionAction.AUTOMATIC:
            _restore_protected(
                output.source_image,
                candidate,
                support,
                output.protected_mask,
            )
        report = verify_region(
            output.clean_image,
            candidate,
            binary_mask,
            support,
            region,
            self.residual_probe,
        )
        updated_records = list(output.regions)
        accepted = (
            report.accepted
            or action is ManualRegionAction.FORCE_CLEAN
        )
        accepted_image = (
            candidate if accepted else output.clean_image.copy()
        )
        updated_records[record_index] = record.model_copy(
            update={
                "status": (
                    RegionStatus.REPAIRED
                    if accepted
                    else RegionStatus.NEEDS_REVIEW
                ),
                "residual_score": report.residual_score,
                "damage_score": report.damage_score,
                "automatic_action": (
                    AutomaticAction.CLEAN
                    if accepted
                    else AutomaticAction.PRESERVE
                ),
                "text_role": (
                    record.text_role
                    if action is ManualRegionAction.AUTOMATIC
                    else TextRole.DIALOGUE
                ),
            },
        )
        timings = dict(output.timings_ms)
        timings["retry"] = _elapsed_ms(started)
        timings["total"] = timings.get("total", 0) + timings["retry"]
        eligible = np.maximum(output.mask, binary_mask)
        review = output.review_mask.copy()
        review[binary_mask > 0] = 0
        protected = output.protected_mask.copy()
        if action is ManualRegionAction.FORCE_CLEAN:
            protected[binary_mask > 0] = 0
        return PipelineOutput(
            source_image=output.source_image,
            clean_image=accepted_image,
            mask=eligible,
            review_mask=review,
            protected_mask=protected,
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


def protected_pixels_unchanged(
    source: RgbImage,
    candidate: RgbImage,
    protected_mask: BinaryMask,
) -> bool:
    support = protected_mask > 0
    return bool(np.array_equal(source[support], candidate[support]))


def _restore_protected(
    source: RgbImage,
    candidate: RgbImage,
    support: BinaryMask,
    protected_mask: BinaryMask,
) -> None:
    protected = protected_mask > 0
    candidate[protected] = source[protected]
    support[protected] = 0
    if not protected_pixels_unchanged(source, candidate, protected_mask):
        raise RuntimeError("protected pixels changed after restoration")


def _record(
    region: MaskRegion,
    route: CleanerRoute,
    route_confidence: float,
    status: RegionStatus,
    residual_score: float,
    damage_score: float,
    page: PageContext,
    eligibility: EligibilityDecision,
) -> RegionRecord:
    return RegionRecord(
        id=region.id,
        rect=region.rect,
        route=route,
        confidence=route_confidence,
        status=status,
        residual_score=residual_score,
        damage_score=damage_score,
        page_role=page.role,
        text_role=eligibility.text_role,
        eligibility_confidence=eligibility.confidence,
        automatic_action=eligibility.action,
        protection_reasons=eligibility.protection_reasons,
    )


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
