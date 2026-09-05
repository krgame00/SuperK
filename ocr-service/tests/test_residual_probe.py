from __future__ import annotations

import numpy as np

from app.detector import DetectionResult, FloatMask, LetterboxTransform
from app.residual_probe import CompositeResidualProbe


class MockDetectorWithProb:
    def __init__(self, prob_map: FloatMask) -> None:
        self.prob_map = prob_map

    def detect(self, image_rgb: np.ndarray) -> DetectionResult:
        h, w = image_rgb.shape[:2]
        return DetectionResult(
            mask_probability=self.prob_map[:h, :w],
            blocks=[],
            scale=LetterboxTransform(w, h, max(w, h), 1.0, 0, 0),
        )


def test_residual_probe_detects_unmasked_glyph_within_evidence_envelope() -> None:
    """Failing test for Task 1: Exposes the blind spot where residual outside source_mask

    is ignored by the legacy probe.
    """
    h, w = 32, 32
    source_mask = np.zeros((h, w), dtype=np.uint8)
    source_mask[10:14, 10:14] = 255

    envelope = np.zeros((h, w), dtype=np.uint8)
    envelope[4:28, 4:28] = 255

    prob_map = np.zeros((h, w), dtype=np.float32)
    # Cleaned region inside source_mask has 0 prob, but residual outside is 0.90
    prob_map[16:22, 10:14] = 0.90

    cleaned_crop = np.full((h, w, 3), 200, dtype=np.uint8)
    cleaned_crop[16:22, 10:14] = [20, 20, 20]

    probe = CompositeResidualProbe(MockDetectorWithProb(prob_map))

    # In legacy probe, only score(cleaned_crop, source_mask) exists, looking only at source_mask > 0:
    legacy_score = probe.score(cleaned_crop, source_mask)
    # The legacy score is 0.0 because it only inspects source_mask (which has 0 prob):
    assert legacy_score == 0.0, "Legacy probe blind spot confirmed"

    # The new probe interface must detect residual within evidence_envelope:
    report = probe.score_envelope(
        cleaned_crop=cleaned_crop,
        source_mask=source_mask,
        evidence_envelope=envelope,
        protected_edges=np.zeros((h, w), dtype=np.uint8),
    )

    assert report.residual_score > 0.18
    assert np.any(report.residual_mask[16:22, 10:14] > 0)
    assert report.residual_mask[0:4, 0:4].sum() == 0
