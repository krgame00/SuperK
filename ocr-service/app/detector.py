from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol, Self, cast

import cv2
import numpy as np
import onnxruntime as ort
from numpy.typing import NDArray

from app.ort_utils import preferred_providers

from app.model_store import ModelStore
from app.schemas import PixelRect

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
        options = ort.SessionOptions()
        options.enable_cpu_mem_arena = False
        session = ort.InferenceSession(
            str(model_store.ensure("ctd-onnx")),
            sess_options=options,
            providers=preferred_providers(),
        )
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
    confidence_threshold: float = 0.3,
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
            ),
        )
    return sorted(blocks, key=lambda block: block.rect.y + block.rect.height / 2)


def _xywh_to_xyxy(boxes: NDArray[np.float32]) -> NDArray[np.float32]:
    converted = boxes.copy()
    converted[:, 0] = boxes[:, 0] - boxes[:, 2] / 2
    converted[:, 1] = boxes[:, 1] - boxes[:, 3] / 2
    converted[:, 2] = boxes[:, 0] + boxes[:, 2] / 2
    converted[:, 3] = boxes[:, 1] + boxes[:, 3] / 2
    return converted


def _greedy_nms(
    boxes: NDArray[np.float32],
    scores: NDArray[np.float32],
    iou_threshold: float,
) -> NDArray[np.int64]:
    if boxes.size == 0:
        return np.empty(0, dtype=np.int64)

    areas = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
    order = scores.argsort()[::-1]
    kept: list[int] = []
    while order.size:
        current = int(order[0])
        kept.append(current)
        if order.size == 1:
            break
        rest = order[1:]
        x1 = np.maximum(boxes[current, 0], boxes[rest, 0])
        y1 = np.maximum(boxes[current, 1], boxes[rest, 1])
        x2 = np.minimum(boxes[current, 2], boxes[rest, 2])
        y2 = np.minimum(boxes[current, 3], boxes[rest, 3])
        intersection = np.maximum(0, x2 - x1) * np.maximum(0, y2 - y1)
        union = areas[current] + areas[rest] - intersection
        iou = np.divide(
            intersection,
            union,
            out=np.zeros_like(intersection),
            where=union > 0,
        )
        order = rest[iou <= iou_threshold]
    return np.asarray(kept, dtype=np.int64)
