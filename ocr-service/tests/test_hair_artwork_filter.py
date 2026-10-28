import cv2
import numpy as np
import pytest

from app.detector import DetectedBlock, _has_glyph_support
from app.mask_refiner import MaskRegion
from app.page_context import PageContext, PageFeatures
from app.protection import ProtectionResult
from app.schemas import (
    AutomaticAction,
    PageRole,
    PixelRect,
    TextRole,
)
from app.text_eligibility import (
    EligibilityFeatures,
    classify_eligibility,
    extract_eligibility_features,
)


def _page() -> PageContext:
    return PageContext(
        role=PageRole.COMIC,
        confidence=0.95,
        features=PageFeatures(0.1, 0.1, 0.1, 0.1, 0),
    )


def _protection() -> ProtectionResult:
    return ProtectionResult(
        np.zeros((100, 100), np.uint8),
        np.zeros((100, 100), np.uint8),
        [],
    )


def test_marginal_artwork_with_sfx_features_is_preserved() -> None:
    """Hair, linework, or sound effects touching panel margins must NOT be cleaned as narration."""
    features = EligibilityFeatures(
        enclosure_score=0.0,
        backing_uniformity=0.85,
        rectangular_backing=0.0,
        artwork_edge_density=0.75,
        stroke_irregularity=0.55,
        margin_fraction=1.0,
    )
    mask = np.zeros((100, 100), np.uint8)
    mask[0:30, 20:40] = 255
    region = MaskRegion(
        id="hair-region",
        rect=PixelRect(x=20, y=0, width=20, height=30),
        component_ids=(1,),
        stroke_radius=2,
    )
    decision = classify_eligibility(
        np.full((100, 100, 3), 255, np.uint8),
        mask,
        region,
        _page(),
        _protection(),
        feature_extractor=lambda *_args: features,
    )
    assert decision.action is AutomaticAction.PRESERVE
    assert decision.text_role in (TextRole.SFX, TextRole.REVIEW)


def test_borderless_region_with_artwork_edges_is_not_clean_narration() -> None:
    """Borderless text on uniform background must not have high artwork edge density."""
    features = EligibilityFeatures(
        enclosure_score=0.0,
        backing_uniformity=0.70,
        rectangular_backing=0.0,
        artwork_edge_density=0.60,
        stroke_irregularity=0.45,
        margin_fraction=0.0,
    )
    mask = np.zeros((100, 100), np.uint8)
    mask[30:50, 30:50] = 255
    region = MaskRegion(
        id="artwork-region",
        rect=PixelRect(x=30, y=30, width=20, height=20),
        component_ids=(1,),
        stroke_radius=2,
    )
    decision = classify_eligibility(
        np.full((100, 100, 3), 255, np.uint8),
        mask,
        region,
        _page(),
        _protection(),
        feature_extractor=lambda *_args: features,
    )
    assert decision.action is AutomaticAction.PRESERVE
    assert decision.text_role in (TextRole.SFX, TextRole.REVIEW)


def test_hair_strand_without_discrete_glyphs_lacks_glyph_support() -> None:
    """A single continuous strand/curve of 1800px is hair/artwork, not a glyph."""
    prob = np.zeros((200, 200), dtype=np.float32)
    # Draw a single tapering curved line representing a character hair strand
    cv2.line(prob, (50, 20), (120, 160), 0.85, thickness=12)
    cv2.line(prob, (120, 160), (140, 190), 0.85, thickness=4)
    block = DetectedBlock(
        rect=PixelRect(x=40, y=10, width=120, height=190),
        confidence=0.75,
    )
    assert not _has_glyph_support(prob, block)


def test_discrete_text_glyphs_have_glyph_support() -> None:
    """True text composed of multiple discrete glyph components has glyph support."""
    prob = np.zeros((200, 200), dtype=np.float32)
    # Draw 4 small separate glyph boxes representing Japanese kana or letters
    for i in range(4):
        cv2.rectangle(prob, (50, 30 + i * 35), (80, 55 + i * 35), 0.90, -1)
    block = DetectedBlock(
        rect=PixelRect(x=40, y=20, width=50, height=150),
        confidence=0.85,
    )
    assert _has_glyph_support(prob, block)
