from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Protocol, Self, cast

import cv2
import numpy as np
from numpy.typing import NDArray

from app.model_store import ModelStore
from app.ort_utils import create_inference_session
from app.schemas import EvidenceSource, PixelRect, TextEvidenceRegion

LOGGER = logging.getLogger(__name__)

FloatMask = NDArray[np.float32]
RgbImage = NDArray[np.uint8]
BinaryMask = NDArray[np.uint8]
MAX_CLASS_OFFSET = 4096


@dataclass(frozen=True)
class LetterboxTransform:
    source_width: int
    source_height: int
    input_size: int
    scale: float
    pad_x: int
    pad_y: int


@dataclass(frozen=True)
class DetectedBlock:
    rect: PixelRect
    confidence: float


@dataclass(frozen=True)
class DetectionResult:
    mask_probability: FloatMask
    blocks: list[DetectedBlock]
    scale: LetterboxTransform
    evidence_regions: list[TextEvidenceRegion] = field(default_factory=list)



class _SessionInput(Protocol):
    name: str


class _Session(Protocol):
    def get_inputs(self) -> Sequence[_SessionInput]: ...

    def run(
        self,
        output_names: None,
        input_feed: dict[str, NDArray[np.float32]],
    ) -> Sequence[np.ndarray]: ...


class TextDetector:
    def __init__(self, model_store: ModelStore, input_size: int = 1024) -> None:
        session = create_inference_session(model_store.ensure("ctd-onnx"))
        self._set_session(cast("_Session", session), input_size)

    @classmethod
    def from_session(cls, session: _Session, input_size: int = 1024) -> Self:
        detector = cls.__new__(cls)
        detector._set_session(session, input_size)
        return detector

    def _set_session(self, session: _Session, input_size: int) -> None:
        self.session = session
        self.input_size = input_size
        self.input_name = session.get_inputs()[0].name

    def detect(self, image_rgb: RgbImage) -> DetectionResult:
        if image_rgb.ndim != 3 or image_rgb.shape[2] != 3:
            raise ValueError(f"expected HxWx3 RGB image, got {image_rgb.shape}")
        tensor, transform = prepare_input(image_rgb, self.input_size)
        raw_boxes, raw_mask = self.session.run(
            None,
            {self.input_name: tensor},
        )
        model_mask = np.asarray(raw_mask, dtype=np.float32).squeeze()
        if model_mask.ndim != 2:
            raise ValueError(f"expected 2D CTD mask, got {model_mask.shape}")
        probability = restore_mask(model_mask, transform)
        detections = non_max_suppression(
            np.asarray(raw_boxes, dtype=np.float32),
        )[0]
        blocks = decode_yolo_blocks(detections, transform)
        evidence_regions = [
            TextEvidenceRegion(
                id=f"ctd-{i}",
                rect=b.rect,
                polygon=None,
                source=EvidenceSource.CTD,
                confidence=b.confidence,
            )
            for i, b in enumerate(blocks)
        ]
        return DetectionResult(
            mask_probability=probability,
            blocks=blocks,
            scale=transform,
            evidence_regions=evidence_regions,
        )


def prepare_input(
    image_rgb: RgbImage,
    input_size: int = 1024,
) -> tuple[NDArray[np.float32], LetterboxTransform]:
    source_height, source_width = image_rgb.shape[:2]
    scale = min(input_size / source_width, input_size / source_height)
    resized_width = round(source_width * scale)
    resized_height = round(source_height * scale)
    pad_x = 0
    pad_y = 0

    resized = cv2.resize(
        image_rgb,
        (resized_width, resized_height),
        interpolation=cv2.INTER_LINEAR,
    )
    canvas = np.zeros((input_size, input_size, 3), dtype=np.uint8)
    canvas[pad_y : pad_y + resized_height, pad_x : pad_x + resized_width] = resized
    tensor = canvas[..., ::-1].astype(np.float32) / 255.0
    tensor = np.transpose(tensor, (2, 0, 1))[None, ...]
    transform = LetterboxTransform(
        source_width=source_width,
        source_height=source_height,
        input_size=input_size,
        scale=scale,
        pad_x=pad_x,
        pad_y=pad_y,
    )
    return tensor, transform


