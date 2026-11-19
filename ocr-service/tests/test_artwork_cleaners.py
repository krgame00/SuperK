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
from app.ort_utils import reset_gpu_suspended
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


def test_aot_cleaner_retries_once_on_cpu_after_gpu_execution_failure() -> None:
    class FailingGpuSession:
        def __init__(self) -> None:
            self.calls = 0

        def get_providers(self) -> list[str]:
            return ["DmlExecutionProvider", "CPUExecutionProvider"]

        def run(self, _outputs: None, inputs: dict[str, np.ndarray]) -> list[np.ndarray]:
            self.calls += 1
            raise RuntimeError(
                "[ONNXRuntimeError] : 1 : FAIL : ... 887A0005 The GPU device instance has been suspended."
            )

    class CpuSession:
        def __init__(self) -> None:
            self.calls = 0

        def get_providers(self) -> list[str]:
            return ["CPUExecutionProvider"]

        def run(self, _outputs: None, inputs: dict[str, np.ndarray]) -> list[np.ndarray]:
            self.calls += 1
            return [np.ones_like(inputs["image"], dtype=np.float32)]

    gpu = FailingGpuSession()
    cpu = CpuSession()
    fallback_calls = 0

    def fallback() -> CpuSession:
        nonlocal fallback_calls
        fallback_calls += 1
        return cpu

    reset_gpu_suspended()
    try:
        image = np.full((64, 64, 3), 80, np.uint8)
        mask = np.zeros((64, 64), np.uint8)
        mask[20:44, 28:36] = 255
        output = AotCleaner.from_session(gpu, cpu_session_factory=fallback).clean(
            image,
            mask,
            _region(64, 64),
        )

        assert gpu.calls == 1
        assert cpu.calls == 1
        assert fallback_calls == 1
        assert np.array_equal(output[mask == 0], image[mask == 0])
        assert not np.array_equal(output[mask > 0], image[mask > 0])
    finally:
        reset_gpu_suspended()


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


def test_lama_large_clean_regions_merges_adjacent_boxes() -> None:
    from app.cleaners.lama_large import LamaLargeCleaner

    class RecordingSession:
        def __init__(self) -> None:
            self.calls = 0

        def get_providers(self) -> list[str]:
            return ["CPUExecutionProvider"]

        def run(self, _outputs: None, inputs: dict[str, np.ndarray]) -> list[np.ndarray]:
            self.calls += 1
            return [np.ones_like(inputs["image"], dtype=np.float32)]

    session = RecordingSession()
    cleaner = LamaLargeCleaner.from_session(session)

    image = np.full((128, 128, 3), 100, dtype=np.uint8)
    mask = np.zeros((128, 128), dtype=np.uint8)
    mask[20:40, 20:40] = 255
    mask[20:40, 50:70] = 255

    r1 = MaskRegion(
        id="r1",
        rect=PixelRect(x=20, y=20, width=20, height=20),
        component_ids=(1,),
        stroke_radius=2,
    )
    # r2 is 10px apart from r1 (x=50, gap = 50 - 40 = 10 <= 48)
    r2 = MaskRegion(
        id="r2",
        rect=PixelRect(x=50, y=20, width=20, height=20),
        component_ids=(2,),
        stroke_radius=2,
    )

    result = cleaner.clean_regions(image, mask, [r1, r2], max_gap=48, max_dimension=768)

    # Invocations reduced from 2 to 1 due to region merging
    assert session.calls == 1
    assert result.shape == image.shape
    assert np.array_equal(result[mask == 0], image[mask == 0])


def test_ort_session_options_honors_cpu_threads_env(monkeypatch) -> None:
    from app.ort_utils import create_session_options

    monkeypatch.setenv("SUPERK_CPU_THREADS", "6")
    opts = create_session_options()
    assert opts.intra_op_num_threads == 6
