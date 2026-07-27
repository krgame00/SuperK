from typing import Protocol

from app.detector import RgbImage
from app.mask_refiner import BinaryMask, MaskRegion


class Cleaner(Protocol):
    def clean(
        self,
        image_rgb: RgbImage,
        mask: BinaryMask,
        region: MaskRegion,
    ) -> RgbImage: ...