def restore_mask(
    model_mask: FloatMask,
    transform: LetterboxTransform,
) -> FloatMask:
    resized_width = round(transform.source_width * transform.scale)
    resized_height = round(transform.source_height * transform.scale)
    cropped = model_mask[
        transform.pad_y : transform.pad_y + resized_height,
        transform.pad_x : transform.pad_x + resized_width,
    ]
    restored = cv2.resize(
        cropped,
        (transform.source_width, transform.source_height),
        interpolation=cv2.INTER_LINEAR,
    )
    return restored.astype(np.float32, copy=False)


# SPDX-License-Identifier: GPL-3.0-only
# NumPy port based on lemon-manga-translator 0.0.17 and its vendored
# manga-image-translator CTD postprocessing.
def non_max_suppression(
    prediction: NDArray[np.float32],
    confidence_threshold: float = 0.35,
    iou_threshold: float = 0.4,
    max_detections: int = 300,
) -> list[NDArray[np.float32]]:
    if prediction.ndim != 3 or prediction.shape[2] < 6:
        raise ValueError(
            f"expected (batch, boxes, 5 + classes), got {prediction.shape}",
        )

    output: list[NDArray[np.float32]] = []
    for batch in prediction:
        candidates = batch[batch[:, 4] > confidence_threshold].copy()
        if candidates.size == 0:
            output.append(np.zeros((0, 6), dtype=np.float32))
            continue

        candidates[:, 5:] *= candidates[:, 4:5]
        class_ids = candidates[:, 5:].argmax(axis=1)
        confidences = candidates[
            np.arange(candidates.shape[0]),
            class_ids + 5,
        ]
        keep = confidences > confidence_threshold
        boxes = _xywh_to_xyxy(candidates[keep, :4])
        confidences = confidences[keep]
        class_ids = class_ids[keep].astype(np.float32)
        class_boxes = boxes + class_ids[:, None] * MAX_CLASS_OFFSET
        indices = _greedy_nms(class_boxes, confidences, iou_threshold)
        indices = indices[:max_detections]
        output.append(
            np.column_stack(
                (boxes[indices], confidences[indices], class_ids[indices]),
            ).astype(np.float32),
        )
    return output


def _xywh_to_xyxy(xywh: NDArray[np.float32]) -> NDArray[np.float32]:
    x, y, w, h = xywh.T
    x1 = x - w / 2
    y1 = y - h / 2
    x2 = x + w / 2
    y2 = y + h / 2
    return np.column_stack((x1, y1, x2, y2))


def _greedy_nms(
    boxes: NDArray[np.float32],
    scores: NDArray[np.float32],
    iou_threshold: float,
) -> NDArray[np.intp]:
    if boxes.size == 0:
        return np.array([], dtype=np.intp)
    x1 = boxes[:, 0]
    y1 = boxes[:, 1]
    x2 = boxes[:, 2]
    y2 = boxes[:, 3]
    areas = (x2 - x1) * (y2 - y1)
    order = scores.argsort()[::-1]
    keep = []
    while order.size > 0:
        i = order[0]
        keep.append(i)
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        w = np.maximum(0.0, xx2 - xx1)
        h = np.maximum(0.0, yy2 - yy1)
        inter = w * h
        iou = inter / (areas[i] + areas[order[1:]] - inter)
        order = order[1:][iou <= iou_threshold]
    return np.array(keep, dtype=np.intp)


def decode_yolo_blocks(
    detections: NDArray[np.float32],
    transform: LetterboxTransform,
) -> list[DetectedBlock]:
    blocks: list[DetectedBlock] = []
    for row in detections:
        x1 = round((float(row[0]) - transform.pad_x) / transform.scale)
        y1 = round((float(row[1]) - transform.pad_y) / transform.scale)
        x2 = round((float(row[2]) - transform.pad_x) / transform.scale)
        y2 = round((float(row[3]) - transform.pad_y) / transform.scale)
        x1 = min(max(x1, 0), transform.source_width)
        y1 = min(max(y1, 0), transform.source_height)
        x2 = min(max(x2, 0), transform.source_width)
        y2 = min(max(y2, 0), transform.source_height)
        if x2 <= x1 or y2 <= y1:
            continue
        block = DetectedBlock(
            rect=PixelRect(x=x1, y=y1, width=x2 - x1, height=y2 - y1),
            confidence=float(row[4]),
        )
        if not _is_plausible_text_block(
            block, transform.source_width, transform.source_height,
        ):
            continue
        blocks.append(block)
    return blocks


