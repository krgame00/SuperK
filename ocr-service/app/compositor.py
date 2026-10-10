import cv2
import numpy as np

from app.detector import RgbImage
from app.mask_refiner import BinaryMask


def compose(
    original: RgbImage,
    repaired: RgbImage,
    mask: BinaryMask,
    feather_radius: int = 0,
) -> tuple[RgbImage, BinaryMask]:
    if original.shape != repaired.shape or original.shape[:2] != mask.shape:
        raise ValueError("original, repaired, and mask dimensions must match")
    binary = (mask > 0).astype(np.uint8)
    if not np.any(binary):
        return original.copy(), np.zeros_like(mask)

    points = cv2.findNonZero(binary)
    if points is None:
        return original.copy(), np.zeros_like(mask)
    bx, by, bw, bh = cv2.boundingRect(points)
    pad = max(0, int(feather_radius)) + 2 if feather_radius > 0 else 0
    height, width = binary.shape
    x1 = max(0, bx - pad)
    y1 = max(0, by - pad)
    x2 = min(width, bx + bw + pad)
    y2 = min(height, by + bh + pad)

    crop_binary = binary[y1:y2, x1:x2]
    crop_original = original[y1:y2, x1:x2]
    crop_repaired = repaired[y1:y2, x1:x2]

    if feather_radius <= 0:
        support = crop_binary
        alpha = crop_binary.astype(np.float32)
    else:
        kernel = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE,
            (feather_radius * 2 + 1, feather_radius * 2 + 1),
        )
        support = cv2.dilate(crop_binary, kernel)
        dist = cv2.distanceTransform((1 - crop_binary).astype(np.uint8), cv2.DIST_L2, 3)
        t = np.clip(dist / (feather_radius + 0.5), 0.0, 1.0)
        alpha = 1.0 - (3.0 * t**2 - 2.0 * t**3)
        alpha[crop_binary > 0] = 1.0
        alpha[support == 0] = 0.0

    blended = (
        crop_original.astype(np.float32) * (1 - alpha[..., None])
        + crop_repaired.astype(np.float32) * alpha[..., None]
    )
    crop_result = np.clip(np.rint(blended), 0, 255).astype(np.uint8)
    crop_result[support == 0] = crop_original[support == 0]

    result = original.copy()
    full_support = np.zeros_like(mask)
    result[y1:y2, x1:x2] = crop_result
    full_support[y1:y2, x1:x2] = (support * 255).astype(np.uint8)
    return result, full_support
