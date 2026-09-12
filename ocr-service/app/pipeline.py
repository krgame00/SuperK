from __future__ import annotations

import os
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from time import perf_counter
from typing import Protocol

import cv2
import numpy as np

from app.adaptive_scope import cluster_mask, decide_adaptive_scope, expanded_cluster
from app.cleaners.base import Cleaner
from app.compositor import compose
from app.detector import DetectionResult, RgbImage
from app.mask_refiner import (
    BinaryMask,
    MaskRegion,
    RefinedMask,
    constrained_dilate,
    refine_mask,
)
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
    timings_ms: dict[str, int | float | str]
    awaiting_review: bool = False


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
                timings_ms=_with_safety_metrics(
                    {
                    "detect": detect_ms,
                    "refine": refine_ms,
                    "clean": 0,
                    "verify": 0,
                    "clean_ms": 0,
                    "verification_ms": 0,
                    "adaptive_route": "none",
                    "roi_cluster_count": 0,
                    "lama_inference_count": 0,
                    "escalation_attempts": 0,
                    "total": _elapsed_ms(started),
                    },
                    image_rgb,
                    image_rgb,
                    eligible,
                    protection.protected_mask,
                    [],
                ),
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
            route = route_region(image_rgb, refined_region_mask, region, self.cleaners)
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
            if route.preferred_cleaner and route.preferred_cleaner in self.cleaners:
                cleaner = self.cleaners[route.preferred_cleaner]
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
                evidence_envelope=refined.envelope,
                protected_edges=refined.protected_edges,
            )
            verify_ms += _elapsed_ms(stage_started)
            if not report.accepted and report.retry_mask_radius is not None:
                stage_started = perf_counter()
                retry_mask = region_mask.copy()
                if report.residual_mask is not None and np.any(report.residual_mask > 0):
                    retry_mask = np.maximum(retry_mask, report.residual_mask)
                elif report.retry_mask_radius:
                    retry_mask = constrained_dilate(retry_mask, protection.protected_mask, 1)
                retry_mask[protection.protected_mask > 0] = 0
                if refined.envelope is not None:
                    retry_mask[refined.envelope == 0] = 0
                # Use LAMA Large for second pass if available (ensemble effect)
                fallback_cleaner = self.cleaners.get("lama-large") or cleaner
                retry_repaired = fallback_cleaner.clean(before, retry_mask, region)
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
                    evidence_envelope=refined.envelope,
                    protected_edges=refined.protected_edges,
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
            timings_ms=_with_safety_metrics(
                {
                "detect": detect_ms,
                "refine": refine_ms,
                "clean": clean_ms,
                "verify": verify_ms,
                "clean_ms": clean_ms,
                "verification_ms": verify_ms,
                "adaptive_route": "legacy-region",
                "roi_cluster_count": 0,
                "lama_inference_count": 0,
                "escalation_attempts": 0,
                "total": _elapsed_ms(started),
                },
                image_rgb,
                clean_image,
                eligible,
                protection.protected_mask,
                records,
            ),
            awaiting_review=_has_awaiting_review(records),
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

        # Global neural inpainting pass with full image context
        full_lama = self.cleaners.get("lama-large")
        # The optimized scope policy is release-gated. The previous experiment
        # measured slower than the legacy path, so stale opt-in flags must not
        # accidentally re-enable it in normal production runs.
        adaptive_roi_enabled = (
            os.getenv("SUPERK_DISABLE_ADAPTIVE_ROI") != "1"
            and os.getenv("SUPERK_ENABLE_ADAPTIVE_ROI_V2") == "1"
        )
        adaptive_scope = (
            decide_adaptive_scope(eligible, refined.regions)
            if adaptive_roi_enabled
            else None
        )
        scoped_clean = None
        lama_inference_count = 0
        escalation_attempts = 0
        quality_attempts = 1 if np.any(eligible) else 0
        adaptive_route = (
            adaptive_scope.mode
            if adaptive_scope is not None
            else ("legacy-full-page" if np.any(eligible) else "none")
        )
        if full_lama is not None and np.any(eligible):
            stage_started = perf_counter()
            if not adaptive_roi_enabled and hasattr(full_lama, "clean_full_image"):
                scoped_clean = full_lama.clean_full_image(image_rgb, eligible)
                lama_inference_count = 1
                adaptive_route = "legacy-full-page"
            elif adaptive_roi_enabled and adaptive_scope.mode == "roi":
                scoped_clean = image_rgb.copy()
                clean_roi = getattr(full_lama, "clean_roi", None)
                for cluster in adaptive_scope.clusters:
                    active = cluster_mask(eligible, cluster)
                    if not np.any(active):
                        continue
                    if callable(clean_roi):
                        scoped_clean = clean_roi(scoped_clean, active, cluster.rect)
                    else:
                        region = next(
                            item for item in refined.regions if item.id in cluster.region_ids
                        )
                        scoped_clean = full_lama.clean(scoped_clean, active, region)
                    lama_inference_count += 1
            elif adaptive_scope.mode != "none" and hasattr(full_lama, "clean_full_image"):
                scoped_clean = full_lama.clean_full_image(image_rgb, eligible)
                lama_inference_count = 1
            clean_ms += _elapsed_ms(stage_started)

        for index, region in enumerate(refined.regions):
            _progress(progress_callback, JobStage.CLEANING, index, total)
            refined_region_mask = _region_mask(refined.mask, region)
            region_mask = _region_mask(eligible, region)
            route = route_region(image_rgb, refined_region_mask, region, self.cleaners)
            eligibility = decisions[region.id]
            if (
                eligibility.action is AutomaticAction.PRESERVE
                or not np.any(region_mask)
            ):
                continue
            cleaner = self.cleaners.get(route.route.value)
            if route.preferred_cleaner and route.preferred_cleaner in self.cleaners:
                cleaner = self.cleaners[route.preferred_cleaner]
            if cleaner is None:
                raise RuntimeError(f"no cleaner configured for {route.route.value}")

            stage_started = perf_counter()
            if scoped_clean is not None:
                repaired = scoped_clean
            else:
                repaired = cleaner.clean(clean_image, region_mask, region)
            candidate, support = compose(clean_image, repaired, region_mask)
            _restore_protected(
                image_rgb,
                candidate,
                support,
                protection.protected_mask,
            )
            clean_ms += _elapsed_ms(stage_started)
            stage_started = perf_counter()
            damage = verify_damage(clean_image, candidate, support)
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
                and adaptive_roi_enabled
                and adaptive_scope.mode == "roi"
            ):
                retry_base = clean_image.copy()
                retry_base[item.support > 0] = image_rgb[item.support > 0]
                # Context may expand, but writes remain inside the original
                # authorized support. Residual evidence must never authorize
                # new text-removal pixels by itself.
                retry_mask = item.mask.copy()
                retry_mask[protection.protected_mask > 0] = 0
                if refined.envelope is not None:
                    retry_mask[refined.envelope == 0] = 0
                # Attempt 2 expands the selected cluster's context while
                # retaining the original authorized mask support.
                if quality_attempts >= 3:
                    clean_image[item.support > 0] = image_rgb[item.support > 0]
                    records.append(
                        _record(
                            item.region,
                            item.route,
                            item.confidence,
                            RegionStatus.NEEDS_REVIEW,
                            residual,
                            damage_score,
                            page,
                            item.eligibility,
                        ),
                    )
                    _progress(progress_callback, JobStage.VERIFYING, index + 1, total)
                    continue

                stage_started = perf_counter()
                fallback_cleaner = self.cleaners.get("lama-large") or item.cleaner
                escalation_attempts += 1
                quality_attempts += 1
                if fallback_cleaner is full_lama:
                    lama_inference_count += 1
                cluster = next(
                    (
                        candidate
                        for candidate in adaptive_scope.clusters
                        if item.region.id in candidate.region_ids
                    ),
                    None,
                )
                expanded = (
                    expanded_cluster(cluster, image_rgb.shape[1], image_rgb.shape[0])
                    if cluster is not None
                    else None
                )
                clean_roi = getattr(fallback_cleaner, "clean_roi", None)
                if expanded is not None and callable(clean_roi):
                    repaired = clean_roi(retry_base, retry_mask, expanded.rect)
                else:
                    repaired = fallback_cleaner.clean(
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
                    evidence_envelope=refined.envelope,
                    protected_edges=refined.protected_edges,
                )
                verify_ms += _elapsed_ms(stage_started)
                residual = report.residual_score
                damage_score = report.damage_score
                accepted = report.accepted
                if accepted:
                    clean_image = candidate
                else:
                    if (
                        quality_attempts < 3
                        and full_lama is not None
                        and hasattr(full_lama, "clean_full_image")
                    ):
                        # Third and final quality attempt uses full-image model context.
                        escalation_attempts += 1
                        quality_attempts += 1
                        lama_inference_count += 1
                        stage_started = perf_counter()
                        full_repaired = full_lama.clean_full_image(retry_base, retry_mask)
                        full_candidate, full_support = compose(
                            retry_base,
                            full_repaired,
                            retry_mask,
                        )
                        _restore_protected(
                            image_rgb,
                            full_candidate,
                            full_support,
                            protection.protected_mask,
                        )
                        clean_ms += _elapsed_ms(stage_started)
                        stage_started = perf_counter()
                        full_report = verify_region(
                            retry_base,
                            full_candidate,
                            retry_mask,
                            full_support,
                            item.region,
                            self.residual_probe,
                            evidence_envelope=refined.envelope,
                            protected_edges=refined.protected_edges,
                        )
                        verify_ms += _elapsed_ms(stage_started)
                        residual = full_report.residual_score
                        damage_score = full_report.damage_score
                        accepted = full_report.accepted
                        if accepted:
                            clean_image = full_candidate
                            restore = None
                        else:
                            restore = (item.support > 0) | (retry_support > 0) | (full_support > 0)
                    else:
                        restore = (item.support > 0) | (retry_support > 0)
                    if restore is not None:
                        clean_image[restore] = image_rgb[restore]
            elif not accepted and item.damage_accepted:
                clean_image[item.support > 0] = image_rgb[item.support > 0]

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
            route = route_region(image_rgb, refined_region_mask, region, self.cleaners)
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
            timings_ms=_with_safety_metrics(
                {
                "detect": detect_ms,
                "refine": refine_ms,
                "clean": clean_ms,
                "verify": verify_ms,
                "clean_ms": clean_ms,
                "verification_ms": verify_ms,
                "adaptive_route": adaptive_route,
                "adaptive_roi": 1 if adaptive_roi_enabled and adaptive_scope.mode == "roi" else 0,
                "roi_cluster_count": adaptive_scope.cluster_count if adaptive_scope is not None else 0,
                "lama_inference_count": lama_inference_count,
                "escalation_attempts": escalation_attempts,
                "total": _elapsed_ms(started),
                },
                image_rgb,
                clean_image,
                eligible,
                protection.protected_mask,
                records,
            ),
            awaiting_review=any(
                record.status is RegionStatus.NEEDS_REVIEW
                and record.automatic_action is AutomaticAction.CLEAN
                for record in records
            ),
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
                awaiting_review=_has_awaiting_review(updated_records),
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
                    awaiting_review=_has_awaiting_review(updated_records),
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
            awaiting_review=_has_awaiting_review(updated_records),
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