def _is_plausible_text_block(
    block: DetectedBlock,
    image_width: int,
    image_height: int,
) -> bool:
    """Geometric sanity check — reject blocks that are implausibly large or
    shaped like artwork rather than text."""
    bw = block.rect.width
    bh = block.rect.height
    image_area = max(image_width * image_height, 1)
    block_area = bw * bh

    # Block covers more than 25% of the image → almost certainly not text
    if block_area / image_area > 0.25:
        return False

    # Extreme aspect ratio (> 10:1 in either direction)
    aspect = max(bw, bh) / max(min(bw, bh), 1)
    if aspect > 10.0:
        return False

    # Thin horizontal line spanning most of the image width
    if bw > image_width * 0.80 and bh < image_height * 0.02:
        return False

    return True


def _binary_text_seed(
    probability: np.ndarray,
    threshold: float = 0.35,
) -> np.ndarray:
    return np.where(probability >= threshold, 255, 0).astype(np.uint8)


def _candidate_support_from_seed(
    seed: np.ndarray,
    radius: int,
) -> np.ndarray:
    if radius <= 0:
        return np.where(seed > 0, 255, 0).astype(np.uint8)

    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE,
        (radius * 2 + 1, radius * 2 + 1),
    )
    return cv2.dilate(
        np.where(seed > 0, 255, 0).astype(np.uint8),
        kernel,
        iterations=1,
    )


def _fuse_strokes_with_text_seed(
    candidate: np.ndarray,
    seed: np.ndarray,
    support_radius: int = 3,
) -> np.ndarray:
    support = _candidate_support_from_seed(seed, support_radius)
    return np.where(
        (candidate > 0) & (support > 0),
        255,
        0,
    ).astype(np.uint8)


def _estimate_candidate_growth_radius(
    candidate: np.ndarray,
) -> int:
    binary = np.where(candidate > 0, 255, 0).astype(np.uint8)
    distance = cv2.distanceTransform(binary, cv2.DIST_L2, 3)
    positive = distance[distance > 0]

    if positive.size == 0:
        return 1

    half_stroke = float(np.percentile(positive, 75))
    return int(np.clip(round(half_stroke * 0.75), 1, 4))


def _filter_paddle_only_components(
    candidate: np.ndarray,
) -> np.ndarray:
    binary = np.where(candidate > 0, 1, 0).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(
        binary,
        connectivity=8,
    )

    output = np.zeros_like(candidate, dtype=np.uint8)
    image_area = candidate.shape[0] * candidate.shape[1]

    for component_id in range(1, count):
        area = int(stats[component_id, cv2.CC_STAT_AREA])
        width = int(stats[component_id, cv2.CC_STAT_WIDTH])
        height = int(stats[component_id, cv2.CC_STAT_HEIGHT])

        if area < 3:
            continue
        if area > max(24, round(image_area * 0.75)):
            continue
        if width > candidate.shape[1] * 0.90 and height <= 3:
            continue

        output[labels == component_id] = 255

    return output


