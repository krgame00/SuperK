from __future__ import annotations

import ctypes
import io
import json
import os
import threading
import time
from pathlib import Path

import numpy as np
from PIL import Image

from app.jobs import JobState, JobStore, _trim_process_memory
from app.pipeline import PipelineOutput, _peak_rss_mb
from app.schemas import CleaningResult, JobStage, JobStatus, ManualRegionAction


class _TestPipeline:
    def run(
        self,
        image_rgb: np.ndarray,
        progress_callback=None,
    ) -> PipelineOutput:
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


def _make_png(width: int = 8, height: int = 8) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), (255, 255, 255)).save(buf, format="PNG")
    return buf.getvalue()


def test_windows_memory_trim_declares_process_handle_types(monkeypatch):
    import sys
    from ctypes import wintypes
    from types import SimpleNamespace
    from unittest.mock import Mock

    get_process = Mock(return_value=ctypes.c_void_p(-1).value)
    empty_working_set = Mock(return_value=1)
    get_process_memory_info = Mock(return_value=1)
    monkeypatch.setitem(sys.modules, "resource", None)
    monkeypatch.setattr("app.pipeline.os.name", "nt")
    monkeypatch.setattr(ctypes, "windll", SimpleNamespace(
        kernel32=SimpleNamespace(GetCurrentProcess=get_process),
        psapi=SimpleNamespace(
            EmptyWorkingSet=empty_working_set,
            GetProcessMemoryInfo=get_process_memory_info,
        ),
    ), raising=False)

    _trim_process_memory()
    _peak_rss_mb()

    assert get_process.restype is wintypes.HANDLE
    assert empty_working_set.argtypes == [wintypes.HANDLE]
    assert empty_working_set.restype is wintypes.BOOL
    assert get_process_memory_info.argtypes[0] is wintypes.HANDLE
    assert get_process_memory_info.restype is wintypes.BOOL


def _wait_for_job(store: JobStore, job_id: str, timeout: float = 5.0) -> JobState:
    start = time.time()
    while time.time() - start < timeout:
        job = store.get(job_id)
        if job and job.status in (JobStatus.SUCCEEDED, JobStatus.FAILED):
            return job
        time.sleep(0.05)
    raise TimeoutError(f"Job {job_id} did not complete in {timeout}s")


def test_all_text_mode_persists_restores_and_retries(tmp_path):
    seen = []

    class ModePipeline(_TestPipeline):
        def run(self, image_rgb, progress_callback=None, cleaning_mode="safe"):
            seen.append(cleaning_mode)
            return super().run(image_rgb, progress_callback)

        def retry_region(self, output, *args):
            seen.append(output.cleaning_mode)
            return output

    store = JobStore(pipeline_factory=ModePipeline, cache_dir=tmp_path)
    try:
        job_id = store.submit(_make_png(), "page.png", cleaning_mode="all-text")
        job = _wait_for_job(store, job_id)
        assert job.status is JobStatus.SUCCEEDED
        assert job.result.cleaning_mode == "all-text"
        assert job.snapshot()["cleaning_mode"] == "all-text"
        store._jobs.clear()
        restored = store.get(job_id)
        assert restored.cleaning_mode == "all-text"
        retry_id = store.submit_retry(job_id, "region", _make_png(), "flat", ManualRegionAction.PROTECT)
        retry = _wait_for_job(store, retry_id)
        assert retry.status is JobStatus.SUCCEEDED
        assert retry.result.cleaning_mode == "all-text"
        assert retry.result.source_hash == job.result.source_hash
        assert seen == ["all-text", "all-text"]
    finally:
        store.shutdown()


def test_legacy_disk_result_without_mode_restores_safe(tmp_path):
    store = JobStore(pipeline_factory=_TestPipeline, cache_dir=tmp_path)
    try:
        job_id = store.submit(_make_png(), "legacy.png")
        job = _wait_for_job(store, job_id)
        result_path = job.asset_dir / "result.json"
        payload = json.loads(result_path.read_text(encoding="utf-8"))
        payload.pop("cleaning_mode", None)
        result_path.write_text(json.dumps(payload), encoding="utf-8")
        store._jobs.clear()
        restored = store.get(job_id)
        assert restored.snapshot()["cleaning_mode"] == "safe"
        assert restored.result.cleaning_mode == "safe"
    finally:
        store.shutdown()


