from dataclasses import replace

import numpy as np
import pytest
from test_pipeline import (
    NoTextDetector,
    SolidCleaner,
    _clean_decision,
    _comic_page,
    _empty_protection,
    _single_region_output,
)

from app.mask_refiner import MaskRegion, RefinedMask
from app.pipeline import CleaningPipeline
from app.schemas import AutomaticAction, ManualRegionAction, PixelRect, TextRole


@pytest.mark.parametrize("batched", [False, True])
def test_review_label_never_authorizes_removal_and_confident_region_continues(batched):
    image = np.full((48, 48, 3), 100, np.uint8)
    mask = np.zeros((48, 48), np.uint8)
    mask[4:12, 4:12] = 255
    mask[28:36, 28:36] = 255
    regions = [MaskRegion(str(i), PixelRect(x=p, y=p, width=8, height=8), (i,), 1) for i, p in enumerate([4, 28])]
    def classify(*args):
        decision = _clean_decision()
        if args[2].id == "0":
            decision = decision.model_copy(update={"text_role": TextRole.REVIEW, "action": AutomaticAction.CLEAN})
        return decision
    pipeline = CleaningPipeline(
        detector=NoTextDetector(),
        cleaners={k: SolidCleaner(99) for k in ["flat", "gradient", "artwork"]},
        refiner=lambda *_: RefinedMask(mask, regions, np.zeros_like(mask)),
        page_classifier=_comic_page,
        protection_detector=_empty_protection,
        eligibility_classifier=classify,
    )
    if batched:
        class Probe:
            def score_many(self, _image, pairs):
                return {region.id: 0.0 for region, _ in pairs}
        pipeline.residual_probe = Probe()
    output = pipeline.run(image)
    assert np.array_equal(output.clean_image[4:12, 4:12], image[4:12, 4:12])
    assert not output.mask[4:12, 4:12].any()
    assert output.review_mask[4:12, 4:12].any()
    assert (output.clean_image[28:36, 28:36] == 99).all()
    assert not output.awaiting_review  # regional uncertainty is not preparation failure


def test_force_clean_requires_text_confirmation():
    pipeline = CleaningPipeline(detector=NoTextDetector(), cleaners={"flat": SolidCleaner(0)})
    output = _single_region_output()
    mask = np.zeros_like(output.mask)
    mask[8:20, 8:20] = 255
    with pytest.raises(ValueError, match="confirm"):
        pipeline.retry_region(output, "region-1", mask, "flat", ManualRegionAction.FORCE_CLEAN)


def test_confirm_then_approve_changes_only_inspected_mask():
    pipeline = CleaningPipeline(detector=NoTextDetector(), cleaners={"flat": SolidCleaner(0)})
    original = _single_region_output()
    mask = np.zeros_like(original.mask)
    mask[9:11, 9:11] = 255
    confirmed = pipeline.retry_region(original, "region-1", mask, "flat", ManualRegionAction("confirm-text"))
    assert np.array_equal(confirmed.clean_image, original.clean_image)
    assert not confirmed.mask.any()
    assert confirmed.regions[0].text_confirmed
    assert not confirmed.regions[0].mask_approved
    approved = pipeline.retry_region(confirmed, "region-1", mask, "flat", ManualRegionAction.FORCE_CLEAN)
    assert np.array_equal(approved.clean_image[mask == 0], original.clean_image[mask == 0])
    assert (approved.clean_image[mask > 0] == 0).all()
    assert approved.regions[0].mask_approved
    changed = mask.copy()
    changed[12, 12] = 255
    with pytest.raises(ValueError, match="approval"):
        pipeline.retry_region(approved, "region-1", changed, "flat", ManualRegionAction.AUTOMATIC)


def test_force_clean_shrinking_mask_restores_erased_pixels_and_replaces_region_mask():
    pipeline = CleaningPipeline(detector=NoTextDetector(), cleaners={"flat": SolidCleaner(0)})
    original = _single_region_output()
    previous_mask = np.zeros_like(original.mask)
    previous_mask[9:15, 9:15] = 255
    already_cleaned = original.clean_image.copy()
    already_cleaned[previous_mask > 0] = 0
    confirmed_record = original.regions[0].model_copy(update={"text_confirmed": True})
    previous = replace(
        original,
        clean_image=already_cleaned,
        mask=previous_mask,
        regions=[confirmed_record],
    )

    edited_mask = np.zeros_like(previous_mask)
    edited_mask[10:12, 10:12] = 255
    retried = pipeline.retry_region(
        previous,
        "region-1",
        edited_mask,
        "flat",
        ManualRegionAction.FORCE_CLEAN,
    )

    erased_from_mask = (previous_mask > 0) & (edited_mask == 0)
    assert np.array_equal(
        retried.clean_image[erased_from_mask],
        previous.source_image[erased_from_mask],
    )
    assert (retried.clean_image[edited_mask > 0] == 0).all()
    assert np.array_equal(retried.mask, edited_mask)


