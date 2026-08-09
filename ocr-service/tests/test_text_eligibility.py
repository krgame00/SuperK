from collections.abc import Callable

import cv2
import numpy as np
import pytest

from app.mask_refiner import MaskRegion
from app.page_context import PageContext, PageFeatures
from app.protection import ProtectionResult
from app.schemas import (
    AutomaticAction,
    PageRole,
    PixelRect,
    ProtectionReason,
    TextRole,
)
from app.text_eligibility import (
    EligibilityFeatures,
    classify_eligibility,
    extract_eligibility_features,
)


def _page(role: PageRole = PageRole.COMIC) -> PageContext:
    return PageContext(
        role=role,
        confidence=0.95,
        features=PageFeatures(0.1, 0.1, 0.1, 0.1, 0),
    )


def _region() -> MaskRegion:
    return MaskRegion(
        id="region-1",
        rect=PixelRect(x=30, y=30, width=40, height=20),
        component_ids=(1,),
        stroke_radius=2,
    )


def _mask() -> np.ndarray:
    mask = np.zeros((100, 100), np.uint8)
    mask[35:45, 40:60] = 255
    return mask


def _protection(
    *,
    protected: bool = False,
    review: bool = False,
) -> ProtectionResult:
    protected_mask = np.zeros((100, 100), np.uint8)
    review_mask = np.zeros_like(protected_mask)
    if protected:
        protected_mask[35:45, 40:60] = 255
    if review:
        review_mask[35:45, 40:60] = 255
    return ProtectionResult(protected_mask, review_mask, [])


def _extractor(
    features: EligibilityFeatures,
) -> Callable[..., EligibilityFeatures]:
    return lambda *_args: features


def _features(
    *,
    enclosure: float = 0,
    uniformity: float = 0,
    rectangular: float = 0,
    artwork_edges: float = 0,
    irregularity: float = 0,
) -> EligibilityFeatures:
    return EligibilityFeatures(
        enclosure_score=enclosure,
        backing_uniformity=uniformity,
        rectangular_backing=rectangular,
        artwork_edge_density=artwork_edges,
        stroke_irregularity=irregularity,
        margin_fraction=0,
    )


def _classify(
    features: EligibilityFeatures,
    *,
    page: PageContext | None = None,
    protection: ProtectionResult | None = None,
):
    return classify_eligibility(
        np.full((100, 100, 3), 255, np.uint8),
        _mask(),
        _region(),
        page or _page(),
        protection or _protection(),
        feature_extractor=_extractor(features),
    )


def test_enclosed_text_is_automatic_dialogue() -> None:
    decision = _classify(_features(enclosure=0.88))

    assert decision.text_role is TextRole.DIALOGUE
    assert decision.action is AutomaticAction.CLEAN


def test_bubble_outline_beyond_stroke_padding_is_detected() -> None:
    image = np.full((100, 100, 3), 255, np.uint8)
    cv2.ellipse(image, (50, 40), (32, 20), 0, 0, 360, (0, 0, 0), 2)
    image[35:45, 40:60] = 0

    decision = classify_eligibility(
        image,
        _mask(),
        _region(),
        _page(),
        _protection(),
    )

    assert decision.features.enclosure_score >= 0.72
    assert decision.text_role is TextRole.DIALOGUE
    assert decision.action is AutomaticAction.CLEAN


def test_local_artwork_edges_are_not_diluted_by_bubble_search_area() -> None:
    image = np.full((100, 100, 3), 255, np.uint8)
    image[26:28, 24:76] = 0
    image[52:54, 24:76] = 0

    features = extract_eligibility_features(
        image,
        _mask(),
        _region(),
    )

    assert features.artwork_edge_density >= 0.30


def test_rectangular_caption_without_bubble_is_automatic_narration() -> None:
    decision = _classify(
        _features(uniformity=0.90, rectangular=0.90),
    )

    assert decision.text_role is TextRole.NARRATION
    assert decision.confidence >= 0.82
    assert decision.action is AutomaticAction.CLEAN


def test_uniform_caption_can_be_narration_without_visible_border() -> None:
    decision = _classify(
        _features(uniformity=0.90, rectangular=0),
    )

    assert decision.text_role is TextRole.NARRATION
    assert decision.action is AutomaticAction.CLEAN


def test_high_confidence_artwork_text_is_sfx() -> None:
    decision = _classify(
        _features(artwork_edges=0.95, irregularity=0.95),
    )

    assert decision.text_role is TextRole.SFX
    assert decision.confidence >= 0.90
    assert decision.action is AutomaticAction.PRESERVE
    assert decision.protection_reasons == [ProtectionReason.SFX_POLICY]


