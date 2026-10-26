from __future__ import annotations

import sys
from pathlib import Path

# Ensure ocr-service root is in sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import cv2
import numpy as np

from app.bubble_contour import extract_bubble_profiles


def test_extract_bubble_profiles_single_oval_balloon():
    # 200x200 black background with a white filled ellipse in the center (100, 100)
    image_bgr = np.zeros((200, 200, 3), dtype=np.uint8)
    cv2.ellipse(image_bgr, (100, 100), (60, 40), 0, 0, 360, (255, 255, 255), -1)

    # OCR text box at the center of the balloon
    ocr_boxes = [(80, 90, 40, 20)]

    profiles = extract_bubble_profiles(image_bgr, ocr_boxes, padding_ratio=0.1, num_slices=20)

    assert len(profiles) == 1
    p = profiles[0]
    assert p.text_box_id == 0
    # Safe bounding box should encompass the center
    bx, by, bw, bh = p.bbox
    assert bx <= 80 and (bx + bw) >= 120
    assert by <= 90 and (by + bh) >= 110

    # Scanline ratios: middle slices should be wider than top and bottom slices
    assert len(p.scanline_ratios) == 20
    mid_ratio = p.scanline_ratios[10]
    top_ratio = p.scanline_ratios[1]
    bot_ratio = p.scanline_ratios[18]
    assert mid_ratio > top_ratio
    assert mid_ratio > bot_ratio

    # Polygon should have valid vertices
    assert len(p.polygon) >= 4


def test_extract_bubble_profiles_dual_bubble_bisector():
    # 300x200 canvas with two overlapping white balloons (merged into one component)
    image_bgr = np.zeros((200, 300, 3), dtype=np.uint8)
    cv2.circle(image_bgr, (90, 100), 50, (255, 255, 255), -1)
    cv2.circle(image_bgr, (210, 100), 50, (255, 255, 255), -1)

    # Two text boxes in the two respective sub-balloons
    ocr_boxes = [
        (75, 90, 30, 20),   # Left balloon
        (195, 90, 30, 20),  # Right balloon
    ]

    profiles = extract_bubble_profiles(image_bgr, ocr_boxes, padding_ratio=0.1, num_slices=20)

    assert len(profiles) == 2
    p_left = profiles[0]
    p_right = profiles[1]

    # The bisector must ensure the left profile's bbox stays on the left half (X < 155)
    # and the right profile's bbox stays on the right half (X > 145)
    assert p_left.bbox[0] + p_left.bbox[2] <= 165
    assert p_right.bbox[0] >= 135


def test_extract_bubble_profiles_no_bubble_fallback():
    # Textured/dark background with no white balloon
    image_bgr = np.full((100, 100, 3), 40, dtype=np.uint8)
    ocr_boxes = [(30, 40, 40, 20)]

    profiles = extract_bubble_profiles(image_bgr, ocr_boxes)

    assert len(profiles) == 1
    p = profiles[0]
    # Falls back gracefully to original box with 1.0 ratios
    assert p.bbox == (30, 40, 40, 20)
    assert p.scanline_ratios == [1.0] * 20


if __name__ == "__main__":
    test_extract_bubble_profiles_single_oval_balloon()
    test_extract_bubble_profiles_dual_bubble_bisector()
    test_extract_bubble_profiles_no_bubble_fallback()
    print("ALL TESTS PASSED")
