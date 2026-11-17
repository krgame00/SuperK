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
    light: float = 0,
) -> EligibilityFeatures:
    return EligibilityFeatures(
        enclosure_score=enclosure,
        backing_uniformity=uniformity,
        rectangular_backing=rectangular,
        artwork_edge_density=artwork_edges,
        stroke_irregularity=irregularity,
        margin_fraction=0,
        backing_light_fraction=light,
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


def test_high_confidence_artwork_text_is_sfx_preserved() -> None:
    decision = _classify(
        _features(artwork_edges=0.95, irregularity=0.95),
    )

    assert decision.text_role is TextRole.SFX
    assert decision.confidence >= 0.90
    assert decision.action is AutomaticAction.PRESERVE
    assert ProtectionReason.SFX_POLICY in decision.protection_reasons


def test_irregular_free_text_can_be_sfx_preserved() -> None:
    decision = _classify(
        _features(artwork_edges=0.78, irregularity=0.99),
    )

    assert decision.text_role is TextRole.SFX
    assert decision.confidence >= 0.90
    assert decision.action is AutomaticAction.PRESERVE
    assert ProtectionReason.SFX_POLICY in decision.protection_reasons


def test_stylized_sfx_over_rectangular_backing_is_preserved() -> None:
    # SFX lettering drawn over a screentone panel or a hand-drawn frame: the
    # backing reads rectangular, but the strokes are clearly stylized. Erasing
    # artwork is irreversible, so strong SFX evidence must outrank the backing
    # shape instead of falling through to the narration caption branch. The
    # role label keeps its strict gate (it feeds the translation scope), but
    # the action is always preserve.
    decision = _classify(
        _features(
            rectangular=0.80,
            uniformity=0.70,
            artwork_edges=0.60,
            irregularity=0.72,
        ),
    )

    assert decision.action is AutomaticAction.PRESERVE
    assert decision.text_role in (TextRole.SFX, TextRole.REVIEW)
    assert decision.text_role is not TextRole.NARRATION


def test_stylized_sfx_over_uniform_backing_is_preserved() -> None:
    # Same rule for SFX drawn directly on flat sky or screentone: the uniform
    # backing alone must not promote the region to narration (which cleans).
    decision = _classify(
        _features(
            uniformity=0.80,
            artwork_edges=0.55,
            irregularity=0.65,
        ),
    )

    assert decision.action is AutomaticAction.PRESERVE
    assert decision.text_role in (TextRole.SFX, TextRole.REVIEW)
    assert decision.text_role is not TextRole.NARRATION


def test_plain_bubble_text_next_to_busy_artwork_is_cleaned() -> None:
    # Webtoon speech balloons routinely sit against dense artwork (characters,
    # screentone). Those edges belong to the surroundings, not to the lettering:
    # regular strokes on a uniform LIGHT backing are a balloon/caption, so the
    # SFX suspicion branches must not capture it and leave readable dialogue
    # preserved forever. Feature values are the ones measured on a real missed
    # balloon (user report 2026-11-15).
    decision = _classify(
        _features(
            uniformity=0.91,
            artwork_edges=0.67,
            irregularity=0.28,
            light=0.71,
        ),
    )

    assert decision.text_role is TextRole.NARRATION
    assert decision.action is AutomaticAction.CLEAN


def test_plain_text_on_dark_uniform_backing_stays_conservative() -> None:
    # Uniformity alone cannot separate a balloon interior from lettering printed
    # on smooth fabric or art: lightness is the tone discriminator, so a dark
    # uniform backing keeps the artwork-irreversibility path.
    decision = _classify(
        _features(
            uniformity=0.85,
            artwork_edges=0.60,
            irregularity=0.20,
            light=0.10,
        ),
    )

    assert decision.action is AutomaticAction.PRESERVE
    assert decision.text_role in (TextRole.SFX, TextRole.REVIEW)
    assert decision.text_role is not TextRole.NARRATION


def test_medium_irregular_strokes_on_uniform_backing_stay_conservative() -> None:
    # The bubble rescue is narrow: once the strokes themselves look stylized,
    # the artwork-irreversibility rule still wins over the uniform backing.
    decision = _classify(
        _features(
            uniformity=0.95,
            artwork_edges=0.50,
            irregularity=0.46,
            light=0.95,
        ),
    )

    assert decision.action is AutomaticAction.PRESERVE
    assert decision.text_role is not TextRole.NARRATION


def test_typeset_dialogue_at_the_regularity_boundary_is_rescued() -> None:
    # Measured real pages: a vertical disclaimer at 0.405 and a hand-set
    # balloon at 0.351 sit between the SFX feature threshold (0.35) and the
    # bubble ceiling (0.42); with uniform light backing they are dialogue,
    # not stylized lettering.
    decision = _classify(
        _features(
            uniformity=0.93,
            artwork_edges=0.60,
            irregularity=0.405,
            light=0.77,
        ),
    )

    assert decision.action is AutomaticAction.CLEAN
    assert decision.text_role is TextRole.NARRATION


def test_dark_card_merged_with_artwork_lines_still_yields_enclosure() -> None:
    # A solid dark dialogue card hugging the text with thin artwork lines
    # touching it: RETR_EXTERNAL merges card and lines into a window-filling
    # blob, so the raw pass finds nothing; the opened retry must recover the
    # card under the same area bar.
    from app.text_eligibility import _backing_shape_scores

    window = np.full((315, 546), 235, np.uint8)
    window[40:120, 100:420] = 45  # dark dialogue card wrapping the text rect
    window[20:135, 300:303] = 30  # thin artwork line crossing the card
    window[60:63, 80:440] = 30  # second thin line touching the other edge
    window[130:180, 200:460] = 70  # unrelated dark block below the card

    enclosure, rectangle = _backing_shape_scores(
        window,
        rect_center=(260.0, 80.0),
        minimum_area=325 * 87 * 1.10,
    )

    assert (enclosure, rectangle) == (0.90, 0.0)


def test_thin_artwork_slash_never_yields_enclosure() -> None:
    # A diagonal brush stroke crossing the text rect is bounded but not a
    # card: its opened contour stays far below the text rect's own area.
    from app.text_eligibility import _backing_shape_scores

    window = np.full((105, 106), 235, np.uint8)
    for i in range(38):
        window[31 + i, 0 + i] = 30
        window[32 + i, 0 + i] = 30
        window[31 + i, 1 + i] = 30

    enclosure, rectangle = _backing_shape_scores(
        window,
        rect_center=(53.0, 52.0),
        minimum_area=62 * 61 * 1.10,
    )

    assert (enclosure, rectangle) == (0.0, 0.0)


def test_light_balloon_touching_window_edge_still_yields_enclosure() -> None:
    # User-reported bubble class: an oval balloon clipped by the crop edge
    # fails only the strict bounded-edge guard, so the relaxed rescue must
    # accept the edge-touching contour on interior quality.
    from app.text_eligibility import (
        BUBBLE_REGULARITY_CEILING,
        _closed_light_backing_features,
        _stroke_irregularity,
    )

    rng = np.random.default_rng(7)
    window = rng.integers(40, 71, (200, 200)).astype(np.uint8)
    cv2.ellipse(window, (100, 6), (70, 70), 0, 0, 360, 240, -1)
    text_mask = np.zeros((200, 200), bool)
    for x in range(70, 131, 12):
        text_mask[40:56, x:x + 6] = True
    assert _stroke_irregularity(text_mask) <= BUBBLE_REGULARITY_CEILING

    enclosure, rectangle, uniformity = _closed_light_backing_features(
        window,
        text_mask,
        minimum_area=67 * 16 * 1.10,
    )

    assert (enclosure, rectangle) == (0.90, 0.0)
    assert uniformity >= 0.85


def test_tight_round_balloon_below_area_bar_still_yields_enclosure() -> None:
    # A round balloon fills ~pi/4 of its bounding rect, so the strict 1.10x
    # area bar rejects a balloon the text nearly fills; the relaxed rescue
    # must judge it on interior quality instead.
    from app.text_eligibility import (
        BUBBLE_REGULARITY_CEILING,
        _closed_light_backing_features,
        _stroke_irregularity,
    )

    rng = np.random.default_rng(5)
    window = rng.integers(40, 71, (200, 200)).astype(np.uint8)
    cv2.ellipse(window, (100, 100), (95, 95), 0, 0, 360, 255, -1)
    text_mask = np.zeros((200, 200), bool)
    for x0 in (6, 55, 104, 153):
        text_mask[96:104, x0:x0 + 40] = True
    for y0 in (6, 55, 155):
        text_mask[y0:y0 + 38, 96:104] = True
    assert _stroke_irregularity(text_mask) <= BUBBLE_REGULARITY_CEILING

    enclosure, rectangle, uniformity = _closed_light_backing_features(
        window,
        text_mask,
        minimum_area=187 * 187 * 1.10,
    )

    assert (enclosure, rectangle) == (0.90, 0.0)
    assert uniformity >= 0.85


def test_dark_brush_strokes_on_white_panel_stay_unrescued() -> None:
    # Thin diagonal brush strokes on a white panel pass every light-backing
    # gate; the irregularity ceiling is what keeps stylized lettering out.
    from app.text_eligibility import (
        BUBBLE_REGULARITY_CEILING,
        _closed_light_backing_features,
        _stroke_irregularity,
    )

    window = np.full((120, 160), 235, np.uint8)
    text_mask = np.zeros((120, 160), bool)
    for i in range(50):
        text_mask[30 + i, 20 + i] = True
        text_mask[30 + i, 21 + i] = True
    for i in range(50):
        text_mask[30 + i, 90 + i] = True
        text_mask[31 + i, 90 + i] = True
    assert _stroke_irregularity(text_mask) > BUBBLE_REGULARITY_CEILING

    assert (
        _closed_light_backing_features(
            window,
            text_mask,
            minimum_area=120 * 51 * 1.10,
        )
        is None
    )


def test_screentone_bubble_interior_stays_unrescued() -> None:
    # A bubble whose interior carries screentone fails the uniformity gate
    # (measured SFX interiors sit at uniformity <= 0.79) even though its
    # cover and light fraction clear the relaxed gates.
    from app.text_eligibility import _closed_light_backing_features

    rng = np.random.default_rng(11)
    window = rng.integers(40, 71, (200, 200)).astype(np.uint8)
    cv2.ellipse(window, (100, 6), (70, 70), 0, 0, 360, 255, -1)
    for row in range(12, 72, 8):
        for col in range(36, 168, 8):
            window[row:row + 4, col:col + 4] = 60
    text_mask = np.zeros((200, 200), bool)
    for x in range(70, 131, 12):
        text_mask[40:56, x:x + 6] = True

    assert (
        _closed_light_backing_features(
            window,
            text_mask,
            minimum_area=67 * 16 * 1.10,
        )
        is None
    )


def test_confident_sfx_over_rectangular_backing_is_labeled_sfx() -> None:
    # Highly stylized lettering with a weak rectangle gets the SFX label, so
    # it is protected and kept out of the translation scope on purpose.
    decision = _classify(
        _features(
            rectangular=0.80,
            uniformity=0.70,
            artwork_edges=0.90,
            irregularity=0.95,
        ),
    )

    assert decision.text_role is TextRole.SFX
    assert decision.action is AutomaticAction.PRESERVE
    assert ProtectionReason.SFX_POLICY in decision.protection_reasons


def test_margin_review_text_is_attempted_on_comic_page() -> None:
    decision = _classify(
        _features(enclosure=1),
        protection=_protection(review=True),
    )

    assert decision.action is (
        AutomaticAction.PRESERVE
        if decision.text_role is TextRole.REVIEW
        else AutomaticAction.CLEAN
    )
    assert decision.text_role is TextRole.REVIEW
    assert ProtectionReason.MARGIN_MARK in decision.protection_reasons


def test_low_confidence_comic_text_is_attempted_for_review() -> None:
    decision = _classify(_features())

    assert decision.action is (
        AutomaticAction.PRESERVE
        if decision.text_role is TextRole.REVIEW
        else AutomaticAction.CLEAN
    )
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
        (0.549, TextRole.REVIEW),
        (0.550, TextRole.NARRATION),
    ],
)
def test_narration_threshold_only_changes_semantic_role(
    score: float,
    expected_role: TextRole,
) -> None:
    decision = _classify(
        _features(uniformity=score, rectangular=score),
    )

    assert decision.action is (
        AutomaticAction.PRESERVE
        if decision.text_role is TextRole.REVIEW
        else AutomaticAction.CLEAN
    )
    assert decision.text_role is expected_role
    assert (
        ProtectionReason.LOW_CONFIDENCE in decision.protection_reasons
    ) is (expected_role is TextRole.REVIEW)


