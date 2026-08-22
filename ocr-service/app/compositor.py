import cv2
import numpy as np

from app.detector import RgbImage
from app.mask_refiner import BinaryMask


def compose(
    original: RgbImage,
    repaired: RgbImage,
    mask: BinaryMask,
    feather_radius: int = 1,
) -> tuple[RgbImage, BinaryMask]:
    if original.shape != repaired.shape or original.shape[:2] != mask.shape:
        raise ValueError("original, repaired, and mask dimensions must match")
    binary = (mask > 0).astype(np.uint8)
    if not np.any(binary):
        return original.copy(), np.zeros_like(mask)

    if feather_radius <= 0:
        support = binary
        alpha = binary.astype(np.float32)
    else:
        kernel = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE,
            (feather_radius * 2 + 1, feather_radius * 2 + 1),
        )
        support = cv2.dilate(binary, kernel)
        alpha = cv2.GaussianBlur(
            binary.astype(np.float32),
            (feather_radius * 2 + 1, feather_radius * 2 + 1),
            0,
        )
        alpha[support == 0] = 0
    blended = (
        original.astype(np.float32) * (1 - alpha[..., None])
        + repaired.astype(np.float32) * alpha[..., None]
    )
    result = np.clip(np.rint(blended), 0, 255).astype(np.uint8)
    result[support == 0] = original[support == 0]
    return result, (support * 255).astype(np.uint8)