def test_persistence_created_on_completion(tmp_path: Path) -> None:
    store = JobStore(pipeline_factory=lambda: _TestPipeline(), cache_dir=tmp_path)
    try:
        png_bytes = _make_png()
        job_id = store.submit(png_bytes, "test.png")
        job = _wait_for_job(store, job_id)
        assert job.status == JobStatus.SUCCEEDED

        job_dir = tmp_path / "jobs" / job_id
        assert job_dir.is_dir()

        required_files = [
            "result.json",
            "source.png",
            "clean.png",
            "mask.png",
            "review-mask.png",
            "protected-mask.png",
        ]
        for filename in required_files:
            file_path = job_dir / filename
            assert file_path.is_file(), f"Missing required file {filename}"

        result_data = json.loads((job_dir / "result.json").read_text(encoding="utf-8"))
        result = CleaningResult.model_validate(result_data)
        assert result.job_id == job_id
    finally:
        store.shutdown()


def test_restore_completed_job_after_restart(tmp_path: Path) -> None:
    store1 = JobStore(pipeline_factory=lambda: _TestPipeline(), cache_dir=tmp_path)
    png_bytes = _make_png()
    job_id = store1.submit(png_bytes, "test.png")
    job1 = _wait_for_job(store1, job_id)
    assert job1.status == JobStatus.SUCCEEDED
    store1.shutdown()

    # Re-instantiate JobStore with empty in-memory registry but same cache_dir
    store2 = JobStore(pipeline_factory=lambda: _TestPipeline(), cache_dir=tmp_path)
    try:
        job2 = store2.get(job_id)
        assert job2 is not None
        assert job2.id == job_id
        assert job2.status == JobStatus.SUCCEEDED
        assert job2.stage == JobStage.COMPLETE
        assert job2.result is not None
        assert job2.result.job_id == job_id
        assert job2.asset_dir == tmp_path / "jobs" / job_id
        assert job2.source_bytes == b""
        assert job2.output is None
    finally:
        store2.shutdown()


def test_retry_after_restart(tmp_path: Path) -> None:
    store1 = JobStore(pipeline_factory=lambda: _TestPipeline(), cache_dir=tmp_path)
    png_bytes = _make_png(16, 16)
    parent_id = store1.submit(png_bytes, "parent.png")
    parent_job = _wait_for_job(store1, parent_id)
    assert parent_job.status == JobStatus.SUCCEEDED
    store1.shutdown()

    # Create new store and retry region on parent restored from disk
    store2 = JobStore(pipeline_factory=lambda: _TestPipeline(), cache_dir=tmp_path)
    try:
        mask_bytes = _make_png(16, 16)
        derived_id = store2.submit_retry(
            parent_id=parent_id,
            region_id="reg-1",
            mask_bytes=mask_bytes,
            cleaner="auto",
            action="force-clean",
        )
        derived_job = _wait_for_job(store2, derived_id)
        assert derived_job.status == JobStatus.SUCCEEDED
        assert derived_job.parent_id == parent_id

        # Derived job assets also exist on disk
        derived_dir = tmp_path / "jobs" / derived_id
        assert (derived_dir / "result.json").is_file()
        assert (derived_dir / "clean.png").is_file()

        # Parent assets remained unchanged
        parent_dir = tmp_path / "jobs" / parent_id
        assert (parent_dir / "result.json").is_file()
    finally:
        store2.shutdown()


def test_restore_rejects_corrupted_json(tmp_path: Path) -> None:
    store = JobStore(pipeline_factory=lambda: _TestPipeline(), cache_dir=tmp_path)
    try:
        fake_id = "a" * 32
        fake_dir = tmp_path / "jobs" / fake_id
        fake_dir.mkdir(parents=True)
        (fake_dir / "result.json").write_text("{broken json content", encoding="utf-8")
        for asset in ["source.png", "clean.png", "mask.png", "review-mask.png", "protected-mask.png"]:
            (fake_dir / asset).write_bytes(b"dummy")

        assert store.get(fake_id) is None
    finally:
        store.shutdown()


