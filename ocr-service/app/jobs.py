from __future__ import annotations

import hashlib
import io
import logging
import shutil
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from time import perf_counter
from typing import Protocol

import numpy as np
from PIL import Image

from app.pipeline import PipelineOutput, ProgressCallback
from app.schemas import (
    CleaningResult,
    JobProgress,
    JobStage,
    JobStatus,
    ManualRegionAction,
)

LOGGER = logging.getLogger(__name__)


class Pipeline(Protocol):
    def run(
        self,
        image_rgb: np.ndarray,
        progress_callback: ProgressCallback | None = None,
    ) -> PipelineOutput: ...


class RetryablePipeline(Pipeline, Protocol):
    def retry_region(
        self,
        output: PipelineOutput,
        region_id: str,
        mask: np.ndarray,
        cleaner: str,
        action: ManualRegionAction,
    ) -> PipelineOutput: ...


class PipelineFactory(Protocol):
    def __call__(self) -> Pipeline: ...


def _trim_process_memory() -> None:
    try:
        import gc
        import sys

        gc.collect()
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass

        if sys.platform == "win32":
            import ctypes

            kernel32 = ctypes.WinDLL("kernel32")
            psapi = ctypes.WinDLL("psapi")
            h = kernel32.GetCurrentProcess()
            psapi.EmptyWorkingSet.argtypes = [ctypes.c_void_p]
            psapi.EmptyWorkingSet.restype = ctypes.c_bool
            psapi.EmptyWorkingSet(h)
    except Exception:
        pass


@dataclass
class JobState:
    id: str
    filename: str
    source_bytes: bytes
    parent_id: str | None = None
    project_id: str | None = None
    status: JobStatus = JobStatus.QUEUED
    stage: JobStage = JobStage.QUEUED
    completed_regions: int = 0
    total_regions: int = 0
    elapsed_ms: int = 0
    result: CleaningResult | None = None
    output: PipelineOutput | None = None
    asset_dir: Path | None = None
    error: str | None = None
    started_at: float | None = None
    lock: threading.RLock = field(default_factory=threading.RLock)

    def snapshot(self) -> dict[str, object]:
        with self.lock:
            progress = JobProgress(
                stage=self.stage,
                completed_regions=self.completed_regions,
                total_regions=self.total_regions,
                elapsed_ms=self._current_elapsed_ms(),
            )
            return {
                "job_id": self.id,
                "status": self.status.value,
                "stage": self.stage.value,
                "progress": progress.model_dump(mode="json"),
                "error": self.error,
            }

    def _current_elapsed_ms(self) -> int:
        if self.started_at is not None and self.status is JobStatus.RUNNING:
            return round((perf_counter() - self.started_at) * 1000)
        return self.elapsed_ms