def test_irregular_free_text_can_be_sfx_without_dense_artwork() -> None:
    decision = _classify(
        _features(artwork_edges=0.78, irregularity=0.99),
    )

    assert decision.text_role is TextRole.SFX
    assert decision.confidence >= 0.90
    assert decision.action is AutomaticAction.PRESERVE
    assert decision.protection_reasons == [ProtectionReason.SFX_POLICY]


def test_margin_review_text_is_attempted_on_comic_page() -> None:
    decision = _classify(
        _features(enclosure=1),
        protection=_protection(review=True),
    )

    assert decision.action is AutomaticAction.CLEAN
    assert decision.text_role is TextRole.REVIEW
    assert ProtectionReason.MARGIN_MARK in decision.protection_reasons


def test_low_confidence_comic_text_is_attempted_for_review() -> None:
    decision = _classify(_features())

    assert decision.action is AutomaticAction.CLEAN
    assert decision.text_role is TextRole.REVIEW
    assert ProtectionReason.LOW_CONFIDENCE in decision.protection_reasons


def test_qr_intersection_remains_preserved_on_comic_page() -> None:
    decision = _classify(
        _features(enclosure=1),
        protection=_protection(protected=True),
    )

    assert decision.action is AutomaticAction.PRESERVE
    assert decision.text_role is TextRole.PROTECTED


def test_credit_page_preserves_detected_text() -> None:
    decision = _classify(
        _features(enclosure=1),
        page=_page(PageRole.CREDITS),
    )

    assert decision.text_role is TextRole.PROTECTED
    assert decision.action is AutomaticAction.PRESERVE
    assert decision.protection_reasons == [ProtectionReason.CREDIT_PAGE]


@pytest.mark.parametrize("role", [PageRole.UI, PageRole.UNKNOWN])
def test_confident_dialogue_is_cleaned_on_noncredit_pages(
    role: PageRole,
) -> None:
    decision = _classify(
        _features(enclosure=1),
        page=_page(role),
    )

    assert decision.text_role is TextRole.DIALOGUE
    assert decision.action is AutomaticAction.CLEAN
    assert decision.protection_reasons == []


@pytest.mark.parametrize("role", [PageRole.UI, PageRole.UNKNOWN])
def test_confident_narration_is_cleaned_on_noncredit_pages(
    role: PageRole,
) -> None:
    decision = _classify(
        _features(uniformity=0.9, rectangular=0.9),
        page=_page(role),
    )

    assert decision.text_role is TextRole.NARRATION
    assert decision.action is AutomaticAction.CLEAN
    assert decision.protection_reasons == []


@pytest.mark.parametrize(
    "role",
    [PageRole.COMIC, PageRole.UI, PageRole.UNKNOWN],
)
def test_small_unenclosed_label_is_preserved(role: PageRole) -> None:
    image = np.full((100, 100, 3), 255, np.uint8)
    mask = np.zeros((100, 100), np.uint8)
    mask[30:34, 30:40] = 255
    region = MaskRegion(
        id="ui-label",
        rect=PixelRect(x=30, y=30, width=10, height=4),
        component_ids=(1,),
        stroke_radius=1,
    )

    decision = classify_eligibility(
        image,
        mask,
        region,
        _page(role),
        _protection(),
        feature_extractor=_extractor(_features()),
    )

    assert decision.text_role is TextRole.PROTECTED
    assert decision.action is AutomaticAction.PRESERVE
    assert decision.protection_reasons == [ProtectionReason.LOW_CONFIDENCE]


@pytest.mark.parametrize(
    ("score", "expected_role"),
    [
        (0.819, TextRole.REVIEW),
        (0.820, TextRole.NARRATION),
    ],
)
def test_narration_threshold_only_changes_semantic_role(
    score: float,
    expected_role: TextRole,
) -> None:
    decision = _classify(
        _features(uniformity=score, rectangular=score),
    )

    assert decision.action is AutomaticAction.CLEAN
    assert decision.text_role is expected_role
    assert (
        ProtectionReason.LOW_CONFIDENCE in decision.protection_reasons
    ) is (expected_role is TextRole.REVIEW)


@pytest.mark.parametrize(
    ("score", "expected_role", "expected_action", "expected_reason"),
    [
        (
            0.899,
            TextRole.REVIEW,
            AutomaticAction.CLEAN,
            ProtectionReason.LOW_CONFIDENCE,
        ),
        (
            0.900,
            TextRole.SFX,
            AutomaticAction.PRESERVE,
            ProtectionReason.SFX_POLICY,
        ),
    ],
)
def test_sfx_threshold_controls_preservation(
    score: float,
    expected_role: TextRole,
    expected_action: AutomaticAction,
    expected_reason: ProtectionReason,
) -> None:
    decision = _classify(
        _features(artwork_edges=score, irregularity=score),
    )

    assert decision.text_role is expected_role
    assert decision.action is expected_action
    assert decision.protection_reasons == [expected_reason]
