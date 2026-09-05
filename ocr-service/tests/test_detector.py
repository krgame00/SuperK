import os
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from app.detector import (
    LetterboxTransform,
    TextDetector,
    decode_yolo_blocks,
    non_max_suppression,
    prepare_input,
    restore_mask,
)
from app.model_store import ModelStore


def test_restore_mask_removes_letterbox_padding() -> None:
    transform = LetterboxTransform(
        source_width=400,
        source_height=200,
        input_size=1024,
        scale=2.56,
        pad_x=0,
        pad_y=0,
    )
    model_mask = np.zeros((1024, 1024), dtype=np.float32)
    model_mask[:512, :] = 1.0
    restored = restore_mask(model_mask, transform)
    assert restored.shape == (200, 400)
    assert restored.dtype == np.float32
    assert float(restored.min()) > 0.99


def test_prepare_input_letterboxes_rgb_as_nchw_float32() -> None:
    image = np.zeros((100, 200, 3), dtype=np.uint8)
    image[..., 0] = 255
    tensor, transform = prepare_input(image, input_size=1024)
    assert tensor.shape == (1, 3, 1024, 1024)
    assert tensor.dtype == np.float32
    assert transform.pad_y == 0
    assert transform.pad_x == 0
    assert np.isclose(tensor.max(), 1.0)
    assert np.isclose(tensor[0, 0].max(), 0.0)
    assert np.isclose(tensor[0, 2].max(), 1.0)


def test_non_max_suppression_keeps_best_overlapping_box() -> None:
    prediction = np.array(
        [
            [
                [50, 50, 20, 20, 0.9, 0.9],
                [50, 50, 20, 20, 0.8, 0.9],
            ],
        ],
        dtype=np.float32,
    )
    detections = non_max_suppression(prediction, 0.1, 0.1)
    assert len(detections) == 1
    assert detections[0].shape == (1, 6)
    assert np.isclose(detections[0][0, 4], 0.81)


def test_decode_yolo_blocks_restores_source_coordinates() -> None:
    transform = LetterboxTransform(
        source_width=400,
        source_height=200,
        input_size=1024,
        scale=2.56,
        pad_x=0,
        pad_y=0,
    )
    detections = np.array([[256, 128, 512, 384, 0.9, 0]], dtype=np.float32)
    blocks = decode_yolo_blocks(detections, transform)
    assert len(blocks) == 1
    assert blocks[0].rect.model_dump() == {
        "x": 100,
        "y": 50,
        "width": 100,
        "height": 100,
    }


def test_detector_returns_source_sized_probability_mask() -> None:
    class FakeInput:
        name = "image"

    class FakeSession:
        def get_inputs(self) -> list[FakeInput]:
            return [FakeInput()]

        def run(
            self,
            _outputs: None,
            inputs: dict[str, np.ndarray],
        ) -> list[np.ndarray]:
            assert inputs["image"].shape == (1, 3, 32, 32)
            boxes = np.array(
                [[[16, 8, 8, 8, 0.9, 0.9]]],
                dtype=np.float32,
            )
            mask = np.zeros((1, 1, 32, 32), dtype=np.float32)
            mask[:, :, :16, :] = 0.75
            return [boxes, mask]

    image = np.full((16, 32, 3), 255, dtype=np.uint8)
    detector = TextDetector.from_session(FakeSession(), input_size=32)
    result = detector.detect(image)
    assert result.mask_probability.shape == (16, 32)
    assert np.isclose(result.mask_probability.min(), 0.75)
    assert len(result.blocks) == 1


@pytest.mark.model
def test_ctd_model_returns_source_sized_mask() -> None:
    source = os.environ.get("SUPERK_MODEL_TEST_IMAGE")
    if not source:
        pytest.skip("set SUPERK_MODEL_TEST_IMAGE to run the CTD model smoke test")
    service_root = Path(__file__).resolve().parents[1]
    store = ModelStore.from_manifest(
        service_root / "models",
        service_root / "models" / "manifest.json",
    )
    image = np.asarray(Image.open(source).convert("RGB"))
    result = TextDetector(store).detect(image)
    assert result.mask_probability.shape == image.shape[:2]
    assert 0.0 <= float(result.mask_probability.min())
    assert float(result.mask_probability.max()) <= 1.0
    assert result.blocks


