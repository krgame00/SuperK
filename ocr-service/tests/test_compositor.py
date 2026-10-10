import numpy as np
import cv2

from app.compositor import compose


def test_default_composition_does_not_expand_mask_support() -> None:
    original = np.zeros((12, 12, 3), np.uint8)
    repaired = np.full_like(original, 255)
    mask = np.zeros((12, 12), np.uint8)
    mask[6, 6] = 255

    _, support = compose(original, repaired, mask)

    assert np.array_equal(support, mask)


def test_compositor_is_identical_outside_support() -> None:
    random = np.random.default_rng(20260727)
    original = random.integers(0, 256, (96, 96, 3), dtype=np.uint8)
    repaired = np.full_like(original, 127)
    mask = np.zeros((96, 96), np.uint8)
    mask[30:66, 44:52] = 255
    result, support = compose(original, repaired, mask, feather_radius=2)
    assert np.array_equal(result[support == 0], original[support == 0])
    assert not np.array_equal(result[mask > 0], original[mask > 0])


def test_compositor_returns_original_for_empty_mask() -> None:
    original = np.full((16, 16, 3), 42, np.uint8)
    result, support = compose(
        original,
        np.zeros_like(original),
        np.zeros((16, 16), np.uint8),
    )
    assert np.array_equal(result, original)
    assert support.sum() == 0


def test_compositor_feather_produces_smooth_alpha_transition() -> None:
    original = np.zeros((32, 32, 3), np.uint8)
    repaired = np.full((32, 32, 3), 100, np.uint8)
    mask = np.zeros((32, 32), np.uint8)
    mask[10:22, 10:22] = 255

    # feather_radius=2 should produce intermediate gradient values along the border
    result, support = compose(original, repaired, mask, feather_radius=2)

    # Pixels deep inside mask should be fully repaired
    assert np.all(result[12:20, 12:20] == 100)
    # Pixels outside support should be strictly 0
    assert np.all(result[support == 0] == 0)
    # Border pixels between mask and support boundary should have intermediate values (0 < val < 100)
    border_pixels = result[(support > 0) & (mask == 0)]
    assert np.any((border_pixels > 0) & (border_pixels < 100)), "Expected smooth feather gradient at border"


def test_compositor_feathers_only_a_padded_local_crop(monkeypatch) -> None:
    original = np.random.default_rng(20).integers(0, 256, (512, 640, 3), dtype=np.uint8)
    repaired = np.random.default_rng(21).integers(0, 256, original.shape, dtype=np.uint8)
    mask = np.zeros(original.shape[:2], dtype=np.uint8)
    mask[240:270, 310:330] = 255
    seen_shapes = []
    distance_transform = cv2.distanceTransform

    def track_distance_transform(image, *args, **kwargs):
        seen_shapes.append(image.shape)
        return distance_transform(image, *args, **kwargs)

    monkeypatch.setattr(cv2, "distanceTransform", track_distance_transform)
    result, support = compose(original, repaired, mask, feather_radius=4)

    assert seen_shapes and all(height < 64 and width < 64 for height, width in seen_shapes)
    assert np.array_equal(support[support > 0], np.full(np.count_nonzero(support), 255, np.uint8))
    assert np.array_equal(result[support == 0], original[support == 0])