def test_restore_rejects_job_id_mismatch(tmp_path: Path) -> None:
    store = JobStore(pipeline_factory=lambda: _TestPipeline(), cache_dir=tmp_path)
    try:
        dir_id = "1" * 32
        json_id = "2" * 32
        fake_dir = tmp_path / "jobs" / dir_id
        fake_dir.mkdir(parents=True)

        result = CleaningResult(
            job_id=json_id,
            source_hash="0" * 64,
            width=8,
            height=8,
            clean_asset=f"/v1/jobs/{json_id}/assets/clean.png",
            mask_asset=f"/v1/jobs/{json_id}/assets/mask.png",
            review_mask_asset=f"/v1/jobs/{json_id}/assets/review-mask.png",
            protected_mask_asset=f"/v1/jobs/{json_id}/assets/protected-mask.png",
            regions=[],
            timings_ms={},
        )
        (fake_dir / "result.json").write_text(result.model_dump_json(), encoding="utf-8")
        for asset in ["source.png", "clean.png", "mask.png", "review-mask.png", "protected-mask.png"]:
            (fake_dir / asset).write_bytes(b"dummy")

        assert store.get(dir_id) is None
    finally:
        store.shutdown()


def test_restore_rejects_missing_assets(tmp_path: Path) -> None:
    store = JobStore(pipeline_factory=lambda: _TestPipeline(), cache_dir=tmp_path)
    try:
        fake_id = "c" * 32
        fake_dir = tmp_path / "jobs" / fake_id
        fake_dir.mkdir(parents=True)

        result = CleaningResult(
            job_id=fake_id,
            source_hash="0" * 64,
            width=8,
            height=8,
            clean_asset=f"/v1/jobs/{fake_id}/assets/clean.png",
            mask_asset=f"/v1/jobs/{fake_id}/assets/mask.png",
            review_mask_asset=f"/v1/jobs/{fake_id}/assets/review-mask.png",
            protected_mask_asset=f"/v1/jobs/{fake_id}/assets/protected-mask.png",
            regions=[],
            timings_ms={},
        )
        (fake_dir / "result.json").write_text(result.model_dump_json(), encoding="utf-8")
        # Write only 4 out of 5 required png assets (missing protected-mask.png)
        for asset in ["source.png", "clean.png", "mask.png", "review-mask.png"]:
            (fake_dir / asset).write_bytes(b"dummy")

        assert store.get(fake_id) is None
    finally:
        store.shutdown()


def test_get_rejects_path_traversal(tmp_path: Path) -> None:
    store = JobStore(pipeline_factory=lambda: _TestPipeline(), cache_dir=tmp_path)
    try:
        assert store.get("../../secret") is None
        assert store.get("../other") is None
        assert store.get("..\\escape") is None
        assert store.delete_job("../escape") is False
        assert store.delete_job("..\\escape") is False
        assert store.get("invalid-id-with-dash") is None
        assert store.get("12345") is None
        assert store.get("G" * 32) is None  # Non-hex character
    finally:
        store.shutdown()


def test_pipeline_is_initialized_once_and_failed_jobs_are_evicted(tmp_path: Path) -> None:
    calls = 0
    results = []

    def factory():
        nonlocal calls
        calls += 1
        time.sleep(0.02)
        return _TestPipeline()

    store = JobStore(pipeline_factory=factory, cache_dir=tmp_path)
    failed = JobState(id="a" * 32, filename="failed.png", source_bytes=b"", status=JobStatus.FAILED)
    try:
        with store._jobs_lock:
            store._jobs[failed.id] = failed
        workers = [threading.Thread(target=lambda: results.append(store._pipeline())) for _ in range(8)]
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join()

        store._drop_jobs_with_missing_assets()
        assert calls == 1
        assert len({id(result) for result in results}) == 1
        assert store.get(failed.id) is None
    finally:
        store.shutdown()


def test_more_than_15_jobs_not_deleted(tmp_path: Path) -> None:
    store = JobStore(pipeline_factory=lambda: _TestPipeline(), cache_dir=tmp_path, max_workers=2)
    try:
        job_ids = []
        png_bytes = _make_png()
        for i in range(18):
            jid = store.submit(png_bytes, f"page_{i}.png")
            job_ids.append(jid)

        # Wait for all to complete
        for jid in job_ids:
            job = _wait_for_job(store, jid, timeout=15.0)
            assert job.status == JobStatus.SUCCEEDED

        # Assert the very first job is still present in memory and on disk!
        first_id = job_ids[0]
        first_job = store.get(first_id)
        assert first_job is not None
        assert first_job.status == JobStatus.SUCCEEDED
        assert (tmp_path / "jobs" / first_id / "result.json").is_file()
    finally:
        store.shutdown()


