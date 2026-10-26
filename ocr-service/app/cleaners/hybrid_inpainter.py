from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from time import perf_counter

import cv2
import numpy as np


class InpaintTier(StrEnum):
    SOLID = "solid"
    GRADIENT = "gradient"
    DEEP = "deep"


@dataclass(frozen=True)
class HybridInpaintResult:
    image_rgb: np.ndarray
    tier: InpaintTier
    has_dominant_bg_color: bool
    dominant_color_rgb: tuple[int, int, int] | None = None
    elapsed_ms: float = 0.0


class HybridInpainter:
    """
    3-Tier Hybrid Inpainter with Perimeter Ring Sampling.

    Tier 1: Uniform flat background (speech balloon) -> Median fill (<0.5ms)
    Tier 2: 1D vertical linear gradient (manhwa / sky) -> Linear interpolation (~1.2ms)
    Tier 3: Complex line-art / screentone -> Deep neural network (LaMa Large / AOT)
    """

    def __init__(
        self,
        solid_std_threshold: float = 6.5,
        inner_dilation: int = 3,
        outer_dilation: int = 7,
        min_ring_pixels: int = 8,
    ):
        self.solid_std_threshold = solid_std_threshold
        self.inner_dilation = inner_dilation
        self.outer_dilation = outer_dilation
        self.min_ring_pixels = min_ring_pixels

    def inpaint(
        self,
        image_rgb: np.ndarray,
        binary_mask: np.ndarray,
        deep_cleaner_fn: Callable[[np.ndarray, np.ndarray], np.ndarray] | None = None,
    ) -> HybridInpaintResult:
        t0 = perf_counter()
        if not np.any(binary_mask):
            return HybridInpaintResult(
                image_rgb=image_rgb.copy(),
                tier=InpaintTier.SOLID,
                has_dominant_bg_color=True,
                dominant_color_rgb=(255, 255, 255),
                elapsed_ms=(perf_counter() - t0) * 1000.0,
            )

        # 1. Perimeter Ring Sampling
        # Inner mask slightly dilated to cover font anti-aliasing halos
        k_in = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (self.inner_dilation * 2 + 1, self.inner_dilation * 2 + 1)
        )
        mask_inner = cv2.dilate(binary_mask, k_in)

        # Outer ring expands further into the surrounding balloon background
        k_out = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (self.outer_dilation * 2 + 1, self.outer_dilation * 2 + 1)
        )
        mask_outer = cv2.dilate(binary_mask, k_out)

        ring_mask = cv2.subtract(mask_outer, mask_inner)
        ring_pixels = image_rgb[ring_mask > 0]

        # If ring doesn't have enough background context, fallback to deep cleaner
        if len(ring_pixels) < self.min_ring_pixels:
            return self._run_deep(image_rgb, binary_mask, deep_cleaner_fn, t0)

        channel_stds = np.std(ring_pixels.astype(np.float32), axis=0)
        max_std = float(np.max(channel_stds))

        # 2. Tier 1: Solid Bubble Fill (<0.5ms)
        if max_std < self.solid_std_threshold:
            dominant_rgb = tuple(int(c) for c in np.median(ring_pixels, axis=0).astype(np.uint8))
            result = image_rgb.copy()
            # Replace mask_inner pixels with dominant color
            result[mask_inner > 0] = dominant_rgb
            return HybridInpaintResult(
                image_rgb=result,
                tier=InpaintTier.SOLID,
                has_dominant_bg_color=True,
                dominant_color_rgb=dominant_rgb,
                elapsed_ms=(perf_counter() - t0) * 1000.0,
            )

        # 3. Tier 2: 1D Vertical Gradient Fill (~1.2ms)
        gradient_result = self._try_vertical_gradient(image_rgb, binary_mask, mask_inner, ring_mask)
        if gradient_result is not None:
            return HybridInpaintResult(
                image_rgb=gradient_result,
                tier=InpaintTier.GRADIENT,
                has_dominant_bg_color=False,
                elapsed_ms=(perf_counter() - t0) * 1000.0,
            )

        # 4. Tier 3: Deep Inpainting Fallback
        return self._run_deep(image_rgb, binary_mask, deep_cleaner_fn, t0)

    def _try_vertical_gradient(
        self,
        image_rgb: np.ndarray,
        binary_mask: np.ndarray,
        mask_inner: np.ndarray,
        ring_mask: np.ndarray,
    ) -> np.ndarray | None:
        """
        Attempts 1D vertical gradient fill if horizontal variation is low
        while vertical progression is significant.
        """
        h, w = image_rgb.shape[:2]
        # Check rows that intersect the mask
        masked_rows = np.where(np.any(mask_inner > 0, axis=1))[0]
        if len(masked_rows) < 4:
            return None

        # Sample ring pixels per row
        row_means = {}
        row_stds = []
        for y in range(h):
            row_ring_idx = np.where(ring_mask[y] > 0)[0]
            if len(row_ring_idx) >= 2:
                row_pixels = image_rgb[y, row_ring_idx].astype(np.float32)
                row_means[y] = np.mean(row_pixels, axis=0)
                row_stds.append(np.max(np.std(row_pixels, axis=0)))

        if len(row_stds) < 4:
            return None

        mean_horizontal_std = float(np.mean(row_stds))
        # If horizontal variation is high (e.g. textured artwork, lines), not a 1D gradient
        if mean_horizontal_std > 5.5:
            return None

        # Check vertical gradient range across row_means
        y_keys = sorted(row_means.keys())
        top_y, bot_y = y_keys[0], y_keys[-1]
        c_top = row_means[top_y]
        c_bot = row_means[bot_y]
        vertical_diff = float(np.max(np.abs(c_top - c_bot)))

        # Needs a meaningful vertical gradient difference
        if vertical_diff < 7.0:
            return None

        # Linearly interpolate color down the height
        result = image_rgb.copy()
        # Build gradient lookup table for all Y
        lut = np.zeros((h, 3), dtype=np.uint8)
        for y in range(h):
            if y <= top_y:
                lut[y] = np.clip(c_top, 0, 255).astype(np.uint8)
            elif y >= bot_y:
                lut[y] = np.clip(c_bot, 0, 255).astype(np.uint8)
            else:
                alpha = (y - top_y) / max(1.0, float(bot_y - top_y))
                interpolated = (1.0 - alpha) * c_top + alpha * c_bot
                lut[y] = np.clip(interpolated, 0, 255).astype(np.uint8)

        # Apply gradient only inside mask_inner
        for y in masked_rows:
            target_cols = np.where(mask_inner[y] > 0)[0]
            if len(target_cols) > 0:
                result[y, target_cols] = lut[y]

        return result

    def _run_deep(
        self,
        image_rgb: np.ndarray,
        binary_mask: np.ndarray,
        deep_cleaner_fn: Callable[[np.ndarray, np.ndarray], np.ndarray] | None,
        t0: float,
    ) -> HybridInpaintResult:
        if deep_cleaner_fn is not None:
            repaired = deep_cleaner_fn(image_rgb, binary_mask)
            result = image_rgb.copy()
            support = binary_mask > 0
            result[support] = repaired[support]
        else:
            repaired = cv2.inpaint(image_rgb, binary_mask, 5, cv2.INPAINT_NS)
            result = image_rgb.copy()
            support = binary_mask > 0
            result[support] = repaired[support]

        return HybridInpaintResult(
            image_rgb=result,
            tier=InpaintTier.DEEP,
            has_dominant_bg_color=False,
            elapsed_ms=(perf_counter() - t0) * 1000.0,
        )