def _extract_glow_and_chromatic(crop: RgbImage, bg_val: float = 0.0) -> np.ndarray:
    if crop.size == 0:
        return np.zeros((0, 0), dtype=np.uint8)
    r = crop[:, :, 0].astype(int)
    g = crop[:, :, 1].astype(int)
    b = crop[:, :, 2].astype(int)
    c_max = np.maximum(r, np.maximum(g, b))
    c_min = np.minimum(r, np.minimum(g, b))
    chroma = c_max - c_min

    # Bright core is only text if background is dark/medium
    bright = (bg_val <= 140) & (r > 180) & (g > 180) & (b > 180)
    # Blue / Cyan glow
    blue_glow = (b > 110) & (b > r + 20)
    # Magenta / Purple / Pink glow (high Red and Blue, lower Green)
    magenta_glow = (r > 105) & (b > 85) & (g < np.maximum(r, b) - 15)
    # Warm glow (yellow / orange / gold: high Red and Green, lower Blue)
    warm_glow = (r > 135) & (g > 95) & (b < r - 25)
    # General vibrant chromatic stroke pop
    chromatic = (chroma > 30) & (c_max > 90)

    # On light background, glow must also have contrast or chroma vs background
    if bg_val > 150:
        glow_raw = (blue_glow | magenta_glow | warm_glow | chromatic).astype(np.uint8) * 255
    else:
        glow_raw = (bright | blue_glow | magenta_glow | warm_glow | chromatic).astype(np.uint8) * 255
    return glow_raw


def _extract_strokes_from_crop(crop: RgbImage) -> np.ndarray:
    if crop.size == 0:
        return np.zeros((0, 0), dtype=np.uint8)
    gray_crop = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)
    border = np.concatenate([gray_crop[0, :], gray_crop[-1, :], gray_crop[:, 0], gray_crop[:, -1]])
    bg_val = float(np.median(border))

    # Compute border background color in 3 channels
    border_rgb = np.concatenate([crop[0, :, :], crop[-1, :, :], crop[:, 0, :], crop[:, -1, :]], axis=0)
    bg_rgb = np.median(border_rgb, axis=0)
    color_dist = np.linalg.norm(crop.astype(float) - bg_rgb, axis=2)

    r = crop[:, :, 0].astype(float)
    g = crop[:, :, 1].astype(float)
    b = crop[:, :, 2].astype(float)
    chroma = np.maximum(r, np.maximum(g, b)) - np.minimum(r, np.minimum(g, b))

    if bg_val > 160:
        diff = np.abs(gray_crop.astype(float) - bg_val)
        dark_text = gray_crop < bg_val - 25
        bright_outline = (gray_crop > min(255, bg_val + 15)) & (diff > 18)
        core = ((dark_text | bright_outline).astype(np.uint8)) * 255
        return core
    elif bg_val < 100:
        # Dark background: text can be bright white, pastel, or saturated/neon (magenta, purple, cyan, yellow)
        diff = np.abs(gray_crop.astype(float) - bg_val)
        bright_text = gray_crop > max(120, bg_val + 25)
        colored_text = (color_dist > 28) & (chroma > 20) & (gray_crop > 40)
        high_diff = diff > 30
        core = ((bright_text | colored_text | high_diff).astype(np.uint8)) * 255
        return core
    else:
        diff = np.abs(gray_crop.astype(float) - bg_val)
        color_diff = np.maximum(0, r - (g + b) / 2.0)
        magenta_diff = np.maximum(0, (r + b) / 2.0 - g)
        total_diff = np.maximum(diff, np.maximum(color_diff * 1.2, magenta_diff * 1.2))
        dark_stroke = (gray_crop < bg_val - 30) & (color_dist > 22)
        core = ((total_diff > 25) | dark_stroke).astype(np.uint8) * 255
        return core


