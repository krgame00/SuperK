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
from app.schemas import CleanerRoute, PixelRect
from app.screentone import analyze_screentone
from app.screentone_synth import RING_RADIUS_PX, synthesize_screentone


class InpaintTier(StrEnum):
    TIER_1_SOLID = "tier_1_solid"
    TIER_2_ALGORITHMIC = "tier_2_algorithmic"
    TIER_3_NEURAL = "tier_3_neural"


# Shared context margin around a region rect used by the tier decision and the
# screentone gate, so both read the exact same neighborhood.
CONTEXT_MARGIN_PX = 12


def _region_context_crop(page: RgbImage, rect: PixelRect) -> RgbImage:
    ys = slice(max(0, rect.y - CONTEXT_MARGIN_PX), min(page.shape[0], rect.y + rect.height + CONTEXT_MARGIN_PX))
    xs = slice(max(0, rect.x - CONTEXT_MARGIN_PX), min(page.shape[1], rect.x + rect.width + CONTEXT_MARGIN_PX))
    return page[ys, xs]


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

    Tier 3 regions confirmed as halftone screentone are repaired by a procedural
    fast path ("screentone_fast") instead of the neural cleaner; the tier label
    stays TIER_3_NEURAL.
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
        crop_rgb = _region_context_crop(image_rgb, rect)
        crop_mask = _region_context_crop(mask, rect) > 0

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

    def _screentone_fast_repair(
        self,
        image_rgb: RgbImage,
        mask: BinaryMask,
        region: MaskRegion,
    ) -> RgbImage | None:
        """Procedural repair for a Tier 3 region sitting on confirmed halftone dots.

        Runs strictly after the tier decision, so it can only ever steal the
        repair step, never re-route. Returns None when the gate declines and the
        caller must use the original Tier 3 path unchanged.
        """
        crop_gray = cv2.cvtColor(_region_context_crop(image_rgb, region.rect), cv2.COLOR_RGB2GRAY)
        analysis = analyze_screentone(crop_gray)
        if not analysis.is_screentone:
            return None
        inside = mask > 0
        if not inside.any():
            return None
        # Precondition mirror of synthesize_screentone (same ring constant): a
        # mask flush to the page edge has no ring to align phase against. That
        # geometry is legitimate, so fall through to Tier 3 instead of failing
        # the page; every other synth error is a bug and still propagates.
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * RING_RADIUS_PX + 1,) * 2)
        ring = (cv2.dilate(mask, kernel) > 0) & ~inside
        if not ring.any():
            return None
        return synthesize_screentone(image_rgb, mask, analysis)

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
            fast_repair = self._screentone_fast_repair(image_rgb, mask, region)
            if fast_repair is not None:
                # Tier stays TIER_3_NEURAL: the region class was already decided
                # as artwork; the fast path only replaces who does the repair.
                repaired = fast_repair
                cleaner_name = "screentone_fast"
            elif self.tier3_cleaner is not None:
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
