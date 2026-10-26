from __future__ import annotations

import io
from collections.abc import Iterator

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.api import create_app
from app.settings import Settings


class _MockCleaner:
    def __init__(self, fill_color: tuple[int, int, int] = (255, 0, 0)):
        self.fill_color = fill_color
        self.last_run_mask = None

    def _run(self, image_rgb: np.ndarray, mask: np.ndarray) -> np.ndarray:
        self.last_run_mask = mask.copy()
        repaired = image_rgb.copy()
        repaired[mask > 0] = self.fill_color
        return repaired


class _MockPipelineWithCleaners:
    def __init__(self, mock_cleaner: _MockCleaner):
        self.cleaners = {
            "lama-large": mock_cleaner,
            "flat": mock_cleaner,
        }

    def run(self, image_rgb, progress_callback=None):
        from app.pipeline import PipelineOutput
        return PipelineOutput(
            source_image=image_rgb.copy(),
            clean_image=image_rgb.copy(),
            mask=np.zeros(image_rgb.shape[:2], np.uint8),
            review_mask=np.zeros(image_rgb.shape[:2], np.uint8),
            protected_mask=np.zeros(image_rgb.shape[:2], np.uint8),
            regions=[],
            timings_ms={"total": 1},
        )


def _image_to_png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def mock_cleaner() -> _MockCleaner:
    return _MockCleaner(fill_color=(100, 150, 200))


@pytest.fixture
def client(tmp_path, mock_cleaner: _MockCleaner) -> Iterator[TestClient]:
    app = create_app(
        settings=Settings(cache_dir=tmp_path, max_workers=1),
        pipeline_factory=lambda: _MockPipelineWithCleaners(mock_cleaner),
    )
    with TestClient(app) as test_client:
        yield test_client


