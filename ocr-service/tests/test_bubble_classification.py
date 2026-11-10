from __future__ import annotations

import sys
from pathlib import Path

# Ensure ocr-service root is in sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import cv2
import numpy as np

from app.bubble_contour import classify_bubble_contour, extract_bubble_profiles


def test_classify_oval_normal_bubble():
    # 200x200 canvas with a smooth ellipse
    canvas = np.zeros((200, 200), dtype=np.uint8)
    cv2.ellipse(canvas, (100, 100), (70, 45), 0, 0, 360, 255, -1)
    contours, _ = cv2.findContours(canvas, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    assert len(contours) == 1
    cnt = contours[0]

    cat, features = classify_bubble_contour(cnt)
    assert cat == "normal"
    assert features["q"] > 0.60
    assert features["defects"] <= 2
    assert 0.60 <= features["extent"] <= 0.88


def test_classify_narration_rectangle():
    # 200x200 canvas with a crisp rectangle
    canvas = np.zeros((200, 200), dtype=np.uint8)
    cv2.rectangle(canvas, (30, 40), (170, 160), 255, -1)
    contours, _ = cv2.findContours(canvas, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    assert len(contours) == 1
    cnt = contours[0]

    cat, features = classify_bubble_contour(cnt)
    assert cat == "narration"
    assert features["extent"] >= 0.85
    assert features["defects"] == 0


def test_classify_shouting_starburst():
    # 200x200 canvas with a 10-point starburst (jagged spikes)
    canvas = np.zeros((200, 200), dtype=np.uint8)
    center = (100, 100)
    pts = []
    num_spikes = 12
    for i in range(num_spikes * 2):
        angle = i * np.pi / num_spikes
        r = 75 if i % 2 == 0 else 30
        px = int(center[0] + r * np.cos(angle))
        py = int(center[1] + r * np.sin(angle))
        pts.append([px, py])
    poly = np.array(pts, dtype=np.int32)
    cv2.fillPoly(canvas, [poly], 255)

    contours, _ = cv2.findContours(canvas, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    assert len(contours) == 1
    cnt = contours[0]

    cat, features = classify_bubble_contour(cnt)
    assert cat == "shouting"
    assert features["defects"] >= 5
    assert features["q"] < 0.55


def test_classify_thought_cloud():
    # 200x200 canvas with overlapping circles forming a cloud with 4-5 lobes
    canvas = np.zeros((200, 200), dtype=np.uint8)
    lobes = [
        (80, 80, 30),
        (120, 80, 30),
        (135, 115, 28),
        (100, 125, 32),
        (65, 115, 28),
    ]
    for lx, ly, lr in lobes:
        cv2.circle(canvas, (lx, ly), lr, 255, -1)

    contours, _ = cv2.findContours(canvas, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    assert len(contours) == 1
    cnt = contours[0]

    cat, features = classify_bubble_contour(cnt)
    assert cat == "thought"
    assert 3 <= features["defects"] <= 6


def test_extract_bubble_profiles_includes_category():
    # Integration test with extract_bubble_profiles on 300x300 image
    image_bgr = np.zeros((300, 300, 3), dtype=np.uint8)
    cv2.rectangle(image_bgr, (50, 50, 200, 150), (255, 255, 255), -1)
    ocr_boxes = [(70, 70, 80, 40)]

    profiles = extract_bubble_profiles(image_bgr, ocr_boxes)
    assert len(profiles) == 1
    p = profiles[0]
    assert p.category == "narration"
    assert "q" in p.shape_features
    assert "extent" in p.shape_features
    assert "defects" in p.shape_features
