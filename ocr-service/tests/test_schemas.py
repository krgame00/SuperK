from pydantic import ValidationError

from app.schemas import CleanerRoute, CleaningResult, PixelRect
from app.settings import Settings


def test_pixel_rect_rejects_non_positive_size() -> None:
    try:
        PixelRect(x=0, y=0, width=0, height=10)
    except ValidationError:
        return
    raise AssertionError("zero-width rect must be rejected")


def test_cleaning_result_uses_stable_asset_paths() -> None:
    result = CleaningResult(
        job_id="job-1",
        source_hash="a" * 64,
        width=1200,
        height=1800,
        clean_asset="/v1/jobs/job-1/assets/clean.png",
        mask_asset="/v1/jobs/job-1/assets/mask.png",
        regions=[],
        timings_ms={"total": 1234},
    )
    assert result.clean_asset.endswith("/clean.png")
    assert CleanerRoute.ARTWORK.value == "artwork"


def test_settings_use_single_cpu_worker_by_default() -> None:
    settings = Settings(_env_file=None)
    assert settings.max_workers == 1
    assert settings.max_upload_mb == 80
    assert str(settings.service_url) == "http://127.0.0.1:8765/"