def test_hybrid_detector_combines_masks() -> None:
    from app.detector import DetectionResult, HybridTextDetector, LetterboxTransform

    class DummyCTD:
        def detect(self, img):
            h, w = img.shape[:2]
            return DetectionResult(
                mask_probability=np.zeros((h, w), dtype=np.float32),
                blocks=[],
                scale=LetterboxTransform(w, h, 1024, 1.0, 0, 0),
            )

    class DummyPaddle:
        def ocr(self, img, cls=True):
            # Return a detected text line at [20, 20] to [40, 40]
            return [[
                [[[20.0, 20.0], [40.0, 20.0], [40.0, 40.0], [20.0, 40.0]], ("TEST", 0.99)]
            ]]

    image = np.full((100, 100, 3), 255, dtype=np.uint8)
    image[25:35, 25:35] = 0  # Black text inside bounding box

    detector = HybridTextDetector(DummyCTD(), paddle_engine=DummyPaddle())
    res = detector.detect(image)
    assert res.mask_probability.shape == (100, 100)
    assert len(res.blocks) == 1
    assert np.any(res.mask_probability[20:40, 20:40] > 0.5)


def test_merge_adjacent_blocks_bridges_vertical_dialogue_gap() -> None:
    from app.detector import DetectedBlock, _merge_adjacent_blocks
    from app.schemas import PixelRect

    b1 = DetectedBlock(rect=PixelRect(x=100, y=50, width=80, height=40), confidence=0.9)
    # b2 is in the same column, with a vertical gap of 15px
    b2 = DetectedBlock(rect=PixelRect(x=105, y=105, width=75, height=35), confidence=0.8)
    # b3 is far away
    b3 = DetectedBlock(rect=PixelRect(x=300, y=50, width=50, height=50), confidence=0.7)

    merged = _merge_adjacent_blocks([b1, b2, b3], max_gap=30)
    assert len(merged) == 2
    # The first merged block spans y from 50 to 140
    merged_col = next(b for b in merged if b.rect.x <= 110)
    assert merged_col.rect.y == 50
    assert merged_col.rect.height == 90  # 140 - 50


def test_detect_skin_tattoos_finds_dark_text_on_skin() -> None:
    from app.detector import _detect_skin_tattoos

    # Create an image with skin tone (Cr~150, Cb~105 in YCrCb)
    # RGB approximately: (240, 195, 180)
    image = np.full((120, 120, 3), (240, 195, 180), dtype=np.uint8)
    # Draw realistic dark text stroke in the middle (3px thick)
    image[52:55, 40:80] = (20, 20, 20)

    mask = _detect_skin_tattoos(image)
    assert mask.shape == (120, 120)
    assert np.any(mask[52:55, 40:80] > 0)


def test_hybrid_detector_does_not_promote_skin_marks_without_text_evidence() -> None:
    from app.detector import DetectionResult, HybridTextDetector, LetterboxTransform

    class EmptyCTD:
        def detect(self, img):
            h, w = img.shape[:2]
            return DetectionResult(
                mask_probability=np.zeros((h, w), dtype=np.float32),
                blocks=[],
                scale=LetterboxTransform(w, h, 1024, 1.0, 0, 0),
            )

    image = np.full((120, 120, 3), (240, 195, 180), dtype=np.uint8)
    image[52:55, 40:80] = (20, 20, 20)

    result = HybridTextDetector(EmptyCTD(), paddle_engine=None).detect(image)

    assert not np.any(result.mask_probability > 0)
    assert result.blocks == []


def test_hybrid_detector_rejects_unblocked_ctd_character_line() -> None:
    from app.detector import DetectionResult, HybridTextDetector, LetterboxTransform

    class FalsePositiveCTD:
        def detect(self, img):
            h, w = img.shape[:2]
            probability = np.zeros((h, w), dtype=np.float32)
            probability[58:61, 20:100] = 0.95
            return DetectionResult(
                mask_probability=probability,
                blocks=[],
                scale=LetterboxTransform(w, h, 1024, 1.0, 0, 0),
            )

    image = np.full((120, 120, 3), 180, dtype=np.uint8)
    image[58:61, 20:100] = 20

    result = HybridTextDetector(FalsePositiveCTD(), paddle_engine=None).detect(image)

    assert not np.any(result.mask_probability > 0)
    assert result.blocks == []


