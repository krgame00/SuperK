from __future__ import annotations

from collections.abc import Callable

import cv2
import numpy as np
from pydantic import BaseModel, Field

from app.detector import RgbImage
from app.mask_refiner import BinaryMask, MaskRegion
from app.page_context import PageContext
from app.protection import ProtectionResult
from app.schemas import (
    AutomaticAction,
    PageRole,
    ProtectionReason,
    TextRole,
)

NARRATION_THRESHOLD = 0.82
SFX_THRESHOLD = 0.90


class EligibilityFeatures(BaseModel):
    enclosure_score: float = Field(ge=0, le=1)
    backing_uniformity: float = Field(ge=0, le=1)
    rectangular_backing: float = Field(ge=0, le=1)
    artwork_edge_density: float = Field(ge=0, le=1)
    stroke_irregularity: float = Field(ge=0, le=1)
    margin_fraction: float = Field(ge=0, le=1)


class EligibilityDecision(BaseModel):
    text_role: TextRole
    confidence: float = Field(ge=0, le=1)
    action: AutomaticAction
    protection_reasons: list[ProtectionReason]
    features: EligibilityFeatures


FeatureExtractor = Callable[
    [RgbImage, BinaryMask, MaskRegion],
    EligibilityFeatures,
]


def classify_eligibility(
    image_rgb: RgbImage,
    region_mask: BinaryMask,
    region: MaskRegion,
    page: PageContext,
    protection: ProtectionResult,
    *,
    feature_extractor: FeatureExtractor | None = None,
) -> EligibilityDecision:
    extractor = feature_extractor or extract_eligibility_features
    features = extractor(image_rgb, region_mask, region)

    if page.role is not PageRole.COMIC:
        return _preserve(
            TextRole.PROTECTED,
            page.confidence,
            [_page_reason(page.role)],
            features,
        )
    if _intersects(region_mask, protection.protected_mask):
        reasons = _protection_reasons(protection)
        return _preserve(TextRole.PROTECTED, 1.0, reasons, features)
    if _intersects(region_mask, protection.review_mask):
        reasons = _protection_reasons(
            protection,
            fallback=ProtectionReason.MARGIN_MARK,
        )
        return _preserve(TextRole.REVIEW, 1.0, reasons, features)

    if features.enclosure_score >= 0.72:
        return EligibilityDecision(
            text_role=TextRole.DIALOGUE,
            confidence=features.enclosure_score,
            action=AutomaticAction.CLEAN,
            protection_reasons=[],
            features=features,
        )

    narration_score = (
        0.55 * features.backing_uniformity
        + 0.45 * features.rectangular_backing
    )
    if (
        features.backing_uniformity >= 0.55
        or features.rectangular_backing >= 0.55
    ):
        return _threshold_decision(
            TextRole.NARRATION,
            narration_score,
            NARRATION_THRESHOLD,
            features,
        )

    sfx_score = (
        0.60 * features.artwork_edge_density
        + 0.40 * features.stroke_irregularity
    )
    if (
        features.artwork_edge_density >= 0.35
        or features.stroke_irregularity >= 0.35
    ):
        return _threshold_decision(
            TextRole.SFX,
            sfx_score,
            SFX_THRESHOLD,
            features,
        )

    return _preserve(
        TextRole.REVIEW,
        max(narration_score, sfx_score),
        [ProtectionReason.LOW_CONFIDENCE],
        features,
    )


def extract_eligibility_features(
    image_rgb: RgbImage,
    region_mask: BinaryMask,
    region: MaskRegion,
) -> EligibilityFeatures:
    height, width = region_mask.shape
    rect = region.rect
    padding = max(4, region.stroke_radius * 3)
    x1 = max(0, rect.x - padding)
    y1 = max(0, rect.y - padding)
    x2 = min(width, rect.x + rect.width + padding)
    y2 = min(height, rect.y + rect.height + padding)
    gray = cv2.cvtColor(image_rgb[y1:y2, x1:x2], cv2.COLOR_RGB2GRAY)
    mask_crop = region_mask[y1:y2, x1:x2] > 0
    backing = gray[~mask_crop]
    uniformity = (
        float(np.clip(1.0 - np.std(backing) / 96.0, 0, 1))
        if backing.size
        else 0.0
    )

    edges = cv2.Canny(gray, 80, 160)
    edge_density = min(
        1.0,
        float(np.count_nonzero(edges)) / max(edges.size * 0.20, 1),
    )
    enclosure, rectangle = _backing_shape_scores(
        gray,
        rect_center=(rect.x + rect.width / 2 - x1, rect.y + rect.height / 2 - y1),
        minimum_area=rect.width * rect.height * 1.10,
    )
    irregularity = _stroke_irregularity(region_mask)
    margin_fraction = _margin_fraction(rect, width, height)
    return EligibilityFeatures(
        enclosure_score=enclosure,
        backing_uniformity=uniformity,
        rectangular_backing=rectangle,
        artwork_edge_density=edge_density,
        stroke_irregularity=irregularity,
        margin_fraction=margin_fraction,
    )


