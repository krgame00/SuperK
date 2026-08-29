"""LamaLargeCleaner — lama_large (AnimeManga) inpainter via torch.

Model: dreMaz/AnimeMangaInpainting lama_large_512px.ckpt (GPL-3.0 arch from
manga-image-translator; checkpoint license: see model card).
"""
from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Self

import cv2
import numpy as np

from app.cleaners.aot import _context_bounds, _round_up
from app.detector import RgbImage
from app.mask_refiner import BinaryMask, MaskRegion
from app.model_store import ModelStore


class CleanerUnavailable(RuntimeError):
    """Raised when an optional cleaner cannot run."""


class LamaLargeCleaner:
    def __init__(self, model, torch_module) -> None:
        self.model = model
        self.torch = torch_module

    @classmethod
    def from_model_store(cls, model_store: ModelStore) -> Self:
        return cls.from_model_path(model_store.ensure("lama-large"))

    @classmethod
    def from_model_path(cls, model_path: str | Path) -> Self:
        if importlib.util.find_spec("torch") is None:
            raise CleanerUnavailable("lama-large requires torch")
        try:
            from app.cleaners.lama_large_arch import build_lama_large
        except (ImportError, Exception):
            raise CleanerUnavailable("lama_large_arch not available")
        torch = importlib.import_module("torch")
        gen = build_lama_large()
        sd = torch.load(str(model_path), map_location="cpu", weights_only=False)
        gen.load_state_dict(sd["gen_state_dict"])
        del sd
        import gc
        gc.collect()
        gen.eval()
        if torch.cuda.is_available():
            gen = gen.to("cuda")
        return cls(gen, torch)

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

        height, width = crop_mask.shape
        padded_height = _round_up(height, 8)
        padded_width = _round_up(width, 8)
        image_padded = np.zeros((padded_height, padded_width, 3), np.float32)
        image_padded[:height, :width] = crop.astype(np.float32) / 255.0
        mask_padded = np.zeros((padded_height, padded_width), np.float32)
        mask_padded[:height, :width] = crop_mask > 0

        image_tensor = self.torch.from_numpy(
            image_padded.transpose(2, 0, 1)[None, ...],
        )
        mask_tensor = self.torch.from_numpy(mask_padded[None, None, ...])
        is_cuda = next(self.model.parameters()).is_cuda
        if is_cuda:
            image_tensor = image_tensor.to("cuda")
            mask_tensor = mask_tensor.to("cuda")
        with self.torch.inference_mode():
            output = self.model(image_tensor, mask_tensor)
        repaired = (
            output.detach()
            .cpu()
            .numpy()
            .squeeze(0)
            .transpose(1, 2, 0)
        )
        del image_tensor, mask_tensor, output
        if is_cuda:
            self.torch.cuda.empty_cache()

        repaired = (repaired.clip(0, 1) * 255).astype(np.uint8)[:height, :width]

        result = image_rgb.copy()
        support = crop_mask > 0
        destination = result[y0:y1, x0:x1]
        destination[support] = repaired[support]
        return result

    def clean_full_image(
        self,
        image_rgb: RgbImage,
        mask: BinaryMask,
        max_dim: int = 1024,
    ) -> RgbImage:
        if not np.any(mask):
            return image_rgb.copy()

        h, w = mask.shape
        scale = 1.0
        if max(h, w) > max_dim:
            scale = max_dim / max(h, w)
            tw = int(round(w * scale / 8) * 8)
            th = int(round(h * scale / 8) * 8)
            img_in = cv2.resize(image_rgb, (tw, th), interpolation=cv2.INTER_AREA)
            mask_in = cv2.resize(mask, (tw, th), interpolation=cv2.INTER_NEAREST)
        else:
            tw = _round_up(w, 8)
            th = _round_up(h, 8)
            img_in = np.zeros((th, tw, 3), np.uint8)
            img_in[:h, :w] = image_rgb
            mask_in = np.zeros((th, tw), np.uint8)
            mask_in[:h, :w] = mask

        image_padded = img_in.astype(np.float32) / 255.0
        mask_padded = (mask_in > 0).astype(np.float32)

        image_tensor = self.torch.from_numpy(
            image_padded.transpose(2, 0, 1)[None, ...],
        )
        mask_tensor = self.torch.from_numpy(mask_padded[None, None, ...])
        is_cuda = next(self.model.parameters()).is_cuda
        if is_cuda:
            image_tensor = image_tensor.to("cuda")
            mask_tensor = mask_tensor.to("cuda")
        with self.torch.inference_mode():
            output = self.model(image_tensor, mask_tensor)
        repaired = (
            output.detach()
            .cpu()
            .numpy()
            .squeeze(0)
            .transpose(1, 2, 0)
        )
        del image_tensor, mask_tensor, output
        if is_cuda:
            self.torch.cuda.empty_cache()

        if scale != 1.0:
            repaired_full = cv2.resize(repaired, (w, h), interpolation=cv2.INTER_CUBIC)
        else:
            repaired_full = repaired[:h, :w]

        repaired_u8 = (repaired_full.clip(0, 1) * 255).astype(np.uint8)
        result = image_rgb.copy()
        result[mask > 0] = repaired_u8[mask > 0]
        return result