def test_failed_job_releases_memory(tmp_path: Path) -> None:
    class _FailingPipeline:
        def run(self, image_rgb: np.ndarray, progress_callback=None) -> PipelineOutput:
            raise RuntimeError("Simulated cleaner failure")

    store = JobStore(pipeline_factory=lambda: _FailingPipeline(), cache_dir=tmp_path)
    try:
        png_bytes = _make_png(32, 32)
        assert len(png_bytes) > 0
        job_id = store.submit(png_bytes, "failing.png")
        job = _wait_for_job(store, job_id)

        assert job.status == JobStatus.FAILED
        assert job.error is not None
        # Memory release verification: large buffers must be evicted
        assert job.source_bytes == b""
        assert job.output is None

        # API snapshot must still be queryable
        snapshot = job.snapshot()
        assert snapshot["status"] == "failed"
        assert snapshot["error"] == job.error
    finally:
        store.shutdown()



def test_retention_sweep_deletes_only_old_jobs(tmp_path: Path) -> None:
    import os

    store = JobStore(pipeline_factory=lambda: _TestPipeline(), cache_dir=tmp_path)
    try:
        png_bytes = _make_png()
        old_id = store.submit(png_bytes, "old.png")
        fresh_id = store.submit(png_bytes, "fresh.png")
        old_job = _wait_for_job(store, old_id)
        fresh_job = _wait_for_job(store, fresh_id)
        assert old_job.status == JobStatus.SUCCEEDED
        assert fresh_job.status == JobStatus.SUCCEEDED

        # Backdate the old job's assets beyond the 24h retention window
        old_timestamp = time.time() - 25 * 3600
        os.utime(tmp_path / "jobs" / old_id / "result.json", (old_timestamp, old_timestamp))

        removed = store.sweep_completed()

        assert removed == 1
        assert not (tmp_path / "jobs" / old_id).exists()
        assert (tmp_path / "jobs" / fresh_id / "result.json").is_file()
        assert store.get(fresh_id) is not None
        # The old job must not be restorable from disk anymore
        store._jobs.pop(old_id, None)
        assert store.get(old_id) is None
    finally:
        store.shutdown()


def test_retention_sweep_keeps_active_jobs(tmp_path: Path) -> None:
    store = JobStore(pipeline_factory=lambda: _TestPipeline(), cache_dir=tmp_path)
    try:
        png_bytes = _make_png()
        done_id = store.submit(png_bytes, "done.png")
        _wait_for_job(store, done_id)

        # Age every dir beyond the window, but make sure nothing active is
        # ever removed even with retention_hours=0.
        removed = store.sweep_completed(retention_hours=0.0)
        assert removed >= 1

        active_id = store.submit(png_bytes, "active.png")
        # The job may complete before we sweep; assert purge never removes a
        # RUNNING/QUEUED job by sweeping while the executor is saturated.
        store.executor.submit(_blocking_wait, 0.2)
        running_id = store.submit(png_bytes, "running.png")
        assert store.sweep_completed(retention_hours=0.0) >= 0
        job = _wait_for_job(store, running_id, timeout=15.0)
        assert job.status == JobStatus.SUCCEEDED
        _ = active_id
    finally:
        store.shutdown()


def _blocking_wait(seconds: float) -> None:
    time.sleep(seconds)


def test_delete_job_removes_assets_and_registry_entry(tmp_path: Path) -> None:
    store = JobStore(pipeline_factory=lambda: _TestPipeline(), cache_dir=tmp_path)
    try:
        job_id = store.submit(_make_png(), "delete-me.png")
        job = _wait_for_job(store, job_id)
        assert job.status == JobStatus.SUCCEEDED
        assert (tmp_path / "jobs" / job_id / "result.json").is_file()

        assert store.delete_job(job_id) is True
        assert not (tmp_path / "jobs" / job_id).exists()
        assert store.get(job_id) is None
        assert store.delete_job(job_id) is False
    finally:
        store.shutdown()


