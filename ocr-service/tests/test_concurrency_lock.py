from __future__ import annotations

import threading
from collections.abc import Sequence

import numpy as np

from app.cleaners.lama_large import LamaLargeCleaner


class MockThreadSafeSession:
    def __init__(self) -> None:
        self.in_flight = 0
        self.max_concurrent = 0
        self.total_runs = 0
        self._lock = threading.Lock()

    def get_providers(self) -> Sequence[str]:
        return ["DmlExecutionProvider", "CPUExecutionProvider"]

    def run(self, output_names: None, input_feed: dict) -> Sequence[np.ndarray]:
        with self._lock:
            self.in_flight += 1
            if self.in_flight > self.max_concurrent:
                self.max_concurrent = self.in_flight
        # Simulate brief work
        np.zeros((100, 100))
        with self._lock:
            self.in_flight -= 1
            self.total_runs += 1
        return [np.zeros((1, 3, 512, 512), dtype=np.float32)]


def test_lama_large_inference_is_serialized_across_threads():
    mock_session = MockThreadSafeSession()
    cleaner = LamaLargeCleaner(mock_session)

    img = np.zeros((512, 512, 3), dtype=np.uint8)
    mask = np.zeros((512, 512), dtype=np.uint8)

    errors = []

    def worker():
        try:
            out = cleaner._run(img, mask)
            assert out.shape == (512, 512, 3)
        except Exception as exc:
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors
    assert mock_session.total_runs == 8
    # Because get_inference_lock() serializes run(), max_concurrent inside session.run must be exactly 1!
    assert mock_session.max_concurrent == 1
