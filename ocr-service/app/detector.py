from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol, Self, cast

import cv2
import numpy as np
import onnxruntime as ort
from numpy.typing import NDArray

from app.ort_utils import create_inference_session, preferred_providers

from app.model_store import ModelStore
from app.schemas import PixelRect

LOGGER = logging.getLogger(__name__)

FloatMask = NDArray[np.float32]
RgbImage = NDArray[np.uint8]
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
        return DetectionResult(
            mask_probability=probability,
            blocks=blocks,
            scale=transform,
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
    confidence_threshold: float = 0.2,
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
        blocks.append(
            DetectedBlock(
                rect=PixelRect(x=x1, y=y1, width=x2 - x1, height=y2 - y1),
                confidence=float(row[4]),
            )
        )
    return blocks


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
        if area > max(12, round(image_area * 0.18)):
            continue
        if width > candidate.shape[1] * 0.85 and height <= 3:
            continue

        output[labels == component_id] = 255

    return output


def _extract_strokes_from_crop(crop: RgbImage) -> np.ndarray:
    if crop.size == 0:
        return np.zeros((0, 0), dtype=np.uint8)
    gray_crop = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)
    border = np.concatenate([gray_crop[0, :], gray_crop[-1, :], gray_crop[:, 0], gray_crop[:, -1]])
    bg_val = float(np.median(border))
    if bg_val > 160:
        core = (gray_crop < bg_val - 25).astype(np.uint8) * 255
        return core
    elif bg_val < 100:
        core = (gray_crop > 150).astype(np.uint8) * 255
        return core
    else:
        diff = np.abs(gray_crop.astype(float) - bg_val)
        r = crop[:, :, 0].astype(float)
        g = crop[:, :, 1].astype(float)
        b = crop[:, :, 2].astype(float)
        color_diff = np.maximum(0, r - (g + b) / 2.0)
        total_diff = np.maximum(diff, color_diff * 1.2)
        core = (total_diff > 25).astype(np.uint8) * 255
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
            except Exception:
                paddle = None
        return cls(ctd_detector=ctd, paddle_engine=paddle)

    def detect(self, image_rgb: RgbImage) -> DetectionResult:
        if image_rgb.ndim != 3 or image_rgb.shape[2] != 3:
            raise ValueError(f"expected HxWx3 RGB image, got {image_rgb.shape}")

        ctd_res = self.ctd_detector.detect(image_rgb)
        h, w = image_rgb.shape[:2]
        
        combined_prob = np.zeros((h, w), dtype=np.float32)
        combined_blocks = list(ctd_res.blocks)

        # Process all CTD blocks with seed-anchored stroke extraction
        for b in ctd_res.blocks:
            pad = 6
            bx1 = max(0, b.rect.x - pad)
            by1 = max(0, b.rect.y - pad)
            bx2 = min(w, b.rect.x + b.rect.width + pad)
            by2 = min(h, b.rect.y + b.rect.height + pad)
            crop = image_rgb[by1:by2, bx1:bx2]
            if crop.size > 0:
                local_prob = ctd_res.mask_probability[by1:by2, bx1:bx2]
                seed = _binary_text_seed(local_prob, threshold=0.35)
                candidate = _extract_strokes_from_crop(crop)
                fused = _fuse_strokes_with_text_seed(candidate, seed, support_radius=3)
                if np.count_nonzero(fused) > 0:
                    radius = _estimate_candidate_growth_radius(fused)
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
                        box, (text, conf) = line
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
                            if np.count_nonzero(seed) > 0:
                                fused = _fuse_strokes_with_text_seed(candidate, seed, support_radius=3)
                                if np.count_nonzero(fused) > 0:
                                    radius = _estimate_candidate_growth_radius(fused)
                                    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (radius * 2 + 1, radius * 2 + 1))
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

                        combined_blocks.append(
                            DetectedBlock(
                                rect=PixelRect(x=bx1, y=by1, width=bx2 - bx1, height=by2 - by1),
                                confidence=float(conf),
                            )
                        )
            except Exception:
                LOGGER.debug("PaddleOCR text detection failed", exc_info=True)

        # Fallback: if stroke extraction produced an empty mask for a high-confidence CTD block, fallback to CTD prob
        for b in ctd_res.blocks:
            bx1 = max(0, b.rect.x)
            by1 = max(0, b.rect.y)
            bx2 = min(w, bx1 + b.rect.width)
            by2 = min(h, by1 + b.rect.height)
            if np.count_nonzero(combined_prob[by1:by2, bx1:bx2]) < 5 and b.confidence >= 0.5:
                combined_prob[by1:by2, bx1:bx2] = np.maximum(
                    combined_prob[by1:by2, bx1:bx2],
                    ctd_res.mask_probability[by1:by2, bx1:bx2],
                )

        if combined_blocks:
            block_support = np.zeros((h, w), dtype=bool)
            for b in combined_blocks:
                margin = 24
                bx1 = max(0, b.rect.x - margin)
                by1 = max(0, b.rect.y - margin)
                bx2 = min(w, b.rect.x + b.rect.width + margin)
                by2 = min(h, b.rect.y + b.rect.height + margin)
                block_support[by1:by2, bx1:bx2] = True
            combined_prob[~block_support] = 0.0

        return DetectionResult(
            mask_probability=combined_prob,
            blocks=combined_blocks,
            scale=ctd_res.scale,
        )