class HybridTextDetector:
    def __init__(
        self,
        ctd_detector: TextDetector,
        paddle_engine: object | None = None,
        enable_color_sweep: bool = True,
    ) -> None:
        self.ctd_detector = ctd_detector
        self.paddle_engine = paddle_engine
        self.enable_color_sweep = enable_color_sweep

    @classmethod
    def from_model_store(
        cls,
        model_store: ModelStore,
        input_size: int = 1024,
        enable_paddle: bool = True,
    ) -> Self:
        ctd = TextDetector(model_store, input_size=input_size)
        paddle = None
        if enable_paddle:
            try:
                from paddleocr import PaddleOCR
                paddle = PaddleOCR(use_gpu=False, use_angle_cls=True, lang="en", show_log=False)
            except (ImportError, RuntimeError, OSError):
                paddle = None
        return cls(ctd_detector=ctd, paddle_engine=paddle)

    def detect(self, image_rgb: RgbImage) -> DetectionResult:
        if image_rgb.ndim != 3 or image_rgb.shape[2] != 3:
            raise ValueError(f"expected HxWx3 RGB image, got {image_rgb.shape}")

        ctd_res = self.ctd_detector.detect(image_rgb)
        h, w = image_rgb.shape[:2]

        combined_prob = np.zeros((h, w), dtype=np.float32)

        # First merge vertically adjacent blocks to prevent inter-line gaps from dropping dialogue lines
        merged_blocks = _merge_adjacent_blocks(ctd_res.blocks, max_gap=40)

        # Recover unassigned high-confidence text clusters from segmentation probability
        prob = ctd_res.mask_probability
        seed_uncovered = (prob >= 0.35).astype(np.uint8) * 255
        for b in merged_blocks:
            seed_uncovered[b.rect.y : b.rect.y + b.rect.height, b.rect.x : b.rect.x + b.rect.width] = 0

        close_k = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 25))
        uncovered_closed = cv2.morphologyEx(seed_uncovered, cv2.MORPH_CLOSE, close_k)
        num_cc, _, stats, _ = cv2.connectedComponentsWithStats(uncovered_closed, connectivity=8)
        recovered_blocks: list[DetectedBlock] = []
        for i in range(1, num_cc):
            bx, by, bw, bh, area = stats[i]
            if area < 180 or min(bw, bh) < 12:
                continue
            crop = image_rgb[by : by + bh, bx : bx + bw]
            if crop.size == 0:
                continue
            crop_gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)
            lap_var = float(cv2.Laplacian(crop_gray, cv2.CV_64F).var())
            crop_edges = cv2.Canny(crop_gray, 80, 160)
            edge_density = float(np.count_nonzero(crop_edges)) / max(crop_edges.size, 1)
            comp_prob = float(np.mean(prob[by : by + bh, bx : bx + bw]))
            if lap_var > 120 and edge_density > 0.02 and comp_prob >= 0.25:
                pad = 6
                rx = max(0, bx - pad)
                ry = max(0, by - pad)
                rw = min(w - rx, bw + pad * 2)
                rh = min(h - ry, bh + pad * 2)
                recovered_blocks.append(
                    DetectedBlock(
                        rect=PixelRect(x=rx, y=ry, width=rw, height=rh),
                        confidence=comp_prob,
                    ),
                )

        if recovered_blocks:
            merged_blocks = _merge_adjacent_blocks(merged_blocks + recovered_blocks, max_gap=30)

        # Filter low-confidence blocks with almost zero text seed (e.g. spurious character line/hair detections)
        filtered_blocks: list[DetectedBlock] = []
        for b in merged_blocks:
            pad = 6
            bx1 = max(0, b.rect.x - pad)
            by1 = max(0, b.rect.y - pad)
            bx2 = min(w, b.rect.x + b.rect.width + pad)
            by2 = min(h, b.rect.y + b.rect.height + pad)
            local_prob = ctd_res.mask_probability[by1:by2, bx1:bx2]
            local_seed = _binary_text_seed(local_prob, threshold=0.25)
            seed_ratio = np.count_nonzero(local_seed) / max(local_seed.size, 1)
            if b.confidence < 0.60 and seed_ratio < 0.04:
                continue
            filtered_blocks.append(b)
        merged_blocks = filtered_blocks

        combined_blocks = list(merged_blocks)
        evidence_regions: list[TextEvidenceRegion] = [
            TextEvidenceRegion(
                id=f"ctd-{i}",
                rect=b.rect,
                polygon=None,
                source=EvidenceSource.CTD,
                confidence=b.confidence,
            )
            for i, b in enumerate(merged_blocks)
        ]

        # Process all blocks with seed-anchored stroke extraction and artwork leak protection
        for b in merged_blocks:
            pad = 6
            bx1 = max(0, b.rect.x - pad)
            by1 = max(0, b.rect.y - pad)
            bx2 = min(w, b.rect.x + b.rect.width + pad)
            by2 = min(h, b.rect.y + b.rect.height + pad)
            crop = image_rgb[by1:by2, bx1:bx2]
            if crop.size > 0:
                local_prob = ctd_res.mask_probability[by1:by2, bx1:bx2]
                # Tightened from 0.18 → 0.25 to reduce artwork noise inside blocks
                seed = _binary_text_seed(local_prob, threshold=0.25)

                # Edge-density pre-filter: heavy artwork crops use seed-only mode
                crop_gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)
                crop_edges = cv2.Canny(crop_gray, 80, 160)
                crop_edge_density = float(np.count_nonzero(crop_edges)) / max(crop_edges.size, 1)

                if crop_edge_density > 0.45:
                    # High edge density → artwork region, use conservative seed-only
                    if np.count_nonzero(seed) > 0:
                        radius = min(2, _estimate_candidate_growth_radius(seed))
                        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (radius * 2 + 1, radius * 2 + 1))
                        grown = cv2.dilate(seed, kernel, iterations=1)
                        combined_prob[by1:by2, bx1:bx2] = np.maximum(
                            combined_prob[by1:by2, bx1:bx2],
                            (grown > 0).astype(np.float32) * 0.90,
                        )
                    elif np.count_nonzero(seed) > 0:
                        combined_prob[by1:by2, bx1:bx2] = np.maximum(
                            combined_prob[by1:by2, bx1:bx2],
                            local_prob,
                        )
                    continue

                candidate = _extract_strokes_from_crop(crop)

                # Check for bright text core and colored glow (e.g. cyan, magenta, warm gold)
                crop_border = np.concatenate([crop_gray[0, :], crop_gray[-1, :], crop_gray[:, 0], crop_gray[:, -1]])
                ctd_bg_val = float(np.median(crop_border))
                glow_raw = _extract_glow_and_chromatic(crop, ctd_bg_val)

                # Restrict glow candidate to within 8px of seed pixels
                glow_candidate = _restrict_to_seed_vicinity(glow_raw, seed, max_distance=8.0)
                candidate = np.maximum(candidate, glow_candidate)

                fused = _fuse_strokes_with_text_seed(candidate, seed, support_radius=3)

                # SAFETY CHECK: Tightened from 55% → 40% — artwork leaks earlier
                if np.count_nonzero(fused) > 0:
                    if np.count_nonzero(fused) / fused.size > 0.40:
                        fused = np.maximum(seed, glow_candidate)
                    radius = min(3, _estimate_candidate_growth_radius(fused))
                    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (radius * 2 + 1, radius * 2 + 1))
                    grown = cv2.dilate(fused, kernel, iterations=1)
                    combined_prob[by1:by2, bx1:bx2] = np.maximum(
                        combined_prob[by1:by2, bx1:bx2],
                        (grown > 0).astype(np.float32) * 0.95,
                    )
                elif np.count_nonzero(seed) > 0:
                    combined_prob[by1:by2, bx1:bx2] = np.maximum(
                        combined_prob[by1:by2, bx1:bx2],
                        local_prob,
                    )

        # PaddleOCR multi-angle text line recognition (conservative, supporting evidence)
        if self.paddle_engine is not None:
            try:
                paddle_res = self.paddle_engine.ocr(image_rgb, cls=True)
                if paddle_res and paddle_res[0]:
                    for line in paddle_res[0]:
                        box, (_text, conf) = line
                        pts = np.array(box, dtype=np.int32)
                        bx, by, bw, bh = cv2.boundingRect(pts)
                        pad = 6
                        bx1 = max(0, bx - pad)
                        by1 = max(0, by - pad)
                        bx2 = min(w, bx + bw + pad)
                        by2 = min(h, by + bh + pad)

                        crop = image_rgb[by1:by2, bx1:bx2]
                        if crop.size > 0:
                            local_prob = ctd_res.mask_probability[by1:by2, bx1:bx2]
                            seed = _binary_text_seed(local_prob, threshold=0.35)
                            candidate = _extract_strokes_from_crop(crop)
                            crop_gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)
                            crop_border = np.concatenate([crop_gray[0, :], crop_gray[-1, :], crop_gray[:, 0], crop_gray[:, -1]])
                            paddle_bg_val = float(np.median(crop_border))
                            glow_raw = _extract_glow_and_chromatic(crop, paddle_bg_val)
                            candidate = np.maximum(candidate, glow_raw)
                            if np.count_nonzero(seed) > 0:
                                fused = _fuse_strokes_with_text_seed(candidate, seed, support_radius=3)
                                if np.count_nonzero(fused) > 0:
                                    radius = _estimate_candidate_growth_radius(fused)
                                    k_size = radius * 2 + 1
                                    kernel = cv2.getStructuringElement(
                                        cv2.MORPH_ELLIPSE, (k_size, k_size)
                                    )
                                    grown = cv2.dilate(fused, kernel, iterations=1)
                                    combined_prob[by1:by2, bx1:bx2] = np.maximum(
                                        combined_prob[by1:by2, bx1:bx2],
                                        (grown > 0).astype(np.float32) * 0.95,
                                    )
                            else:
                                filtered = _filter_paddle_only_components(candidate)
                                if np.count_nonzero(filtered) >= 3:
                                    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
                                    grown = cv2.dilate(filtered, kernel, iterations=1)
                                    combined_prob[by1:by2, bx1:bx2] = np.maximum(
                                        combined_prob[by1:by2, bx1:bx2],
                                        (grown > 0).astype(np.float32) * 0.95,
                                    )

                        poly = [(int(p[0]), int(p[1])) for p in pts] if pts is not None and len(pts) > 0 else None
                        matched = False
                        for ev in evidence_regions:
                            ox1 = max(bx1, ev.rect.x)
                            oy1 = max(by1, ev.rect.y)
                            ox2 = min(bx2, ev.rect.x + ev.rect.width)
                            oy2 = min(by2, ev.rect.y + ev.rect.height)
                            if ox2 > ox1 and oy2 > oy1:
                                ev.source = EvidenceSource.BOTH
                                ev.confidence = max(ev.confidence, float(conf))
                                matched = True
                        if not matched and float(conf) >= 0.35:
                            evidence_regions.append(
                                TextEvidenceRegion(
                                    id=f"paddle-{len(evidence_regions)}",
                                    rect=PixelRect(x=bx1, y=by1, width=bx2 - bx1, height=by2 - by1),
                                    polygon=poly,
                                    source=EvidenceSource.PADDLE,
                                    confidence=float(conf),
                                )
                            )

                        combined_blocks.append(
                            DetectedBlock(
                                rect=PixelRect(x=bx1, y=by1, width=bx2 - bx1, height=by2 - by1),
                                confidence=float(conf),
                            )
                        )
            except Exception:
                LOGGER.debug("PaddleOCR text detection failed", exc_info=True)

        # Skin-tone marks are supporting evidence only. Eyes, mouths, hairlines,
        # and garment seams can look identical to dark text strokes on skin, so
        # never promote them without CTD/Paddle evidence nearby.
        tattoo_mask = _detect_skin_tattoos(image_rgb)
        text_evidence = _binary_text_seed(combined_prob, threshold=0.35)
        corroborated_tattoos = _fuse_strokes_with_text_seed(
            tattoo_mask,
            text_evidence,
            support_radius=3,
        )
        if np.count_nonzero(corroborated_tattoos) > 0:
            combined_prob = np.maximum(
                combined_prob,
                (corroborated_tattoos > 0).astype(np.float32) * 0.90,
            )
            num_t, _, t_stats, _ = cv2.connectedComponentsWithStats(
                corroborated_tattoos,
                connectivity=8,
            )
            for t_id in range(1, num_t):
                tx = int(t_stats[t_id, cv2.CC_STAT_LEFT])
                ty = int(t_stats[t_id, cv2.CC_STAT_TOP])
                tw = int(t_stats[t_id, cv2.CC_STAT_WIDTH])
                th = int(t_stats[t_id, cv2.CC_STAT_HEIGHT])
                if t_stats[t_id, cv2.CC_STAT_AREA] >= 30:
                    combined_blocks.append(
                        DetectedBlock(
                            rect=PixelRect(x=tx, y=ty, width=tw, height=th),
                            confidence=0.75,
                        )
                    )


        return DetectionResult(
            mask_probability=combined_prob,
            blocks=combined_blocks,
            scale=ctd_res.scale,
            evidence_regions=evidence_regions,
        )


