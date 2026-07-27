from __future__ import annotations

from typing import Protocol

import cv2
import numpy as np

from app.detector import RgbImage
from app.mask_refiner import BinaryMask


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