def test_evidence_envelope_overlapping_character_line_does_not_leak_into_mask() -> None:
    from app.detector import (
        DetectedBlock,
        DetectionResult,
        LetterboxTransform,
        _merge_adjacent_blocks,
    )
    from app.mask_refiner import build_protected_edges, refine_mask
    from app.schemas import PixelRect

    # 1. Test that _merge_adjacent_blocks does not bridge across protected edges
    block_top = DetectedBlock(rect=PixelRect(x=20, y=10, width=60, height=20), confidence=0.9)
    block_bot = DetectedBlock(rect=PixelRect(x=20, y=50, width=60, height=20), confidence=0.9)

    protected_edges = np.zeros((100, 100), dtype=np.uint8)
    # Character outline running horizontally right through the gap between y=30 and y=50
    protected_edges[40, 10:90] = 255

    merged = _merge_adjacent_blocks([block_top, block_bot], max_gap=30, protected_edges=protected_edges)
    assert len(merged) == 2, "Blocks must NOT merge across protected artwork edge"

    # Without the protected edge, they would merge:
    merged_open = _merge_adjacent_blocks([block_top, block_bot], max_gap=30, protected_edges=None)
    assert len(merged_open) == 1, "Blocks should merge when gap has no artwork edge"

    # 2. Test that an evidence envelope overlapping a character line does NOT leak into deletion mask
    image = np.full((100, 100, 3), 200, dtype=np.uint8)
    image[40:42, 10:90] = 20  # Character line
    edges = build_protected_edges(image, np.zeros((100, 100), dtype=np.float32))
    assert np.any(edges[40:42, 10:90] > 0)

    # Simulated text detection with evidence envelope covering the character line
    prob = np.zeros((100, 100), dtype=np.float32)
    # Text stroke is at 20:25, 20:40
    prob[20:25, 20:40] = 0.90
    detection = DetectionResult(
        mask_probability=prob,
        blocks=[DetectedBlock(rect=PixelRect(x=10, y=10, width=80, height=60), confidence=0.95)],
        scale=LetterboxTransform(100, 100, 1024, 1.0, 0, 0),
    )
    refined = refine_mask(image, detection)
    # Deletion mask must NOT include the character line
    assert not np.any(refined.mask[40:42, 10:90] > 0), "Character line must be protected from deletion mask"


def test_plausible_text_block_rejects_oversized_block() -> None:
    from app.detector import DetectedBlock, _is_plausible_text_block
    from app.schemas import PixelRect

    # Block covering 30% of image area -> should be rejected
    big = DetectedBlock(rect=PixelRect(x=0, y=0, width=600, height=500), confidence=0.9)
    assert not _is_plausible_text_block(big, 1000, 1000)

    # Block covering 20% -> should be accepted
    ok = DetectedBlock(rect=PixelRect(x=0, y=0, width=400, height=500), confidence=0.9)
    assert _is_plausible_text_block(ok, 1000, 1000)

    # Block covering exactly 25% -> should be accepted (boundary)
    border = DetectedBlock(rect=PixelRect(x=0, y=0, width=500, height=500), confidence=0.9)
    assert _is_plausible_text_block(border, 1000, 1000)


def test_plausible_text_block_rejects_extreme_aspect_ratio() -> None:
    from app.detector import DetectedBlock, _is_plausible_text_block
    from app.schemas import PixelRect

    # 12:1 aspect ratio -> reject
    thin = DetectedBlock(rect=PixelRect(x=0, y=0, width=240, height=20), confidence=0.9)
    assert not _is_plausible_text_block(thin, 1000, 1000)

    # 1:12 aspect ratio -> reject
    tall = DetectedBlock(rect=PixelRect(x=0, y=0, width=20, height=240), confidence=0.9)
    assert not _is_plausible_text_block(tall, 1000, 1000)

    # 5:1 aspect ratio -> accept
    ok = DetectedBlock(rect=PixelRect(x=0, y=0, width=200, height=40), confidence=0.9)
    assert _is_plausible_text_block(ok, 1000, 1000)

    # Thin horizontal line spanning image width -> reject
    line = DetectedBlock(rect=PixelRect(x=0, y=0, width=850, height=10), confidence=0.9)
    assert not _is_plausible_text_block(line, 1000, 1000)