def test_clean_crop_zero_mask_returns_original(client: TestClient) -> None:
    img = Image.new("RGB", (32, 32), (50, 60, 70))
    mask = Image.new("L", (32, 32), 0)

    response = client.post(
        "/v1/clean/crop",
        files={
            "image": ("crop.png", _image_to_png_bytes(img), "image/png"),
            "mask": ("mask.png", _image_to_png_bytes(mask), "image/png"),
        },
        data={"cleaner": "auto", "dilation": 0},
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    result_img = Image.open(io.BytesIO(response.content))
    assert result_img.size == (32, 32)
    # Since mask is zero, output should be identical to input
    assert np.array_equal(np.asarray(result_img.convert("RGB")), np.asarray(img))


def test_clean_crop_inpaints_masked_area(client: TestClient, mock_cleaner: _MockCleaner) -> None:
    img = Image.new("RGB", (32, 32), (0, 0, 0))
    mask_arr = np.zeros((32, 32), dtype=np.uint8)
    mask_arr[10:20, 10:20] = 255
    mask = Image.fromarray(mask_arr, mode="L")

    response = client.post(
        "/v1/clean/crop",
        files={
            "image": ("crop.png", _image_to_png_bytes(img), "image/png"),
            "mask": ("mask.png", _image_to_png_bytes(mask), "image/png"),
        },
        data={"cleaner": "lama-large", "dilation": 0},
    )
    assert response.status_code == 200
    result_img = Image.open(io.BytesIO(response.content))
    result_arr = np.asarray(result_img.convert("RGB"))

    # Masked region should be filled with mock cleaner color (100, 150, 200)
    assert np.all(result_arr[10:20, 10:20] == [100, 150, 200])
    # Outside should remain untouched (0, 0, 0)
    assert np.all(result_arr[0:5, 0:5] == [0, 0, 0])


def test_clean_crop_dilation_expands_mask(client: TestClient, mock_cleaner: _MockCleaner) -> None:
    img = Image.new("RGB", (32, 32), (0, 0, 0))
    mask_arr = np.zeros((32, 32), dtype=np.uint8)
    mask_arr[15:17, 15:17] = 255
    mask = Image.fromarray(mask_arr, mode="L")

    response = client.post(
        "/v1/clean/crop",
        files={
            "image": ("crop.png", _image_to_png_bytes(img), "image/png"),
            "mask": ("mask.png", _image_to_png_bytes(mask), "image/png"),
        },
        data={"cleaner": "lama-large", "dilation": 2},
    )
    assert response.status_code == 200
    assert mock_cleaner.last_run_mask is not None
    # Dilated mask should have more active pixels than the original 4 pixels
    assert np.count_nonzero(mock_cleaner.last_run_mask) > 4


def test_clean_crop_tier1_solid_bypass(client: TestClient, mock_cleaner: _MockCleaner) -> None:
    # 32x32 white balloon with black text in center
    img_arr = np.full((32, 32, 3), 255, dtype=np.uint8)
    img_arr[14:18, 14:18] = 0
    mask_arr = np.zeros((32, 32), dtype=np.uint8)
    mask_arr[14:18, 14:18] = 255

    img = Image.fromarray(img_arr, mode="RGB")
    mask = Image.fromarray(mask_arr, mode="L")

    mock_cleaner.last_run_mask = None
    response = client.post(
        "/v1/clean/crop",
        files={
            "image": ("crop.png", _image_to_png_bytes(img), "image/png"),
            "mask": ("mask.png", _image_to_png_bytes(mask), "image/png"),
        },
        data={"cleaner": "auto", "dilation": 0},
    )
    assert response.status_code == 200
    assert response.headers["x-inpaint-tier"] == "solid"
    assert response.headers["x-dominant-bg-color"] == "255,255,255"
    assert "x-inpaint-latency-ms" in response.headers
    # Deep cleaner must NOT be called for Tier 1 solid fill
    assert mock_cleaner.last_run_mask is None

    result_img = Image.open(io.BytesIO(response.content))
    result_arr = np.asarray(result_img.convert("RGB"))
    # Masked text region must now be pure white (255, 255, 255)
    assert np.all(result_arr[14:18, 14:18] == [255, 255, 255])


def test_clean_crop_tier3_complex_calls_deep(client: TestClient, mock_cleaner: _MockCleaner) -> None:
    # High-variance textured image with mask
    np.random.seed(42)
    img_arr = np.random.randint(0, 256, (32, 32, 3), dtype=np.uint8)
    mask_arr = np.zeros((32, 32), dtype=np.uint8)
    mask_arr[12:20, 12:20] = 255

    img = Image.fromarray(img_arr, mode="RGB")
    mask = Image.fromarray(mask_arr, mode="L")

    mock_cleaner.last_run_mask = None
    response = client.post(
        "/v1/clean/crop",
        files={
            "image": ("crop.png", _image_to_png_bytes(img), "image/png"),
            "mask": ("mask.png", _image_to_png_bytes(mask), "image/png"),
        },
        data={"cleaner": "hybrid", "dilation": 0},
    )
    assert response.status_code == 200
    assert response.headers["x-inpaint-tier"] == "deep"
    # Deep cleaner MUST be called for Tier 3 fallback
    assert mock_cleaner.last_run_mask is not None


def test_clean_crop_rejects_dimension_mismatch(client: TestClient) -> None:
    img = Image.new("RGB", (32, 32), (0, 0, 0))
    mask = Image.new("L", (64, 64), 255)

    response = client.post(
        "/v1/clean/crop",
        files={
            "image": ("crop.png", _image_to_png_bytes(img), "image/png"),
            "mask": ("mask.png", _image_to_png_bytes(mask), "image/png"),
        },
    )
    assert response.status_code == 400
    assert "dimensions do not match" in response.json()["detail"]


def test_clean_crop_rejects_unknown_cleaner(client: TestClient) -> None:
    img = Image.new("RGB", (32, 32), (0, 0, 0))
    mask = Image.new("L", (32, 32), 255)

    response = client.post(
        "/v1/clean/crop",
        files={
            "image": ("crop.png", _image_to_png_bytes(img), "image/png"),
            "mask": ("mask.png", _image_to_png_bytes(mask), "image/png"),
        },
        data={"cleaner": "nonexistent_cleaner_xyz"},
    )
    assert response.status_code == 422


def test_clean_crop_supports_stroke_hints_and_feather_blend(
    client: TestClient, mock_cleaner: _MockCleaner
) -> None:
    img = Image.new("RGB", (32, 32), (0, 0, 0))
    mask_arr = np.zeros((32, 32), dtype=np.uint8)
    mask_arr[10:20, 10:20] = 255
    mask = Image.fromarray(mask_arr, mode="L")

    response = client.post(
        "/v1/clean/crop",
        files={
            "image": ("crop.png", _image_to_png_bytes(img), "image/png"),
            "mask": ("mask.png", _image_to_png_bytes(mask), "image/png"),
        },
        data={
            "cleaner": "lama-large",
            "dilation": 0,
            "extend_hints": "true",
            "feather_blend": "true",
        },
    )
    assert response.status_code == 200
    assert response.headers.get("x-stroke-hints-applied") == "true"
    assert response.headers.get("x-feather-blend-applied") == "true"

