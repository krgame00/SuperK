from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

import cv2
import numpy as np

from app.detector import RgbImage
from app.mask_refiner import BinaryMask, MaskRegion
from app.page_context import PageContext
from app.schemas import PageRole, PixelRect, ProtectionReason

QR_PROTECTION_MARGIN = 8
OUTER_MARGIN_FRACTION = 0.08
COMPACT_REGION_AREA_FRACTION = 0.02


class QrScanner(Protocol):
    def detect(self, image_rgb: RgbImage) -> list[np.ndarray]: ...


class OpenCvQrScanner:
    def detect(self, image_rgb: RgbImage) -> list[np.ndarray]:
        detector = cv2.QRCodeDetector()
        found, points = detector.detect(image_rgb)
        if not found or points is None:
            return []
        return [np.asarray(points, dtype=np.int32).reshape(-1, 2)]


@dataclass(frozen=True)
class ProtectedRegion:
    rect: PixelRect
    reason: ProtectionReason
    confidence: float


@dataclass(frozen=True)
class ProtectionResult:
    protected_mask: BinaryMask
    review_mask: BinaryMask
    regions: list[ProtectedRegion]


def detect_protection(
    image_rgb: RgbImage,
    page: PageContext,
    text_regions: Sequence[MaskRegion],
    *,
    qr_scanner: QrScanner | None = None,
) -> ProtectionResult:
    if image_rgb.ndim != 3 or image_rgb.shape[2] != 3:
        raise ValueError(f"expected HxWx3 RGB image, got {image_rgb.shape}")

    height, width = image_rgb.shape[:2]
    protected = np.zeros((height, width), dtype=np.uint8)
    review = np.zeros_like(protected)
    regions: list[ProtectedRegion] = []

    scanner = qr_scanner or OpenCvQrScanner()
    for polygon in scanner.detect(image_rgb):
        qr_mask = np.zeros_like(protected)
        cv2.fillPoly(qr_mask, [np.asarray(polygon, dtype=np.int32)], 255)
        kernel_size = QR_PROTECTION_MARGIN * 2 + 1
        qr_mask = cv2.dilate(
            qr_mask,
            np.ones((kernel_size, kernel_size), np.uint8),
            iterations=1,
        )
        protected = np.maximum(protected, qr_mask)
        regions.append(
            ProtectedRegion(
                rect=_mask_rect(qr_mask),
                reason=ProtectionReason.QR,
                confidence=1.0,
            ),
        )

    if page.role in (PageRole.CREDITS, PageRole.UI):
        reason = (
            ProtectionReason.CREDIT_PAGE
            if page.role is PageRole.CREDITS
            else ProtectionReason.UI_PAGE
        )
        for region in text_regions:
            _fill_rect(protected, region.rect)
            regions.append(
                ProtectedRegion(
                    rect=region.rect,
                    reason=reason,
                    confidence=page.confidence,
                ),
            )
        return ProtectionResult(protected, review, regions)

    if page.role is PageRole.UNKNOWN:
        for region in text_regions:
            _fill_rect(review, region.rect)
            regions.append(
                ProtectedRegion(
                    rect=region.rect,
                    reason=ProtectionReason.LOW_CONFIDENCE,
                    confidence=page.confidence,
                ),
            )
        return ProtectionResult(protected, review, regions)

    page_area = height * width
    for region in text_regions:
        if (
            region.rect.width * region.rect.height
            <= page_area * COMPACT_REGION_AREA_FRACTION
            and _intersects_outer_margin(region.rect, width, height)
        ):
            _fill_rect(review, region.rect)
            regions.append(
                ProtectedRegion(
                    rect=region.rect,
                    reason=ProtectionReason.MARGIN_MARK,
                    confidence=0.80,
                ),
            )
    return ProtectionResult(protected, review, regions)


def _intersects_outer_margin(
    rect: PixelRect,
    width: int,
    height: int,
) -> bool:
    margin_x = width * OUTER_MARGIN_FRACTION
    margin_y = height * OUTER_MARGIN_FRACTION
    return (
        rect.x < margin_x
        or rect.y < margin_y
        or rect.x + rect.width > width - margin_x
        or rect.y + rect.height > height - margin_y
    )


def _fill_rect(mask: BinaryMask, rect: PixelRect) -> None:
    height, width = mask.shape
    x1 = min(max(rect.x, 0), width)
    y1 = min(max(rect.y, 0), height)
    x2 = min(max(rect.x + rect.width, 0), width)
    y2 = min(max(rect.y + rect.height, 0), height)
    mask[y1:y2, x1:x2] = 255


def _mask_rect(mask: BinaryMask) -> PixelRect:
    points = cv2.findNonZero(mask)
    if points is None:
        raise ValueError("cannot describe an empty protected mask")
    x, y, width, height = cv2.boundingRect(points)
    return PixelRect(x=x, y=y, width=width, height=height)