class JobStore:
    def __init__(
        self,
        *,
        pipeline_factory: PipelineFactory,
        cache_dir: Path,
        max_workers: int = 1,
        retention_hours: float = 24.0,
        job_timeout_seconds: float = 900.0,
    ) -> None:
        self.pipeline_factory = pipeline_factory
        self.cache_dir = cache_dir / "jobs"
        self.retention_hours = retention_hours
        self.job_timeout_seconds = job_timeout_seconds
        self.executor = ThreadPoolExecutor(
            max_workers=max_workers,
            thread_name_prefix="superk-cleaner",
        )
        self._jobs: dict[str, JobState] = {}
        self._jobs_lock = threading.RLock()
        self._pipeline_instance: Pipeline | None = None
        self._last_sweep_at = 0.0
        if self.cache_dir.exists():
            for tmp in self.cache_dir.glob(".*.tmp"):
                shutil.rmtree(tmp, ignore_errors=True)

    def submit(
        self,
        source_bytes: bytes,
        filename: str,
        project_id: str | None = None,
    ) -> str:
        self._maybe_sweep()
        job_id = uuid.uuid4().hex
        job = JobState(
            id=job_id,
            filename=filename,
            source_bytes=source_bytes,
            project_id=project_id,
        )
        with self._jobs_lock:
            self._jobs[job_id] = job
        self.executor.submit(self._run, job)
        return job_id

    def submit_retry(
        self,
        parent_id: str,
        region_id: str,
        mask_bytes: bytes,
        cleaner: str,
        action: ManualRegionAction,
    ) -> str:
        parent = self.get(parent_id)
        if parent is None:
            raise KeyError(parent_id)
        with parent.lock:
            if parent.status is not JobStatus.SUCCEEDED or parent.asset_dir is None:
                raise RuntimeError("parent job is not complete")
            filename = parent.filename
        job_id = uuid.uuid4().hex
        job = JobState(
            id=job_id,
            filename=filename,
            source_bytes=b"",
            parent_id=parent_id,
            project_id=parent.project_id,
        )
        with self._jobs_lock:
            self._jobs[job_id] = job
        self.executor.submit(
            self._run_retry,
            job,
            parent,
            region_id,
            mask_bytes,
            cleaner,
            action,
        )
        return job_id

    def get(self, job_id: str) -> JobState | None:
        with self._jobs_lock:
            job = self._jobs.get(job_id)
            if job is not None:
                return job
            return self._restore_job_from_disk(job_id)

    def _restore_job_from_disk(self, job_id: str) -> JobState | None:
        job_dir = self.cache_dir / job_id
        result_file = job_dir / "result.json"
        if not result_file.is_file():
            return None
        try:
            import json
            result_data = json.loads(result_file.read_text(encoding="utf-8"))
            result = CleaningResult.model_validate(result_data)
            if result.job_id != job_id:
                return None
            for asset in ["source.png", "clean.png", "mask.png", "review-mask.png", "protected-mask.png"]:
                if not (job_dir / asset).is_file():
                    return None
            project_tag = job_dir / "project_id.txt"
            project_id = (
                project_tag.read_text(encoding="utf-8").strip()
                if project_tag.is_file()
                else None
            )
            job = JobState(
                id=job_id,
                filename="restored.png",
                source_bytes=b"",
                status=JobStatus.SUCCEEDED,
                stage=JobStage.COMPLETE,
                result=result,
                asset_dir=job_dir,
                project_id=project_id,
            )
            self._jobs[job_id] = job
            return job
        except Exception:
            return None

    def shutdown(self) -> None:
        self.executor.shutdown(wait=True, cancel_futures=False)

    # -- Retention / cleanup -------------------------------------------------

    def _active_job_ids(self) -> set[str]:
        with self._jobs_lock:
            return {
                job_id
                for job_id, job in self._jobs.items()
                if job.status in (JobStatus.QUEUED, JobStatus.RUNNING)
            }

    def sweep_completed(self, *, retention_hours: float | None = None) -> int:
        """Delete finished job asset dirs older than the retention window.

        retention_hours=0 purges every non-active job. Returns how many dirs
        were removed. Restored (on-disk) jobs that are still inside the window
        are left untouched so completed work survives a service restart.
        """
        hours = self.retention_hours if retention_hours is None else retention_hours
        if retention_hours is None and self.retention_hours <= 0.0:
            return 0
        if not self.cache_dir.exists():
            return 0
        active = self._active_job_ids()
        cutoff = time.time() - max(hours, 0.0) * 3600.0
        removed = 0
        for entry in self.cache_dir.iterdir():
            if not entry.is_dir() or entry.name.startswith("."):
                continue
            if entry.name in active:
                continue
            # Project-tagged assets belong to the project lifetime and are not auto-expired
            if (entry / "project_id.txt").is_file():
                continue
            marker = entry / "result.json"
            try:
                mtime = (
                    marker.stat().st_mtime
                    if marker.is_file()
                    else entry.stat().st_mtime
                )
            except OSError:
                continue
            if mtime > cutoff:
                continue
            shutil.rmtree(entry, ignore_errors=True)
            removed += 1
        self._drop_jobs_with_missing_assets()
        return removed

    def _drop_jobs_with_missing_assets(self) -> None:
        with self._jobs_lock:
            stale = [
                job_id
                for job_id, job in self._jobs.items()
                if job.status is JobStatus.SUCCEEDED
                and job.asset_dir is not None
                and not job.asset_dir.exists()
            ]
            for job_id in stale:
                self._jobs.pop(job_id, None)

    def _maybe_sweep(self) -> None:
        now = time.time()
        if now - self._last_sweep_at < 3600.0:
            return
        self._last_sweep_at = now
        try:
            removed = self.sweep_completed()
            if removed:
                LOGGER.info("retention sweep removed %d old job(s)", removed)
        except Exception:
            LOGGER.exception("retention sweep failed")

    def delete_job(self, job_id: str) -> bool:
        """Delete one finished job's assets and registry entry."""
        with self._jobs_lock:
            job = self._jobs.get(job_id)
        if job is None:
            job_dir = self.cache_dir / job_id
            if job_dir.is_dir():
                shutil.rmtree(job_dir, ignore_errors=True)
                return True
            return False
        with job.lock:
            if job.status in (JobStatus.QUEUED, JobStatus.RUNNING):
                raise RuntimeError("job is still active")
            asset_dir = job.asset_dir
            if asset_dir is not None:
                # Remove under the job lock so an in-flight retry job reading
                # the same parent assets cannot race the deletion.
                shutil.rmtree(asset_dir, ignore_errors=True)
        with self._jobs_lock:
            self._jobs.pop(job_id, None)
        return True

    def delete_project(self, project_id: str) -> int:
        """Cascading deletion of all jobs and assets for a project."""
        if not project_id:
            return 0
        target_job_ids: set[str] = set()
        with self._jobs_lock:
            for jid, j in self._jobs.items():
                if j.project_id == project_id:
                    target_job_ids.add(jid)

        if self.cache_dir.exists():
            for entry in self.cache_dir.iterdir():
                if not entry.is_dir() or entry.name.startswith("."):
                    continue
                tag = entry / "project_id.txt"
                if tag.is_file():
                    try:
                        if tag.read_text(encoding="utf-8").strip() == project_id:
                            target_job_ids.add(entry.name)
                    except OSError:
                        pass

        removed = 0
        for jid in target_job_ids:
            try:
                if self.delete_job(jid):
                    removed += 1
            except Exception:
                pass
        return removed

    def _pipeline(self) -> Pipeline:
        if self._pipeline_instance is None:
            self._pipeline_instance = self.pipeline_factory()
        return self._pipeline_instance

    def _start_watchdog(self, job: JobState) -> threading.Timer | None:
        if self.job_timeout_seconds <= 0:
            return None
        timer = threading.Timer(
            self.job_timeout_seconds,
            self._fail_on_timeout,
            args=(job,),
        )
        timer.daemon = True
        timer.start()
        return timer

    def _fail_on_timeout(self, job: JobState) -> None:
        # The worker thread cannot be interrupted, but the job stops claiming
        # to be running and its result is discarded when it does finish.
        with job.lock:
            if job.status is not JobStatus.RUNNING:
                return
            job.output = None
            job.source_bytes = b""
            job.status = JobStatus.FAILED
            job.error = (
                "Image cleaning timed out after "
                f"{self.job_timeout_seconds / 60:.0f} min."
            )
            job.elapsed_ms = job._current_elapsed_ms()
            job.started_at = None
        LOGGER.error("cleaning job %s timed out", job.id)

    def _run(self, job: JobState) -> None:
        with job.lock:
            job.status = JobStatus.RUNNING
            job.stage = JobStage.DETECTING
            job.started_at = perf_counter()
        watchdog = self._start_watchdog(job)
        try:
            image_rgb = _decode_rgb(job.source_bytes)
            output = self._pipeline().run(
                image_rgb,
                lambda stage, completed, total: self._update_progress(
                    job,
                    stage,
                    completed,
                    total,
                ),
            )
            self._update_progress(
                job,
                JobStage.ENCODING,
                len(output.regions),
                len(output.regions),
            )
            self._complete(job, output, image_rgb.shape[:2])
        except Exception:
            LOGGER.exception("cleaning job %s failed", job.id)
            self._fail(job)
        finally:
            if watchdog is not None:
                watchdog.cancel()
            _trim_process_memory()

    def _run_retry(
        self,
        job: JobState,
        parent: JobState,
        region_id: str,
        mask_bytes: bytes,
        cleaner: str,
        action: ManualRegionAction,
    ) -> None:
        with job.lock:
            job.status = JobStatus.RUNNING
            job.stage = JobStage.CLEANING
            job.started_at = perf_counter()
        watchdog = self._start_watchdog(job)
        try:
            with parent.lock:
                if parent.asset_dir is None or not parent.asset_dir.exists():
                    raise RuntimeError("parent assets are unavailable")
                parent_output = PipelineOutput(
                    source_image=_decode_rgb((parent.asset_dir / "source.png").read_bytes()),
                    clean_image=_decode_rgb((parent.asset_dir / "clean.png").read_bytes()),
                    mask=_decode_mask((parent.asset_dir / "mask.png").read_bytes()),
                    review_mask=_decode_mask((parent.asset_dir / "review-mask.png").read_bytes()),
                    protected_mask=_decode_mask((parent.asset_dir / "protected-mask.png").read_bytes()),
                    regions=parent.result.regions if parent.result else [],
                    timings_ms=parent.result.timings_ms if parent.result else {},
                )
            mask = _decode_mask(mask_bytes)
            if mask.shape != parent_output.mask.shape:
                raise ValueError("retry mask dimensions do not match the image")
            pipeline = self._pipeline()
            retry = getattr(pipeline, "retry_region", None)
            if retry is None:
                raise RuntimeError("pipeline does not support region retry")
            output = retry(parent_output, region_id, mask, cleaner, action)
            self._complete(job, output, mask.shape)
        except Exception:
            LOGGER.exception("retry job %s failed", job.id)
            self._fail(job)
        finally:
            if watchdog is not None:
                watchdog.cancel()
            _trim_process_memory()

    def _complete(
        self,
        job: JobState,
        output: PipelineOutput,
        image_shape: tuple[int, int],
    ) -> None:
        with job.lock:
            if job.status is not JobStatus.RUNNING:
                # The watchdog already failed this job (timeout) — discard
                # the late result entirely. Nothing may be written: a
                # result.json on disk would resurrect the job as SUCCEEDED
                # after a restart.
                LOGGER.warning(
                    "job %s completed after failing; discarding result",
                    job.id,
                )
                return
        self._update_progress(
            job,
            JobStage.ENCODING,
            len(output.regions),
            len(output.regions),
        )
        asset_dir = self._write_assets(job.id, output, job.project_id)
        height, width = image_shape
        with job.lock:
            source_bytes = job.source_bytes
        if source_bytes:
            source_hash = hashlib.sha256(source_bytes).hexdigest()
        else:
            source_hash = hashlib.sha256(output.source_image.tobytes()).hexdigest()

        result = CleaningResult(
            job_id=job.id,
            source_hash=source_hash,
            width=width,
            height=height,
            clean_asset=f"/v1/jobs/{job.id}/assets/clean.png",
            mask_asset=f"/v1/jobs/{job.id}/assets/mask.png",
            review_mask_asset=(
                f"/v1/jobs/{job.id}/assets/review-mask.png"
            ),
            protected_mask_asset=(
                f"/v1/jobs/{job.id}/assets/protected-mask.png"
            ),
            regions=output.regions,
            timings_ms=output.timings_ms,
            awaiting_review=output.awaiting_review,
        )
        try:
            (asset_dir / "result.json").write_text(result.model_dump_json(), encoding="utf-8")
        except Exception:
            LOGGER.exception("failed to persist result.json for job %s", job.id)

        with job.lock:
            if job.status is not JobStatus.RUNNING:
                # The watchdog fired while assets were being written — remove
                # the partial dir so nothing restorable is left behind.
                LOGGER.warning(
                    "job %s failed while completing; removing partial assets",
                    job.id,
                )
                shutil.rmtree(asset_dir, ignore_errors=True)
                return
            job.asset_dir = asset_dir
            job.output = None  # Evict full numpy array to free RAM
            job.result = result
            job.source_bytes = b""
            job.status = JobStatus.SUCCEEDED
            job.stage = JobStage.COMPLETE
            job.elapsed_ms = job._current_elapsed_ms()
            job.started_at = None



    @staticmethod
    def _fail(job: JobState) -> None:
        with job.lock:
            job.output = None  # Evict full numpy array to free RAM
            job.source_bytes = b""  # Evict raw input bytes to free RAM
            job.status = JobStatus.FAILED
            job.error = "Image cleaning failed. Check the input and local models."
            job.elapsed_ms = job._current_elapsed_ms()
            job.started_at = None

    @staticmethod
    def _update_progress(
        job: JobState,
        stage: JobStage,
        completed: int,
        total: int,
    ) -> None:
        with job.lock:
            job.stage = stage
            job.completed_regions = completed
            job.total_regions = total

    def _write_assets(
        self,
        job_id: str,
        output: PipelineOutput,
        project_id: str | None = None,
    ) -> Path:
        target = self.cache_dir / job_id
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.parent / f".{job_id}.{uuid.uuid4().hex}.tmp"
        temporary.mkdir()
        try:
            if project_id:
                (temporary / "project_id.txt").write_text(project_id, encoding="utf-8")
            Image.fromarray(output.source_image).save(temporary / "source.png")
            Image.fromarray(output.clean_image).save(temporary / "clean.png")
            Image.fromarray(output.mask).save(temporary / "mask.png")
            Image.fromarray(output.review_mask).save(
                temporary / "review-mask.png",
            )
            Image.fromarray(output.protected_mask).save(
                temporary / "protected-mask.png",
            )
            if target.exists():
                shutil.rmtree(target, ignore_errors=True)
            try:
                temporary.replace(target)
            except OSError:
                if target.exists():
                    shutil.rmtree(target, ignore_errors=True)
                shutil.move(str(temporary), str(target))
        except Exception:
            shutil.rmtree(temporary, ignore_errors=True)
            raise
        return target


def _decode_rgb(source_bytes: bytes) -> np.ndarray:
    with Image.open(io.BytesIO(source_bytes)) as image:
        return np.asarray(image.convert("RGB")).copy()


def _decode_mask(source_bytes: bytes) -> np.ndarray:
    with Image.open(io.BytesIO(source_bytes)) as image:
        return np.asarray(image.convert("L")).copy()