def _threshold_decision(
    role: TextRole,
    confidence: float,
    threshold: float,
    features: EligibilityFeatures,
) -> EligibilityDecision:
    clean = confidence >= threshold
    return EligibilityDecision(
        text_role=role if clean else TextRole.REVIEW,
        confidence=confidence,
        action=(
            AutomaticAction.CLEAN
            if clean
            else AutomaticAction.PRESERVE
        ),
        protection_reasons=(
            [] if clean else [ProtectionReason.LOW_CONFIDENCE]
        ),
        features=features,
    )


def _preserve(
    role: TextRole,
    confidence: float,
    reasons: list[ProtectionReason],
    features: EligibilityFeatures,
) -> EligibilityDecision:
    return EligibilityDecision(
        text_role=role,
        confidence=float(np.clip(confidence, 0, 1)),
        action=AutomaticAction.PRESERVE,
        protection_reasons=reasons,
        features=features,
    )


def _page_reason(role: PageRole) -> ProtectionReason:
    if role is PageRole.CREDITS:
        return ProtectionReason.CREDIT_PAGE
    if role is PageRole.UI:
        return ProtectionReason.UI_PAGE
    return ProtectionReason.LOW_CONFIDENCE


def _intersects(left: BinaryMask, right: BinaryMask) -> bool:
    if left.shape != right.shape:
        raise ValueError("eligibility and protection masks must have the same shape")
    return bool(np.any((left > 0) & (right > 0)))


def _protection_reasons(
    protection: ProtectionResult,
    *,
    fallback: ProtectionReason = ProtectionReason.LOW_CONFIDENCE,
) -> list[ProtectionReason]:
    reasons = list(dict.fromkeys(region.reason for region in protection.regions))
    return reasons or [fallback]


def _backing_shape_scores(
    gray: np.ndarray,
    *,
    rect_center: tuple[float, float],
    minimum_area: float,
) -> tuple[float, float]:
    dark = np.where(gray < 180, 255, 0).astype(np.uint8)
    contours, _ = cv2.findContours(
        dark,
        cv2.RETR_EXTERNAL,
        cv2.CHAIN_APPROX_SIMPLE,
    )
    enclosure = 0.0
    rectangle = 0.0
    for contour in contours:
        if cv2.contourArea(contour) < minimum_area:
            continue
        if cv2.pointPolygonTest(contour, rect_center, False) < 0:
            continue
        perimeter = cv2.arcLength(contour, True)
        vertices = len(cv2.approxPolyDP(contour, 0.03 * perimeter, True))
        if vertices <= 4:
            rectangle = max(rectangle, 0.92)
        else:
            enclosure = max(enclosure, 0.90)
    return enclosure, rectangle


def _stroke_irregularity(region_mask: BinaryMask) -> float:
    contours, _ = cv2.findContours(
        np.where(region_mask > 0, 255, 0).astype(np.uint8),
        cv2.RETR_EXTERNAL,
        cv2.CHAIN_APPROX_SIMPLE,
    )
    if not contours:
        return 0.0
    contour = max(contours, key=cv2.contourArea)
    area = cv2.contourArea(contour)
    if area <= 0:
        return 0.0
    perimeter = cv2.arcLength(contour, True)
    compactness = perimeter * perimeter / (4 * np.pi * area)
    return float(np.clip((compactness - 1) / 4, 0, 1))


def _margin_fraction(
    rect,
    width: int,
    height: int,
) -> float:
    margin_x = width * 0.08
    margin_y = height * 0.08
    if (
        rect.x < margin_x
        or rect.y < margin_y
        or rect.x + rect.width > width - margin_x
        or rect.y + rect.height > height - margin_y
    ):
        return 1.0
    return 0.0
