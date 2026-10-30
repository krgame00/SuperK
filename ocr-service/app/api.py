from __future__ import annotations

import asyncio
import io
import json
import logging
import os
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from time import perf_counter, time
from typing import Annotated

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError

from app.cleaners.aot import AotCleaner
from app.cleaners.flat import FlatCleaner, GradientCleaner
from app.cleaners.lama_large import LamaLargeCleaner
from app.detector import HybridTextDetector
from app.jobs import JobStore, Pipeline, PipelineFactory, _decode_mask, _decode_rgb
from app.model_store import ModelStore
from app.pipeline import RETRY_CLEANER_ALIASES, CleaningPipeline
from app.residual_probe import CompositeResidualProbe
from app.schemas import (
    CleanerRoute,
    CleaningMode,
    JobStage,
    JobStatus,
    ManualRegionAction,
)
from app.settings import Settings

LOGGER = logging.getLogger(__name__)

SUPPORTED_MEDIA_TYPES = {
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "image/avif",
    "image/bmp",
    "image/x-ms-bmp",
    "image/tiff",
    "image/jfif",
    "image/jpg",
    "image/pjpeg",
    "image/x-png",
    "application/octet-stream",
}
# Common manga scan and web formats; decoded to RGB in jobs.
SUPPORTED_FORMATS = {"PNG", "JPEG", "WEBP", "GIF", "AVIF", "BMP", "TIFF", "MPO"}
RETRY_CLEANERS = {"auto", *RETRY_CLEANER_ALIASES}


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
        model_idle_timeout_seconds=runtime_settings.model_idle_timeout_seconds,
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        try:
            removed = await asyncio.to_thread(store.sweep_completed)
            if removed:
                LOGGER.info("startup sweep removed %d old job(s)", removed)
        except Exception:
            LOGGER.exception("startup retention sweep failed")

        async def _periodic_sweep() -> None:
            while True:
                await asyncio.sleep(3600)
                try:
                    sweep_count = await asyncio.to_thread(store.sweep_completed)
                    if sweep_count:
                        LOGGER.info("periodic retention sweep removed %d old job(s)", sweep_count)
                except asyncio.CancelledError:
                    break
                except Exception:
                    LOGGER.exception("periodic retention sweep failed")

        sweep_task = asyncio.create_task(_periodic_sweep())
        try:
            yield
        finally:
            sweep_task.cancel()
            try:
                await sweep_task
            except asyncio.CancelledError:
                pass
            store.shutdown()

    app = FastAPI(title="SuperK Cleaner", version="0.1.0", lifespan=lifespan)
    app.state.job_store = store

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/v1/models/status")
    def model_status() -> dict[str, object]:
        """Return model loading and idle status."""
        return {
            "loaded": store.is_model_loaded(),
            "idle_timeout_seconds": store.model_idle_timeout_seconds,
        }

    @app.get("/v1/system/storage")
    def system_storage() -> dict[str, object]:
        """Read-only disk usage report for job cache, models and temp dirs."""
        now_ms = time() * 1000.0
        cache_root = (
            runtime_settings.cache_dir.parent
            if runtime_settings.cache_dir.name == "jobs"
            else runtime_settings.cache_dir
        )

        job_entries: list[dict[str, object]] = []
        desktop_ini_hits: list[str] = []
        try:
            with os.scandir(store.cache_dir) as entries:
                for entry in entries:
                    if entry.name.lower() == "desktop.ini":
                        desktop_ini_hits.append(entry.path)
                        continue
                    if not entry.is_dir():
                        continue
                    job_ini = Path(entry.path) / "desktop.ini"
                    if job_ini.is_file():
                        desktop_ini_hits.append(str(job_ini))
                    job_entries.append(
                        {
                            "id": entry.name,
                            "bytes": _dir_stats(Path(entry.path))["bytes"],
                            "mtimeMs": entry.stat().st_mtime * 1000.0,
                        }
                    )
        except OSError:
            pass
        job_entries.sort(key=lambda item: item["bytes"], reverse=True)
        mtimes = [float(item["mtimeMs"]) for item in job_entries]
        largest = [
            {
                "id": item["id"],
                "bytes": item["bytes"],
                "ageHours": round((now_ms - float(item["mtimeMs"])) / 3_600_000.0, 2),
            }
            for item in job_entries[:5]
        ]

        models: list[dict[str, object]] = []
        for name, env_dir in (
            ("paddle", os.environ.get("PADDLE_HOME")),
            ("torch", os.environ.get("TORCH_HOME")),
            ("huggingface", os.environ.get("HF_HOME")),
        ):
            model_path = Path(env_dir) if env_dir else cache_root / name
            present = model_path.is_dir()
            models.append(
                {
                    "name": name,
                    "path": str(model_path),
                    "bytes": _dir_stats(model_path)["bytes"] if present else None,
                    "present": present,
                }
            )

        temp_dir = cache_root / "temp"
        temp_bytes: int | None = (
            _dir_stats(temp_dir)["bytes"] if temp_dir.is_dir() else None
        )

        return {
            "cache_dir": str(store.cache_dir),
            "retention_hours": runtime_settings.job_retention_hours,
            "jobs": {
                "count": len(job_entries),
                "bytes": sum(int(item["bytes"]) for item in job_entries),
                "oldestMs": round(min(mtimes)) if mtimes else None,
                "newestMs": round(max(mtimes)) if mtimes else None,
                "largest": largest,
            },
            "models": models,
            "tempBytes": temp_bytes,
            "desktopIniHits": desktop_ini_hits,
        }

    @app.post("/v1/models/unload")
    def unload_models() -> dict[str, object]:
        """Manually release heavy model memory if no jobs are active."""
        unloaded = store.unload_models(force=False)
        return {"unloaded": unloaded, "loaded": store.is_model_loaded()}

    @app.post("/v1/jobs", status_code=202)
    async def create_job(
        image: Annotated[UploadFile, File()],
        project_id: Annotated[str | None, Form()] = None,
        cleaning_mode: Annotated[CleaningMode, Form()] = CleaningMode.SAFE,
    ) -> dict[str, str]:
        source_bytes = await _validated_upload(
            image,
            max_upload_bytes=runtime_settings.max_upload_mb * 1024 * 1024,
            max_pixels=runtime_settings.max_image_megapixels * 1_000_000,
        )
        # submit() may run the (disk-I/O heavy) retention sweep — keep it off
        # the event loop like the upload decode.
        job_id = await asyncio.to_thread(
            store.submit, source_bytes, image.filename or "page", project_id, cleaning_mode
        )
        return {
            "job_id": job_id,
            "status": JobStatus.QUEUED.value,
            "stage": JobStage.QUEUED.value,
            "cleaning_mode": cleaning_mode.value,
        }

    @app.post("/v1/jobs/restore", status_code=200)
    async def restore_job(
        source: Annotated[UploadFile, File()],
        clean: Annotated[UploadFile, File()],
        mask: Annotated[UploadFile, File()],
        review_mask: Annotated[UploadFile, File()],
        protected_mask: Annotated[UploadFile, File()],
        regions: Annotated[str, Form()],
        job_id: Annotated[str | None, Form()] = None,
        cleaning_mode: Annotated[CleaningMode, Form()] = CleaningMode.SAFE,
    ) -> dict[str, object]:
        max_bytes = runtime_settings.max_upload_mb * 1024 * 1024
        max_px = runtime_settings.max_image_megapixels * 1_000_000
        source_bytes = await _validated_upload(source, max_upload_bytes=max_bytes, max_pixels=max_px)
        clean_bytes = await _validated_upload(clean, max_upload_bytes=max_bytes, max_pixels=max_px)
        mask_bytes = await _validated_upload(mask, max_upload_bytes=max_bytes, max_pixels=max_px)
        review_bytes = await _validated_upload(review_mask, max_upload_bytes=max_bytes, max_pixels=max_px)
        protected_bytes = await _validated_upload(protected_mask, max_upload_bytes=max_bytes, max_pixels=max_px)
        restored = await asyncio.to_thread(
            store.restore_client_job,
            job_id=job_id,
            source_bytes=source_bytes,
            clean_bytes=clean_bytes,
            mask_bytes=mask_bytes,
            review_mask_bytes=review_bytes,
            protected_mask_bytes=protected_bytes,
            regions_json=regions,
            cleaning_mode=cleaning_mode,
        )
        return restored.snapshot()

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

    @app.post("/v1/jobs/flush-memory")
    def flush_memory() -> dict[str, str]:
        """Manually trigger model release, garbage collection and OS working set trim."""
        store.unload_models(force=False)
        store.trim_memory()
        return {"status": "ok"}

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

    @app.post(
        "/v1/clean/crop",
        status_code=200,
    )
    async def clean_crop(
        image: Annotated[UploadFile, File()],
        mask: Annotated[UploadFile, File()],
        cleaner: Annotated[str, Form()] = "auto",
        dilation: Annotated[int, Form()] = 0,
        extend_hints: Annotated[bool, Form()] = False,
        feather_blend: Annotated[bool, Form()] = False,
    ) -> Response:
        """Fast-path synchronous inpainting for cropped regions."""
        if cleaner not in RETRY_CLEANERS:
            raise HTTPException(status_code=422, detail="Unknown cleaner.")
        max_bytes = runtime_settings.max_upload_mb * 1024 * 1024
        max_px = runtime_settings.max_image_megapixels * 1_000_000
        image_bytes = await _validated_upload(image, max_upload_bytes=max_bytes, max_pixels=max_px)
        mask_bytes = await _validated_upload(
            mask,
            max_upload_bytes=max_bytes,
            allowed_formats={"PNG"},
            allowed_media_types={"image/png"},
            max_pixels=max_px,
        )

        def _process() -> tuple[bytes, dict[str, str]]:
            t0 = perf_counter()
            image_rgb = _decode_rgb(image_bytes)
            mask_l = _decode_mask(mask_bytes)
            if image_rgb.shape[:2] != mask_l.shape[:2]:
                raise HTTPException(status_code=400, detail="Image and mask dimensions do not match.")

            binary_mask = (mask_l > 0).astype(np.uint8) * 255

            if dilation > 0:
                rad = min(max(1, int(dilation)), 32)
                kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (rad * 2 + 1, rad * 2 + 1))
                binary_mask = cv2.dilate(binary_mask, kernel, iterations=1)

            headers: dict[str, str] = {
                "Cache-Control": "no-store",
            }

            if extend_hints and np.any(binary_mask):
                from app.cleaners.stroke_hints import extend_mask_with_stroke_hints

                binary_mask = extend_mask_with_stroke_hints(
                    image_rgb, binary_mask, dilation_px=max(3, dilation or 5)
                )
                headers["X-Stroke-Hints-Applied"] = "true"

            if not np.any(binary_mask):
                headers["X-Inpaint-Tier"] = "solid"
                headers["X-Inpaint-Latency-Ms"] = "0.0"
                out_io = io.BytesIO()
                Image.fromarray(image_rgb).save(out_io, format="PNG", compress_level=1)
                return out_io.getvalue(), headers

            pipeline = store._pipeline()
            cleaners_map = getattr(pipeline, "cleaners", {})

            chosen_cleaner = None
            if cleaner in ("auto", "hybrid", "lama-large", "anime-lama"):
                chosen_cleaner = cleaners_map.get("lama-large") or cleaners_map.get("anime-lama")
            elif cleaner in cleaners_map:
                chosen_cleaner = cleaners_map[cleaner]

            if chosen_cleaner is None:
                chosen_cleaner = (
                    cleaners_map.get("lama-large")
                    or cleaners_map.get("aot")
                    or next(iter(cleaners_map.values()), None)
                )

            def _run_deep(img: np.ndarray, msk: np.ndarray) -> np.ndarray:
                if chosen_cleaner is None:
                    return cv2.inpaint(img, msk, 5, cv2.INPAINT_NS)
                if hasattr(chosen_cleaner, "_run"):
                    return chosen_cleaner._run(img, msk)
                elif hasattr(chosen_cleaner, "clean_full_image"):
                    return chosen_cleaner.clean_full_image(img, msk)
                else:
                    from app.mask_refiner import MaskRegion
                    from app.schemas import PixelRect

                    h, w = msk.shape
                    dummy_region = MaskRegion(
                        id="crop",
                        rect=PixelRect(x=0, y=0, width=w, height=h),
                        component_ids=(),
                        stroke_radius=2,
                    )
                    return chosen_cleaner.clean(img, msk, dummy_region)

            if cleaner in ("auto", "hybrid"):
                from app.cleaners.hybrid_inpainter import HybridInpainter

                hybrid = HybridInpainter()
                inpaint_res = hybrid.inpaint(image_rgb, binary_mask, deep_cleaner_fn=_run_deep)
                result = inpaint_res.image_rgb
                headers["X-Inpaint-Tier"] = inpaint_res.tier.value
                headers["X-Inpaint-Latency-Ms"] = f"{inpaint_res.elapsed_ms:.2f}"
                if inpaint_res.has_dominant_bg_color and inpaint_res.dominant_color_rgb:
                    r, g, b = inpaint_res.dominant_color_rgb
                    headers["X-Dominant-Bg-Color"] = f"{r},{g},{b}"
            else:
                if chosen_cleaner is None:
                    raise HTTPException(status_code=503, detail="No cleaner available.")
                repaired = _run_deep(image_rgb, binary_mask)
                result = image_rgb.copy()
                support = binary_mask > 0
                result[support] = repaired[support]
                headers["X-Inpaint-Tier"] = "deep"
                headers["X-Inpaint-Latency-Ms"] = f"{(perf_counter() - t0) * 1000.0:.2f}"

            if feather_blend and np.any(binary_mask):
                from app.cleaners.stroke_hints import apply_feather_blend

                result = apply_feather_blend(result, image_rgb, binary_mask)
                headers["X-Feather-Blend-Applied"] = "true"

            out_io = io.BytesIO()
            Image.fromarray(result).save(out_io, format="PNG", compress_level=1)
            return out_io.getvalue(), headers

        try:
            output_png, headers = await asyncio.to_thread(_process)
        except HTTPException:
            raise
        except Exception as err:
            LOGGER.exception("clean_crop failed: %s", err)
            raise HTTPException(status_code=500, detail=f"Inpainting failed: {err}")

        return Response(
            content=output_png,
            media_type="image/png",
            headers=headers,
        )

    @app.post(
        "/v1/detect/bubbles",
        status_code=200,
    )
    async def detect_bubbles(
        image: Annotated[UploadFile, File()],
        boxes: Annotated[str, Form()],
        num_slices: Annotated[int, Form()] = 20,
    ) -> dict[str, list[dict]]:
        """Extracts bubble contours and scanline chord ratios around OCR bounding boxes."""
        max_bytes = runtime_settings.max_upload_mb * 1024 * 1024
        max_px = runtime_settings.max_image_megapixels * 1_000_000
        image_bytes = await _validated_upload(image, max_upload_bytes=max_bytes, max_pixels=max_px)

        try:
            raw_boxes = json.loads(boxes)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON for boxes.")

        parsed_boxes: list[tuple[int, int, int, int]] = []
        for b in raw_boxes:
            if isinstance(b, (list, tuple)) and len(b) == 4:
                parsed_boxes.append((int(b[0]), int(b[1]), int(b[2]), int(b[3])))
            elif isinstance(b, dict):
                x = int(b.get("x", 0))
                y = int(b.get("y", 0))
                w = int(b.get("width") or b.get("w", 0))
                h = int(b.get("height") or b.get("h", 0))
                parsed_boxes.append((x, y, w, h))
            else:
                raise HTTPException(status_code=400, detail="Each box must be [x, y, w, h] or {x, y, width, height}.")

        def _process() -> list[dict]:
            image_rgb = _decode_rgb(image_bytes)
            from app.bubble_contour import extract_bubble_profiles

            profiles = extract_bubble_profiles(
                image_rgb,
                parsed_boxes,
                num_slices=min(max(5, int(num_slices)), 64),
            )
            return [
                {
                    "text_box_id": p.text_box_id,
                    "bbox": list(p.bbox),
                    "polygon": [list(pt) for pt in p.polygon],
                    "scanline_ratios": p.scanline_ratios,
                }
                for p in profiles
            ]

        try:
            profiles_data = await asyncio.to_thread(_process)
        except Exception as err:
            LOGGER.exception("detect_bubbles failed: %s", err)
            raise HTTPException(status_code=500, detail=f"Bubble detection failed: {err}")

        return {"profiles": profiles_data}

    return app


def _dir_stats(path: Path) -> dict[str, int]:
    """Recursive byte and file counts; tolerant of missing or unreadable dirs."""
    total_bytes = 0
    file_count = 0
    try:
        with os.scandir(path) as entries:
            for entry in entries:
                try:
                    if entry.is_dir(follow_symlinks=False):
                        sub = _dir_stats(Path(entry.path))
                        total_bytes += sub["bytes"]
                        file_count += sub["fileCount"]
                    else:
                        total_bytes += entry.stat().st_size
                        file_count += 1
                except OSError:
                    continue
    except OSError:
        pass
    return {"bytes": total_bytes, "fileCount": file_count}


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
