import os
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from app.detector import (
    LetterboxTransform,
    TextDetector,
    decode_yolo_blocks,
    non_max_suppression,
    prepare_input,
    restore_mask,
)
from app.model_store import ModelStore


def test_restore_mask_removes_letterbox_padding() -> None:
    transform = LetterboxTransform(
        source_width=400,
        source_height=200,
        input_size=1024,
        scale=2.56,
        pad_x=0,
        pad_y=0,
    )
    model_mask = np.zeros((1024, 1024), dtype=np.float32)
    model_mask[:512, :] = 1.0
    restored = restore_mask(model_mask, transform)
    assert restored.shape == (200, 400)
    assert restored.dtype == np.float32
    assert float(restored.min()) > 0.99


def test_prepare_input_letterboxes_rgb_as_nchw_float32() -> None:
    image = np.zeros((100, 200, 3), dtype=np.uint8)
    image[..., 0] = 255
    tensor, transform = prepare_input(image, input_size=1024)
    assert tensor.shape == (1, 3, 1024, 1024)
    assert tensor.dtype == np.float32
    assert transform.pad_y == 0
    assert transform.pad_x == 0
    assert np.isclose(tensor.max(), 1.0)
    assert np.isclose(tensor[0, 0].max(), 0.0)
    assert np.isclose(tensor[0, 2].max(), 1.0)


def test_non_max_suppression_keeps_best_overlapping_box() -> None:
    prediction = np.array(
        [
            [
                [50, 50, 20, 20, 0.9, 0.9],
                [50, 50, 20, 20, 0.8, 0.9],
            ],
        ],
        dtype=np.float32,
    )
    detections = non_max_suppression(prediction, 0.1, 0.1)
    assert len(detections) == 1
    assert detections[0].shape == (1, 6)
    assert np.isclose(detections[0][0, 4], 0.81)


def test_decode_yolo_blocks_restores_source_coordinates() -> None:
    transform = LetterboxTransform(
        source_width=400,
        source_height=200,
        input_size=1024,
        scale=2.56,
        pad_x=0,
        pad_y=0,
    )
    detections = np.array([[256, 128, 512, 384, 0.9, 0]], dtype=np.float32)
    blocks = decode_yolo_blocks(detections, transform)
    assert len(blocks) == 1
    assert blocks[0].rect.model_dump() == {
        "x": 100,
        "y": 50,
        "width": 100,
        "height": 100,
    }


def test_detector_returns_source_sized_probability_mask() -> None:
    class FakeInput:
        name = "image"

    class FakeSession:
        def get_inputs(self) -> list[FakeInput]:
            return [FakeInput()]

        def run(
            self,
            _outputs: None,
            inputs: dict[str, np.ndarray],
        ) -> list[np.ndarray]:
            assert inputs["image"].shape == (1, 3, 32, 32)
            boxes = np.array(
                [[[16, 8, 8, 8, 0.9, 0.9]]],
                dtype=np.float32,
            )
            mask = np.zeros((1, 1, 32, 32), dtype=np.float32)
            mask[:, :, :16, :] = 0.75
            return [boxes, mask]

    image = np.full((16, 32, 3), 255, dtype=np.uint8)
    detector = TextDetector.from_session(FakeSession(), input_size=32)
    result = detector.detect(image)
    assert result.mask_probability.shape == (16, 32)
    assert np.isclose(result.mask_probability.min(), 0.75)
    assert len(result.blocks) == 1


@pytest.mark.model
def test_ctd_model_returns_source_sized_mask() -> None:
    source = os.environ.get("SUPERK_MODEL_TEST_IMAGE")
    if not source:
        pytest.skip("set SUPERK_MODEL_TEST_IMAGE to run the CTD model smoke test")
    service_root = Path(__file__).resolve().parents[1]
    store = ModelStore.from_manifest(
        service_root / "models",
        service_root / "models" / "manifest.json",
    )
    image = np.asarray(Image.open(source).convert("RGB"))
    result = TextDetector(store).detect(image)
    assert result.mask_probability.shape == image.shape[:2]
    assert 0.0 <= float(result.mask_probability.min())
    assert float(result.mask_probability.max()) <= 1.0
    assert result.blocks


def test_hybrid_detector_combines_masks() -> None:
    from app.detector import DetectionResult, HybridTextDetector, LetterboxTransform

    class DummyCTD:
        def detect(self, img):
            h, w = img.shape[:2]
            return DetectionResult(
                mask_probability=np.zeros((h, w), dtype=np.float32),
                blocks=[],
                scale=LetterboxTransform(w, h, 1024, 1.0, 0, 0),
            )

    class DummyPaddle:
        def ocr(self, img, cls=True):
            # Return a detected text line at [20, 20] to [40, 40]
            return [[
                [[[20.0, 20.0], [40.0, 20.0], [40.0, 40.0], [20.0, 40.0]], ("TEST", 0.99)]
            ]]

    image = np.full((100, 100, 3), 255, dtype=np.uint8)
    image[25:35, 25:35] = 0  # Black text inside bounding box

    detector = HybridTextDetector(DummyCTD(), paddle_engine=DummyPaddle())
    res = detector.detect(image)
    assert res.mask_probability.shape == (100, 100)
    assert len(res.blocks) == 1
    assert np.any(res.mask_probability[20:40, 20:40] > 0.5)


