from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import cv2
import numpy as np
from numpy.typing import NDArray

from app.detector import RgbImage
from app.mask_refiner import MaskRegion
from app.schemas import PageRole

QrPolygon = NDArray[np.integer]


@dataclass(frozen=True)
class PageFeatures:
    line_art_density: float
    text_coverage: float
    margin_text_fraction: float
    horizontal_band_score: float
    qr_count: int


@dataclass(frozen=True)
class PageContext:
    role: PageRole
    confidence: float
    features: PageFeatures


def classify_page(
    image_rgb: RgbImage,
    regions: Sequence[MaskRegion],
    qr_polygons: Sequence[QrPolygon] = (),
) -> PageContext:
    features = extract_page_features(image_rgb, regions, qr_polygons)
    role, confidence = _classify_features(features, bool(regions))
    if confidence < 0.70:
        role = PageRole.UNKNOWN
    return PageContext(role=role, confidence=confidence, features=features)


def extract_page_features(
    image_rgb: RgbImage,
    regions: Sequence[MaskRegion],
    qr_polygons: Sequence[QrPolygon] = (),
) -> PageFeatures:
    if image_rgb.ndim != 3 or image_rgb.shape[2] != 3:
        raise ValueError(f"expected HxWx3 RGB image, got {image_rgb.shape}")

    height, width = image_rgb.shape[:2]
    area = height * width
    gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
    dark = gray < 210
    edges = cv2.Canny(gray, 80, 160)
    text_area = sum(
        region.rect.width * region.rect.height for region in regions
    )

    margin_y = max(1, round(height * 0.20))
    margin_x = max(1, round(width * 0.20))
    margin = np.zeros((height, width), dtype=bool)
    margin[:margin_y] = True
    margin[-margin_y:] = True
    margin[:, :margin_x] = True
    margin[:, -margin_x:] = True
    dark_count = int(np.count_nonzero(dark))
    margin_fraction = (
        float(np.count_nonzero(dark & margin)) / dark_count
        if dark_count
        else 0.0
    )
    row_coverage = np.count_nonzero(dark, axis=1) / max(width, 1)

    return PageFeatures(
        line_art_density=float(np.count_nonzero(edges)) / max(area, 1),
        text_coverage=min(1.0, text_area / max(area, 1)),
        margin_text_fraction=margin_fraction,
        horizontal_band_score=(
            float(np.percentile(row_coverage, 90))
            if row_coverage.size
            else 0.0
        ),
        qr_count=len(qr_polygons),
    )


def _classify_features(
    features: PageFeatures,
    has_text_regions: bool,
) -> tuple[PageRole, float]:
    if features.qr_count > 0 and features.margin_text_fraction >= 0.45:
        return PageRole.CREDITS, 0.95
    if (
        features.horizontal_band_score >= 0.98
        and features.text_coverage < 0.08
        and has_text_regions
    ):
        return PageRole.UI, 0.90
    if features.line_art_density >= 0.035 and has_text_regions:
        confidence = min(
            0.98,
            0.70 + (features.line_art_density - 0.035) * 4,
        )
        return PageRole.COMIC, confidence
    if (
        features.horizontal_band_score >= 0.72
        and features.text_coverage >= 0.08
    ):
        return PageRole.UI, 0.90
    return PageRole.UNKNOWN, 0.75