def test_hybrid_detector_edge_dense_crop_uses_seed_only() -> None:
    """When a block crop has high edge density (> 0.45), the detector should
    use seed-only mode and NOT fuse artwork strokes into the mask."""
    from app.detector import DetectedBlock, DetectionResult, HybridTextDetector, LetterboxTransform
    from app.schemas import EvidenceSource, PixelRect, TextEvidenceRegion

    class ArtworkCTD:
        def detect(self, img):
            h, w = img.shape[:2]
            probability = np.zeros((h, w), dtype=np.float32)
            # Only a small text seed at center
            probability[48:52, 48:52] = 0.50
            block = DetectedBlock(
                rect=PixelRect(x=10, y=10, width=80, height=80),
                confidence=0.9,
            )
            return DetectionResult(
                mask_probability=probability,
                blocks=[block],
                scale=LetterboxTransform(w, h, 1024, 1.0, 0, 0),
                evidence_regions=[
                    TextEvidenceRegion(
                        id="ctd-0",
                        rect=PixelRect(x=10, y=10, width=80, height=80),
                        polygon=None,
                        source=EvidenceSource.CTD,
                        confidence=0.9,
                    )
                ],
            )

    # Heavy edge artwork image (lots of diagonal lines)
    image = np.full((100, 100, 3), 200, dtype=np.uint8)
    for i in range(100):
        if i % 2 == 0:
            image[i, :] = 20  # alternating black lines = heavy edges

    detector = HybridTextDetector(ArtworkCTD(), paddle_engine=None)
    res = detector.detect(image)

    # The mask should exist only near the seed (48:52, 48:52) area, not fill the whole block
    total_mask = np.count_nonzero(res.mask_probability > 0)
    block_area = 80 * 80
    assert total_mask < block_area * 0.30, (
        f"Mask leaked into artwork: {total_mask} pixels out of {block_area} block area"
    )


def test_glow_candidate_restricted_to_seed_vicinity() -> None:
    """Glow detection should not reach into artwork far from seed pixels."""
    from app.detector import _restrict_to_seed_vicinity

    seed = np.zeros((100, 100), dtype=np.uint8)
    seed[10:15, 10:15] = 255  # seed at top-left corner

    candidate = np.zeros((100, 100), dtype=np.uint8)
    candidate[10:15, 10:15] = 255  # near seed -> should survive
    candidate[80:90, 80:90] = 255  # far from seed -> should be removed

    result = _restrict_to_seed_vicinity(candidate, seed, max_distance=8.0)

    # Near seed should survive
    assert np.any(result[10:15, 10:15] > 0), "Glow near seed should be kept"
    # Far from seed should be gone
    assert not np.any(result[80:90, 80:90] > 0), "Glow far from seed should be removed"


def test_leak_guard_activates_at_40_percent() -> None:
    """The fused mask leak guard should trigger when coverage > 40%."""
    from app.detector import (
        DetectedBlock,
        DetectionResult,
        HybridTextDetector,
        LetterboxTransform,
    )
    from app.schemas import EvidenceSource, PixelRect, TextEvidenceRegion

    class LeakyCTD:
        def detect(self, img):
            h, w = img.shape[:2]
            probability = np.zeros((h, w), dtype=np.float32)
            # Text seed covers a small area
            probability[45:55, 45:55] = 0.80
            block = DetectedBlock(
                rect=PixelRect(x=20, y=20, width=60, height=60),
                confidence=0.9,
            )
            return DetectionResult(
                mask_probability=probability,
                blocks=[block],
                scale=LetterboxTransform(w, h, 1024, 1.0, 0, 0),
                evidence_regions=[
                    TextEvidenceRegion(
                        id="ctd-0",
                        rect=PixelRect(x=20, y=20, width=60, height=60),
                        polygon=None,
                        source=EvidenceSource.CTD,
                        confidence=0.9,
                    )
                ],
            )

    # Image with lots of dark strokes that will fuse into a large mask
    image = np.full((100, 100, 3), 240, dtype=np.uint8)
    # Large dark area inside the block
    image[25:75, 25:75] = 30

    detector = HybridTextDetector(LeakyCTD(), paddle_engine=None)
    res = detector.detect(image)

    # Mask should NOT cover more than 40% of the block crop (leak guard triggered)
    block_crop = res.mask_probability[14:86, 14:86]  # padded block area
    coverage = np.count_nonzero(block_crop > 0) / max(block_crop.size, 1)
    assert coverage < 0.50, (
        f"Leak guard failed: mask covers {coverage:.1%} of block crop"
    )


