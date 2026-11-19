from __future__ import annotations

import logging

import cv2
import numpy as np

from app.cleaners.base import Cleaner
from app.detector import RgbImage
from app.mask_refiner import BinaryMask, MaskRegion
from app.screentone import analyze_screentone
from app.screentone_synth import RING_RADIUS_PX, synthesize_screentone

logger = logging.getLogger(__name__)


def _region_context_crop(page: RgbImage, rect) -> RgbImage:
    margin = 12
    y0 = max(0, rect.y - margin)
    y1 = min(page.shape[0], rect.y + rect.height + margin)
    x0 = max(0, rect.x - margin)
    x1 = min(page.shape[1], rect.x + rect.width + margin)
    return page[y0:y1, x0:x1]


class ScreentoneCleaner(Cleaner):
    """
    Screentone-Aware Fast-Path Cleaner (WP-3.3).

    Analyzes 2D FFT periodic frequencies and synthesizes 2D cosine wave dot patterns
    in 18-45ms on CPU, avoiding slow LaMa / neural network execution on halftone screens.
    Falls back to a secondary cleaner (e.g. GradientCleaner or LamaLarge) if the region
    is not screentone or boundary ring is not available.
    """

    def __init__(self, fallback_cleaner: Cleaner | None = None) -> None:
        self.fallback = fallback_cleaner

    def clean(
        self,
        image_rgb: RgbImage,
        mask: BinaryMask,
        region: MaskRegion,
    ) -> RgbImage:
        crop_gray = cv2.cvtColor(
            _region_context_crop(image_rgb, region.rect),
            cv2.COLOR_RGB2GRAY,
        )
        analysis = analyze_screentone(crop_gray)
        if analysis.is_screentone and np.any(mask):
            kernel = cv2.getStructuringElement(
                cv2.MORPH_ELLIPSE,
                (2 * RING_RADIUS_PX + 1, 2 * RING_RADIUS_PX + 1),
            )
            inside = mask > 0
            ring = (cv2.dilate(mask.astype(np.uint8), kernel) > 0) & ~inside
            if np.any(ring):
                try:
                    return synthesize_screentone(image_rgb, mask, analysis)
                except Exception as exc:
                    logger.debug("Screentone synthesis failed, using fallback: %s", exc)

        if self.fallback is not None:
            return self.fallback.clean(image_rgb, mask, region)
        return image_rgb.copy()
