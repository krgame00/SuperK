from __future__ import annotations

import cv2
import numpy as np


def extend_mask_with_stroke_hints(
    image_rgb: np.ndarray,
    mask: np.ndarray,
    dilation_px: int = 5,
) -> np.ndarray:
    """Smartly expands an inpaint mask into high-contrast text edges in the dilation ring.

    This captures anti-aliasing halos and drop-shadow artifacts while avoiding bleeding
    into smooth background artwork or screen tones.
    """
    if not np.any(mask):
        return np.zeros_like(mask)

    rad = max(1, int(dilation_px))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (rad * 2 + 1, rad * 2 + 1))
    dilated = cv2.dilate(mask, kernel, iterations=1)
    ring_zone = cv2.subtract(dilated, mask)

    if not np.any(ring_zone):
        return mask.copy()

    gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(gray, 60, 160)
    edges_dilated = cv2.dilate(edges, np.ones((3, 3), dtype=np.uint8))

    smart_extension = cv2.bitwise_and(ring_zone, edges_dilated)
    combined_mask = cv2.bitwise_or(mask, smart_extension)
    return cv2.dilate(combined_mask, np.ones((3, 3), dtype=np.uint8))


def apply_feather_blend(
    repaired_rgb: np.ndarray,
    original_rgb: np.ndarray,
    mask: np.ndarray,
    blur_kernel: tuple[int, int] = (5, 5),
) -> np.ndarray:
    """Performs soft alpha blending at mask boundaries to eliminate visible seam artifacts."""
    if not np.any(mask):
        return original_rgb.copy()

    kx, ky = blur_kernel
    if kx % 2 == 0:
        kx += 1
    if ky % 2 == 0:
        ky += 1

    feathered_alpha = cv2.GaussianBlur(
        mask.astype(np.float32) / 255.0, (kx, ky), 0
    )[..., None]

    composited = (
        repaired_rgb.astype(np.float32) * feathered_alpha
        + original_rgb.astype(np.float32) * (1.0 - feathered_alpha)
    )
    return np.clip(composited, 0, 255).astype(np.uint8)