def _merge_adjacent_blocks(
    blocks: Sequence[DetectedBlock],
    max_gap: int = 40,
    protected_edges: BinaryMask | None = None,
) -> list[DetectedBlock]:
    if not blocks:
        return []
    rects = [[b.rect.x, b.rect.y, b.rect.x + b.rect.width, b.rect.y + b.rect.height, b.confidence] for b in blocks]
    merged: list[list[float]] = []
    for r in sorted(rects, key=lambda x: (x[0], x[1])):
        combined = False
        for m in merged:
            x_overlap = min(r[2], m[2]) - max(r[0], m[0])
            y_gap = max(0, r[1] - m[3], m[1] - r[3])
            min_w = min(r[2] - r[0], m[2] - m[0])
            if x_overlap > 0.3 * min_w and y_gap <= max_gap:
                if protected_edges is not None and y_gap > 0:
                    gy1 = int(min(r[1], m[3]))
                    gy2 = int(max(r[1], m[3]))
                    gx1 = int(max(r[0], m[0]))
                    gx2 = int(min(r[2], m[2]))
                    if gy2 > gy1 and gx2 > gx1:
                        edge_crop = protected_edges[gy1:gy2, gx1:gx2]
                        if np.count_nonzero(edge_crop) > 0.3 * (gx2 - gx1):
                            continue
                m[0] = min(m[0], r[0])
                m[1] = min(m[1], r[1])
                m[2] = max(m[2], r[2])
                m[3] = max(m[3], r[3])
                m[4] = max(m[4], r[4])
                combined = True
                break
        if not combined:
            merged.append(r[:])
    return [
        DetectedBlock(
            rect=PixelRect(x=int(m[0]), y=int(m[1]), width=int(m[2] - m[0]), height=int(m[3] - m[1])),
            confidence=float(m[4]),
        )
        for m in merged
    ]