def test_force_clean_empty_edited_mask_restores_region_instead_of_reusing_old_clean():
    pipeline = CleaningPipeline(detector=NoTextDetector(), cleaners={"flat": SolidCleaner(0)})
    original = _single_region_output()
    previous_mask = np.zeros_like(original.mask)
    previous_mask[9:15, 9:15] = 255
    already_cleaned = original.clean_image.copy()
    already_cleaned[previous_mask > 0] = 0
    confirmed_record = original.regions[0].model_copy(update={"text_confirmed": True})
    previous = replace(
        original,
        clean_image=already_cleaned,
        mask=previous_mask,
        regions=[confirmed_record],
    )

    empty_mask = np.zeros_like(previous_mask)
    retried = pipeline.retry_region(
        previous,
        "region-1",
        empty_mask,
        "flat",
        ManualRegionAction.FORCE_CLEAN,
    )

    selected = previous_mask > 0
    assert np.array_equal(retried.clean_image[selected], previous.source_image[selected])
    assert not retried.mask.any()
    assert retried.regions[0].text_confirmed
    assert retried.regions[0].mask_approved


@pytest.mark.parametrize("confidence", [0.59, 0.60, 0.90])
def test_real_hybrid_path_preserves_isolated_stroke_for_review(confidence):
    from app.detector import DetectedBlock, DetectionResult, HybridTextDetector, LetterboxTransform
    class CTD:
        def detect(self, image):
            prob = np.zeros(image.shape[:2], np.float32)
            prob[30:70, 49:51] = 0.30
            return DetectionResult(
                prob,
                [DetectedBlock(PixelRect(x=20, y=20, width=60, height=60), confidence)],
                LetterboxTransform(100, 100, 100, 1, 0, 0),
            )
    image = np.full((100, 100, 3), 255, np.uint8)
    image[30:70, 49:51] = 0
    pipeline = CleaningPipeline(detector=HybridTextDetector(CTD(), paddle_engine=None),
        cleaners={k: SolidCleaner(255) for k in ["flat", "gradient", "artwork"]},
        page_classifier=_comic_page, protection_detector=_empty_protection, eligibility_classifier=_clean_decision)
    result = pipeline.run(image)
    assert result.regions
    assert all(not r.text_confirmed for r in result.regions)
    assert result.review_mask.any()
    assert not result.mask.any()
    assert np.array_equal(result.clean_image, image)


def test_job_restart_retains_confirmation_and_exact_mask_approval(tmp_path):
    import io

    from PIL import Image
    from test_jobs import _make_png, _wait_for_job

    from app.jobs import JobStore

    class Pipeline(CleaningPipeline):
        def run(self, image, progress_callback=None):
            return replace(_single_region_output(), source_image=image, clean_image=image.copy())

    def factory():
        return Pipeline(detector=NoTextDetector(), cleaners={"flat": SolidCleaner(0)})
    store = JobStore(pipeline_factory=factory, cache_dir=tmp_path)
    try:
        initial = store.submit(_make_png(32, 32), "test.png")
        _wait_for_job(store, initial)
        mask = np.zeros((32, 32), np.uint8)
        mask[10:12, 10:12] = 255
        buffer = io.BytesIO()
        Image.fromarray(mask).save(buffer, format="PNG")
        confirmed = store.submit_retry(initial, "region-1", buffer.getvalue(), "flat", ManualRegionAction.CONFIRM_TEXT)
        assert _wait_for_job(store, confirmed).result.regions[0].text_confirmed
        approved = store.submit_retry(confirmed, "region-1", buffer.getvalue(), "flat", ManualRegionAction.FORCE_CLEAN)
        result = _wait_for_job(store, approved).result
        assert result.regions[0].approval_revision
    finally:
        store.shutdown()
    restored = JobStore(pipeline_factory=factory, cache_dir=tmp_path)
    try:
        assert restored.get(approved).result.regions == result.regions
        assert not restored.get(initial).result.regions[0].text_confirmed
    finally:
        restored.shutdown()
