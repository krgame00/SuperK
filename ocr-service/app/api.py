from __future__ import annotations

import io
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError

from app.cleaners.anime_lama import AnimeLamaCleaner, CleanerUnavailable
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
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
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
    ) -> dict[str, str]:
        source_bytes = await _validated_upload(
            image,
            max_upload_bytes=runtime_settings.max_upload_mb * 1024 * 1024,
        )
        job_id = store.submit(source_bytes, image.filename or "page")
        return {
            "job_id": job_id,
            "status": JobStatus.QUEUED.value,
            "stage": JobStage.QUEUED.value,
        }

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
) -> bytes:
    if upload.content_type not in allowed_media_types:
        raise HTTPException(status_code=415, detail="Unsupported image type.")
    source_bytes = await upload.read(max_upload_bytes + 1)
    if len(source_bytes) > max_upload_bytes:
        raise HTTPException(status_code=413, detail="Image is too large.")
    try:
        with Image.open(io.BytesIO(source_bytes)) as image:
            image.load()
            image_format = image.format
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(
            status_code=415,
            detail="Invalid image data.",
        ) from None
    if image_format not in allowed_formats:
        raise HTTPException(status_code=415, detail="Unsupported image type.")
    return source_bytes


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

        if lama_large is not None:
            cleaners: dict = {
                CleanerRoute.FLAT: lama_large,
                CleanerRoute.GRADIENT: lama_large,
                CleanerRoute.ARTWORK: lama_large,
                "lama-large": lama_large,
            }
        else:
            try:
                anime_lama = AnimeLamaCleaner.from_model_store(model_store)
            except CleanerUnavailable:
                anime_lama = None
            aot = AotCleaner(model_store)
            primary_artwork = anime_lama or aot
            cleaners = {
                CleanerRoute.FLAT: FlatCleaner(),
                CleanerRoute.GRADIENT: GradientCleaner(),
                CleanerRoute.ARTWORK: primary_artwork,
                "aot": aot,
            }
            if anime_lama is not None:
                cleaners["anime-lama"] = anime_lama

        return CleaningPipeline(
            detector=detector,
            cleaners=cleaners,
            residual_probe=CompositeResidualProbe(detector),
        )

    return build


app = create_app()
