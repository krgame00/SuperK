import os
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from app.cleaners.anime_lama import AnimeLamaCleaner, CleanerUnavailable
from app.cleaners.aot import (
    AotCleaner,
    prepare_aot_inputs,
    restore_aot_output,
)
from app.detector import TextDetector
from app.mask_refiner import MaskRegion, refine_mask
from app.model_store import ModelStore
from app.schemas import PixelRect


def _region(width: int, height: int) -> MaskRegion:
    return MaskRegion(
        id="region-1",
        rect=PixelRect(x=0, y=0, width=width, height=height),
        component_ids=(1,),
        stroke_radius=2,
    )


def test_aot_padding_is_multiple_of_eight() -> None:
    image = np.zeros((513, 517, 3), np.uint8)
    mask = np.zeros((513, 517), np.uint8)
    tensor, mask_tensor, transform = prepare_aot_inputs(image, mask)
    assert tensor.shape[-2] % 8 == 0
    assert tensor.shape[-1] % 8 == 0
    assert mask_tensor.shape[-2:] == tensor.shape[-2:]
    assert restore_aot_output(tensor, transform).shape[:2] == image.shape[:2]


def test_artwork_cleaner_preserves_unmasked_pixels() -> None:
    class FakeSession:
        def run(
            self,
            _outputs: None,
            inputs: dict[str, np.ndarray],
        ) -> list[np.ndarray]:
            return [np.ones_like(inputs["image"], dtype=np.float32)]

    image = np.full((64, 64, 3), 80, np.uint8)
    mask = np.zeros((64, 64), np.uint8)
    mask[20:44, 28:36] = 255
    output = AotCleaner.from_session(FakeSession()).clean(
        image,
        mask,
        _region(64, 64),
    )
    assert np.array_equal(output[mask == 0], image[mask == 0])
    assert not np.array_equal(output[mask > 0], image[mask > 0])


def test_anime_lama_reports_missing_optional_dependency(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.cleaners.anime_lama.importlib.util.find_spec",
        lambda _name: None,
    )
    with pytest.raises(CleanerUnavailable, match="requirements-lama.lock"):
        AnimeLamaCleaner.from_model_path("unused.pt")


@pytest.mark.model
def test_aot_model_repairs_detected_text_without_outside_changes() -> None:
    source = os.environ.get("SUPERK_MODEL_TEST_IMAGE")
    if not source:
        pytest.skip("set SUPERK_MODEL_TEST_IMAGE to run the AOT model smoke test")
    service_root = Path(__file__).resolve().parents[1]
    store = ModelStore.from_manifest(
        service_root / "models",
        service_root / "models" / "manifest.json",
    )
    image = np.asarray(Image.open(source).convert("RGB"))
    refined = refine_mask(image, TextDetector(store).detect(image))
    assert refined.regions
    output = AotCleaner(store).clean(
        image,
        refined.mask,
        refined.regions[0],
    )
    assert output.shape == image.shape
    assert np.array_equal(output[refined.mask == 0], image[refined.mask == 0])
    assert not np.array_equal(output[refined.mask > 0], image[refined.mask > 0])


@pytest.mark.model
def test_anime_lama_model_preserves_unmasked_pixels() -> None:
    source = os.environ.get("SUPERK_MODEL_TEST_IMAGE")
    if not source:
        pytest.skip("set SUPERK_MODEL_TEST_IMAGE to run AnimeLaMa smoke test")
    service_root = Path(__file__).resolve().parents[1]
    store = ModelStore.from_manifest(
        service_root / "models",
        service_root / "models" / "manifest.json",
    )
    image = np.asarray(Image.open(source).convert("RGB"))
    refined = refine_mask(image, TextDetector(store).detect(image))
    assert refined.regions
    output = AnimeLamaCleaner.from_model_store(store).clean(
        image,
        refined.mask,
        refined.regions[0],
    )
    assert output.shape == image.shape
    assert np.array_equal(output[refined.mask == 0], image[refined.mask == 0])
