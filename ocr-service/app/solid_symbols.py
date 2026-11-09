"""Peel solid non-text symbol blobs out of a dialogue region's ink mask.

The detection mask head reads every dark blob inside a speech balloon as text,
including hand-drawn symbols (music notes, hearts, stars). Erasing those is
irreversible artwork damage, so the pipeline peels components that look like
solid symbols into a protected layer instead of the eligible removal mask.

A component counts as a solid symbol only when it is chunky (large area, no
thin stroke side), mostly filled, and has no glyph counter (hole). Real glyph
strokes stay in the text mask through the min-side and hole rules.
"""

import cv2
import numpy as np

from app.mask_refiner import BinaryMask

SOLID_SYMBOL_MIN_AREA = 120
SOLID_SYMBOL_MIN_SIDE = 12
SOLID_SYMBOL_MIN_FILL = 0.72
SOLID_SYMBOL_MAX_HOLE_RATIO = 0.02
# A hand-drawn symbol is a minority of a text region's ink. A component that
# owns most of the ink is the region's actual text mask (or a rescue fill), so
# peeling is skipped to never hollow out the text being cleaned.
SOLID_SYMBOL_MAX_REGION_SHARE = 0.5


def _enclosed_hole_pixels(component: np.ndarray) -> int:
    """Count background pixels fully enclosed by the component inside its bbox."""
    inverted = (component == 0).astype(np.uint8)
    count, _labels, stats, _centroids = cv2.connectedComponentsWithStats(
        inverted,
        connectivity=4,
    )
    height, width = component.shape
    hole_pixels = 0
    for index in range(1, count):
        x, y, box_w, box_h, area = stats[index]
        touches_border = x == 0 or y == 0 or x + box_w >= width or y + box_h >= height
        if not touches_border:
            hole_pixels += area
    return hole_pixels


def peel_solid_symbols(
    region_mask: BinaryMask,
    keep_mask: BinaryMask | None = None,
) -> tuple[BinaryMask, BinaryMask]:
    """Split a region mask into (text_mask, symbol_mask), pixel-exact partition.

    Both returned masks use the same binary convention (255 = mask) as the
    input and always sum back to the original ink pixel for pixel. Pixels in
    ``keep_mask`` (rescue-recovered ink) are never treated as symbols, because
    a rescued low-coverage region can legitimately fill its whole zone.
    """
    ink = (region_mask > 0).astype(np.uint8)
    symbols = np.zeros_like(ink)
    ink_total = int(np.count_nonzero(ink))
    max_symbol_area = ink_total * SOLID_SYMBOL_MAX_REGION_SHARE
    count, labels, stats, _centroids = cv2.connectedComponentsWithStats(
        ink,
        connectivity=8,
    )
    for index in range(1, count):
        x, y, box_w, box_h, area = stats[index]
        if area < SOLID_SYMBOL_MIN_AREA:
            continue
        if area > max_symbol_area:
            continue
        if min(box_w, box_h) < SOLID_SYMBOL_MIN_SIDE:
            continue
        if area / float(box_w * box_h) < SOLID_SYMBOL_MIN_FILL:
            continue
        component = (labels[y : y + box_h, x : x + box_w] == index).astype(np.uint8)
        hole_ratio = _enclosed_hole_pixels(component) / float(box_w * box_h)
        if hole_ratio > SOLID_SYMBOL_MAX_HOLE_RATIO:
            continue
        symbols[labels == index] = 255
    if keep_mask is not None:
        symbols[(keep_mask > 0)] = 0
    text = ink.copy()
    text[symbols > 0] = 0
    return (text * 255).astype(np.uint8), symbols.astype(np.uint8)