def test_watchdog_fails_timed_out_job_and_discards_late_result(tmp_path: Path) -> None:
    release = threading.Event()

    class _SlowPipeline:
        def run(self, image_rgb: np.ndarray, progress_callback=None) -> PipelineOutput:
            # Outlasts the 0.05s watchdog, then finishes "late".
            release.wait(timeout=5)
            h, w = image_rgb.shape[:2]
            return PipelineOutput(
                source_image=image_rgb,
                clean_image=image_rgb,
                mask=np.zeros((h, w), dtype=np.uint8),
                review_mask=np.zeros((h, w), dtype=np.uint8),
                protected_mask=np.zeros((h, w), dtype=np.uint8),
                regions=[],
                timings_ms={"total": 1},
            )

    store = JobStore(
        pipeline_factory=lambda: _SlowPipeline(),
        cache_dir=tmp_path,
        job_timeout_seconds=0.05,
    )
    try:
        job_id = store.submit(_make_png(32, 32), "slow.png")

        # Watchdog window elapses while the pipeline is still running
        deadline = time.time() + 5
        job = store.get(job_id)
        while time.time() < deadline:
            job = store.get(job_id)
            if job.status == JobStatus.FAILED:
                break
            time.sleep(0.02)
        assert job.status == JobStatus.FAILED
        assert "timed out" in (job.error or "")
        assert store.unload_models() is False
        # No assets or result.json may exist for the timed-out job
        assert not (tmp_path / "jobs" / job_id / "result.json").exists()

        # Let the pipeline finish late — the result must stay discarded.
        # shutdown(wait=True) joins the worker so the late _complete has run.
        release.set()
        store.shutdown()
        with job.lock:
            assert job.status == JobStatus.FAILED
        assert not (tmp_path / "jobs" / job_id / "result.json").exists()
        assert not (tmp_path / "jobs" / job_id).exists()

        # A "restart" must not resurrect the job from disk
        store2 = JobStore(pipeline_factory=lambda: _TestPipeline(), cache_dir=tmp_path)
        try:
            assert store2.get(job_id) is None
        finally:
            store2.shutdown()
    finally:
        release.set()
        store.shutdown()


def test_project_lifetime_retention_and_cascade_deletion(tmp_path: Path) -> None:
    store = JobStore(
        pipeline_factory=lambda: _TestPipeline(),
        cache_dir=tmp_path,
        retention_hours=24.0,
    )
    try:
        png_bytes = _make_png()
        # 1. Submit job tagged with project-alpha
        alpha_id = store.submit(png_bytes, "alpha.png", project_id="proj-alpha")
        alpha_job = _wait_for_job(store, alpha_id)
        assert alpha_job.status == JobStatus.SUCCEEDED
        assert (tmp_path / "jobs" / alpha_id / "project_id.txt").read_text(encoding="utf-8") == "proj-alpha"

        # 2. Submit job tagged with project-beta
        beta_id = store.submit(png_bytes, "beta.png", project_id="proj-beta")
        beta_job = _wait_for_job(store, beta_id)
        assert beta_job.status == JobStatus.SUCCEEDED

        # 3. Simulate passage of 5 days (beyond 24h retention window)
        old_time = time.time() - 5 * 86400
        for jid in (alpha_id, beta_id):
            os.utime(tmp_path / "jobs" / jid / "result.json", (old_time, old_time))

        # Sweep must NOT delete project-tagged assets
        removed = store.sweep_completed()
        assert removed == 0
        assert (tmp_path / "jobs" / alpha_id).exists()
        assert (tmp_path / "jobs" / beta_id).exists()

        # 4. Service restart restores project_id and parent context for retry
        store._jobs.clear()
        restored_alpha = store.get(alpha_id)
        assert restored_alpha is not None
        assert restored_alpha.project_id == "proj-alpha"

        # 5. Cascading deletion of project-alpha: deletes alpha, leaves beta untouched
        deleted_count = store.delete_project("proj-alpha")
        assert deleted_count == 1
        assert not (tmp_path / "jobs" / alpha_id).exists()
        assert (tmp_path / "jobs" / beta_id).exists()
        assert store.get(beta_id) is not None
    finally:
        store.shutdown()
