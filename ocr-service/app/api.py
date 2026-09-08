from __future__ import annotations

import asyncio
import io
import logging
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError

from app.cleaners.aot import AotCleaner
from app.cleaners.flat import FlatCleaner, GradientCleaner
from app.cleaners.lama_large import LamaLargeCleaner
from app.detector import HybridTextDetector
from app.jobs import JobStore, Pipeline, PipelineFactory
from app.model_store import ModelStore
from app.pipeline import CleaningPipeline
from app.residual_probe import CompositeResidualProbe
from app.schemas import (
    CleanerRoute,
    JobStage,
    JobStatus,
    ManualRegionAction,
)
from app.settings import Settings

LOGGER = logging.getLogger(__name__)

SUPPORTED_MEDIA_TYPES = {"image/png", "image/jpeg", "image/webp"}
SUPPORTED_FORMATS = {"PNG", "JPEG", "WEBP"}
RETRY_CLEANERS = {"auto", "flat", "opencv", "aot", "anime-lama", "lama-large"}


def create_app(
    *,
    settings: Settings | None = None,
    pipeline_factory: PipelineFactory | None = None,
) -> FastAPI:
    runtime_settings = settings or Settings()
    factory = pipeline_factory or _default_pipeline_factory(runtime_settings)
    store = JobStore(
        pipeline_factory=factory,
        cache_dir=runtime_settings.cache_dir,
        max_workers=runtime_settings.max_workers,
        retention_hours=runtime_settings.job_retention_hours,
        job_timeout_seconds=runtime_settings.job_timeout_minutes * 60.0,
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        try:
            removed = await asyncio.to_thread(store.sweep_completed)
            if removed:
                LOGGER.info("startup sweep removed %d old job(s)", removed)
        except Exception:
            LOGGER.exception("startup retention sweep failed")
        yield
        store.shutdown()

    app = FastAPI(title="SuperK Cleaner", version="0.1.0", lifespan=lifespan)
    app.state.job_store = store

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/v1/jobs", status_code=202)
    async def create_job(
        image: Annotated[UploadFile, File()],
        project_id: Annotated[str | None, Form()] = None,
    ) -> dict[str, str]:
        source_bytes = await _validated_upload(
            image,
            max_upload_bytes=runtime_settings.max_upload_mb * 1024 * 1024,
            max_pixels=runtime_settings.max_image_megapixels * 1_000_000,
        )
        # submit() may run the (disk-I/O heavy) retention sweep — keep it off
        # the event loop like the upload decode.
        job_id = await asyncio.to_thread(
            store.submit, source_bytes, image.filename or "page", project_id
        )
        return {
            "job_id": job_id,
            "status": JobStatus.QUEUED.value,
            "stage": JobStage.QUEUED.value,
        }

    @app.delete("/v1/projects/{project_id}")
    def delete_project(project_id: str) -> dict[str, object]:
        """Cascading deletion of all cleaner jobs and assets associated with a project."""
        removed = store.delete_project(project_id)
        return {"project_id": project_id, "deleted_jobs": removed}

    @app.post("/v1/jobs/purge")
    def purge_jobs() -> dict[str, int]:
        """Manually sweep finished job assets (retention window = 0)."""
        removed = store.sweep_completed(retention_hours=0.0)
        return {"deleted": removed}

    @app.delete("/v1/jobs/{job_id}")
    def delete_job(job_id: str) -> dict[str, str]:
        _job_or_404(store, job_id)
        try:
            store.delete_job(job_id)
        except RuntimeError:
            raise HTTPException(
                status_code=409,
                detail="Job is still active.",
            ) from None
        return {"job_id": job_id, "status": "deleted"}

    @app.get("/v1/jobs/{job_id}")
    def get_job(job_id: str, response: Response) -> dict[str, object]:
        response.headers["Cache-Control"] = "no-store"
        return _job_or_404(store, job_id).snapshot()

    @app.get("/v1/jobs/{job_id}/result")
    def get_result(job_id: str, response: Response) -> dict[str, object]:
        response.headers["Cache-Control"] = "no-store"
        job = _job_or_404(store, job_id)
        with job.lock:
            if job.status is not JobStatus.SUCCEEDED or job.result is None:
                raise HTTPException(status_code=409, detail="Job is not complete.")
            return job.result.model_dump(mode="json")

    @app.get("/v1/jobs/{job_id}/assets/{asset_name}")
    def get_asset(job_id: str, asset_name: str) -> FileResponse:
        if asset_name not in {
            "source.png",
            "clean.png",
            "mask.png",
            "review-mask.png",
            "protected-mask.png",
        }:
            raise HTTPException(status_code=404, detail="Asset not found.")
        job = _job_or_404(store, job_id)
        with job.lock:
            if job.status is not JobStatus.SUCCEEDED or job.asset_dir is None:
                raise HTTPException(status_code=409, detail="Job is not complete.")
            asset_path = job.asset_dir / asset_name
        if not asset_path.is_file():
            raise HTTPException(status_code=404, detail="Asset not found.")
        return FileResponse(
            asset_path,
            media_type="image/png",
            headers={"Cache-Control": "no-store"},
        )

    @app.post(
        "/v1/jobs/{job_id}/regions/{region_id}/retry",
        status_code=202,
    )
    async def retry_region(
        job_id: str,
        region_id: str,
        mask: Annotated[UploadFile, File()],
        cleaner: Annotated[str, Form()] = "auto",
        action: Annotated[ManualRegionAction, Form()] = (
            ManualRegionAction.AUTOMATIC
        ),
    ) -> dict[str, str]:
        _job_or_404(store, job_id)
        if cleaner not in RETRY_CLEANERS:
            raise HTTPException(status_code=422, detail="Unknown cleaner.")
        mask_bytes = await _validated_upload(
            mask,
            max_upload_bytes=runtime_settings.max_upload_mb * 1024 * 1024,
            allowed_formats={"PNG"},
            allowed_media_types={"image/png"},
            max_pixels=runtime_settings.max_image_megapixels * 1_000_000,
        )
        parent = _job_or_404(store, job_id)
        with parent.lock:
            if parent.status is not JobStatus.SUCCEEDED:
                raise HTTPException(status_code=409, detail="Job is not complete.")
        derived_id = store.submit_retry(
            job_id,
            region_id,
            mask_bytes,
            cleaner,
            action,
        )
        return {
            "job_id": derived_id,
            "status": JobStatus.QUEUED.value,
            "stage": JobStage.QUEUED.value,
        }

    return app


async def _validated_upload(
    upload: UploadFile,
    *,
    max_upload_bytes: int,
    allowed_formats: set[str] = SUPPORTED_FORMATS,
    allowed_media_types: set[str] = SUPPORTED_MEDIA_TYPES,
    max_pixels: int | None = None,
) -> bytes:
    if upload.content_type not in allowed_media_types:
        raise HTTPException(status_code=415, detail="Unsupported image type.")
    source_bytes = await upload.read(max_upload_bytes + 1)
    if len(source_bytes) > max_upload_bytes:
        raise HTTPException(status_code=413, detail="Image is too large.")
    # CPU-bound decode runs in a worker thread — on the event loop it would
    # serialize every concurrent upload.
    await asyncio.to_thread(
        _validate_image_bytes,
        source_bytes,
        allowed_formats=allowed_formats,
        max_pixels=max_pixels,
    )
    return source_bytes


def _validate_image_bytes(
    source_bytes: bytes,
    *,
    allowed_formats: set[str],
    max_pixels: int | None,
) -> None:
    try:
        with Image.open(io.BytesIO(source_bytes)) as image:
            # Reject oversized dimensions BEFORE decoding — a compressed
            # bomb passes the byte check but would allocate gigabytes of RAM.
            if max_pixels is not None and image.width * image.height > max_pixels:
                raise HTTPException(
                    status_code=413,
                    detail="Image dimensions are too large.",
                )
            image.load()
            image_format = image.format
    except Image.DecompressionBombError:
        raise HTTPException(
            status_code=413,
            detail="Image dimensions are too large.",
        ) from None
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(
            status_code=415,
            detail="Invalid image data.",
        ) from None
    if image_format not in allowed_formats:
        raise HTTPException(status_code=415, detail="Unsupported image type.")


def _job_or_404(store: JobStore, job_id: str):
    job = store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job


def _default_pipeline_factory(settings: Settings) -> Callable[[], Pipeline]:
    def build() -> Pipeline:
        service_root = Path(__file__).resolve().parents[1]
        model_dir = (
            settings.model_dir
            if settings.model_dir.is_absolute()
            else (service_root / settings.model_dir)
        )
        model_store = ModelStore.from_manifest(
            model_dir,
            service_root / "models" / "manifest.json",
        )
        detector = HybridTextDetector.from_model_store(model_store)
        lama_large = None
        try:
            lama_large = LamaLargeCleaner.from_model_store(model_store)
        except Exception:
            lama_large = None

        aot = AotCleaner(model_store)
        if lama_large is not None:
            cleaners: dict = {
                CleanerRoute.FLAT: lama_large,
                CleanerRoute.GRADIENT: lama_large,
                CleanerRoute.ARTWORK: lama_large,
                "lama-large": lama_large,
                "anime-lama": lama_large,
                "aot": aot,
            }
        else:
            cleaners = {
                CleanerRoute.FLAT: FlatCleaner(),
                CleanerRoute.GRADIENT: GradientCleaner(),
                CleanerRoute.ARTWORK: aot,
                "aot": aot,
            }

        return CleaningPipeline(
            detector=detector,
            cleaners=cleaners,
            residual_probe=CompositeResidualProbe(detector),
        )

    return build


app = create_app()
