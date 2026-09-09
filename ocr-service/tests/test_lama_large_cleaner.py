from __future__ import annotations

import numpy as np
import pytest

from app.cleaners.lama_large import LamaLargeCleaner
from app.mask_refiner import MaskRegion
from app.schemas import PixelRect


def _region() -> MaskRegion:
    return MaskRegion(
        id="lama-test",
        rect=PixelRect(x=16, y=16, width=32, height=32),
        component_ids=(1,),
        stroke_radius=1,
    )


def _inputs() -> tuple[np.ndarray, np.ndarray]:
    image = np.full((64, 64, 3), 80, dtype=np.uint8)
    mask = np.zeros((64, 64), dtype=np.uint8)
    mask[24:40, 24:40] = 255
    return image, mask


class _Session:
    def __init__(self, providers: list[str], *, fail: bool = False, value: float = 1.0) -> None:
        self.providers = providers
        self.fail = fail
        self.value = value
        self.calls = 0

    def get_providers(self) -> list[str]:
        return self.providers

    def run(self, _outputs: None, inputs: dict[str, np.ndarray]) -> list[np.ndarray]:
        self.calls += 1
        if self.fail:
            raise RuntimeError("provider execution failed")
        return [np.full_like(inputs["image"], self.value, dtype=np.float32)]


def test_lama_large_uses_primary_session_when_execution_succeeds() -> None:
    primary = _Session(["DmlExecutionProvider", "CPUExecutionProvider"])
    fallback_calls = 0

    def fallback() -> _Session:
        nonlocal fallback_calls
        fallback_calls += 1
        return _Session(["CPUExecutionProvider"])

    image, mask = _inputs()
    output = LamaLargeCleaner.from_session(
        primary,
        cpu_session_factory=fallback,
    ).clean(image, mask, _region())

    assert primary.calls == 1
    assert fallback_calls == 0
    assert np.array_equal(output[mask == 0], image[mask == 0])
    assert not np.array_equal(output[mask > 0], image[mask > 0])


def test_lama_large_retries_once_on_cpu_after_gpu_execution_failure() -> None:
    primary = _Session(["DmlExecutionProvider", "CPUExecutionProvider"], fail=True)
    cpu = _Session(["CPUExecutionProvider"], value=0.25)
    fallback_calls = 0

    def fallback() -> _Session:
        nonlocal fallback_calls
        fallback_calls += 1
        return cpu

    image, mask = _inputs()
    cleaner = LamaLargeCleaner.from_session(
        primary,
        cpu_session_factory=fallback,
    )
    output = cleaner.clean(image, mask, _region())

    assert primary.calls == 1
    assert cpu.calls == 1
    assert fallback_calls == 1
    assert cleaner.providers == ["CPUExecutionProvider"]
    assert np.array_equal(output[mask == 0], image[mask == 0])


def test_lama_large_does_not_loop_when_cpu_retry_fails() -> None:
    primary = _Session(["DmlExecutionProvider", "CPUExecutionProvider"], fail=True)
    cpu = _Session(["CPUExecutionProvider"], fail=True)
    fallback_calls = 0

    def fallback() -> _Session:
        nonlocal fallback_calls
        fallback_calls += 1
        return cpu

    image, mask = _inputs()
    cleaner = LamaLargeCleaner.from_session(
        primary,
        cpu_session_factory=fallback,
    )

    with pytest.raises(RuntimeError, match="provider execution failed"):
        cleaner.clean(image, mask, _region())

    assert primary.calls == 1
    assert cpu.calls == 1
    assert fallback_calls == 1
