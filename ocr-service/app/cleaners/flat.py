from __future__ import annotations

import cv2
import numpy as np

from app.detector import RgbImage
from app.mask_refiner import BinaryMask, MaskRegion
from app.region_router import extract_region_features


class FlatCleaner:
    def clean(
        self,
        image_rgb: RgbImage,
        mask: BinaryMask,
        region: MaskRegion,
    ) -> RgbImage:
        support = _region_mask(mask, region)
        ring = _ring(support, radius=8)
        result = image_rgb.copy()
        if not np.any(support) or not np.any(ring):
            return result

        features = extract_region_features(image_rgb, mask, region)
        if features.gradient_coherence >= 0.55:
            repair = _fit_color_plane(image_rgb, ring)
        else:
            lab = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2LAB)
            median = np.median(lab[ring], axis=0).astype(np.uint8)
            repair_lab = np.empty_like(lab)
            repair_lab[:] = median
            repair = cv2.cvtColor(repair_lab, cv2.COLOR_LAB2RGB)
        result[support] = repair[support]
        return result


class GradientCleaner:
    def clean(
        self,
        image_rgb: RgbImage,
        mask: BinaryMask,
        region: MaskRegion,
    ) -> RgbImage:
        support = _region_mask(mask, region)
        result = image_rgb.copy()
        if not np.any(support):
            return result

        binary = support.astype(np.uint8) * 255
        candidates = [
            cv2.inpaint(image_rgb, binary, radius, cv2.INPAINT_TELEA)
            for radius in (2, 3, 5)
        ]
        repaired = min(
            candidates,
            key=lambda candidate: _boundary_gradient_error(
                image_rgb,
                candidate,
                support,
            ),
        )
        result[support] = repaired[support]
        return result


def _region_mask(mask: BinaryMask, region: MaskRegion) -> np.ndarray:
    support = np.zeros(mask.shape, dtype=bool)
    rect = region.rect
    support[
        rect.y : rect.y + rect.height,
        rect.x : rect.x + rect.width,
    ] = (
        mask[
            rect.y : rect.y + rect.height,
            rect.x : rect.x + rect.width,
        ]
        > 0
    )
    return support


def _ring(support: np.ndarray, radius: int) -> np.ndarray:
    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE,
        (radius * 2 + 1, radius * 2 + 1),
    )
    return (cv2.dilate(support.astype(np.uint8), kernel) > 0) & ~support


def _fit_color_plane(image_rgb: RgbImage, sample_mask: np.ndarray) -> RgbImage:
    y, x = np.nonzero(sample_mask)
    design = np.column_stack((x, y, np.ones_like(x))).astype(np.float32)
    repaired = np.empty_like(image_rgb)
    full_y, full_x = np.indices(image_rgb.shape[:2])
    full_design = np.column_stack(
        (full_x.ravel(), full_y.ravel(), np.ones(full_x.size)),
    ).astype(np.float32)
    for channel in range(3):
        coefficients, *_ = np.linalg.lstsq(
            design,
            image_rgb[y, x, channel].astype(np.float32),
            rcond=None,
        )
        values = full_design @ coefficients
        repaired[..., channel] = np.clip(
            values.reshape(image_rgb.shape[:2]),
            0,
            255,
        ).astype(np.uint8)
    return repaired


def _boundary_gradient_error(
    original: RgbImage,
    candidate: RgbImage,
    support: np.ndarray,
) -> float:
    boundary = cv2.dilate(support.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    original_gray = cv2.cvtColor(original, cv2.COLOR_RGB2GRAY)
    candidate_gray = cv2.cvtColor(candidate, cv2.COLOR_RGB2GRAY)
    original_gradient = cv2.Laplacian(original_gray, cv2.CV_32F)
    candidate_gradient = cv2.Laplacian(candidate_gray, cv2.CV_32F)
    return float(
        np.mean(np.abs(candidate_gradient[boundary] - original_gradient[boundary])),
    )