def _has_awaiting_review(records: list[RegionRecord]) -> bool:
    return any(record.status is RegionStatus.NEEDS_REVIEW for record in records)


def _peak_rss_mb() -> float | str:
    """Return best-effort process RSS for benchmark diagnostics.

    Linux exposes a true process high-water mark through ``resource``. The
    Windows desktop runtime does not ship that module, so use the native
    process counter as a clearly labelled current-RSS fallback rather than
    inventing a peak value.
    """
    try:
        import resource

        value = float(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
        if os.name == "nt":
            value /= 1024 * 1024
        else:
            value /= 1024
        return round(value, 2)
    except (ImportError, AttributeError, OSError):
        pass

    if os.name == "nt":
        try:
            import ctypes
            from ctypes import wintypes

            class _Counters(ctypes.Structure):
                _fields_ = [
                    ("cb", wintypes.DWORD),
                    ("page_fault_count", wintypes.DWORD),
                    ("peak_working_set_size", ctypes.c_size_t),
                    ("working_set_size", ctypes.c_size_t),
                    ("quota_peak_paged_pool_usage", ctypes.c_size_t),
                    ("quota_paged_pool_usage", ctypes.c_size_t),
                    ("quota_peak_non_paged_pool_usage", ctypes.c_size_t),
                    ("quota_non_paged_pool_usage", ctypes.c_size_t),
                    ("pagefile_usage", ctypes.c_size_t),
                    ("peak_pagefile_usage", ctypes.c_size_t),
                ]

            counters = _Counters()
            counters.cb = ctypes.sizeof(_Counters)
            if ctypes.windll.psapi.GetProcessMemoryInfo(
                ctypes.windll.kernel32.GetCurrentProcess(),
                ctypes.byref(counters),
                counters.cb,
            ):
                return round(counters.peak_working_set_size / (1024 * 1024), 2)
        except (AttributeError, OSError, TypeError):
            pass
    return "unavailable"


def _with_safety_metrics(
    timings: dict[str, int | float | str],
    source: RgbImage,
    clean: RgbImage,
    eligible: BinaryMask,
    protected: BinaryMask,
    records: list[RegionRecord],
) -> dict[str, int | float | str]:
    changed = np.any(source != clean, axis=2)
    authorized = eligible > 0
    protected_changed = np.any(source != clean, axis=2) & (protected > 0)
    automatic = [
        record
        for record in records
        if record.automatic_action is AutomaticAction.CLEAN
    ]
    residual_passes = [record for record in automatic if record.residual_score <= 0.18]
    repaired = [record for record in automatic if record.status is RegionStatus.REPAIRED]
    timings.update(
        {
            "changed_pixels_outside_support": int(np.count_nonzero(changed & ~authorized)),
            "protected_mask_changes": int(np.count_nonzero(protected_changed)),
            "no_mask_pixel_identity": int(
                not np.any(eligible) and np.array_equal(source, clean)
            ),
            "residual_pass_rate": round(
                len(residual_passes) / len(automatic), 4,
            ) if automatic else 1.0,
            "automatic_pass_rate": round(
                len(repaired) / len(automatic),
                4,
            ) if automatic else 1.0,
            "peak_rss_mb": _peak_rss_mb(),
        },
    )
    return timings


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
