from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np

from app.mask_refiner import BinaryMask, MaskRegion
from app.schemas import PixelRect

ScopeMode = Literal["none", "roi", "full-page"]


@dataclass(frozen=True)
class RoiCluster:
    rect: PixelRect
    region_ids: tuple[str, ...]


@dataclass(frozen=True)
class AdaptiveScopeDecision:
    mode: ScopeMode
    mask_coverage: float
    spatial_spread: float
    cluster_count: int
    roi_area_ratio: float
    clusters: tuple[RoiCluster, ...]


@dataclass(frozen=True)
class AdaptiveScopePolicy:
    max_mask_coverage: float = 0.18
    max_spatial_spread: float = 0.72
    max_clusters: int = 6
    max_roi_area_ratio: float = 0.58
    merge_gap_ratio: float = 0.035
    context_ratio: float = 0.08
    minimum_context_px: int = 96


def decide_adaptive_scope(
    eligible_mask: BinaryMask,
    regions: list[MaskRegion],
    *,
    policy: AdaptiveScopePolicy = AdaptiveScopePolicy(),
) -> AdaptiveScopeDecision:
    height, width = eligible_mask.shape
    page_area = max(1, width * height)
    active = eligible_mask > 0
    active_pixels = int(np.count_nonzero(active))
    if active_pixels == 0:
        return AdaptiveScopeDecision("none", 0.0, 0.0, 0, 0.0, ())

    active_regions = [region for region in regions if _region_has_mask(eligible_mask, region)]
    if not active_regions:
        return AdaptiveScopeDecision(
            "full-page",
            active_pixels / page_area,
            1.0,
            0,
            1.0,
            (),
        )

    clusters = _cluster_regions(active_regions, width, height, policy)
    padded = tuple(
        RoiCluster(
            rect=_pad_rect(cluster.rect, width, height, policy),
            region_ids=cluster.region_ids,
        )
        for cluster in clusters
    )
    roi_area_ratio = _union_area_ratio([cluster.rect for cluster in padded], width, height)
    spread = _spread_ratio(active_regions, width, height)
    mask_coverage = active_pixels / page_area

    should_use_roi = (
        mask_coverage <= policy.max_mask_coverage
        and spread <= policy.max_spatial_spread
        and len(padded) <= policy.max_clusters
        and roi_area_ratio <= policy.max_roi_area_ratio
    )
    return AdaptiveScopeDecision(
        "roi" if should_use_roi else "full-page",
        mask_coverage,
        spread,
        len(padded),
        roi_area_ratio,
        padded,
    )


def expanded_cluster(cluster: RoiCluster, width: int, height: int) -> RoiCluster:
    extra = max(64, round(max(cluster.rect.width, cluster.rect.height) * 0.35))
    x0 = max(0, cluster.rect.x - extra)
    y0 = max(0, cluster.rect.y - extra)
    x1 = min(width, cluster.rect.x + cluster.rect.width + extra)
    y1 = min(height, cluster.rect.y + cluster.rect.height + extra)
    return RoiCluster(
        rect=PixelRect(x=x0, y=y0, width=max(1, x1 - x0), height=max(1, y1 - y0)),
        region_ids=cluster.region_ids,
    )


def cluster_mask(mask: BinaryMask, cluster: RoiCluster) -> BinaryMask:
    result = np.zeros_like(mask)
    rect = cluster.rect
    result[
        rect.y : rect.y + rect.height,
        rect.x : rect.x + rect.width,
    ] = mask[
        rect.y : rect.y + rect.height,
        rect.x : rect.x + rect.width,
    ]
    return result


def cluster_region(cluster: RoiCluster, index: int) -> MaskRegion:
    return MaskRegion(
        id=f"adaptive-roi-{index}",
        rect=cluster.rect,
        component_ids=(),
        stroke_radius=1,
    )


def _region_has_mask(mask: BinaryMask, region: MaskRegion) -> bool:
    rect = region.rect
    return bool(
        np.any(
            mask[
                rect.y : rect.y + rect.height,
                rect.x : rect.x + rect.width,
            ]
        )
    )


def _cluster_regions(
    regions: list[MaskRegion],
    width: int,
    height: int,
    policy: AdaptiveScopePolicy,
) -> tuple[RoiCluster, ...]:
    gap = max(8, round(max(width, height) * policy.merge_gap_ratio))
    clusters: list[RoiCluster] = [
        RoiCluster(region.rect, (region.id,)) for region in regions
    ]
    changed = True
    while changed:
        changed = False
        merged: list[RoiCluster] = []
        while clusters:
            current = clusters.pop(0)
            index = next(
                (
                    i
                    for i, other in enumerate(clusters)
                    if _rects_near(current.rect, other.rect, gap)
                ),
                None,
            )
            if index is None:
                merged.append(current)
                continue
            other = clusters.pop(index)
            clusters.insert(
                0,
                RoiCluster(
                    rect=_union_rect(current.rect, other.rect),
                    region_ids=tuple(dict.fromkeys(current.region_ids + other.region_ids)),
                ),
            )
            changed = True
        clusters = merged
    return tuple(clusters)


def _pad_rect(
    rect: PixelRect,
    width: int,
    height: int,
    policy: AdaptiveScopePolicy,
) -> PixelRect:
    context = max(
        policy.minimum_context_px,
        round(max(width, height) * policy.context_ratio),
    )
    x0 = max(0, rect.x - context)
    y0 = max(0, rect.y - context)
    x1 = min(width, rect.x + rect.width + context)
    y1 = min(height, rect.y + rect.height + context)
    return PixelRect(x=x0, y=y0, width=max(1, x1 - x0), height=max(1, y1 - y0))


def _spread_ratio(regions: list[MaskRegion], width: int, height: int) -> float:
    union = regions[0].rect
    for region in regions[1:]:
        union = _union_rect(union, region.rect)
    return (union.width * union.height) / max(1, width * height)


def _union_area_ratio(rects: list[PixelRect], width: int, height: int) -> float:
    if not rects:
        return 0.0
    mask = np.zeros((height, width), np.uint8)
    for rect in rects:
        mask[rect.y : rect.y + rect.height, rect.x : rect.x + rect.width] = 1
    return float(np.count_nonzero(mask)) / max(1, width * height)


def _rects_near(a: PixelRect, b: PixelRect, gap: int) -> bool:
    return not (
        a.x + a.width + gap < b.x
        or b.x + b.width + gap < a.x
        or a.y + a.height + gap < b.y
        or b.y + b.height + gap < a.y
    )


def _union_rect(a: PixelRect, b: PixelRect) -> PixelRect:
    x0 = min(a.x, b.x)
    y0 = min(a.y, b.y)
    x1 = max(a.x + a.width, b.x + b.width)
    y1 = max(a.y + a.height, b.y + b.height)
    return PixelRect(x=x0, y=y0, width=x1 - x0, height=y1 - y0)
