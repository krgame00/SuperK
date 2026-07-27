from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np
from numpy.typing import NDArray

from app.detector import DetectionResult, RgbImage
from app.schemas import PixelRect

BinaryMask = NDArray[np.uint8]


@dataclass(frozen=True)
class MaskRefinementConfig:
    threshold: float = 0.45
    minimum_component_area: int | None = None


@dataclass(frozen=True)
class MaskRegion:
    id: str
    rect: PixelRect
    component_ids: tuple[int, ...]
    stroke_radius: int


@dataclass(frozen=True)
class RefinedMask:
    mask: BinaryMask
    regions: list[MaskRegion]
    protected_edges: BinaryMask


def build_protected_edges(
    image_rgb: RgbImage,
    probability: NDArray[np.float32],
) -> BinaryMask:
    luminance = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(luminance, 80, 160)
    edges[probability >= 0.8] = 0
    return edges


def constrained_dilate(
    seed: BinaryMask,
    protected_edges: BinaryMask,
    radius: int,
) -> BinaryMask:
    grown = np.where(seed > 0, 255, 0).astype(np.uint8)
    blocked = protected_edges > 0
    kernel = np.ones((3, 3), dtype=np.uint8)
    for _ in range(max(0, radius)):
        next_mask = cv2.dilate(grown, kernel, iterations=1)
        next_mask[blocked] = 0
        grown = np.maximum(grown, next_mask)
    return grown


def refine_probability_mask(
    probability: NDArray[np.float32],
    protected_edges: BinaryMask,
    threshold: float = 0.45,
    minimum_component_area: int | None = None,
) -> RefinedMask:
    if probability.shape != protected_edges.shape:
        raise ValueError("probability and protected_edges must have the same shape")

    image_area = probability.shape[0] * probability.shape[1]
    minimum_area = minimum_component_area
    if minimum_area is None:
        minimum_area = max(6, round(image_area * 0.000002))

    seed = (probability >= threshold).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(
        seed,
        connectivity=8,
    )
    combined = np.zeros_like(seed, dtype=np.uint8)
    component_masks: dict[int, BinaryMask] = {}
    radii: dict[int, int] = {}
    for component_id in range(1, count):
        if int(stats[component_id, cv2.CC_STAT_AREA]) < minimum_area:
            continue
        component = np.where(labels == component_id, 255, 0).astype(np.uint8)
        radius = _estimate_stroke_radius(component)
        grown = constrained_dilate(component, protected_edges, radius)
        combined = np.maximum(combined, grown)
        component_masks[component_id] = grown
        radii[component_id] = radius

    regions = _group_regions(component_masks, radii)
    return RefinedMask(
        mask=combined,
        regions=regions,
        protected_edges=protected_edges.copy(),
    )


def refine_mask(
    image_rgb: RgbImage,
    detection: DetectionResult,
    config: MaskRefinementConfig | None = None,
) -> RefinedMask:
    active = config or MaskRefinementConfig()
    protected_edges = build_protected_edges(
        image_rgb,
        detection.mask_probability,
    )
    return refine_probability_mask(
        detection.mask_probability,
        protected_edges,
        threshold=active.threshold,
        minimum_component_area=active.minimum_component_area,
    )


def _estimate_stroke_radius(component: BinaryMask) -> int:
    distance = cv2.distanceTransform(component, cv2.DIST_L2, 3)
    positive = distance[distance > 0]
    if positive.size == 0:
        return 2
    half_stroke = float(np.percentile(positive, 75))
    return min(4, max(2, round(half_stroke)))


def _group_regions(
    component_masks: dict[int, BinaryMask],
    radii: dict[int, int],
) -> list[MaskRegion]:
    if not component_masks:
        return []

    component_ids = sorted(component_masks)
    rects = {
        component_id: _mask_rect(component_masks[component_id])
        for component_id in component_ids
    }
    median_height = float(np.median([rect.height for rect in rects.values()]))
    maximum_gap = max(1.0, 1.5 * median_height)
    parents = {component_id: component_id for component_id in component_ids}

    def find(component_id: int) -> int:
        while parents[component_id] != component_id:
            parents[component_id] = parents[parents[component_id]]
            component_id = parents[component_id]
        return component_id

    def union(left: int, right: int) -> None:
        left_root = find(left)
        right_root = find(right)
        if left_root != right_root:
            parents[right_root] = left_root

    for index, left_id in enumerate(component_ids):
        for right_id in component_ids[index + 1 :]:
            left = rects[left_id]
            right = rects[right_id]
            if _rect_distance(left, right) > maximum_gap:
                continue
            if _orientation(left) == _orientation(right):
                union(left_id, right_id)

    groups: dict[int, list[int]] = {}
    for component_id in component_ids:
        groups.setdefault(find(component_id), []).append(component_id)

    regions: list[MaskRegion] = []
    for index, group in enumerate(groups.values(), start=1):
        union_mask = np.zeros_like(next(iter(component_masks.values())))
        for component_id in group:
            union_mask = np.maximum(union_mask, component_masks[component_id])
        regions.append(
            MaskRegion(
                id=f"region-{index}",
                rect=_mask_rect(union_mask),
                component_ids=tuple(group),
                stroke_radius=max(radii[component_id] for component_id in group),
            ),
        )
    return regions


def _mask_rect(mask: BinaryMask) -> PixelRect:
    points = cv2.findNonZero(mask)
    if points is None:
        raise ValueError("cannot create a region from an empty mask")
    x, y, width, height = cv2.boundingRect(points)
    return PixelRect(x=x, y=y, width=width, height=height)


def _rect_distance(left: PixelRect, right: PixelRect) -> float:
    horizontal = max(
        left.x - (right.x + right.width),
        right.x - (left.x + left.width),
        0,
    )
    vertical = max(
        left.y - (right.y + right.height),
        right.y - (left.y + left.height),
        0,
    )
    return float(np.hypot(horizontal, vertical))


def _orientation(rect: PixelRect) -> str:
    if rect.height > rect.width * 1.25:
        return "vertical"
    if rect.width > rect.height * 1.25:
        return "horizontal"
    return "square"
