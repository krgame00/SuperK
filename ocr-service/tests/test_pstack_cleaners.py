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


def test_cleaner_and_pipeline_unload_releases_resources():
    from app.cleaners.lama_large import LamaLargeCleaner
    from app.cleaners.aot import AotCleaner
    from app.detector import TextDetector, HybridTextDetector
    from app.pipeline import CleaningPipeline

    class MockSession:
        def __init__(self, providers=None):
            self._providers = providers or ["DmlExecutionProvider"]
        def get_providers(self):
            return self._providers
        def get_inputs(self):
            class Input:
                name = "input"
            return [Input()]

    mock_sess = MockSession()
    lama = LamaLargeCleaner(mock_sess)
    assert lama.session is not None
    lama.unload()
    assert lama.session is None

    mock_sess_aot = MockSession()
    aot = AotCleaner.from_session(mock_sess_aot)
    assert aot.session is not None
    aot.unload()
    assert aot.session is None

    mock_sess_ctd = MockSession()
    ctd = TextDetector.from_session(mock_sess_ctd)
    hybrid = HybridTextDetector(ctd_detector=ctd, paddle_engine="mock_engine")
    pipeline = CleaningPipeline(detector=hybrid, cleaners={"lama": lama, "aot": aot})

    pipeline.unload()
    assert ctd.session is None
    assert hybrid.paddle_engine is None
    assert lama.session is None
    assert aot.session is None


def test_lama_large_directml_bucketing():
    from app.cleaners.lama_large import LamaLargeCleaner

    captured_shapes = []

    class MockDmlSession:
        def get_providers(self):
            return ["DmlExecutionProvider"]
        def run(self, _, inputs):
            img = inputs["image"]
            captured_shapes.append(img.shape)
            return [np.zeros_like(img, dtype=np.float32)]

    lama = LamaLargeCleaner(MockDmlSession())
    img = np.zeros((135, 75, 3), dtype=np.uint8)
    mask = np.ones((135, 75), dtype=np.uint8)

    lama._run(img, mask)
    assert len(captured_shapes) == 1
    # 135 snapped to multiple of 64 is 192; 75 snapped to multiple of 64 is 128
    assert captured_shapes[0] == (1, 3, 192, 128)

