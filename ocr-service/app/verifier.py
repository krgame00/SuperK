from __future__ import annotations

from typing import Protocol

import cv2
import numpy as np
from pydantic import BaseModel, ConfigDict, Field

from app.detector import RgbImage
from app.mask_refiner import BinaryMask, MaskRegion


class ResidualProbe(Protocol):
    def score(self, cleaned_crop: RgbImage, source_mask: BinaryMask) -> float: ...


class VerificationReport(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    residual_score: float = Field(ge=0)
    damage_score: float = Field(ge=0)
    accepted: bool
    retry_mask_radius: int | None
    residual_mask: BinaryMask | None = None


def verify_damage(
    original: RgbImage,
    cleaned: RgbImage,
    support_mask: BinaryMask,
) -> VerificationReport:
    support = support_mask > 0
    changed = np.any(original != cleaned, axis=2)
    outside_changed = changed & ~support
    outside_ratio = float(np.mean(outside_changed))
    boundary_error = _boundary_gradient_error(original, cleaned, support)
    damage_score = outside_ratio + boundary_error
    accepted = not np.any(outside_changed) and boundary_error <= 0.25
    return VerificationReport(
        residual_score=0,
        damage_score=damage_score,
        accepted=accepted,
        retry_mask_radius=None,
    )


def verify_region(
    original: RgbImage,
    cleaned: RgbImage,
    source_mask: BinaryMask,
    support_mask: BinaryMask,
    region: MaskRegion,
    residual_probe: ResidualProbe,
    evidence_envelope: BinaryMask | None = None,
    protected_edges: BinaryMask | None = None,
) -> VerificationReport:
    rect = region.rect
    crop = cleaned[
        rect.y : rect.y + rect.height,
        rect.x : rect.x + rect.width,
    ]
    crop_mask = source_mask[
        rect.y : rect.y + rect.height,
        rect.x : rect.x + rect.width,
    ]
    res_mask = np.zeros_like(source_mask)
    if hasattr(residual_probe, "score_envelope"):
        env = (
            evidence_envelope
            if evidence_envelope is not None
            else np.ones_like(source_mask) * 255
        )
        prot = (
            protected_edges
            if protected_edges is not None
            else np.zeros_like(source_mask)
        )
        report = residual_probe.score_envelope(
            cleaned,
            source_mask,
            env,
            prot,
        )
        residual = report.residual_score
        if report.residual_mask is not None:
            res_mask = report.residual_mask.copy()
    else:
        residual = residual_probe.score(crop, crop_mask)

    damage = verify_damage(original, cleaned, support_mask)
    accepted = damage.accepted and residual <= 0.18

    # Safe retry: eligible if residual text remains, but no pixels changed outside support
    outside_changed = np.any(original != cleaned, axis=2) & (support_mask == 0)
    retry = 2 if (residual > 0.18 and not np.any(outside_changed)) else None

    return VerificationReport(
        residual_score=residual,
        damage_score=damage.damage_score,
        accepted=accepted,
        retry_mask_radius=retry,
        residual_mask=res_mask if np.any(res_mask > 0) else None,
    )


def _boundary_gradient_error(
    original: RgbImage,
    cleaned: RgbImage,
    support: np.ndarray,
) -> float:
    if not np.any(support):
        return 0.0
    outer = (
        cv2.dilate(support.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    ) & ~support
    if not np.any(outer):
        return 0.0
    original_gray = cv2.cvtColor(original, cv2.COLOR_RGB2GRAY)
    cleaned_gray = cv2.cvtColor(cleaned, cv2.COLOR_RGB2GRAY)
    original_gradient = cv2.Laplacian(original_gray, cv2.CV_32F)
    cleaned_gradient = cv2.Laplacian(cleaned_gray, cv2.CV_32F)
    return float(
        np.mean(np.abs(cleaned_gradient[outer] - original_gradient[outer])) / 255,
    )
