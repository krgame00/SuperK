from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

import cv2
import numpy as np

from app.detector import RgbImage
from app.mask_refiner import BinaryMask, MaskRegion
from app.page_context import PageContext
from app.schemas import PixelRect, ProtectionReason

QR_PROTECTION_MARGIN = 8


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

    return ProtectionResult(protected, review, regions)


def _mask_rect(mask: BinaryMask) -> PixelRect:
    points = cv2.findNonZero(mask)
    if points is None:
        raise ValueError("cannot describe an empty protected mask")
    x, y, width, height = cv2.boundingRect(points)
    return PixelRect(x=x, y=y, width=width, height=height)