def test_hybrid_detector_recovers_unassigned_high_confidence_text_clusters() -> None:
    from app.detector import (
        DetectedBlock,
        DetectionResult,
        HybridTextDetector,
        LetterboxTransform,
    )
    from app.schemas import PixelRect

    class MockCTD:
        def detect(self, img):
            h, w = img.shape[:2]
            probability = np.zeros((h, w), dtype=np.float32)
            # Existing block 1
            probability[10:30, 10:30] = 0.9
            # Unassigned text cluster with high probability and textured content
            probability[60:90, 60:90] = 0.85
            block1 = DetectedBlock(rect=PixelRect(x=10, y=10, width=20, height=20), confidence=0.9)
            return DetectionResult(
                mask_probability=probability,
                blocks=[block1],
                scale=LetterboxTransform(w, h, 1024, 1.0, 0, 0),
            )

    # Image with high-frequency edges at the unassigned cluster
    image = np.full((120, 120, 3), 240, dtype=np.uint8)
    for y in range(62, 88, 3):
        for x in range(62, 88, 3):
            image[y : y + 2, x : x + 2] = 20

    detector = HybridTextDetector(MockCTD(), paddle_engine=None)
    res = detector.detect(image)

    # The unassigned cluster should have been recovered
    recovered = [
        b for b in res.blocks
        if b.rect.x >= 50 and b.rect.y >= 50
    ]
    assert len(recovered) >= 1, "Expected unassigned cluster to be recovered into blocks"
    assert np.any(res.mask_probability[65:85, 65:85] > 0), "Expected unassigned cluster to have mask probability"


def test_hybrid_detector_rejects_low_seed_false_positives() -> None:
    from app.detector import (
        DetectedBlock,
        DetectionResult,
        HybridTextDetector,
        LetterboxTransform,
    )
    from app.schemas import PixelRect

    class FalsePositiveCTD:
        def detect(self, img):
            h, w = img.shape[:2]
            probability = np.zeros((h, w), dtype=np.float32)
            # Almost no seed inside the box (less than 4%)
            probability[30:32, 30:32] = 0.5
            # Weak confidence box
            block = DetectedBlock(rect=PixelRect(x=10, y=10, width=80, height=80), confidence=0.52)
            return DetectionResult(
                mask_probability=probability,
                blocks=[block],
                scale=LetterboxTransform(w, h, 1024, 1.0, 0, 0),
            )

    image = np.full((120, 120, 3), 200, dtype=np.uint8)
    detector = HybridTextDetector(FalsePositiveCTD(), paddle_engine=None)
    res = detector.detect(image)

    # Low-confidence block with no text seed should be filtered out
    assert len(res.blocks) == 0
    assert len(res.evidence_regions) == 0


def test_detector_extracts_magenta_and_chromatic_strokes_on_dark_background() -> None:
    from app.detector import (
        DetectionResult,
        HybridTextDetector,
        LetterboxTransform,
        _extract_glow_and_chromatic,
        _extract_strokes_from_crop,
    )

    # Dark background crop (e.g. shadowed floor)
    crop = np.full((50, 80, 3), 40, dtype=np.uint8)
    crop[:, :, 0] = 50  # slight dark brown tint
    crop[:, :, 1] = 35
    crop[:, :, 2] = 30

    # Magenta text inside crop
    crop[15:35, 20:60, 0] = 210  # High Red
    crop[15:35, 20:60, 1] = 45   # Low Green
    crop[15:35, 20:60, 2] = 205  # High Blue

    strokes = _extract_strokes_from_crop(crop)
    assert np.any(strokes[15:35, 20:60] > 0), "Expected stroke extraction to capture magenta text on dark background"

    glow = _extract_glow_and_chromatic(crop)
    assert np.any(glow[15:35, 20:60] > 0), "Expected glow extraction to capture magenta chromatic text"

    # Integration test with Paddle detection on dark background
    class EmptyCTD:
        def detect(self, img):
            h, w = img.shape[:2]
            return DetectionResult(
                mask_probability=np.zeros((h, w), dtype=np.float32),
                blocks=[],
                scale=LetterboxTransform(w, h, 1024, 1.0, 0, 0),
            )

    class MagentaPaddle:
        def ocr(self, img, cls=True):
            return [[
                [[[20.0, 15.0], [60.0, 15.0], [60.0, 35.0], [20.0, 35.0]], ("HOLD", 0.96)]
            ]]

    image = np.full((80, 100, 3), 40, dtype=np.uint8)
    image[15:35, 20:60, 0] = 210
    image[15:35, 20:60, 1] = 45
    image[15:35, 20:60, 2] = 205

    detector = HybridTextDetector(EmptyCTD(), paddle_engine=MagentaPaddle())
    res = detector.detect(image)
    assert np.any(res.mask_probability[15:35, 20:60] > 0.5), "Expected paddle magenta detection to update mask probability"
    assert len(res.blocks) >= 1


