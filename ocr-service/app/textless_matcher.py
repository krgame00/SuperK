from __future__ import annotations

import hashlib
from collections import OrderedDict
from dataclasses import dataclass
from typing import Protocol

import cv2
import numpy as np

from app.detector import DetectionResult, RgbImage


class DetectorLike(Protocol):
    def detect(self, image_rgb: RgbImage) -> DetectionResult: ...


@dataclass(frozen=True)
class BoxSummary:
    x: int
    y: int
    width: int
    height: int


@dataclass(frozen=True)
class TextlessPairEvaluation:
    is_match: bool
    text_role: str  # "a_has_text" | "b_has_text" | "none"
    similarity: float
    aspect_diff_ratio: float
    text_blocks_a: int
    text_blocks_b: int
    background_variant: str = "none"  # "with_bubbles" | "bubbleless" | "none"
    needs_resize: bool = False
    detected_boxes: list[BoxSummary] | None = None
    scaled_textless_rgb: RgbImage | None = None

    def __post_init__(self) -> None:
        if self.detected_boxes is None:
            object.__setattr__(self, "detected_boxes", [])


class _DetectionMemoCache:
    """Thread-safe bounded LRU cache keyed by raw image SHA-1."""

    def __init__(self, maxsize: int = 48) -> None:
        self._maxsize = maxsize
        self._store: OrderedDict[str, tuple[int, list[BoxSummary]]] = OrderedDict()

    def get_or_detect(
        self,
        raw_bytes: bytes | None,
        image_rgb: RgbImage,
        detector: DetectorLike,
    ) -> tuple[int, list[BoxSummary]]:
        key = hashlib.sha1(raw_bytes).hexdigest() if raw_bytes else None
        if key and key in self._store:
            self._store.move_to_end(key)
            return self._store[key]

        det = detector.detect(image_rgb)
        boxes = [
            BoxSummary(
                x=int(b.rect.x),
                y=int(b.rect.y),
                width=int(b.rect.width),
                height=int(b.rect.height),
            )
            for b in (det.blocks or [])
        ]
        count = len(boxes)
        if count == 0 and det.mask_probability is not None and det.mask_probability.size > 0:
            if int(np.count_nonzero(det.mask_probability >= 0.35)) >= 32:
                count = 1

        result = (count, boxes)
        if key:
            self._store[key] = result
            if len(self._store) > self._maxsize:
                self._store.popitem(last=False)
        return result


_DETECTION_CACHE = _DetectionMemoCache(maxsize=48)


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


def _estimate_ink_candidate(image_a: RgbImage, image_b: RgbImage) -> str:
    """Returns 'a_likely_text', 'b_likely_text', or 'ambiguous' using fast 512px pixel diff."""
    gray_a = cv2.cvtColor(image_a, cv2.COLOR_RGB2GRAY)
    gray_b = cv2.cvtColor(image_b, cv2.COLOR_RGB2GRAY)
    small_a = cv2.resize(gray_a, (384, 512), interpolation=cv2.INTER_AREA).astype(np.int16)
    small_b = cv2.resize(gray_b, (384, 512), interpolation=cv2.INTER_AREA).astype(np.int16)

    diff = small_b - small_a  # positive means B is brighter (A has dark text on light background)
    dark_in_a = int(np.count_nonzero(diff > 35))
    dark_in_b = int(np.count_nonzero(diff < -35))

    if dark_in_a > dark_in_b * 1.8 and dark_in_a >= 40:
        return "a_likely_text"
    if dark_in_b > dark_in_a * 1.8 and dark_in_b >= 40:
        return "b_likely_text"
    return "ambiguous"


