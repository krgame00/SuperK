from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

import cv2
import numpy as np

from app.detector import RgbImage
from app.mask_refiner import BinaryMask, MaskRegion


@dataclass(frozen=True)
class ProbeReport:
    residual_score: float
    residual_mask: BinaryMask


class Detector(Protocol):
    def detect(self, image_rgb: RgbImage): ...


class OcrProbe(Protocol):
    def score(self, image_rgb: RgbImage) -> float: ...


class CompositeResidualProbe:
    def __init__(self, detector: Detector) -> None:
        self.detector = detector

    def score(
        self,
        cleaned_crop: RgbImage,
        source_mask: BinaryMask,
        ocr_probe: OcrProbe | None = None,
    ) -> float:
        support = source_mask > 0
        if not np.any(support):
            return 0.0
        probability = self.detector.detect(cleaned_crop).mask_probability
        return _score_probability(probability, support, cleaned_crop, ocr_probe)

    def score_envelope(
        self,
        cleaned_crop: RgbImage,
        source_mask: BinaryMask,
        evidence_envelope: BinaryMask,
        protected_edges: BinaryMask,
        ocr_probe: OcrProbe | None = None,
    ) -> ProbeReport:
        h, w = cleaned_crop.shape[:2]
        env = (
            evidence_envelope
            if evidence_envelope.shape == (h, w)
            else cv2.resize(evidence_envelope, (w, h), interpolation=cv2.INTER_NEAREST)
        )
        prot = (
            protected_edges
            if protected_edges.shape == (h, w)
            else cv2.resize(protected_edges, (w, h), interpolation=cv2.INTER_NEAREST)
        )
        src_m = (
            source_mask
            if source_mask.shape == (h, w)
            else cv2.resize(source_mask, (w, h), interpolation=cv2.INTER_NEAREST)
        )

        detection = self.detector.detect(cleaned_crop)
        probability = detection.mask_probability

        valid_zone = (env > 0) & (prot == 0)
        high_prob = (probability >= 0.35) & valid_zone
        support = (src_m > 0) | high_prob

        if not np.any(support):
            return ProbeReport(0.0, np.zeros_like(source_mask))

        ctd_score = float(np.mean(probability[support]))
        binary = ((probability >= 0.40) & valid_zone).astype(np.uint8)
        num_cc, labels, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)

        stroke_components = sum(
            1 for c in range(1, num_cc) if int(stats[c, cv2.CC_STAT_AREA]) >= 3
        )
        expected_components = max(1.0, float(np.count_nonzero(support)) / 64)
        stroke_score = min(1.0, stroke_components / expected_components)

        base_score = 0.75 * ctd_score + 0.25 * stroke_score
        if ocr_probe is None:
            residual_score = float(np.clip(base_score, 0, 1))
        else:
            ocr_score = float(np.clip(ocr_probe.score(cleaned_crop), 0, 1))
            residual_score = float(np.clip(0.75 * base_score + 0.25 * ocr_score, 0, 1))

        res_mask = np.zeros_like(source_mask, dtype=np.uint8)
        if residual_score > 0.18:
            for c in range(1, num_cc):
                if int(stats[c, cv2.CC_STAT_AREA]) >= 3:
                    comp = (labels == c).astype(np.uint8) * 255
                    if not np.any((comp > 0) & (prot > 0)):
                        res_mask = np.maximum(res_mask, comp)
            res_mask[prot > 0] = 0
            res_mask[env == 0] = 0

        return ProbeReport(residual_score=residual_score, residual_mask=res_mask)

    def score_many(
        self,
        cleaned_image: RgbImage,
        items: Sequence[tuple[MaskRegion, BinaryMask]],
    ) -> dict[str, float]:
        probability = self.detector.detect(cleaned_image).mask_probability
        scores: dict[str, float] = {}
        for region, source_mask in items:
            rect = region.rect
            support = (
                source_mask[
                    rect.y : rect.y + rect.height,
                    rect.x : rect.x + rect.width,
                ]
                > 0
            )
            crop_probability = probability[
                rect.y : rect.y + rect.height,
                rect.x : rect.x + rect.width,
            ]
            crop = cleaned_image[
                rect.y : rect.y + rect.height,
                rect.x : rect.x + rect.width,
            ]
            scores[region.id] = _score_probability(
                crop_probability,
                support,
                crop,
                None,
            )
        return scores


def _score_probability(
    probability: np.ndarray,
    support: np.ndarray,
    cleaned_crop: RgbImage,
    ocr_probe: OcrProbe | None,
) -> float:
    ctd_score = float(np.mean(probability[support]))
    binary = ((probability >= 0.45) & support).astype(np.uint8)
    component_count, _, stats, _ = cv2.connectedComponentsWithStats(
        binary,
        connectivity=8,
    )
    stroke_components = sum(
        1
        for component_id in range(1, component_count)
        if int(stats[component_id, cv2.CC_STAT_AREA]) >= 3
    )
    expected_components = max(1.0, float(np.count_nonzero(support)) / 64)
    stroke_score = min(1.0, stroke_components / expected_components)
    base_score = 0.75 * ctd_score + 0.25 * stroke_score
    if ocr_probe is None:
        return float(np.clip(base_score, 0, 1))
    ocr_score = float(np.clip(ocr_probe.score(cleaned_crop), 0, 1))
    return float(np.clip(0.75 * base_score + 0.25 * ocr_score, 0, 1))
