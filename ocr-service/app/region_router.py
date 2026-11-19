from __future__ import annotations

import cv2
import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, Field

from app.detector import RgbImage
from app.mask_refiner import BinaryMask, MaskRegion
from app.schemas import CleanerRoute, PixelRect
from app.screentone import analyze_screentone


class RegionFeatures(BaseModel):
    lab_variance: float = Field(ge=0)
    edge_density: float = Field(ge=0, le=1)
    entropy: float = Field(ge=0)
    gradient_coherence: float = Field(ge=0, le=1)
    line_art_fraction: float = Field(ge=0, le=1)
    is_screentone: bool = False
    screentone_sigma: float = 0.0


class RouteDecision(BaseModel):
    route: CleanerRoute
    confidence: float = Field(ge=0, le=1)
    features: RegionFeatures
    preferred_cleaner: str | None = None


def route_region(
    image_rgb: RgbImage,
    mask: BinaryMask,
    region: MaskRegion,
    cleaners: dict | None = None,
) -> RouteDecision:
    features = extract_region_features(image_rgb, mask, region)

    # WP-3.3: Screentone-Aware 2D FFT Fast-Path
    # If the region is confirmed halftone screentone and a fast-path cleaner is available,
    # route to procedural screentone synthesis instead of heavy LaMa neural network.
    use_screentone = (
        cleaners is not None
        and features.is_screentone
        and any(k in cleaners for k in ("screentone", "screentone_fast", "tiered", "hybrid"))
    )

    # Complex backgrounds (high variance + high edge density) -> LAMA large
    # (if available in cleaners dict)
    use_lama = (
        cleaners is not None
        and "lama-large" in cleaners
        and features.lab_variance > 45
        and features.edge_density > 0.25
    )
    preferred_cleaner = None
    if use_screentone:
        route = CleanerRoute.ARTWORK
        confidence = 0.95
        if "screentone" in cleaners:
            preferred_cleaner = "screentone"
        elif "screentone_fast" in cleaners:
            preferred_cleaner = "screentone_fast"
        elif "tiered" in cleaners:
            preferred_cleaner = "tiered"
        else:
            preferred_cleaner = "hybrid"
    elif use_lama:
        route = CleanerRoute.ARTWORK
        confidence = 0.9
        preferred_cleaner = "lama-large"
    elif features.lab_variance < 18 and features.edge_density < 0.08:
        route = CleanerRoute.FLAT
        boundary_distance = max(
            features.lab_variance / 18,
            features.edge_density / 0.08,
        )
        confidence = 1 - boundary_distance
    elif (
        features.lab_variance < 45
        and features.edge_density < 0.18
        and features.gradient_coherence >= 0.55
    ):
        route = CleanerRoute.GRADIENT
        boundary_distance = max(
            features.lab_variance / 45,
            features.edge_density / 0.18,
            1 - features.gradient_coherence,
        )
        confidence = 1 - boundary_distance
    else:
        route = CleanerRoute.ARTWORK
        complexity = max(
            features.lab_variance / 45,
            features.edge_density / 0.18,
            features.entropy / 8,
        )
        confidence = min(1.0, max(0.5, complexity))
    return RouteDecision(
        route=route,
        confidence=float(np.clip(confidence, 0, 1)),
        features=features,
        preferred_cleaner=preferred_cleaner,
    )


