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
    threshold: float = 0.35
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
    envelope: BinaryMask | None = None


def build_protected_edges(
    image_rgb: RgbImage,
    probability: NDArray[np.float32],
    edge_lock_threshold: float = 0.20,
) -> BinaryMask:
    luminance = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(luminance, 80, 160)
    text_zone = (probability >= edge_lock_threshold).astype(np.uint8)
    if np.any(text_zone):
        text_zone = cv2.dilate(text_zone, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
        edges[text_zone > 0] = 0
    else:
        edges[probability >= edge_lock_threshold] = 0
    return edges


def constrained_dilate(
    seed: BinaryMask,
    protected_edges: BinaryMask,
    radius: int,
) -> BinaryMask:
    grown = np.where(seed > 0, 255, 0).astype(np.uint8)
    blocked = protected_edges > 0
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    for _ in range(max(0, radius)):
        next_mask = cv2.dilate(grown, kernel, iterations=1)
        next_mask[blocked] = 0
        grown = np.maximum(grown, next_mask)
    return grown


def complete_glyph_mask(
    image_rgb: RgbImage,
    seed: BinaryMask,
    envelope: BinaryMask,
    protected_edges: BinaryMask,
) -> BinaryMask:
    """Completes text glyphs (fill and outline) as connected components inside the

    evidence envelope without expanding across protected artwork edges.
    """
    if np.count_nonzero(seed) == 0 or np.count_nonzero(envelope) == 0:
        return seed.copy()

    seed_bin = np.where(seed > 0, 255, 0).astype(np.uint8)
    seed_bin[envelope == 0] = 0
    if np.count_nonzero(seed_bin) == 0:
        return seed.copy()

    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(seed_bin, connectivity=8)
    if num_labels <= 1:
        return seed_bin

    completed = np.zeros_like(seed_bin)
    h_img, w_img = image_rgb.shape[:2]

    for comp_idx in range(1, num_labels):
        comp_mask = (labels == comp_idx).astype(np.uint8) * 255
        seed_area = int(stats[comp_idx, cv2.CC_STAT_AREA])
        bx = int(stats[comp_idx, cv2.CC_STAT_LEFT])
        by = int(stats[comp_idx, cv2.CC_STAT_TOP])
        bw = int(stats[comp_idx, cv2.CC_STAT_WIDTH])
        bh = int(stats[comp_idx, cv2.CC_STAT_HEIGHT])

        margin = max(4, min(12, int(max(bw, bh) * 0.4)))
        x1 = max(0, bx - margin)
        y1 = max(0, by - margin)
        x2 = min(w_img, bx + bw + margin)
        y2 = min(h_img, by + bh + margin)

        sub_img = image_rgb[y1:y2, x1:x2]
        sub_seed = comp_mask[y1:y2, x1:x2]
        sub_env = envelope[y1:y2, x1:x2]
        sub_prot = protected_edges[y1:y2, x1:x2]
        sub_valid = (sub_env > 0) & (sub_prot == 0)

        seed_pts = sub_img[sub_seed > 0]
        if seed_pts.size == 0:
            continue
        fill_median = np.median(seed_pts, axis=0)
        fill_std = np.std(seed_pts, axis=0)

        dist_to_seed = cv2.distanceTransform((255 - sub_seed).astype(np.uint8), cv2.DIST_L2, 3)

        bg_mask = (sub_env > 0) & (dist_to_seed >= max(3.0, margin - 1.5))
        if np.count_nonzero(bg_mask) < 5:
            bg_mask = (sub_env > 0) & (dist_to_seed >= 2.0)
        if np.count_nonzero(bg_mask) >= 5:
            bg_median = np.median(sub_img[bg_mask], axis=0)
        else:
            bg_median = np.median(sub_img[[0, -1], :], axis=(0, 1))

        dist_fill = np.linalg.norm(sub_img.astype(float) - fill_median, axis=2)
        dist_bg = np.linalg.norm(sub_img.astype(float) - bg_median, axis=2)

        fill_candidate = (dist_fill <= max(40.0, float(np.mean(fill_std) * 3.0 + 15.0))) & (dist_to_seed <= 4.0)
        outline_candidate = (dist_to_seed <= 4.5) & (dist_bg >= 14.0)

        candidate = (sub_seed > 0) | fill_candidate | outline_candidate
        candidate = candidate & sub_valid

        cand_u8 = candidate.astype(np.uint8) * 255
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        closed = cv2.morphologyEx(cand_u8, cv2.MORPH_CLOSE, kernel)

        h_cand, w_cand = closed.shape
        flood = closed.copy()
        flood_mask = np.zeros((h_cand + 2, w_cand + 2), dtype=np.uint8)
        cv2.floodFill(flood, flood_mask, (0, 0), 255)
        filled = closed | (255 - flood)
        filled = filled & (sub_valid.astype(np.uint8) * 255)

        n_cc, l_cc, s_cc, _ = cv2.connectedComponentsWithStats(filled, connectivity=8)
        sub_comp_out = np.zeros_like(filled)
        for c in range(1, n_cc):
            m = (l_cc == c).astype(np.uint8) * 255
            if np.any((m > 0) & (sub_seed > 0)):
                c_area = int(s_cc[c, cv2.CC_STAT_AREA])
                if c_area <= seed_area * 5.0 or seed_area < 20:
                    sub_comp_out = np.maximum(sub_comp_out, m)
                else:
                    sub_comp_out = np.maximum(sub_comp_out, sub_seed)

        sub_comp_out[sub_prot > 0] = 0
        completed[y1:y2, x1:x2] = np.maximum(completed[y1:y2, x1:x2], sub_comp_out)

    completed[protected_edges > 0] = 0
    return completed


def _refine_seed_mask(
    seed: BinaryMask,
    protected_edges: BinaryMask,
    minimum_component_area: int | None = None,
    envelope: BinaryMask | None = None,
) -> RefinedMask:
    if seed.shape != protected_edges.shape:
        raise ValueError("seed and protected_edges must have the same shape")

    image_area = seed.shape[0] * seed.shape[1]
    minimum_area = minimum_component_area
    if minimum_area is None:
        minimum_area = max(6, round(image_area * 0.000002))

    seed_bin = np.where(seed > 0, 255, 0).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(
        seed_bin,
        connectivity=8,
    )
    combined = np.zeros_like(seed_bin, dtype=np.uint8)
    component_masks: dict[int, BinaryMask] = {}
    radii: dict[int, int] = {}
    for component_id in range(1, count):
        if int(stats[component_id, cv2.CC_STAT_AREA]) < minimum_area:
            continue
        component = np.where(labels == component_id, 255, 0).astype(np.uint8)
        radius = _estimate_stroke_radius(component)
        # Spatial dilation after completion is strictly capped at 1 px
        dilation_radius = 1
        grown = constrained_dilate(component, protected_edges, dilation_radius)
        grown[protected_edges > 0] = 0
        grown = np.maximum(grown, component)
        combined = np.maximum(combined, grown)
        component_masks[component_id] = grown
        radii[component_id] = radius

    regions = _group_regions(component_masks, radii)
    return RefinedMask(
        mask=combined,
        regions=regions,
        protected_edges=protected_edges.copy(),
        envelope=envelope.copy() if envelope is not None else None,
    )


def refine_probability_mask(
    probability: NDArray[np.float32],
    protected_edges: BinaryMask,
    threshold: float = 0.35,
    minimum_component_area: int | None = None,
) -> RefinedMask:
    seed = (probability >= threshold).astype(np.uint8) * 255
    return _refine_seed_mask(
        seed,
        protected_edges,
        minimum_component_area=minimum_component_area,
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
    h, w = image_rgb.shape[:2]
    envelope = np.zeros((h, w), dtype=np.uint8)
    if detection.evidence_regions:
        for ev in detection.evidence_regions:
            if ev.polygon and len(ev.polygon) >= 3:
                pts = np.array(ev.polygon, dtype=np.int32).reshape((-1, 1, 2))
                cv2.fillPoly(envelope, [pts], 255)
            else:
                rect = ev.rect
                envelope[rect.y : rect.y + rect.height, rect.x : rect.x + rect.width] = 255
    elif detection.blocks:
        for b in detection.blocks:
            rect = b.rect
            envelope[rect.y : rect.y + rect.height, rect.x : rect.x + rect.width] = 255
    else:
        seed_raw = (detection.mask_probability >= active.threshold).astype(np.uint8) * 255
        envelope = cv2.dilate(seed_raw, cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9)))

    if np.any(envelope):
        envelope = cv2.dilate(envelope, cv2.getStructuringElement(cv2.MORPH_RECT, (17, 17)))
        envelope[protected_edges > 0] = 0

    seed = (detection.mask_probability >= active.threshold).astype(np.uint8) * 255
    completed_seed = complete_glyph_mask(image_rgb, seed, envelope, protected_edges)

    return _refine_seed_mask(
        completed_seed,
        protected_edges,
        minimum_component_area=active.minimum_component_area,
        envelope=envelope,
    )


def _estimate_stroke_radius(component: BinaryMask) -> int:
    distance = cv2.distanceTransform(component, cv2.DIST_L2, 3)
    positive = distance[distance > 0]
    if positive.size == 0:
        return 2
    half_stroke = float(np.percentile(positive, 75))
    return min(6, max(2, round(half_stroke)))


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
    mask_height, mask_width = next(iter(component_masks.values())).shape
    page_scale_floor = 0.02 * min(mask_height, mask_width)
    uncapped_gap = max(1.0, 1.5 * median_height, page_scale_floor)
    maximum_gap = min(uncapped_gap, 50.0)
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
