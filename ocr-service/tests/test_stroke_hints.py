from __future__ import annotations

import sys
from pathlib import Path

# Ensure ocr-service package root is in sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import cv2
import numpy as np

from app.cleaners.stroke_hints import apply_feather_blend, extend_mask_with_stroke_hints


def test_extend_mask_with_stroke_hints_expands_around_edges():
    # Create synthetic image with a high-contrast black line on white background
    img = np.full((100, 100, 3), 255, dtype=np.uint8)
    cv2.line(img, (20, 50), (80, 50), (0, 0, 0), thickness=3)

    # Initial mask covers only a small segment of the line
    mask = np.zeros((100, 100), dtype=np.uint8)
    mask[48:53, 40:60] = 255

    # Extend mask with stroke hints
    extended = extend_mask_with_stroke_hints(img, mask, dilation_px=6)

    # Extended mask should cover more than the initial mask along the edge
    assert np.count_nonzero(extended) > np.count_nonzero(mask)
    # The original mask should be a subset of the extended mask
    assert np.all((mask == 255) <= (extended == 255))


def test_extend_mask_with_stroke_hints_noop_on_blank():
    # Blank white image and empty mask
    img = np.full((50, 50, 3), 255, dtype=np.uint8)
    mask = np.zeros((50, 50), dtype=np.uint8)

    extended = extend_mask_with_stroke_hints(img, mask, dilation_px=4)
    assert np.count_nonzero(extended) == 0


def test_apply_feather_blend_smooths_seam():
    orig = np.full((60, 60, 3), 100, dtype=np.uint8)
    repaired = np.full((60, 60, 3), 200, dtype=np.uint8)

    mask = np.zeros((60, 60), dtype=np.uint8)
    mask[20:40, 20:40] = 255

    blended = apply_feather_blend(repaired, orig, mask, blur_kernel=(7, 7))

    # Center should be mostly repaired (~200)
    assert blended[30, 30, 0] > 180

    # Outside should be original (100)
    assert blended[5, 5, 0] == 100

    # Boundary pixels should be between 100 and 200 (smooth transition)
    edge_val = blended[20, 30, 0]
    assert 100 < edge_val < 200