def extract_region_features(
    image_rgb: RgbImage,
    mask: BinaryMask,
    region: MaskRegion,
) -> RegionFeatures:
    h, w = mask.shape[:2]
    rect = region.rect
    pad = 12
    y0 = max(0, rect.y - pad)
    x0 = max(0, rect.x - pad)
    y1 = min(h, rect.y + rect.height + pad)
    x1 = min(w, rect.x + rect.width + pad)

    crop_rgb = image_rgb[y0:y1, x0:x1]
    crop_mask = mask[y0:y1, x0:x1]
    from app.schemas import PixelRect
    local_region = MaskRegion(
        id=region.id,
        rect=PixelRect(
            x=max(0, rect.x - x0),
            y=max(0, rect.y - y0),
            width=max(1, min(x1 - x0, rect.width)),
            height=max(1, min(y1 - y0, rect.height)),
        ),
        component_ids=region.component_ids,
        stroke_radius=region.stroke_radius,
    )
    support = _region_support(crop_mask, local_region)
    ring = _ring(support, radius=8)
    if not np.any(ring):
        ring = ~support
    pixels = crop_rgb[ring]
    if pixels.size == 0:
        pixels = crop_rgb.reshape(-1, 3)

    lab_pixels = cv2.cvtColor(
        pixels.reshape(-1, 1, 3),
        cv2.COLOR_RGB2LAB,
    ).reshape(-1, 3)
    center = np.median(lab_pixels.astype(np.float32), axis=0)
    lab_variance = float(
        np.mean(np.linalg.norm(lab_pixels.astype(np.float32) - center, axis=1)),
    )

    gray = cv2.cvtColor(crop_rgb, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(gray, 80, 160) > 0
    edge_density = float(np.mean(edges[ring])) if np.any(ring) else 0.0
    entropy = _entropy(gray[ring])

    gradient_x = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gradient_y = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    gx = gradient_x[ring]
    gy = gradient_y[ring]
    magnitude = np.hypot(gx, gy)
    total_magnitude = float(magnitude.sum())
    if total_magnitude <= 1e-6:
        gradient_coherence = 0.0
    else:
        gradient_coherence = float(
            np.hypot(float(gx.sum()), float(gy.sum())) / total_magnitude,
        )
    line_art_fraction = float(np.mean((gray[ring] < 80) | edges[ring]))

    is_screentone = False
    screentone_sigma = 0.0
    if lab_variance > 25.0 or edge_density > 0.15:
        try:
            analysis = analyze_screentone(gray)
            is_screentone = bool(analysis.is_screentone)
            screentone_sigma = float(analysis.sigma_patch)
        except Exception:
            pass

    return RegionFeatures(
        lab_variance=lab_variance,
        edge_density=edge_density,
        entropy=entropy,
        gradient_coherence=min(1.0, gradient_coherence),
        line_art_fraction=line_art_fraction,
        is_screentone=is_screentone,
        screentone_sigma=screentone_sigma,
    )


def _region_support(mask: BinaryMask, region: MaskRegion) -> NDArray[np.bool_]:
    support = np.zeros(mask.shape, dtype=bool)
    rect = region.rect
    area = mask[
        rect.y : rect.y + rect.height,
        rect.x : rect.x + rect.width,
    ]
    support[
        rect.y : rect.y + rect.height,
        rect.x : rect.x + rect.width,
    ] = area > 0
    return support


def _ring(support: NDArray[np.bool_], radius: int) -> NDArray[np.bool_]:
    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE,
        (radius * 2 + 1, radius * 2 + 1),
    )
    dilated = cv2.dilate(support.astype(np.uint8), kernel) > 0
    return dilated & ~support


def _entropy(values: NDArray[np.uint8]) -> float:
    if values.size == 0:
        return 0.0
    counts = np.bincount(values, minlength=256)
    probabilities = counts[counts > 0] / values.size
    return float(-(probabilities * np.log2(probabilities)).sum())


def merge_adjacent_regions(
    regions: list[MaskRegion],
    max_gap: int = 48,
    max_dimension: int = 768,
) -> list[MaskRegion]:
    """
    Merge adjacent Tier-3 / artwork bounding boxes before running neural cleaners (WP-4.2).

    Merges bounding boxes closer than max_gap (48px) whose combined union size does not
    exceed max_dimension (768x768px), reducing neural inpainting calls by 30-45%.
    """
    if len(regions) <= 1:
        return list(regions)

    unmerged = list(regions)
    changed = True

    while changed:
        changed = False
        merged: list[MaskRegion] = []
        skip_indices: set[int] = set()

        for i in range(len(unmerged)):
            if i in skip_indices:
                continue
            r1 = unmerged[i]
            rect1 = r1.rect
            merged_r = r1

            for j in range(i + 1, len(unmerged)):
                if j in skip_indices:
                    continue
                r2 = unmerged[j]
                rect2 = r2.rect

                # Chebyshev / Euclidean gap between the two bounding boxes
                gap_x = max(0, max(rect1.x, rect2.x) - min(rect1.x + rect1.width, rect2.x + rect2.width))
                gap_y = max(0, max(rect1.y, rect2.y) - min(rect1.y + rect1.height, rect2.y + rect2.height))

                if gap_x <= max_gap and gap_y <= max_gap:
                    union_x0 = min(rect1.x, rect2.x)
                    union_y0 = min(rect1.y, rect2.y)
                    union_x1 = max(rect1.x + rect1.width, rect2.x + rect2.width)
                    union_y1 = max(rect1.y + rect1.height, rect2.y + rect2.height)
                    union_w = union_x1 - union_x0
                    union_h = union_y1 - union_y0

                    if union_w <= max_dimension and union_h <= max_dimension:
                        # Combine into merged region
                        combined_components = tuple(sorted(set(merged_r.component_ids + r2.component_ids)))
                        merged_r = MaskRegion(
                            id=f"{merged_r.id}+{r2.id}",
                            rect=PixelRect(x=union_x0, y=union_y0, width=union_w, height=union_h),
                            component_ids=combined_components,
                            stroke_radius=max(merged_r.stroke_radius, r2.stroke_radius),
                            text_supported=merged_r.text_supported or r2.text_supported,
                        )
                        rect1 = merged_r.rect
                        skip_indices.add(j)
                        changed = True

            merged.append(merged_r)
        unmerged = merged

    return unmerged
