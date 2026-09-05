import numpy as np

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