@pytest.mark.parametrize(
    ("score", "expected_role", "expected_action", "expected_reasons"),
    [
        (
            0.899,
            TextRole.REVIEW,
            AutomaticAction.PRESERVE,
            [ProtectionReason.LOW_CONFIDENCE],
        ),
        (
            0.900,
            TextRole.SFX,
            AutomaticAction.PRESERVE,
            [ProtectionReason.SFX_POLICY],
        ),
    ],
)
def test_sfx_stylization_controls_role_and_preservation(
    score: float,
    expected_role: TextRole,
    expected_action: AutomaticAction,
    expected_reasons: list[ProtectionReason],
) -> None:
    decision = _classify(
        _features(artwork_edges=score, irregularity=score),
    )

    assert decision.text_role is expected_role
    assert decision.action is expected_action
    assert decision.protection_reasons == expected_reasons


def test_clothing_text_with_artwork_edges_is_preserved() -> None:
    # Text printed on smooth clothing (uniform backing) but surrounded by artwork lines
    # (high artwork_edge_density, not on margin) must be preserved, not cleaned as narration.
    decision = _classify(
        _features(
            uniformity=0.85,
            rectangular=0.0,
            enclosure=0.0,
            artwork_edges=0.60,
            irregularity=0.20,
        ),
    )

    assert decision.action is AutomaticAction.PRESERVE
    assert decision.text_role in (TextRole.SFX, TextRole.REVIEW)


def test_dark_clothing_spanning_crop_is_not_treated_as_enclosure() -> None:
    # A dark sweater or background filling the crop window touching all borders
    # must not be treated as a rectangular caption or dialogue enclosure.
    from app.text_eligibility import _backing_shape_scores

    dark_crop = np.full((120, 156), 50, np.uint8)  # uniform dark sweater
    enclosure, rectangle = _backing_shape_scores(
        dark_crop,
        rect_center=(78.0, 60.0),
        minimum_area=2000.0,
    )

    assert enclosure == 0.0
    assert rectangle == 0.0

