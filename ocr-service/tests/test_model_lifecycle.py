from __future__ import annotations

import io
import threading
import time
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from app.jobs import JobState, JobStore
from app.pipeline import PipelineOutput
from app.schemas import JobStage, JobStatus, ManualRegionAction


class _CountablePipeline:
    def __init__(self, on_run: Any = None) -> None:
        self.run_count = 0
        self.unloaded = False
        self.on_run = on_run

    def run(
        self,
        image_rgb: np.ndarray,
        progress_callback=None,
    ) -> PipelineOutput:
        self.run_count += 1
        if self.on_run:
            self.on_run()
        h, w = image_rgb.shape[:2]
        if progress_callback:
            progress_callback(JobStage.CLEANING, 0, 1)
        return PipelineOutput(
            source_image=image_rgb,
            clean_image=image_rgb,
            mask=np.zeros((h, w), dtype=np.uint8),
            review_mask=np.zeros((h, w), dtype=np.uint8),
            protected_mask=np.zeros((h, w), dtype=np.uint8),
            regions=[],
            timings_ms={"detect": 1, "clean": 1},
        )

    def retry_region(
        self,
        output: PipelineOutput,
        region_id: str,
        mask: np.ndarray,
        cleaner: str,
        action: ManualRegionAction,
    ) -> PipelineOutput:
        return output

    def unload(self) -> None:
        self.unloaded = True


def _make_png(width: int = 8, height: int = 8) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), (255, 255, 255)).save(buf, format="PNG")
    return buf.getvalue()


def _wait_for_job(store: JobStore, job_id: str, timeout: float = 5.0) -> JobState:
    start = time.time()
    while time.time() - start < timeout:
        job = store.get(job_id)
        if job and job.status in (JobStatus.SUCCEEDED, JobStatus.FAILED):
            return job
        time.sleep(0.02)
    raise TimeoutError(f"Job {job_id} did not complete in {timeout}s")


def test_warm_model_reuse_without_reloading_between_jobs(tmp_path: Path) -> None:
    factory_calls = 0

    def factory() -> _CountablePipeline:
        nonlocal factory_calls
        factory_calls += 1
        return _CountablePipeline()

    store = JobStore(
        pipeline_factory=factory,
        cache_dir=tmp_path,
        model_idle_timeout_seconds=300.0,
    )
    try:
        assert not store.is_model_loaded()
        assert factory_calls == 0

        # First job loads the pipeline
        job1_id = store.submit(_make_png(), "p1.png")
        job1 = _wait_for_job(store, job1_id)
        assert job1.status == JobStatus.SUCCEEDED
        assert factory_calls == 1
        assert store.is_model_loaded()

        # Closely repeated second job reuses the warm pipeline without reloading
        job2_id = store.submit(_make_png(), "p2.png")
        job2 = _wait_for_job(store, job2_id)
        assert job2.status == JobStatus.SUCCEEDED
        assert factory_calls == 1
        assert store.is_model_loaded()
    finally:
        store.shutdown()


def test_idle_timeout_unloads_model(tmp_path: Path) -> None:
    pipeline_instance = _CountablePipeline()
    store = JobStore(
        pipeline_factory=lambda: pipeline_instance,
        cache_dir=tmp_path,
        model_idle_timeout_seconds=0.1,  # Fast 100ms idle for test
    )
    try:
        job1_id = store.submit(_make_png(), "p1.png")
        job1 = _wait_for_job(store, job1_id)
        assert job1.status == JobStatus.SUCCEEDED
        assert store.is_model_loaded()

        # Wait for idle timeout (100ms + margin)
        time.sleep(0.25)
        assert not store.is_model_loaded()
        assert pipeline_instance.unloaded is True
    finally:
        store.shutdown()


def test_transparent_reload_after_idle_unload(tmp_path: Path) -> None:
    factory_calls = 0

    def factory() -> _CountablePipeline:
        nonlocal factory_calls
        factory_calls += 1
        return _CountablePipeline()

    store = JobStore(
        pipeline_factory=factory,
        cache_dir=tmp_path,
        model_idle_timeout_seconds=0.1,
    )
    try:
        job1_id = store.submit(_make_png(), "p1.png")
        _wait_for_job(store, job1_id)
        assert factory_calls == 1
        assert store.is_model_loaded()

        # Wait for idle unload
        time.sleep(0.25)
        assert not store.is_model_loaded()

        # Transparent reload on next request
        job2_id = store.submit(_make_png(), "p2.png")
        job2 = _wait_for_job(store, job2_id)
        assert job2.status == JobStatus.SUCCEEDED
        assert factory_calls == 2
        assert store.is_model_loaded()
    finally:
        store.shutdown()


def test_pressure_unload_immediate_when_idle(tmp_path: Path) -> None:
    pipeline_instance = _CountablePipeline()
    store = JobStore(
        pipeline_factory=lambda: pipeline_instance,
        cache_dir=tmp_path,
        model_idle_timeout_seconds=300.0,
    )
    try:
        job1_id = store.submit(_make_png(), "p1.png")
        _wait_for_job(store, job1_id)
        assert store.is_model_loaded()

        # SuperK memory pressure requests immediate model release
        unloaded = store.unload_models(force=False)
        assert unloaded is True
        assert not store.is_model_loaded()
        assert pipeline_instance.unloaded is True
    finally:
        store.shutdown()


def test_in_flight_job_prevents_premature_idle_and_pressure_unload(tmp_path: Path) -> None:
    started_event = threading.Event()
    block_event = threading.Event()

    def blocking_run() -> None:
        started_event.set()
        block_event.wait(timeout=5.0)

    pipeline_instance = _CountablePipeline(on_run=blocking_run)
    store = JobStore(
        pipeline_factory=lambda: pipeline_instance,
        cache_dir=tmp_path,
        model_idle_timeout_seconds=0.1,
    )
    try:
        job1_id = store.submit(_make_png(), "p1.png")
        assert started_event.wait(timeout=2.0), "Job did not start"

        # While job is in-flight:
        # 1. Non-forced pressure unload must be rejected to prevent corrupting active work
        assert store.unload_models(force=False) is False
        assert store.is_model_loaded()

        # 2. Idle timeout must not unload models during active execution
        time.sleep(0.2)
        assert store.is_model_loaded()

        # Unblock the job and let it complete
        block_event.set()
        job1 = _wait_for_job(store, job1_id)
        assert job1.status == JobStatus.SUCCEEDED

        # After completion, idle timer triggers unload
        time.sleep(0.25)
        assert not store.is_model_loaded()
        assert pipeline_instance.unloaded is True
    finally:
        block_event.set()
        store.shutdown()
