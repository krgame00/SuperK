from __future__ import annotations

import io
import json
import sys
from collections.abc import Iterator
from pathlib import Path

# Ensure ocr-service root is in sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.api import create_app
from app.settings import Settings


def _image_to_png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def client(tmp_path) -> Iterator[TestClient]:
    app = create_app(
        settings=Settings(cache_dir=tmp_path, max_workers=1),
    )
    with TestClient(app) as test_client:
        yield test_client


def test_detect_bubbles_endpoint(client: TestClient) -> None:
    # 200x200 image with a white oval bubble
    img_arr = np.zeros((200, 200, 3), dtype=np.uint8)
    cv2.ellipse(img_arr, (100, 100), (60, 40), 0, 0, 360, (255, 255, 255), -1)
    img = Image.fromarray(img_arr, mode="RGB")

    boxes = [{"x": 80, "y": 90, "width": 40, "height": 20}]

    response = client.post(
        "/v1/detect/bubbles",
        files={
            "image": ("page.png", _image_to_png_bytes(img), "image/png"),
        },
        data={
            "boxes": json.dumps(boxes),
            "num_slices": 20,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert "profiles" in data
    assert len(data["profiles"]) == 1
    profile = data["profiles"][0]
    assert profile["text_box_id"] == 0
    assert len(profile["scanline_ratios"]) == 20
    assert len(profile["polygon"]) >= 4
    bx, by, bw, bh = profile["bbox"]
    assert bx <= 80 and (bx + bw) >= 120


def test_detect_bubbles_invalid_json(client: TestClient) -> None:
    img = Image.new("RGB", (64, 64), (0, 0, 0))
    response = client.post(
        "/v1/detect/bubbles",
        files={
            "image": ("page.png", _image_to_png_bytes(img), "image/png"),
        },
        data={
            "boxes": "not a valid json",
        },
    )
    assert response.status_code == 400
