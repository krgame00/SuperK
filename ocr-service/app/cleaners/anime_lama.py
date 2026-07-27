from __future__ import annotations

import importlib
import importlib.util
from pathlib import Path
from typing import Self

import numpy as np

from app.cleaners.aot import _context_bounds, _round_up
from app.detector import RgbImage
from app.mask_refiner import BinaryMask, MaskRegion
from app.model_store import ModelStore


class CleanerUnavailable(RuntimeError):
    """Raised when an optional cleaner cannot run."""


class AnimeLamaCleaner:
    def __init__(self, model: object, torch_module: object) -> None:
        self.model = model
        self.torch = torch_module

    @classmethod
    def from_model_store(cls, model_store: ModelStore) -> Self:
        return cls.from_model_path(model_store.ensure("anime-lama"))

    @classmethod
    def from_model_path(cls, model_path: str | Path) -> Self:
        if importlib.util.find_spec("torch") is None:
            raise CleanerUnavailable(
                "anime-lama requires requirements-lama.lock",
            )
        torch = importlib.import_module("torch")
        model = torch.jit.load(str(model_path), map_location="cpu")
        model.eval()
        return cls(model, torch)

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

        height, width = crop_mask.shape
        padded_height = _round_up(height, 8)
        padded_width = _round_up(width, 8)
        image_padded = np.zeros((padded_height, padded_width, 3), np.float32)
        image_padded[:height, :width] = crop.astype(np.float32) / 255
        mask_padded = np.zeros((padded_height, padded_width), np.float32)
        mask_padded[:height, :width] = crop_mask > 0

        image_tensor = self.torch.from_numpy(
            image_padded.transpose(2, 0, 1)[None, ...],
        )
        mask_tensor = self.torch.from_numpy(mask_padded[None, None, ...])
        with self.torch.inference_mode():
            output = self.model(image_tensor, mask_tensor)
        repaired = (
            output.detach()
            .cpu()
            .numpy()
            .squeeze(0)
            .transpose(1, 2, 0)
        )
        repaired = (repaired.clip(0, 1) * 255).astype(np.uint8)[:height, :width]

        result = image_rgb.copy()
        support = crop_mask > 0
        destination = result[y0:y1, x0:x1]
        destination[support] = repaired[support]
        return result
