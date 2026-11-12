from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import cv2
import numpy as np

from app.detector import DetectionResult, RgbImage


class DetectorLike(Protocol):
    def detect(self, image_rgb: RgbImage) -> DetectionResult: ...


@dataclass(frozen=True)
class TextlessPairEvaluation:
    is_match: bool
    text_role: str  # "a_has_text" | "b_has_text" | "none"
    similarity: float
    aspect_diff_ratio: float
    text_blocks_a: int
    text_blocks_b: int
    scaled_textless_rgb: RgbImage | None = None


def compute_visual_similarity(image_a: RgbImage, image_b: RgbImage) -> tuple[float, float]:
    """Computes (structural_similarity_0_to_1, aspect_diff_ratio) between two RGB images.

    Uses 64x64 normalized grayscale correlation so minor text/bubble differences
    still yield high similarity while distinct manga pages score low.
    """
    ha, wa = image_a.shape[:2]
    hb, wb = image_b.shape[:2]
    if ha <= 0 or wa <= 0 or hb <= 0 or wb <= 0:
        return 0.0, 1.0

    aspect_a = wa / float(ha)
    aspect_b = wb / float(hb)
    aspect_diff = abs(aspect_a - aspect_b) / max(aspect_a, 1e-6)

    gray_a = cv2.cvtColor(image_a, cv2.COLOR_RGB2GRAY)
    gray_b = cv2.cvtColor(image_b, cv2.COLOR_RGB2GRAY)
    small_a = cv2.resize(gray_a, (64, 64), interpolation=cv2.INTER_AREA).astype(np.float32)
    small_b = cv2.resize(gray_b, (64, 64), interpolation=cv2.INTER_AREA).astype(np.float32)

    mad = float(np.mean(np.abs(small_a - small_b))) / 255.0
    mad_sim = max(0.0, 1.0 - mad * 2.0)

    std_a = float(np.std(small_a))
    std_b = float(np.std(small_b))
    if std_a > 1e-3 and std_b > 1e-3:
        norm_a = (small_a - float(np.mean(small_a))) / std_a
        norm_b = (small_b - float(np.mean(small_b))) / std_b
        ncc = float(np.mean(norm_a * norm_b))
        ncc_sim = max(0.0, min(1.0, (ncc + 1.0) * 0.5))
        similarity = 0.5 * mad_sim + 0.5 * ncc_sim
    else:
        similarity = mad_sim

    return similarity, aspect_diff


def scale_image_to_match(source_rgb: RgbImage, target_width: int, target_height: int) -> RgbImage:
    """Scales `source_rgb` to exact `(target_width, target_height)` using quality resampling."""
    sh, sw = source_rgb.shape[:2]
    if sw == target_width and sh == target_height:
        return source_rgb
    interp = cv2.INTER_AREA if (target_width < sw or target_height < sh) else cv2.INTER_LANCZOS4
    return cv2.resize(source_rgb, (target_width, target_height), interpolation=interp)


def _count_text_blocks(detection: DetectionResult) -> int:
    if detection.blocks:
        return len(detection.blocks)
    if detection.mask_probability is not None and detection.mask_probability.size > 0:
        active = int(np.count_nonzero(detection.mask_probability >= 0.35))
        if active >= 32:
            return 1
    return 0


def evaluate_textless_pair(
    image_a: RgbImage,
    image_b: RgbImage,
    detector: DetectorLike,
    *,
    min_similarity: float = 0.72,
    max_aspect_diff: float = 0.04,
) -> TextlessPairEvaluation:
    """Checks if `image_a` and `image_b` are a with-text / textless pair of the same scene.

    If matched, scales the textless image to the exact dimensions of the with-text image.
    """
    similarity, aspect_diff = compute_visual_similarity(image_a, image_b)
    if aspect_diff > max_aspect_diff or similarity < min_similarity:
        return TextlessPairEvaluation(
            is_match=False,
            text_role="none",
            similarity=similarity,
            aspect_diff_ratio=aspect_diff,
            text_blocks_a=-1,
            text_blocks_b=-1,
            scaled_textless_rgb=None,
        )

    det_a = detector.detect(image_a)
    det_b = detector.detect(image_b)
    blocks_a = _count_text_blocks(det_a)
    blocks_b = _count_text_blocks(det_b)

    if blocks_a > 0 and blocks_b == 0:
        th, tw = image_a.shape[:2]
        scaled = scale_image_to_match(image_b, tw, th)
        return TextlessPairEvaluation(
            is_match=True,
            text_role="a_has_text",
            similarity=similarity,
            aspect_diff_ratio=aspect_diff,
            text_blocks_a=blocks_a,
            text_blocks_b=blocks_b,
            scaled_textless_rgb=scaled,
        )

    if blocks_b > 0 and blocks_a == 0:
        th, tw = image_b.shape[:2]
        scaled = scale_image_to_match(image_a, tw, th)
        return TextlessPairEvaluation(
            is_match=True,
            text_role="b_has_text",
            similarity=similarity,
            aspect_diff_ratio=aspect_diff,
            text_blocks_a=blocks_a,
            text_blocks_b=blocks_b,
            scaled_textless_rgb=scaled,
        )

    return TextlessPairEvaluation(
        is_match=False,
        text_role="none",
        similarity=similarity,
        aspect_diff_ratio=aspect_diff,
        text_blocks_a=blocks_a,
        text_blocks_b=blocks_b,
        scaled_textless_rgb=None,
    )
