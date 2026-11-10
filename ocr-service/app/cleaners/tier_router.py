from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from time import perf_counter

import cv2
import numpy as np

from app.cleaners.base import Cleaner
from app.cleaners.flat import FlatCleaner, GradientCleaner
from app.detector import RgbImage
from app.mask_refiner import BinaryMask, MaskRegion
from app.region_router import route_region
from app.schemas import CleanerRoute


class InpaintTier(StrEnum):
    TIER_1_SOLID = "tier_1_solid"
    TIER_2_ALGORITHMIC = "tier_2_algorithmic"
    TIER_3_NEURAL = "tier_3_neural"


@dataclass(frozen=True)
class TierDiagnostics:
    tier: InpaintTier
    cleaner_name: str
    elapsed_ms: float
    has_dominant_bg_color: bool
    dominant_color_bgr: tuple[int, int, int] | None = None
    route: CleanerRoute | None = None


class TieredInpainter:
    """
    3-Tier Multi-Tier Inpainter per SuperK Architectural Blueprint Section 3.1 & 5.1.

    Tier 1 (Solid Color):
        has_dominant_bg_color == True / FlatCleaner (< 2ms, zero GPU cost).
        Uses perimeter ring sampling to detect solid speech balloons and fills
        with median dominant color.

    Tier 2 (Fast Algorithmic):
        Gradient / smooth transition / simple texture -> GradientCleaner (10-50ms CPU).
        Uses localized region crop with Telea Fast Marching and Navier-Stokes
        inpainting, minimizing boundary Laplacian gradient error.

    Tier 3 (Neural Inpainting):
        Complex line-art / high variance / detailed artwork -> LamaLargeCleaner / AOT (200-800ms).
        Uses localized dirty-rect context cropping with margin buffer.
    """

    def __init__(
        self,
        tier1_cleaner: Cleaner | None = None,
        tier2_cleaner: Cleaner | None = None,
        tier3_cleaner: Cleaner | None = None,
        solid_std_threshold: float = 8.5,
    ) -> None:
        self.tier1_cleaner = tier1_cleaner or FlatCleaner()
        self.tier2_cleaner = tier2_cleaner or GradientCleaner()
        self.tier3_cleaner = tier3_cleaner
        self.solid_std_threshold = solid_std_threshold

    def classify_tier(
        self,
        image_rgb: RgbImage,
        mask: BinaryMask,
        region: MaskRegion,
    ) -> tuple[InpaintTier, CleanerRoute, bool, tuple[int, int, int] | None]:
        """Classify a region into one of the 3 inpainting tiers."""
        rect = region.rect
        ys = slice(max(0, rect.y - 12), min(image_rgb.shape[0], rect.y + rect.height + 12))
        xs = slice(max(0, rect.x - 12), min(image_rgb.shape[1], rect.x + rect.width + 12))
        crop_rgb = image_rgb[ys, xs]
        crop_mask = mask[ys, xs] > 0

        dominant_bgr: tuple[int, int, int] | None = None
        has_dominant_bg = False

        if np.any(crop_mask):
            k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
            dilated = cv2.dilate(crop_mask.astype(np.uint8), k) > 0
            ring = dilated & ~crop_mask
            ring_pixels = crop_rgb[ring]
            if len(ring_pixels) >= 8:
                channel_stds = np.std(ring_pixels.astype(np.float32), axis=0)
                max_std = float(np.max(channel_stds))
                if max_std < self.solid_std_threshold:
                    has_dominant_bg = True
                    med_rgb = np.median(ring_pixels, axis=0).astype(np.uint8)
                    dominant_bgr = (int(med_rgb[2]), int(med_rgb[1]), int(med_rgb[0]))

        cleaners_dict = {"lama-large": self.tier3_cleaner} if self.tier3_cleaner else None
        route_decision = route_region(image_rgb, mask, region, cleaners_dict)

        if has_dominant_bg or route_decision.route is CleanerRoute.FLAT:
            return InpaintTier.TIER_1_SOLID, CleanerRoute.FLAT, has_dominant_bg, dominant_bgr
        elif route_decision.route is CleanerRoute.GRADIENT:
            return InpaintTier.TIER_2_ALGORITHMIC, CleanerRoute.GRADIENT, False, None
        else:
            return InpaintTier.TIER_3_NEURAL, CleanerRoute.ARTWORK, False, None

    def clean(
        self,
        image_rgb: RgbImage,
        mask: BinaryMask,
        region: MaskRegion,
    ) -> RgbImage:
        repaired, _ = self.clean_with_diagnostics(image_rgb, mask, region)
        return repaired

    def clean_with_diagnostics(
        self,
        image_rgb: RgbImage,
        mask: BinaryMask,
        region: MaskRegion,
    ) -> tuple[RgbImage, TierDiagnostics]:
        t0 = perf_counter()
        tier, route, has_dominant_bg, dominant_bgr = self.classify_tier(image_rgb, mask, region)

        if tier is InpaintTier.TIER_1_SOLID:
            repaired = self.tier1_cleaner.clean(image_rgb, mask, region)
            cleaner_name = "flat"
        elif tier is InpaintTier.TIER_2_ALGORITHMIC:
            repaired = self.tier2_cleaner.clean(image_rgb, mask, region)
            cleaner_name = "gradient"
        else:
            if self.tier3_cleaner is not None:
                repaired = self.tier3_cleaner.clean(image_rgb, mask, region)
                cleaner_name = getattr(self.tier3_cleaner, "__class__", type(self.tier3_cleaner)).__name__
            else:
                repaired = self.tier2_cleaner.clean(image_rgb, mask, region)
                cleaner_name = "gradient_fallback"

        elapsed_ms = (perf_counter() - t0) * 1000.0
        diagnostics = TierDiagnostics(
            tier=tier,
            cleaner_name=cleaner_name,
            elapsed_ms=elapsed_ms,
            has_dominant_bg_color=has_dominant_bg,
            dominant_color_bgr=dominant_bgr,
            route=route,
        )
        return repaired, diagnostics
