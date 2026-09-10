"""LamaLargeCleaner — production Big LaMa inpainting through ONNX Runtime.

The shipped Windows runtime intentionally does not require PyTorch. The original
TorchScript model is a build-time source asset; ``anime-manga-big-lama.onnx``
is the production model consumed here.
"""
from __future__ import annotations

import logging
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Protocol, Self, cast

import cv2
import numpy as np
from numpy.typing import NDArray

from app.cleaners.aot import _context_bounds, _round_up
from app.detector import RgbImage
from app.mask_refiner import BinaryMask, MaskRegion
from app.model_store import ModelStore
from app.ort_utils import create_cpu_inference_session, create_inference_session


LOGGER = logging.getLogger(__name__)
DEFAULT_ONNX_FILENAME = "anime-manga-big-lama.onnx"


class CleanerUnavailable(RuntimeError):
    """Raised when the production LamaLarge cleaner cannot run."""


class _Session(Protocol):
    def run(
        self,
        output_names: None,
        input_feed: dict[str, NDArray[np.float32]],
    ) -> Sequence[np.ndarray]: ...

    def get_providers(self) -> list[str]: ...


class LamaLargeCleaner:
    def __init__(
        self,
        session: _Session,
        *,
        cpu_session_factory: Callable[[], _Session] | None = None,
    ) -> None:
        self.session = session
        self._cpu_session_factory = cpu_session_factory
        self._cpu_fallback_used = False

    @classmethod
    def from_model_store(cls, model_store: ModelStore) -> Self:
        model_path = model_store.model_dir / DEFAULT_ONNX_FILENAME
        return cls.from_model_path(model_path)

    @classmethod
    def from_model_path(cls, model_path: str | Path) -> Self:
        path = Path(model_path)
        if path.suffix.lower() != ".onnx":
            raise CleanerUnavailable(
                f"Unsupported LamaLarge model format: {path.name} (expected ONNX .onnx)",
            )
        if not path.exists() or path.stat().st_size <= 1000:
            raise CleanerUnavailable(
                f"LamaLarge ONNX model is missing or invalid: {path}",
            )
        try:
            session = create_inference_session(path)
        except Exception as err:
            raise CleanerUnavailable(
                f"Could not initialize LamaLarge ONNX runtime: {err}",
            ) from err
        return cls(
            cast("_Session", session),
            cpu_session_factory=lambda: cast(
                "_Session",
                create_cpu_inference_session(path),
            ),
        )

    @classmethod
    def from_session(
        cls,
        session: _Session,
        *,
        cpu_session_factory: Callable[[], _Session] | None = None,
    ) -> Self:
        return cls(session, cpu_session_factory=cpu_session_factory)

    @property
    def providers(self) -> list[str]:
        try:
            return list(self.session.get_providers())
        except Exception:
            return []

    def _run(
        self,
        image_rgb: RgbImage,
        mask: BinaryMask,
    ) -> RgbImage:
        if image_rgb.shape[:2] != mask.shape:
            raise ValueError("image and mask dimensions must match")

        height, width = mask.shape
        padded_height = _round_up(height, 8)
        padded_width = _round_up(width, 8)

        image_padded = np.zeros((padded_height, padded_width, 3), np.float32)
        image_padded[:height, :width] = image_rgb.astype(np.float32) / 255.0
        mask_padded = np.zeros((padded_height, padded_width), np.float32)
        mask_padded[:height, :width] = mask > 0

        image_tensor = np.ascontiguousarray(
            image_padded.transpose(2, 0, 1)[None, ...],
            dtype=np.float32,
        )
        mask_tensor = np.ascontiguousarray(
            mask_padded[None, None, ...],
            dtype=np.float32,
        )

        input_feed = {
            "image": image_tensor,
            "mask": mask_tensor,
        }
        try:
            output = self.session.run(None, input_feed)[0]
        except Exception as err:
            providers = self.providers
            can_fallback = (
                self._cpu_session_factory is not None
                and not self._cpu_fallback_used
                and any(provider != "CPUExecutionProvider" for provider in providers)
            )
            if not can_fallback:
                raise

            LOGGER.warning(
                "LamaLarge execution failed on providers %s (%s). Retrying once on CPU.",
                providers,
                err,
            )
            self._cpu_fallback_used = True
            self.session = self._cpu_session_factory()
            output = self.session.run(None, input_feed)[0]
        repaired = np.asarray(output, dtype=np.float32).squeeze(0).transpose(1, 2, 0)
        return (repaired.clip(0, 1) * 255).astype(np.uint8)[:height, :width]

    def clean(
        self,
        image_rgb: RgbImage,
        mask: BinaryMask,
        region: MaskRegion,
    ) -> RgbImage:
        context = max(192, round(max(region.rect.width, region.rect.height) * 0.75))
        x0, y0, x1, y1 = _context_bounds(
            region,
            image_rgb.shape[1],
            image_rgb.shape[0],
            context=context,
        )
        crop = image_rgb[y0:y1, x0:x1]
        crop_mask = mask[y0:y1, x0:x1]
        if not np.any(crop_mask):
            return image_rgb.copy()

        repaired = self._run(crop, crop_mask)
        result = image_rgb.copy()
        support = crop_mask > 0
        destination = result[y0:y1, x0:x1]
        destination[support] = repaired[support]
        return result

    def clean_roi(
        self,
        image_rgb: RgbImage,
        mask: BinaryMask,
        rect,
    ) -> RgbImage:
        """Run LamaLarge only inside a precomputed ROI while committing mask pixels only."""
        x0 = max(0, int(rect.x))
        y0 = max(0, int(rect.y))
        x1 = min(image_rgb.shape[1], x0 + int(rect.width))
        y1 = min(image_rgb.shape[0], y0 + int(rect.height))
        crop = image_rgb[y0:y1, x0:x1]
        crop_mask = mask[y0:y1, x0:x1]
        if crop.size == 0 or not np.any(crop_mask):
            return image_rgb.copy()

        repaired = self._run(crop, crop_mask)
        result = image_rgb.copy()
        support = crop_mask > 0
        destination = result[y0:y1, x0:x1]
        destination[support] = repaired[support]
        return result

    def clean_full_image(
        self,
        image_rgb: RgbImage,
        mask: BinaryMask,
        max_dim: int = 1536,
    ) -> RgbImage:
        if not np.any(mask):
            return image_rgb.copy()

        height, width = mask.shape
        scale = 1.0
        if max(height, width) > max_dim:
            scale = max_dim / max(height, width)
            target_width = max(8, int(round(width * scale / 8) * 8))
            target_height = max(8, int(round(height * scale / 8) * 8))
            image_input = cv2.resize(
                image_rgb,
                (target_width, target_height),
                interpolation=cv2.INTER_AREA,
            )
            mask_input = cv2.resize(
                mask,
                (target_width, target_height),
                interpolation=cv2.INTER_NEAREST,
            )
        else:
            image_input = image_rgb
            mask_input = mask

        repaired = self._run(image_input, mask_input)
        if scale != 1.0:
            repaired = cv2.resize(
                repaired,
                (width, height),
                interpolation=cv2.INTER_CUBIC,
            )

        result = image_rgb.copy()
        result[mask > 0] = repaired[:height, :width][mask > 0]
        return result
