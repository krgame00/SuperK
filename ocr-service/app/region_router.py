from __future__ import annotations

import cv2
import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, Field

from app.detector import RgbImage
from app.mask_refiner import BinaryMask, MaskRegion
from app.schemas import CleanerRoute


class RegionFeatures(BaseModel):
    lab_variance: float = Field(ge=0)
    edge_density: float = Field(ge=0, le=1)
    entropy: float = Field(ge=0)
    gradient_coherence: float = Field(ge=0, le=1)
    line_art_fraction: float = Field(ge=0, le=1)


class RouteDecision(BaseModel):
    route: CleanerRoute
    confidence: float = Field(ge=0, le=1)
    features: RegionFeatures


def route_region(
    image_rgb: RgbImage,
    mask: BinaryMask,
    region: MaskRegion,
) -> RouteDecision:
    features = extract_region_features(image_rgb, mask, region)
    if features.lab_variance < 18 and features.edge_density < 0.08:
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
    )


def extract_region_features(
    image_rgb: RgbImage,
    mask: BinaryMask,
    region: MaskRegion,
) -> RegionFeatures:
    support = _region_support(mask, region)
    ring = _ring(support, radius=8)
    if not np.any(ring):
        ring = ~support
    pixels = image_rgb[ring]
    if pixels.size == 0:
        pixels = image_rgb.reshape(-1, 3)

    lab_pixels = cv2.cvtColor(
        pixels.reshape(-1, 1, 3),
        cv2.COLOR_RGB2LAB,
    ).reshape(-1, 3)
    center = np.median(lab_pixels.astype(np.float32), axis=0)
    lab_variance = float(
        np.mean(np.linalg.norm(lab_pixels.astype(np.float32) - center, axis=1)),
    )

    gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
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
    return RegionFeatures(
        lab_variance=lab_variance,
        edge_density=edge_density,
        entropy=entropy,
        gradient_coherence=min(1.0, gradient_coherence),
        line_art_fraction=line_art_fraction,
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
