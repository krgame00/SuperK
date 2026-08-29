from __future__ import annotations

import io
import json
import time
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from app.jobs import JobState, JobStore
from app.pipeline import PipelineOutput
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


def _wait_for_job(store: JobStore, job_id: str, timeout: float = 5.0) -> JobState:
    start = time.time()
    while time.time() - start < timeout:
        job = store.get(job_id)
        if job and job.status in (JobStatus.SUCCEEDED, JobStatus.FAILED):
            return job
        time.sleep(0.05)
    raise TimeoutError(f"Job {job_id} did not complete in {timeout}s")


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
        assert store.get("invalid-id-with-dash") is None
        assert store.get("12345") is None
        assert store.get("G" * 32) is None  # Non-hex character
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
