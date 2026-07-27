from __future__ import annotations

import hashlib
import io
import logging
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
    ) -> PipelineOutput: ...


class PipelineFactory(Protocol):
    def __call__(self) -> Pipeline: ...


@dataclass
class JobState:
    id: str
    filename: str
    source_bytes: bytes
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
    ) -> str:
        parent = self.get(parent_id)
        if parent is None:
            raise KeyError(parent_id)
        with parent.lock:
            if (
                parent.status is not JobStatus.SUCCEEDED
                or parent.output is None
            ):
                raise RuntimeError("parent job is not complete")
            source_bytes = parent.source_bytes
            filename = parent.filename
        job_id = uuid.uuid4().hex
        job = JobState(
            id=job_id,
            filename=filename,
            source_bytes=source_bytes,
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

    def _run_retry(
        self,
        job: JobState,
        parent: JobState,
        region_id: str,
        mask_bytes: bytes,
        cleaner: str,
    ) -> None:
        with job.lock:
            job.status = JobStatus.RUNNING
            job.stage = JobStage.CLEANING
            job.started_at = perf_counter()
        try:
            with parent.lock:
                if parent.output is None:
                    raise RuntimeError("parent output is unavailable")
                parent_output = parent.output
            mask = _decode_mask(mask_bytes)
            if mask.shape != parent_output.mask.shape:
                raise ValueError("retry mask dimensions do not match the image")
            pipeline = self._pipeline()
            retry = getattr(pipeline, "retry_region", None)
            if retry is None:
                raise RuntimeError("pipeline does not support region retry")
            output = retry(parent_output, region_id, mask, cleaner)
            self._complete(job, output, mask.shape)
        except Exception:
            LOGGER.exception("retry job %s failed", job.id)
            self._fail(job)

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
        result = CleaningResult(
            job_id=job.id,
            source_hash=hashlib.sha256(job.source_bytes).hexdigest(),
            width=width,
            height=height,
            clean_asset=f"/v1/jobs/{job.id}/assets/clean.png",
            mask_asset=f"/v1/jobs/{job.id}/assets/mask.png",
            regions=output.regions,
            timings_ms=output.timings_ms,
        )
        with job.lock:
            job.asset_dir = asset_dir
            job.output = output
            job.result = result
            job.status = JobStatus.SUCCEEDED
            job.stage = JobStage.COMPLETE
            job.elapsed_ms = job._current_elapsed_ms()
            job.started_at = None

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
        target.mkdir(parents=True, exist_ok=False)
        Image.fromarray(output.clean_image).save(target / "clean.png")
        Image.fromarray(output.mask).save(target / "mask.png")
        return target


def _decode_rgb(source_bytes: bytes) -> np.ndarray:
    with Image.open(io.BytesIO(source_bytes)) as image:
        return np.asarray(image.convert("RGB")).copy()


def _decode_mask(source_bytes: bytes) -> np.ndarray:
    with Image.open(io.BytesIO(source_bytes)) as image:
        return np.asarray(image.convert("L")).copy()
