from pydantic import ValidationError

from app.schemas import (
    AutomaticAction,
    CleanerRoute,
    CleaningResult,
    PageRole,
    PixelRect,
    ProtectionReason,
    RegionRecord,
    RegionStatus,
    TextRole,
)
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
        review_mask_asset="/v1/jobs/job-1/assets/review-mask.png",
        protected_mask_asset="/v1/jobs/job-1/assets/protected-mask.png",
        regions=[],
        timings_ms={"total": 1234},
    )
    assert result.clean_asset.endswith("/clean.png")
    assert CleanerRoute.ARTWORK.value == "artwork"


def test_region_contract_describes_eligibility() -> None:
    record = RegionRecord(
        id="region-1",
        rect={"x": 10, "y": 20, "width": 30, "height": 40},
        route="flat",
        confidence=0.9,
        status=RegionStatus.PRESERVED,
        residual_score=0,
        damage_score=0,
        page_role=PageRole.COMIC,
        text_role=TextRole.NARRATION,
        eligibility_confidence=0.81,
        automatic_action=AutomaticAction.PRESERVE,
        protection_reasons=[ProtectionReason.LOW_CONFIDENCE],
    )

    assert record.automatic_action is AutomaticAction.PRESERVE
    assert record.protection_reasons == [ProtectionReason.LOW_CONFIDENCE]


def test_settings_use_single_cpu_worker_by_default() -> None:
    settings = Settings(_env_file=None)
    assert settings.max_workers == 1
    assert settings.max_upload_mb == 80
    assert str(settings.service_url) == "http://127.0.0.1:8765/"