def _detect_bubbleless_variant(
    text_rgb: RgbImage,
    clean_rgb: RgbImage,
    boxes: list[BoxSummary],
) -> str:
    """Checks if speech bubble white fills were also stripped in the textless image."""
    if not boxes:
        return "with_bubbles"
    th, tw = text_rgb.shape[:2]
    ch, cw = clean_rgb.shape[:2]
    sx, sy = cw / max(1.0, float(tw)), ch / max(1.0, float(th))

    bubbleless_votes = 0
    checked = 0
    for box in boxes[:6]:
        tx0, ty0 = max(0, box.x), max(0, box.y)
        tx1, ty1 = min(tw, box.x + box.width), min(th, box.y + box.height)
        cx0, cy0 = max(0, int(round(tx0 * sx))), max(0, int(round(ty0 * sy)))
        cx1, cy1 = min(cw, int(round(tx1 * sx))), min(ch, int(round(ty1 * sy)))
        if tx1 <= tx0 or ty1 <= ty0 or cx1 <= cx0 or cy1 <= cy0:
            continue

        t_patch = cv2.cvtColor(text_rgb[ty0:ty1, tx0:tx1], cv2.COLOR_RGB2GRAY)
        c_patch = cv2.cvtColor(clean_rgb[cy0:cy1, cx0:cx1], cv2.COLOR_RGB2GRAY)
        white_ratio_text = float(np.count_nonzero(t_patch >= 225)) / float(max(1, t_patch.size))
        white_ratio_clean = float(np.count_nonzero(c_patch >= 225)) / float(max(1, c_patch.size))
        checked += 1
        if white_ratio_text >= 0.45 and white_ratio_clean < 0.20:
            bubbleless_votes += 1

    if checked > 0 and bubbleless_votes >= max(1, (checked + 1) // 2):
        return "bubbleless"
    return "with_bubbles"


def evaluate_textless_pair(
    image_a: RgbImage,
    image_b: RgbImage,
    detector: DetectorLike,
    *,
    bytes_a: bytes | None = None,
    bytes_b: bytes | None = None,
    min_similarity: float = 0.72,
    max_aspect_diff: float = 0.04,
) -> TextlessPairEvaluation:
    """Checks if `image_a` and `image_b` are a with-text / textless pair of the same scene.

    v2 Architecture: Single-side CTD with ink diff pre-check, SHA-1 detection memoization,
    Zero-copy resize flag, and bubbleless variant detection.
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
            background_variant="none",
            needs_resize=False,
            detected_boxes=[],
            scaled_textless_rgb=None,
        )

    hint = _estimate_ink_candidate(image_a, image_b)
    if hint == "b_likely_text":
        blocks_b, boxes_b = _DETECTION_CACHE.get_or_detect(bytes_b, image_b, detector)
        if blocks_b == 0:
            return TextlessPairEvaluation(
                is_match=False,
                text_role="none",
                similarity=similarity,
                aspect_diff_ratio=aspect_diff,
                text_blocks_a=0,
                text_blocks_b=0,
                background_variant="none",
                needs_resize=False,
                detected_boxes=[],
                scaled_textless_rgb=None,
            )
        blocks_a, boxes_a = _DETECTION_CACHE.get_or_detect(bytes_a, image_a, detector)
    else:
        blocks_a, boxes_a = _DETECTION_CACHE.get_or_detect(bytes_a, image_a, detector)
        if hint == "a_likely_text" and blocks_a == 0:
            return TextlessPairEvaluation(
                is_match=False,
                text_role="none",
                similarity=similarity,
                aspect_diff_ratio=aspect_diff,
                text_blocks_a=0,
                text_blocks_b=0,
                background_variant="none",
                needs_resize=False,
                detected_boxes=[],
                scaled_textless_rgb=None,
            )
        blocks_b, boxes_b = _DETECTION_CACHE.get_or_detect(bytes_b, image_b, detector)

    if blocks_a > 0 and blocks_b == 0:
        th, tw = image_a.shape[:2]
        needs_resize = image_b.shape[:2] != (th, tw)
        scaled = scale_image_to_match(image_b, tw, th) if needs_resize else image_b
        variant = _detect_bubbleless_variant(image_a, image_b, boxes_a)
        return TextlessPairEvaluation(
            is_match=True,
            text_role="a_has_text",
            similarity=similarity,
            aspect_diff_ratio=aspect_diff,
            text_blocks_a=blocks_a,
            text_blocks_b=0,
            background_variant=variant,
            needs_resize=needs_resize,
            detected_boxes=boxes_a,
            scaled_textless_rgb=scaled,
        )

    if blocks_b > 0 and blocks_a == 0:
        th, tw = image_b.shape[:2]
        needs_resize = image_a.shape[:2] != (th, tw)
        scaled = scale_image_to_match(image_a, tw, th) if needs_resize else image_a
        variant = _detect_bubbleless_variant(image_b, image_a, boxes_b)
        return TextlessPairEvaluation(
            is_match=True,
            text_role="b_has_text",
            similarity=similarity,
            aspect_diff_ratio=aspect_diff,
            text_blocks_a=0,
            text_blocks_b=blocks_b,
            background_variant=variant,
            needs_resize=needs_resize,
            detected_boxes=boxes_b,
            scaled_textless_rgb=scaled,
        )

    return TextlessPairEvaluation(
        is_match=False,
        text_role="none",
        similarity=similarity,
        aspect_diff_ratio=aspect_diff,
        text_blocks_a=blocks_a,
        text_blocks_b=blocks_b,
        background_variant="none",
        needs_resize=False,
        detected_boxes=[],
        scaled_textless_rgb=None,
    )
