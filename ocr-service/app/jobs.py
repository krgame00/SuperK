from __future__ import annotations

import hashlib
import io
import json
import logging
import os
import re
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

from app.ort_utils import is_gpu_device_error, mark_gpu_device_suspended
from app.pipeline import PipelineOutput, ProgressCallback
from app.schemas import (
    CleaningMode,
    CleaningResult,
    JobProgress,
    JobStage,
    JobStatus,
    ManualRegionAction,
    RegionRecord,
)

LOGGER = logging.getLogger(__name__)


class Pipeline(Protocol):
    def run(
        self,
        image_rgb: np.ndarray,
        progress_callback: ProgressCallback | None = None,
        cleaning_mode: CleaningMode = CleaningMode.SAFE,
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


def _trim_process_memory(aggressive: bool = True) -> None:
    try:
        import gc

        if not aggressive:
            gc.collect(0)
            return
        gc.collect()
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                if hasattr(torch.cuda, "ipc_collect"):
                    torch.cuda.ipc_collect()
        except Exception:
            pass

        try:
            import ctypes
            from ctypes import wintypes

            # On Windows: EmptyWorkingSet releases idle pages back to the OS memory manager
            if hasattr(ctypes, "windll") and hasattr(ctypes.windll, "psapi") and hasattr(ctypes.windll, "kernel32"):
                get_process = ctypes.windll.kernel32.GetCurrentProcess
                empty_working_set = ctypes.windll.psapi.EmptyWorkingSet
                get_process.restype = wintypes.HANDLE
                empty_working_set.argtypes = [wintypes.HANDLE]
                empty_working_set.restype = wintypes.BOOL
                empty_working_set(get_process())
            # On Linux/glibc: malloc_trim
            elif hasattr(ctypes, "CDLL"):
                try:
                    libc = ctypes.CDLL("libc.so.6")
                    if hasattr(libc, "malloc_trim"):
                        libc.malloc_trim(0)
                except Exception:
                    pass
        except Exception:
            pass
    except Exception:
        pass


@dataclass
class JobState:
    id: str
    filename: str
    source_bytes: bytes
    parent_id: str | None = None
    project_id: str | None = None
    cleaning_mode: CleaningMode = CleaningMode.SAFE
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
                "cleaning_mode": self.cleaning_mode.value,
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
        model_idle_timeout_seconds: float = 300.0,
    ) -> None:
        self.pipeline_factory = pipeline_factory
        self.cache_dir = cache_dir / "jobs"
        self.retention_hours = retention_hours
        self.job_timeout_seconds = job_timeout_seconds
        self.model_idle_timeout_seconds = model_idle_timeout_seconds
        self.executor = ThreadPoolExecutor(
            max_workers=max_workers,
            thread_name_prefix="superk-cleaner",
        )
        self._jobs: dict[str, JobState] = {}
        self._jobs_lock = threading.RLock()
        self._pipeline_instance: Pipeline | None = None
        self._last_completed_output: tuple[str, PipelineOutput] | None = None
        self._active_workers = 0
        self._idle_timer: threading.Timer | None = None
        self._last_sweep_at = 0.0
        if self.cache_dir.exists():
            for tmp in self.cache_dir.glob(".*.tmp"):
                shutil.rmtree(tmp, ignore_errors=True)

    def submit(
        self,
        source_bytes: bytes,
        filename: str,
        project_id: str | None = None,
        cleaning_mode: CleaningMode = CleaningMode.SAFE,
    ) -> str:
        self._maybe_sweep()
        job_id = uuid.uuid4().hex
        job = JobState(
            id=job_id,
            filename=filename,
            source_bytes=source_bytes,
            project_id=project_id,
            cleaning_mode=CleaningMode(cleaning_mode),
        )
        with self._jobs_lock:
            if self._idle_timer is not None:
                self._idle_timer.cancel()
                self._idle_timer = None
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
            cleaning_mode=parent.cleaning_mode,
        )
        with self._jobs_lock:
            if self._idle_timer is not None:
                self._idle_timer.cancel()
                self._idle_timer = None
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
        if not isinstance(job_id, str) or re.fullmatch(r"[0-9a-f]{32}", job_id) is None:
            return None
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
                cleaning_mode=result.cleaning_mode,
            )
            self._jobs[job_id] = job
            return job
        except Exception:
            return None

    def restore_client_job(
        self,
        *,
        job_id: str | None,
        source_bytes: bytes,
        clean_bytes: bytes,
        mask_bytes: bytes,
        review_mask_bytes: bytes,
        protected_mask_bytes: bytes,
        regions_json: str,
        cleaning_mode: CleaningMode = CleaningMode.ALL_TEXT,
    ) -> JobState:
        resolved_id = (
            job_id
            if isinstance(job_id, str) and re.fullmatch(r"[0-9a-f]{32}", job_id)
            else uuid.uuid4().hex
        )
        source_rgb = _decode_rgb(source_bytes)
        height, width = source_rgb.shape[:2]
        raw_regions = json.loads(regions_json)
        regions = [RegionRecord.model_validate(item) for item in raw_regions]

        target = self.cache_dir / resolved_id
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.parent / f".{resolved_id}.{uuid.uuid4().hex}.tmp"
        temporary.mkdir()
        try:
            (temporary / "source.png").write_bytes(source_bytes)
            (temporary / "clean.png").write_bytes(clean_bytes)
            (temporary / "mask.png").write_bytes(mask_bytes)
            (temporary / "review-mask.png").write_bytes(review_mask_bytes)
            (temporary / "protected-mask.png").write_bytes(protected_mask_bytes)
            source_hash = hashlib.sha256(source_bytes).hexdigest()
            result = CleaningResult(
                job_id=resolved_id,
                source_hash=source_hash,
                width=width,
                height=height,
                clean_asset=f"/v1/jobs/{resolved_id}/assets/clean.png",
                mask_asset=f"/v1/jobs/{resolved_id}/assets/mask.png",
                review_mask_asset=f"/v1/jobs/{resolved_id}/assets/review-mask.png",
                protected_mask_asset=f"/v1/jobs/{resolved_id}/assets/protected-mask.png",
                regions=regions,
                timings_ms={"restored": 1},
                awaiting_review=any(
                    r.status.value == "needs_review" and r.automatic_action.value == "clean"
                    for r in regions
                ),
                cleaning_mode=CleaningMode(cleaning_mode),
            )
            (temporary / "result.json").write_text(result.model_dump_json(), encoding="utf-8")
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

        job = JobState(
            id=resolved_id,
            filename="restored.png",
            source_bytes=b"",
            status=JobStatus.SUCCEEDED,
            stage=JobStage.COMPLETE,
            result=result,
            asset_dir=target,
            cleaning_mode=CleaningMode(cleaning_mode),
        )
        with self._jobs_lock:
            self._jobs[resolved_id] = job
        return job

    def shutdown(self) -> None:
        with self._jobs_lock:
            if self._idle_timer is not None:
                self._idle_timer.cancel()
                self._idle_timer = None
        self.executor.shutdown(wait=True, cancel_futures=False)
        self.unload_models(force=True)

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
                if job.status is JobStatus.FAILED
                or (
                    job.status is JobStatus.SUCCEEDED
                    and job.asset_dir is not None
                    and not job.asset_dir.exists()
                )
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
        if not isinstance(job_id, str) or re.fullmatch(r"[0-9a-f]{32}", job_id) is None:
            return False
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

    def is_model_loaded(self) -> bool:
        with self._jobs_lock:
            return self._pipeline_instance is not None

    def unload_models(self, force: bool = False, *, trim_working_set: bool = True) -> bool:
        """Unload heavy pipeline models if no jobs are actively running (or if force=True)."""
        with self._jobs_lock:
            if self._idle_timer is not None:
                self._idle_timer.cancel()
                self._idle_timer = None
            if (self._active_job_ids() or self._active_workers > 0) and not force:
                LOGGER.info("Cannot unload models: active jobs are running")
                return False
            self._last_completed_output = None
            if self._pipeline_instance is None:
                if trim_working_set:
                    self.trim_memory()
                else:
                    _trim_process_memory(aggressive=False)
                return True
            LOGGER.info("Unloading heavy models from memory...")
            pipeline = self._pipeline_instance
            self._pipeline_instance = None

            unload_fn = getattr(pipeline, "unload", None) or getattr(pipeline, "close", None)
            if callable(unload_fn):
                try:
                    unload_fn()
                except Exception:
                    LOGGER.exception("Error during pipeline.unload()")

            cleaners = getattr(pipeline, "cleaners", {})
            if isinstance(cleaners, dict):
                for cleaner in cleaners.values():
                    c_unload = getattr(cleaner, "unload", None)
                    if callable(c_unload):
                        try:
                            c_unload()
                        except Exception:
                            pass
            detector = getattr(pipeline, "detector", None)
            if detector is not None:
                d_unload = getattr(detector, "unload", None)
                if callable(d_unload):
                    try:
                        d_unload()
                    except Exception:
                        pass

            del pipeline
            if trim_working_set:
                self.trim_memory()
            else:
                _trim_process_memory(aggressive=False)
            return True

    def _schedule_idle_unload_if_idle(self) -> None:
        with self._jobs_lock:
            if self._idle_timer is not None:
                self._idle_timer.cancel()
                self._idle_timer = None
            if self.model_idle_timeout_seconds <= 0:
                return
            if self._pipeline_instance is None:
                return
            if not self._active_job_ids():
                self._idle_timer = threading.Timer(
                    self.model_idle_timeout_seconds,
                    self._on_idle_timeout,
                )
                self._idle_timer.daemon = True
                self._idle_timer.start()

    def _on_idle_timeout(self) -> None:
        with self._jobs_lock:
            self._idle_timer = None
            if self._active_job_ids():
                return
            LOGGER.info(
                "Idle timeout reached (%s s); releasing heavy models",
                self.model_idle_timeout_seconds,
            )
            self.unload_models(trim_working_set=False)

    def trim_memory(self) -> None:
        """Purge unreferenced objects and trim the OS working set."""
        _trim_process_memory()

    def _pipeline(self) -> Pipeline:
        with self._jobs_lock:
            if self._pipeline_instance is None:
                self._pipeline_instance = self.pipeline_factory()
            return self._pipeline_instance

    def _worker_started(self) -> None:
        with self._jobs_lock:
            self._active_workers += 1

    def _worker_finished(self) -> None:
        with self._jobs_lock:
            self._active_workers = max(0, self._active_workers - 1)

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
        self._worker_started()
        worker_active = True
        watchdog = self._start_watchdog(job)
        try:
            image_rgb = _decode_rgb(job.source_bytes)
            # Legacy injected pipelines may still implement the safe-only
            # signature. All-text always requires explicit mode support.
            mode_options = {"cleaning_mode": job.cleaning_mode} if job.cleaning_mode is CleaningMode.ALL_TEXT else {}
            def progress_cb(stage, completed, total):
                return self._update_progress(job, stage, completed, total)
            try:
                output = self._pipeline().run(
                    image_rgb,
                    progress_cb,
                    **mode_options,
                )
            except Exception as run_exc:
                if not is_gpu_device_error(run_exc):
                    raise
                mark_gpu_device_suspended(run_exc)
                LOGGER.warning(
                    "GPU device error in job %s (%s); rebuilding pipeline on CPU and retrying once.",
                    job.id,
                    run_exc,
                )
                with self._jobs_lock:
                    self._pipeline_instance = None
                output = self._pipeline().run(
                    image_rgb,
                    progress_cb,
                    **mode_options,
                )
            self._worker_finished()
            worker_active = False
            self._update_progress(
                job,
                JobStage.ENCODING,
                len(output.regions),
                len(output.regions),
            )
            self._complete(job, output, image_rgb.shape[:2])
        except Exception as exc:
            LOGGER.exception("cleaning job %s failed", job.id)
            self._fail(job, exc)
        finally:
            if watchdog is not None:
                watchdog.cancel()
            _trim_process_memory(aggressive=False)
            if worker_active:
                self._worker_finished()
            self._schedule_idle_unload_if_idle()

    def _find_root_job(self, job: JobState) -> JobState | None:
        seen = {job.id}
        current = job
        while current.parent_id:
            parent = self.get(current.parent_id)
            if parent is None or parent.id in seen:
                return None
            seen.add(parent.id)
            current = parent
        return current

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
        self._worker_started()
        worker_active = True
        watchdog = self._start_watchdog(job)
        try:
            mask = _decode_mask(mask_bytes)
            root_text_mask = None
            if action is ManualRegionAction.FORCE_CLEAN:
                # A force-clean over a restored (de-authorized) region re-erases
                # the restored text: the root job's text mask joins the user's
                # strokes within a brush-sized neighborhood so glyph fragments
                # between thin strokes disappear with the strokes.
                root_job = self._find_root_job(parent)
                if root_job is not None and root_job.asset_dir is not None:
                    root_mask_file = root_job.asset_dir / "mask.png"
                    if root_mask_file.is_file():
                        try:
                            root_text_mask = _decode_mask(root_mask_file.read_bytes())
                        except Exception:
                            root_text_mask = None
            pipeline = self._pipeline()
            retry = getattr(pipeline, "retry_region", None)
            if retry is None:
                raise RuntimeError("pipeline does not support region retry")
            with parent.lock:
                if parent.asset_dir is None or not parent.asset_dir.exists():
                    raise RuntimeError("parent assets are unavailable")
                parent_asset_dir = parent.asset_dir
                if (
                    action is ManualRegionAction.CONFIRM_TEXT
                    and type(pipeline).__name__ == "CleaningPipeline"
                    and parent.result is not None
                    and parent.result.width > 0
                    and parent.result.height > 0
                ):
                    expected_shape = (parent.result.height, parent.result.width)
                    if mask.shape != expected_shape:
                        raise ValueError("retry mask dimensions do not match the image")
                    placeholder_rgb = np.empty((1, 1, 3), dtype=np.uint8)
                    placeholder_mask = np.empty(expected_shape, dtype=np.uint8)
                    parent_output = PipelineOutput(
                        source_image=placeholder_rgb,
                        clean_image=placeholder_rgb,
                        mask=placeholder_mask,
                        review_mask=placeholder_mask,
                        protected_mask=placeholder_mask,
                        regions=parent.result.regions,
                        timings_ms=parent.result.timings_ms,
                        cleaning_mode=parent.cleaning_mode,
                    )
                else:
                    cached_pair = self._last_completed_output
                    if (
                        cached_pair is not None
                        and cached_pair[0] == parent.id
                        and (parent.asset_dir / "result.json").is_file()
                    ):
                        cached_out = cached_pair[1]
                        parent_output = PipelineOutput(
                            source_image=cached_out.source_image,
                            clean_image=cached_out.clean_image,
                            mask=cached_out.mask,
                            review_mask=cached_out.review_mask,
                            protected_mask=cached_out.protected_mask,
                            regions=parent.result.regions if parent.result else cached_out.regions,
                            timings_ms=parent.result.timings_ms if parent.result else cached_out.timings_ms,
                            cleaning_mode=parent.cleaning_mode,
                        )
                    else:
                        parent_output = PipelineOutput(
                            source_image=_decode_rgb((parent.asset_dir / "source.png").read_bytes()),
                            clean_image=_decode_rgb((parent.asset_dir / "clean.png").read_bytes()),
                            mask=_decode_mask((parent.asset_dir / "mask.png").read_bytes()),
                            review_mask=_decode_mask((parent.asset_dir / "review-mask.png").read_bytes()),
                            protected_mask=_decode_mask((parent.asset_dir / "protected-mask.png").read_bytes()),
                            regions=parent.result.regions if parent.result else [],
                            timings_ms=parent.result.timings_ms if parent.result else {},
                            cleaning_mode=parent.cleaning_mode,
                        )
            if mask.shape != parent_output.mask.shape:
                raise ValueError("retry mask dimensions do not match the image")
            try:
                output = retry(parent_output, region_id, mask, cleaner, action, root_text_mask)
            except Exception as retry_exc:
                if not is_gpu_device_error(retry_exc):
                    raise
                mark_gpu_device_suspended(retry_exc)
                LOGGER.warning(
                    "GPU device error in retry job %s (%s); rebuilding pipeline on CPU and retrying once.",
                    job.id,
                    retry_exc,
                )
                with self._jobs_lock:
                    self._pipeline_instance = None
                cpu_pipeline = self._pipeline()
                cpu_retry = getattr(cpu_pipeline, "retry_region", None)
                if cpu_retry is None:
                    raise
                output = cpu_retry(parent_output, region_id, mask, cleaner, action, root_text_mask)
            self._worker_finished()
            worker_active = False
            self._complete(
                job,
                output,
                mask.shape,
                parent_asset_dir=parent_asset_dir,
                parent_output=parent_output,
            )
        except Exception as exc:
            LOGGER.exception("retry job %s failed", job.id)
            self._fail(job, exc)
        finally:
            if watchdog is not None:
                watchdog.cancel()
            if worker_active:
                self._worker_finished()
            self._schedule_idle_unload_if_idle()

    def _complete(
        self,
        job: JobState,
        output: PipelineOutput,
        image_shape: tuple[int, int],
        *,
        parent_asset_dir: Path | None = None,
        parent_output: PipelineOutput | None = None,
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
        asset_dir = self._write_assets(
            job.id,
            output,
            job.project_id,
            parent_asset_dir=parent_asset_dir,
            parent_output=parent_output,
        )
        height, width = image_shape
        with job.lock:
            source_bytes = job.source_bytes
        if source_bytes:
            source_hash = hashlib.sha256(source_bytes).hexdigest()
        elif (
            job.parent_id is not None
            and (parent := self.get(job.parent_id)) is not None
            and parent.result is not None
        ):
            source_hash = parent.result.source_hash
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
            cleaning_mode=job.cleaning_mode,
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
        with self._jobs_lock:
            if output.source_image.shape[:2] == (height, width):
                self._last_completed_output = (job.id, output)
            elif (
                job.parent_id is not None
                and self._last_completed_output is not None
                and self._last_completed_output[0] == job.parent_id
            ):
                prev_out = self._last_completed_output[1]
                self._last_completed_output = (
                    job.id,
                    PipelineOutput(
                        source_image=prev_out.source_image,
                        clean_image=prev_out.clean_image,
                        mask=prev_out.mask,
                        review_mask=prev_out.review_mask,
                        protected_mask=prev_out.protected_mask,
                        regions=output.regions,
                        timings_ms=output.timings_ms,
                        awaiting_review=output.awaiting_review,
                        cleaning_mode=output.cleaning_mode,
                    ),
                )



    @staticmethod
    def _fail(job: JobState, exc: Exception | str | None = None) -> None:
        with job.lock:
            job.output = None  # Evict full numpy array to free RAM
            job.source_bytes = b""  # Evict raw input bytes to free RAM
            job.status = JobStatus.FAILED
            if exc:
                raw_msg = str(exc).strip()
                import re
                cleaned = re.sub(r'[A-Za-z]:\\[^\s"\'<>|]+', '[path]', raw_msg)
                cleaned = re.sub(r'/[^\s"\'<>|]+/[^\s"\'<>|]*', '[path]', cleaned)
                job.error = f"Image cleaning failed: {cleaned}" if cleaned else "Image cleaning failed."
            else:
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
        *,
        parent_asset_dir: Path | None = None,
        parent_output: PipelineOutput | None = None,
    ) -> Path:
        target = self.cache_dir / job_id
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.parent / f".{job_id}.{uuid.uuid4().hex}.tmp"
        temporary.mkdir()
        try:
            if project_id:
                (temporary / "project_id.txt").write_text(project_id, encoding="utf-8")
            p_src = parent_output.source_image if parent_output is not None else None
            p_clean = parent_output.clean_image if parent_output is not None else None
            p_mask = parent_output.mask if parent_output is not None else None
            p_rev = parent_output.review_mask if parent_output is not None else None
            p_prot = parent_output.protected_mask if parent_output is not None else None
            asset_pairs = [
                ("source.png", output.source_image, p_src),
                ("clean.png", output.clean_image, p_clean),
                ("mask.png", output.mask, p_mask),
                ("review-mask.png", output.review_mask, p_rev),
                ("protected-mask.png", output.protected_mask, p_prot),
            ]
            for filename, arr, parent_arr in asset_pairs:
                if (
                    parent_asset_dir is not None
                    and parent_arr is not None
                    and arr is parent_arr
                    and (parent_asset_dir / filename).is_file()
                ):
                    src_asset = parent_asset_dir / filename
                    dst_asset = temporary / filename
                    try:
                        os.link(src_asset, dst_asset)
                    except OSError:
                        shutil.copy2(src_asset, dst_asset)
                else:
                    Image.fromarray(arr).save(temporary / filename, compress_level=1)
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
