from __future__ import annotations

import hashlib
import io
import logging
import shutil
import threading
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


@dataclass
class JobState:
    id: str
    filename: str
    source_bytes: bytes
    parent_id: str | None = None
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
    ) -> None:
        self.pipeline_factory = pipeline_factory
        self.cache_dir = cache_dir / "jobs"
        self.executor = ThreadPoolExecutor(
            max_workers=max_workers,
            thread_name_prefix="superk-cleaner",
        )
        self._jobs: dict[str, JobState] = {}
        self._jobs_lock = threading.RLock()
        self._pipeline_instance: Pipeline | None = None
        if self.cache_dir.exists():
            for tmp in self.cache_dir.glob(".*.tmp"):
                shutil.rmtree(tmp, ignore_errors=True)

    def submit(self, source_bytes: bytes, filename: str) -> str:
        job_id = uuid.uuid4().hex
        job = JobState(
            id=job_id,
            filename=filename,
            source_bytes=source_bytes,
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
            return self._jobs.get(job_id)

    def shutdown(self) -> None:
        self.executor.shutdown(wait=True, cancel_futures=False)

    def _pipeline(self) -> Pipeline:
        if self._pipeline_instance is None:
            self._pipeline_instance = self.pipeline_factory()
        return self._pipeline_instance

    def _run(self, job: JobState) -> None:
        with job.lock:
            job.status = JobStatus.RUNNING
            job.stage = JobStage.DETECTING
            job.started_at = perf_counter()
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
            import gc
            gc.collect()
            try:
                import torch
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception:
                pass

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
            import gc
            gc.collect()
            try:
                import torch
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception:
                pass

    def _complete(
        self,
        job: JobState,
        output: PipelineOutput,
        image_shape: tuple[int, int],
    ) -> None:
        self._update_progress(
            job,
            JobStage.ENCODING,
            len(output.regions),
            len(output.regions),
        )
        asset_dir = self._write_assets(job.id, output)
        height, width = image_shape
        if job.source_bytes:
            source_hash = hashlib.sha256(job.source_bytes).hexdigest()
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
        )
        with job.lock:
            job.asset_dir = asset_dir
            job.output = None  # Evict full numpy array to free RAM
            job.result = result
            job.source_bytes = b""
            job.status = JobStatus.SUCCEEDED
            job.stage = JobStage.COMPLETE
            job.elapsed_ms = job._current_elapsed_ms()
            job.started_at = None

        with self._jobs_lock:
            if len(self._jobs) > 15:
                # Protect parent jobs referenced by currently queued or running retries
                active_parents = {
                    j.parent_id for j in self._jobs.values()
                    if j.parent_id and j.status in (JobStatus.QUEUED, JobStatus.RUNNING)
                }
                candidates = [
                    oid for oid in list(self._jobs.keys())[:-15]
                    if oid not in active_parents
                ]
                for oid in candidates:
                    old_job = self._jobs.pop(oid, None)
                    if old_job and old_job.asset_dir and old_job.asset_dir.exists():
                        shutil.rmtree(old_job.asset_dir, ignore_errors=True)

    @staticmethod
    def _fail(job: JobState) -> None:
        with job.lock:
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

    def _write_assets(self, job_id: str, output: PipelineOutput) -> Path:
        target = self.cache_dir / job_id
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.parent / f".{job_id}.{uuid.uuid4().hex}.tmp"
        temporary.mkdir()
        try:
            Image.fromarray(output.source_image).save(temporary / "source.png")
            Image.fromarray(output.clean_image).save(temporary / "clean.png")
            Image.fromarray(output.mask).save(temporary / "mask.png")
            Image.fromarray(output.review_mask).save(
                temporary / "review-mask.png",
            )
            Image.fromarray(output.protected_mask).save(
                temporary / "protected-mask.png",
            )
            temporary.replace(target)
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
