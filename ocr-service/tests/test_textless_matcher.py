import cv2
import numpy as np

from app.detector import DetectionResult, DetectedBlock, LetterboxTransform
from app.schemas import PixelRect
from app.textless_matcher import (
    compute_visual_similarity,
    evaluate_textless_pair,
    scale_image_to_match,
)


class _StubDetector:
    """Deterministic detector: detects dark text strokes inside the center box."""

    def detect(self, image_rgb: np.ndarray) -> DetectionResult:
        h, w = image_rgb.shape[:2]
        gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
        roi = gray[int(h * 0.1) : int(h * 0.25), int(w * 0.2) : int(w * 0.5)]
        has_dark_text = int(np.count_nonzero(roi < 40)) > 15
        prob = np.zeros((h, w), dtype=np.float32)
        blocks = []
        if has_dark_text:
            prob[int(h * 0.12) : int(h * 0.22), int(w * 0.22) : int(w * 0.48)] = 0.9
            blocks.append(
                DetectedBlock(
                    rect=PixelRect(
                        x=int(w * 0.22),
                        y=int(h * 0.12),
                        width=int(w * 0.26),
                        height=int(h * 0.10),
                    ),
                    confidence=0.95,
                )
            )
        return DetectionResult(
            mask_probability=prob,
            blocks=blocks,
            scale=LetterboxTransform(
                source_width=w,
                source_height=h,
                input_size=960,
                scale=1.0,
                pad_x=0,
                pad_y=0,
            ),
        )


def _make_scene(w: int, h: int, with_text: bool) -> np.ndarray:
    img = np.full((h, w, 3), 235, dtype=np.uint8)
    # Background artwork (panels, shading, character silhouette)
    cv2.rectangle(img, (20, 20), (w - 20, h - 20), (140, 140, 140), 4)
    cv2.circle(img, (w // 2, int(h * 0.65)), min(w, h) // 4, (90, 110, 160), -1)
    cv2.line(img, (40, int(h * 0.45)), (w - 40, int(h * 0.5)), (70, 70, 70), 3)
    if with_text:
        cv2.putText(
            img,
            "HELLO",
            (int(w * 0.24), int(h * 0.20)),
            cv2.FONT_HERSHEY_SIMPLEX,
            max(1.0, w / 400.0),
            (10, 10, 10),
            max(2, w // 250),
        )
    return img


def test_matches_adjacent_text_and_textless_pair_and_scales():
    img_text = _make_scene(800, 1200, with_text=True)
    # Textless image is higher resolution (1200x1800, same 2:3 aspect ratio)
    img_textless = _make_scene(1200, 1800, with_text=False)

    res = evaluate_textless_pair(img_text, img_textless, _StubDetector())
    assert res.is_match is True
    assert res.text_role == "a_has_text"
    assert res.text_blocks_a == 1
    assert res.text_blocks_b == 0
    assert res.similarity >= 0.80
    assert res.scaled_textless_rgb is not None
    assert res.scaled_textless_rgb.shape == (1200, 800, 3)


def test_matches_reversed_order_when_textless_comes_first():
    img_textless = _make_scene(800, 1200, with_text=False)
    img_text = _make_scene(800, 1200, with_text=True)

    res = evaluate_textless_pair(img_textless, img_text, _StubDetector())
    assert res.is_match is True
    assert res.text_role == "b_has_text"
    assert res.scaled_textless_rgb is not None
    assert res.scaled_textless_rgb.shape == (1200, 800, 3)


def test_rejects_unrelated_pages_and_mismatched_aspect_ratios():
    page_a = _make_scene(800, 1200, with_text=True)
    # Completely different scene
    page_b = np.full((1200, 800, 3), 240, dtype=np.uint8)
    cv2.rectangle(page_b, (100, 100), (700, 1100), (20, 20, 20), -1)

    res_diff_scene = evaluate_textless_pair(page_a, page_b, _StubDetector())
    assert res_diff_scene.is_match is False

    # Mismatched aspect ratio (landscape vs portrait)
    page_wide = _make_scene(1600, 900, with_text=False)
    sim, aspect_diff = compute_visual_similarity(page_a, page_wide)
    assert aspect_diff > 0.5
    res_diff_aspect = evaluate_textless_pair(page_a, page_wide, _StubDetector())
    assert res_diff_aspect.is_match is False
