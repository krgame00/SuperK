from __future__ import annotations

import io
import threading
import time
from collections.abc import Iterator
from dataclasses import dataclass

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.api import create_app
from app.pipeline import PipelineOutput
from app.settings import Settings


@pytest.fixture
def png_bytes() -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (8, 8), (240, 240, 240)).save(output, format="PNG")
    return output.getvalue()


@pytest.fixture
def client(tmp_path) -> Iterator[TestClient]:
    app = create_app(
        settings=Settings(cache_dir=tmp_path, max_workers=1),
        pipeline_factory=lambda: _IdentityPipeline(),
    )
    with TestClient(app) as test_client:
        yield test_client


def test_create_job_returns_202(client: TestClient, png_bytes: bytes) -> None:
    response = client.post(
        "/v1/jobs",
        files={"image": ("page.png", png_bytes, "image/png")},
    )
    assert response.status_code == 202
    assert response.json()["status"] == "queued"
    assert response.json()["stage"] == "queued"


def test_upload_rejects_unsupported_media_type(client: TestClient) -> None:
    response = client.post(
        "/v1/jobs",
        files={"image": ("page.txt", b"x", "text/plain")},
    )
    assert response.status_code == 415


def test_upload_rejects_invalid_image_magic(
    client: TestClient,
) -> None:
    response = client.post(
        "/v1/jobs",
        files={"image": ("page.png", b"not a png", "image/png")},
    )
    assert response.status_code == 415


def test_upload_rejects_oversize_body(tmp_path) -> None:
    app = create_app(
        settings=Settings(cache_dir=tmp_path, max_upload_mb=1),
        pipeline_factory=lambda: _IdentityPipeline(),
    )
    with TestClient(app) as client:
        response = client.post(
            "/v1/jobs",
            files={
                "image": (
                    "large.png",
                    b"\x89PNG\r\n\x1a\n" + b"x" * (1024 * 1024),
                    "image/png",
                ),
            },
        )
    assert response.status_code == 413


def test_job_lifecycle_result_and_assets(
    client: TestClient,
    png_bytes: bytes,
) -> None:
    created = client.post(
        "/v1/jobs",
        files={"image": ("page.png", png_bytes, "image/png")},
    ).json()
    job = _wait_for_terminal(client, created["job_id"])
    assert job["status"] == "succeeded"
    assert job["stage"] == "complete"
    assert job["progress"]["elapsed_ms"] >= 0

    result_response = client.get(f"/v1/jobs/{created['job_id']}/result")
    assert result_response.status_code == 200
    result = result_response.json()
    assert result["width"] == 8
    assert result["height"] == 8
    assert result["clean_asset"].endswith("/assets/clean.png")
    assert result["mask_asset"].endswith("/assets/mask.png")
    assert result["review_mask_asset"].endswith("/assets/review-mask.png")
    assert result["protected_mask_asset"].endswith(
        "/assets/protected-mask.png",
    )

    clean = client.get(result["clean_asset"])
    mask = client.get(result["mask_asset"])
    review_mask = client.get(result["review_mask_asset"])
    protected_mask = client.get(result["protected_mask_asset"])
    assert clean.status_code == 200
    assert clean.headers["content-type"] == "image/png"
    assert mask.status_code == 200
    assert review_mask.status_code == 200
    assert protected_mask.status_code == 200
    assert clean.content.startswith(b"\x89PNG")
    assert mask.content.startswith(b"\x89PNG")
    assert client.get(f"/v1/jobs/{created['job_id']}").headers[
        "cache-control"
    ] == "no-store"


def test_result_before_completion_returns_409(
    tmp_path,
    png_bytes: bytes,
) -> None:
    release = threading.Event()
    app = create_app(
        settings=Settings(cache_dir=tmp_path),
        pipeline_factory=lambda: _BlockingPipeline(release),
    )
    with TestClient(app) as client:
        created = client.post(
            "/v1/jobs",
            files={"image": ("page.png", png_bytes, "image/png")},
        ).json()
        response = client.get(f"/v1/jobs/{created['job_id']}/result")
        release.set()
    assert response.status_code == 409


def test_executor_never_runs_two_jobs_at_once(
    tmp_path,
    png_bytes: bytes,
) -> None:
    tracker = _ConcurrencyTracker()
    app = create_app(
        settings=Settings(cache_dir=tmp_path, max_workers=1),
        pipeline_factory=lambda: _TrackedPipeline(tracker),
    )
    with TestClient(app) as client:
        ids = [
            client.post(
                "/v1/jobs",
                files={"image": (f"page-{index}.png", png_bytes, "image/png")},
            ).json()["job_id"]
            for index in range(2)
        ]
        for job_id in ids:
            assert _wait_for_terminal(client, job_id)["status"] == "succeeded"
    assert tracker.max_active == 1


