from collections.abc import Callable

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
from app.text_eligibility import EligibilityFeatures, classify_eligibility


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


def test_rectangular_caption_without_bubble_is_automatic_narration() -> None:
    decision = _classify(
        _features(uniformity=0.90, rectangular=0.90),
    )

    assert decision.text_role is TextRole.NARRATION
    assert decision.confidence >= 0.82
    assert decision.action is AutomaticAction.CLEAN


def test_high_confidence_artwork_text_is_sfx() -> None:
    decision = _classify(
        _features(artwork_edges=0.95, irregularity=0.95),
    )

    assert decision.text_role is TextRole.SFX
    assert decision.confidence >= 0.90
    assert decision.action is AutomaticAction.CLEAN


def test_margin_text_is_preserved_for_review() -> None:
    decision = _classify(
        _features(enclosure=1),
        protection=_protection(review=True),
    )

    assert decision.action is AutomaticAction.PRESERVE
    assert decision.text_role is TextRole.REVIEW
    assert ProtectionReason.MARGIN_MARK in decision.protection_reasons


def test_non_comic_page_is_never_automatically_cleaned() -> None:
    decision = _classify(
        _features(enclosure=1),
        page=_page(PageRole.CREDITS),
    )

    assert decision.text_role is TextRole.PROTECTED
    assert decision.action is AutomaticAction.PRESERVE
    assert ProtectionReason.CREDIT_PAGE in decision.protection_reasons


@pytest.mark.parametrize(
    ("score", "expected"),
    [
        (0.819, AutomaticAction.PRESERVE),
        (0.820, AutomaticAction.CLEAN),
    ],
)
def test_narration_threshold_is_conservative(
    score: float,
    expected: AutomaticAction,
) -> None:
    decision = _classify(
        _features(uniformity=score, rectangular=score),
    )

    assert decision.action is expected


@pytest.mark.parametrize(
    ("score", "expected"),
    [
        (0.899, AutomaticAction.PRESERVE),
        (0.900, AutomaticAction.CLEAN),
    ],
)
def test_sfx_threshold_is_conservative(
    score: float,
    expected: AutomaticAction,
) -> None:
    decision = _classify(
        _features(artwork_edges=score, irregularity=score),
    )

    assert decision.action is expected
