import numpy as np
from app.cleaners.flat import FlatCleaner
from app.mask_refiner import MaskRegion
from app.schemas import PixelRect


def test_flat_cleaner_textured_bubble_operates_on_local_crop_only():
    # สร้างภาพหน้าใหญ่ที่มี noise เฉพาะรอบบอลลูน เพื่อทดสอบเส้นทางสังเคราะห์เกรน LAB
    rng = np.random.default_rng(42)
    image = rng.integers(230, 250, size=(1600, 1200, 3), dtype=np.uint8)
    mask = np.zeros((1600, 1200), dtype=np.uint8)
    mask[200:240, 300:360] = 255
    image[200:240, 300:360] = 15  # หมึกตัวอักษรสีดำ

    region = MaskRegion(
        id=7,
        rect=PixelRect(x=300, y=200, width=60, height=40),
        component_ids=[1],
        stroke_radius=3.0,
    )

    cleaned = FlatCleaner().clean(image, mask, region)

    # พื้นที่ตัวอักษรถูกลบเป็นสีพื้นหลังสว่าง และพิกเซลนอกกรอบไม่ถูกแตะต้องเลย
    assert float(np.mean(cleaned[200:240, 300:360])) > 225.0
    assert np.array_equal(cleaned[:150, :150], image[:150, :150])