def test_region_retry_creates_derived_job_without_overwriting_parent(
    tmp_path,
    png_bytes: bytes,
) -> None:
    pipeline = _RetryPipeline()
    app = create_app(
        settings=Settings(cache_dir=tmp_path),
        pipeline_factory=lambda: pipeline,
    )
    with TestClient(app) as client:
        parent_id = client.post(
            "/v1/jobs",
            files={"image": ("page.png", png_bytes, "image/png")},
        ).json()["job_id"]
        parent = _wait_for_terminal(client, parent_id)
        assert parent["status"] == "succeeded"
        parent_job_state = app.state.job_store.get(parent_id)
        assert parent_job_state.output is None  # Verify RAM eviction
        assert parent_job_state.source_bytes == b""  # Verify bytes eviction

        source_asset = client.get(f"/v1/jobs/{parent_id}/assets/source.png")
        assert source_asset.status_code == 200

        original_asset = client.get(
            f"/v1/jobs/{parent_id}/assets/clean.png",
        ).content

        response = client.post(
            f"/v1/jobs/{parent_id}/regions/region-1/retry",
            files={"mask": ("mask.png", _mask_png(), "image/png")},
            data={"cleaner": "opencv", "action": "protect"},
        )
        assert response.status_code == 202
        derived_id = response.json()["job_id"]
        assert derived_id != parent_id
        assert _wait_for_terminal(client, derived_id)["status"] == "succeeded"
        assert pipeline.retry_cleaner == "opencv"
        assert pipeline.retry_action == "protect"
        assert (
            client.get(f"/v1/jobs/{parent_id}/assets/clean.png").content
            == original_asset
        )


def test_failure_does_not_expose_filesystem_path(
    tmp_path,
    png_bytes: bytes,
) -> None:
    app = create_app(
        settings=Settings(cache_dir=tmp_path),
        pipeline_factory=lambda: _FailingPipeline(),
    )
    with TestClient(app) as client:
        created = client.post(
            "/v1/jobs",
            files={"image": ("page.png", png_bytes, "image/png")},
        ).json()
        job = _wait_for_terminal(client, created["job_id"])
    assert job["status"] == "failed"
    assert "C:\\" not in job["error"]
    assert "/secret/" not in job["error"]


def _wait_for_terminal(client: TestClient, job_id: str) -> dict[str, object]:
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        response = client.get(f"/v1/jobs/{job_id}")
        assert response.status_code == 200
        job = response.json()
        if job["status"] in {"succeeded", "failed"}:
            return job
        time.sleep(0.01)
    raise AssertionError("job did not finish")


class _IdentityPipeline:
    def run(self, image_rgb, progress_callback=None) -> PipelineOutput:
        if progress_callback is not None:
            from app.schemas import JobStage

            progress_callback(JobStage.CLEANING, 0, 0)
        return PipelineOutput(
            source_image=image_rgb.copy(),
            clean_image=image_rgb.copy(),
            mask=np.zeros(image_rgb.shape[:2], np.uint8),
            review_mask=np.zeros(image_rgb.shape[:2], np.uint8),
            protected_mask=np.zeros(image_rgb.shape[:2], np.uint8),
            regions=[],
            timings_ms={"total": 1},
        )


class _BlockingPipeline(_IdentityPipeline):
    def __init__(self, release: threading.Event) -> None:
        self.release = release

    def run(self, image_rgb, progress_callback=None) -> PipelineOutput:
        self.release.wait(timeout=2)
        return super().run(image_rgb, progress_callback)


@dataclass
class _ConcurrencyTracker:
    active: int = 0
    max_active: int = 0

    def __post_init__(self) -> None:
        self.lock = threading.Lock()


class _TrackedPipeline(_IdentityPipeline):
    def __init__(self, tracker: _ConcurrencyTracker) -> None:
        self.tracker = tracker

    def run(self, image_rgb, progress_callback=None) -> PipelineOutput:
        with self.tracker.lock:
            self.tracker.active += 1
            self.tracker.max_active = max(
                self.tracker.max_active,
                self.tracker.active,
            )
        time.sleep(0.04)
        with self.tracker.lock:
            self.tracker.active -= 1
        return super().run(image_rgb, progress_callback)


class _FailingPipeline:
    def run(self, image_rgb, progress_callback=None) -> PipelineOutput:
        raise RuntimeError("failed at C:\\secret\\model.onnx and /secret/model")


class _RetryPipeline(_IdentityPipeline):
    retry_cleaner: str | None = None
    retry_action: str | None = None

    def retry_region(
        self,
        output: PipelineOutput,
        region_id: str,
        mask,
        cleaner: str,
        action,
    ) -> PipelineOutput:
        self.retry_cleaner = cleaner
        self.retry_action = action.value
        clean = output.clean_image.copy()
        clean[mask > 0] = 128
        return PipelineOutput(
            source_image=output.source_image,
            clean_image=clean,
            mask=np.maximum(output.mask, mask),
            review_mask=output.review_mask,
            protected_mask=output.protected_mask,
            regions=output.regions,
            timings_ms={"total": 1},
        )


def _mask_png() -> bytes:
    output = io.BytesIO()
    Image.new("L", (8, 8), 255).save(output, format="PNG")
    return output.getvalue()