def _restrict_to_seed_vicinity(
    candidate: np.ndarray,
    seed: np.ndarray,
    max_distance: float = 8.0,
) -> np.ndarray:
    """Keep only candidate pixels within *max_distance* pixels of any seed pixel.

    This prevents glow/bright detection from reaching into artwork far from
    actual text strokes.
    """
    if np.count_nonzero(seed) == 0:
        return np.zeros_like(candidate)
    inv_seed = (255 - np.where(seed > 0, 255, 0).astype(np.uint8))
    dist = cv2.distanceTransform(inv_seed, cv2.DIST_L2, 3)
    return np.where(
        (candidate > 0) & (dist <= max_distance), 255, 0,
    ).astype(np.uint8)


def _detect_skin_tattoos(image_rgb: RgbImage) -> np.ndarray:
    h, w = image_rgb.shape[:2]
    ycrcb = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2YCrCb)
    cr = ycrcb[:, :, 1]
    cb = ycrcb[:, :, 2]
    is_skin = (cr >= 135) & (cr <= 170) & (cb >= 85) & (cb <= 125)
    # Dilate skin mask so that dark text drawn on skin is fully enclosed
    skin_k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
    skin_envelope = cv2.dilate(is_skin.astype(np.uint8), skin_k, iterations=1)
    gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    blackhat = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, kernel)
    tattoo_candidates = (blackhat > 25) & (skin_envelope > 0)
    num_t, t_labels, t_stats, _ = cv2.connectedComponentsWithStats(
        tattoo_candidates.astype(np.uint8), connectivity=8
    )
    mask = np.zeros((h, w), dtype=np.uint8)
    for i in range(1, num_t):
        area = t_stats[i, cv2.CC_STAT_AREA]
        tw = t_stats[i, cv2.CC_STAT_WIDTH]
        th = t_stats[i, cv2.CC_STAT_HEIGHT]
        if 15 <= area <= 800 and tw < 150 and th < 80:
            mask[t_labels == i] = 255
    return cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)), iterations=1)

