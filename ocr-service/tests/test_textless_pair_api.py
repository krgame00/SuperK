from __future__ import annotations

import base64
import io

import cv2
import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

from app.api import create_app
from app.detector import DetectedBlock, DetectionResult, LetterboxTransform
from app.schemas import PixelRect
from app.settings import Settings


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


class _StubDetectorPipeline:
    """Minimal pipeline for endpoints that only need `store._pipeline().detector`."""

    def __init__(self) -> None:
        self.detector = _StubDetector()


def _make_scene(w: int, h: int, with_text: bool) -> np.ndarray:
    img = np.full((h, w, 3), 235, dtype=np.uint8)
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


def _png_bytes(image_rgb: np.ndarray) -> bytes:
    output = io.BytesIO()
    Image.fromarray(image_rgb).save(output, format="PNG")
    return output.getvalue()


def _detect_pair(client: TestClient, image_a: bytes, image_b: bytes) -> dict[str, object]:
    response = client.post(
        "/v1/detect/textless-pair",
        files={
            "image_a": ("page_a.png", image_a, "image/png"),
            "image_b": ("page_b.png", image_b, "image/png"),
        },
    )
    assert response.status_code == 200
    return response.json()


def test_textless_pair_endpoint_matches_adjacent_pair_and_returns_scaled_base(tmp_path) -> None:
    app = create_app(
        settings=Settings(cache_dir=tmp_path),
        pipeline_factory=_StubDetectorPipeline,
    )
    with TestClient(app) as client:
        body = _detect_pair(
            client,
            _png_bytes(_make_scene(800, 1200, with_text=True)),
            _png_bytes(_make_scene(1200, 1800, with_text=False)),
        )

    assert body["is_match"] is True
    assert body["text_role"] == "a_has_text"
    assert body["text_blocks_a"] == 1
    assert body["text_blocks_b"] == 0
    scaled_b64 = body["scaled_textless_base64"]
    assert isinstance(scaled_b64, str) and scaled_b64.startswith("data:image/png;base64,")
    decoded = cv2.imdecode(
        np.frombuffer(base64.b64decode(scaled_b64.split(",", 1)[1]), np.uint8),
        cv2.IMREAD_COLOR,
    )
    assert decoded is not None
    assert decoded.shape[:2] == (1200, 800)


def test_textless_pair_endpoint_rejects_unrelated_pages(tmp_path) -> None:
    page_b = np.full((1200, 800, 3), 240, dtype=np.uint8)
    cv2.rectangle(page_b, (100, 100), (700, 1100), (20, 20, 20), -1)
    app = create_app(
        settings=Settings(cache_dir=tmp_path),
        pipeline_factory=_StubDetectorPipeline,
    )
    with TestClient(app) as client:
        body = _detect_pair(
            client,
            _png_bytes(_make_scene(800, 1200, with_text=True)),
            _png_bytes(page_b),
        )

    assert body["is_match"] is False
    assert body["scaled_textless_base64"] is None
