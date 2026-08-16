from __future__ import annotations

import os
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol, Self, cast

import numpy as np
import onnxruntime as ort
from numpy.typing import NDArray

from app.detector import RgbImage
from app.mask_refiner import BinaryMask, MaskRegion
from app.model_store import ModelStore


@dataclass(frozen=True)
class AotTransform:
    source_height: int
    source_width: int
    padded_height: int
    padded_width: int


class _Session(Protocol):
    def run(
        self,
        output_names: None,
        input_feed: dict[str, NDArray[np.float32]],
    ) -> Sequence[np.ndarray]: ...


def prepare_aot_inputs(
    image_rgb: RgbImage,
    mask: BinaryMask,
) -> tuple[NDArray[np.float32], NDArray[np.float32], AotTransform]:
    if image_rgb.shape[:2] != mask.shape:
        raise ValueError("image and mask dimensions must match")
    height, width = mask.shape
    padded_height = _round_up(height, 8)
    padded_width = _round_up(width, 8)
    image_padded = np.zeros((padded_height, padded_width, 3), dtype=np.uint8)
    image_padded[:height, :width] = image_rgb
    mask_padded = np.zeros((padded_height, padded_width), dtype=np.float32)
    mask_padded[:height, :width] = mask > 0
    image_tensor = image_padded.astype(np.float32) / 127.5 - 1.0
    image_tensor = np.transpose(image_tensor, (2, 0, 1))[None, ...]
    mask_tensor = mask_padded[None, None, ...]
    return (
        image_tensor,
        mask_tensor,
        AotTransform(height, width, padded_height, padded_width),
    )


def restore_aot_output(
    output: NDArray[np.float32],
    transform: AotTransform,
) -> RgbImage:
    restored = output.squeeze(0).transpose(1, 2, 0)
    restored = ((restored + 1.0) * 127.5).clip(0, 255).astype(np.uint8)
    return restored[: transform.source_height, : transform.source_width]


class AotCleaner:
    def __init__(self, model_store: ModelStore) -> None:
        options = ort.SessionOptions()
        options.enable_cpu_mem_arena = False
        options.intra_op_num_threads = min(6, os.cpu_count() or 1)
        session = ort.InferenceSession(
            str(model_store.ensure("aot-onnx")),
            sess_options=options,
            providers=["CPUExecutionProvider"],
        )
        self.session = cast("_Session", session)

    @classmethod
    def from_session(cls, session: _Session) -> Self:
        cleaner = cls.__new__(cls)
        cleaner.session = session
        return cleaner

    def clean(
        self,
        image_rgb: RgbImage,
        mask: BinaryMask,
        region: MaskRegion,
    ) -> RgbImage:
        x0, y0, x1, y1 = _context_bounds(
            region,
            image_rgb.shape[1],
            image_rgb.shape[0],
            context=96,
        )
        crop = image_rgb[y0:y1, x0:x1]
        crop_mask = mask[y0:y1, x0:x1]
        if not np.any(crop_mask):
            return image_rgb.copy()

        image_tensor, mask_tensor, transform = prepare_aot_inputs(
            crop,
            crop_mask,
        )
        masked_image = image_tensor * (1 - mask_tensor)
        output = self.session.run(
            None,
            {
                "image": masked_image.astype(np.float32),
                "mask": mask_tensor.astype(np.float32),
            },
        )[0]
        repaired = restore_aot_output(
            np.asarray(output, dtype=np.float32),
            transform,
        )
        result = image_rgb.copy()
        support = crop_mask > 0
        destination = result[y0:y1, x0:x1]
        destination[support] = repaired[support]
        return result


def _round_up(value: int, multiple: int) -> int:
    return value if value % multiple == 0 else value + multiple - value % multiple


def _context_bounds(
    region: MaskRegion,
    image_width: int,
    image_height: int,
    context: int,
) -> tuple[int, int, int, int]:
    rect = region.rect
    return (
        max(0, rect.x - context),
        max(0, rect.y - context),
        min(image_width, rect.x + rect.width + context),
        min(image_height, rect.y + rect.height + context),
    )
